import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The "Answer it" section on an enquiry's page and beside Enquiries' list (12D.1; Phase 17's
// browser run found its confirmation could vanish; Phase 24, 24.4: round 7's reply box): the form
// draws the section itself, so once a message is answered there the section stays with "Closed. No
// reply was sent." (or the reply's words) after the page refreshes. Loaded fresh, a message that
// isn't waiting has no section at all. The box, then how the reply will go beside "Close, no reply
// needed" and "Send reply"; closing asks why only once it's chosen (the browser tests click it).
// The buttons use Next's router, so a stand-in is given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const { EnquiryForms } = await import("@/app/office/enquiries/[id]/enquiry-forms");

const render = (waiting: boolean, o: { canReply?: boolean; level?: 2 | 3 } = {}) =>
  renderToStaticMarkup(
    createElement(EnquiryForms, {
      waiting,
      messageId: "m1",
      canReply: o.canReply ?? true,
      planLine: "Your reply goes by WhatsApp.",
      level: o.level,
    }),
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("the Answer it section", () => {
  it("a message waiting for a person: the section, its heading for screen readers, the box and both buttons", () => {
    const html = render(true);
    expect(html).toMatch(
      /^<section aria-labelledby="answer"[^>]*><h2 id="answer" class="sr-only">Answer it<\/h2>/,
    );
    // The box, labelled "Reply" and described by how it will go.
    expect(html).toMatch(/<label for="([^"]+)-reply" class="sr-only">Reply<\/label>/);
    expect(html).toMatch(/<textarea id="[^"]+-reply" aria-describedby="[^"]+-plan"/);
    expect(html).toMatch(/<p id="[^"]+-plan" class="[^"]*">Your reply goes by WhatsApp\.<\/p>/);
    // How it goes, then Close, no reply needed, then Send reply (the main button).
    expect(text(html)).toContain("Your reply goes by WhatsApp. Close, no reply needed Send reply");
    expect(html).toMatch(/<button type="submit" class="[^"]*glass-tint[^"]*"[^>]*>Send reply<svg/);
    // Why it's closed is asked once Close is chosen, not before.
    expect(html).not.toContain("Why close it?");
    expect(html).not.toContain("Close without a reply");
    expect(html).toContain('role="status"');
  });

  it("no reply possible (a withheld number, texts off): why, and Close only", () => {
    const words = text(render(true, { canReply: false }));
    expect(words).toContain("Your reply goes by WhatsApp. Close, no reply needed");
    expect(words).not.toContain("Send reply");
    expect(render(true, { canReply: false })).not.toContain("<textarea");
  });

  it("beside the list, its heading is an h3 (the message's title is the h2)", () => {
    expect(render(true, { level: 3 })).toMatch(
      /^<section aria-labelledby="answer"[^>]*><h3 id="answer" class="sr-only">Answer it<\/h3>/,
    );
  });

  it("a message already answered, loaded fresh: nothing", () => {
    expect(render(false)).toBe("");
  });
});
