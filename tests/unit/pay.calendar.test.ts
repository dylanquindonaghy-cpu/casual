import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAY_CALENDAR,
  payCalendar,
  payPeriod,
  payPeriodNow,
  readPayCalendar,
  type PayCalendar,
} from "@/lib/pay/calendar";
import { payWeek } from "@/lib/pay/pay-week";
import { addDays } from "@/lib/time/zoned";

// The firm's pay calendar (PLAN.md P3.1; src/lib/pay/calendar.ts): 7 or 14 days from an anchor
// Monday, paid a set number of days after each period ends, called "Week" or "Cycle"; with nothing
// set, today's ISO weeks paid the Friday after. Made-up anchors only.

const LONDON = "Europe/London";
// A made-up fortnightly calendar: period 1 is Mon 2 Mar to Sun 15 Mar 2026, paid Fri 20 Mar.
const FORTNIGHTS: PayCalendar = { days: 14, anchor: "2026-03-02", payDayAfter: 5, label: "cycle" };

describe("with no pay calendar set: today's rule, exactly", () => {
  it("every day of 2026 and 2027 (2026 has 53 weeks) is in the same week, paid the same Friday", () => {
    let day = "2026-01-01";
    for (let i = 0; i < 730; i++) {
      const w = payWeek(day);
      expect(payPeriod(day), day).toEqual({
        label: "week",
        number: w.week,
        start: w.monday,
        end: w.sunday,
        payDay: w.payDay,
      });
      expect(payPeriod(day, payCalendar({})), day).toEqual(payPeriod(day));
      day = addDays(day, 1);
    }
    expect(payPeriod("2026-12-31").number).toBe(53);
    expect(payPeriod("2027-01-03")).toMatchObject({ number: 53, start: "2026-12-28" });
  });
});

describe("fortnights from an anchor", () => {
  it("the anchor's fortnight is cycle 1, Monday to the Sunday after next, paid the Friday after", () => {
    for (const day of ["2026-03-02", "2026-03-09", "2026-03-15"]) {
      expect(payPeriod(day, FORTNIGHTS), day).toEqual({
        label: "cycle",
        number: 1,
        start: "2026-03-02",
        end: "2026-03-15",
        payDay: "2026-03-20",
      });
    }
    expect(payPeriod("2026-03-16", FORTNIGHTS)).toMatchObject({
      number: 2,
      start: "2026-03-16",
      end: "2026-03-29",
      payDay: "2026-04-03",
    });
  });

  it("a day before the anchor is in an earlier fortnight, with no number", () => {
    expect(payPeriod("2026-03-01", FORTNIGHTS)).toEqual({
      label: "cycle",
      number: null,
      start: "2026-02-16",
      end: "2026-03-01",
      payDay: "2026-03-06",
    });
    expect(payPeriod("2025-01-01", FORTNIGHTS).start).toBe("2024-12-23");
    expect(payPeriod("2025-01-01", FORTNIGHTS).number).toBeNull();
  });

  it("every fortnight is 14 days, back to back, through 2026's 53 weeks and New Year", () => {
    let start = "2026-03-02";
    for (let n = 1; n <= 40; n++) {
      const p = payPeriod(start, FORTNIGHTS);
      expect(p, start).toMatchObject({ number: n, start, end: addDays(start, 13) });
      expect(payPeriod(addDays(start, 13), FORTNIGHTS), start).toEqual(p);
      start = addDays(start, 14);
    }
    // The numbers carry on across New Year (the year-end rule waits for payroll).
    expect(payPeriod("2027-01-01", FORTNIGHTS)).toMatchObject({
      number: 22,
      start: "2026-12-21",
      end: "2027-01-03",
      payDay: "2027-01-08",
    });
  });

  it("weeks from an anchor count from it; the pay day is any number of days after", () => {
    const weeks: PayCalendar = { days: 7, anchor: "2026-04-06", payDayAfter: 0, label: "week" };
    expect(payPeriod("2026-04-08", weeks)).toEqual({
      label: "week",
      number: 1,
      start: "2026-04-06",
      end: "2026-04-12",
      payDay: "2026-04-12",
    });
    expect(payPeriod("2026-04-13", weeks).number).toBe(2);
    // Paid 12 days after the fortnight ends: the Friday a week later.
    expect(payPeriod("2026-03-02", { ...FORTNIGHTS, payDayAfter: 12 }).payDay).toBe("2026-03-27");
  });

  it("today is the firm's date, across both clock changes", () => {
    // Sun 29 Mar 2026, 23:30 UTC, is already 00:30 on Monday 30 Mar in London: cycle 3 starts.
    expect(payPeriodNow(new Date("2026-03-29T23:30:00Z"), LONDON, FORTNIGHTS)).toMatchObject({
      number: 3,
      start: "2026-03-30",
    });
    expect(payPeriodNow(new Date("2026-03-29T23:30:00Z"), "UTC", FORTNIGHTS).number).toBe(2);
    // Sun 25 Oct 2026, the clocks go back: 01:30 twice and 23:59 are all the last day of cycle 17.
    for (const at of ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z", "2026-10-25T23:59:00Z"]) {
      expect(payPeriodNow(new Date(at), LONDON, FORTNIGHTS), at).toMatchObject({
        number: 17,
        start: "2026-10-12",
        end: "2026-10-25",
        payDay: "2026-10-30",
      });
    }
    expect(payPeriodNow(new Date("2026-10-26T00:00:00Z"), LONDON, FORTNIGHTS).number).toBe(18);
  });
});

describe("the setting, as the app reads it", () => {
  it("reads a calendar the owner set; the label defaults to its length", () => {
    expect(payCalendar({ pay_calendar: { days: 14, anchor: "2026-03-02" } })).toEqual(FORTNIGHTS);
    expect(
      payCalendar({ pay_calendar: { days: 14, anchor: "2026-03-02", label: "week" } }).label,
    ).toBe("week");
    expect(payCalendar({ pay_calendar: { days: 7 } })).toEqual(DEFAULT_PAY_CALENDAR);
    expect(payCalendar({ pay_calendar: { anchor: "2026-03-02", pay_day_after: 12 } })).toEqual({
      days: 7,
      anchor: "2026-03-02",
      payDayAfter: 12,
      label: "week",
    });
  });

  it("anything it can't read, the whole calendar falls back to today's rule", () => {
    const bad: unknown[] = [
      undefined,
      null,
      "fortnightly",
      [14],
      {},
      { days: 10, anchor: "2026-03-02" },
      { days: "14", anchor: "2026-03-02" },
      { days: 14 }, // fortnights need a start
      { days: 14, anchor: null },
      { days: 14, anchor: "2026-03-03" }, // a Tuesday
      { days: 14, anchor: "2026-02-30" }, // not a date
      { days: 14, anchor: "2 March 2026" },
      { days: 14, anchor: "2026-03-02T00:00:00Z" },
      { days: 14, anchor: "2026-03-02", pay_day_after: -1 },
      { days: 14, anchor: "2026-03-02", pay_day_after: 28 },
      { days: 14, anchor: "2026-03-02", pay_day_after: 2.5 },
      { days: 14, anchor: "2026-03-02", pay_day_after: "5" },
      { days: 14, anchor: "2026-03-02", label: "fortnight" },
      { days: 14, anchor: "2026-03-02", label: "Cycle" },
    ];
    for (const raw of bad) {
      expect(readPayCalendar(raw), JSON.stringify(raw)).toBeNull();
      expect(payCalendar({ pay_calendar: raw }), JSON.stringify(raw)).toEqual(DEFAULT_PAY_CALENDAR);
    }
  });
});
