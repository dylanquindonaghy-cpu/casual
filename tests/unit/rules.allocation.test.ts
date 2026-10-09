import { describe, expect, it } from "vitest";
import { allocationGate, fairRotationCutoff, rankForFairRotation } from "@/lib/rules/allocation";

// Allocation mode (docs/api-and-jobs.md, "Offer-wave ranking"): first come, first served, or fair
// rotation (fewest hours this week first). Pure functions, checked as a table.

const at = (iso: string) => new Date(iso);
const OPENED = at("2026-11-02T09:00:00Z");
const gate = (o: Partial<Parameters<typeof allocationGate>[0]> = {}) =>
  allocationGate({
    mode: "fair_rotation",
    now: at("2026-11-02T09:05:00Z"),
    openedAt: OPENED,
    priorityMinutes: 15,
    workerHours: 20,
    cutoffHours: 8,
    ...o,
  });

describe("fairRotationCutoff", () => {
  it("is the hours of the k-th fewest, so ties with it are in the group", () => {
    expect(fairRotationCutoff([30, 0, 8, 20, 8], 2)).toBe(8);
    expect(fairRotationCutoff([30, 0, 8, 20, 8], 1)).toBe(0);
    expect(fairRotationCutoff([30, 0, 8, 20, 8], 3)).toBe(8); // both 8s are in
    expect(fairRotationCutoff([5, 9], 4)).toBe(9); // fewer people than the group: everyone
    expect(fairRotationCutoff([], 4)).toBeNull();
    expect(fairRotationCutoff([1, 2], 0)).toBeNull();
  });
});

describe("allocationGate", () => {
  it("first come, first served never holds anything", () => {
    expect(gate({ mode: "first_come_first_served" })).toEqual({ ok: true });
  });

  it("fair rotation holds a newly opened place for the fewest hours until the window ends", () => {
    expect(gate()).toEqual({ ok: false, opensAt: at("2026-11-02T09:15:00Z") });
    expect(gate({ workerHours: 8 })).toEqual({ ok: true }); // at the cutoff: in the group
    expect(gate({ workerHours: 0 })).toEqual({ ok: true });
    expect(gate({ now: at("2026-11-02T09:14:59Z") }).ok).toBe(false);
    expect(gate({ now: at("2026-11-02T09:15:00Z") })).toEqual({ ok: true }); // open to all
    expect(gate({ cutoffHours: null })).toEqual({ ok: true }); // nobody else to wait for
  });
});

describe("rankForFairRotation", () => {
  it("orders by fewest hours, then longest since last offered (never first), then id", () => {
    const ranked = rankForFairRotation([
      { workerId: "c", hoursThisWeek: 8, lastOfferedAt: null },
      { workerId: "a", hoursThisWeek: 8, lastOfferedAt: at("2026-11-01T09:00:00Z") },
      { workerId: "d", hoursThisWeek: 0, lastOfferedAt: at("2026-11-02T08:00:00Z") },
      { workerId: "b", hoursThisWeek: 8, lastOfferedAt: at("2026-10-31T09:00:00Z") },
      { workerId: "e", hoursThisWeek: 8, lastOfferedAt: null },
    ]);
    expect(ranked.map((c) => c.workerId)).toEqual(["d", "c", "e", "b", "a"]);
  });
});
