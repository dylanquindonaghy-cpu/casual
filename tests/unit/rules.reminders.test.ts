import { describe, expect, it } from "vitest";
import { DEFAULT_QUIET_HOURS, type QuietHours } from "@/lib/rules/quiet-hours";
import { reminderDecision, reminderWindow } from "@/lib/rules/reminders";

// Shift reminders (src/lib/rules/reminders.ts): which one is due, for whom, and quiet hours.
// November: London is on GMT, so local time equals UTC.

const TZ = "Europe/London";
const NONE: QuietHours = { start: "00:00", end: "00:00", urgentOverride: true }; // no quiet hours
const start = new Date("2026-11-07T14:00:00Z"); // Saturday 14:00
const at = (iso: string) => new Date(iso);
const longAgo = at("2026-11-01T10:00:00Z");

const decide = (now: string, o: { confirmedAt?: Date | null; quiet?: QuietHours } = {}) =>
  reminderDecision({
    startsAt: start,
    confirmedAt: o.confirmedAt === undefined ? longAgo : o.confirmedAt,
    now: at(now),
    timeZone: TZ,
    quiet: o.quiet ?? NONE,
  });

describe("reminderWindow", () => {
  it("more than 24 hours before: none", () => {
    expect(reminderWindow(start, at("2026-11-06T13:59:59Z"))).toBeNull();
  });

  it("from 24 hours before until 2 hours before: the 24h one", () => {
    const opens = at("2026-11-06T14:00:00Z");
    const closes = at("2026-11-07T12:00:00Z");
    for (const now of ["2026-11-06T14:00:00Z", "2026-11-06T20:00:00Z", "2026-11-07T11:59:59Z"]) {
      expect(reminderWindow(start, at(now))).toEqual({
        kind: "24h",
        opensAt: opens,
        closesAt: closes,
      });
    }
  });

  it("from 2 hours before until the start: the 2h one", () => {
    for (const now of ["2026-11-07T12:00:00Z", "2026-11-07T13:59:59Z"]) {
      expect(reminderWindow(start, at(now))).toEqual({
        kind: "2h",
        opensAt: at("2026-11-07T12:00:00Z"),
        closesAt: start,
      });
    }
  });

  it("from the start on: none", () => {
    expect(reminderWindow(start, start)).toBeNull();
    expect(reminderWindow(start, at("2026-11-07T15:00:00Z"))).toBeNull();
  });
});

describe("reminderDecision", () => {
  it("a booking made days ago gets both, each in its window", () => {
    expect(decide("2026-11-06T14:00:00Z")).toEqual({ action: "send", kind: "24h" });
    expect(decide("2026-11-07T12:00:00Z")).toEqual({ action: "send", kind: "2h" });
    expect(decide("2026-11-06T13:55:00Z")).toEqual({ action: "none" });
  });

  it("a booking made after the 24h mark gets only the 2h one", () => {
    const confirmedAt = at("2026-11-06T20:00:00Z");
    expect(decide("2026-11-06T20:05:00Z", { confirmedAt })).toEqual({ action: "none" });
    expect(decide("2026-11-07T12:00:00Z", { confirmedAt })).toEqual({ action: "send", kind: "2h" });
  });

  it("a booking made at the moment a window opens doesn't get that one", () => {
    expect(decide("2026-11-06T14:05:00Z", { confirmedAt: at("2026-11-06T14:00:00Z") })).toEqual({
      action: "none",
    });
  });

  it("a booking made inside the last 2 hours gets none", () => {
    expect(decide("2026-11-07T13:00:00Z", { confirmedAt: at("2026-11-07T12:30:00Z") })).toEqual({
      action: "none",
    });
  });

  it("a booking with no booked time is treated as made long ago", () => {
    expect(decide("2026-11-07T12:00:00Z", { confirmedAt: null })).toEqual({
      action: "send",
      kind: "2h",
    });
  });

  describe("quiet hours (default 22:00–07:00)", () => {
    const quiet = DEFAULT_QUIET_HOURS;

    it("a 24h reminder due at 23:00 waits until 07:00, then goes", () => {
      const late = new Date("2026-11-07T23:00:00Z"); // a Sunday 23:00 start
      const d = (now: string) =>
        reminderDecision({
          startsAt: late,
          confirmedAt: longAgo,
          now: at(now),
          timeZone: TZ,
          quiet,
        });
      expect(d("2026-11-06T23:00:00Z")).toEqual({ action: "wait" });
      expect(d("2026-11-07T06:59:00Z")).toEqual({ action: "wait" });
      expect(d("2026-11-07T07:00:00Z")).toEqual({ action: "send", kind: "24h" });
    });

    it("a 2h reminder for a 06:00 start would come after the start: skipped", () => {
      const early = new Date("2026-11-07T06:00:00Z");
      expect(
        reminderDecision({
          startsAt: early,
          confirmedAt: longAgo,
          now: at("2026-11-07T04:00:00Z"),
          timeZone: TZ,
          quiet,
        }),
      ).toEqual({ action: "skip", kind: "2h", reason: "quiet_hours" });
    });

    it("a 2h reminder for a 07:30 start waits until 07:00 and goes then", () => {
      const s = new Date("2026-11-07T07:30:00Z");
      const d = (now: string) =>
        reminderDecision({ startsAt: s, confirmedAt: longAgo, now: at(now), timeZone: TZ, quiet });
      expect(d("2026-11-07T05:30:00Z")).toEqual({ action: "wait" });
      expect(d("2026-11-07T07:00:00Z")).toEqual({ action: "send", kind: "2h" });
    });

    it("quiet hours ending less than two runs (10 minutes) before the start: skipped, not lost", () => {
      // A 07:09 start: the job's first run after 07:00 may be 07:05 and start late, and the one
      // after that is past the start.
      const s = new Date("2026-11-07T07:09:00Z");
      expect(
        reminderDecision({
          startsAt: s,
          confirmedAt: longAgo,
          now: at("2026-11-07T05:30:00Z"),
          timeZone: TZ,
          quiet,
        }),
      ).toEqual({ action: "skip", kind: "2h", reason: "quiet_hours" });
      // Exactly 10 minutes before: it waits.
      expect(
        reminderDecision({
          startsAt: new Date("2026-11-07T07:10:00Z"),
          confirmedAt: longAgo,
          now: at("2026-11-07T05:30:00Z"),
          timeZone: TZ,
          quiet,
        }),
      ).toEqual({ action: "wait" });
    });

    it("the 24h window spent entirely in quiet hours: skipped, and the 2h one still goes", () => {
      // An 08:00 start: the 24h window runs 08:00 to 06:00 the next morning. A job that only
      // gets to it at 23:00 finds quiet hours lasting past 06:00.
      const s = new Date("2026-11-07T08:00:00Z");
      const d = (now: string) =>
        reminderDecision({ startsAt: s, confirmedAt: longAgo, now: at(now), timeZone: TZ, quiet });
      expect(d("2026-11-06T23:00:00Z")).toEqual({
        action: "skip",
        kind: "24h",
        reason: "quiet_hours",
      });
      expect(d("2026-11-07T06:30:00Z")).toEqual({ action: "wait" });
      expect(d("2026-11-07T07:00:00Z")).toEqual({ action: "send", kind: "2h" });
    });

    it("in summer, quiet hours are London time (22:00 BST is 21:00 UTC)", () => {
      const s = new Date("2026-07-18T21:30:00Z"); // 22:30 BST start
      const booked = at("2026-07-01T10:00:00Z");
      const d = (now: string) =>
        reminderDecision({ startsAt: s, confirmedAt: booked, now: at(now), timeZone: TZ, quiet });
      // 24 hours before is 22:30 BST the day before: quiet, until 07:00 BST (06:00 UTC).
      expect(d("2026-07-17T21:30:00Z")).toEqual({ action: "wait" });
      expect(d("2026-07-18T06:00:00Z")).toEqual({ action: "send", kind: "24h" });
      // 2 hours before is 20:30 BST: not quiet.
      expect(d("2026-07-18T19:30:00Z")).toEqual({ action: "send", kind: "2h" });
    });
  });
});
