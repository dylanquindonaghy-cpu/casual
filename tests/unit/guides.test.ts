import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The two how-to guides (docs/ui-design.md "Guides"): the office's /office/guide shows each role
// only the parts it can open, and the workers' /help page is open without logging in and keeps
// back what isn't ready for workers. Both: every contents link lands on a section and has its
// arrow (no menu pills), one <h1>, bullet-free lists keep role="list", and short sentences. The
// office guide's facts that once overstated the screens are pinned too. (/help's plain words are
// also checked in copy.plain-language.test.ts.)

vi.mock("next/navigation", () => ({
  usePathname: () => "/office/guide",
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined }),
}));
vi.mock("@/app/office/session-actions", () => ({ refreshOfficeSessionAction: vi.fn() }));

const { officeMenu } = await import("@/app/office/office-shell");
const { GuideView, guideSections } = await import("@/app/office/guide/guide-view");
const { HelpView } = await import("@/app/help/help-view");
const { FROM_PLANNER_WORDS } = await import("@/lib/office/shifts-copy");
// The firm's own strike and photo numbers the help page states (12H.3).
// A firm with travel areas on: every help section shows.
const HELP_FACTS = { noticeHours: 48, liveDays: 90, photoRenewalMonths: 36, travelOn: true };

type Role = "admin" | "resourcer" | "payroll";

const guide = (role: Role) =>
  renderToStaticMarkup(createElement(GuideView, { role, menu: officeMenu(role) }));
const help = () =>
  renderToStaticMarkup(
    createElement(HelpView, { firmName: "Acme Events", facts: HELP_FACTS, year: 2026 }),
  );

const words = (html: string) =>
  html
    .replace(/<\/(p|h1|h2|h3|li|button|a|label|span|div)>/g, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const longSentences = (html: string) =>
  words(html)
    .split(/(?<=[.!?:])\s+/)
    .filter((s) => s.split(/\s+/).filter((w) => /[a-z0-9£]/i.test(w)).length > 25);

// Every in-page link ("#id") has its target, and no id is used twice.
function anchorsLand(html: string) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(targets.length).toBeGreaterThan(0);
  for (const t of targets) expect(ids).toContain(t);
}

// The contents (the page's one <nav>): one link per section, in order, each with its arrow (a
// drawing hidden from screen readers), like /help's. Never pills (they'd look like buttons to
// switch between, not a list of topics).
function contents(html: string) {
  const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
  expect(nav).not.toContain("rounded-full");
  const links = [...nav.matchAll(/<a [^>]*href="#([^"]+)"[^>]*>(.*?)<\/a>/gs)];
  for (const [, , inner] of links) expect(inner).toMatch(/<svg [^>]*aria-hidden="true"/);
  return links.map((m) => m[1]);
}

// Lists whose bullets are styled away keep role="list": Safari stops announcing them otherwise.
// Only the square-bulleted points keep their bullets.
function bareListsKeepTheirRole(html: string) {
  const lists = [...html.matchAll(/<(?:ul|ol)\b[^>]*>/g)].map((m) => m[0]);
  expect(lists.length).toBeGreaterThan(0);
  for (const tag of lists) {
    if (!tag.includes("list-[square]")) expect(tag).toContain('role="list"');
  }
}

describe("the office how-to guide", () => {
  it("admins get every part, in the order of a working day", () => {
    expect(guideSections("admin").map((s) => s.title)).toEqual([
      "Getting around",
      "Start your day on the dashboard",
      "Fill a gap",
      "Add shifts",
      "Change or cancel a shift",
      "After a shift",
      "Enquiries",
      "Casuals",
      "Records",
      "Pay",
      "Admin",
      "Connect your planner",
      "What workers see",
    ]);
  });

  it("resourcers get every part except pay and admin, in the same order", () => {
    expect(guideSections("resourcer").map((s) => s.title)).toEqual([
      "Getting around",
      "Start your day on the dashboard",
      "Fill a gap",
      "Add shifts",
      "Change or cancel a shift",
      "After a shift",
      "Enquiries",
      "Casuals",
      "Records",
      "What workers see",
    ]);
    const text = words(guide("resourcer"));
    expect(text).not.toContain("Mark as sorted and tell them");
    expect(text).not.toContain("Change role");
  });

  it("payroll gets getting around, pay and what workers see, nothing about shifts", () => {
    expect(guideSections("payroll").map((s) => s.title)).toEqual([
      "Getting around",
      "Pay",
      "What workers see",
    ]);
    const html = guide("payroll");
    expect(html).not.toContain("Assign anyway");
    expect(html).not.toContain('href="/office/shifts"');
    expect(html).toContain('href="/office/pay-queries"');
    // The menu map is the role's own menu: the pay dashboard (their home, 12A.3), not the dashboard.
    expect(words(html)).toContain("Pay dashboard");
    expect(words(html)).not.toContain("Urgent gaps, what casuals can see");
    expect(words(html)).not.toContain("Casuals. Their qualifications");
  });

  it.each(["admin", "resourcer", "payroll"] as const)(
    "for %s: one heading 1, contents links that land, short sentences",
    (role) => {
      const html = guide(role);
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(html).toContain(">How-to guide</h1>");
      anchorsLand(html);
      expect(contents(html)).toEqual(guideSections(role).map((s) => s.id));
      bareListsKeepTheirRole(html);
      expect(longSentences(html)).toEqual([]);
    },
  );

  it("says only what the screens allow", () => {
    const text = words(guide("admin"));
    // "Open it again" only shows right after marking a shift as filled.
    expect(text).toContain("Select Open it again straight away.");
    // A started shift's page has no "Assign someone", so the override note doesn't offer it.
    expect(text).not.toContain("only when the shift has started");
    expect(text).toContain("Once a shift has started, nobody can be assigned to it here.");
    // Moving is for a shift with people booked. With nobody booked, it's "Edit this shift".
    expect(text).toContain(
      "With nobody booked, change the date, times or site under Edit this shift instead.",
    );
    // The worker search matches part of a name, or a whole mobile number.
    expect(text).toContain("Type part of their name, or their whole mobile number, in");
    // A sheet or staff file can't undo "Make inactive" or a site block: its warning goes only
    // with "Make active again".
    expect(text).not.toContain("changes it back");
    expect(text).toContain("can't make them active again: only you can.");
    // A lost laptop or phone: log out everywhere, and turn off access if their email is open on it.
    expect(text).toContain("also turn off their access until it's secure.");
    expect(text).toContain("Yes, make them an admin");
    // Deleting waits until their booked shifts have ended or are cancelled.
    expect(text).toContain("you can't delete them yet.");
    // A planner's session: the page's own words, and what's left to do here (Assign and cancelling
    // one booking stay on its page; hiding, urgent and offers are on Events & sessions).
    expect(text).toContain(`A shift from your planner says \u201c${FROM_PLANNER_WORDS}\u201d`);
    expect(text).toContain(
      "Here you can still hide it, mark it urgent, offer it, assign someone and cancel one person's booking.",
    );
  });

  it("Connect your planner (12J.1) is for admins, and is where Integrations' link lands", async () => {
    const { PLANNER_GUIDE_HREF } = await import("@/lib/office/integrations-copy");
    const [path, id] = PLANNER_GUIDE_HREF.split("#");
    expect(path).toBe("/office/guide");
    expect(guide("admin")).toContain(`id="${id}"`);
    for (const role of ["resourcer", "payroll"] as const) {
      expect(guide(role)).not.toContain(`id="${id}"`);
      expect(words(guide(role))).not.toContain("API key");
    }
    const text = words(guide("admin"));
    // The words of the page, as they read on it.
    for (const name of [
      "Create a key",
      "Copy the key",
      "Codes your planner can use",
      "Yes, revoke it",
    ]) {
      expect(text).toContain(name);
    }
    expect(guide("admin")).toContain('href="/office/settings/integrations"');
  });

  // One section of the rendered guide, by its id.
  const section = (html: string, id: string) => {
    const start = html.indexOf(`<section id="${id}"`);
    expect(start).toBeGreaterThan(-1);
    return html.slice(start, html.indexOf("</section>", start));
  };

  // Phase 23 (round 3): a top bar along every page, the menu in its own card from 1024px and a
  // drawer behind "Menu" below it; your initials and name at the bar's top right (the name from
  // 640px) opening the account menu; the square light or dark button beside them (office-frame.tsx,
  // theme-button.tsx). Until Phase 23 the account sat at the top of the menu on a wide screen.
  it("Getting around describes the top bar, the menu card, the drawer and where Log out is (12I.3, Phase 23)", () => {
    for (const role of ["admin", "resourcer", "payroll"] as const) {
      const text = words(section(guide(role), "getting-around"));
      // The bar on every page; the menu a card on the left from a wide screen.
      expect(text).toContain(
        "A bar runs along the top of every page. On a wide screen, the menu is in its own card on the left, under the bar.",
      );
      // Below 1024px the menu is a drawer behind "Menu", closed by "Close menu" (office-frame.tsx).
      expect(text).toContain("On a phone or tablet, select Menu at the top left");
      expect(text).toContain("Select Close menu , or anywhere outside it, to close it.");
      // Log out sits in the account button's menu at the bar's top right, with this guide and the
      // light/dark switch, named by its words (theme-button.tsx).
      expect(text).toContain(
        "Your initials and name are at the top right of the bar. On a phone, only your initials show.",
      );
      expect(text).toContain(
        "Select them to open this guide, to switch between dark and light, or to Log out",
      );
      // The square button in the bar, by its words (its icon has none).
      expect(text).toContain(
        "The square button beside them switches between dark and light too. Its name says which: Switch to dark mode or Switch to light mode .",
      );
      expect(text).toContain(
        "On a wide screen, the bar also shows the pay week and its pay day, and your shifts line's number if you have one.",
      );
      expect(text).not.toMatch(/\bmoon\b/i);
      // Not round 2's places: the account over the menu, the menu down the window's side.
      expect(text).not.toContain("at the top of the menu");
      expect(text).not.toContain("beside your firm's name");
      expect(text).not.toContain("down the left side");
      // The guide isn't in the menu (Phase 22: office-nav.tsx leaves the `bottom` group out), so
      // the menu's list here leaves it out too.
      expect(text).not.toContain("This page.");
    }
    // Needs attention is in the menu only for the roles with it, "today" (office-menu.ts); Phase
    // 20 took the bell out, so the guide never mentions one.
    const count = "Needs attention, under Dashboard in the menu, counts what needs you.";
    expect(words(guide("admin"))).toContain(count);
    expect(words(guide("resourcer"))).toContain(count);
    expect(words(guide("payroll"))).not.toContain(count);
    for (const role of ["admin", "resourcer", "payroll"] as const)
      expect(words(guide(role)).toLowerCase()).not.toMatch(/\bbell\b/);
    // The menu's line for the dashboard: its charts, not round 2's week and sorted list.
    const dashboardLine =
      "How many things need you and where to start, every urgent place to fill, and charts of what needs work.";
    expect(words(guide("admin"))).toContain(dashboardLine);
    expect(words(guide("admin"))).not.toContain("this week's days");
  });

  // Phase 23: the dashboard's four counts, its urgent places as cards and its six charts (the week
  // strip and the three text panels went), each mark opening a panel of its rows, a Numbers table
  // each; and the guide's links to it land on what's there now.
  it("Start your day on the dashboard: the four counts, the urgent places and the six charts (Phase 23)", () => {
    for (const role of ["admin", "resourcer"] as const) {
      const html = section(guide(role), "today");
      const names = [
        ...html.matchAll(/<li class="py-3"><p class="font-semibold text-ink">([^<]*)<\/p>/g),
      ].map((m) => m[1]);
      expect(names).toEqual([
        "The four counts",
        "Urgent places to fill",
        "Places to fill, next 2 weeks",
        "Which events need people",
        "Offers this week",
        "How long things have waited",
        "Cancellations, last 2 weeks",
        "Licences running out, next 8 weeks",
      ]);
      const text = words(html);
      expect(text).toContain(
        "It shows what needs doing today: four counts, the urgent places to fill, and six charts of what needs work.",
      );
      expect(text).toContain(
        "Urgent places, Needs attention, Waiting on others and Sorted today. Select one to see its list.",
      );
      // The offers chart's three parts, as the office names them (PLAN.md Phase 23).
      expect(text).toContain(
        "One bar of three parts for this week's offers: those casuals said yes to, those waiting for a reply, and those they said no to or that closed.",
      );
      expect(text).not.toContain("A bar for each day: offers");
      // Pay's part of the waiting chart only for the roles that can open Pay; the undated items
      // named under it.
      expect(text).toContain("the pay queries with payroll if you can open Pay.");
      expect(text).toContain("Things with no date, like bookings to check, are named under it.");
      // The sentence the old Sorted today panel had, kept with the cancellations.
      expect(text).toContain("Each was recorded automatically, never approved or declined.");
      // Every mark opens a panel of its rows, with their actions; Numbers swaps in a table.
      expect(text).toContain(
        "Point at a bar, a dot or a number, or move to it with the Tab key, to see its figures.",
      );
      expect(text).toContain(
        "Select it. A panel opens with its rows, each with its link or action, like Offer or Mark who worked .",
      );
      expect(text).toContain("Select Close , or press Escape, to go back to the chart.");
      expect(text).toContain(
        "Numbers swaps a chart for a table of the same figures, and back again.",
      );
      // Round 2's sections are gone from it.
      for (const old of [
        "Seven days, a bar each",
        "go to its section below",
        "Pay queries with payroll.",
      ])
        expect(text).not.toContain(old);
      // The colours, with round 3's blue: waiting on someone else.
      expect(text).toContain("The charts use the same colours, and grey for what's fine.");
      const tones = [
        ...html.matchAll(
          /<span class="shrink-0 sm:w-32"><span class="([^"]*)"[^>]*>[\s\S]*?<\/svg>([^<]*)<\/span>/g,
        ),
      ].map((m) => m[2]);
      expect(tones).toEqual(["Urgent", "Open", "Waiting", "Filled", "Cancelled"]);
      expect(html).toContain("bg-wait-soft text-wait-ink");
    }
    // Its links land on what's there now: the urgent places' section on the dashboard, and Who
    // worked? on Needs attention (there was never an "#urgent", and the dashboard's Needs attention
    // panel went in Phase 23).
    const admin = guide("admin");
    expect(admin).toContain('href="/office#urgent-places"');
    expect(admin).toContain('href="/office/needs-attention#to-mark"');
    expect(admin).not.toMatch(/href="\/office#(?:urgent|needs-attention)"/);
    // A leaver's bookings ahead are on Needs attention now, not the dashboard.
    expect(words(admin)).toContain(
      "Their bookings ahead go on Needs attention, under “Bookings to check”.",
    );
    // Payroll has no dashboard, so no part about it.
    expect(guide("payroll")).not.toContain('<section id="today"');
  });

  it("Connect your planner is three steps, with the codes and the webhook as notes (12I.3)", () => {
    const html = section(guide("admin"), "connect-your-planner");
    const steps = html.slice(html.indexOf("<ol"), html.indexOf("</ol>"));
    expect(steps.match(/<li[\s>]/g)).toHaveLength(3);
    const text = words(html);
    expect(text).toContain("Select Create a key");
    expect(text).toContain("Select Copy the key and paste it into your planner straight away.");
    expect(text).toContain("Your planner says Connected by API");
    // The words of the Webhook section, as they read on Integrations (webhook-forms.tsx).
    for (const name of ["Webhook", "Add a webhook", "Copy the secret"])
      expect(text).toContain(name);
  });

  it("is opened through its own area, which every office role has", () => {
    const page = readFileSync("src/app/office/guide/page.tsx", "utf8");
    expect(page).toContain('requireOfficeArea("guide")');
    expect(page).toContain('title: "How-to guide"');
  });
});

describe("the workers' help page", () => {
  it("has one heading 1, contents links that land, and short sentences", () => {
    const html = help();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(">Help</h1>");
    anchorsLand(html);
    expect(contents(html)).toHaveLength(14);
    bareListsKeepTheirRole(html);
    expect(longSentences(html)).toEqual([]);
  });

  it("opens with the shared page header: Help first (the firm's bar names the firm), then one line", () => {
    const html = help();
    expect(html.match(/<header[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<header[^>]*><h1[^>]*>Help<\/h1>/);
    expect(words(html)).toContain("Help. How your shifts pages work, step by step.");
    // The contents come after the header, not inside it.
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("<nav"));
  });

  it("covers cancelling and strikes, the travel area, and qualifications and photos (12H.3)", () => {
    const html = help();
    expect(contents(html)).toEqual(
      expect.arrayContaining([
        "cancelling-and-strikes",
        "travel-area",
        "qualifications-and-photos",
      ]),
    );
    const text = words(html);
    // The firm's own numbers, not fixed ones.
    expect(text).toContain(
      "If you cancel less than 48 hours before a shift starts, you get a strike.",
    );
    expect(text).toContain("It counts for 90 days.");
    expect(text).toContain("Your staff photo needs renewing every 36 months.");
    const firm24 = words(
      renderToStaticMarkup(
        createElement(HelpView, {
          firmName: "Acme Events",
          facts: { noticeHours: 24, liveDays: 30, photoRenewalMonths: 24, travelOn: true },
          year: 2026,
        }),
      ),
    );
    expect(firm24).toContain(
      "If you cancel less than 24 hours before a shift starts, you get a strike.",
    );
    expect(firm24).toContain("It counts for 30 days.");
    expect(firm24).toContain("Your staff photo needs renewing every 24 months.");
    expect(text).toContain("The office only sees the first part of your postcode, like ZZ1.");
    // The postcode data's licence line, last.
    expect(html).toMatch(
      /<p data-attribution=""[^>]*>Postcode locations: Contains OS data © Crown copyright/,
    );
  });

  it("ends with the usual way back to My shifts", () => {
    expect(help()).toMatch(/<a [^>]*href="\/"[^>]*>Back to my shifts<\/a>/);
  });

  it("keeps back the shifts line number and invents no buttons", () => {
    const text = words(help());
    // PLAN.md's Parking lot: the line isn't shown to workers until incoming messages are answered.
    expect(text).not.toMatch(/\+44|07\d{3}|shifts line/i);
    // There's no privacy notice link or general question form to point at: it says so in words.
    expect(help()).not.toMatch(/href="[^"#]*privacy/i);
    expect(help()).not.toMatch(/<(button|form|input)[\s>]/);
    expect(text).toContain("Ask the office for a copy.");
  });

  it("opens without logging in: the page only needs the firm from the address", () => {
    const page = readFileSync("src/app/help/page.tsx", "utf8");
    expect(page).toContain("getCurrentFirm()");
    expect(page).not.toMatch(/requireWorker|getWorkerSession|readSessionToken/);
    expect(page).toContain('title: "Help"');
  });
});

describe("Help with travel areas switched off for the firm (13.4)", () => {
  it("no 'Your travel area' section, and none in the contents", () => {
    const html = renderToStaticMarkup(
      createElement(HelpView, {
        firmName: "Acme Events",
        facts: { ...HELP_FACTS, travelOn: false },
        year: 2026,
      }),
    );
    expect(html).not.toContain('href="#travel-area"');
    expect(html).not.toContain('id="travel-area"');
    expect(html).not.toMatch(/Your travel area|Set your travel area|Where you work/);
    // The rest is all there.
    expect(help()).toContain('id="travel-area"');
    expect(html).toContain('id="qualifications-and-photos"');
  });
});
