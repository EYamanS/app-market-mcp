import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchApps, lookup, normCountry } from "./itunes.js";
import { isApp, normApp, rowOf, type AppInfo } from "./normalize.js";
import { probeTerms, scoreCompetitors, type Probe } from "./market.js";
import { ok, fail, guard, progress } from "./shared.js";

async function portfolioByArtistId(studioId: string, country: string) {
  const results = await lookup({
    id: studioId,
    country,
    entity: "software",
    limit: 200,
  });
  const artist = results.find((r: any) => r.wrapperType === "artist") ?? null;
  const apps = results.filter(isApp).map(normApp);
  return { artist, apps };
}

function portfolioSummary(apps: AppInfo[]) {
  const rated = apps.filter((a) => a.rating != null);
  const genreCount: Record<string, number> = {};
  for (const a of apps) if (a.genre) genreCount[a.genre] = (genreCount[a.genre] ?? 0) + 1;
  const dates = (xs: (string | null)[]) =>
    xs.filter((x): x is string => x != null).sort();
  const released = dates(apps.map((a) => a.released));
  const updated = dates(apps.map((a) => a.updated));
  return {
    apps: apps.length,
    total_ratings: apps.reduce((s, a) => s + (a.ratings_count ?? 0), 0),
    avg_rating: rated.length
      ? Math.round((rated.reduce((s, a) => s + (a.rating ?? 0), 0) / rated.length) * 100) / 100
      : null,
    genres: Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([genre, count]) => ({ genre, count })),
    first_release: released[0] ?? null,
    latest_release: released[released.length - 1] ?? null,
    latest_update: updated[updated.length - 1] ?? null,
  };
}

export function registerStudioTools(server: McpServer): void {
  server.registerTool(
    "studio_profile",
    {
      title: "Studio profile",
      description:
        "A developer/studio's full App Store portfolio with totals: app count, ratings, " +
        "genre mix, first/latest release. Accepts an Apple artist id (studio_id) or a name " +
        "to search; ambiguous names return candidates to pick from.",
      inputSchema: {
        studio_id: z.string().optional().describe("Apple artist id"),
        name: z.string().optional().describe("Studio name to search for"),
        country: z.string().default("US"),
      },
    },
    guard(async ({ studio_id, name, country }) => {
      const c = normCountry(country);
      let id = studio_id;

      if (!id) {
        if (!name) return fail("Provide studio_id or name.");
        const found = (await searchApps(name, c, 200, "softwareDeveloper"))
          .filter(isApp)
          .map(normApp);
        const groups = new Map<
          string,
          { studio: string; studio_id: string; apps: number; total_ratings: number }
        >();
        for (const a of found) {
          if (!a.studio_id) continue;
          const g =
            groups.get(a.studio_id) ??
            { studio: a.studio, studio_id: a.studio_id, apps: 0, total_ratings: 0 };
          g.apps += 1;
          g.total_ratings += a.ratings_count ?? 0;
          groups.set(a.studio_id, g);
        }
        const candidates = [...groups.values()].sort(
          (x, y) => y.total_ratings - x.total_ratings,
        );
        if (!candidates.length) return fail(`No studios found matching "${name}" in ${c}.`);
        const needle = name.toLowerCase();
        const exact = candidates.filter((g) => g.studio.toLowerCase().includes(needle));
        if (exact.length !== 1) {
          return ok({
            note: `Multiple studios match "${name}" — call again with one of these studio_ids.`,
            candidates: (exact.length ? exact : candidates).slice(0, 8),
          });
        }
        id = exact[0].studio_id;
      }

      const { artist, apps } = await portfolioByArtistId(id, c);
      if (!apps.length) return fail(`No apps found for studio_id ${id} in ${c}.`);
      const sorted = [...apps].sort(
        (a, b) => (b.ratings_count ?? 0) - (a.ratings_count ?? 0),
      );
      return ok({
        studio: {
          id,
          name: artist?.artistName ?? sorted[0].studio,
          url: artist?.artistLinkUrl ?? null,
        },
        totals: portfolioSummary(apps),
        top_apps: sorted.slice(0, 20).map((a, i) => rowOf(i + 1, a)),
      });
    }),
  );

  server.registerTool(
    "studio_releases",
    {
      title: "Studio releases",
      description:
        "What a studio shipped recently: new apps released and existing apps updated " +
        "within a window. Good for spotting momentum or dormancy.",
      inputSchema: {
        studio_id: z.string().describe("Apple artist id"),
        country: z.string().default("US"),
        months: z.number().int().min(1).max(36).default(6),
      },
    },
    guard(async ({ studio_id, country, months }) => {
      const c = normCountry(country);
      const { artist, apps } = await portfolioByArtistId(studio_id, c);
      if (!apps.length) return fail(`No apps found for studio_id ${studio_id} in ${c}.`);
      const cutoff = new Date(Date.now() - months * 30.44 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const brief = (a: AppInfo) => ({
        id: a.id,
        name: a.name,
        released: a.released,
        updated: a.updated,
        version: a.version,
        rating: a.rating,
        ratings_count: a.ratings_count,
      });
      const newApps = apps
        .filter((a) => a.released != null && a.released >= cutoff)
        .sort((a, b) => (b.released ?? "").localeCompare(a.released ?? ""));
      const newIds = new Set(newApps.map((a) => a.id));
      const updatedApps = apps
        .filter((a) => !newIds.has(a.id) && a.updated != null && a.updated >= cutoff)
        .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
      return ok({
        studio: { id: studio_id, name: artist?.artistName ?? apps[0].studio },
        window_months: months,
        since: cutoff,
        portfolio_size: apps.length,
        new_apps: newApps.slice(0, 25).map(brief),
        updated_apps: updatedApps.slice(0, 25).map(brief),
      });
    }),
  );

  server.registerTool(
    "suggest_competitors",
    {
      title: "Suggest competitors",
      description:
        "Find likely competitors for an app from its search neighborhood: probes the store " +
        "with terms derived from the app's title and genre, scores apps that co-occur high " +
        "in results. Runs up to 4 paced searches (~15s).",
      inputSchema: {
        app_id: z.string().describe("Apple track id of the focal app"),
        country: z.string().default("US"),
        limit: z.number().int().min(1).max(20).default(10),
      },
    },
    guard(async ({ app_id, country, limit }, extra) => {
      const c = normCountry(country);
      const found = (await lookup({ id: app_id, country: c })).filter(isApp);
      if (!found.length) return fail(`No app found for id ${app_id} in ${c}.`);
      const focal = normApp(found[0]);
      const terms = probeTerms(focal);
      if (!terms.length) return fail(`Could not derive search probes for "${focal.name}".`);
      const probes: Probe[] = [];
      for (const [i, term] of terms.entries()) {
        await progress(extra, i, terms.length, `probing "${term}"`);
        probes.push({
          term,
          apps: (await searchApps(term, c)).filter(isApp).map(normApp),
        });
      }
      return ok({
        focal: { id: focal.id, name: focal.name, studio: focal.studio, genre: focal.genre },
        probes: terms,
        competitors: scoreCompetitors(probes, focal, limit),
      });
    }),
  );
}
