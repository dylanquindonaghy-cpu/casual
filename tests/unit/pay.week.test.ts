import { describe, expect, it } from "vitest";
import { payWeek, payWeekLabel, payWeekNow } from "@/lib/pay/pay-week";

// The pay week (docs/office-v2.md D8; src/lib/pay/pay-week.ts): the ISO week, Monday to Sunday,
// paid the Friday after it ends, for the office's top bar and the pay dashboard.

const LONDON = "Europe/London";

describe("the pay week", () => {
  it("a Wednesday in week 41 of 2026", () => {
    const w = payWeek("2026-10-07");
    expect(w).toEqual({
      week: 41,
      monday: "2026-10-05",
      sunday: "2026-10-11",
      payDay: "2026-10-16",
    });
    expect(payWeekLabel(w)).toBe("Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct");
  });

  it("every day of a week is in it, Monday to Sunday", () => {
    for (const day of ["2026-10-05", "2026-10-08", "2026-10-11"]) {
      expect(payWeek(day).monday, day).toBe("2026-10-05");
    }
    expect(payWeek("2026-10-12").week).toBe(42);
  });

  it("a 53-week year: 2026's last week runs into 2027, and 2027 starts at week 1 on 4 Jan", () => {
    expect(payWeek("2026-12-31").week).toBe(53);
    const spanning = payWeek("2027-01-01");
    expect(spanning).toEqual({
      week: 53,
      monday: "2026-12-28",
      sunday: "2027-01-03",
      payDay: "2027-01-08",
    });
    expect(payWeekLabel(spanning)).toBe("Week 53 · 28 Dec – 3 Jan · Pay Fri 8 Jan");
    expect(payWeek("2027-01-04").week).toBe(1);
    // 2027 has 52: its last day is in week 52.
    expect(payWeek("2027-12-31").week).toBe(52);
    // 1 Jan 2026 is a Thursday, so its week is week 1 (from Mon 29 Dec 2025).
    expect(payWeek("2026-01-01")).toMatchObject({ week: 1, monday: "2025-12-29" });
  });

  it("today is the firm's date, across the clock change", () => {
    // Sun 25 Oct 2026: 01:30 summer time, then 23:30 winter time: both still Sunday, week 43.
    expect(payWeekNow(new Date("2026-10-25T00:30:00Z"), LONDON).monday).toBe("2026-10-19");
    expect(payWeekNow(new Date("2026-10-25T23:30:00Z"), LONDON).monday).toBe("2026-10-19");
    // Sun 29 Mar 2026, 23:30 UTC, is already 00:30 on Monday in London: the next week.
    expect(payWeekNow(new Date("2026-03-29T23:30:00Z"), LONDON)).toMatchObject({
      week: 14,
      monday: "2026-03-30",
    });
    expect(payWeekNow(new Date("2026-03-29T23:30:00Z"), "UTC").week).toBe(13);
  });
});
