import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchApps, lookup, topChart, normCountry } from "./itunes.js";
import { isApp, normApp, rowOf } from "./normalize.js";
import { studioBoard, marketStats } from "./market.js";
import { ok, fail, guard, progress, fullProfile, resolveApps, findRank } from "./shared.js";

export function registerMarketTools(server: McpServer): void {
  server.registerTool(
    "search_apps",
    {
      title: "Search the App Store",
      description:
        "App Store search results for a term, in Apple's rank order. The raw primitive — " +
        "for competitive questions prefer share_of_search or market_map.",
      inputSchema: {
        term: z.string().min(1),
        country: z.string().default("US").describe("ISO-2 storefront, e.g. US, TR, DE"),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    guard(async ({ term, country, limit }) => {
      const c = normCountry(country);
      const apps = (await searchApps(term, c)).filter(isApp).map(normApp);
      return ok({
        term,
        country: c,
        result_count: apps.length, // Apple caps search responses at 200
        apps: apps.slice(0, limit).map((a, i) => rowOf(i + 1, a)),
      });
    }),
  );

  server.registerTool(
    "app_profile",
    {
      title: "App profile",
      description:
        "Full normalized metadata for one app: pricing, rating, genre, release/update dates, " +
        "description. Accepts an Apple track id or a bundle id.",
      inputSchema: {
        id: z.string().optional().describe("Apple track id, e.g. 1459969523"),
        bundle_id: z.string().optional().describe("e.g. com.example.app"),
        country: z.string().default("US"),
      },
    },
    guard(async ({ id, bundle_id, country }) => {
      if (!id && !bundle_id) return fail("Provide id or bundle_id.");
      const c = normCountry(country);
      const results = (
        await lookup({ id: id || undefined, bundleId: bundle_id || undefined, country: c })
      ).filter(isApp);
      if (!results.length) {
        return fail(`No app found for ${id ?? bundle_id} in the ${c} storefront.`);
      }
      return ok(fullProfile(results[0]));
    }),
  );

  server.registerTool(
    "share_of_search",
    {
      title: "Share of search for a keyword",
      description:
        "Who owns an App Store keyword: the top-50 apps returned for a search term in rank " +
        "order, plus which studios hold the most slots. Optionally flag a focus app and its " +
        "competitors to see where they all sit.",
      inputSchema: {
        keyword: z.string().min(1),
        country: z.string().default("US"),
        focus_app_id: z.string().optional().describe("Apple track id to highlight"),
        competitor_ids: z.array(z.string()).max(15).optional(),
      },
    },
    guard(async ({ keyword, country, focus_app_id, competitor_ids }) => {
      const c = normCountry(country);
      const apps = (await searchApps(keyword, c)).filter(isApp).map(normApp);
      const rivals = new Set(competitor_ids ?? []);
      const leaderboard = apps.slice(0, 50).map((a, i) => ({
        ...rowOf(i + 1, a),
        ...(a.id === focus_app_id ? { focus: true } : {}),
        ...(rivals.has(a.id) ? { rival: true } : {}),
      }));

      let focus_summary: Record<string, unknown> | null = null;
      if (focus_app_id) {
        const rank = findRank(apps, focus_app_id);
        const rivalRanks = [...rivals]
          .map((id) => ({ id, rank: findRank(apps, id) }))
          .filter((r) => r.id !== focus_app_id);
        focus_summary = {
          rank, // null = not in the top 200
          rivals_above:
            rank != null
              ? rivalRanks.filter((r) => r.rank != null && r.rank < rank).length
              : rivalRanks.filter((r) => r.rank != null).length,
          rivals_below:
            rank != null
              ? rivalRanks.filter((r) => r.rank != null && r.rank > rank).length
              : 0,
          unranked_rivals: rivalRanks.filter((r) => r.rank == null).map((r) => r.id),
        };
      }

      return ok({
        keyword,
        country: c,
        result_count: apps.length,
        leaderboard,
        ...(focus_summary ? { focus_summary } : {}),
        studio_concentration: studioBoard(apps).slice(0, 5),
      });
    }),
  );

  server.registerTool(
    "keyword_matrix",
    {
      title: "Keyword × competitor matrix",
      description:
        "The competitive grid: for a set of keywords and a set of apps, where does every app " +
        "rank on every keyword? Up to 10 keywords × 10 apps; searches are paced ~3s apart, " +
        "so 10 keywords takes ~30s.",
      inputSchema: {
        keywords: z.array(z.string().min(1)).min(1).max(10),
        app_ids: z.array(z.string()).min(1).max(10).describe("Apple track ids"),
        country: z.string().default("US"),
      },
    },
    guard(async ({ keywords, app_ids, country }, extra) => {
      const c = normCountry(country);
      const names = await resolveApps(app_ids, c);
      const rows: { keyword: string; result_count: number; ranks: Record<string, number | null> }[] = [];
      for (const [i, keyword] of keywords.entries()) {
        await progress(extra, i, keywords.length, `searching "${keyword}"`);
        const apps = (await searchApps(keyword, c)).filter(isApp).map(normApp);
        const ranks: Record<string, number | null> = {};
        for (const id of app_ids) ranks[id] = findRank(apps, id);
        rows.push({ keyword, result_count: apps.length, ranks });
      }
      const summary = app_ids.map((id) => {
        const ranked = rows
          .map((r) => ({ keyword: r.keyword, rank: r.ranks[id] }))
          .filter((r): r is { keyword: string; rank: number } => r.rank != null);
        const best = ranked.sort((a, b) => a.rank - b.rank)[0] ?? null;
        return {
          id,
          name: names[id],
          ranked: ranked.length,
          of: rows.length,
          avg_rank: ranked.length
            ? Math.round(ranked.reduce((s, r) => s + r.rank, 0) / ranked.length)
            : null,
          best,
        };
      });
      return ok({ country: c, apps: names, rows, summary });
    }),
  );

  server.registerTool(
    "market_map",
    {
      title: "Market map for a keyword space",
      description:
        "One-call landscape of a keyword's market: top apps, which studios dominate, " +
        "free/paid mix, rating and concentration stats, genre mix, median app age.",
      inputSchema: {
        keyword: z.string().min(1),
        country: z.string().default("US"),
      },
    },
    guard(async ({ keyword, country }) => {
      const c = normCountry(country);
      const apps = (await searchApps(keyword, c)).filter(isApp).map(normApp);
      if (!apps.length) return fail(`No results for "${keyword}" in ${c}.`);
      return ok({
        keyword,
        country: c,
        result_count: apps.length,
        top_apps: apps.slice(0, 15).map((a, i) => rowOf(i + 1, a)),
        studios: studioBoard(apps),
        stats: marketStats(apps.slice(0, 100)),
      });
    }),
  );

  server.registerTool(
    "top_charts",
    {
      title: "Top charts",
      description:
        "Apple's top-free or top-paid apps chart for a storefront (from the public " +
        "marketing-tools feed; no rating data in this feed).",
      inputSchema: {
        country: z.string().default("US"),
        chart: z.enum(["top-free", "top-paid"]).default("top-free"),
        limit: z.number().int().min(1).max(100).default(25),
      },
    },
    guard(async ({ country, chart, limit }) => {
      const c = normCountry(country);
      const allowed = [10, 25, 50, 100] as const;
      const feedLimit = allowed.find((x) => x >= limit) ?? 100;
      const entries = await topChart(c, chart, feedLimit);
      return ok({
        country: c,
        chart,
        apps: entries.slice(0, limit).map((e: any, i: number) => ({
          rank: i + 1,
          id: e.id,
          name: e.name,
          studio: e.artistName,
          genre: e.genres?.[0]?.name ?? null,
          url: e.url,
        })),
      });
    }),
  );
}
