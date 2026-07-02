export interface AppInfo {
  id: string;
  name: string;
  studio: string;
  studio_id: string | null;
  bundle_id: string;
  price: number | null;
  currency: string | null;
  free: boolean;
  rating: number | null;
  ratings_count: number | null;
  genre: string | null;
  genres: string[];
  released: string | null;
  updated: string | null;
  version: string | null;
  url: string | null;
}

const day = (iso: unknown): string | null =>
  typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : null;

export const isApp = (r: any): boolean =>
  r?.wrapperType === "software" && r?.trackId != null;

export function normApp(r: any): AppInfo {
  return {
    id: String(r.trackId),
    name: r.trackName ?? "",
    studio: r.sellerName || r.artistName || "",
    studio_id: r.artistId != null ? String(r.artistId) : null,
    bundle_id: r.bundleId ?? "",
    price: typeof r.price === "number" ? r.price : null,
    currency: r.currency ?? null,
    free: r.price === 0,
    rating:
      typeof r.averageUserRating === "number"
        ? Math.round(r.averageUserRating * 100) / 100
        : null,
    ratings_count: typeof r.userRatingCount === "number" ? r.userRatingCount : null,
    genre: r.primaryGenreName ?? null,
    genres: Array.isArray(r.genres) ? r.genres : [],
    released: day(r.releaseDate),
    updated: day(r.currentVersionReleaseDate),
    version: r.version ?? null,
    url: r.trackViewUrl ?? null,
  };
}

/** Compact leaderboard row — keeps tool output token-light. */
export function rowOf(rank: number, a: AppInfo) {
  return {
    rank,
    id: a.id,
    name: a.name,
    studio: a.studio,
    rating: a.rating,
    ratings_count: a.ratings_count,
  };
}
