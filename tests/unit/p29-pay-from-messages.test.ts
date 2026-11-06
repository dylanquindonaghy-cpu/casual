import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OUTCOME_TONES, OUTCOME_WORDS, sortedStep } from "@/lib/office/enquiries-copy";
import { enquiryOutcome, forAPerson } from "@/lib/office/enquiry-rules";
import { DIGEST_CSV_HEADER, sentFromWords } from "@/lib/pay/digest-list";
import { MESSAGES_INTRO_PAY, PAY_QUERY_NOTE, SENT_TO_PAYROLL } from "@/lib/portal/messages-copy";

// Phase 29.1 (docs/screens.md "### 29.1"; docs/messaging-templates.md "Messages in the app"): a pay
// question sent from Messages about her pay goes to payroll's digest as a pay query. The casual's
// words (screens.md's, word for word, short sentences), the note under her message in the thread
// (a 44px link to Pay), Enquiries' chip and its "how it was sorted" line, and where payroll's list
// says it came from.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/messages",
}));

const { MessagesView } = await import("@/app/messages/messages-view");

const screens = readFileSync("docs/screens.md", "utf8");
const phase29 = screens.slice(screens.indexOf("## Phase 29"));
const section291 = phase29.slice(phase29.indexOf("### 29.1"), phase29.indexOf("### 29.2"));
const templates = readFileSync("docs/messaging-templates.md", "utf8");
const sentences = (s: string) =>
  s
    .split(/(?<=[.?!])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

describe("the casual's words", () => {
  it("are screens.md's, word for word, in short sentences", () => {
    expect(SENT_TO_PAYROLL).toBe(
      "Sent. Payroll will look at it. You'll see the answer on your Pay page.",
    );
    expect(MESSAGES_INTRO_PAY).toBe(
      "This goes to payroll, not the automatic answers. You'll see their answer on your Pay page.",
    );
    for (const words of [SENT_TO_PAYROLL, MESSAGES_INTRO_PAY]) {
      expect(section291.replace(/\s+/g, " ")).toContain(`"${words}"`);
      for (const s of sentences(words)) expect(s.split(/\s+/).length).toBeLessThanOrEqual(15);
    }
    const flat = section291.replace(/\s+/g, " ");
    expect(flat).toContain(`"${PAY_QUERY_NOTE.before.trim()}"`);
    expect(flat).toContain(`"${PAY_QUERY_NOTE.link}"`);
    expect(templates.replace(/\s+/g, " ")).toContain(SENT_TO_PAYROLL);
    // Never the office's promise any more.
    expect(SENT_TO_PAYROLL).not.toMatch(/office/i);
  });

  it("the Phase 29 heading holds one subsection per task, 29.1 to 29.5", () => {
    for (const n of [1, 2, 3, 4, 5]) expect(phase29).toContain(`### 29.${n}`);
  });
});

describe("her thread", () => {
  const at = new Date("2026-11-02T09:00:00Z");
  const view = (toPayroll: boolean) =>
    renderToStaticMarkup(
      createElement(MessagesView, {
        thread: {
          items: [
            { id: "a", mine: true, text: "Was I paid for Saturday?", at, from: null, toPayroll },
          ],
          more: false,
          latestMineAt: at,
          answered: true,
        },
        now: at,
        timeZone: "Europe/London",
        linkOrigin: "https://acme.shiftdesk.test",
        composer: null,
        intro: MESSAGES_INTRO_PAY,
      }),
    );

  it("under one sent to payroll: the note and a 44px link to Pay", () => {
    const html = view(true);
    expect(html).toContain("data-to-payroll");
    expect(html).toContain(PAY_QUERY_NOTE.before.trim());
    const link = html.match(/<a [^>]*href="\/pay"[^>]*>([^<]+)<\/a>/);
    expect(link?.[1]).toBe(PAY_QUERY_NOTE.link);
    expect(link?.[0]).toContain("min-h-11");
  });

  it("any other message has no note", () => {
    const html = view(false);
    expect(html).not.toContain("data-to-payroll");
    expect(html).not.toContain(PAY_QUERY_NOTE.link);
  });
});

describe("Enquiries", () => {
  it("one stored for payroll is 'Pay: sent to payroll', not a person's", () => {
    const facts = {
      handled: true,
      handledAs: "office" as const,
      intent: "pay" as const,
      waiting: false,
      doneInApp: false,
    };
    expect(enquiryOutcome(facts)).toBe("payroll");
    expect(forAPerson(facts)).toBe(false);
    expect(OUTCOME_WORDS.payroll).toBe("Pay: sent to payroll");
    expect(OUTCOME_TONES.payroll).toBe("quiet");
    // A pay message the shifts line answered keeps its own chip.
    expect(enquiryOutcome({ ...facts, handledAs: "keyword" })).toBe("pay");
    expect(sortedStep({ how: "to_payroll", ref: "0F3C2A1B" })).toBe(
      "About their pay, from Messages: it went to payroll as pay query 0F3C2A1B, for the pay digest. Never sorted or answered automatically.",
    );
    expect(section291.replace(/\s+/g, " ")).toContain(
      "About their pay, from Messages: it went to payroll as pay query {REF}, for the pay digest. Never sorted or answered automatically.",
    );
  });
});

describe("payroll's list", () => {
  it("says where each query was sent from", () => {
    expect(DIGEST_CSV_HEADER.at(-1)).toBe("Sent from");
    expect(sentFromWords({ fromMessages: null })).toEqual({ cell: "Pay page", note: null });
    expect(sentFromWords({})).toEqual({ cell: "Pay page", note: null });
    expect(sentFromWords({ fromMessages: { why: null } })).toEqual({
      cell: "Messages",
      note: "Sent from Messages.",
    });
    expect(sentFromWords({ fromMessages: { why: "no_code" } })).toEqual({
      cell: "Messages (we couldn't send them a pay code)",
      note: "Sent from Messages: we couldn't send them a pay code, so the Pay page couldn't take it.",
    });
    for (const w of ["Sent from Messages.", "Messages (we couldn't send them a pay code)"])
      expect(section291.replace(/\s+/g, " ")).toContain(w);
  });
});
