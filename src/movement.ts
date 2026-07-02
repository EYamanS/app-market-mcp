export interface Top10Row {
  rank: number;
  id: string;
  name: string;
  studio: string;
}

export interface KeywordSnapshot {
  keyword: string;
  result_count: number;
  /** rank of each tracked app id in this keyword's results, null = unranked */
  ranks: Record<string, number | null>;
  top10: Top10Row[];
}

export interface Snapshot {
  taken_at: string;
  keywords: KeywordSnapshot[];
}

/**
 * rank_change = previous_rank - rank. POSITIVE = moved toward #1 (improved),
 * NEGATIVE = slipped, null = unranked on either side.
 */
export function delta(
  prev: number | null | undefined,
  curr: number | null | undefined,
): number | null {
  if (prev == null || curr == null) return null;
  return prev - curr;
}

interface Mover {
  keyword: string;
  app_id: string;
  app: string;
  change: number;
}

export function movement(
  snapshots: Snapshot[],
  apps: Record<string, string>,
  lastN = 8,
) {
  const win = snapshots.slice(-Math.max(2, lastN));
  const labels = win.map((s) => s.taken_at.slice(0, 10));
  const ids = Object.keys(apps);
  const latest = win[win.length - 1];
  const prev = win.length > 1 ? win[win.length - 2] : null;

  let bestMover: Mover | null = null;
  let biggestSlip: Mover | null = null;

  const keywords = latest.keywords.map((ks) => {
    const series: Record<string, (number | null)[]> = {};
    for (const id of ids) {
      series[id] = win.map(
        (s) => s.keywords.find((k) => k.keyword === ks.keyword)?.ranks?.[id] ?? null,
      );
    }
    const prevKs = prev?.keywords.find((k) => k.keyword === ks.keyword) ?? null;
    const latestInfo: Record<
      string,
      { rank: number | null; prev: number | null; change: number | null }
    > = {};
    for (const id of ids) {
      const rank = ks.ranks[id] ?? null;
      const p = prevKs?.ranks?.[id] ?? null;
      const change = delta(p, rank);
      latestInfo[id] = { rank, prev: p, change };
      if (change != null && change > 0 && (!bestMover || change > bestMover.change)) {
        bestMover = { keyword: ks.keyword, app_id: id, app: apps[id], change };
      }
      if (change != null && change < 0 && (!biggestSlip || change < biggestSlip.change)) {
        biggestSlip = { keyword: ks.keyword, app_id: id, app: apps[id], change };
      }
    }
    const prevTop = new Set((prevKs?.top10 ?? []).map((t) => t.id));
    const currTop = new Set(ks.top10.map((t) => t.id));
    const top10_entered = prevKs
      ? ks.top10.filter((t) => !prevTop.has(t.id)).map((t) => t.name)
      : [];
    const top10_left = prevKs
      ? prevKs.top10.filter((t) => !currTop.has(t.id)).map((t) => t.name)
      : [];
    return { keyword: ks.keyword, series, latest: latestInfo, top10_entered, top10_left };
  });

  return {
    snapshots: labels,
    apps,
    keywords,
    best_mover: bestMover,
    biggest_slip: biggestSlip,
  };
}
