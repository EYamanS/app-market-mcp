import type { AppInfo } from "./normalize.js";

export interface StudioSlot {
  studio: string;
  studio_id: string | null;
  apps_in_top: number;
  best_rank: number;
  total_ratings: number;
  examples: string[];
}

/** Which studios occupy the top N slots of a search result list. */
export function studioBoard(apps: AppInfo[], slots = 50): StudioSlot[] {
  const top = apps.slice(0, slots);
  const map = new Map<string, StudioSlot>();
  top.forEach((a, i) => {
    const key = a.studio_id ?? a.studio;
    const e =
      map.get(key) ??
      {
        studio: a.studio,
        studio_id: a.studio_id,
        apps_in_top: 0,
        best_rank: i + 1,
        total_ratings: 0,
        examples: [],
      };
    e.apps_in_top += 1;
    e.best_rank = Math.min(e.best_rank, i + 1);
    e.total_ratings += a.ratings_count ?? 0;
    if (e.examples.length < 3) e.examples.push(a.name);
    map.set(key, e);
  });
  return [...map.values()]
    .sort((x, y) => y.apps_in_top - x.apps_in_top || x.best_rank - y.best_rank)
    .slice(0, 10);
}

export function marketStats(apps: AppInfo[], now = Date.now()) {
  const n = apps.length || 1;
  const free = apps.filter((a) => a.free).length;
  const ratings = apps
    .map((a) => a.rating)
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  const counts = apps.map((a) => a.ratings_count ?? 0);
  const total = counts.reduce((s, x) => s + x, 0);
  const top10 = [...counts].sort((a, b) => b - a).slice(0, 10).reduce((s, x) => s + x, 0);
  const years = apps
    .map((a) => (a.released ? (now - Date.parse(a.released)) / 31_557_600_000 : null))
    .filter((x): x is number => x != null && Number.isFinite(x))
    .sort((a, b) => a - b);
  const med = (xs: number[]) => (xs.length ? xs[Math.floor(xs.length / 2)] : null);
  const genreCount: Record<string, number> = {};
  for (const a of apps) if (a.genre) genreCount[a.genre] = (genreCount[a.genre] ?? 0) + 1;
  const genre_mix = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, count]) => ({ genre, count }));

  const medAge = med(years);
  return {
    apps_analyzed: apps.length,
    free_share: Math.round((free / n) * 100) / 100,
    median_rating: med(ratings),
    total_ratings: total,
    // share of all ratings held by the 10 most-rated apps: crude concentration proxy
    ratings_top10_share: total ? Math.round((top10 / total) * 100) / 100 : null,
    median_age_years: medAge != null ? Math.round(medAge * 10) / 10 : null,
    genre_mix,
  };
}

const STOP = new Set([
  "the", "and", "for", "with", "your", "app", "apps", "pro", "free", "lite", "plus",
]);

/** Derive up to 4 search probes from an app's title and genre. */
export function probeTerms(focal: AppInfo): string[] {
  const probes: string[] = [];
  const base = focal.name.split(/[:\-–—|(]/)[0].trim().toLowerCase();
  if (base) probes.push(base);
  const tokens = base.split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
  if (focal.genre) {
    const genre = focal.genre.toLowerCase();
    probes.push(genre);
    if (tokens.length) probes.push(`${tokens[tokens.length - 1]} ${genre}`);
  }
  if (tokens.length >= 2) probes.push(tokens.slice(-2).join(" "));
  return [...new Set(probes.filter((p) => p.length >= 3))].slice(0, 4);
}

export interface Probe {
  term: string;
  apps: AppInfo[];
}

/**
 * Score competitor candidates by how often (and how high) they appear across
 * search probes. Apps from the focal studio are excluded; sharing the focal
 * app's primary genre earns a small bonus.
 */
export function scoreCompetitors(probes: Probe[], focal: AppInfo, limit = 10) {
  const cand = new Map<
    string,
    { app: AppInfo; score: number; matched: Set<string>; bestRank: number }
  >();
  for (const probe of probes) {
    probe.apps.slice(0, 50).forEach((a, i) => {
      if (a.id === focal.id) return;
      if (focal.studio_id && a.studio_id === focal.studio_id) return;
      const e =
        cand.get(a.id) ??
        { app: a, score: 0, matched: new Set<string>(), bestRank: i + 1 };
      e.score += (50 - i) / 50;
      e.matched.add(probe.term);
      e.bestRank = Math.min(e.bestRank, i + 1);
      cand.set(a.id, e);
    });
  }
  for (const e of cand.values()) {
    if (focal.genre && e.app.genre === focal.genre) e.score += 0.5;
  }
  return [...cand.values()]
    .sort((x, y) => y.score - x.score || x.bestRank - y.bestRank)
    .slice(0, limit)
    .map((e) => ({
      id: e.app.id,
      name: e.app.name,
      studio: e.app.studio,
      genre: e.app.genre,
      rating: e.app.rating,
      ratings_count: e.app.ratings_count,
      score: Math.round(e.score * 100) / 100,
      matched_probes: [...e.matched],
    }));
}
