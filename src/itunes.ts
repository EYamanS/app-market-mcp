/**
 * Thin client for Apple's public iTunes / App Store endpoints.
 *
 * /search is soft rate-limited (roughly 20 req/min/IP), so search calls are
 * spaced ~3s apart. /lookup tolerates a much faster pace. Everything gets
 * retry with exponential backoff + jitter on 429/5xx/network errors.
 */

const SEARCH_INTERVAL_MS = 3000;
const LOOKUP_INTERVAL_MS = 600;

class Throttle {
  private next = 0;
  constructor(private readonly intervalMs: number) {}

  /** Reserve the next available slot and wait until it arrives. */
  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

const searchThrottle = new Throttle(SEARCH_INTERVAL_MS);
const lookupThrottle = new Throttle(LOOKUP_INTERVAL_MS);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string, tries = 3): Promise<any> {
  let delay = 1000;
  for (let attempt = 1; ; attempt++) {
    let retryable = false;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) return await res.json();
      retryable = res.status === 429 || res.status >= 500;
      throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    } catch (err) {
      if (err instanceof TypeError) retryable = true; // fetch network-level failure
      if (!retryable || attempt >= tries) throw err;
      await sleep(delay + Math.random() * 400);
      delay *= 2;
    }
  }
}

export function normCountry(country: string | undefined): string {
  const c = (country ?? "US").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) {
    throw new Error(`country must be an ISO-2 storefront code (e.g. US, TR, DE), got "${country}"`);
  }
  return c;
}

/** Search-rank-ordered software results for a term in a storefront (max 200). */
export async function searchApps(
  term: string,
  country: string,
  limit = 200,
  attribute?: string,
): Promise<any[]> {
  await searchThrottle.wait();
  const params = new URLSearchParams({
    term,
    country,
    media: "software",
    entity: "software",
    limit: String(Math.min(Math.max(limit, 1), 200)),
  });
  if (attribute) params.set("attribute", attribute);
  const data = await fetchJson(`https://itunes.apple.com/search?${params}`);
  return data.results ?? [];
}

/**
 * Lookup by Apple track id(s) (comma-separated ok), bundle id, or artist id.
 * With an artist id + entity=software the response is the artist record
 * followed by their app portfolio.
 */
export async function lookup(opts: {
  id?: string;
  bundleId?: string;
  country: string;
  entity?: string;
  limit?: number;
}): Promise<any[]> {
  await lookupThrottle.wait();
  const params = new URLSearchParams({ country: opts.country });
  if (opts.id) params.set("id", opts.id);
  if (opts.bundleId) params.set("bundleId", opts.bundleId);
  if (opts.entity) params.set("entity", opts.entity);
  if (opts.limit) params.set("limit", String(opts.limit));
  const data = await fetchJson(`https://itunes.apple.com/lookup?${params}`);
  return data.results ?? [];
}

/** Top charts from Apple's public marketing-tools feed. No rating data in this feed. */
export async function topChart(
  country: string,
  feed: "top-free" | "top-paid",
  limit: 10 | 25 | 50 | 100,
): Promise<any[]> {
  const url = `https://rss.marketingtools.apple.com/api/v2/${country.toLowerCase()}/apps/${feed}/${limit}/apps.json`;
  const data = await fetchJson(url);
  return data.feed?.results ?? [];
}
