import { describe, expect, it } from "vitest";
import {
  ageWords,
  CLOSE_REASON_WORDS,
  countsLine,
  OUTCOME_WORDS,
  planLine,
  sortedStep,
  thenStep,
} from "@/lib/office/enquiries-copy";
import {
  CLOSE_REASONS,
  enquiryOutcome,
  insideWhatsAppWindow,
  replyLine,
  replyPlan,
  WHATSAPP_WINDOW_MS,
  type OutcomeFacts,
} from "@/lib/office/enquiry-rules";
import { statusWord } from "@/lib/portal/request-kinds";

// Enquiries' rules (docs/office-v2.md 3.6; 12D.1): each outcome label from the facts logged about a
// message (never from AI), WhatsApp's 24-hour window at its edge, and how the office's reply goes.

const facts = (o: Partial<OutcomeFacts>): OutcomeFacts => ({
  handled: true,
  handledAs: "keyword",
  intent: "shifts",
  waiting: false,
  doneInApp: false,
  ...o,
});

describe("outcome labels, from logged facts only", () => {
  it.each([
    ["a keyword answered it", facts({}), "Answered by keyword"],
    [
      "STOP or START on a text",
      facts({ handledAs: "opt_out", intent: null }),
      "Answered by keyword",
    ],
    [
      "the AI sorted it, the app answered",
      facts({ handledAs: "ai", intent: "cancel" }),
      "Sorted by AI, answered from your data",
    ],
    ["pay, by keyword", facts({ intent: "pay" }), "Pay (always a person)"],
    ["pay, by AI", facts({ handledAs: "ai", intent: "pay" }), "Pay (always a person)"],
    [
      "asked for the office, waiting",
      facts({ intent: "office", waiting: true }),
      "Passed to a person, waiting",
    ],
    [
      "nothing sorted it, waiting",
      facts({ handledAs: "office", intent: "office", waiting: true }),
      "Passed to a person, waiting",
    ],
    [
      "an unknown number, waiting",
      facts({ handledAs: "unknown", intent: null, waiting: true }),
      "Passed to a person, waiting",
    ],
    [
      "an unknown number, dealt with",
      facts({ handledAs: "unknown", intent: null }),
      "Passed to a person, answered",
    ],
    [
      "for a person, answered",
      facts({ handledAs: "ai", intent: "office" }),
      "Passed to a person, answered",
    ],
    ["a shifts reply, then a booking in the app", facts({ doneInApp: true }), "Done in the app"],
    [
      "an AI cancel reply, then a cancellation in the app",
      facts({ handledAs: "ai", intent: "cancel", doneInApp: true }),
      "Done in the app",
    ],
    [
      "not sorted by the shifts line (yet)",
      facts({ handled: false, handledAs: null, intent: null }),
      "Not understood",
    ],
  ] as const)("%s", (_, f, label) => {
    expect(OUTCOME_WORDS[enquiryOutcome(f)]).toBe(label);
  });

  it("a person's message never reads as done in the app, and pay never as answered by keyword", () => {
    expect(enquiryOutcome(facts({ intent: "office", doneInApp: true }))).toBe("person_answered");
    expect(enquiryOutcome(facts({ intent: "pay", doneInApp: true }))).toBe("pay");
  });
});

describe("WhatsApp's 24-hour window", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("is open until just before 24 hours, and closed at exactly 24 hours", () => {
    expect(insideWhatsAppWindow(ago(0), now)).toBe(true);
    expect(insideWhatsAppWindow(ago(WHATSAPP_WINDOW_MS - 1), now)).toBe(true);
    expect(insideWhatsAppWindow(ago(WHATSAPP_WINDOW_MS), now)).toBe(false);
    expect(insideWhatsAppWindow(ago(WHATSAPP_WINDOW_MS + 1), now)).toBe(false);
  });

  it("is closed with no WhatsApp from them, and for one dated after now", () => {
    expect(insideWhatsAppWindow(null, now)).toBe(false);
    expect(insideWhatsAppWindow(new Date(now.getTime() + 1000), now)).toBe(false);
  });
});

describe("how the office's reply goes", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const hour = 3_600_000;
  const recent = new Date(now.getTime() - hour);
  const old = new Date(now.getTime() - WHATSAPP_WINDOW_MS);
  const casual = (notifyChannel: "whatsapp" | "sms", smsAllowed = true) => ({
    notifyChannel,
    smsAllowed,
  });
  const plan = (o: Partial<Parameters<typeof replyPlan>[0]>) =>
    replyPlan({
      channel: "whatsapp",
      from: "+447700900123",
      casual: null,
      lastWhatsAppAt: recent,
      now,
      ...o,
    });

  it("a WhatsApp: their words inside the window, the template outside it", () => {
    expect(plan({})).toEqual({ ok: true, channel: "whatsapp", form: "free_text" });
    expect(plan({ lastWhatsAppAt: old })).toEqual({
      ok: true,
      channel: "whatsapp",
      form: "template",
    });
    expect(plan({ casual: casual("sms"), lastWhatsAppAt: old })).toMatchObject({
      channel: "whatsapp",
      form: "template",
    });
  });

  it("a text: their words by text (no window), never after STOP", () => {
    expect(plan({ channel: "sms", lastWhatsAppAt: null })).toEqual({
      ok: true,
      channel: "sms",
      form: "free_text",
    });
    expect(plan({ channel: "sms", casual: casual("sms", false) })).toEqual({
      ok: false,
      why: "texts_off",
    });
  });

  it("a voicemail: the casual's own channel (WhatsApp after STOP); an unknown caller by WhatsApp", () => {
    expect(plan({ channel: "voice", casual: casual("sms"), lastWhatsAppAt: null })).toEqual({
      ok: true,
      channel: "sms",
      form: "free_text",
    });
    expect(plan({ channel: "voice", casual: casual("sms", false), lastWhatsAppAt: null })).toEqual({
      ok: true,
      channel: "whatsapp",
      form: "template",
    });
    expect(plan({ channel: "voice", casual: casual("whatsapp") })).toMatchObject({
      channel: "whatsapp",
      form: "free_text",
    });
    expect(plan({ channel: "voice", lastWhatsAppAt: null })).toMatchObject({
      channel: "whatsapp",
      form: "template",
    });
  });

  it("a withheld number can't be answered", () => {
    expect(plan({ channel: "voice", from: null })).toEqual({ ok: false, why: "withheld" });
  });

  it("the page says how it will go, in one line", () => {
    expect(planLine(plan({}))).toBe("Inside WhatsApp's 24-hour window: your words go as they are.");
    expect(planLine(plan({ lastWhatsAppAt: old }))).toMatch(
      /^Outside WhatsApp's 24-hour window: it goes as the request update template/,
    );
    expect(planLine(plan({ channel: "sms" }))).toBe("By text: your words go as they are.");
    expect(planLine({ ok: false, why: "withheld" })).toMatch(/withheld/);
    expect(planLine({ ok: false, why: "texts_off" })).toMatch(/STOP/);
  });

  it("the office's words go on one line", () => {
    expect(replyLine("  Yes,\n\n parking is   free.\t")).toBe("Yes, parking is free.");
  });
});

describe("words", () => {
  it("close reasons: the fixed list, each with words", () => {
    expect(CLOSE_REASONS).toEqual(["by_phone", "not_for_us", "duplicate", "spam", "other"]);
    expect(CLOSE_REASONS.map((r) => CLOSE_REASON_WORDS[r])).toEqual([
      "Dealt with by phone",
      "Not for us",
      "Duplicate",
      "Spam",
      "Other",
    ]);
  });

  it("counts: today, and need a person with the oldest one's age", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(countsLine(18, { count: 2, oldestAt: new Date("2026-10-10T08:25:00Z") }, now)).toBe(
      "18 enquiries today · 2 need a person, the oldest 3 h 35 min ago",
    );
    expect(countsLine(1, { count: 0, oldestAt: null }, now)).toBe(
      "1 enquiry today · none need a person",
    );
    expect(countsLine(0, { count: 1, oldestAt: new Date("2026-10-10T11:48:00Z") }, now)).toBe(
      "0 enquiries today · 1 needs a person, the oldest 12 min ago",
    );
    expect([ageWords(30_000), ageWords(3_600_000), ageWords(3 * 86_400_000)]).toEqual([
      "under a minute",
      "1 h",
      "3 days",
    ]);
  });

  it("a voicemail and a photo say why they went to a person", () => {
    expect(sortedStep({ how: "person", why: "voicemail" })).toBe(
      "A voicemail: always passed to a person.",
    );
    expect(sortedStep({ how: "person", why: "no_text" })).toBe(
      "No text (a photo or file): passed to a person.",
    );
    expect(sortedStep({ how: "keyword", intent: "shifts" })).toBe('A keyword matched: "shifts".');
  });

  it("a failed office reply says it's back in Need a person", () => {
    const at = () => "10:02 on Sat 10 Oct";
    expect(
      thenStep(
        {
          kind: "office_reply",
          by: "Sam Rota",
          at: new Date(),
          channel: "whatsapp",
          form: "free_text",
          state: "failed",
          code: "timeout",
          fellBackFrom: null,
        },
        at,
        { firstName: "Zoe", shiftWords: () => "" },
      ),
    ).toBe(
      "Sam Rota replied at 10:02 on Sat 10 Oct (on WhatsApp, in their own words): not sent (timeout): it's back in Need a person.",
    );
  });

  it("a question the office approved reads Answered; other kinds keep Approved", () => {
    expect(statusWord("general", "approved")).toBe("Answered");
    expect(statusWord("general", "declined")).toBe("Declined");
    expect(statusWord("swap", "approved")).toBe("Approved");
    expect(statusWord("time_change", "open")).toBe("Waiting for the office");
  });
});
