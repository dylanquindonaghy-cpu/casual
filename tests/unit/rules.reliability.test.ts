import { describe, expect, it } from "vitest";
import { countsWords, reliabilityOf, reliabilityWords, standingOf } from "@/lib/rules/reliability";

// Reliability (Phase 26.7; cas-1, cas-2, aud-11; decision 3): worked ÷ (worked + no-shows + late
// cancellations) over 90 days, from 5 counted shifts, in bands; and the four standings.

const counts = (worked: number, noShows = 0, lateCancels = 0) => ({ worked, noShows, lateCancels });

describe("reliability", () => {
  it("a figure from 5 counted shifts, rounded down, in its band", () => {
    expect(reliabilityOf(counts(49, 1))).toMatchObject({
      kind: "figure",
      percent: 98,
      band: "green",
    });
    expect(reliabilityOf(counts(9, 1))).toMatchObject({ percent: 90, band: "green" });
    // 94.9% is 94%: never shown as reliable.
    expect(reliabilityOf(counts(94, 3, 2))).toMatchObject({ percent: 94 });
    expect(reliabilityOf(counts(3, 0, 1))).toMatchObject({ kind: "new" });
    expect(reliabilityOf(counts(3, 1, 0)).kind).toBe("new");
    expect(reliabilityOf(counts(4, 0, 1))).toMatchObject({ percent: 80, band: "amber" });
    expect(reliabilityOf(counts(3, 1, 1))).toMatchObject({ percent: 60, band: "red" });
    // No-shows and late cancellations count the same; worked alone is 100%.
    expect(reliabilityOf(counts(5))).toMatchObject({ percent: 100 });
    expect(reliabilityOf(counts(0, 2, 3))).toMatchObject({ percent: 0, band: "red" });
  });

  it("under 5: New, with how many so far; the counts always beside it", () => {
    const r = reliabilityOf(counts(3));
    expect(reliabilityWords(r)).toBe("New: 3 shifts so far");
    expect(reliabilityWords(reliabilityOf(counts(1)))).toBe("New: 1 shift so far");
    expect(reliabilityWords(reliabilityOf(counts(19, 1)))).toBe("95%");
    expect(countsWords(counts(19, 1, 0))).toBe("19 worked · 1 no-show · 0 late cancellations");
    expect(countsWords(counts(1, 2, 1))).toBe("1 worked · 2 no-shows · 1 late cancellation");
  });
});

describe("standing", () => {
  it("regular from 6 of 8 weeks; reliable from 95%; cancel often from 3; not worked in 60 days", () => {
    const good = reliabilityOf(counts(19, 1));
    expect(standingOf(good, 6, 3)).toEqual({
      regular: true,
      reliable: true,
      cancelOften: false,
      notWorkedLately: false,
    });
    expect(standingOf(good, 5, 60).regular).toBe(false);
    expect(standingOf(good, 5, 60).notWorkedLately).toBe(false);
    expect(standingOf(good, 5, 61).notWorkedLately).toBe(true);
    expect(standingOf(good, 0, null).notWorkedLately).toBe(true);
    expect(standingOf(reliabilityOf(counts(10, 0, 3)), 2, 1)).toMatchObject({
      reliable: false,
      cancelOften: true,
    });
    // New casuals are never "reliable" yet, whatever they've done.
    expect(standingOf(reliabilityOf(counts(4)), 4, 1).reliable).toBe(false);
  });
});
