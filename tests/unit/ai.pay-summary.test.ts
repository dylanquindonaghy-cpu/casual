import { describe, expect, it, vi } from "vitest";
import { AiUnavailableError, createFakeAi, noAi, type AiRequest } from "@/lib/ai/client";
import {
  AI_SUMMARY_TIMEOUT_MS,
  checkedLine,
  codeSummary,
  summarisePayGroup,
  type PayGroupFacts,
} from "@/lib/ai/pay-summary";

// The one-line summary per pay query group (src/lib/ai/pay-summary.ts): the AI's line only if it
// passes the check, otherwise a line written by code; the AI sees the facts only.

const wrongRate: PayGroupFacts = {
  count: 37,
  issue: "wrong_rate",
  week: "2026-09-07",
  site: null,
  ratesPence: [1250],
};

describe("pay group summaries", () => {
  it("the code's line, for each kind of group", () => {
    expect(codeSummary(wrongRate)).toBe(
      "37 queries: wrong rate, the week of Mon 7 Sep, paid at £12.50.",
    );
    expect(codeSummary({ ...wrongRate, count: 1, ratesPence: [] })).toBe(
      "1 query: wrong rate, the week of Mon 7 Sep, no pay line imported for the day.",
    );
    expect(
      codeSummary({
        count: 4,
        issue: "missing_hours",
        week: "2026-09-07",
        site: "Riverside Arena",
        ratesPence: null,
      }),
    ).toBe("4 queries: hours missing, the week of Mon 7 Sep, at Riverside Arena.");
    expect(
      codeSummary({
        count: 2,
        issue: "late_pay",
        week: "2026-09-07",
        site: null,
        ratesPence: null,
      }),
    ).toBe("2 queries: paid late or not paid, the week of Mon 7 Sep.");
  });

  it("with no AI connected (today), the code's line", async () => {
    await expect(
      noAi.complete({ purpose: "pay_group_summary", system: "", prompt: "", maxTokens: 1 }),
    ).rejects.toThrow(AiUnavailableError);
    expect(await summarisePayGroup(wrongRate, noAi)).toEqual({
      text: codeSummary(wrongRate),
      byAi: false,
    });
  });

  it("a good AI line is used, and the AI is given the facts only", async () => {
    const seen: AiRequest[] = [];
    const ai = createFakeAi((request) => {
      seen.push(request);
      return "37 queries: the £12.50 rate still used for the week of Mon 7 Sep.";
    });
    expect(await summarisePayGroup(wrongRate, ai)).toEqual({
      text: "37 queries: the £12.50 rate still used for the week of Mon 7 Sep.",
      byAi: true,
    });
    expect(JSON.parse(seen[0]?.prompt ?? "{}")).toEqual({
      queries: 37,
      issue: "Wrong rate",
      weekStarting: "Mon 7 Sep",
      site: null,
      paidAt: ["£12.50"],
    });
    expect(seen[0]).toMatchObject({ purpose: "pay_group_summary", maxTokens: 80 });
  });

  it("an AI line that fails the check, or an AI failure, falls back to the code's line", async () => {
    const fallback = { text: codeSummary(wrongRate), byAi: false };
    for (const bad of [
      "",
      "ok",
      "x".repeat(161),
      "Line one\nLine two",
      "37 queries: pay them £15.00 each.", // a number that isn't in the facts
      "Most of the 40 staff were underpaid.",
      "Payroll should fix the rate for these staff.", // advice
      "A mistake in the rate table caused this.", // blame
    ]) {
      expect(
        await summarisePayGroup(
          wrongRate,
          createFakeAi(() => bad),
        ),
        bad,
      ).toEqual(fallback);
    }
    const broken = createFakeAi(() => {
      throw new Error("timed out");
    });
    expect(await summarisePayGroup(wrongRate, broken)).toEqual(fallback);
  });

  it("the check keeps numbers to those in the facts", () => {
    expect(checkedLine("  37 queries about the Mon 7 Sep week at £12.50  ", wrongRate)).toBe(
      "37 queries about the Mon 7 Sep week at £12.50",
    );
    expect(checkedLine("38 queries about the rate", wrongRate)).toBeNull();
  });

  it("leaves no timer running once it has an answer, or has given up", async () => {
    vi.useFakeTimers();
    try {
      const quick = createFakeAi(() => "37 queries: the week of Mon 7 Sep still paid at £12.50.");
      const summary = await summarisePayGroup(wrongRate, quick);
      expect(summary.byAi).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      const hangs = createFakeAi(() => new Promise<string>(() => undefined));
      const pending = summarisePayGroup(wrongRate, hangs);
      await vi.advanceTimersByTimeAsync(AI_SUMMARY_TIMEOUT_MS);
      expect((await pending).byAi).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
