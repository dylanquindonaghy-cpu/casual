import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EnquiryRow } from "@/lib/office/enquiries";

// A row of Enquiries' list (Phase 24, 24.4: round 7 of the canvas): the channel's icon, who sent it
// and when, the outcome chip, their words, and on a pay message that pay never gets an AI answer.
// Its name is the row's link to the message's own page (a phone opens it; from 1024px a click
// picks it beside the list instead, which the browser tests check). The chosen row's outline is
// only from 1024px, and it says it's the current one only where it shows beside the list: never
// in the page as the server sends it. The link uses Next's router, so a stand-in is given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {} }) }));

const { EnquiryItem } = await import("@/app/office/enquiries/enquiry-row");

const row = (o: Partial<EnquiryRow> = {}): EnquiryRow =>
  ({
    messageId: "33333333-3333-4333-8333-333333333333",
    at: new Date("2026-10-26T10:05:00Z"),
    channel: "whatsapp",
    text: "Can I swap my Saturday shift with Tom?",
    who: { kind: "casual", workerId: "w1", name: "Kieran Doyle", firstName: "Kieran" },
    outcome: "person_waiting",
    ...o,
  }) as EnquiryRow;

const render = (r: EnquiryRow, chosen: boolean) =>
  renderToStaticMarkup(
    createElement(EnquiryItem, {
      r,
      timeZone: "Europe/London",
      paneHref: `/office/enquiries?message=${r.messageId}`,
      chosen,
    }),
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("a row of Enquiries' list", () => {
  it("who, when, the outcome and their words; the name links to the message's page", () => {
    const html = render(row(), false);
    expect(html).toContain('href="/office/enquiries/33333333-3333-4333-8333-333333333333"');
    expect(text(html)).toMatch(/^WhatsApp: Kieran Doyle 10:05 on Mon 26 Oct /);
    expect(text(html)).toContain("“Can I swap my Saturday shift with Tom?”");
    // The link covers the row (its whole tile is the target).
    expect(html).toMatch(/<a [^>]*class="[^"]*before:absolute before:inset-0[^"]*"/);
  });

  it("the chosen row: its outline only from 1024px, and not 'current' as the server sends it", () => {
    const chosen = render(row(), true);
    const li = chosen.slice(0, chosen.indexOf(">"));
    expect(li).toContain("lg:outline-2");
    expect(li).toContain("lg:glass-button");
    expect(li).not.toMatch(/(?<![\w:])outline-2/);
    expect(chosen).not.toContain("aria-current");
    expect(render(row(), false).slice(0, 200)).not.toContain("lg:outline-2");
  });

  it("a pay message says pay never gets an AI answer; one with no words says why", () => {
    expect(text(render(row({ outcome: "pay" }), false))).toContain(
      "Pay: never answered by AI (rule)",
    );
    expect(text(render(row({ text: null, channel: "voice" }), false))).toContain(
      "(A voicemail we couldn't turn into text.)",
    );
    expect(text(render(row({ text: null }), false))).toContain("(A photo or file, with no text.)");
  });
});
