import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The "Answer it" section on an enquiry's page (12D.1; Phase 17's browser run found its
// confirmation could vanish): the form draws the section itself, so once a message is answered
// there the section stays with "Closed. No reply was sent." (or the reply's words) after the page
// refreshes. Loaded fresh, a message that isn't waiting has no section at all. The buttons use
// Next's router, so a stand-in is given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const { EnquiryForms } = await import("@/app/office/enquiries/[id]/enquiry-forms");

const render = (waiting: boolean) =>
  renderToStaticMarkup(
    createElement(EnquiryForms, {
      waiting,
      messageId: "m1",
      canReply: true,
      planLine: "Your reply goes by WhatsApp.",
    }),
  );

describe("the Answer it section", () => {
  it("a message waiting for a person: the section, its heading and both forms", () => {
    const html = render(true);
    expect(html).toMatch(
      /^<section aria-labelledby="answer"[^>]*><h2 id="answer"[^>]*>Answer it<\/h2>/,
    );
    expect(html).toContain("Send reply");
    expect(html).toContain("Close without a reply");
    expect(html).toContain('role="status"');
  });

  it("a message already answered, loaded fresh: nothing", () => {
    expect(render(false)).toBe("");
  });
});
