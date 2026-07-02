import { z } from "zod";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMarketTools } from "./tools-market.js";
import { registerStudioTools } from "./tools-studio.js";
import { registerWatchlistTools } from "./tools-watchlist.js";
import { listWatchlists, loadWatchlist, slugify } from "./store.js";

export function buildServer(): McpServer {
  const server = new McpServer({ name: "app-market-mcp", version: "0.1.0" });

  registerMarketTools(server);
  registerStudioTools(server);
  registerWatchlistTools(server);

  server.registerPrompt(
    "market-scan",
    {
      title: "Market scan",
      description: "Full landscape read of a keyword space: market map, dominant studios, share of search.",
      argsSchema: {
        keyword: z.string().describe("Keyword space to scan, e.g. 'sleep tracker'"),
        country: z.string().optional().describe("ISO-2 storefront, default US"),
      },
    },
    ({ keyword, country }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Run a market scan for "${keyword}" in the ${country || "US"} App Store storefront:\n` +
              `1. market_map to get the landscape (top apps, studios, stats).\n` +
              `2. studio_profile on the top 2 studios by presence.\n` +
              `3. share_of_search on the keyword for the full leaderboard.\n` +
              `Then summarize: who dominates, how concentrated the space is, free vs paid mix, ` +
              `and any weak incumbents (high rank but low rating or stale updates) that look displaceable.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "keyword-battle",
    {
      title: "Keyword battle",
      description: "Head-to-head keyword comparison of two apps with a rank matrix.",
      argsSchema: {
        app_a: z.string().describe("Apple track id of the first app"),
        app_b: z.string().describe("Apple track id of the second app"),
        country: z.string().optional().describe("ISO-2 storefront, default US"),
      },
    },
    ({ app_a, app_b, country }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Compare apps ${app_a} and ${app_b} head-to-head in the ${country || "US"} storefront:\n` +
              `1. app_profile on both.\n` +
              `2. Derive 6-8 keywords both plausibly target from their names, genres, and descriptions.\n` +
              `3. keyword_matrix with those keywords and both app ids.\n` +
              `Report who wins where, keywords only one of them ranks on (the gaps), and which ` +
              `gaps look winnable.`,
          },
        },
      ],
    }),
  );

  server.registerResource(
    "watchlist",
    new ResourceTemplate("watchlist://{name}", {
      list: async () => ({
        resources: listWatchlists().map((w) => ({
          uri: `watchlist://${slugify(w.name)}`,
          name: w.name,
          description: `${w.keywords.length} keywords · ${Object.keys(w.apps).length} apps · ${w.snapshots.length} snapshots · ${w.country}`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Keyword watchlists",
      description: "Saved competitor watchlists with their latest snapshot",
    },
    async (uri, { name }) => {
      const wl = loadWatchlist(String(name));
      if (!wl) throw new Error(`No watchlist "${name}"`);
      const { snapshots, ...meta } = wl;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              { ...meta, snapshot_count: snapshots.length, latest: snapshots.at(-1) ?? null },
              null,
              1,
            ),
          },
        ],
      };
    },
  );

  return server;
}
