import { describe, expect, it } from "vitest";
import { passesLogCheck } from "@/lib/events/record";
import { eventWords } from "@/lib/office/event-words";
import { strikeDecision, type StrikeDecision, type StrikeFacts } from "@/lib/strikes/decide";
import { applySetting } from "@/lib/onboarding/settings";
import { keepCoversLive, STRIKE_DEFAULTS, strikeSettings } from "@/lib/strikes/settings";
import {
  CANCEL_FOOTER,
  cancelledText,
  startsInText,
  STRIKE_WARNING_VERSION,
  strikeWarningText,
  warningKind,
  WHAT_HAPPENED_PROMPT,
} from "@/lib/strikes/words";

// Strikes on cancel (12C.1; docs/office-v2.md 3.5, 5.7 item 4): the rule, its words and the
// settings it reads. Pure.

// A casual's own cancellation of a booking they took, nothing changed since: the base case.
const own = (o: Partial<Extract<StrikeFacts, { cancelledBy: "worker" }>> = {}): StrikeFacts => ({
  cancelledBy: "worker",
  noticeHours: 20,
  thresholdHours: 48,
  booking: { by: "worker", overridden: false },
  changedAfterBooking: false,
  reason: "Travel problem",
  ...o,
});
const issued = (
  reviewReasons: Extract<StrikeDecision, { result: "strike" }>["reviewReasons"] = [],
): StrikeDecision => ({ result: "strike", code: "issued", reviewReasons });

describe("strikeDecision(), case by case", () => {
  it.each<[string, StrikeFacts, ReturnType<typeof strikeDecision>]>([
    [
      "cancelled by the office, the planner or the sheet",
      { cancelledBy: "firm" },
      { result: "none", code: "by_firm" },
    ],
    [
      "48 hours' notice exactly",
      own({ noticeHours: 48 }),
      { result: "none", code: "enough_notice" },
    ],
    [
      "more than 48 hours' notice",
      own({ noticeHours: 200 }),
      { result: "none", code: "enough_notice" },
    ],
    ["47.99 hours' notice", own({ noticeHours: 47.99 }), issued()],
    ["less than an hour's notice", own({ noticeHours: 0.25 }), issued()],
    [
      "booked by the office (Assign, the rota sheet)",
      own({ booking: { by: "office", overridden: false } }),
      { result: "exempt", code: "booked_by_office" },
    ],
    [
      "booked by the office over a rest or hours check",
      own({ booking: { by: "office", overridden: true } }),
      { result: "exempt", code: "rules_override" },
    ],
    [
      "changed by the office or the planner after booking",
      own({ changedAfterBooking: true }),
      { result: "exempt", code: "changed_after_booking" },
    ],
    // The office's booking comes first: changed or not, it's the office's.
    [
      "booked by the office and changed afterwards",
      own({ booking: { by: "office", overridden: false }, changedAfterBooking: true }),
      { result: "exempt", code: "booked_by_office" },
    ],
    // Enough notice comes before everything after it.
    [
      "enough notice on an office booking",
      own({ noticeHours: 60, booking: { by: "office", overridden: true } }),
      { result: "none", code: "enough_notice" },
    ],
    ["I'm unwell: flagged for review", own({ reason: "I'm unwell" }), issued(["unwell"])],
    [
      "Family or caring: flagged for review",
      own({ reason: "Family or caring" }),
      issued(["family_or_caring"]),
    ],
    ["Travel problem: not flagged", own({ reason: "Travel problem" }), issued()],
    ["Something else: not flagged", own({ reason: "Something else: I'm unwell really" }), issued()],
    ["no reason yet (the warning): not flagged", own({ reason: null }), issued()],
    // A session taken inside 48 hours is flagged for nothing (that flag was cut).
    ["a session taken 20 hours before and cancelled at 19", own({ noticeHours: 19 }), issued()],
    // The firm's own threshold.
    [
      "24-hour threshold, 30 hours' notice",
      own({ noticeHours: 30, thresholdHours: 24 }),
      { result: "none", code: "enough_notice" },
    ],
    ["72-hour threshold, 60 hours' notice", own({ noticeHours: 60, thresholdHours: 72 }), issued()],
    // The firm's strikes switch (P3.4): off, a casual's own cancellation is never a strike, whatever
    // the notice; the office's is still the office's.
    [
      "strikes switched off, 1 hour's notice",
      own({ noticeHours: 1, strikesOff: true }),
      { result: "none", code: "strikes_off" },
    ],
    [
      "strikes switched off, booked by the office",
      own({ booking: { by: "office", overridden: false }, strikesOff: true }),
      { result: "none", code: "strikes_off" },
    ],
  ])("%s", (_name, facts, expected) => {
    expect(strikeDecision(facts)).toEqual(expected);
  });
});

describe("the warning on the cancel step", () => {
  const facts = {
    hoursToStart: 26.7,
    thresholdHours: 48,
    firmName: "Acme Events",
    liveStrikes: 0,
    liveDays: 90,
  };

  it("is the one the decision gives", () => {
    expect(warningKind(strikeDecision(own()))).toBe("strike");
    expect(warningKind(strikeDecision(own({ changedAfterBooking: true })))).toBe("exempt");
    expect(warningKind(strikeDecision(own({ booking: { by: "office", overridden: true } })))).toBe(
      "exempt",
    );
    expect(warningKind(strikeDecision(own({ noticeHours: 120 })))).toBe("notice");
    // Strikes off: the plain notice words, never a strike warning (P3.4).
    expect(warningKind(strikeDecision(own({ strikesOff: true })))).toBe("notice");
    expect(STRIKE_WARNING_VERSION).toBe("v1");
  });

  it("a strike: the hours, the threshold, the strikes team, their live strikes", () => {
    expect(strikeWarningText("strike", facts)).toBe(
      "This shift starts in 26 hours. Cancelling with less than 48 hours' notice gives you a strike. Acme Events' strikes team gets a record of it. You have 0 strikes in the last 90 days.",
    );
    expect(
      strikeWarningText("strike", {
        ...facts,
        hoursToStart: 0.4,
        firmName: "Northline Security",
        liveStrikes: 1,
      }),
    ).toBe(
      "This shift starts in less than an hour. Cancelling with less than 48 hours' notice gives you a strike. Northline Security's strikes team gets a record of it. You have 1 strike in the last 90 days.",
    );
  });

  it("exempt and enough notice", () => {
    expect(strikeWarningText("exempt", facts)).toBe(
      "The office booked or changed this shift, so cancelling doesn't give you a strike.",
    );
    expect(strikeWarningText("notice", { ...facts, hoursToStart: 130 })).toBe(
      "This shift starts in 5 days. Cancelling now doesn't give you a strike.",
    );
    expect(strikeWarningText("notice", { ...facts, hoursToStart: 30, thresholdHours: 24 })).toBe(
      "This shift starts in 30 hours. Cancelling now doesn't give you a strike.",
    );
  });

  it("counts down whole hours, then days", () => {
    expect(startsInText(0.99)).toBe("less than an hour");
    expect(startsInText(1)).toBe("1 hour");
    expect(startsInText(47.99)).toBe("47 hours");
    expect(startsInText(48)).toBe("2 days");
    expect(startsInText(71.9)).toBe("2 days");
  });

  it("the footer and the done screen", () => {
    expect(CANCEL_FOOTER).toBe(
      "Your cancellation is recorded the moment you confirm. Nobody needs to approve it.",
    );
    expect(cancelledText("3F2A9C1B", { until: "Sun 31 Jan" })).toBe(
      "Cancelled. Reference 3F2A9C1B. A strike has been recorded. It counts until Sun 31 Jan.",
    );
    expect(cancelledText("3F2A9C1B", null)).toBe("Cancelled. Reference 3F2A9C1B. No strike.");
    expect(WHAT_HAPPENED_PROMPT).toBe("If something stopped you, tell us what happened.");
  });
});

describe("the strike settings", () => {
  it("read the owner's values in range, otherwise the defaults (on, 48 hours, 90 days, 12 months)", () => {
    expect(strikeSettings({})).toEqual(STRIKE_DEFAULTS);
    expect(STRIKE_DEFAULTS).toEqual({
      enabled: true,
      noticeHours: 48,
      liveDays: 90,
      keepMonths: 12,
    });
    expect(
      strikeSettings({
        strikes: { notice_hours: 24, live_days: 60, keep_months: 18, email: "x@example.com" },
      }),
    ).toEqual({ enabled: true, noticeHours: 24, liveDays: 60, keepMonths: 18 });
    // Switched off only by false (P3.4); anything else leaves them on.
    expect(strikeSettings({ strikes: { enabled: false } }).enabled).toBe(false);
    for (const enabled of [true, "false", 0, null]) {
      expect(strikeSettings({ strikes: { enabled } }).enabled, String(enabled)).toBe(true);
    }
    // Never inside the 6-month tribunal limit; whole numbers only; nothing silly.
    expect(
      strikeSettings({ strikes: { notice_hours: 0, live_days: 1000, keep_months: 6 } }),
    ).toEqual(STRIKE_DEFAULTS);
    expect(
      strikeSettings({ strikes: { notice_hours: 12.5, live_days: "30", keep_months: null } }),
    ).toEqual(STRIKE_DEFAULTS);
    expect(strikeSettings({ strikes: "nonsense" })).toEqual(STRIKE_DEFAULTS);
  });

  it("firm:settings keeps a strike's record at least 6 months past the time it counts", () => {
    expect(keepCoversLive(STRIKE_DEFAULTS)).toBe(true);
    // Counting 90 days: 10 months is the shortest (4 months of 28 days covers 90 days).
    expect(applySetting({}, "strikes.keep_months", "10")).toEqual({ strikes: { keep_months: 10 } });
    expect(applySetting({}, "strikes.keep_months", "9")).toBeNull();
    // Counting a year needs 6 + 14 months.
    expect(applySetting({ strikes: { keep_months: 18 } }, "strikes.live_days", "365")).toBeNull();
    expect(applySetting({ strikes: { keep_months: 20 } }, "strikes.live_days", "365")).toEqual({
      strikes: { keep_months: 20, live_days: 365 },
    });
    // The strikes team's email beside them is kept as it is.
    expect(
      applySetting({ strikes: { email: "team@example.com" } }, "strikes.notice_hours", "24"),
    ).toEqual({ strikes: { email: "team@example.com", notice_hours: 24 } });
  });
});

describe("the log entry", () => {
  it("strike.issued: ids and hours only, passing the log check, in plain words", () => {
    const data = {
      assignmentId: "11111111-1111-4111-8111-111111111111",
      shiftId: "22222222-2222-4222-8222-222222222222",
      workerId: "33333333-3333-4333-8333-333333333333",
      noticeHours: 19,
      thresholdHours: 48,
    };
    expect(passesLogCheck(data)).toBe(true);
    expect(
      eventWords(
        { action: "strike.issued", actorType: "system", actorId: null, data },
        { worker: () => "Ann Booker", office: () => "Sam Rota" },
      ),
    ).toBe("Ann Booker got a strike for cancelling with 19 hours' notice (under 48 hours).");
    // A firm's cancellation says it isn't one.
    expect(strikeDecision({ cancelledBy: "firm" }).code).toBe("by_firm");
  });
});
