import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The office shell (src/app/office/office-shell.tsx, office-frame.tsx, office-nav.tsx,
// theme-button.tsx; docs/office-v2.md 3.1; docs/ui-design.md "Office shell"): which links each
// role sees in the v2 groups, which one is the current page, the rules the browser tests need the
// menu to keep (plain links outside <main>, no list items, headings or roles; the folded group a
// button, not a <details>), badges outside a link's name, and the top bar (Menu, the firm's name,
// the account menu with the theme switch, the how-to guide and the one "Log out"). Phase 18
// regrouped the menu; Phase 22 (round 2) put the firm and you over it, rows of 34px with a mouse,
// coloured counts, the pay week at its end and the menu in a box that scrolls with no bar. Phase 23
// (round 3, flat): a full-width white top bar at every width (Menu, the firm's mark and name, the
// pay week as words with "This week", the shifts line, the square light or dark switch, you), the
// menu in its own white card with its groups' names in small capitals and the current row a pale
// blue pill, the page in another white card, no depth but the two things that float.
// tests/e2e/office.shell.spec.ts drives the drawer, the theme and the account menu in a browser.
// Also the shared pieces in src/app/ui/ that add no words of their own.

const nav = vi.hoisted(() => ({ pathname: "/office" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/app/office/session-actions", () => ({ refreshOfficeSessionAction: vi.fn() }));
vi.mock("@/app/office/search-actions", () => ({ searchOfficeAction: vi.fn() }));

const { barCounts, MENU_AREAS, menuBadges, officeMenu, OfficeShell } =
  await import("@/app/office/office-shell");
const { OfficeRail, RAIL_ID } = await import("@/app/office/office-rail");
const { foldBadge, railItems, tipWords } = await import("@/app/office/rail-items");
const { railCookie, railOpenFromCookie } = await import("@/app/office/rail-cookie");
const { COLUMN_IDS } = await import("@/lib/office/board-copy");
const { ariaCurrent, currentHref, OfficeNav } = await import("@/app/office/office-nav");
const { ACCOUNT_MENU_ID, DRAWER_ID, firmInitial, initials, redrawOnArrival } =
  await import("@/app/office/office-frame");
const { moreToScroll } = await import("@/app/office/menu-scroll");
const { themeCookie } = await import("@/app/office/theme-button");
const { PageHeader } = await import("@/app/ui/page-header");
const { count, countNeeds, countPill, countWaiting } = await import("@/app/ui/classes");
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
  // Phase 24: Enquiries before Cancellations, as the rail lists them (PLAN.md 24.2); Pay, People
  // and Admin and records each a fold in the rail, with its own icon.
  it("admins see every link, in groups: the dashboard and Needs attention first, then today's, the records and settings folded", () => {
    expect(labels("admin")).toEqual([
      ["Home", ["Dashboard", "Needs attention"]],
      ["Today", ["Events & sessions", "Enquiries", "Cancellations"]],
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
        g.rail ?? null,
        g.icon ?? null,
      ]),
    ).toEqual([
      // Phase 20: at the top, with no label of its own (Needs attention in the bell's place).
      ["Home", false, false, true, null, null],
      ["Today", false, false, false, null, null],
      ["Pay", false, false, false, "fold", "pay"],
      ["People", false, false, false, "fold", "workers"],
      ["Admin and records", true, false, false, "fold", "settings"],
      ["Help", false, true, false, null, null],
    ]);
  });

  it("resourcers don't see pay or configuration links", () => {
    expect(labels("resourcer")).toEqual([
      ["Home", ["Dashboard", "Needs attention"]],
      ["Today", ["Events & sessions", "Enquiries", "Cancellations"]],
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
    // Drawn (Phase 22, round 2): in its dashboard card's colour, amber when it needs you (Needs
    // attention's, an enquiry that needs a person, uploads to check), blue when it's waiting with
    // someone else (pay queries with payroll, for anyone but payroll); its words say the same. One
    // grey pill in Phase 21. None of the menu's counts is an urgent one.
    nav.pathname = "/office";
    const html = renderToStaticMarkup(
      createElement(OfficeNav, { groups: officeMenu("admin", menuBadges("admin", counts)) }),
    );
    const badgeOf = (href: string) =>
      new RegExp(
        `<a [^>]*href="${href}"[^>]*>[\\s\\S]*?<span aria-hidden="true" class="([^"]*)">\\d+</span>`,
      ).exec(html)?.[1] ?? "";
    for (const href of ["/office/enquiries", "/office/casuals"])
      expect(badgeOf(href), href).toBe(countNeeds);
    expect(badgeOf("/office/pay-queries")).toBe(countWaiting);
    expect(countNeeds).toMatch(/(?<![\w-])bg-hivis text-on-hivis(?![\w-])/);
    expect(countWaiting).toMatch(/(?<![\w-])bg-wait-tile text-wait-ink(?![\w-])/);
    // Flat tinted pills (Phase 23): no edge, no depth.
    for (const c of [countNeeds, countWaiting])
      expect(c).not.toMatch(/(?<![\w-])(?:border|(?:inset-)?shadow)(?:-[\w/-]+)?(?![\w-])/);
    // For payroll, pay queries need them: amber.
    const payroll = renderToStaticMarkup(
      createElement(OfficeNav, { groups: officeMenu("payroll", menuBadges("payroll", counts)) }),
    );
    expect(
      new RegExp(
        `<a [^>]*href="/office/pay-queries"[^>]*>[\\s\\S]*?<span aria-hidden="true" class="([^"]*)">`,
      ).exec(payroll)?.[1],
    ).toBe(countNeeds);
    // Beside a section's heading the count stays the grey pill: clear glass since Phase 24.
    expect(countPill).toMatch(/(?<![\w-])glass-button(?![\w-])/);
    expect(countPill).toMatch(/(?<![\w-])text-ink-muted(?![\w-])/);
    expect(count).toBe(`ml-2 align-middle ${countPill}`);
    // Nothing in the menu is red: none of these is urgent.
    expect(html).not.toMatch(/bg-urgent/);
    // "50+": the plus sits in the drawn count, the words say the same.
    const more = renderToStaticMarkup(
      createElement(OfficeNav, {
        groups: officeMenu(
          "admin",
          menuBadges("admin", { ...counts, attention: { count: 50, more: true } }),
        ),
      }),
    );
    expect(more).toContain(`<span aria-hidden="true" class="${countNeeds}">50+</span>`);
    expect(more).toContain('<span class="sr-only">50+ to deal with</span>');
  });

  // Phase 22: 34px with a mouse from 1024px, so an admin's whole menu fits a laptop window
  // (tests/e2e/office.shell.spec.ts measures it at 1280 × 640); 44px for a thumb, so in the drawer
  // and on a touch screen. Phase 23: the groups' names in small grey capitals, by CSS only.
  it("every row is 44px for a thumb (in the drawer too) and 34px with a mouse; the groups' names small grey capitals", () => {
    nav.pathname = "/office/log";
    const html = renderToStaticMarkup(createElement(OfficeNav, { groups: officeMenu("admin") }));
    const controls = [...html.matchAll(/<(a|button) [^>]*class="([^"]*)"/g)];
    expect(controls.length).toBeGreaterThan(15);
    for (const [, tag, cls] of controls) {
      expect(cls, tag).toMatch(/(?<![\w-])min-h-11(?![\w-])/);
      expect(cls, tag).toMatch(/(?<![\w-])lg:pointer-fine:min-h-8\.5(?![\w-])/);
      // It dips when pressed.
      expect(cls, tag).toMatch(/^press /);
    }
    // The fold's button among them ("Admin and records").
    expect(controls.some(([, tag]) => tag === "button")).toBe(true);
    const labels = [...html.matchAll(/<p class="([^"]*)">([^<]+)<\/p>/g)];
    // The words stay as they are (the guide and the tests read "Today"); the capitals are CSS.
    expect(labels.map((m) => m[2])).toEqual(["Today", "Pay", "People"]);
    for (const [, cls] of labels)
      expect(cls).toBe("px-3 pt-2 text-xs font-bold tracking-[0.08em] text-ink-faint uppercase");
    // The others: a pale grey wash under the pointer, a darker one while pressed.
    const idle = [...html.matchAll(/<a [^>]*class="([^"]*)"[^>]*>/g)]
      .filter((m) => !/aria-current=/.test(m[0]))
      .map((m) => m[1] ?? "");
    expect(idle.length).toBeGreaterThan(10);
    for (const cls of idle) {
      expect(cls).toMatch(/(?<![\w-])hover:bg-active(?![\w/-])/);
      expect(cls).toMatch(/(?<![\w-])active:bg-button-press(?![\w-])/);
      expect(cls).not.toMatch(/(?<![\w-])(?:font-semibold|bg-pill)(?![\w-])/);
    }
    // The page you're on: a pale blue pill with bolder words (until the page is ready; then the
    // one pill that slides), flat (Phase 23; a white pill raised off the menu's ground in 22).
    expect(html).toMatch(
      /<a [^>]*aria-current="page"[^>]*class="[^"]*(?<![\w-])font-semibold text-ink bg-pill"|<a [^>]*class="[^"]*(?<![\w-])font-semibold text-ink bg-pill"[^>]*aria-current="page"/,
    );
    expect(html).not.toMatch(/(?<![\w-])(?:[a-z0-9-]+:)*(?:inset-)?shadow-/);
    // The how-to guide isn't in the menu: it's in the account menu (Phase 22).
    expect(html).not.toContain('href="/office/guide"');
  });

  // An admin's whole menu fits a laptop window 640px tall under the 64px top bar (Phase 23; the
  // browser test measures it): its card's box is 640 − 64 − 16 − 16 − 18 = 526px tall at most
  // (office-frame.tsx), and the menu is 512px: 12 rows of 34px, 4px apart in a group, each group's
  // name 24px (8px over 16px words), no gap between groups, the fold 4px under People.
  it("the menu's spacing: rows 4px apart, a group's name 8px over them, nothing between groups", () => {
    nav.pathname = "/office";
    const html = renderToStaticMarkup(createElement(OfficeNav, { groups: officeMenu("admin") }));
    expect(html).toMatch(/^<nav aria-label="Office menu" class="relative flex flex-col">/);
    const groups = [...html.matchAll(/<div class="([^"]*)"><div><a /g)].map((m) => m[1]);
    // Home, Today, Pay, People (the fold's own links are shut).
    expect(groups).toEqual(Array(4).fill("flex flex-col gap-1"));
    expect(html).toMatch(/<div class="mt-1"><button type="button" aria-expanded="false"/);
    expect(html).toContain(
      '<div id="menu-admin-and-records" hidden="" class="flex flex-col gap-1 animate-in pt-1 pl-4">',
    );
  });

  it("the menu's box fades only at an edge with more to scroll to", () => {
    expect(moreToScroll(0, 600, 600)).toBeUndefined();
    expect(moreToScroll(0, 584, 633)).toBe("below");
    expect(moreToScroll(49, 584, 633)).toBe("above");
    expect(moreToScroll(20, 584, 633)).toBe("both");
    // A pixel or two either way is the edge (a fraction of one when zoomed).
    expect(moreToScroll(1, 584, 586)).toBeUndefined();
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

  it("the page itself is aria-current=page, on its pale blue pill", () => {
    nav.pathname = "/office/events";
    const html = render();
    expect(html.match(/aria-current=/g)).toHaveLength(1);
    expect(marked(html, "true")).toEqual([]);
    expect(marked(html, "page")).toHaveLength(1);
    expect(marked(html, "page")[0]).toContain('href="/office/events"');
    // Phase 23: a pale blue pill, flat, its words bolder (a white pill raised off the menu's
    // ground in Phase 22; a grey one in Phase 21; lifted off it on the card colour in 18 and 20).
    expect(marked(html, "page")[0]).toMatch(/rounded-row[^"]* font-semibold text-ink bg-pill"/);
    expect(marked(html, "page")[0]).not.toMatch(/shadow/);
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
  const COUNTS = { toFill: 26, urgent: 2, offersOut: 11 };
  const shell = (
    theme?: "light" | "dark",
    role: "admin" | "resourcer" | "payroll" = "admin",
    opts: { railOpen?: boolean; pathname?: string; shell?: typeof COUNTS | null } = {},
  ) => {
    nav.pathname = opts.pathname ?? "/office";
    // Hook-free, so it can be called directly.
    return renderToStaticMarkup(
      OfficeShell({
        name: "Sam Admin",
        roleLabel: role === "admin" ? "Admin" : role === "payroll" ? "Payroll" : "Resourcer",
        firmName: "Acme Events",
        menu: officeMenu(role),
        counts: barCounts(role, {
          shell: opts.shell === undefined ? COUNTS : opts.shell,
          attention: { count: 7, more: false },
          payQueries: 10,
        }),
        canSearch: role !== "payroll",
        railOpen: opts.railOpen ?? false,
        theme,
        rotationDue: false,
        children: createElement("main", null, "PAGE"),
      }),
    );
  };
  const barOf = (html: string) => html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  // The bar up to the account menu (a popover that opens from it).
  const barOnly = (html: string) =>
    html.slice(html.indexOf("<header"), html.indexOf(`<div id="${ACCOUNT_MENU_ID}"`));
  const countsOf = (html: string) =>
    html.slice(
      html.indexOf("<div data-bar-counts"),
      html.indexOf('<span aria-hidden="true" class="min-w-0 flex-1">'),
    );

  // Phase 24: the rail (with the menu) comes first, at the left from 1024px; then the column with
  // the top bar, the drawer and the page.
  it("in order: the skip link, the rail with the menu, the top bar, then the page in #main", () => {
    const html = shell();
    expect(html).toContain('data-shell="office"');
    const skipAt = html.indexOf('href="#main"');
    const railAt = html.indexOf(`<div id="${RAIL_ID}"`);
    const navAt = html.indexOf("<nav");
    const barAt = html.indexOf("<header");
    const mainAt = html.indexOf('id="main"');
    const pageAt = html.indexOf("<main>PAGE</main>");
    expect(skipAt).toBeGreaterThan(-1);
    expect(railAt).toBeGreaterThan(skipAt);
    expect(navAt).toBeGreaterThan(railAt);
    expect(barAt).toBeGreaterThan(navAt);
    expect(mainAt).toBeGreaterThan(barAt);
    expect(pageAt).toBeGreaterThan(mainAt);
    // One <nav>, and the page's own <main> is the only one; one top bar (a <header> in the drawer
    // would be a second banner).
    expect(html.match(/<nav\b/g)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<header\b/g)).toHaveLength(1);
    expect(html.match(/>Log out</g)).toHaveLength(1);
  });

  // Phase 24 (round 7): no ground of the shell's own, so the wash shows through; from 1024px the
  // rail beside the column (72px, or 236px open: the grid's first column follows it), the bar no
  // glass of its own but three floating capsules and the frosted edge, the page no card. Below
  // 1024px the bar is floating glass the window's full width. No shadow class at all (the glass
  // draws its own rim and drop), no grain, no blur of a class's own.
  it("glass: no ground of its own, the rail and the three capsules float, no page card", () => {
    const html = shell();
    expect(html).toContain(
      '<div data-shell="office" class="flex flex-1 flex-col text-base text-ink lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-x-3 lg:px-3">',
    );
    expect(html).toMatch(
      /<div id="office-rail" data-rail="shut" class="glass-float sticky top-3 z-30 mt-3 hidden flex-col self-start rounded-card [^"]*lg:flex scrollbar-none w-18 items-center [^"]*">/,
    );
    // The bar: a container (its capsules fit the column), floating glass below 1024px, the frosted
    // edge from there, sticking to the top.
    expect(barOf(html)).toMatch(
      /^<header class="@container max-lg:glass-float lg:scroll-edge sticky top-0 z-20 flex min-h-14 items-center gap-2 px-3 sm:gap-3 lg:min-h-0 lg:gap-2 lg:px-0 lg:pt-3 lg:pb-2">/,
    );
    // The three capsules (from 1024px): the counts, the search, you.
    expect(barOf(html)).toContain(
      '<div data-bar-counts="" class="glass-float scrollbar-none hidden min-w-0 shrink items-center overflow-x-auto rounded-full p-1 lg:flex">',
    );
    expect(barOf(html)).toMatch(
      /<div class="relative hidden lg:block"><div class="glass-float flex h-12 w-50 items-center gap-2 rounded-full pr-2 pl-4 @min-\[73.25rem\]:w-62.5">/,
    );
    expect(barOf(html)).toContain(
      '<div class="flex shrink-0 items-center gap-2 sm:gap-3 lg:glass-float lg:gap-1 lg:rounded-full lg:p-1">',
    );
    // The page (`#main > div > div`): no card, no fill, no edge; the column's width from 1024px.
    expect(html).toContain(
      '<div id="main" tabindex="-1" class="flex min-w-0 flex-1 flex-col px-2 pt-3 pb-6 focus:outline-none lg:p-0"><div class="flex-1"><div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:max-w-[100rem] lg:px-0 lg:pt-3 lg:pb-8">',
    );
    const shadows = [...html.matchAll(/(?<![\w-])(?:[a-z0-9-]+:)*(?:inset-|drop-)?shadow-[\w-]+/g)];
    expect(shadows.map((m) => m[0])).toEqual([]);
    expect(html).toMatch(/<div id="office-account-menu" popover="auto" class="[^"]*glass-float/);
    expect(html).toMatch(
      /<dialog id="office-menu-drawer" aria-label="Menu" class="[^"]*glass-float/,
    );
    // Floating glass: the rail, the counts, the search, the account menu and the drawer; the bar
    // below 1024px and you from there.
    expect(html.match(/(?<![\w:-])glass-float(?![\w-])/g)).toHaveLength(5);
    expect(html.match(/ max-lg:glass-float /g)).toHaveLength(1);
    expect(html.match(/ lg:glass-float /g)).toHaveLength(1);
    expect(html).not.toMatch(/(?<![\w-])(?:grain|stripes|tint-|backdrop-blur|card-chip)/);
    expect(html).not.toMatch(/(?<![\w-])bg-(?:canvas|sheet|card)(?![\w-])/);
    // The menu card of Phases 22 and 23 is gone.
    expect(html).not.toMatch(/class="glass hidden rounded-card/);
  });

  it("below 1024px: Menu (waits for the page), the firm, the light or dark switch, you", () => {
    const html = shell();
    const bar = barOf(html);
    expect(bar).toMatch(
      new RegExp(
        `<button type="button" aria-controls="${DRAWER_ID}" aria-expanded="false" aria-haspopup="dialog" disabled=""[^>]*>.*Menu</button>`,
      ),
    );
    // Menu: a clear glass pill that swells under a press, below 1024px only.
    expect(bar).toMatch(
      /aria-haspopup="dialog" disabled="" class="press-glass glass-button [^"]*rounded-full [^"]*lg:hidden">/,
    );
    // The firm below 1024px (the rail has its mark from there): its initial on its own colour and
    // its name.
    expect(bar).toContain(
      '<div class="min-w-0 lg:hidden"><p class="flex min-w-0 items-center gap-3 leading-tight"><span aria-hidden="true" class="flex size-9 shrink-0 items-center justify-center rounded-row bg-brand-bar text-base font-extrabold text-on-brand-bar">A</span><span class="min-w-0"><span class="block truncate font-bold text-ink">Acme Events</span><span class="hidden">Office</span></span></p></div>',
    );
    // The light or dark switch: 44px, 14px corners, clear glass below 1024px; round, 40px, in the
    // capsule from there; its words its name and shown beside it on keyboard focus and under the
    // pointer (WCAG 1.4.13: they take the pointer, an 8px bridge over the gap).
    expect(bar).toMatch(
      /<span class="group\/tip relative flex shrink-0"><button type="button" aria-label="Switch to dark mode" disabled="" class="peer press-glass max-lg:glass-button inline-flex size-11 items-center justify-center rounded-row [^"]*lg:size-10 lg:rounded-full"><svg [^>]*><path [^>]*><\/path><\/svg><\/button><span aria-hidden="true" data-theme-tip="" class="absolute top-full right-0 z-30 mt-2 hidden animate-pop rounded-row bg-ink px-3 py-2 text-sm font-semibold whitespace-nowrap text-on-ink before:absolute before:inset-x-0 before:-top-2 before:h-2 peer-focus-visible:block pointer-fine:group-hover\/tip:block">Switch to dark mode<\/span><\/span>/,
    );
    // In that order, left to right (HTML attribute names ignore case: React writes
    // "popoverTarget").
    const at = (s: string) => bar.toLowerCase().indexOf(s.toLowerCase());
    const order = [
      ">Menu</button>",
      ">Acme Events<",
      "data-bar-counts",
      'type="search"',
      'aria-label="Switch to dark mode"',
      `popovertarget="${ACCOUNT_MENU_ID}"`,
    ].map(at);
    expect(order.every((n) => n > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  // The pay week moved to the dashboards' lines and the shifts line's number to Settings (PLAN.md
  // 24.2).
  it("no pay week and no shifts line in the bar", () => {
    const html = shell();
    expect(html).not.toMatch(/Week \d|Pay Fri|This week/);
    expect(html).not.toMatch(/Shifts line|\+44/);
    expect(html).not.toMatch(/xl:flex/);
  });

  // The counts (round 7's first capsule), from 1024px: each a link to where it's worked, swelling
  // under a press, a hairline between them; its icon only when the bar has room for all three
  // capsules with it; Urgent's number red while there are any.
  it("the counts: To fill, Urgent, Offers out, To check and Pay queries, each opening where it's worked", () => {
    const html = shell();
    const counts = countsOf(html);
    const links = [...counts.matchAll(/<a class="([^"]*)" href="([^"]*)">(.*?)<\/a>/g)];
    expect(links.map((m) => [m[2], text(m[3] ?? "")])).toEqual([
      ["/office/events?view=need", "To fill 26"],
      ["/office/events?view=urgent", "Urgent 2"],
      ["/office#offered", "Offers out 11"],
      ["/office/needs-attention", "To check 7"],
      ["/office/pay-queries", "Pay queries 10"],
    ]);
    for (const m of links) {
      expect(m[1]).toBe(
        "press-glass flex h-10 items-center gap-2 rounded-full px-3 text-ink-muted hover:bg-active hover:text-ink active:bg-button-press",
      );
      expect(m[3]).toMatch(/^<svg [^>]*class="shrink-0 hidden @min-\[73.25rem\]:block">/);
    }
    expect(
      counts.match(/<span aria-hidden="true" class="h-5 w-px bg-line"><\/span>/g),
    ).toHaveLength(4);
    expect(counts).toContain('Urgent <b class="font-semibold tabular-nums text-urgent-ink">2</b>');
    expect(counts).toContain('To fill <b class="font-semibold tabular-nums text-ink">26</b>');
    // No urgent places: its number in ink.
    expect(countsOf(shell(undefined, "admin", { shell: { ...COUNTS, urgent: 0 } }))).toContain(
      'Urgent <b class="font-semibold tabular-nums text-ink">0</b>',
    );
    // Counts that couldn't be read: the words alone.
    const unread = countsOf(shell(undefined, "admin", { shell: null }));
    expect(text(unread)).toBe("To fill Urgent Offers out To check 7 Pay queries 10");
  });

  it("each role's counts and search: payroll has its pay queries and no search", () => {
    expect(text(countsOf(shell(undefined, "resourcer")))).toBe(
      "To fill 26 Urgent 2 Offers out 11 To check 7",
    );
    const payroll = shell(undefined, "payroll");
    expect(text(countsOf(payroll))).toBe("Pay queries 10");
    expect(payroll).not.toContain('type="search"');
    expect(shell(undefined, "resourcer")).toContain('type="search"');
  });

  // Round 7's second capsule: "Search" with ⌘K (or Ctrl K, said once the page is ready); its
  // label says what it finds; it waits for the page; the panel is drawn only while it's open; one
  // polite live line (not a status role: page tests find statuses).
  it("the search: a labelled box that waits for the page, its panel shut", () => {
    const bar = barOf(shell());
    expect(bar).toMatch(
      /<label for="([^"]+)" class="sr-only">Find a casual, shift or site<\/label><input id="\1" type="search" autoComplete="off" spellCheck="false" placeholder="Search" disabled="" aria-describedby="([^"]+)" class="[^"]*"/,
    );
    expect(bar).toMatch(/<p id="[^"]+" aria-live="polite" class="sr-only"><\/p>/);
    expect(bar).not.toContain("data-search-panel");
    expect(bar).not.toContain("<kbd");
    expect(bar).not.toMatch(/role="(?:status|combobox|listbox)"/);
  });

  // Round 7's third capsule: the light or dark button, then you: your initials (a pale blue disc
  // from 1024px), your name (from 640px; with your role under it from 1024px when the bar has the
  // room) and a chevron. Read out at every width as "Sam Admin Admin".
  it("you: your initials, name and role, opening the account menu", () => {
    const bar = barOf(shell());
    const account = bar.match(
      new RegExp(
        `<button type="button" popovertarget="${ACCOUNT_MENU_ID}"[^>]*>(.*?)</button>`,
        "i",
      ),
    )?.[1];
    expect(account).toBeDefined();
    expect(account).toMatch(
      /^<span aria-hidden="true" class="flex size-9 shrink-0 items-center justify-center rounded-full glass-button text-sm font-bold text-ink-muted lg:size-8 lg:glass-rim lg:bg-wait-tile lg:bg-none lg:text-xs lg:font-semibold lg:text-wait-ink">SA<\/span>/,
    );
    expect(account).toContain(
      '<span class="sr-only leading-tight sm:not-sr-only lg:sr-only lg:@min-[63rem]:not-sr-only"><span class="block max-w-48 truncate font-semibold text-ink lg:max-w-28 lg:font-medium">Sam Admin</span><span class="sr-only lg:not-sr-only lg:block lg:text-sm lg:leading-tight lg:text-ink-muted"> Admin</span></span>',
    );
    expect(account).toMatch(
      /<svg [^>]*class="shrink-0 hidden rotate-90 text-ink-muted sm:block lg:hidden lg:@min-\[63rem\]:block"/,
    );
    expect(text((account ?? "").replace(/<span aria-hidden="true"[^>]*>SA<\/span>/, ""))).toBe(
      "Sam Admin Admin",
    );
    // Everything in the bar, read in order (the switch's words under it are hidden from screen
    // readers, and said once here by its name).
    expect(text(barOnly(shell()))).toBe(
      "Menu A Acme Events Office To fill 26 Urgent 2 Offers out 11 To check 7 Pay queries 10 Find a casual, shift or site Switch to dark mode SA Sam Admin Admin",
    );
  });

  it("the account menu: the name and role, the theme switch, How-to guide and the one Log out", () => {
    const html = shell();
    const at = html.indexOf(`<div id="${ACCOUNT_MENU_ID}" popover="auto"`);
    expect(at).toBeGreaterThan(-1);
    const menu = html.slice(at, html.indexOf("</header>"));
    expect(text(menu)).toBe("Sam Admin Admin Switch to dark mode How-to guide Log out");
    // Under you, growing from its corner (the page puts its corner under yours as it opens:
    // office-frame.tsx); floating glass with its 22px corners.
    expect(menu).toMatch(
      /^<div id="office-account-menu" popover="auto" class="inset-auto top-16 right-3 m-0 w-64 origin-top-right animate-pop rounded-inner glass-float p-2 text-base text-ink">/,
    );
    // The guide is one row here, and nowhere else in the shell (Phase 22: the menu's foot until then).
    expect(menu).toContain('href="/office/guide"');
    expect(html.match(/href="\/office\/guide"/g)).toHaveLength(1);
    // The theme switch waits for the page, and says what it switches to.
    expect(menu).toMatch(
      /<button type="button" disabled="" class="press [^"]*">.*?Switch to dark mode<\/button>/,
    );
    // No ARIA menu roles: a native popover of plain buttons and a link.
    expect(menu).not.toMatch(/role="/);
  });

  // Both switches, the bar's and the account menu's, read the page's theme: they always say the
  // same (theme-button.tsx; the browser test switches with each and reads the other).
  it("both theme switches' words follow the cookie's theme, and say the same", () => {
    for (const [theme, words, other] of [
      ["dark", "Switch to light mode", "Switch to dark mode"],
      ["light", "Switch to dark mode", "Switch to light mode"],
      [undefined, "Switch to dark mode", "Switch to light mode"],
    ] as const) {
      const html = shell(theme);
      expect(barOnly(html)).toContain(`aria-label="${words}"`);
      expect(barOnly(html)).toContain(`>${words}</span>`);
      expect(html).toMatch(new RegExp(`${words}</button>`));
      expect(html.match(new RegExp(words, "g"))).toHaveLength(3);
      expect(html).not.toContain(other);
    }
  });

  it("the drawer is a native dialog, empty until it's opened; the menu is in the rail", () => {
    const html = shell();
    const dialog = html.match(new RegExp(`<dialog[^>]*id="${DRAWER_ID}"[^>]*>(.*?)</dialog>`));
    expect(dialog).not.toBeNull();
    expect(dialog?.[0]).toContain('aria-label="Menu"');
    expect(dialog?.[0]).not.toMatch(/\bopen\b=/);
    expect(dialog?.[1]).toBe("");
    // Floating glass, full height at the left, over the dimmed page; it slides in.
    expect(dialog?.[0]).toContain(
      'class="inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-80 max-w-[85vw] overflow-hidden glass-float p-0 text-base text-ink transition-[translate] duration-200 ease-sd backdrop:animate-fade backdrop:bg-scrim/40 starting:-translate-x-full"',
    );
    const rail = html.slice(html.indexOf(`<div id="${RAIL_ID}"`), html.indexOf("<header"));
    expect(rail).toContain('<nav aria-label="Office menu" class="flex flex-col gap-1">');
  });

  it("payroll's shell: their own menu in the rail, the bar with their count", () => {
    const html = shell(undefined, "payroll", { pathname: "/office/pay" });
    const rail = html.slice(html.indexOf(`<div id="${RAIL_ID}"`), html.indexOf("<header"));
    // Pay is all their menu: its pages as icons, no fold.
    expect([...rail.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "/office/pay",
      "/office/pay-queries",
      "/office/pay/import",
    ]);
    expect(rail).not.toMatch(/aria-controls="rail-/);
    expect(html.match(/href="\/office\/guide"/g)).toHaveLength(1);
    expect(html).not.toContain('href="/office/events"');
    expect(html).not.toContain('href="/office/shifts"');
  });
});

describe("the rail", () => {
  const BADGES = menuBadges("admin", {
    payQueries: 3,
    needPerson: 2,
    uploads: 4,
    attention: { count: 9, more: false },
  });
  const render = (pathname: string, open = false, groups = officeMenu("admin", BADGES)) => {
    nav.pathname = pathname;
    return renderToStaticMarkup(
      createElement(OfficeRail, {
        groups,
        firmName: "Acme Events",
        firmInitial: "A",
        initialOpen: open,
      }),
    );
  };
  // A row's link or button, with what's read inside it and after it.
  const rows = (html: string) =>
    [
      ...html.matchAll(/<div class="group\/tip [^"]*">(<(a|button) [^>]*>.*?<\/\2>)(.*?)<\/div>/g),
    ].map((m) => ({
      el: m[1] ?? "",
      name: text(
        (m[1] ?? "")
          .replace(/<span aria-hidden="true"[^>]*>.*?<\/span>/g, "")
          .replace(/<svg[\s\S]*?<\/svg>/g, ""),
      ).replace(/&amp;/g, "&"),
      after: m[3] ?? "",
    }));

  it("its rows from the menu: the links as icons, Pay and People folds, Admin and records under a line", () => {
    const items = railItems(officeMenu("admin"));
    expect(
      items.map((i) => (i.kind === "link" ? i.link.label : `fold:${i.group.label}:${i.apart}`)),
    ).toEqual([
      "Dashboard",
      "Needs attention",
      "Events & sessions",
      "Enquiries",
      "Cancellations",
      "fold:Pay:false",
      "fold:People:false",
      "fold:Admin and records:true",
    ]);
    expect(
      railItems(officeMenu("resourcer")).map((i) =>
        i.kind === "link" ? i.link.label : `fold:${i.group.label}`,
      ),
    ).toEqual([
      "Dashboard",
      "Needs attention",
      "Events & sessions",
      "Enquiries",
      "Cancellations",
      "fold:People",
      "fold:Admin and records",
    ]);
    // Payroll's menu is only Pay: its pages as icons.
    expect(
      railItems(officeMenu("payroll")).map((i) => (i.kind === "link" ? i.link.label : "fold")),
    ).toEqual(["Pay dashboard", "Pay queries", "Import pay records"]);
    // The how-to guide stays in the account menu.
    expect(
      railItems(officeMenu("admin")).some(
        (i) => i.kind === "link" && i.link.href === "/office/guide",
      ),
    ).toBe(false);
  });

  it("a fold's count adds up its pages', needing you when one does; its words are theirs", () => {
    const groups = officeMenu("admin", BADGES);
    const pay = groups.find((g) => g.label === "Pay");
    const people = groups.find((g) => g.label === "People");
    const admin = groups.find((g) => g.label === "Admin and records");
    expect(pay && foldBadge(pay)).toEqual({
      count: 3,
      more: false,
      words: "3 waiting",
      needs: false,
    });
    expect(people && foldBadge(people)).toEqual({
      count: 4,
      more: false,
      words: "4 to check",
      needs: true,
    });
    expect(admin && foldBadge(admin)).toBeNull();
    expect(tipWords("Enquiries", { count: 2, words: "2 need a person" })).toBe(
      "Enquiries, 2 need a person",
    );
    expect(tipWords("Cancellations", undefined)).toBe("Cancellations");
  });

  it("shut: the firm's mark, its own button, and icons named by their words alone", () => {
    const html = render("/office");
    expect(html).toMatch(
      /^<div id="office-rail" data-rail="shut" class="glass-float sticky top-3 z-30 mt-3 hidden flex-col self-start rounded-card px-2 py-4 transition-\[width\] duration-200 ease-sd lg:flex scrollbar-none w-18 items-center \[@media\(height&lt;40rem\)\]:max-h-\[calc\(100dvh-1.5rem\)\] \[@media\(height&lt;40rem\)\]:overflow-y-auto">/,
    );
    // The mark (the firm's initial on its colour); its name for screen readers.
    expect(html).toContain(
      '<span aria-hidden="true" class="flex size-10 shrink-0 items-center justify-center rounded-row bg-brand-bar text-lg font-semibold text-on-brand-bar">A</span><span class="sr-only">Acme Events</span>',
    );
    // Its own button: waits for the page, says what it does.
    expect(html).toMatch(
      /<button type="button" aria-expanded="false" aria-controls="office-rail" disabled="" class="press-glass [^"]*"><span class="sr-only">Show the menu with names<\/span><svg /,
    );
    const r = rows(html);
    expect(r.map((x) => x.name)).toEqual([
      "Dashboard",
      "Needs attention",
      "Events & sessions",
      "Enquiries",
      "Cancellations",
      "Pay",
      "Pay dashboard",
      "Pay queries",
      "Import pay records",
      "People",
      "Casuals",
      "Strikes",
      "Notice report",
      "Admin and records",
      "Action log",
      "Pilot metrics",
      "Office team",
      "Settings",
      "Integrations",
      "Data requests",
    ]);
    // Round icons, 48px; the folds shut with their pages (rows with their names) hidden.
    const folds = ["Pay", "People", "Admin and records"];
    const pages = r.filter((x) => / min-h-9.5 /.test(x.el)).map((x) => x.name);
    expect(pages).toEqual([
      "Pay dashboard",
      "Pay queries",
      "Import pay records",
      "Casuals",
      "Strikes",
      "Notice report",
      "Action log",
      "Pilot metrics",
      "Office team",
      "Settings",
      "Integrations",
      "Data requests",
    ]);
    for (const x of r.filter((y) => !pages.includes(y.name)))
      expect(x.el).toMatch(/ size-12 justify-center rounded-full /);
    expect(folds.every((f) => r.some((x) => x.name === f && x.el.startsWith("<button")))).toBe(
      true,
    );
    for (const id of ["rail-pay", "rail-people", "rail-admin-and-records"]) {
      expect(html).toMatch(
        new RegExp(`<button type="button" aria-expanded="false" aria-controls="${id}" disabled=""`),
      );
      expect(html).toContain(`<div id="${id}" hidden=""`);
    }
    // Admin and records under a line.
    expect(html).toMatch(
      /<div class="mt-4 border-t border-line pt-3"><div class="group\/tip [^"]*"><button [^>]*aria-controls="rail-admin-and-records"/,
    );
    // Plain links and buttons: nothing the page tests count.
    expect(html).not.toMatch(/<(li|ul|ol|h[1-6]|details|summary|fieldset|section|output)\b/);
    expect(html).not.toMatch(/role="/);
  });

  it("a red dot where a page needs you, and the words beside each icon say why", () => {
    const html = render("/office");
    const r = rows(html);
    const dotted = r.filter((x) => x.el.includes("data-rail-dot")).map((x) => x.name);
    // Needs attention, enquiries that need a person, and People (its uploads to check); not Pay
    // (an admin's pay queries are with payroll).
    expect(dotted).toEqual(["Needs attention", "Enquiries", "People"]);
    expect(html).toContain(
      '<span aria-hidden="true" data-rail-dot="" class="absolute top-2 right-2 size-3 rounded-full border-2 border-panel bg-urgent bg-clip-padding"></span>',
    );
    const tip = (name: string) =>
      r.find((x) => x.name === name)?.after.match(/data-rail-tip="" class="([^"]*)">([^<]*)</);
    expect(tip("Needs attention")?.[2]).toBe("Needs attention, 9 to deal with");
    expect(tip("Enquiries")?.[2]).toBe("Enquiries, 2 need a person");
    expect(tip("Pay")?.[2]).toBe("Pay, 3 waiting");
    expect(tip("People")?.[2]).toBe("People, 4 to check");
    expect(tip("Cancellations")?.[2]).toBe("Cancellations");
    // Shown under the pointer and on keyboard focus, to the right, over an invisible 12px bridge;
    // hidden from screen readers (the row's own name and words say them).
    expect(tip("Cancellations")?.[1]).toBe(
      "absolute top-1/2 left-full z-30 ml-3 hidden -translate-y-1/2 animate-pop rounded-row bg-ink px-3 py-2 text-sm font-semibold whitespace-nowrap text-on-ink before:absolute before:inset-y-0 before:-left-3 before:w-3 peer-focus-visible:block pointer-fine:group-hover/tip:block",
    );
    // Beside each icon (a fold's pages show only with the rail open, with their names).
    const icons = r.filter((x) => !/ min-h-9.5 /.test(x.el)).length;
    expect(html.match(/<span aria-hidden="true" data-rail-tip="" class="absolute/g)?.length).toBe(
      icons,
    );
    // A count's words read after its row.
    expect(r.find((x) => x.name === "Enquiries")?.after).toMatch(
      /^<span class="sr-only">2 need a person<\/span>/,
    );
  });

  it("the page you're on under the lens, its icon in the accent; inside a shut fold, the fold wears it", () => {
    const home = rows(render("/office"));
    expect(home[0]?.el).toMatch(
      /^<a aria-current="page" class="[^"]* lens font-medium text-ink" href="\/office">/,
    );
    expect(home[0]?.el).toMatch(/<svg [^>]*class="shrink-0 text-accent">/);
    expect(home.filter((x) => x.el.includes(" lens "))).toHaveLength(1);
    // A casual's page: Casuals is the section (aria-current=true, inside People); People, shut,
    // wears the lens.
    const casual = rows(render("/office/casuals/11111111-1111-4111-8111-111111111111"));
    expect(casual.find((x) => x.name === "Casuals")?.el).toMatch(/aria-current="true"/);
    expect(casual.find((x) => x.name === "People")?.el).toMatch(/ lens font-medium text-ink"/);
    expect(casual.filter((x) => x.el.includes(" lens ")).map((x) => x.name)).toEqual([
      "People",
      "Casuals",
    ]);
  });

  it("open: names and counts, its button says so, the fold you're in open", () => {
    const html = render("/office/casuals", true);
    expect(html).toMatch(
      /^<div id="office-rail" data-rail="open" class="glass-float [^"]* lg:flex max-h-\[calc\(100dvh-1.5rem\)\] w-59">/,
    );
    expect(html).toContain(
      '<span class="min-w-0 flex-1 truncate font-semibold text-ink">Acme Events</span>',
    );
    expect(html).toMatch(
      /<button type="button" aria-expanded="true" aria-controls="office-rail" [^>]*><span class="sr-only">Show the menu as icons<\/span>/,
    );
    // It scrolls (with no bar) only when the window is too short for it.
    expect(html).toContain(
      '<div data-menu-scroll="" class="scrollbar-none fade-edges overflow-y-auto overscroll-contain -mx-1 min-h-0 flex-1 px-1"><nav aria-label="Office menu"',
    );
    const r = rows(html);
    // Names shown (not for screen readers only), rows 44px, a fold's pages 38px with no icon (an
    // empty space in its place, so the names line up).
    expect(r[0]?.el).toMatch(/ min-h-11 w-full gap-3 rounded-row px-3 text-left /);
    expect(r[0]?.el).toContain('<span class="min-w-0 flex-1 truncate">Dashboard</span>');
    const casuals = r.find((x) => x.name === "Casuals")?.el ?? "";
    expect(casuals).toMatch(/ min-h-9.5 w-full gap-3 rounded-row px-3 text-left /);
    expect(casuals).not.toContain("<svg");
    expect(casuals).toContain('<span aria-hidden="true" class="w-5 shrink-0"></span>');
    // You're in People: it's open; Pay and Admin and records stay shut.
    expect(html).toMatch(/aria-expanded="true" aria-controls="rail-people"/);
    expect(html).toContain('<div id="rail-people" class="flex animate-in flex-col gap-1 pt-1">');
    expect(html).toMatch(/aria-expanded="false" aria-controls="rail-pay"/);
    // Counts beside their names (amber when it needs you, blue when it's with someone else); a
    // shut fold shows its pages' count; no dots, no words beside the icons.
    expect(r.find((x) => x.name === "Needs attention")?.el).toContain(
      `<span aria-hidden="true" class="ml-auto ${countNeeds}">9</span>`,
    );
    expect(r.find((x) => x.name === "Pay")?.el).toContain(
      `<span aria-hidden="true" class="ml-auto ${countWaiting}">3</span>`,
    );
    expect(casuals).toContain(`<span aria-hidden="true" class="ml-auto ${countNeeds}">4</span>`);
    expect(r.find((x) => x.name === "People")?.el).not.toMatch(/class="ml-auto/);
    expect(html).not.toContain("data-rail-dot");
    expect(html).not.toContain("data-rail-tip");
  });

  it("the sd-rail cookie: open or shut, for a year, for every page; Secure on https", () => {
    expect(railCookie(true, true)).toBe(
      "sd-rail=open; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
    expect(railCookie(false, false)).toBe("sd-rail=shut; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(railOpenFromCookie("open")).toBe(true);
    for (const v of ["shut", undefined, "", "OPEN", "yes"])
      expect(railOpenFromCookie(v)).toBe(false);
  });
});

describe("the top bar's counts", () => {
  const all = {
    shell: { toFill: 5, urgent: 1, offersOut: 3 },
    attention: { count: 4, more: true },
    payQueries: 2,
  };
  it("each only for the roles that can open its page", () => {
    expect(barCounts("admin", all).map((c) => c.key)).toEqual([
      "toFill",
      "urgent",
      "offersOut",
      "toCheck",
      "payQueries",
    ]);
    expect(barCounts("resourcer", all).map((c) => c.key)).toEqual([
      "toFill",
      "urgent",
      "offersOut",
      "toCheck",
    ]);
    expect(barCounts("payroll", all).map((c) => c.key)).toEqual(["payQueries"]);
    // Every link one the role can open (the roles test checks each page's area).
    for (const role of ["admin", "resourcer", "payroll"] as const) {
      const hrefs = officeMenu(role).flatMap((g) => g.links.map((l) => l.href));
      for (const c of barCounts(role, all))
        expect(currentHref(c.href.replace(/[?#].*$/, ""), hrefs)).not.toBeNull();
    }
  });

  it("their numbers, words and pages; Offers out lands on the dashboard's Offered column", () => {
    expect(barCounts("admin", all)).toEqual([
      {
        key: "toFill",
        label: "To fill",
        href: "/office/events?view=need",
        icon: "profile",
        count: 5,
      },
      {
        key: "urgent",
        label: "Urgent",
        href: "/office/events?view=urgent",
        icon: "clock",
        count: 1,
        urgent: true,
      },
      {
        key: "offersOut",
        label: "Offers out",
        href: `/office#${COLUMN_IDS.offered}`,
        icon: "send",
        count: 3,
      },
      {
        key: "toCheck",
        label: "To check",
        href: "/office/needs-attention",
        icon: "checkbox",
        count: 4,
        more: true,
      },
      {
        key: "payQueries",
        label: "Pay queries",
        href: "/office/pay-queries",
        icon: "pay",
        count: 2,
      },
    ]);
    // Couldn't be read: no number.
    expect(
      barCounts("admin", { shell: null, attention: null, payQueries: null }).map((c) => c.count),
    ).toEqual([null, null, null, null, null]);
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

  it("the firm's initial on its mark: its first letter or digit", () => {
    expect(firmInitial("Acme Events")).toBe("A");
    expect(firmInitial("  northline security")).toBe("N");
    expect(firmInitial("1st Response")).toBe("1");
    expect(firmInitial("Łódź Guards")).toBe("Ł");
    expect(firmInitial("—")).toBe("");
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
    // Phase 24 (round 7, the mock-up's Events & sessions): in the office the actions sit beside the
    // headline and its lines, level with their foot, and go under them when there's no room (the
    // headline's box is at least 20rem); only `office:` values do it, so the casual app's header
    // keeps its actions under the lines.
    const classOf = (re: RegExp) => re.exec(html)?.[1]?.split(" ") ?? [];
    expect(classOf(/<header[^>]*><div class="([^"]*)">/)).toEqual([
      "office:flex",
      "office:flex-wrap",
      "office:items-end",
      "office:gap-x-6",
      "office:gap-y-4",
    ]);
    expect(classOf(/<header[^>]*><div[^>]*><div class="([^"]*)"><h1/)).toEqual([
      "office:min-w-0",
      "office:flex-1",
      "office:basis-80",
    ]);
    expect(classOf(/<div class="([^"]*)"><a href="\/office\/shifts\/new"/)).toEqual([
      "mt-4",
      "flex",
      "flex-wrap",
      "gap-3",
      "office:mt-0",
    ]);
  });

  it("PageHeader's way back: a link above the heading, named by its words alone", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        back: { href: "/office/cancellations", label: "Cancellations" },
        title: "Cancellation A1B2C3D4",
      }),
    );
    expect(html).toMatch(
      /^<header[^>]*><a href="\/office\/cancellations"[^>]*><svg aria-hidden="true"[\s\S]*?<\/svg>Cancellations<\/a>(?:<div class="[^"]*">)*<h1[^>]*>Cancellation A1B2C3D4<\/h1>/,
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
