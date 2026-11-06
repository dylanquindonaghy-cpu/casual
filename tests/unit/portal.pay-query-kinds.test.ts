import { describe, expect, it } from "vitest";
import {
  isPayQueryPath,
  ISSUE_LABELS,
  OTHER_DAY,
  PAY_QUERY_PATH,
  PAY_QUERY_STATUS_WORDS,
  payQueryInput,
  payQueryPath,
  preselectedShift,
  PROBLEM_LINKS,
  PROBLEM_WORDS,
  shiftParam,
} from "@/lib/portal/pay-query-kinds";

// The pay query form's check and words (src/lib/portal/pay-query-kinds.ts). The server checks the
// shift is the worker's and the day is in range (tests/integration/pay.queries.test.ts).

const SHIFT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

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
      resolved: "Answered by payroll",
    });
    expect(PROBLEM_WORDS.too_old).toBe(
      "Pay queries can go back 90 days. For anything older, message the office.",
    );
  });
});

// Phase 28.10 (docs/screens.md "### 28.10"): "message the office" is a link to Messages, never a
// dead end; ?shift= on /pay/query is a shift's id or nothing; the code step comes back only to
// /pay/query (tests/integration/portal.pay-query-p28.test.ts checks the shift is hers).
describe("the pay query's ways in and out (28.10)", () => {
  it("too old links 'message the office' to Messages", () => {
    const link = PROBLEM_LINKS.too_old;
    expect(link).toEqual({ text: "message the office", href: "/messages" });
    expect(PROBLEM_WORDS.too_old).toContain(link?.text);
    // No problem says 'contact the office'.
    for (const words of Object.values(PROBLEM_WORDS))
      expect(words).not.toMatch(/contact the office/i);
  });

  it("?shift= is a shift's id (lower case) or nothing", () => {
    expect(shiftParam(SHIFT)).toBe(SHIFT);
    expect(shiftParam(SHIFT.toUpperCase())).toBe(SHIFT);
    expect(shiftParam(` ${SHIFT} `)).toBe(SHIFT);
    for (const bad of [undefined, null, "", "not-a-shift", "1", [SHIFT], [SHIFT, SHIFT], 42, {}]) {
      expect(shiftParam(bad)).toBeNull();
    }
    expect(shiftParam(`${SHIFT}&next=https://evil.example`)).toBeNull();
  });

  it("the code step comes back only to /pay/query, keeping a shift's id", () => {
    expect(PAY_QUERY_PATH).toBe("/pay/query");
    expect(payQueryPath(SHIFT)).toBe(`/pay/query?shift=${SHIFT}`);
    expect(payQueryPath(undefined)).toBe("/pay/query");
    for (const crafted of [
      "https://evil.example",
      "//evil.example",
      "/office",
      "javascript:alert(1)",
      `${SHIFT}/../../office`,
      [SHIFT, "https://evil.example"],
    ]) {
      expect(payQueryPath(crafted)).toBe("/pay/query");
    }
    // The code card goes only where payQueryPath could have sent it.
    expect(isPayQueryPath(payQueryPath(SHIFT))).toBe(true);
    expect(isPayQueryPath("/pay/query")).toBe(true);
    for (const path of [
      "/pay",
      "/pay/query/",
      "/pay/query?next=/office",
      `/pay/query?shift=${SHIFT}&next=/office`,
      "/pay/query?shift=AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
      "https://evil.example/pay/query",
      "//evil.example/pay/query",
    ]) {
      expect(isPayQueryPath(path)).toBe(false);
    }
  });

  it("preselects only a shift in her list", () => {
    const mine = [{ shiftId: SHIFT }, { shiftId: OTHER }];
    expect(preselectedShift(mine, OTHER.toUpperCase())).toBe(OTHER);
    expect(preselectedShift(mine, STRANGER)).toBeNull();
    expect(preselectedShift(mine, "not-a-shift")).toBeNull();
    expect(preselectedShift(mine, undefined)).toBeNull();
    expect(preselectedShift([], SHIFT)).toBeNull();
  });
});
