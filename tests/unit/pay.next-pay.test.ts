import { describe, expect, it } from "vitest";
import { payCalendar } from "@/lib/pay/calendar";
import { nextPayFor, recordWindow } from "@/lib/pay/next-pay";
import { nextPayLines } from "@/lib/pay/pay-week";

// The pay dashboard's next pay day (Phase 26.10, fix-1; docs/screens.md "Fixes and words"): the
// first pay day not yet past. The review found the dashboard saying Fri 13 Nov on Monday 2 Nov
// while last week's Fri 6 Nov was still to come.

const weeks = payCalendar({});
const fortnight = payCalendar({
  pay_calendar: { days: 14, anchor: "2026-01-05", pay_day_after: 5, label: "cycle" },
});

describe("the next pay day", () => {
  it("Monday to Friday: last week's pay day while it's ahead, then this week's", () => {
    for (const today of ["2026-11-02", "2026-11-04", "2026-11-06"]) {
      expect(nextPayFor(today, weeks, [])).toEqual({
        day: "2026-11-06",
        from: "pay calendar",
        periodStart: "2026-10-26",
        thisPeriodPaid: "2026-11-13",
      });
    }
    // Saturday: last week's is past, so this week's, with no second line.
    expect(nextPayFor("2026-11-07", weeks, [])).toEqual({
      day: "2026-11-13",
      from: "pay calendar",
      periodStart: "2026-11-02",
      thisPeriodPaid: null,
    });
  });

  it("the pay records' date for a period wins over the calendar's, earlier or later", () => {
    // Last week paid on the Thursday (a bank holiday Friday).
    expect(nextPayFor("2026-11-02", weeks, [{ start: "2026-10-26", next: "2026-11-05" }])).toEqual({
      day: "2026-11-05",
      from: "pay records",
      periodStart: "2026-10-26",
      thisPeriodPaid: "2026-11-13",
    });
    // Or late, on the Monday after: still last week's, from the records.
    expect(nextPayFor("2026-11-02", weeks, [{ start: "2026-10-26", next: "2026-11-09" }])).toEqual({
      day: "2026-11-09",
      from: "pay records",
      periodStart: "2026-10-26",
      thisPeriodPaid: "2026-11-13",
    });
  });

  it("a period the records date in the past is paid: the next one counts", () => {
    // Last week paid early, on Monday 2 Nov: on Tuesday its records' only date is gone.
    expect(nextPayFor("2026-11-03", weeks, [{ start: "2026-10-26", next: null }])).toEqual({
      day: "2026-11-13",
      from: "pay calendar",
      periodStart: "2026-11-02",
      thisPeriodPaid: null,
    });
  });

  it("an earlier date in the records (an older week paid late) comes first", () => {
    expect(nextPayFor("2026-11-02", weeks, [{ start: "2026-10-19", next: "2026-11-03" }])).toEqual({
      day: "2026-11-03",
      from: "pay records",
      periodStart: "2026-10-19",
      thisPeriodPaid: "2026-11-13",
    });
  });

  it("on the same day, the records' over the calendar's", () => {
    expect(nextPayFor("2026-11-02", weeks, [{ start: "2026-10-26", next: "2026-11-06" }])).toEqual({
      day: "2026-11-06",
      from: "pay records",
      periodStart: "2026-10-26",
      thisPeriodPaid: "2026-11-13",
    });
  });

  it("this week's records naming the date: no second line about it", () => {
    expect(
      nextPayFor("2026-11-07", weeks, [{ start: "2026-11-02", next: "2026-11-12" }]),
    ).toEqual({
      day: "2026-11-12",
      from: "pay records",
      periodStart: "2026-11-02",
      thisPeriodPaid: null,
    });
  });

  it("on a fortnight's cycle: the last cycle's pay day is past by the second week", () => {
    // Cycle 22 runs Mon 26 Oct to Sun 8 Nov, paid Fri 13 Nov; Cycle 21 was paid Fri 30 Oct.
    expect(nextPayFor("2026-11-02", fortnight, [])).toEqual({
      day: "2026-11-13",
      from: "pay calendar",
      periodStart: "2026-10-26",
      thisPeriodPaid: null,
    });
    // In its first week, Cycle 21's Fri 30 Oct is still ahead.
    expect(nextPayFor("2026-10-27", fortnight, [])).toEqual({
      day: "2026-10-30",
      from: "pay calendar",
      periodStart: "2026-10-12",
      thisPeriodPaid: "2026-11-13",
    });
  });

  it("the records it reads: from last period's start to this one's end", () => {
    expect(recordWindow("2026-11-04", weeks)).toEqual({ from: "2026-10-26", to: "2026-11-08" });
    expect(recordWindow("2026-11-04", fortnight)).toEqual({ from: "2026-10-12", to: "2026-11-08" });
  });
});

describe("its words", () => {
  it("the week, this week's later pay day, and where the date came from", () => {
    expect(
      nextPayLines(
        { from: "pay calendar", periodStart: "2026-10-26", thisPeriodPaid: "2026-11-13" },
        "week",
      ),
    ).toEqual(["For shifts in the week of 26 Oct.", "This week's shifts are paid Fri 13 Nov."]);
    expect(
      nextPayLines({ from: "pay records", periodStart: "2026-10-26", thisPeriodPaid: null }, "week"),
    ).toEqual(["For shifts in the week of 26 Oct.", "From your pay records."]);
    expect(
      nextPayLines(
        { from: "pay records", periodStart: "2026-10-12", thisPeriodPaid: "2026-11-13" },
        "cycle",
      ),
    ).toEqual([
      "For shifts in the cycle from 12 Oct.",
      "This cycle's shifts are paid Fri 13 Nov.",
      "From your pay records.",
    ]);
  });
});
