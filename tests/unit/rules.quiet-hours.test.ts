import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_HOURS,
  mayMessageNow,
  quietHours,
  quietUntil,
} from "@/lib/rules/quiet-hours";

// Quiet hours (src/lib/rules/quiet-hours.ts): when messages to workers wait.

const TZ = "Europe/London";
const q = DEFAULT_QUIET_HOURS; // 22:00–07:00, urgent overrides

describe("quietUntil", () => {
  it("inside quiet hours across midnight: they end at 07:00 the next morning (GMT)", () => {
    expect(quietUntil(new Date("2026-11-02T23:30:00Z"), TZ, q)).toEqual(
      new Date("2026-11-03T07:00:00Z"),
    );
    expect(quietUntil(new Date("2026-11-03T03:00:00Z"), TZ, q)).toEqual(
      new Date("2026-11-03T07:00:00Z"),
    );
    expect(quietUntil(new Date("2026-11-02T22:00:00Z"), TZ, q)).toEqual(
      new Date("2026-11-03T07:00:00Z"),
    );
  });

  it("outside them (including the end moment itself): null", () => {
    expect(quietUntil(new Date("2026-11-03T07:00:00Z"), TZ, q)).toBeNull();
    expect(quietUntil(new Date("2026-11-02T12:00:00Z"), TZ, q)).toBeNull();
    expect(quietUntil(new Date("2026-11-02T21:59:00Z"), TZ, q)).toBeNull();
  });

  it("in local time: 23:30 BST is 22:30 UTC, and quiet ends at 07:00 BST (06:00 UTC)", () => {
    expect(quietUntil(new Date("2026-09-28T22:30:00Z"), TZ, q)).toEqual(
      new Date("2026-09-29T06:00:00Z"),
    );
  });

  it("the same day when they don't cross midnight; none when start equals end", () => {
    const lunch = { start: "12:00", end: "13:00", urgentOverride: false };
    expect(quietUntil(new Date("2026-11-02T12:30:00Z"), TZ, lunch)).toEqual(
      new Date("2026-11-02T13:00:00Z"),
    );
    expect(quietUntil(new Date("2026-11-02T13:30:00Z"), TZ, lunch)).toBeNull();
    expect(quietUntil(new Date("2026-11-02T23:30:00Z"), TZ, { ...lunch, end: "12:00" })).toBeNull();
  });
});

describe("quietUntil on the days the clocks change", () => {
  const early = { start: "22:00", end: "01:30", urgentOverride: false };
  it("autumn: 01:30 happens twice; never a moment already past", () => {
    // 01:15 GMT on 25 Oct 2026 is after the first (BST) 01:30: quiet ends at the GMT 01:30.
    const now = new Date("2026-10-25T01:15:00Z");
    const until = quietUntil(now, TZ, early);
    expect(until).toEqual(new Date("2026-10-25T01:30:00Z"));
    expect(until && until.getTime() > now.getTime()).toBe(true);
    // Before the first 01:30 (00:15 GMT = 01:15 BST): the first one.
    expect(quietUntil(new Date("2026-10-25T00:15:00Z"), TZ, early)).toEqual(
      new Date("2026-10-25T00:30:00Z"),
    );
  });

  it("spring: 01:30 doesn't exist; quiet still ends after now", () => {
    const now = new Date("2026-03-29T00:45:00Z"); // 00:45 GMT, clocks go forward at 01:00
    const until = quietUntil(now, TZ, early);
    expect(until).not.toBeNull();
    expect(until && until.getTime() > now.getTime()).toBe(true);
  });

  it("the default 22:00–07:00 is unaffected on both nights", () => {
    expect(quietUntil(new Date("2026-10-25T01:15:00Z"), TZ, q)).toEqual(
      new Date("2026-10-25T07:00:00Z"),
    );
    expect(quietUntil(new Date("2026-03-29T00:45:00Z"), TZ, q)).toEqual(
      new Date("2026-03-29T06:00:00Z"),
    );
  });
});

describe("mayMessageNow", () => {
  const night = new Date("2026-11-02T23:30:00Z");
  it("urgent goes at once when the firm lets it override; otherwise it waits", () => {
    expect(mayMessageNow({ now: night, timeZone: TZ, quiet: q, urgent: true })).toEqual({
      ok: true,
    });
    expect(mayMessageNow({ now: night, timeZone: TZ, quiet: q, urgent: false })).toEqual({
      ok: false,
      until: new Date("2026-11-03T07:00:00Z"),
    });
    expect(
      mayMessageNow({
        now: night,
        timeZone: TZ,
        quiet: { ...q, urgentOverride: false },
        urgent: true,
      }),
    ).toEqual({ ok: false, until: new Date("2026-11-03T07:00:00Z") });
  });
});

describe("quietHours (the firm's setting)", () => {
  it("reads it, with the default when missing or nonsense", () => {
    expect(
      quietHours({ quiet_hours: { start: "23:00", end: "06:00", urgent_override: false } }),
    ).toEqual({
      start: "23:00",
      end: "06:00",
      urgentOverride: false,
    });
    expect(quietHours({})).toEqual(DEFAULT_QUIET_HOURS);
    expect(quietHours({ quiet_hours: { start: "late", end: "06:00" } })).toEqual(
      DEFAULT_QUIET_HOURS,
    );
    expect(quietHours({ quiet_hours: "sometimes" })).toEqual(DEFAULT_QUIET_HOURS);
    // An explicit "no urgent at night" is kept even when the times are wrong or missing.
    expect(quietHours({ quiet_hours: { urgent_override: false } })).toEqual({
      ...DEFAULT_QUIET_HOURS,
      urgentOverride: false,
    });
    expect(
      quietHours({ quiet_hours: { start: "late", end: "06:00", urgent_override: false } })
        .urgentOverride,
    ).toBe(false);
    expect(
      quietHours({ quiet_hours: { start: "23:00", end: "06:00", urgent_override: "no" } })
        .urgentOverride,
    ).toBe(true);
  });
});
