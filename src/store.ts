import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Snapshot } from "./movement.js";

export interface Watchlist {
  name: string;
  country: string;
  focus_app_id: string | null;
  competitor_ids: string[];
  /** id -> display name, resolved when the watchlist is created */
  apps: Record<string, string>;
  keywords: string[];
  created_at: string;
  snapshots: Snapshot[];
}

const MAX_SNAPSHOTS = 52;

export function storeDir(): string {
  return process.env.APP_MARKET_MCP_DIR || path.join(os.homedir(), ".app-market-mcp");
}

const wlDir = () => path.join(storeDir(), "watchlists");

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const fileFor = (name: string) => path.join(wlDir(), `${slugify(name)}.json`);

export function listWatchlists(): Watchlist[] {
  if (!fs.existsSync(wlDir())) return [];
  const out: Watchlist[] = [];
  for (const f of fs.readdirSync(wlDir())) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(wlDir(), f), "utf8")));
    } catch {
      // unreadable file: skip rather than break every watchlist tool
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadWatchlist(name: string): Watchlist | null {
  const file = fileFor(name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveWatchlist(wl: Watchlist): void {
  fs.mkdirSync(wlDir(), { recursive: true });
  if (wl.snapshots.length > MAX_SNAPSHOTS) {
    wl.snapshots = wl.snapshots.slice(-MAX_SNAPSHOTS);
  }
  const file = fileFor(wl.name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(wl, null, 1));
  fs.renameSync(tmp, file);
}

export function deleteWatchlist(name: string): boolean {
  const file = fileFor(name);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
