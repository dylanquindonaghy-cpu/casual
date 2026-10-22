import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The office shell (src/app/office/office-shell.tsx, office-frame.tsx, office-nav.tsx,
// theme-button.tsx; docs/office-v2.md 3.1; docs/ui-design.md "Office shell"): which links each
// role sees in the v2 groups, which one is the current page, the rules the browser tests need the
// menu to keep (plain links outside <main>, no list items, headings or roles; the folded group a
// button, not a <details>), badges outside a link's name, and the top bar (Menu, the firm's name
// below 1024px, the pay week from 1024px, the theme button, the account menu with the one "Log
// out"). Phase 18 regrouped the menu. tests/e2e/office.shell.spec.ts drives the drawer, the
// theme and the account menu in a browser. Also the shared pieces in src/app/ui/ that add no
// words of their own.

const nav = vi.hoisted(() => ({ pathname: "/office" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/app/office/session-actions", () => ({ refreshOfficeSessionAction: vi.fn() }));

const { MENU_AREAS, menuBadges, officeMenu, OfficeShell } =
  await import("@/app/office/office-shell");
const { ariaCurrent, currentHref, OfficeNav } = await import("@/app/office/office-nav");
const { ACCOUNT_MENU_ID, DRAWER_ID, initials, redrawOnArrival } =
  await import("@/app/office/office-frame");
const { themeCookie } = await import("@/app/office/theme-button");
const { PageHeader } = await import("@/app/ui/page-header");
const { count, countPill } = await import("@/app/ui/classes");
const { StatusChip } = await import("@/app/ui/status-chip");
const { LogoutButton } = await import("@/app/logout-button");

const labels = (role: "admin" | "resourcer" | "payroll") =>
  officeMenu(role).map((g) => [g.label, g.links.map((l) => l.label)]);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("the office menu (v2 groups; Phases 18 and 20)", () => {
  it("admins see every link, in groups: the dashboard and Needs attention first, then today's, the records and settings folded", () => {
    expect(labels("admin")).toEqual([
      ["Home", ["Dashboard", "Needs attention"]],
      ["Today", ["Events & sessions", "Cancellations", "Enquiries"]],
      ["Pay", ["Pay dashboard", "Pay queries", "Import pay records"]],
      ["People", ["Casuals", "Strikes", "Notice report"]],
      [
        "Admin and records",
        ["Action log", "Pilot metrics", "Office team", "Settings", "Integrations", "Data requests"],
      ],
      ["Help", ["How-to guide"]],
    ]);
    expect(
      officeMenu("admin").map((g) => [
        g.label,
        g.folded ?? false,
        g.bottom ?? false,
        g.top ?? false,
      ]),
    ).toEqual([
      // Phase 20: at the top, with no label of its own (Needs attention in the bell's place).
      ["Home", false, false, true],
      ["Today", false, false, false],
      ["Pay", false, false, false],
      ["People", false, false, false],
      ["Admin and records", true, false, false],
      ["Help", false, true, false],
    ]);
  });

  it("resourcers don't see pay or configuration links", () => {
    expect(labels("resourcer")).toEqual([
      ["Home", ["Dashboard", "Needs attention"]],
      ["Today", ["Events & sessions", "Cancellations", "Enquiries"]],
      ["People", ["Casuals", "Strikes", "Notice report"]],
      ["Admin and records", ["Action log", "Pilot metrics"]],
      ["Help", ["How-to guide"]],
    ]);
  });

  it("payroll gets the pay dashboard (their home, not the dashboard) at the top of Pay, and the guide", () => {
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

  it("a count needs this person or not (Phase 18), drawn as the office's one grey pill (Phase 21)", () => {
    const counts = { payQueries: 3, needPerson: 2, uploads: 4 };
    // Pay queries need payroll; for an admin they're with payroll.
    expect(menuBadges("payroll", counts)["/office/pay-queries"]).toEqual({
      count: 3,
      words: "3 waiting",
      needs: true,
    });
    expect(menuBadges("admin", counts)["/office/pay-queries"]?.needs).toBe(false);
    // Enquiries that need a person and uploads to check need whoever sees them.
    expect(menuBadges("resourcer", counts)["/office/enquiries"]).toEqual({
      count: 2,
      words: "2 need a person",
      needs: true,
    });
    expect(menuBadges("admin", counts)["/office/casuals"]).toEqual({
      count: 4,
      words: "4 to check",
      needs: true,
    });
    // Needs attention (Phase 20): the one count, its items and the enquiries that need a person,
    // pale yellow; "50+" when a list stopped at 50; none when there's nothing or it couldn't be read.
    expect(
      menuBadges("resourcer", { ...counts, attention: { count: 9, more: false } })[
        "/office/needs-attention"
      ],
    ).toEqual({ count: 9, more: false, words: "9 to deal with", needs: true });
    expect(
      menuBadges("admin", { ...counts, attention: { count: 50, more: true } })[
        "/office/needs-attention"
      ],
    ).toEqual({ count: 50, more: true, words: "50+ to deal with", needs: true });
    for (const attention of [null, { count: 0, more: false }])
      expect(
        menuBadges("admin", { ...counts, attention })["/office/needs-attention"],
      ).toBeUndefined();
    // None: no badge.
    expect(menuBadges("admin", { payQueries: 0, needPerson: 0, uploads: 0 })).toEqual({});
    // Drawn (Phase 21; Dylan's brief: "one badge style (grey, red only for urgent)"): every count is
    // the office's one grey pill, the same as beside a section's heading; whether it needs you is in
    // its words (the yellow plate until Phase 21). None of the menu's counts is an urgent one.
    nav.pathname = "/office";
    const html = renderToStaticMarkup(
      createElement(OfficeNav, { groups: officeMenu("admin", menuBadges("admin", counts)) }),
    );
    const badgeOf = (href: string) =>
      new RegExp(
        `<a [^>]*href="${href}"[^>]*>[\\s\\S]*?<span aria-hidden="true" class="([^"]*)">\\d+</span>`,
      ).exec(html)?.[1] ?? "";
    for (const href of ["/office/enquiries", "/office/casuals", "/office/pay-queries"])
      expect(badgeOf(href), href).toBe(countPill);
    expect(countPill).toMatch(/(?<![\w-])bg-count(?![\w-])/);
    expect(countPill).toMatch(/(?<![\w-])text-ink-muted(?![\w-])/);
    expect(count).toBe(`ml-2 align-middle ${countPill}`);
    // No status colour on a count: none of these is urgent.
    expect(html).not.toMatch(/bg-(?:hivis|urgent|attention|wait|done)/);
    // "50+": the plus sits in the drawn count, the words say the same.
    const more = renderToStaticMarkup(
      createElement(OfficeNav, {
        groups: officeMenu(
          "admin",
          menuBadges("admin", { ...counts, attention: { count: 50, more: true } }),
        ),
      }),
    );
    expect(more).toContain(`<span aria-hidden="true" class="${countPill}">50+</span>`);
    expect(more).toContain('<span class="sr-only">50+ to deal with</span>');
  });

  it("every row is 44px tall (a thumb's, in the drawer too); the groups' names small and grey (Phase 21)", () => {
    nav.pathname = "/office/log";
    const html = renderToStaticMarkup(
      createElement(OfficeNav, { groups: officeMenu("admin"), firmName: "Acme Events" }),
    );
    const controls = [...html.matchAll(/<(a|button) [^>]*class="([^"]*)"/g)];
    expect(controls.length).toBeGreaterThan(15);
    for (const [, tag, cls] of controls) expect(cls, tag).toMatch(/(?<![\w-])min-h-11(?![\w-])/);
    // The fold's button among them ("Admin and records").
    expect(controls.some(([, tag]) => tag === "button")).toBe(true);
    const labels = [...html.matchAll(/<p class="([^"]*)">([^<]+)<\/p>/g)];
    expect(labels.map((m) => m[2])).toEqual(expect.arrayContaining(["Today", "Pay", "People"]));
    for (const [, cls] of labels)
      expect(cls).toBe("px-3 pt-6 pb-2 text-xs font-medium text-ink-muted");
    // The others: half the grey pill under the pointer, the whole pill while pressed.
    const idle = [...html.matchAll(/<a [^>]*class="([^"]*)"[^>]*>/g)]
      .filter((m) => !/aria-current=/.test(m[0]))
      .map((m) => m[1] ?? "");
    expect(idle.length).toBeGreaterThan(10);
    for (const cls of idle) {
      expect(cls).toMatch(/(?<![\w-])hover:bg-active\/60(?![\w-])/);
      expect(cls).toMatch(/(?<![\w-])active:bg-active(?![\w-])/);
    }
    // The page you're on: the grey pill.
    expect(html).toMatch(
      /<a [^>]*aria-current="page"[^>]*class="[^"]*(?<![\w-])bg-active(?![\w-])[^"]*"|<a [^>]*class="[^"]*(?<![\w-])bg-active(?![\w-])[^"]*"[^>]*aria-current="page"/,
    );
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
    // Needs attention marks its own link (Phase 20; the dashboard's before).
    ["/office/needs-attention", "/office/needs-attention"],
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
    // Integrations (12J.1) sits under Settings' address but marks its own link.
    ["/office/settings", "/office/settings"],
    ["/office/settings/integrations", "/office/settings/integrations"],
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
    // Group names are words, not headings; the folded group is a button (a <details> would be a
    // "group" the page tests find form lines by).
    expect(html).toContain(">Today</p>");
    expect(html).toMatch(
      /<button type="button" aria-expanded="false" aria-controls="menu-admin-and-records" disabled=""[^>]*>.*?Admin and records.*?<\/button><div id="menu-admin-and-records" hidden=""/,
    );
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
    // Phase 21: a grey pill (lifted off the menu's ground on the card colour in Phases 18 and 20).
    expect(marked(html, "page")[0]).toMatch(/rounded-full[^"]* bg-active font-medium/);
    expect(marked(html, "page")[0]).not.toMatch(/shadow-/);
    expect(marked(html, "page")[0]).not.toMatch(/before:/);
  });

  it("the offer page marks the Dashboard as the section it's in", () => {
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

  it("the top bar: Menu (waits for the page), the firm's name, the pay week, theme, account", () => {
    const html = shell();
    const bar = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(bar).toMatch(
      new RegExp(
        `<button type="button" aria-controls="${DRAWER_ID}" aria-expanded="false" aria-haspopup="dialog" disabled=""[^>]*>.*Menu</button>`,
      ),
    );
    // The firm's name below 1024px (from there, the menu beside the page shows it).
    expect(bar).toMatch(/<p class="[^"]*lg:hidden[^"]*">Acme Events<\/p>/);
    expect(html).toMatch(/<nav aria-label="Office menu"[^>]*>.*?Acme Events.*?Office/);
    // The pay week, from 1024px (hidden on phones and tablets), on two lines that each stay whole
    // (Phase 21); read as one.
    const week = bar.match(/<p class="[^"]*hidden[^"]*lg:block[^"]*">(.*?)<\/p>/)?.[1] ?? "";
    expect(text(week)).toBe("Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct");
    expect(week).toMatch(/<span class="block whitespace-nowrap">Week 41 · 5 Oct – 11 Oct<\/span>/);
    expect(week).toMatch(/<span class="block [^"]*whitespace-nowrap[^"]*">Pay Fri 16 Oct<\/span>/);
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
    expect(html).toMatch(/<div class="hidden [^"]*lg:flex[^"]*"><nav aria-label="Office menu"/);
  });

  it("payroll's shell: their own menu, the same bar", () => {
    const html = shell(undefined, "payroll");
    // The guide sits at the foot of the menu, without its group's name.
    expect(text(html)).toContain(
      "Acme Events Office Pay Pay dashboard Pay queries Import pay records How-to guide",
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
  it("PageHeader: the one <h1>, the lines and actions as given, nothing above the heading", () => {
    const html = renderToStaticMarkup(
      createElement(
        PageHeader,
        {
          title: "Shifts",
          titleId: "page-title",
          actions: createElement("a", { href: "/office/shifts/new" }, "New shift"),
        },
        createElement("p", null, "0 of 2 booked · Open"),
      ),
    );
    expect(html.match(/<h[1-6]\b/g)).toEqual(["<h1"]);
    expect(html).toMatch(/<h1 id="page-title"[^>]*>Shifts<\/h1>/);
    expect(text(html)).toBe("Shifts 0 of 2 booked · Open New shift");
    expect(html.indexOf("<h1")).toBeLessThan(html.indexOf("<p"));
    // Phase 17: a 24px title and no divider under the header (space separates). Phase 21: the title
    // is `text-title` (24px semibold in the casual app, the office's display serif at 28px).
    expect(html).toMatch(/<h1 id="page-title" class="[^"]*(?<![\w-])text-title(?![\w-])/);
    expect(html).not.toMatch(/text-(?:3xl|4xl)/);
    expect(html).not.toMatch(/(?<![\w-])(?:border-b|divide-y)(?![\w-])/);
  });

  it("PageHeader's way back: a link above the heading, named by its words alone", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        back: { href: "/office/cancellations", label: "Cancellations" },
        title: "Cancellation A1B2C3D4",
      }),
    );
    expect(html).toMatch(
      /^<header[^>]*><a href="\/office\/cancellations"[^>]*><svg aria-hidden="true"[\s\S]*?<\/svg>Cancellations<\/a><h1[^>]*>Cancellation A1B2C3D4<\/h1>/,
    );
    expect(text(html)).toBe("Cancellations Cancellation A1B2C3D4");
    expect(html.match(/<h[1-6]\b/g)).toEqual(["<h1"]);
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
