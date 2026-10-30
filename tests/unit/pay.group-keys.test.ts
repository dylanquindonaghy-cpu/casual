import { describe, expect, it } from "vitest";
import { parsePayGroupKey, payGroupKey } from "@/lib/pay/grouping";

// Pay query grouping keys (src/lib/pay/grouping.ts): code decides which queries share a likely
// cause, using only the parts that point at one cause for each issue.

const SITE = "22222222-2222-4222-8222-222222222222";

describe("pay query grouping keys", () => {
  it("each issue keys on its own likely cause, by the week (the Monday of the day worked)", () => {
    // Thursday 10 September 2026 is in the week of Monday 7 September.
    const day = "2026-09-10";
    expect(
      payGroupKey({ issue: "wrong_rate", workDate: day, siteId: SITE, ratesPence: [1250] }),
    ).toBe("pay1:wrong_rate:2026-09-07:rate:1250");
    expect(
      payGroupKey({ issue: "missing_hours", workDate: day, siteId: SITE, ratesPence: [1250] }),
    ).toBe(`pay1:missing_hours:2026-09-07:site:${SITE}`);
    expect(
      payGroupKey({ issue: "late_pay", workDate: day, siteId: SITE, ratesPence: [1250] }),
    ).toBe("pay1:late_pay:2026-09-07");
    expect(payGroupKey({ issue: "other", workDate: day, siteId: null, ratesPence: [] })).toBe(
      "pay1:other:2026-09-07",
    );
  });

  it("the same cause gives the same key; a different week, rate or site doesn't", () => {
    const wrong = (workDate: string, ratesPence: number[]) =>
      payGroupKey({ issue: "wrong_rate", workDate, siteId: null, ratesPence });
    // Monday and Sunday of one week, the rates in any order: one group.
    expect(wrong("2026-09-07", [1250, 1500])).toBe(wrong("2026-09-13", [1500, 1250, 1250]));
    expect(wrong("2026-09-14", [1250])).not.toBe(wrong("2026-09-13", [1250]));
    expect(wrong("2026-09-10", [1300])).not.toBe(wrong("2026-09-10", [1250]));
    expect(wrong("2026-09-10", [])).toBe("pay1:wrong_rate:2026-09-07:rate:none");
    const missing = (siteId: string | null) =>
      payGroupKey({ issue: "missing_hours", workDate: "2026-09-10", siteId, ratesPence: [] });
    expect(missing(SITE)).not.toBe(missing(null));
    expect(missing(null)).toBe("pay1:missing_hours:2026-09-07:site:none");
  });

  it("every key the code writes reads back to the same parts", () => {
    for (const issue of ["wrong_rate", "missing_hours", "late_pay", "other"] as const) {
      const key = payGroupKey({ issue, workDate: "2026-09-10", siteId: SITE, ratesPence: [1250] });
      expect(parsePayGroupKey(key), key).toMatchObject({ issue, week: "2026-09-07" });
    }
  });

  it("a key reads back into its parts; a key this code didn't write doesn't", () => {
    expect(parsePayGroupKey("pay1:wrong_rate:2026-09-07:rate:1250+1500")).toEqual({
      issue: "wrong_rate",
      week: "2026-09-07",
      siteId: null,
      ratesPence: [1250, 1500],
    });
    expect(parsePayGroupKey("pay1:wrong_rate:2026-09-07:rate:none")?.ratesPence).toEqual([]);
    expect(parsePayGroupKey(`pay1:missing_hours:2026-09-07:site:${SITE}`)).toMatchObject({
      siteId: SITE,
      ratesPence: null,
    });
    expect(parsePayGroupKey("pay1:late_pay:2026-09-07")).toMatchObject({ issue: "late_pay" });
    for (const bad of ["pay2:late_pay:2026-09-07", "late_pay", "pay1:sick:2026-09-07", ""]) {
      expect(parsePayGroupKey(bad)).toBeNull();
    }
  });

  it("on the firm's pay calendar (P3.1): one fortnight, one pay run, one key", () => {
    // A made-up calendar: fortnights from Mon 31 Aug 2026, so 31 Aug to 13 Sep is one.
    const calendar = { days: 14, anchor: "2026-08-31", payDayAfter: 5, label: "cycle" } as const;
    const late = (workDate: string, withCalendar: boolean) =>
      payGroupKey({
        issue: "late_pay",
        workDate,
        siteId: null,
        ratesPence: [],
        ...(withCalendar ? { calendar } : {}),
      });
    // Both weeks of the fortnight share the key of its first Monday; the next fortnight doesn't.
    expect(late("2026-09-01", true)).toBe("pay1:late_pay:2026-08-31");
    expect(late("2026-09-10", true)).toBe("pay1:late_pay:2026-08-31");
    expect(late("2026-09-14", true)).toBe("pay1:late_pay:2026-09-14");
    // Without a calendar, the weeks as before.
    expect(late("2026-09-10", false)).toBe("pay1:late_pay:2026-09-07");
    expect(parsePayGroupKey(late("2026-09-10", true))).toMatchObject({ week: "2026-08-31" });
  });
});
