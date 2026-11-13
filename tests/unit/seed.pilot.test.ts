import { describe, expect, it } from "vitest";
import { acmePilotFigures } from "@/lib/db/admin/seed-pilot";
import { BASELINE_KEYS, BASELINE_METRICS, TALLY_KEYS } from "@/lib/metrics/definitions";

// The demo's pilot figures (src/lib/db/admin/seed-pilot.ts; Phase 37.8): a baseline and four
// weekly tallies, as the office would save them.

describe("acmePilotFigures", () => {
  const now = new Date("2026-11-11T12:00:00Z"); // a Wednesday
  const saves = acmePilotFigures(now, "admin-id");

  it("one baseline week with all 8 figures, 5 Mondays back", () => {
    const baseline = saves.filter((s) => s.kind === "baseline");
    expect(baseline).toHaveLength(1);
    expect(baseline[0]?.weekStart).toBe("2026-10-05");
    expect(baseline[0]?.figures.map((f) => f.metric).sort()).toEqual([...BASELINE_KEYS].sort());
  });

  it("4 Monday tallies since, of the tally figures, within range and falling", () => {
    const tallies = saves.filter((s) => s.kind === "tally");
    expect(tallies.map((t) => t.weekStart)).toEqual([
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
    ]);
    for (const t of tallies) {
      expect(t.figures.map((f) => f.metric).sort()).toEqual([...TALLY_KEYS].sort());
      for (const f of t.figures) {
        expect(f.value).toBeGreaterThanOrEqual(0);
        expect(f.value).toBeLessThanOrEqual(BASELINE_METRICS[f.metric].max);
      }
    }
    const emails = tallies.map((t) => t.figures.find((f) => f.metric === "emails_per_day")?.value);
    expect(emails).toEqual([52, 44, 37, 31]);
  });

  it("each saved by the admin the Monday after its week, never after now", () => {
    for (const s of saves) {
      expect(s.recordedBy).toBe("admin-id");
      expect(s.savedAt.getTime()).toBeLessThanOrEqual(now.getTime());
    }
    expect(saves.at(-1)?.savedAt.toISOString()).toBe("2026-11-09T10:00:00.000Z");
    // A Monday before 10:00: the last tally is saved "now".
    const early = new Date("2026-11-09T08:00:00Z");
    expect(acmePilotFigures(early, "a").at(-1)?.savedAt).toEqual(early);
  });
});
