import { describe, expect, it } from "vitest";
import { nextDay, wallTimeOf, zonedToUtc, type WallTime } from "@/lib/time/zoned";

// London wall-clock times to UTC, including both clock changes of 2026 (29 Mar, 25 Oct).

const LONDON = "Europe/London";
const w = (year: number, month: number, day: number, hour: number, minute = 0): WallTime => ({
  year,
  month,
  day,
  hour,
  minute,
});

describe("zonedToUtc (Europe/London)", () => {
  it.each([
    ["winter (GMT, UTC+0)", w(2026, 11, 7, 22, 0), "2026-11-07T22:00:00.000Z"],
    ["summer (BST, UTC+1)", w(2027, 6, 14, 9, 30), "2027-06-14T08:30:00.000Z"],
    ["just before the spring change", w(2026, 3, 29, 0, 59), "2026-03-29T00:59:00.000Z"],
    ["just after the spring change", w(2026, 3, 29, 2, 0), "2026-03-29T01:00:00.000Z"],
    ["just after the autumn change", w(2026, 10, 25, 2, 0), "2026-10-25T02:00:00.000Z"],
    ["midnight on new year's day", w(2027, 1, 1, 0, 0), "2027-01-01T00:00:00.000Z"],
  ])("%s", (_label, wall, iso) => {
    expect(zonedToUtc(wall, LONDON).toISOString()).toBe(iso);
  });

  it("reads a time that happens twice (the autumn fall-back hour) as the first, BST one", () => {
    expect(zonedToUtc(w(2026, 10, 25, 1, 30), LONDON).toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("reads a time that doesn't exist (the spring gap) as the hour after the jump", () => {
    const utc = zonedToUtc(w(2026, 3, 29, 1, 30), LONDON);
    expect(utc.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(wallTimeOf(utc, LONDON)).toEqual(w(2026, 3, 29, 2, 30));
  });

  it("round-trips every quarter hour of a year through wallTimeOf", () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 15 * 60_000) {
      const wall = wallTimeOf(new Date(t), LONDON);
      const back = zonedToUtc(wall, LONDON).getTime();
      // Each instant maps back to itself, except the second of the two autumn 01:xx hours,
      // which reads as the first.
      expect(back === t || back === t - 3_600_000).toBe(true);
    }
  });
});

describe("nextDay", () => {
  it.each([
    [w(2026, 11, 7, 6), w(2026, 11, 8, 6)],
    [w(2026, 11, 30, 6), w(2026, 12, 1, 6)],
    [w(2026, 12, 31, 6), w(2027, 1, 1, 6)],
    [w(2028, 2, 28, 6), w(2028, 2, 29, 6)],
  ])("%o -> %o", (from, to) => {
    expect(nextDay(from)).toEqual(to);
  });
});
