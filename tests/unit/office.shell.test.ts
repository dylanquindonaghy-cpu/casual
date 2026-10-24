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

const { MENU_AREAS, menuBadges, officeMenu, OfficeShell } =
  await import("@/app/office/office-shell");
const { ariaCurrent, currentHref, OfficeNav } = await import("@/app/office/office-nav");
const { ACCOUNT_MENU_ID, DRAWER_ID, firmInitial, initials, redrawOnArrival } =
  await import("@/app/office/office-frame");
const { moreToScroll } = await import("@/app/office/menu-scroll");
const { themeCookie } = await import("@/app/office/theme-button");
const { PageHeader } = await import("@/app/ui/page-header");
const { chip, count, countNeeds, countPill, countWaiting } = await import("@/app/ui/classes");
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
    // Beside a section's heading the count stays the grey pill.
    expect(countPill).toMatch(/(?<![\w-])bg-count(?![\w-])/);
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
  const WEEK = { week: "Week 41", dates: "5 Oct – 11 Oct", pay: "Pay Fri 16 Oct" };
  const shell = (
    theme?: "light" | "dark",
    role: "admin" | "payroll" = "admin",
    shiftsLine: string | null = "+44 7700 900000",
  ) => {
    nav.pathname = "/office";
    // Hook-free, so it can be called directly.
    return renderToStaticMarkup(
      OfficeShell({
        name: "Sam Admin",
        roleLabel: role === "admin" ? "Admin" : "Payroll",
        firmName: "Acme Events",
        payWeek: WEEK,
        shiftsLine,
        menu: officeMenu(role),
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
    // One <nav>, and the page's own <main> is the only one; one top bar (a <header> in the drawer
    // would be a second banner).
    expect(html.match(/<nav\b/g)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<header\b/g)).toHaveLength(1);
    expect(html.match(/>Log out</g)).toHaveLength(1);
  });

  // Phase 23 (round 3, flat): the ground, then white with its hairline (the bar, the menu card,
  // the page card); nothing at rest has depth; the account menu and the drawer float, with the one
  // overlay. No grain, no blur behind the bar.
  it("flat: the ground, the white bar and cards with their hairlines, depth only on what floats", () => {
    const html = shell();
    expect(html).toContain(
      '<div data-shell="office" class="flex flex-1 flex-col bg-canvas text-base text-ink">',
    );
    expect(barOf(html)).toMatch(
      /^<header class="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-line bg-card px-3 sm:gap-3 lg:min-h-16 lg:px-6">/,
    );
    // Under the bar: the menu card beside the page card from 1024px (248px, 284px from 1280px),
    // 16px apart and from the window's edges.
    expect(html).toContain(
      '</dialog><div class="flex flex-1 flex-col px-2 pt-3 pb-6 lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-4 lg:px-4 lg:pt-4 xl:grid-cols-[17.75rem_minmax(0,1fr)]">',
    );
    // The page card (`#main > div`): white, its hairline, 22px round on a phone, 28px from 1024px.
    expect(html).toContain(
      '<div id="main" tabindex="-1" class="flex min-w-0 flex-1 flex-col focus:outline-none"><div class="flex-1 rounded-inner border border-line bg-card lg:rounded-card"><div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">',
    );
    const shadows = [...html.matchAll(/(?<![\w-])(?:[a-z0-9-]+:)*(?:inset-|drop-)?shadow-[\w-]+/g)];
    expect(shadows.map((m) => m[0])).toEqual(["shadow-float", "shadow-float"]);
    expect(html).toMatch(/<div id="office-account-menu" popover="auto" class="[^"]*shadow-float/);
    expect(html).toMatch(
      /<dialog id="office-menu-drawer" aria-label="Menu" class="[^"]*shadow-float/,
    );
    expect(html).not.toMatch(/(?<![\w-])(?:grain|stripes|tint-|backdrop-blur|card-chip)/);
    expect(html).not.toMatch(/(?<![\w-])bg-(?:canvas|sheet)\/\d/);
  });

  it("the top bar: Menu (waits for the page), the firm, the pay week, the shifts line, the light or dark switch, you", () => {
    const html = shell();
    const bar = barOf(html);
    expect(bar).toMatch(
      new RegExp(
        `<button type="button" aria-controls="${DRAWER_ID}" aria-expanded="false" aria-haspopup="dialog" disabled=""[^>]*>.*Menu</button>`,
      ),
    );
    // Menu: flat, its hairline, below 1024px only.
    expect(bar).toMatch(
      /aria-haspopup="dialog" disabled="" class="press [^"]*rounded-full border border-line bg-card [^"]*lg:hidden">/,
    );
    // The firm at every width: its initial on its own colour (40px, 14px corners from 1024px),
    // its name, and "Office" under it from 1024px (Phase 23; over the menu in Phase 22).
    expect(bar).toMatch(
      /<p class="flex min-w-0 items-center gap-3 leading-tight"><span aria-hidden="true" class="flex size-9 shrink-0 items-center justify-center rounded-row bg-brand-bar text-base font-extrabold text-on-brand-bar lg:size-10 lg:text-lg">A<\/span><span class="min-w-0"><span class="block truncate font-bold text-ink lg:text-lg">Acme Events<\/span><span class="hidden text-sm text-ink-muted lg:block">Office<\/span><\/span><\/p>/,
    );
    expect(html).not.toMatch(/<nav aria-label="Office menu"[^>]*>.*?Acme Events/);
    // The pay week (D8) in the bar from 1024px (Phase 23; at the menu's end in Phase 22): words,
    // not a button, read as one; its dates shown from 1280px and read out at every width; "This
    // week" in green.
    const week =
      /<p class="hidden ([^"]*)">(<span><span class="font-bold text-ink">Week 41.*?)<\/p>/.exec(
        bar,
      );
    expect(week).not.toBeNull();
    expect(week?.[1]).toMatch(/(?<![\w-])lg:flex(?![\w-])/);
    expect(week?.[1]).toMatch(/(?<![\w-])rounded-full border border-line(?![\w-])/);
    expect(text(week?.[2] ?? "")).toBe("Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct This week");
    expect(week?.[2]).toContain('<span class="sr-only xl:not-sr-only"> · 5 Oct – 11 Oct</span>');
    expect(week?.[2]).toContain(`<span class="${chip.base} ${chip.done}">This week</span>`);
    expect(week?.[2]).not.toMatch(/<(?:a|button)\b/);
    expect(text(html.slice(html.indexOf("<nav")))).not.toContain("Week 41");
    // The shifts line's number from 1280px, its phone and its words for screen readers.
    expect(bar).toMatch(
      /<p class="hidden [^"]*xl:flex"><svg [^>]*>.*?<\/svg><span class="sr-only">Shifts line:<\/span> \+44 7700 900000<\/p>/,
    );
    // The square light or dark switch: 44px, 14px corners, its hairline; its words its name and
    // shown beside it on keyboard focus and under the pointer, over the button or over the words
    // themselves (WCAG 1.4.13: they take the pointer, an 8px bridge over the gap; hidden from
    // screen readers there).
    expect(bar).toMatch(
      /<span class="group\/tip relative flex shrink-0"><button type="button" aria-label="Switch to dark mode" disabled="" class="peer press inline-flex size-11 items-center justify-center rounded-row border border-line bg-card [^"]*"><svg [^>]*><path [^>]*><\/path><\/svg><\/button><span aria-hidden="true" data-theme-tip="" class="absolute top-full right-0 z-30 mt-2 hidden animate-pop rounded-row bg-ink px-3 py-2 text-sm font-semibold whitespace-nowrap text-on-ink before:absolute before:inset-x-0 before:-top-2 before:h-2 peer-focus-visible:block pointer-fine:group-hover\/tip:block">Switch to dark mode<\/span><\/span>/,
    );
    expect(bar).toContain(
      '<span class="group/tip relative flex shrink-0"><button type="button" aria-label="Switch to dark mode"',
    );
    expect(bar).not.toMatch(/data-theme-tip="" class="[^"]*pointer-events-none/);
    expect(bar).not.toMatch(/data-theme-tip="" class="[^"]*peer-hover/);
    // A 1px divider before you, from 1280px.
    expect(bar).toContain(
      '<span aria-hidden="true" class="hidden h-7 w-px bg-line xl:block"></span>',
    );
    // In that order, left to right (HTML attribute names ignore case: React writes
    // "popoverTarget").
    const at = (s: string) => bar.toLowerCase().indexOf(s.toLowerCase());
    const order = [
      ">Menu</button>",
      ">Acme Events<",
      ">Week 41<",
      "+44 7700 900000",
      'aria-label="Switch to dark mode"',
      "h-7 w-px bg-line",
      `popovertarget="${ACCOUNT_MENU_ID}"`,
    ].map(at);
    expect(order.every((n) => n > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // You: your initials on a pale grey circle with its hairline (Phase 23: ink in Phase 22), your
    // name from 640px and a chevron, your role for screen readers ("Sam Admin Admin").
    const account = bar.match(
      // HTML attribute names ignore case (React writes "popoverTarget").
      new RegExp(
        `<button type="button" popovertarget="${ACCOUNT_MENU_ID}"[^>]*>(.*?)</button>`,
        "i",
      ),
    )?.[1];
    expect(account).toBeDefined();
    expect(account).toMatch(
      /^<span aria-hidden="true" class="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-sm font-bold text-ink-muted">SA<\/span>/,
    );
    expect(account).toContain(
      '<span class="sr-only leading-tight sm:not-sr-only"><span class="block max-w-48 truncate font-semibold text-ink">Sam Admin</span><span class="sr-only"> Admin</span></span>',
    );
    expect(account).toMatch(/<svg [^>]*class="shrink-0 hidden rotate-90 text-ink-muted sm:block"/);
    expect(text((account ?? "").replace(/<span aria-hidden="true"[^>]*>SA<\/span>/, ""))).toBe(
      "Sam Admin Admin",
    );
    // Everything in the bar, read in order (the switch's words under it are hidden from screen
    // readers, and said once here by its name).
    expect(text(barOnly(html))).toBe(
      "Menu A Acme Events Office Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct This week Shifts line: +44 7700 900000 Switch to dark mode SA Sam Admin Admin",
    );
  });

  it("no shifts line yet: none in the bar", () => {
    const html = shell(undefined, "admin", null);
    expect(html).not.toContain("Shifts line");
    expect(html).not.toMatch(/xl:flex"><svg/);
    // The rest of the bar as it was.
    expect(text(barOnly(html))).toBe(
      "Menu A Acme Events Office Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct This week Switch to dark mode SA Sam Admin Admin",
    );
  });

  it("the account menu: the name and role, the theme switch, How-to guide and the one Log out", () => {
    const html = shell();
    const at = html.indexOf(`<div id="${ACCOUNT_MENU_ID}" popover="auto"`);
    expect(at).toBeGreaterThan(-1);
    const menu = html.slice(at, html.indexOf("</header>"));
    expect(text(menu)).toBe("Sam Admin Admin Switch to dark mode How-to guide Log out");
    // At the top right under the bar (8px under it: 56px tall, 64px from 1024px), growing from its
    // corner; white with its 22px corners, floating (Phase 23; top left over the menu in 22).
    expect(menu).toMatch(
      /^<div id="office-account-menu" popover="auto" class="inset-auto top-16 right-3 m-0 w-64 origin-top-right animate-pop rounded-inner bg-card p-2 text-base text-ink shadow-float lg:top-18 lg:right-6">/,
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

  it("the drawer is a native dialog, empty until it's opened; the menu is in its card", () => {
    const html = shell();
    const dialog = html.match(new RegExp(`<dialog[^>]*id="${DRAWER_ID}"[^>]*>(.*?)</dialog>`));
    expect(dialog).not.toBeNull();
    expect(dialog?.[0]).toContain('aria-label="Menu"');
    expect(dialog?.[0]).not.toMatch(/\bopen\b=/);
    expect(dialog?.[1]).toBe("");
    // White, full height at the left, floating over the dimmed page; it slides in (Phase 23: a
    // rounded sheet on the ground in Phase 22).
    expect(dialog?.[0]).toContain(
      'class="inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-80 max-w-[85vw] overflow-hidden bg-card p-0 text-base text-ink shadow-float transition-[translate] duration-200 ease-sd backdrop:animate-fade backdrop:bg-scrim/40 starting:-translate-x-full"',
    );
    // The menu card (from 1024px): white, its hairline, 28px round, 16px under the bar and staying
    // there; it scrolls with no bar only when the window is too short for it.
    expect(html).toContain(
      '<div class="hidden rounded-card border border-line bg-card p-2 lg:sticky lg:top-20 lg:block lg:self-start"><div data-menu-scroll="" class="scrollbar-none fade-edges overflow-y-auto overscroll-contain lg:max-h-[calc(100dvh-7.125rem)]"><nav aria-label="Office menu" class="relative flex flex-col">',
    );
  });

  it("payroll's shell: their own menu, the same bar", () => {
    const html = shell(undefined, "payroll");
    // The bar with the pay week, then their menu, then the page (Phase 23: the pay week moved from
    // the menu's end to the bar); the guide in the account menu (Phase 22).
    expect(text(barOnly(html))).toContain("Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct This week");
    expect(text(html)).toContain("Pay Pay dashboard Pay queries Import pay records PAGE");
    expect(html.match(/href="\/office\/guide"/g)).toHaveLength(1);
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
