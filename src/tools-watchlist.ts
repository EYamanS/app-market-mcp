import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchApps, normCountry } from "./itunes.js";
import { isApp, normApp } from "./normalize.js";
import { movement, delta, type KeywordSnapshot } from "./movement.js";
import {
  listWatchlists,
  loadWatchlist,
  saveWatchlist,
  deleteWatchlist,
  storeDir,
  type Watchlist,
} from "./store.js";
import { ok, fail, guard, progress, resolveApps, findRank } from "./shared.js";

export function registerWatchlistTools(server: McpServer): void {
  server.registerTool(
    "create_watchlist",
    {
      title: "Create a keyword watchlist",
      description:
        "Persist a named competitor set — focal app, rival apps, and the keywords that " +
        "matter — so snapshot_watchlist can record rankings over time and rank_movement " +
        "can report who's climbing. Stored locally as JSON.",
      inputSchema: {
        name: z.string().min(1),
        keywords: z.array(z.string().min(1)).min(1).max(25),
        country: z.string().default("US"),
        focus_app_id: z.string().optional().describe("Apple track id of your app"),
        competitor_ids: z.array(z.string()).max(15).optional(),
      },
    },
    guard(async ({ name, keywords, country, focus_app_id, competitor_ids }) => {
      const c = normCountry(country);
      if (loadWatchlist(name)) {
        return fail(`Watchlist "${name}" already exists. Delete it first or pick another name.`);
      }
      const ids = [...new Set([focus_app_id, ...(competitor_ids ?? [])].filter(
        (x): x is string => Boolean(x),
      ))];
      const apps = await resolveApps(ids, c);
      const wl: Watchlist = {
        name,
        country: c,
        focus_app_id: focus_app_id ?? null,
        competitor_ids: competitor_ids ?? [],
        apps,
        keywords: [...new Set(keywords)],
        created_at: new Date().toISOString(),
        snapshots: [],
      };
      saveWatchlist(wl);
      return ok({
        created: name,
        country: c,
        keywords: wl.keywords.length,
        tracked_apps: apps,
        stored_in: storeDir(),
        hint:
          `Run snapshot_watchlist("${name}") to take the first snapshot ` +
          `(~${wl.keywords.length * 3}s: one paced search per keyword).`,
      });
    }),
  );

  server.registerTool(
    "list_watchlists",
    {
      title: "List watchlists",
      description: "All saved watchlists with keyword/app/snapshot counts.",
      inputSchema: {},
    },
    guard(async () => {
      const lists = listWatchlists().map((w) => ({
        name: w.name,
        country: w.country,
        keywords: w.keywords.length,
        tracked_apps: Object.keys(w.apps).length,
        snapshots: w.snapshots.length,
        last_snapshot: w.snapshots.at(-1)?.taken_at ?? null,
      }));
      return ok({ watchlists: lists, stored_in: storeDir() });
    }),
  );

  server.registerTool(
    "snapshot_watchlist",
    {
      title: "Snapshot a watchlist",
      description:
        "Collect current rankings for every keyword in a watchlist and store a dated " +
        "snapshot. Takes ~3s per keyword. Returns movement vs the previous snapshot.",
      inputSchema: { name: z.string().min(1) },
    },
    guard(async ({ name }, extra) => {
      const wl = loadWatchlist(name);
      if (!wl) return fail(`No watchlist named "${name}". Use list_watchlists.`);
      const ids = Object.keys(wl.apps);
      const prev = wl.snapshots.at(-1) ?? null;

      const keywords: KeywordSnapshot[] = [];
      for (const [i, keyword] of wl.keywords.entries()) {
        await progress(extra, i, wl.keywords.length, `searching "${keyword}"`);
        const apps = (await searchApps(keyword, wl.country)).filter(isApp).map(normApp);
        const ranks: Record<string, number | null> = {};
        for (const id of ids) ranks[id] = findRank(apps, id);
        keywords.push({
          keyword,
          result_count: apps.length,
          ranks,
          top10: apps.slice(0, 10).map((a, j) => ({
            rank: j + 1,
            id: a.id,
            name: a.name,
            studio: a.studio,
          })),
        });
      }

      const snapshot = { taken_at: new Date().toISOString(), keywords };
      wl.snapshots.push(snapshot);
      saveWatchlist(wl);

      const focusLines = wl.focus_app_id
        ? keywords.map((k) => {
            const rank = k.ranks[wl.focus_app_id!];
            const p = prev?.keywords.find((x) => x.keyword === k.keyword)?.ranks?.[
              wl.focus_app_id!
            ];
            return { keyword: k.keyword, rank, change: delta(p ?? null, rank) };
          })
        : null;

      const move =
        prev && ids.length ? movement([prev, snapshot], wl.apps, 2) : null;

      return ok({
        watchlist: name,
        taken_at: snapshot.taken_at,
        snapshot_count: wl.snapshots.length,
        ...(focusLines ? { focus: focusLines } : {}),
        ...(move
          ? { best_mover: move.best_mover, biggest_slip: move.biggest_slip }
          : { note: "First snapshot recorded — movement appears from the second one." }),
      });
    }),
  );

  server.registerTool(
    "rank_movement",
    {
      title: "Rank movement report",
      description:
        "Movement across a watchlist's stored snapshots: per-keyword rank series for every " +
        "tracked app, latest deltas (positive = climbed toward #1), best mover, biggest " +
        "slip, and top-10 churn. Reads local snapshots only — no network calls.",
      inputSchema: {
        name: z.string().min(1),
        last_n: z.number().int().min(2).max(52).default(8),
      },
    },
    guard(async ({ name, last_n }) => {
      const wl = loadWatchlist(name);
      if (!wl) return fail(`No watchlist named "${name}". Use list_watchlists.`);
      if (!wl.snapshots.length) {
        return fail(`Watchlist "${name}" has no snapshots yet. Run snapshot_watchlist first.`);
      }
      if (wl.snapshots.length === 1) {
        return ok({
          watchlist: name,
          note: "Only one snapshot exists — deltas need at least two. Latest ranks below.",
          snapshot: wl.snapshots[0],
        });
      }
      return ok({ watchlist: name, country: wl.country, ...movement(wl.snapshots, wl.apps, last_n) });
    }),
  );

  server.registerTool(
    "delete_watchlist",
    {
      title: "Delete a watchlist",
      description: "Delete a saved watchlist and all its snapshots. Irreversible.",
      inputSchema: { name: z.string().min(1) },
    },
    guard(async ({ name }) => {
      if (!deleteWatchlist(name)) return fail(`No watchlist named "${name}".`);
      return ok({ deleted: name });
    }),
  );
}
