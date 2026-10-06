import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The office shell (src/app/office/office-shell.tsx, office-nav.tsx; docs/ui-design.md "Office
// shell"): which links each role sees, which one is the current page, and the rules the browser
// tests need it to keep (plain links outside <main>, one "Log out", no list items or headings).
// Also the shared pieces in src/app/ui/ that add no words of their own.

const nav = vi.hoisted(() => ({ pathname: "/office" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/app/office/session-actions", () => ({ refreshOfficeSessionAction: vi.fn() }));

const { officeMenu, OfficeShell } = await import("@/app/office/office-shell");
const { ariaCurrent, currentHref, hiddenEdges, OfficeNav, redrawOnArrival } =
  await import("@/app/office/office-nav");
const { PageHeader } = await import("@/app/ui/page-header");
const { StatusChip } = await import("@/app/ui/status-chip");
const { LogoutButton } = await import("@/app/logout-button");

const labels = (role: "admin" | "resourcer" | "payroll") =>
  officeMenu(role).map((g) => [g.label, g.links.map((l) => l.label)]);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("the office menu", () => {
  it("admins see every link, in groups", () => {
    expect(labels("admin")).toEqual([
      [null, ["Today"]],
      ["Shifts and people", ["Shifts", "Requests", "Workers"]],
      ["Records", ["Action log", "Notice report", "Pilot metrics"]],
      ["Pay", ["Pay queries", "Import pay records"]],
      ["Admin", ["Office team", "Data requests (download or delete)"]],
      ["Help", ["How-to guide"]],
    ]);
  });

  it("resourcers don't see pay or admin links", () => {
    expect(labels("resourcer")).toEqual([
      [null, ["Today"]],
      ["Shifts and people", ["Shifts", "Requests", "Workers"]],
      ["Records", ["Action log", "Notice report", "Pilot metrics"]],
      ["Help", ["How-to guide"]],
    ]);
  });

  it("payroll gets Home (the dashboard, not Today), pay and the guide", () => {
    expect(labels("payroll")).toEqual([
      [null, ["Home"]],
      ["Pay", ["Pay queries", "Import pay records"]],
      ["Help", ["How-to guide"]],
    ]);
    expect(officeMenu("payroll")[0]?.links[0]?.href).toBe("/office");
  });

  it("links have no query strings (tests compare the address after a click)", () => {
    for (const g of officeMenu("admin"))
      for (const l of g.links) expect(l.href).toMatch(/^\/[^?#]*$/);
  });
});

describe("the current page in the menu", () => {
  const hrefs = officeMenu("admin").flatMap((g) => g.links.map((l) => l.href));
  it.each([
    ["/office", "/office"],
    ["/office/today", "/office"],
    ["/office/offer/11111111-1111-4111-8111-111111111111", "/office"],
    ["/office/shifts", "/office/shifts"],
    ["/office/shifts/new", "/office/shifts"],
    ["/office/shifts/11111111-1111-4111-8111-111111111111", "/office/shifts"],
    ["/office/workers/11111111-1111-4111-8111-111111111111", "/office/workers"],
    ["/office/data/workers/11111111-1111-4111-8111-111111111111", "/office/data"],
    ["/office/pay/import", "/office/pay/import"],
    ["/office/pay-queries", "/office/pay-queries"],
    ["/office/reports/notice", "/office/reports/notice"],
    ["/office/reports/pilot", "/office/reports/pilot"],
    ["/office/guide", "/office/guide"],
    ["/office/login", null],
    ["/office/shiftsx", null],
  ])("%s marks %s", (pathname, expected) => {
    expect(currentHref(pathname, hrefs)).toBe(expected);
  });

  it("payroll: pay import marks its own link; shift pages mark nothing (not theirs)", () => {
    const payroll = officeMenu("payroll").flatMap((g) => g.links.map((l) => l.href));
    expect(currentHref("/office/pay/import", payroll)).toBe("/office/pay/import");
    expect(currentHref("/office/shifts", payroll)).toBeNull();
  });

  // aria-current="page" only on the page itself; "true" on the section you're inside.
  it.each([
    ["/office", "/office", "page"],
    ["/office", "/office/today", "page"],
    ["/office", "/office/offer/11111111-1111-4111-8111-111111111111", "true"],
    ["/office/shifts", "/office/shifts", "page"],
    ["/office/shifts", "/office/shifts/new", "true"],
    ["/office/shifts", "/office/shifts/11111111-1111-4111-8111-111111111111", "true"],
    ["/office/workers", "/office/workers/11111111-1111-4111-8111-111111111111", "true"],
    ["/office/data", "/office/data/workers/11111111-1111-4111-8111-111111111111", "true"],
    ["/office/pay/import", "/office/pay/import", "page"],
    ["/office/guide", "/office/guide", "page"],
  ])("%s on %s is aria-current=%s", (href, pathname, expected) => {
    expect(ariaCurrent(href, pathname)).toBe(expected);
  });
});

describe("the menu's markup", () => {
  const marked = (html: string, value: "page" | "true") =>
    [...html.matchAll(new RegExp(`<a[^>]*aria-current="${value}"[^>]*>`, "g"))].map((m) => m[0]);

  it("plain links with one marked current, and nothing the page tests count", () => {
    nav.pathname = "/office/shifts/11111111-1111-4111-8111-111111111111";
    const html = renderToStaticMarkup(createElement(OfficeNav, { groups: officeMenu("admin") }));
    expect(html).toContain('aria-label="Office menu"');
    expect(html).not.toMatch(/<(li|ul|ol|h[1-6]|details|summary|fieldset|section|output)\b/);
    expect(html).not.toMatch(/role="/);
    // A shift's page is inside Shifts, not the Shifts page itself.
    expect(html.match(/aria-current=/g)).toHaveLength(1);
    expect(marked(html, "page")).toEqual([]);
    expect(marked(html, "true")).toHaveLength(1);
    expect(marked(html, "true")[0]).toContain('href="/office/shifts"');
  });

  it("the page itself is aria-current=page", () => {
    nav.pathname = "/office/shifts";
    const html = renderToStaticMarkup(createElement(OfficeNav, { groups: officeMenu("admin") }));
    expect(html.match(/aria-current=/g)).toHaveLength(1);
    expect(marked(html, "true")).toEqual([]);
    expect(marked(html, "page")).toHaveLength(1);
    expect(marked(html, "page")[0]).toContain('href="/office/shifts"');
  });

  it("the offer page marks Today as the section it's in", () => {
    nav.pathname = "/office/offer/11111111-1111-4111-8111-111111111111";
    const html = renderToStaticMarkup(createElement(OfficeNav, { groups: officeMenu("admin") }));
    expect(html.match(/aria-current=/g)).toHaveLength(1);
    expect(marked(html, "true")[0]).toContain('href="/office"');
  });

  it("draws no edge arrows on the server (they're measured in the browser)", () => {
    nav.pathname = "/office";
    const html = renderToStaticMarkup(createElement(OfficeNav, { groups: officeMenu("admin") }));
    expect(html).not.toContain("m9 5.5 6.5 6.5L9 18.5");
  });
});

describe("the phone row's edge arrows", () => {
  it.each([
    // scrollLeft, clientWidth, scrollWidth → left, right
    [0, 390, 1400, false, true],
    [500, 390, 1400, true, true],
    [1010, 390, 1400, true, false],
    [1009.5, 390, 1400, true, false], // rounding: within 1px of the end
    [0.5, 390, 1400, false, true], // rounding: within 1px of the start
    [0, 256, 256, false, false], // nothing hidden (a desktop sidebar, or a short menu)
  ])(
    "scrolled %s of a %s-wide row holding %s: left %s, right %s",
    (scrollLeft, clientWidth, scrollWidth, left, right) => {
      expect(hiddenEdges({ scrollLeft, clientWidth, scrollWidth })).toEqual({ left, right });
    },
  );
});

describe("after the session ends on the server", () => {
  it("arriving at a login page from another office page redraws the layout", () => {
    expect(redrawOnArrival("/office/shifts", "/office/login")).toBe(true);
    expect(redrawOnArrival("/office", "/office/l")).toBe(true);
  });

  it("only once: not on the page the shell was drawn on, nor on other pages", () => {
    // The shell is drawn fresh by the server on /office/l with a live session; a redraw would
    // give the same, and redrawing again on the same page could repeat for ever.
    expect(redrawOnArrival("/office/login", "/office/login")).toBe(false);
    expect(redrawOnArrival("/office/l", "/office/l")).toBe(false);
    // With a live session the login page sends you to /office: no redraw there.
    expect(redrawOnArrival("/office/login", "/office")).toBe(false);
    expect(redrawOnArrival("/office", "/office/shifts")).toBe(false);
    expect(redrawOnArrival("/office", "/office/logins")).toBe(false);
  });
});

describe("the shell", () => {
  it("the shell: menu, then the page inside #main, then the name and one Log out", () => {
    nav.pathname = "/office";
    // Hook-free, so it can be called directly.
    const html = renderToStaticMarkup(
      OfficeShell({
        name: "Sam Admin",
        roleLabel: "Admin",
        menu: officeMenu("admin"),
        rotationDue: false,
        children: createElement("main", null, "PAGE"),
      }),
    );
    expect(html).toContain('data-shell="office"');
    expect(html).toContain('href="#main"');
    const navAt = html.indexOf("<nav");
    const mainAt = html.indexOf('id="main"');
    const pageAt = html.indexOf("<main>PAGE</main>");
    const footerAt = html.indexOf("<footer");
    expect(navAt).toBeGreaterThan(0);
    expect(mainAt).toBeGreaterThan(navAt);
    expect(pageAt).toBeGreaterThan(mainAt);
    expect(footerAt).toBeGreaterThan(pageAt);
    // The page's own <main> is the only one.
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/>Log out</g)).toHaveLength(1);
    expect(text(html.slice(footerAt))).toBe("Sam Admin Admin Log out");
  });
});

describe("shared pieces add no words", () => {
  it("PageHeader: the one <h1>, the eyebrow, the lines and actions as given", () => {
    const html = renderToStaticMarkup(
      createElement(
        PageHeader,
        {
          eyebrow: "Acme Events office",
          title: "Shifts",
          titleId: "page-title",
          actions: createElement("a", { href: "/office/shifts/new" }, "New shift"),
        },
        createElement("p", null, "0 of 2 booked · Open"),
      ),
    );
    expect(html.match(/<h[1-6]\b/g)).toEqual(["<h1"]);
    expect(html).toMatch(/<h1 id="page-title"[^>]*>Shifts<\/h1>/);
    expect(text(html)).toBe("Acme Events office Shifts 0 of 2 booked · Open New shift");
  });

  it("StatusChip: its text is exactly the word; the icon is hidden", () => {
    for (const tone of ["urgent", "attention", "done", "quiet"] as const) {
      const html = renderToStaticMarkup(StatusChip({ tone, children: "Open" }));
      expect(text(html)).toBe("Open");
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain("red-700");
    }
  });

  it("LogoutButton uses the className it's given and says Log out", () => {
    const worker = renderToStaticMarkup(
      createElement(LogoutButton, { kind: "worker", after: "/login?out=1", className: "w" }),
    );
    expect(worker).toMatch(/^<button type="button" class="w">/);
    expect(text(worker)).toBe("Log out");
    const office = renderToStaticMarkup(
      createElement(LogoutButton, {
        kind: "office",
        after: "/office/login?out=1",
        className: "x",
        icon: createElement("svg", { "aria-hidden": "true" }),
      }),
    );
    expect(office).toContain('class="x"');
    // The icon comes before the words.
    expect(office).toMatch(/<svg aria-hidden="true"><\/svg>Log out<\/button>/);
    expect(text(office)).toBe("Log out");
  });
});
