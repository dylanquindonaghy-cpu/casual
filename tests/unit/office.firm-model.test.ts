import { describe, expect, it } from "vitest";
import { createFakeAi, type AiRequest } from "@/lib/ai/client";
import {
  checkedLine,
  codeSummary,
  summarisePayGroup,
  type PayGroupFacts,
} from "@/lib/ai/pay-summary";
import { requirementChip } from "@/lib/credentials/requirements";
import { eventWords } from "@/lib/office/event-words";
import {
  cancelBookingResultText,
  cancelShiftResultText,
  importResultLines,
} from "@/lib/office/shifts-copy";
import { payCalendar, payPeriod, payPeriodName } from "@/lib/pay/calendar";
import { payDayFallbackText, payPeriodLabel } from "@/lib/pay/pay-week";
import { sheetRoleText } from "@/lib/roster/sheets/parse";

// The firm's model on the office's screens (Phase 25.2; docs/screens.md "The firm's model on the
// office's screens"; the mock-up approved by Dylan, 2026-10-30): the pay cycle in the firm's own
// word, "SIA SG or SIA DS", the name map's words, the import's left-out rows and the cancel forms'
// "who asked". A weekly firm with no name map reads as before.

const fortnight = payCalendar({
  pay_calendar: { days: 14, anchor: "2026-01-05", pay_day_after: 5, label: "cycle" },
});

describe("the pay cycle in the office", () => {
  it("its name, its line and the pay day's fallback, in the firm's word", () => {
    const cycle = payPeriod("2026-10-30", fortnight);
    expect(payPeriodName(cycle)).toBe("Cycle 22");
    expect(payPeriodName(payPeriod("2026-10-30", payCalendar({})))).toBe("Week 44");
    expect(payPeriodName(payPeriod("2026-01-02", fortnight))).toBe("Cycle"); // before the anchor
    expect(payPeriodLabel({ ...cycle, name: payPeriodName(cycle) })).toBe(
      "Cycle 22 · 26 Oct – 8 Nov · Pay Fri 13 Nov",
    );
    expect(payDayFallbackText({ label: "week", payDay: "2026-11-06" })).toBe(
      "The Friday after this week. No later pay date is in your pay records.",
    );
    expect(payDayFallbackText({ label: "cycle", payDay: "2026-11-12" })).toBe(
      "The Thursday after this cycle. No later pay date is in your pay records.",
    );
  });

  it("payroll's headings and the digest: the cycle of …; the AI is told it's a cycle", async () => {
    const facts: PayGroupFacts = {
      count: 14,
      issue: "wrong_rate",
      week: "2026-10-12",
      site: null,
      ratesPence: [1300],
    };
    expect(codeSummary(facts)).toBe(
      "14 queries: wrong rate, the week of Mon 12 Oct, paid at £13.00.",
    );
    expect(codeSummary({ ...facts, label: "cycle" })).toBe(
      "14 queries: wrong rate, the cycle of Mon 12 Oct, paid at £13.00.",
    );
    const seen: AiRequest[] = [];
    const line = "14 queries about the cycle starting Mon 12 Oct: the rate shown is £13.00.";
    const ai = createFakeAi((request) => {
      seen.push(request);
      return line;
    });
    expect(await summarisePayGroup({ ...facts, label: "cycle" }, ai)).toEqual({
      text: line,
      byAi: true,
    });
    expect(JSON.parse(seen[0]?.prompt ?? "{}")).toEqual({
      queries: 14,
      issue: "Wrong rate",
      payCycleStarting: "Mon 12 Oct",
      site: null,
      paidAt: ["£13.00"],
    });
    expect(
      checkedLine(codeSummary({ ...facts, label: "cycle" }), { ...facts, label: "cycle" }),
    ).toBe(codeSummary({ ...facts, label: "cycle" }));
    // Only the firm's own word: a fortnight is never called a week, nor a week a cycle.
    expect(
      checkedLine("14 queries about the week starting Mon 12 Oct.", { ...facts, label: "cycle" }),
    ).toBeNull();
    expect(checkedLine("14 queries about the cycle starting Mon 12 Oct.", facts)).toBeNull();
    expect(checkedLine("14 queries about the week starting Mon 12 Oct.", facts)).toBe(
      "14 queries about the week starting Mon 12 Oct.",
    );
  });
});

describe("a session that takes any one of a group", () => {
  it("the office's chip says either; one type alone as before", () => {
    const sg = { code: "SIA_SG", name: "SIA security guard licence" };
    const ds = { code: "SIA_DS", name: "SIA door supervisor licence" };
    expect(requirementChip(sg)).toBe("SIA SG");
    expect(requirementChip({ ...sg, group: [sg, ds] })).toBe("SIA SG or SIA DS");
    const third = { code: "CSAS", name: "community safety accreditation" };
    expect(requirementChip({ ...sg, group: [sg, ds, third] })).toBe("SIA SG, SIA DS or CSAS");
  });
});

describe("the name map in the action log", () => {
  const names = { worker: () => "Ann Booker", office: () => "Sam Rota" };
  const say = (data: Record<string, unknown>) =>
    eventWords(
      { action: "firm.settings_changed", actorType: "system", actorId: null, data },
      names,
    );

  it("which name, read as what; a change, a skip, a removal, a pay rate", () => {
    const role = (from: unknown, to: unknown, more: Record<string, unknown> = {}) =>
      say({ keys: ["name_map.role"], name: "12d", from, to, ...more });
    expect(role(null, "door_supervisor")).toBe(
      'The name map now reads the role "12d" as door supervisor.',
    );
    expect(role("steward", "door_supervisor")).toBe(
      'The name map now reads the role "12d" as door supervisor (it was steward).',
    );
    expect(role(null, "skip")).toBe('The name map now skips the role "12d".');
    expect(role("door_supervisor", "skip")).toBe(
      'The name map now skips the role "12d" (it was door supervisor).',
    );
    expect(role("skip", null)).toBe(
      'The name map no longer reads the role "12d". It\'s read as before.',
    );
    expect(role(null, "door_supervisor", { fromRatePence: null, toRatePence: 1250 })).toBe(
      'The name map now reads the role "12d" as door supervisor, paid £12.50 an hour.',
    );
    expect(
      say({ keys: ["name_map.qualification"], name: "door sup", from: null, to: "SIA_DS" }),
    ).toBe('The name map now reads the qualification "door sup" as SIA DS.');
    expect(
      say({ keys: ["name_map.cancellation_reason"], name: "client cxl", from: null, to: "client" }),
    ).toBe('The name map now reads the cancellation reason "client cxl" as client.');
    // Other settings keep their words.
    expect(say({ keys: ["wave_size", "wave_minutes"] })).toBe(
      "The firm's settings changed (2 settings).",
    );
    expect(say({ keys: ["name_map.role", "wave_size"] })).toBe(
      "The firm's settings changed (2 settings).",
    );
  });
});

describe("the shift import's rows the name map skips", () => {
  const done = (dryRun: boolean, ignored?: number) =>
    importResultLines({
      status: "done",
      result: {
        kind: "shifts",
        dryRun,
        created: 2,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        ...(ignored === undefined ? {} : { ignored }),
        problems: [{ row: 4, problem: "bad_role" }],
      },
    });

  it("left out, after the counts; nothing said when there are none", () => {
    expect(done(true, 1).slice(0, 2)).toEqual([
      "This file would add 2 shifts, change 0, leave 0 as they are and skip 0.",
      "It would leave out 1 row your name map skips.",
    ]);
    expect(done(false, 2)[1]).toBe("Left out 2 rows your name map skips.");
    expect(done(true)).toHaveLength(2); // the counts and the problem only
  });
});

describe("the office's cancel forms ask who asked", () => {
  it("skipped: the form says so and nothing is cancelled", () => {
    expect(cancelShiftResultText({ status: "no_asker" })).toBe("Choose who asked for it.");
    expect(cancelBookingResultText({ status: "no_asker" }, "Ann Booker")).toBe(
      "Choose who asked for it.",
    );
    expect(cancelShiftResultText({ status: "no_reason" })).toBe("Choose a reason.");
  });
});

describe("a rota sheet's role cell, kept for Needs attention", () => {
  it("no control or format characters, one space between words, at most 200 characters", () => {
    expect(sheetRoleText("  Door\u0007Supervisor ­ (NLW) ")).toBe("Door Supervisor (NLW)");
    expect(sheetRoleText("​\t ")).toBeNull();
    expect(sheetRoleText("")).toBeNull();
    const long = "é".repeat(250);
    expect(sheetRoleText(long)).toBe("é".repeat(200));
    // Counted in characters, not code units: an emoji is one.
    expect(Array.from(sheetRoleText("🚧".repeat(250)) ?? "")).toHaveLength(200);
  });

  it("never a phone number or an email address typed into it by mistake", () => {
    expect(sheetRoleText("cover for Priya 07700 900123")).toBeNull();
    expect(sheetRoleText("+44 7700 900123")).toBeNull();
    expect(sheetRoleText("ask ann@example.com")).toBeNull();
    // A role's own digits are kept.
    expect(sheetRoleText("12D")).toBe("12D");
    expect(sheetRoleText("Steward 2026 (L2)")).toBe("Steward 2026 (L2)");
  });
});
