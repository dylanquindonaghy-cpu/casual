import { describe, expect, it } from "vitest";
import {
  ISSUE_LABELS,
  OTHER_DAY,
  PAY_QUERY_STATUS_WORDS,
  payQueryInput,
  PROBLEM_WORDS,
} from "@/lib/portal/pay-query-kinds";

// The pay query form's check and words (src/lib/portal/pay-query-kinds.ts). The server checks the
// shift is the worker's and the day is in range (tests/integration/pay.queries.test.ts).

const SHIFT = "11111111-1111-4111-8111-111111111111";

describe("the pay query form", () => {
  it("a shift, or a day; an issue; details only for 'Something else'", () => {
    expect(payQueryInput({ shift: SHIFT, issue: "wrong_rate", details: "  " })).toEqual({
      ok: true,
      input: { shiftId: SHIFT, day: null, issue: "wrong_rate", details: null },
    });
    expect(
      payQueryInput({ shift: OTHER_DAY, day: "2026-10-26", issue: "other", details: " Tips? " }),
    ).toEqual({
      ok: true,
      input: { shiftId: null, day: "2026-10-26", issue: "other", details: "Tips?" },
    });
    expect(payQueryInput({ shift: SHIFT.toUpperCase(), issue: "late_pay" })).toMatchObject({
      ok: true,
      input: { shiftId: SHIFT },
    });
  });

  it("says what's missing or wrong", () => {
    expect(payQueryInput({})).toEqual({ ok: false, problems: ["no_shift_or_day", "no_issue"] });
    expect(payQueryInput({ shift: OTHER_DAY, issue: "late_pay" })).toEqual({
      ok: false,
      problems: ["no_shift_or_day"],
    });
    expect(payQueryInput({ shift: OTHER_DAY, day: "2026-02-30", issue: "late_pay" })).toEqual({
      ok: false,
      problems: ["bad_day"],
    });
    expect(payQueryInput({ shift: "not-a-shift", issue: "late_pay" })).toEqual({
      ok: false,
      problems: ["no_shift_or_day"],
    });
    expect(payQueryInput({ shift: SHIFT, issue: "other" })).toEqual({
      ok: false,
      problems: ["no_details"],
    });
    expect(payQueryInput({ shift: SHIFT, issue: "sick_pay" })).toEqual({
      ok: false,
      problems: ["no_issue"],
    });
    expect(payQueryInput({ shift: SHIFT, issue: "late_pay", details: "x".repeat(1001) })).toEqual({
      ok: false,
      problems: ["too_long"],
    });
  });

  it("plain words", () => {
    expect(Object.values(ISSUE_LABELS)).toEqual([
      "Hours missing",
      "Wrong rate",
      "Paid late or not paid",
      "Something else",
    ]);
    expect(PAY_QUERY_STATUS_WORDS).toEqual({
      open: "With payroll",
      in_digest: "With payroll",
      resolved: "Sorted",
    });
    expect(PROBLEM_WORDS.too_old).toBe(
      "Pay queries can go back 90 days. For anything older, contact the office.",
    );
  });
});
