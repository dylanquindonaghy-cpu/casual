import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sortMessage } from "@/lib/ai/classify-message";
import { createFakeAi, noAi, type AiRequest } from "@/lib/ai/client";
import { DRAFT_MAX, draftEmailReply } from "@/lib/ai/draft-reply";
import { aboutMoney } from "@/lib/email/sort";
import { summarySlotOf } from "@/lib/email/summary";
import { createConsoleTransport } from "@/lib/messaging/console";
import { smtpMailOptions } from "@/lib/messaging/smtp";
import type { EnquiryRow } from "@/lib/office/enquiries";
import {
  attachmentsLine,
  EMAIL_DRAFT_NOTE,
  EMAIL_NO_TEXT,
  EMAIL_PAY_NO_DRAFT,
  EMAIL_REPLY_BUTTON,
  EMAIL_REPLY_LABEL,
  emailReceivedStep,
  emailReplyByLine,
  emailReplyHint,
  emailReplyResultText,
  emailReplyStep,
  emailSentStep,
  emailSortedStep,
  emailTitle,
  emptyTodayText,
  enquiriesEmptyText,
  NO_SUBJECT,
  NOT_CASUAL_ROW,
  notCasualText,
  OUTCOME_WORDS,
  subjectLine,
  thenStep,
  whoName,
} from "@/lib/office/enquiries-copy";
import { EMAIL_REPLY_MAX, emailReplyText, enquiryOutcome } from "@/lib/office/enquiry-rules";
import { eventWords } from "@/lib/office/event-words";

// The staffing inbox in Enquiries (P7.4, P7.5; Phase 25.5): every line the office reads, as
// docs/screens.md "The staffing inbox in Enquiries" has it; the AI's draft (only ever a draft for
// the office, never about money); the 3-hour slots across a clock change; the Reply-To on the email
// that goes; and an email's row and reply form as they're drawn. Made-up people only.

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));
const { EnquiryItem } = await import("@/app/office/enquiries/enquiry-row");
const { EmailForms } = await import("@/app/office/enquiries/[id]/email-forms");

const screens = readFileSync("docs/screens.md", "utf8").replace(/\s+/g, " ");
const start = screens.indexOf("**The staffing inbox in Enquiries");
const part = screens
  .slice(start, screens.indexOf("| Route | Screen |", start))
  .replace(/\\"/g, '"')
  .replace(/[{}]/g, "");
const inDoc = (line: string) => expect(part, line).toContain(line.replace(/[{}]/g, ""));

const AT = new Date("2026-11-02T09:14:00Z");
const at = () => "09:14 on Mon 2 Nov";
const priya = { kind: "casual" as const, name: "Priya Shah", active: true };
const stranger = { kind: "unknown_address" as const, from: "name@example.com" };

describe("an email's words on Enquiries", () => {
  it("the list's: who, the chip, the subject, no text, not from a casual", () => {
    expect(start).toBeGreaterThan(0);
    expect(whoName(stranger)).toBe("Unknown address");
    inDoc('"Unknown address"');
    expect(OUTCOME_WORDS.inbox).toBe("Left for your inbox");
    inDoc(`the chip "${OUTCOME_WORDS.inbox}"`);
    inDoc(`("${NO_SUBJECT}")`);
    inDoc(`"${EMAIL_NO_TEXT}"`);
    inDoc(`"${NOT_CASUAL_ROW}"`);
    // An email not from a casual is left for the inbox, never a person's (a message's is).
    const facts = { handled: true, handledAs: "unknown" as const, intent: null, waiting: false };
    expect(enquiryOutcome({ ...facts, doneInApp: false, email: true })).toBe("inbox");
    expect(enquiryOutcome({ ...facts, doneInApp: false, waiting: true })).toBe("person_waiting");
  });

  it("a firm with an inbox: the empty lists name it", () => {
    for (const line of [
      enquiriesEmptyText("all", 90, true),
      emptyTodayText(true),
      enquiriesEmptyText("person", 90, true),
    ]) {
      inDoc(line);
    }
    expect(enquiriesEmptyText("all", 90)).toBe(
      "No messages to the shifts line in the last 90 days.",
    );
    expect(emptyTodayText(false)).toBe("Nothing to the shifts line today.");
    expect(enquiriesEmptyText("pay", 30, true)).toBe("No pay messages in the last 30 days.");
  });

  it("one email: its title, the email, its replies", () => {
    expect(emailTitle(priya)).toBe("Email from Priya Shah");
    expect(emailTitle(stranger)).toBe("Email from an unknown address");
    inDoc('"Email from Priya Shah" / "Email from an unknown address"');
    expect(subjectLine("Saturday")).toBe("Subject: Saturday");
    expect(subjectLine(null)).toBe("Subject: (none)");
    inDoc('"Subject: subject" ("Subject: (none)")');
    expect(attachmentsLine(2)).toBe("2 attachments left out: attachments are never kept.");
    expect(attachmentsLine(1)).toBe("1 attachment left out: attachments are never kept.");
    inDoc('"2 attachments left out: attachments are never kept." ("1 attachment")');
    inDoc(notCasualText("name@example.com"));
    expect(emailReplyByLine({ automatic: true, by: null, state: "sent" })).toBe("Automatic reply");
    expect(emailReplyByLine({ automatic: false, by: "Sam Rota", state: "sending" })).toBe(
      "Sam Rota · Sending",
    );
    expect(emailReplyByLine({ automatic: false, by: null, state: "failed" })).toBe(
      "The office · Not sent",
    );
    expect(emailReplyByLine({ automatic: false, by: "Sam Rota", state: "unconfirmed" })).toBe(
      "Sam Rota · Not confirmed",
    );
    inDoc('"Automatic reply · 09:14 on Mon 2 Nov" / "Sam Rota · 09:14 on Mon 2 Nov"');
    inDoc('(+ " · Sending" / " · Not sent" / " · Not confirmed")');
  });

  it("How it was answered: each step's words", () => {
    expect(emailReceivedStep({ at: AT, who: priya }, at)).toBe(
      "Email at 09:14 on Mon 2 Nov, from Priya Shah's address.",
    );
    inDoc('"Received: Email at time, from Priya Shah\'s address."');
    expect(emailReceivedStep({ at: AT, who: { ...priya, active: false } }, at)).toContain(
      "address (not active).",
    );
    expect(emailReceivedStep({ at: AT, who: stranger }, at)).toBe(
      "Email at 09:14 on Mon 2 Nov, from name@example.com, an address that isn't one of your casuals'.",
    );
    inDoc(`"from address, an address that isn't one of your casuals'."`);
    const sorted = [
      emailSortedStep({ how: "stale" }),
      emailSortedStep({ how: "not_casual" }),
      emailSortedStep({ how: "former" }),
      emailSortedStep({ how: "failed", code: "08006" }).replace("08006", "code"),
      emailSortedStep({ how: "limit", by: "keyword", intent: "shifts" }).replace(
        'A keyword matched: "shifts". ',
        "",
      ),
      emailSortedStep({ how: "not_yet" }),
    ];
    for (const line of sorted) inDoc(line);
    // A message's lines for the rest.
    expect(emailSortedStep({ how: "held", by: "ai", intent: "cancel" })).toBe(
      'AI sorted it as "cancel". Automatic replies are off, so it was passed to a person.',
    );
    expect(emailSortedStep({ how: "keyword", intent: "shifts" })).toBe(
      'A keyword matched: "shifts".',
    );
    expect(emailSortedStep({ how: "no_address", by: "ai", intent: "pay" })).toBe(
      'AI sorted it as "pay". There\'s no email address on file for them: passed to a person.',
    );
    for (const answer of ["shifts", "cancel", "pay"] as const) {
      inDoc(emailReplyStep({ how: "automatic", answer }));
    }
    inDoc(emailReplyStep({ how: "held" }));
    inDoc(emailReplyStep({ how: "none" }));
    expect(emailSentStep({ how: "sent", at: AT }, at)).toBe(
      "Sent by email to their address on file at 09:14 on Mon 2 Nov.",
    );
    inDoc('"Sent by email to their address on file at time."');
    expect(emailSentStep({ how: "failed", code: "SmtpRefused", at: AT }, at)).toBe(
      "Not sent (SmtpRefused) at 09:14 on Mon 2 Nov.",
    );
    inDoc('"Not sent (code) at time."');
    expect(emailSentStep({ how: "none" }, at)).toBe("Nothing sent.");
    const reply = (form: "draft" | "edited" | "free_text") =>
      thenStep(
        {
          kind: "office_reply",
          by: "Sam Rota",
          at: AT,
          channel: "email",
          form,
          state: "sent",
          code: null,
          fellBackFrom: null,
        },
        at,
        { firstName: "Priya", shiftWords: () => "" },
      );
    expect(reply("draft")).toBe(
      "Sam Rota replied at 09:14 on Mon 2 Nov (by email, the AI's draft, checked by them): sent.",
    );
    expect(reply("edited")).toContain("(by email, from an AI draft they changed)");
    expect(reply("free_text")).toContain("(by email, in their own words)");
    inDoc(
      "\"Sam Rota replied at time (by email, the AI's draft, checked by them / by email, from an AI draft they changed / by email, in their own words)",
    );
  });

  it("Answer it: its words and its answers", () => {
    inDoc(`"${EMAIL_REPLY_LABEL}"`);
    inDoc(`"${EMAIL_DRAFT_NOTE}"`);
    inDoc(`"${EMAIL_PAY_NO_DRAFT}"`);
    expect(emailReplyHint("Priya", "Acme Events Shift Team")).toBe(
      'It goes to Priya\'s email address on file, signed "Acme Events Shift Team". Their reply comes back here.',
    );
    inDoc(emailReplyHint("Priya", "Acme Events Shift Team"));
    inDoc(`"${EMAIL_REPLY_BUTTON}"`);
    for (const status of [
      "queued",
      "empty",
      "too_long",
      "no_address",
      "not_waiting",
      "not_found",
      "not_allowed",
      "logged_out",
      "error",
    ] as const) {
      inDoc(emailReplyResultText({ status }, "Priya"));
    }
    expect(emailReplyResultText({ status: "no_address" }, "")).toBe(
      "They have no email address on file, so a reply can't go. Phone them, then close it.",
    );
  });

  it("the reply's text: its own lines, tidied, at most 2,000 characters", () => {
    expect(emailReplyText("  Yes.  \r\n\r\n\r\n\r\nSee you   Saturday.\t \n")).toBe(
      "Yes.\n\nSee you Saturday.",
    );
    expect(EMAIL_REPLY_MAX).toBe(2000);
  });
});

describe("the action log's words for the inbox", () => {
  const words = (action: string, data: Record<string, unknown>) =>
    eventWords(
      {
        action,
        data,
        actorType:
          action.startsWith("enquiry.") &&
          action !== "enquiry.reply_sent" &&
          action !== "enquiry.reply_failed"
            ? "office"
            : "system",
        actorId: "a",
      },
      { worker: () => "Priya Shah", office: () => "Sam Rota" },
    );

  it("each email.received, email.replied, email.reply_failed and the summary, in the doc", () => {
    const lines = [
      words("email.received", {
        handledAs: "keyword",
        intent: "office",
        replyHeld: true,
        sortedAs: "shifts",
        workerId: "w",
      }),
      words("email.received", { handledAs: "ai", intent: "office", workerId: "w" }),
      words("email.received", {
        handledAs: "office",
        intent: "office",
        stale: true,
        workerId: "w",
      }),
      words("email.received", {
        handledAs: "office",
        intent: "office",
        answerFailed: "08006",
        workerId: "w",
      }),
      words("email.received", { handledAs: "unknown", intent: null }),
      words("email.received", {
        handledAs: "office",
        intent: "office",
        formerWorker: true,
        workerId: "w",
      }),
      words("email.replied", { answer: "shifts", replyId: "r", workerId: "w" }),
      words("email.reply_failed", { answer: "shifts", code: "SmtpRefused", workerId: "w" }),
      words("message.inbox_summary", {
        received: 12,
        from: "09:00",
        to: "12:00",
        recipients: 2,
        failed: 0,
      }),
    ];
    expect(lines).toEqual([
      "Priya Shah emailed the staffing inbox (open shifts). No automatic reply (they're off): it's waiting for a person.",
      "Priya Shah emailed the staffing inbox (for the office, sorted by AI). It's waiting for a person.",
      "Priya Shah's email came in more than 3 hours before the inbox could answer it, so it's waiting for a person unsorted.",
      "Priya Shah's email couldn't be sorted (08006), so it's waiting for a person.",
      "An email came to the staffing inbox from an address that isn't one of your casuals'. Its words aren't kept: it's in your own inbox.",
      "An email came to the staffing inbox from someone who isn't active any more. It's waiting for a person.",
      "The open shifts email went to Priya Shah.",
      "The open shifts email to Priya Shah couldn't be sent (SmtpRefused). Their email is waiting for a person.",
      "The office was emailed the staffing inbox's summary (12 emails, 09:00 to 12:00).",
    ]);
    const doc = (s: string) =>
      s
        .replace("Priya Shah", "{Priya Shah}")
        .replace("(open shifts", "({open shifts}")
        .replace("08006", "{code}")
        .replace("SmtpRefused", "{code}");
    // Each in the doc as written there (its {placeholders} and optional parts aside).
    inDoc('"Priya Shah emailed the staffing inbox (open shifts, sorted by AI)."');
    inDoc("\" No automatic reply (they're off): it's waiting for a person.\"");
    inDoc(
      '"Priya Shah emailed the staffing inbox (for the office, sorted by AI). It\'s waiting for a person."',
    );
    for (const line of lines.slice(2, 6)) inDoc(doc(line).replace(/"/g, ""));
    inDoc('"The open shifts / cancel / pay email went to Priya Shah."');
    inDoc(doc(lines[7] ?? ""));
    inDoc('"The office was emailed the staffing inbox\'s summary (12 emails, 09:00 to 12:00)."');
    inDoc(
      '"Nobody in the office could be emailed the staffing inbox\'s summary (1 email): no active admin or resourcer has an email address."',
    );
    inDoc("; it couldn't be sent to 1 of them.");
    expect(
      words("email.received", {
        handledAs: "ai",
        intent: "office",
        replyLimit: true,
        sortedAs: "cancel",
        workerId: "w",
      }),
    ).toBe(
      "Priya Shah emailed the staffing inbox (cancelling, sorted by AI). 3 automatic replies already went to them today: it's waiting for a person.",
    );
    inDoc('" 3 automatic replies already went to them today: it\'s waiting for a person."');
    expect(words("message.inbox_summary", { received: 1, recipients: 0, failed: 0 })).toBe(
      "Nobody in the office could be emailed the staffing inbox's summary (1 email): no active admin or resourcer has an email address.",
    );
    expect(
      words("message.inbox_summary", {
        received: 3,
        from: "09:00",
        to: "12:00",
        recipients: 1,
        failed: 1,
      }),
    ).toBe(
      "The office was emailed the staffing inbox's summary (3 emails, 09:00 to 12:00); it couldn't be sent to 1 of them.",
    );
  });

  it("the office's reply and close, by email", () => {
    expect(words("enquiry.answered", { channel: "email", form: "draft", workerId: "w" })).toBe(
      "Sam Rota replied to Priya Shah's email (by email, the AI's draft, checked by them).",
    );
    expect(words("enquiry.answered", { channel: "email", form: "edited", workerId: "w" })).toBe(
      "Sam Rota replied to Priya Shah's email (by email, from an AI draft they changed).",
    );
    expect(words("email.drafted", { workerId: "w" })).toBe(
      "AI drafted a reply to Priya Shah's email, for the office to check.",
    );
    inDoc('"AI drafted a reply to Priya Shah\'s email, for the office to check."');
    inDoc(
      "\"Sam Rota replied to Priya Shah's email (by email, the AI's draft, checked by them / … from an AI draft they changed / … in their own words).\"",
    );
    inDoc('"Sam Rota closed Priya Shah\'s email without a reply (dealt with by phone)."');
    expect(words("enquiry.answered", { channel: "email", form: "free_text", workerId: "w" })).toBe(
      "Sam Rota replied to Priya Shah's email (by email, in their own words).",
    );
    expect(words("enquiry.closed", { channel: "email", reason: "by_phone", workerId: "w" })).toBe(
      "Sam Rota closed Priya Shah's email without a reply (dealt with by phone).",
    );
    expect(words("enquiry.reply_sent", { channel: "email", workerId: "w" })).toBe(
      "The office's reply to Priya Shah went by email.",
    );
    expect(
      words("enquiry.reply_failed", { channel: "email", code: "SmtpRefused", workerId: "w" }),
    ).toBe(
      "The office's reply to Priya Shah couldn't be sent by email (SmtpRefused). Their email is back in Need a person.",
    );
    // A message's stay as they were.
    expect(words("enquiry.reply_sent", { channel: "sms", workerId: "w" })).toBe(
      "The office's reply to Priya Shah went by text.",
    );
  });
});

describe("the AI's draft of the office's reply", () => {
  const ask = async (
    answer: string | (() => never),
    email = { subject: "Boots", body: "Can I?" },
  ) => {
    const asked: AiRequest[] = [];
    const ai = createFakeAi((r) => {
      asked.push(r);
      return typeof answer === "string" ? answer : answer();
    });
    return { draft: await draftEmailReply(email, ai, { timeoutMs: 200 }), asked };
  };

  it("from the subject and words only; its greeting and sign-off taken off", async () => {
    const { draft, asked } = await ask(
      "Hi Priya,\n\nYes, bring them.\n\nKind regards,\nThe office",
    );
    expect(draft).toBe("Yes, bring them.");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ purpose: "draft_reply", prompt: "Subject: Boots\n\nCan I?" });
    expect(asked[0]?.system).toMatch(/Never promise or offer anything/);
    expect(asked[0]?.system).toMatch(/never mention pay or money/);
    expect(asked[0]?.system).toMatch(/never use or invent a person's name/);
  });

  it("none: no AI, nothing to read, an empty or too long answer, or a failure", async () => {
    expect(await draftEmailReply({ subject: "Boots", body: "Can I?" }, noAi)).toBeNull();
    expect((await ask("Fine.", { subject: "", body: "" })).draft).toBeNull();
    expect((await ask("  ")).draft).toBeNull();
    expect((await ask("x".repeat(DRAFT_MAX + 1))).draft).toBeNull();
    expect((await ask("x".repeat(DRAFT_MAX))).draft).toHaveLength(DRAFT_MAX);
    expect(
      (
        await ask(() => {
          throw new Error("down");
        })
      ).draft,
    ).toBeNull();
  });

  it("code decides there's none for an email about pay or money", () => {
    for (const text of [
      "My pay is late",
      "I was underpaid",
      "where are my wages",
      "about my salary",
      "you owe me money",
      "I'm owed for overtime",
      "a tax question",
      "£40 short",
      "Holiday pay?",
      "about my payment for Saturday",
      "a payroll question",
      "My timesheet shows 6 hours, I did 9",
      "what are the rates?",
      "my expenses and mileage",
      "my bank details changed",
      "€20",
    ]) {
      expect(aboutMoney(text), text).toBe(true);
    }
    for (const text of ["Can I bring boots?", "Is Tuesday on?", "Paddy", "a rated venue"]) {
      expect(aboutMoney(text), text).toBe(false);
    }
  });

  it("sorting an email: the AI is told it's an email; the shifts line's prompt unchanged", async () => {
    const asked: AiRequest[] = [];
    const ai = createFakeAi((r) => {
      asked.push(r);
      return "office";
    });
    await sortMessage("Hello", ai, { via: "email" });
    await sortMessage("Hello", ai);
    expect(asked[0]?.system).toMatch(
      /^You sort an email a casual worker sent to their staffing firm/,
    );
    expect(asked[1]?.system).toMatch(
      /^You sort a message a casual worker sent to their staffing firm's shifts line/,
    );
    expect(asked[0]?.system.endsWith(asked[1]?.system.slice(-80) ?? "x")).toBe(true);
  });
});

describe("the summary's 3-hour slots, in the firm's time", () => {
  it("cut at 00:00, 03:00 … 21:00 London time; across a clock change, 2 or 4 hours", () => {
    const slot = (iso: string) => {
      const s = summarySlotOf(new Date(iso), "Europe/London");
      return [s.start.toISOString(), s.end.toISOString()];
    };
    // Winter (GMT).
    expect(slot("2026-11-02T10:59:00Z")).toEqual([
      "2026-11-02T09:00:00.000Z",
      "2026-11-02T12:00:00.000Z",
    ]);
    expect(slot("2026-11-02T23:30:00Z")).toEqual([
      "2026-11-02T21:00:00.000Z",
      "2026-11-03T00:00:00.000Z",
    ]);
    // Summer (BST): 09:00 London is 08:00 UTC.
    expect(slot("2026-07-01T08:30:00Z")).toEqual([
      "2026-07-01T08:00:00.000Z",
      "2026-07-01T11:00:00.000Z",
    ]);
    // The clocks go forward at 01:00 on 29 March 2026: 00:00–03:00 is 2 hours.
    expect(slot("2026-03-29T00:30:00Z")).toEqual([
      "2026-03-29T00:00:00.000Z",
      "2026-03-29T02:00:00.000Z",
    ]);
    // And back at 02:00 on 25 October 2026: 00:00–03:00 is 4 hours.
    expect(slot("2026-10-25T01:30:00Z")).toEqual([
      "2026-10-24T23:00:00.000Z",
      "2026-10-25T03:00:00.000Z",
    ]);
  });
});

describe("the email that goes: its Reply-To", () => {
  it("SMTP sets it when given, and not otherwise; the console prints it, masked", async () => {
    const base = {
      channel: "email" as const,
      to: "priya@example.com",
      subject: "Re: Boots",
      body: "Yes.",
    };
    expect(
      smtpMailOptions("app@example.test", { ...base, replyTo: "staffing@inbound.example.test" }),
    ).toMatchObject({
      replyTo: "staffing@inbound.example.test",
    });
    expect("replyTo" in smtpMailOptions("app@example.test", base)).toBe(false);
    const printed: string[] = [];
    await createConsoleTransport((s: string) => printed.push(s)).send({
      ...base,
      replyTo: "staffing@inbound.example.test",
    });
    expect(printed[0]).toMatch(/\nReply-To: [^\n]+\nSubject: Re: Boots\n/);
    expect(printed[0]).not.toContain("staffing@inbound.example.test");
    expect(printed[0]).not.toContain("priya@example.com");
  });
});

describe("an email drawn on Enquiries", () => {
  const row = (o: Partial<EnquiryRow> = {}): EnquiryRow => ({
    messageId: "44444444-4444-4444-8444-444444444444",
    at: new Date("2026-11-02T09:14:00Z"),
    channel: "email",
    text: "Can I bring my own boots?",
    subject: "Training",
    who: { kind: "casual", workerId: "w1", name: "Priya Shah", firstName: "Priya", active: true },
    outcome: "person_waiting",
    ...o,
  });
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  const item = (r: EnquiryRow) =>
    renderToStaticMarkup(
      createElement(EnquiryItem, { r, timeZone: "Europe/London", paneHref: "/x", chosen: false }),
    );

  it("a row: the envelope, its subject on its own line, then their words", () => {
    const html = item(row());
    expect(html).toContain('href="/office/enquiries/44444444-4444-4444-8444-444444444444"');
    expect(text(html)).toMatch(
      /^Email: Priya Shah 09:14 on Mon 2 Nov Passed to a person, waiting Training “Can I bring my own boots\?”$/,
    );
    expect(html).toMatch(/<p class="font-semibold break-words">Training<\/p>/);
    expect(text(item(row({ subject: null, text: null })))).toContain(
      `${NO_SUBJECT} ${EMAIL_NO_TEXT}`,
    );
    const notCasual = text(
      item(
        row({
          who: { kind: "unknown_address", from: "venue@example.org" },
          outcome: "inbox",
          subject: null,
          text: null,
        }),
      ),
    );
    expect(notCasual).toBe(
      `Email: Unknown address 09:14 on Mon 2 Nov Left for your inbox ${NOT_CASUAL_ROW}`,
    );
    expect(notCasual).not.toContain("venue@example.org");
  });

  it("the reply form: the label, the AI's draft in the box with its warning, how it goes, both buttons", () => {
    const form = (o: { draft?: string | null; pay?: boolean; waiting?: boolean } = {}) =>
      renderToStaticMarkup(
        createElement(EmailForms, {
          waiting: o.waiting ?? true,
          emailId: "e1",
          draft: o.draft === undefined ? "The office will check." : o.draft,
          pay: o.pay ?? false,
          firstName: "Priya",
          signOff: "Acme Events Shift Team",
        }),
      );
    const html = form();
    expect(text(html)).toBe(
      `Answer it ${EMAIL_REPLY_LABEL} ${EMAIL_DRAFT_NOTE} The office will check. ${emailReplyHint("Priya", "Acme Events Shift Team")} Close, no reply needed ${EMAIL_REPLY_BUTTON}`,
    );
    expect(html).toMatch(
      /<textarea id="[^"]+-reply" aria-describedby="[^"]+-draft [^"]+-hint"[^>]*maxLength="2000"/,
    );
    // A pay email: no draft, and why.
    const pay = text(form({ draft: null, pay: true }));
    expect(pay).toContain(EMAIL_PAY_NO_DRAFT);
    expect(pay).not.toContain(EMAIL_DRAFT_NOTE);
    // No draft otherwise: an empty box, no note.
    const none = text(form({ draft: null }));
    expect(none).not.toContain(EMAIL_DRAFT_NOTE);
    expect(none).not.toContain(EMAIL_PAY_NO_DRAFT);
    // Not waiting: nothing.
    expect(form({ waiting: false })).toBe("");
  });
});
