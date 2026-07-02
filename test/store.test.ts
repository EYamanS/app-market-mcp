import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-market-mcp-test-"));
process.env.APP_MARKET_MCP_DIR = tmp;

const { listWatchlists, loadWatchlist, saveWatchlist, deleteWatchlist, slugify } =
  await import("../src/store.js");

const wl = (name: string) => ({
  name,
  country: "US",
  focus_app_id: null,
  competitor_ids: [],
  apps: {},
  keywords: ["habit tracker"],
  created_at: "2026-07-01T00:00:00Z",
  snapshots: [] as any[],
});

beforeEach(() => {
  fs.rmSync(path.join(tmp, "watchlists"), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("store", () => {
  it("slugifies names for filenames", () => {
    expect(slugify("Sleep Apps — US!")).toBe("sleep-apps-us");
  });

  it("round-trips save/load/list/delete", () => {
    saveWatchlist(wl("My List"));
    expect(loadWatchlist("My List")?.country).toBe("US");
    expect(loadWatchlist("my list")?.name).toBe("My List"); // slug match
    expect(listWatchlists()).toHaveLength(1);
    expect(deleteWatchlist("My List")).toBe(true);
    expect(loadWatchlist("My List")).toBeNull();
    expect(deleteWatchlist("My List")).toBe(false);
  });

  it("caps stored snapshots at 52, keeping the newest", () => {
    const w = wl("Big");
    w.snapshots = Array.from({ length: 60 }, (_, i) => ({
      taken_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
      keywords: [],
    }));
    saveWatchlist(w);
    const loaded = loadWatchlist("Big")!;
    expect(loaded.snapshots).toHaveLength(52);
    expect(loaded.snapshots[0].taken_at).toContain(":08");
  });
});
