import { describe, it, expect } from "vitest";
import { delta, movement, type Snapshot } from "../src/movement.js";

const snap = (
  taken_at: string,
  ranks: Record<string, number | null>,
  top10: { id: string; name: string }[] = [],
): Snapshot => ({
  taken_at,
  keywords: [
    {
      keyword: "habit tracker",
      result_count: 180,
      ranks,
      top10: top10.map((t, i) => ({ rank: i + 1, id: t.id, name: t.name, studio: "s" })),
    },
  ],
});

describe("delta sign convention", () => {
  it("positive = moved toward #1", () => {
    expect(delta(9, 4)).toBe(5);
  });
  it("negative = slipped", () => {
    expect(delta(4, 9)).toBe(-5);
  });
  it("null when unranked on either side", () => {
    expect(delta(null, 4)).toBeNull();
    expect(delta(9, null)).toBeNull();
    expect(delta(undefined, 4)).toBeNull();
  });
});

describe("movement", () => {
  const apps = { a1: "Alpha", a2: "Beta" };

  it("computes series, latest deltas, best mover and biggest slip", () => {
    const snaps = [
      snap("2026-06-01T00:00:00Z", { a1: 12, a2: 3 }),
      snap("2026-06-08T00:00:00Z", { a1: 5, a2: 8 }),
    ];
    const m = movement(snaps, apps);
    expect(m.snapshots).toEqual(["2026-06-01", "2026-06-08"]);
    const kw = m.keywords[0];
    expect(kw.series.a1).toEqual([12, 5]);
    expect(kw.latest.a1).toEqual({ rank: 5, prev: 12, change: 7 });
    expect(kw.latest.a2).toEqual({ rank: 8, prev: 3, change: -5 });
    expect(m.best_mover).toMatchObject({ app_id: "a1", change: 7 });
    expect(m.biggest_slip).toMatchObject({ app_id: "a2", change: -5 });
  });

  it("handles apps falling out of ranking as null change", () => {
    const snaps = [
      snap("2026-06-01T00:00:00Z", { a1: 12, a2: 3 }),
      snap("2026-06-08T00:00:00Z", { a1: null, a2: 3 }),
    ];
    const m = movement(snaps, apps);
    expect(m.keywords[0].latest.a1).toEqual({ rank: null, prev: 12, change: null });
    expect(m.best_mover).toBeNull();
    expect(m.biggest_slip).toBeNull();
  });

  it("reports top-10 churn between the last two snapshots", () => {
    const snaps = [
      snap("2026-06-01T00:00:00Z", { a1: 1 }, [
        { id: "x", name: "Old Timer" },
        { id: "y", name: "Stalwart" },
      ]),
      snap("2026-06-08T00:00:00Z", { a1: 1 }, [
        { id: "y", name: "Stalwart" },
        { id: "z", name: "Newcomer" },
      ]),
    ];
    const m = movement(snaps, { a1: "Alpha" });
    expect(m.keywords[0].top10_entered).toEqual(["Newcomer"]);
    expect(m.keywords[0].top10_left).toEqual(["Old Timer"]);
  });

  it("windows to last_n snapshots", () => {
    const snaps = Array.from({ length: 12 }, (_, i) =>
      snap(`2026-04-${String(i + 1).padStart(2, "0")}T00:00:00Z`, { a1: 12 - i }),
    );
    const m = movement(snaps, { a1: "Alpha" }, 4);
    expect(m.snapshots).toHaveLength(4);
    expect(m.keywords[0].series.a1).toEqual([4, 3, 2, 1]);
  });
});
