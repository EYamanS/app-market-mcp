# app-market-mcp

[![Buy me a coffee](https://img.shields.io/badge/%E2%98%95%20Buy%20me%20a%20coffee-support-FF813F)](https://buy.polar.sh/polar_cl_v4ZIuYffdbN9E9iVLmlHh1W5sxAmxvqNVqIn81048FX)

**ASO tools tell you about your app. This one tells you about the market.**

An MCP server for App Store market intelligence: competitor sets, studios, share-of-search,
and rank movement over time. Built on Apple's public endpoints — no API keys, no accounts,
no scraping.

```bash
npx app-market-mcp
```

## Why another App Store MCP?

Existing App Store MCP servers are single-app ASO optimizers: *how does my app rank, what
keywords should I add.* They're good at that. This server covers the layer they don't —
**market-level questions across sets of apps and studios**:

- *Who owns the "sleep tracker" keyword space in the US?* → `share_of_search`
- *Where do we and our five competitors rank across our ten keywords?* → `keyword_matrix`
- *Map the meditation app market in Germany.* → `market_map`
- *What has this studio shipped in the last six months?* → `studio_releases`
- *Who's climbing on our keywords since last month?* → watchlists + `rank_movement`

The intended user is anyone doing competitive analysis, market research, BD scouting, or
portfolio tracking — not just developers optimizing their own listing.

## Quick start

**Claude Code**

```bash
claude mcp add -s user app-market -- npx app-market-mcp
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "app-market": {
      "command": "npx",
      "args": ["app-market-mcp"]
    }
  }
}
```

Any MCP client with stdio transport works (Cursor, Windsurf, etc.).

## Tools

### Market

| Tool | What it answers |
|---|---|
| `search_apps` | Raw App Store search results for a term, in rank order |
| `app_profile` | Full metadata for one app (by track id or bundle id) |
| `share_of_search` | Top-50 leaderboard for a keyword + which studios hold the slots; flags your app and rivals |
| `keyword_matrix` | The grid: N keywords × M apps, who ranks where (≤10×10) |
| `market_map` | One-call landscape: top apps, dominant studios, free/paid mix, concentration, median age |
| `top_charts` | Apple's top-free / top-paid chart for any storefront |

### Studios

| Tool | What it answers |
|---|---|
| `studio_profile` | A developer's full portfolio with totals (by artist id or name search) |
| `studio_releases` | New apps + updates a studio shipped in the last N months |
| `suggest_competitors` | Likely competitors for an app, scored from its search neighborhood |

### Watchlists (local, stateful)

| Tool | What it answers |
|---|---|
| `create_watchlist` | Save a named competitor set: focal app + rivals + keywords + storefront |
| `snapshot_watchlist` | Record current rankings for every keyword in the set |
| `rank_movement` | Who climbed, who slipped, top-10 churn — across stored snapshots |
| `list_watchlists` / `delete_watchlist` | Manage saved sets |

Watchlists are plain JSON in `~/.app-market-mcp/` (override with `APP_MARKET_MCP_DIR`).
Snapshot whenever you like — daily, weekly, before/after an ASO push — and `rank_movement`
turns the snapshots into movement reports. Rank change is `previous_rank − rank`:
**positive = climbed toward #1**.

### Prompts

Two bundled workflows show the composite moves: `market-scan` (keyword → full landscape
read) and `keyword-battle` (two apps → head-to-head matrix). Saved watchlists are also
exposed as `watchlist://` resources.

## Example

`share_of_search` with `{"keyword": "habit tracker", "focus_app_id": "…"}` returns:

```json
{
 "keyword": "habit tracker",
 "country": "US",
 "result_count": 200,
 "leaderboard": [
  { "rank": 1, "id": "1", "name": "Habitica", "studio": "HabitRPG Inc", "rating": 4.7, "ratings_count": 84210 },
  { "rank": 2, "id": "2", "name": "Streaks", "studio": "Crunchy Bagel", "rating": 4.8, "ratings_count": 31544 }
 ],
 "focus_summary": { "rank": 7, "rivals_above": 2, "rivals_below": 1, "unranked_rivals": [] },
 "studio_concentration": [
  { "studio": "HabitRPG Inc", "apps_in_top": 2, "best_rank": 1, "total_ratings": 91000, "examples": ["Habitica", "…"] }
 ]
}
```

## Data source, pacing, and honesty

- Everything comes from Apple's **public iTunes Search/Lookup APIs** and the public
  marketing-tools RSS feeds. No private APIs, no store scraping, no credentials.
- Apple soft-limits the search endpoint to roughly **20 requests/min/IP**. The server paces
  search calls ~3s apart internally, so multi-keyword tools take time by design
  (`keyword_matrix` with 10 keywords ≈ 30s) and report progress while they run. Slow and
  reliable beats fast and rate-limited.
- Search responses cap at 200 results, so "unranked" means "not in the top 200."
- Rankings vary by storefront; every tool takes an ISO-2 `country`.
- Not affiliated with or endorsed by Apple.

## Roadmap

- Google Play module (via community scraper libraries, off by default)
- `chart_movers`: top-charts diffing from chart snapshots
- Keyword suggestion probes from search autocomplete
- Hosted streamable-HTTP transport

## Development

```bash
npm install
npm run build
npm test        # unit tests (no network)
npm run smoke   # boots the server and runs one live search
```

PRs welcome — especially additional storefront quirks, new market-level tools, and
Google Play groundwork.

## Support

Built this in the open. If it saved you time, a one-off tip keeps it maintained:

[![Buy me a coffee](https://img.shields.io/badge/%E2%98%95%20Buy%20me%20a%20coffee-support%20this%20project-FF813F?style=for-the-badge)](https://buy.polar.sh/polar_cl_v4ZIuYffdbN9E9iVLmlHh1W5sxAmxvqNVqIn81048FX)

## License

MIT
