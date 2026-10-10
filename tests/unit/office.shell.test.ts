import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The office shell (src/app/office/office-shell.tsx, office-frame.tsx, office-nav.tsx,
// theme-button.tsx; docs/office-v2.md 3.1; docs/ui-design.md "Office shell"): which links each
// role sees in the v2 groups, which one is the current page, the rules the browser tests need the
// menu to keep (plain links outside <main>, no list items, headings or roles), badges outside a
// link's name, and the top bar (Menu, ShiftDesk with the firm's name, the theme button, the
// account menu with the one "Log out"). tests/e2e/office.shell.spec.ts drives the drawer, the
// theme and the account menu in a browser. Also the shared pieces in src/app/ui/ that add no
// words of their own.

const nav = vi.hoisted(() => ({ pathname: "/office" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/app/office/session-actions", () => ({ refreshOfficeSessionAction: vi.fn() }));

const { MENU_AREAS, officeMenu, OfficeShell } = await import("@/app/office/office-shell");
const { ariaCurrent, currentHref, OfficeNav } = await import("@/app/office/office-nav");
const { ACCOUNT_MENU_ID, DRAWER_ID, initials, redrawOnArrival } =
  await import("@/app/office/office-frame");
const { themeCookie } = await import("@/app/office/theme-button");
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

describe("the office menu (v2 groups)", () => {
  it("admins see every link, in groups", () => {
    expect(labels("admin")).toEqual([
      ["Operations", ["Today", "Events & sessions", "Cancellations", "Enquiries"]],
      ["Pay", ["Pay dashboard", "Pay queries", "Import pay records"]],
      ["Records", ["Strikes", "Casuals", "Action log", "Notice report", "Pilot metrics"]],
      ["Configuration", ["Office team", "Settings", "Data requests"]],
      ["Help", ["How-to guide"]],
    ]);
  });

  it("resourcers don't see pay or configuration links", () => {
    expect(labels("resourcer")).toEqual([
      ["Operations", ["Today", "Events & sessions", "Cancellations", "Enquiries"]],
      ["Records", ["Strikes", "Casuals", "Action log", "Notice report", "Pilot metrics"]],
      ["Help", ["How-to guide"]],
    ]);
  });

  it("payroll gets the pay dashboard (their home, not Today) at the top of Pay, and the guide", () => {
    expect(labels("payroll")).toEqual([
      ["Pay", ["Pay dashboard", "Pay queries", "Import pay records"]],
      ["Help", ["How-to guide"]],
    ]);
    expect(officeMenu("payroll")[0]?.links[0]?.href).toBe("/office/pay");
    expect(MENU_AREAS).not.toContain("dashboard");
  });

  it("a badge given by address goes on that link only (the layout's Pay queries count)", () => {
    const badge = { count: 4, words: "4 waiting" };
    const links = officeMenu("payroll", { "/office/pay-queries": badge }).flatMap((g) => g.links);
    expect(links.filter((l) => l.badge).map((l) => [l.href, l.badge])).toEqual([
      ["/office/pay-queries", badge],
    ]);
    // A role that can't open the page gets no badge for it.
    expect(
      officeMenu("resourcer", { "/office/pay-queries": badge }).flatMap((g) => g.links),
    ).not.toContainEqual(expect.objectContaining({ href: "/office/pay-queries" }));
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
    // The shift pages sit inside Events & sessions (12B.5).
    ["/office/events", "/office/events"],
    ["/office/events/11111111-1111-4111-8111-111111111111", "/office/events"],
    ["/office/shifts", "/office/events"],
    ["/office/shifts/new", "/office/events"],
    ["/office/shifts/11111111-1111-4111-8111-111111111111", "/office/events"],
    ["/office/casuals/11111111-1111-4111-8111-111111111111", "/office/casuals"],
    ["/office/data/workers/11111111-1111-4111-8111-111111111111", "/office/data"],
    ["/office/pay/import", "/office/pay/import"],
    ["/office/pay", "/office/pay"],
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
    ["/office/events", "/office/events", "page"],
    ["/office/events", "/office/events/11111111-1111-4111-8111-111111111111", "true"],
    ["/office/events", "/office/shifts", "true"],
    ["/office/events", "/office/shifts/11111111-1111-4111-8111-111111111111", "true"],
    ["/office/casuals", "/office/casuals/11111111-1111-4111-8111-111111111111", "true"],
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
  const render = (groups = officeMenu("admin")) =>
    renderToStaticMarkup(createElement(OfficeNav, { groups }));

  it("plain links with one marked current, and nothing the page tests count", () => {
    nav.pathname = "/office/shifts/11111111-1111-4111-8111-111111111111";
    const html = render();
    expect(html).toMatch(/^<nav aria-label="Office menu"/);
    expect(html).not.toMatch(/<(li|ul|ol|h[1-6]|details|summary|fieldset|section|output)\b/);
    expect(html).not.toMatch(/role="/);
    // Group names are words, not headings.
    expect(html).toContain(">Operations</p>");
    // A shift's page is inside Events & sessions, not that page itself.
    expect(html.match(/aria-current=/g)).toHaveLength(1);
    expect(marked(html, "page")).toEqual([]);
    expect(marked(html, "true")).toHaveLength(1);
    expect(marked(html, "true")[0]).toContain('href="/office/events"');
  });

  it("the page itself is aria-current=page, with the bar and the soft background", () => {
    nav.pathname = "/office/events";
    const html = render();
    expect(html.match(/aria-current=/g)).toHaveLength(1);
    expect(marked(html, "true")).toEqual([]);
    expect(marked(html, "page")).toHaveLength(1);
    expect(marked(html, "page")[0]).toContain('href="/office/events"');
    expect(marked(html, "page")[0]).toMatch(/bg-quiet-soft.*before:w-\[3px\].*before:bg-ink/);
  });

  it("the offer page marks Today as the section it's in", () => {
    nav.pathname = "/office/offer/11111111-1111-4111-8111-111111111111";
    const html = render();
    expect(html.match(/aria-current=/g)).toHaveLength(1);
    expect(marked(html, "true")[0]).toContain('href="/office"');
  });

  it("a badge's count sits outside the link's name; its words are read after the link", () => {
    nav.pathname = "/office";
    const html = render([
      {
        label: "Pay",
        links: [
          {
            href: "/office/pay-queries",
            label: "Pay queries",
            icon: "pay",
            badge: { count: 3, words: "3 waiting" },
          },
        ],
      },
    ]);
    const link = html.match(/<a\b[^>]*>(.*?)<\/a>/)?.[1] ?? "";
    // Inside the link, everything but the label is hidden from screen readers.
    const named = link
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/g, "");
    expect(text(named)).toBe("Pay queries");
    expect(link).toMatch(/<span aria-hidden="true"[^>]*>3<\/span>/);
    expect(html).toMatch(/<\/a><span class="sr-only">3 waiting<\/span>/);
  });
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
  const shell = (theme?: "light" | "dark", role: "admin" | "payroll" = "admin") => {
    nav.pathname = "/office";
    // Hook-free, so it can be called directly.
    return renderToStaticMarkup(
      OfficeShell({
        name: "Sam Admin",
        roleLabel: role === "admin" ? "Admin" : "Payroll",
        firmName: "Acme Events",
        payWeek: "Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct",
        menu: officeMenu(role),
        theme,
        rotationDue: false,
        children: createElement("main", null, "PAGE"),
      }),
    );
  };

  it("in order: the skip link, the top bar, the menu, then the page in #main", () => {
    const html = shell();
    expect(html).toContain('data-shell="office"');
    const skipAt = html.indexOf('href="#main"');
    const barAt = html.indexOf("<header");
    const navAt = html.indexOf("<nav");
    const mainAt = html.indexOf('id="main"');
    const pageAt = html.indexOf("<main>PAGE</main>");
    expect(skipAt).toBeGreaterThan(-1);
    expect(barAt).toBeGreaterThan(skipAt);
    expect(navAt).toBeGreaterThan(barAt);
    expect(mainAt).toBeGreaterThan(navAt);
    expect(pageAt).toBeGreaterThan(mainAt);
    // One <nav>, and the page's own <main> is the only one.
    expect(html.match(/<nav\b/g)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/>Log out</g)).toHaveLength(1);
  });

  it("the top bar: Menu (waits for the page), ShiftDesk with the firm's name, theme, account", () => {
    const html = shell();
    const bar = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(bar).toMatch(
      new RegExp(
        `<button type="button" aria-controls="${DRAWER_ID}" aria-expanded="false" aria-haspopup="dialog" disabled=""[^>]*>.*Menu</button>`,
      ),
    );
    expect(bar).toContain('<span class="block font-bold text-ink">ShiftDesk</span>');
    expect(bar).toContain(">Acme Events</span>");
    // The pay week, from 1024px (hidden on phones and tablets).
    expect(bar).toMatch(
      /<p class="[^"]*hidden[^"]*lg:flex[^"]*">Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct<\/p>/,
    );
    expect(bar).toMatch(/<button type="button" aria-label="Switch to dark mode" disabled=""/);
    // The theme button's words also show beside it (hidden from screen readers: they're its name).
    expect(bar).toMatch(/<span aria-hidden="true"[^>]*group-hover:block[^>]*>Switch to dark mode</);
    const account = bar.match(
      // HTML attribute names ignore case (React writes "popoverTarget").
      new RegExp(
        `<button type="button" popovertarget="${ACCOUNT_MENU_ID}"[^>]*>(.*?)</button>`,
        "i",
      ),
    )?.[1];
    expect(account).toBeDefined();
    expect(account).toMatch(/<span aria-hidden="true"[^>]*>SA<\/span>/);
    expect(text((account ?? "").replace(/<span aria-hidden="true"[^>]*>SA<\/span>/, ""))).toBe(
      "Sam Admin Admin",
    );
  });

  it("the account menu: the name and role, How-to guide and the one Log out", () => {
    const html = shell();
    const at = html.indexOf(`<div id="${ACCOUNT_MENU_ID}" popover="auto"`);
    expect(at).toBeGreaterThan(-1);
    const menu = html.slice(at, html.indexOf("</header>"));
    expect(text(menu)).toBe("Sam Admin Admin How-to guide Log out");
    expect(menu).toContain('href="/office/guide"');
  });

  it("the theme button's words follow the cookie's theme", () => {
    expect(shell("dark")).toContain('aria-label="Switch to light mode"');
    expect(shell("light")).toContain('aria-label="Switch to dark mode"');
  });

  it("the drawer is a native dialog, empty until it's opened; the menu is in the sidebar", () => {
    const html = shell();
    const dialog = html.match(new RegExp(`<dialog[^>]*id="${DRAWER_ID}"[^>]*>(.*?)</dialog>`));
    expect(dialog).not.toBeNull();
    expect(dialog?.[0]).toContain('aria-label="Menu"');
    expect(dialog?.[0]).not.toMatch(/\bopen\b=/);
    expect(dialog?.[1]).toBe("");
    // The sidebar (hidden on phones) holds the one <nav>.
    expect(html).toMatch(/<div class="hidden [^"]*lg:block[^"]*"><nav aria-label="Office menu"/);
  });

  it("payroll's shell: their own menu, the same bar", () => {
    const html = shell(undefined, "payroll");
    expect(text(html)).toContain(
      "Pay Pay dashboard Pay queries Import pay records Help How-to guide",
    );
    expect(html).not.toContain('href="/office/events"');
    expect(html).not.toContain('href="/office/shifts"');
  });
});

describe("the account button's initials and the theme cookie", () => {
  it.each([
    ["Sam Rota", "SR"],
    ["Sam Admin", "SA"],
    ["Resourcer (demo)", "RD"],
    ["Zoë Ann-Marie O'Neil", "ZO"],
    ["Prince", "P"],
    ["  ", "?"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it("sd-theme for a year, for every page of the address; Secure on https", () => {
    expect(themeCookie("dark", false)).toBe(
      "sd-theme=dark; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(themeCookie("light", true)).toBe(
      "sd-theme=light; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
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
