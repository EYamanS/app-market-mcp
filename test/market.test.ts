import { describe, it, expect } from "vitest";
import { studioBoard, marketStats, probeTerms, scoreCompetitors } from "../src/market.js";
import type { AppInfo } from "../src/normalize.js";

const app = (over: Partial<AppInfo>): AppInfo => ({
  id: "0",
  name: "App",
  studio: "Studio",
  studio_id: null,
  bundle_id: "com.x",
  price: 0,
  currency: "USD",
  free: true,
  rating: 4.5,
  ratings_count: 100,
  genre: "Health & Fitness",
  genres: [],
  released: "2024-01-01",
  updated: "2026-06-01",
  version: "1.0",
  url: null,
  ...over,
});

describe("studioBoard", () => {
  it("groups slots by studio and ranks by presence then best rank", () => {
    const apps = [
      app({ id: "1", studio: "Big Co", studio_id: "s1" }),
      app({ id: "2", studio: "Small Co", studio_id: "s2" }),
      app({ id: "3", studio: "Big Co", studio_id: "s1" }),
    ];
    const board = studioBoard(apps);
    expect(board[0]).toMatchObject({ studio: "Big Co", apps_in_top: 2, best_rank: 1 });
    expect(board[1]).toMatchObject({ studio: "Small Co", apps_in_top: 1, best_rank: 2 });
  });
});

describe("marketStats", () => {
  it("computes free share, medians, and concentration", () => {
    const apps = [
      app({ id: "1", free: true, rating: 4.0, ratings_count: 900 }),
      app({ id: "2", free: true, rating: 4.5, ratings_count: 50 }),
      app({ id: "3", free: false, price: 4.99, rating: 5.0, ratings_count: 50 }),
    ];
    const s = marketStats(apps, Date.parse("2026-07-01"));
    expect(s.apps_analyzed).toBe(3);
    expect(s.free_share).toBe(0.67);
    expect(s.median_rating).toBe(4.5);
    expect(s.total_ratings).toBe(1000);
    expect(s.ratings_top10_share).toBe(1);
    expect(s.median_age_years).toBe(2.5);
    expect(s.genre_mix[0]).toEqual({ genre: "Health & Fitness", count: 3 });
  });
});

describe("probeTerms", () => {
  it("derives probes from title base and genre", () => {
    const probes = probeTerms(
      app({ name: "Sleepy: Sleep Tracker & Sounds", genre: "Health & Fitness" }),
    );
    expect(probes[0]).toBe("sleepy");
    expect(probes).toContain("health & fitness");
    expect(probes.length).toBeLessThanOrEqual(4);
  });

  it("drops stopwords and short tokens", () => {
    const probes = probeTerms(app({ name: "The Habit Tracker App", genre: null }));
    expect(probes).toContain("the habit tracker app");
    expect(probes).toContain("habit tracker");
  });
});

describe("scoreCompetitors", () => {
  const focal = app({ id: "f", name: "Focal", studio_id: "sf", genre: "Games" });

  it("excludes the focal app and its studio, rewards co-occurrence", () => {
    const rival = app({ id: "r", studio_id: "sr", genre: "Games" });
    const sibling = app({ id: "sib", studio_id: "sf" });
    const once = app({ id: "o", studio_id: "so", genre: "Games" });
    const scored = scoreCompetitors(
      [
        { term: "t1", apps: [focal, rival, sibling, once] },
        { term: "t2", apps: [rival] },
      ],
      focal,
    );
    const ids = scored.map((s) => s.id);
    expect(ids).not.toContain("f");
    expect(ids).not.toContain("sib");
    expect(ids[0]).toBe("r");
    expect(scored[0].matched_probes).toEqual(["t1", "t2"]);
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });
});
