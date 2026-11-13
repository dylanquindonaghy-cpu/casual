import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/app/ui/page-header";

// PageHeader's place for "Updated hh:mm" (Phase 37.6, w1-08): the office frame writes the time into
// the first empty [data-updated-slot] under the page (src/app/office/updated-stamp.tsx). A page that
// isn't live data (the office's not-found and error pages) passes stamp={false} and gets none.

const html = (props: Parameters<typeof PageHeader>[0]) =>
  renderToStaticMarkup(createElement(PageHeader, props));

describe("PageHeader's Updated place", () => {
  it("is there by default, empty, for the frame to write into", () => {
    expect(html({ title: "Casuals" })).toContain('<small data-updated-slot=""');
  });

  it("is left out with stamp={false}", () => {
    const out = html({ title: "We can't find that page.", stamp: false });
    expect(out).not.toContain("data-updated-slot");
    expect(out).toContain("We can&#x27;t find that page.");
  });

  it("a page's own Updated words still show", () => {
    expect(html({ title: "Home", updated: "Updated 21:35" })).toContain("Updated 21:35");
  });
});
