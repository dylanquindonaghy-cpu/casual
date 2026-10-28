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

  // Phase 24 (round 7; PLAN.md 24.2): from 1024px the rail at the left (icons, opened to names by
  // the button under the firm's mark; a name under the pointer; a red dot where a page needs you;
  // Pay and People as folds) and a top bar of the counts, the search and you; below it a drawer
  // behind "Menu"; your initials and name at the bar's top right opening the account menu, the
  // light or dark button beside them (office-frame.tsx, office-rail.tsx, theme-button.tsx). Each
  // role told only of what it has. Until Phase 24 the menu was a card under a full-width bar, which
  // showed the pay week and the shifts line's number.
  it("Getting around describes the rail, the top bar's counts and search, the drawer and where Log out is (12I.3, Phase 24)", () => {
    for (const role of ["admin", "resourcer", "payroll"] as const) {
      const text = words(section(guide(role), "getting-around"));
      expect(text).toContain(
        "On a wide screen, the menu is a column of icons down the left. Select the button under your firm's mark to show the menu with names, and again to show icons only. Point at an icon to see its name. A red dot means that page needs you.",
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
      // The light or dark button in the bar, by its words (its icon has none).
      expect(text).toContain(
        "The button beside them switches between dark and light too. Its name says which: Switch to dark mode or Switch to light mode .",
      );
      expect(text).not.toMatch(/\bmoon\b/i);
      // Not the places of Phases 22 and 23: the menu's card, the pay week and shifts line in the bar.
      expect(text).not.toContain("in its own card");
      expect(text).not.toContain("pay week");
      expect(text).not.toContain("bar also shows");
      expect(text).not.toContain("at the top of the menu");
      expect(text).not.toContain("down the left side");
      // The guide isn't in the menu (Phase 22: office-nav.tsx leaves the `bottom` group out), so
      // the menu's list here leaves it out too.
      expect(text).not.toContain("This page.");
    }
    // The folds each role has in the rail, and the counts and search in its bar (office-menu.ts
    // barCounts; payroll's Pay is all their menu, as icons, and they have no search).
    const text = (role: "admin" | "resourcer" | "payroll") =>
      words(section(guide(role), "getting-around"));
    expect(text("admin")).toContain("Pay and People each open to show their pages.");
    expect(text("resourcer")).toContain("People opens to show its pages.");
    expect(text("payroll")).not.toMatch(/open(?:s)? to show (?:its|their) pages/);
    expect(text("admin")).toContain(
      "On a wide screen, the bar at the top shows To fill, Urgent, Offers out, To check and Pay queries. Each opens the page where you deal with it.",
    );
    expect(text("resourcer")).toContain(
      "On a wide screen, the bar at the top shows To fill, Urgent, Offers out and To check.",
    );
    expect(text("payroll")).toContain("On a wide screen, the bar at the top shows Pay queries.");
    const search =
      "Use Search beside them to find a casual, a shift or a site. Press ⌘K on a Mac, or Ctrl K, to go straight to it.";
    expect(text("admin")).toContain(search);
    expect(text("resourcer")).toContain(search);
    expect(text("payroll")).not.toContain("Search");
    expect(text("payroll")).not.toContain("Admin and records");
    // Settings now holds the shifts line's number (it left the bar).
    expect(text("admin")).toContain(
      "Settings. The strikes team's email, your shifts line's number, and your sites' postcodes.",
    );
    // Needs attention is in the menu only for the roles with it, "today" (office-menu.ts); Phase
    // 20 took the bell out, so the guide never mentions one.
    const count = "Needs attention, under Dashboard in the menu, counts what needs you.";
    expect(words(guide("admin"))).toContain(count);
    expect(words(guide("resourcer"))).toContain(count);
    expect(words(guide("payroll"))).not.toContain(count);
    for (const role of ["admin", "resourcer", "payroll"] as const)
      expect(words(guide(role)).toLowerCase()).not.toMatch(/\bbell\b/);
    // The menu's line for the dashboard: round 7's board (Phase 24), not Phase 23's charts or
    // round 2's week and sorted list.
    const dashboardLine =
      "The places to fill this week and next, the offers waiting for a reply, what casuals took while you were out, and who worked.";
    expect(words(guide("admin"))).toContain(dashboardLine);
    expect(words(guide("admin"))).not.toContain("this week's days");
    expect(words(guide("admin"))).not.toContain("charts of what needs work");
  });

  // Phase 24 (24.3): the dashboard's places chart, its chosen session and the board's four
  // columns (Phase 23's four counts, urgent places and six charts went), the offer panel, and the
  // guide's links to it land on what's there now.
  it("Start your day on the dashboard: the places chart, the chosen session and the board's four columns (Phase 24)", () => {
    for (const role of ["admin", "resourcer"] as const) {
      const html = section(guide(role), "today");
      const names = [
        ...html.matchAll(/<li class="py-3"><p class="font-semibold text-ink">([^<]*)<\/p>/g),
      ].map((m) => m[1]);
      expect(names).toEqual([
        "Places to fill",
        "The chosen session",
        "To offer",
        "Offered",
        "While you were out",
        "Who worked?",
      ]);
      const text = words(html);
      expect(text).toContain(
        "It shows the places still to fill, the offers waiting for a reply, and what happened while you were out.",
      );
      expect(text).toContain(
        "The line under Dashboard says the date, the pay week and its pay day, and when your planner or rota sheet last sent changes.",
      );
      expect(text).toContain(
        "All , Urgent , This week and Next week choose the sessions with places to fill that the board shows.",
      );
      // The chart's two parts, as the dashboard names them.
      expect(text).toContain(
        "A bar for each day of this week and next: the places with no offers out, and on them the places offered with no reply yet.",
      );
      // The detail card keeps the urgent places' actions under its "…".
      expect(text).toContain(
        "Offer to someone and Open the shift are under it; … has Mark as filled and Not urgent.",
      );
      // While you were out: what casuals took from offers, never "filled by the shifts line".
      expect(text).toContain(
        "Places casuals took themselves from offers between 18:00 and 08:00, with how the offer reached them and when they said yes.",
      );
      expect(text).not.toContain("Filled by the shifts line");
      // The offer panel, step by step.
      expect(text).toContain(
        "Select a card's paper plane, or Offer to someone on the chosen session. A panel opens.",
      );
      expect(text).toContain(
        "Select Send offer next to a name. It says Offered , and the foot of the panel says the offer is on its way.",
      );
      expect(text).toContain("Select Back to the dashboard , or press Escape, to close it.");
      // Needs attention from the top bar's To check now (the dashboard's count went).
      expect(text).toContain("The bar at the top counts it as To check , and takes you there.");
      // Phase 23's and round 2's sections are gone from it.
      for (const old of [
        "The four counts",
        "Urgent places to fill",
        "Numbers swaps a chart",
        "Seven days, a bar each",
        "Pay queries with payroll.",
      ])
        expect(text).not.toContain(old);
      // The colours, with round 3's blue: waiting on someone else; the chart's two named.
      expect(text).toContain(
        "On the chart, black is places to offer and blue is places offered with no reply yet.",
      );
      const tones = [
        ...html.matchAll(
          /<span class="shrink-0 sm:w-32"><span class="([^"]*)"[^>]*>[\s\S]*?<\/svg>([^<]*)<\/span>/g,
        ),
      ].map((m) => m[2]);
      expect(tones).toEqual(["Urgent", "Open", "Waiting", "Filled", "Cancelled"]);
      expect(html).toContain("bg-wait-soft text-wait-ink");
    }
    // Its links land on what's there now: the dashboard's urgent sessions (its Urgent filter), and
    // Who worked? on Needs attention (the urgent places' section went in Phase 24; there was never
    // an "#urgent").
    const admin = guide("admin");
    expect(admin).toContain('href="/office?show=urgent"');
    expect(admin).toContain('href="/office/needs-attention#to-mark"');
    expect(admin).not.toMatch(/href="\/office#(?:urgent|urgent-places|needs-attention)"/);
    expect(words(section(admin, "fill-a-gap"))).toContain(
      "Every one is on the dashboard, under To offer or Offered ( Urgent shows only the urgent ones). Select one to see it in full: Mark as filled and Not urgent are under its … .",
    );
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

  // Phase 24 (24.5: the guide's words match the new layout): an enquiry opens beside the list on a
  // wide screen and on its own page on a phone; how the reply goes is the line under the box
  // (24.4 put it there); closing starts with "Close, no reply needed", then asks why; a pay
  // group's note is written beside the group (under it on a phone).
  it("Enquiries and Pay queries say where things are on their pages now (Phase 24)", () => {
    const plain = (html: string) =>
      html
        .replace(/<[^>]+>/g, "")
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/\s+/g, " ");
    const enquiries = plain(section(guide("admin"), "enquiries"));
    expect(enquiries).toContain(
      "Select Need a person, then the person's name (or Unknown number). On a wide screen the message opens beside the list; on a phone, on its own page.",
    );
    expect(enquiries).toContain(
      "The line under the box says how it will go: as you wrote it, or, more than 24 hours after their last WhatsApp, inside the request update message.",
    );
    expect(enquiries).not.toContain("above the box");
    expect(enquiries).toContain(
      "Or, if it needs no reply (you rang them, or it's spam), select Close, no reply needed, choose a reason in Why close it? and select Close without a reply.",
    );
    const pay = plain(section(guide("admin"), "pay"));
    expect(pay).toContain(
      "Beside the group (under it on a phone), write what payroll did in Tell them what payroll did.",
    );
    expect(pay).not.toContain("Under the group");
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
    // Nothing above the heading: only the header's layout boxes (no words) wrap it.
    expect(html).toMatch(/<header[^>]*>(?:<div class="[^"]*">)*<h1[^>]*>Help<\/h1>/);
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
