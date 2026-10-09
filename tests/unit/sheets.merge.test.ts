import { describe, expect, it } from "vitest";
import { sheetsSyncDue } from "@/lib/roster/sheets/cadence";
import { mergeHolders, sameHolders } from "@/lib/roster/sheets/merge";

// Who holds a shift when the office (sheet) and workers (portal) both changed it since the last
// sync. base = the sheet after the last sync; theirs = the sheet now; ours = our bookings now.

describe("mergeHolders", () => {
  it.each([
    ["nothing changed", [], [], [], 2, [], []],
    ["nothing changed, two holders", ["A", "B"], ["A", "B"], ["A", "B"], 2, ["A", "B"], []],
    ["first sync of a shift: the sheet's names are booked", [], ["A", "B"], [], 2, ["A", "B"], []],
    ["the office added a name", ["A"], ["A", "B"], ["A"], 2, ["A", "B"], []],
    ["the office removed a name", ["A", "B"], ["A"], ["A", "B"], 2, ["A"], []],
    ["the office swapped a name", ["A"], ["B"], ["A"], 1, ["B"], []],
    ["a worker booked here", ["A"], ["A"], ["A", "B"], 2, ["A", "B"], []],
    ["a worker cancelled here", ["A", "B"], ["A", "B"], ["A"], 2, ["A"], []],
    ["both removed the same name", ["A", "B"], ["A"], ["A"], 2, ["A"], []],
    ["both added the same name", [], ["A"], ["A"], 1, ["A"], []],
    [
      "each side changed a different name",
      ["A", "B"],
      ["A", "C"], // office replaced B with C
      ["B", "D"], // A cancelled here, D booked here
      3,
      ["C", "D"],
      [],
    ],
    ["a booking here beats a sheet name for the last place", [], ["C"], ["B"], 1, ["B"], ["C"]],
    [
      "a booking here is kept even past a lowered headcount; sheet names aren't added",
      ["A"],
      ["A", "C"],
      ["A", "B"],
      1,
      ["A", "B"],
      ["C"],
    ],
    [
      "the sheet's order is kept, new bookings here go last",
      ["B", "A"],
      ["B", "A"],
      ["A", "B", "C"],
      3,
      ["B", "A", "C"],
      [],
    ],
  ])("%s", (_label, base, theirs, ours, headcount, holders, notBooked) => {
    expect(mergeHolders({ base, theirs, ours, headcount })).toEqual({ holders, notBooked });
  });

  it("sameHolders compares as sets", () => {
    expect(sameHolders(["A", "B"], ["B", "A"])).toBe(true);
    expect(sameHolders(["A"], ["A", "B"])).toBe(false);
    expect(sameHolders(["A", "C"], ["A", "B"])).toBe(false);
    expect(sameHolders([], [])).toBe(true);
  });
});

describe("sheetsSyncDue", () => {
  const now = new Date("2026-11-07T09:00:00Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
  it.each([
    ["never synced", null, null, false, false, true],
    ["event day, synced 55 s ago (a late tick still counts)", ago(55), ago(55), false, true, true],
    ["event day, synced 30 s ago", ago(30), ago(30), false, true, false],
    ["quiet day, synced 5 min ago", ago(300), ago(300), false, false, false],
    ["quiet day, synced 14 min 55 s ago", ago(895), ago(895), false, false, true],
    ["quiet day, synced 20 min ago", ago(1200), ago(1200), false, false, true],
    ["failing on an event day, tried 2 min ago: back off", null, ago(120), true, true, false],
    ["failing on an event day, tried 5 min ago: retry", ago(3600), ago(300), true, true, true],
    [
      "failing on a quiet day, tried 20 min ago: back off",
      ago(7200),
      ago(1200),
      true,
      false,
      false,
    ],
    ["failing on a quiet day, tried 30 min ago: retry", ago(7200), ago(1800), true, false, true],
  ])("%s", (_label, lastSyncedAt, lastAttemptedAt, failing, eventDay, due) => {
    expect(sheetsSyncDue({ lastSyncedAt, lastAttemptedAt, failing, now, eventDay })).toBe(due);
  });
});
