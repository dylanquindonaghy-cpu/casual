import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIGEST_SCHEDULE,
  digestDueOn,
  digestSchedule,
  nextDigestAt,
  scheduleWords,
} from "@/lib/pay/digest-schedule";

// When the payroll digest goes (src/lib/pay/digest-schedule.ts): the firm setting read field by
// field, the firm-local date a digest is due on, and the schedule in words.

const LONDON = "Europe/London";

describe("the pay_digest setting", () => {
  it("defaults to 09:00, Monday to Friday", () => {
    expect(digestSchedule({})).toEqual({
      time: "09:00",
      days: ["mon", "tue", "wed", "thu", "fri"],
    });
    expect(DEFAULT_DIGEST_SCHEDULE.time).toBe("09:00");
  });

  it("keeps a good time and day list, in week order", () => {
    expect(digestSchedule({ pay_digest: { time: "17:30", days: ["thu", "mon"] } })).toEqual({
      time: "17:30",
      days: ["mon", "thu"],
    });
  });

  it("a broken part gets the default; an empty day list (no scheduled digest) is kept", () => {
    expect(digestSchedule({ pay_digest: { time: "25:00", days: ["mon"] } })).toEqual({
      time: "09:00",
      days: ["mon"],
    });
    expect(digestSchedule({ pay_digest: { time: "08:15", days: ["funday"] } })).toEqual({
      time: "08:15",
      days: ["mon", "tue", "wed", "thu", "fri"],
    });
    expect(digestSchedule({ pay_digest: { days: [] } })).toEqual({ time: "09:00", days: [] });
    expect(digestSchedule({ pay_digest: "daily" })).toEqual(DEFAULT_DIGEST_SCHEDULE);
  });
});

describe("when a digest is due", () => {
  const weekdays = digestSchedule({});

  it("on a digest day, from its time (firm-local) to the end of the day", () => {
    // Monday 2 November 2026 (GMT: London time is UTC).
    expect(digestDueOn(new Date("2026-11-02T08:59:00Z"), LONDON, weekdays)).toBeNull();
    expect(digestDueOn(new Date("2026-11-02T09:00:00Z"), LONDON, weekdays)).toBe("2026-11-02");
    expect(digestDueOn(new Date("2026-11-02T23:59:00Z"), LONDON, weekdays)).toBe("2026-11-02");
    // Saturday and Sunday: not digest days.
    expect(digestDueOn(new Date("2026-11-07T10:00:00Z"), LONDON, weekdays)).toBeNull();
    expect(digestDueOn(new Date("2026-11-08T10:00:00Z"), LONDON, weekdays)).toBeNull();
  });

  it("in British Summer Time the time is still London's", () => {
    // Monday 5 October 2026, BST (UTC+1): 09:00 London is 08:00 UTC.
    expect(digestDueOn(new Date("2026-10-05T07:59:00Z"), LONDON, weekdays)).toBeNull();
    expect(digestDueOn(new Date("2026-10-05T08:00:00Z"), LONDON, weekdays)).toBe("2026-10-05");
    // 23:30 UTC on Sunday is 00:30 on Monday in London: Monday's date, before the time.
    const late = digestSchedule({ pay_digest: { time: "00:15", days: ["mon"] } });
    expect(digestDueOn(new Date("2026-10-04T23:30:00Z"), LONDON, late)).toBe("2026-10-05");
  });

  it("across the clocks going back (Sunday 25 October 2026) and in another time zone", () => {
    const sundays = digestSchedule({ pay_digest: { time: "09:00", days: ["sun"] } });
    expect(digestDueOn(new Date("2026-10-25T08:59:00Z"), LONDON, sundays)).toBeNull(); // 08:59 GMT
    expect(digestDueOn(new Date("2026-10-25T09:00:00Z"), LONDON, sundays)).toBe("2026-10-25");
    // 09:00 in Dublin on a Monday.
    expect(digestDueOn(new Date("2026-11-02T09:00:00Z"), "Europe/Dublin", weekdays)).toBe(
      "2026-11-02",
    );
  });

  it("never, with no days", () => {
    const none = digestSchedule({ pay_digest: { days: [] } });
    expect(digestDueOn(new Date("2026-11-02T12:00:00Z"), LONDON, none)).toBeNull();
  });
});

describe("the schedule in words", () => {
  it("a run of days, some days, every day, one day, none", () => {
    expect(scheduleWords(digestSchedule({}))).toBe("at 09:00, Monday to Friday");
    expect(scheduleWords({ time: "17:30", days: ["mon", "thu"] })).toBe(
      "at 17:30 on Monday and Thursday",
    );
    expect(scheduleWords({ time: "08:00", days: ["mon", "wed", "fri"] })).toBe(
      "at 08:00 on Monday, Wednesday and Friday",
    );
    expect(scheduleWords({ time: "09:00", days: ["tue"] })).toBe("at 09:00 on Tuesday");
    expect(
      scheduleWords({ time: "09:00", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }),
    ).toBe("at 09:00, every day");
    expect(scheduleWords({ time: "09:00", days: ["sat", "sun"] })).toBe(
      "at 09:00 on Saturday and Sunday",
    );
    expect(scheduleWords({ time: "09:00", days: [] })).toBeNull();
  });
});

describe("the next digest (the pay dashboard, 12A.3)", () => {
  const weekdays = DEFAULT_DIGEST_SCHEDULE;
  const at = (iso: string) => nextDigestAt(new Date(iso), LONDON, weekdays)?.toISOString();

  it("later today if today is a digest day and the time hasn't come; otherwise the next day", () => {
    // Mon 5 Oct 2026: 08:00 summer time → 09:00 that day; 09:30 → Tuesday's.
    expect(at("2026-10-05T07:00:00Z")).toBe("2026-10-05T08:00:00.000Z");
    expect(at("2026-10-05T08:30:00Z")).toBe("2026-10-06T08:00:00.000Z");
    // Exactly at the time it's going now, so the next is the next day's.
    expect(at("2026-10-05T08:00:00Z")).toBe("2026-10-06T08:00:00.000Z");
    // Friday after the time → Monday.
    expect(at("2026-10-09T09:00:00Z")).toBe("2026-10-12T08:00:00.000Z");
  });

  it("09:00 local on either side of the clock change", () => {
    // Fri 23 Oct (summer time) → Mon 26 Oct, after the clocks went back: 09:00 is 09:00 UTC.
    expect(at("2026-10-23T10:00:00Z")).toBe("2026-10-26T09:00:00.000Z");
    // Fri 27 Mar (winter time) → Mon 30 Mar, after the clocks went forward: 08:00 UTC.
    expect(at("2026-03-27T10:00:00Z")).toBe("2026-03-30T08:00:00.000Z");
  });

  it("one day a week: a week ahead once it's passed; no days: none", () => {
    const sundays = { time: "17:30", days: ["sun" as const] };
    // Sun 11 Oct 2026, 18:00 summer time: next Sunday 17:30.
    expect(nextDigestAt(new Date("2026-10-11T17:00:00Z"), LONDON, sundays)?.toISOString()).toBe(
      "2026-10-18T16:30:00.000Z",
    );
    expect(
      nextDigestAt(new Date("2026-10-11T12:00:00Z"), LONDON, { time: "09:00", days: [] }),
    ).toBeNull();
  });
});
