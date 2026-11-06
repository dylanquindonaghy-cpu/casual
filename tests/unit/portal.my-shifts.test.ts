import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeView, type HomeViewProps } from "@/app/home-view";
import { BookedView, type BookedViewProps } from "@/app/shifts/booked-view";
import { TabBar } from "@/app/tab-bar";
import { disc, staffBtn, staffH2, switchTrack, tag } from "@/app/ui/classes";
import { payWords, roleAndEvent } from "@/lib/portal/format";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";
import { isOnNow, mapLink, roleLabel, shiftWhen, siteAddress } from "@/lib/portal/format";
import type { MyShift } from "@/lib/portal/my-shifts";
import { EVERY_LEVEL } from "../helpers/qualifications";

// Home (`/`), Booked (`/shifts`) and the tab bar (docs/screens.md; docs/office-v2.md 4.1-4.2; 12H.1):
// the display helpers, then the page bodies rendered to HTML with fake shifts, checked for what the
// screen spec promises. The "Cancel this shift" button uses
// Next's router, which only exists inside a running app: a stand-in router is given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);

describe("shift display helpers", () => {
  it("shows a shift's day and times in London time, naming a night shift's second day", () => {
    // 7 Nov 2026 is GMT; 13 Jun 2026 is BST (UTC+1).
    expect(shiftWhen(at("2026-11-07T14:00:00Z"), at("2026-11-07T22:00:00Z"), TZ)).toBe(
      "Sat 7 Nov, 14:00 to 22:00",
    );
    expect(shiftWhen(at("2026-06-13T08:00:00Z"), at("2026-06-13T16:00:00Z"), TZ)).toBe(
      "Sat 13 Jun, 09:00 to 17:00",
    );
    expect(shiftWhen(at("2026-11-07T22:00:00Z"), at("2026-11-08T06:00:00Z"), TZ)).toBe(
      "Sat 7 Nov, 22:00 to 06:00 Sun",
    );
    expect(shiftWhen(at("2026-11-07T16:00:00Z"), at("2026-11-08T00:00:00Z"), TZ)).toBe(
      "Sat 7 Nov, 16:00 to midnight",
    );
    // Over the October clock change (01:00 UTC on 25 Oct): 22:00 BST to 06:00 GMT, 9 real hours.
    expect(shiftWhen(at("2026-10-24T21:00:00Z"), at("2026-10-25T06:00:00Z"), TZ)).toBe(
      "Sat 24 Oct, 22:00 to 06:00 Sun",
    );
  });

  it("puts roles and addresses into words, and builds a maps link only from an address", () => {
    expect(roleLabel("door_supervisor")).toBe("Door supervisor");
    expect(roleLabel("steward")).toBe("Steward");
    const site = {
      name: "Demo Arena",
      addressLine1: "1 Test Road",
      addressLine2: " ",
      town: "Leeds",
      postcode: "LS1 1AA",
    };
    expect(siteAddress(site)).toBe("1 Test Road, Leeds, LS1 1AA");
    expect(mapLink(site)).toBe(
      "https://www.google.com/maps/search/?api=1&query=Demo%20Arena%2C%201%20Test%20Road%2C%20Leeds%2C%20LS1%201AA",
    );
    const nameOnly = {
      name: "Demo Arena",
      addressLine1: null,
      addressLine2: null,
      town: null,
      postcode: null,
    };
    expect(siteAddress(nameOnly)).toBeNull();
    expect(mapLink(nameOnly)).toBeNull();
  });

  it("knows a shift in progress", () => {
    const shift = { startsAt: at("2026-11-07T14:00:00Z"), endsAt: at("2026-11-07T22:00:00Z") };
    expect(isOnNow(shift, at("2026-11-07T13:59:00Z"))).toBe(false);
    expect(isOnNow(shift, at("2026-11-07T14:00:00Z"))).toBe(true);
    expect(isOnNow(shift, at("2026-11-07T22:00:00Z"))).toBe(false);
  });
});

const shift = (o: Partial<MyShift> & Pick<MyShift, "startsAt" | "endsAt">): MyShift => ({
  assignmentId: `a-${o.startsAt.toISOString()}`,
  shiftId: `s-${o.startsAt.toISOString()}`,
  role: "door_supervisor",
  status: "confirmed",
  instructions: null,
  site: null,
  ...o,
});

const base: BookedViewProps = {
  firmName: "Acme Events",
  timeZone: TZ,
  now: at("2026-11-02T09:00:00Z"),
  view: "upcoming",
  shifts: [],
};
const render = (props: Partial<BookedViewProps>) =>
  renderToStaticMarkup(createElement(BookedView, { ...base, ...props }));

const noOpen: OpenShiftsList = {
  shifts: [],
  truncated: false,
  offerAlerts: true,
  travelOn: true,
  area: { maxMinutes: 45 },
  further: { count: 0, atLeast: false },
  choices: { days: [], sites: [], roles: [] },
};
const homeBase: HomeViewProps = {
  firstName: "Sam",
  lastName: "Udo",
  firmName: "Acme Events",
  // The Friday after the week of Mon 2 Nov (D8).
  pay: { payDay: "2026-11-13", days: 7, start: "2026-11-02", end: "2026-11-08" },
  timeZone: TZ,
  now: at("2026-11-02T09:00:00Z"),
  next: null,
  needs: [],
  photo: { status: "up_to_date", current: null, waiting: null },
  open: noOpen,
};
const home = (props: Partial<HomeViewProps>) =>
  renderToStaticMarkup(createElement(HomeView, { ...homeBase, ...props }));
// Visible text, roughly: tags out, entities decoded.
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
// What a screen reader hears of a row: without its decorative tile (a date tile, an icon, her
// initials), which says again what the words say.
const spoken = (html: string) =>
  text(
    html.replace(
      /<span aria-hidden="true"[^>]*>(?:<span[^>]*>[^<]*<\/span>|<svg[\s\S]*?<\/svg>|[A-Z]{1,2})*<\/span>/g,
      "",
    ),
  ).trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("Home and Booked: the empty pages", () => {
  it("Home greets her, and says so plainly when nothing is booked, with a way to open shifts", () => {
    const html = home({});
    // "Hi Sam" (Phase 20), since Phase 28.7 the page's headline through PageHeader, as every page's
    // (text-title), with when it was updated beside it, online only (the kept copy's notice says
    // when it was saved); no longer at the end of the firm's bar, and no face of its own.
    expect(text(html)).toContain("Hi Sam");
    expect(html).toMatch(
      /<h1 class="text-title [^"]*">Hi Sam<\/h1><small data-updated-slot="" data-online-only="" class="[^"]*">Updated 09:00<\/small>/,
    );
    expect(html).not.toContain("font-greet");
    expect(html).not.toContain("-top-13");
    // Phase 18: an empty pass, and the way to the open shifts: "See open shifts" (28.7: one name).
    expect(text(html)).toContain(
      "No shifts booked Take a shift and it shows up here as your pass, with the time and the gate. See open shifts",
    );
    expect(text(html)).not.toContain("Find a shift");
    // The main button: the firm's colour (Phase 24; one flat colour since Phase 28).
    expect(html).toMatch(
      /<a class="[^"]*(?<![\w-])glass-tint(?![\w-])[^"]*" href="\/shifts\/open">See open shifts<\/a>/,
    );
    // The empty pass: its own glass section, 12px round, with no dashed edge; its placeholder 1px
    // dashed and 8px round; its heading a section heading (Phase 28.7).
    const empty =
      /<section aria-labelledby="next-heading" class="([^"]*)">([\s\S]*?)<\/section>/.exec(html);
    expect(empty?.[1]).toContain("glass rounded-inner");
    expect(empty?.[1]).not.toMatch(/border-dashed|border-2|rounded-3xl/);
    expect(empty?.[2]).toMatch(
      /^<span aria-hidden="true" class="block h-12 w-18 rounded-row border border-dashed border-line-strong bg-raised"><\/span>/,
    );
    expect(empty?.[2]).toContain(
      `<h2 id="next-heading" class="mt-1 ${staffH2}">No shifts booked</h2>`,
    );
    expect(text(html)).toContain("No shifts right now We'll message you when something matches.");
    expect(text(home({ open: { ...noOpen, offerAlerts: false } }))).toContain(
      "No shifts right now Check back later.",
    );
  });
  it("Booked is on the Shifts tab: Open | Booked, then Upcoming | Past 30 days at /shifts", () => {
    const html = render({});
    expect(text(html)).toContain("Booked shifts");
    expect(html).toMatch(/<a[^>]*href="\/shifts\/open"[^>]*>Open<\/a>/);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Booked<\/a>/);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Upcoming<\/a>/);
    expect(html).toContain('href="/shifts?view=past"');
    expect(text(html)).toContain("No shifts booked yet.");
    expect(text(html)).toContain("See all open shifts");
    // Both switches in the one shared pale track (Phase 17), the Open | Booked one first.
    expect(html).toContain(`<nav aria-label="Open or booked" class="mb-4 ${switchTrack}">`);
    expect(html).toContain(`<nav aria-label="Which shifts" class="${switchTrack}">`);
    expect(html.split(switchTrack)).toHaveLength(3);
  });
});

describe("Booked: the bookings themselves", () => {
  it("shows the next shift in full (time, role, site, maps, instructions) and lists the rest", () => {
    const next = shift({
      startsAt: at("2026-11-07T14:00:00Z"),
      endsAt: at("2026-11-07T22:00:00Z"),
      instructions: "Report to Gate C at 13:30.\nBring your licence.",
      site: {
        name: "Demo Arena",
        addressLine1: "1 Test Road",
        addressLine2: null,
        town: "Leeds",
        postcode: "LS1 1AA",
      },
    });
    const later = shift({
      startsAt: at("2026-11-14T09:00:00Z"),
      endsAt: at("2026-11-14T17:00:00Z"),
      role: "steward",
      site: {
        name: "Demo Racecourse",
        addressLine1: null,
        addressLine2: null,
        town: null,
        postcode: null,
      },
    });
    const html = render({ shifts: [next, later] });
    const words = text(html);
    // Phase 20: the same pass as Home's, its heading shown above it.
    expect(html).toMatch(
      /<section aria-labelledby="next-heading" data-pass="" class="flex flex-col gap-3">/,
    );
    // (18px semibold since Phase 28: `staffH2`, the office's section heading.)
    expect(html).toMatch(
      /<h2 id="next-heading" class="text-lg font-semibold[^"]*">Your next shift<\/h2>/,
    );
    expect(words).toContain("In 5 days Saturday 7 November 14:00–22:00 Door supervisor Demo Arena");
    expect(words).toContain("Demo Arena Leeds, LS1 1AA Directions");
    expect(words).toContain("Demo Arena, 1 Test Road, Leeds, LS1 1AA");
    expect(html).toContain(
      'href="https://www.google.com/maps/search/?api=1&amp;query=Demo%20Arena',
    );
    expect(words).toContain("Directions");
    expect(words).not.toContain("Open in maps");
    expect(words).toContain("Instructions");
    expect(words).toContain("Report to Gate C at 13:30.");
    expect(words).toContain("Later");
    expect(words).toContain("Sat 14 09:00–17:00 Steward Demo Racecourse");
    // Every upcoming shift opens to its own details (no JavaScript: <details>).
    expect(html).toMatch(/<details>.*Demo Racecourse.*<\/details>/s);
    expect(words).not.toContain("No shifts booked yet.");
  });

  it("marks a shift that has started as on now, with no cancel button (that's for the office)", () => {
    const html = render({
      now: at("2026-11-07T15:00:00Z"),
      shifts: [shift({ startsAt: at("2026-11-07T14:00:00Z"), endsAt: at("2026-11-07T22:00:00Z") })],
    });
    expect(text(html)).toContain("On now");
    expect(text(html)).not.toContain("Your next shift");
    expect(text(html)).not.toContain("Can't make it?");
    expect(text(html)).not.toContain("Cancel this shift");
  });

  it("offers Can't make it? on every upcoming booking that hasn't started", () => {
    const html = render({
      shifts: [
        shift({ startsAt: at("2026-11-07T14:00:00Z"), endsAt: at("2026-11-07T22:00:00Z") }),
        shift({ startsAt: at("2026-11-08T14:00:00Z"), endsAt: at("2026-11-08T22:00:00Z") }),
      ],
    });
    // Phase 18: "Can't make it?" opens the sheet that cancels it (on the pass, red words under
    // Directions and Details: Phase 24).
    expect(html.match(/>Can&#x27;t make it\?</g)).toHaveLength(2);
    // And "Ask for a change" (a time change or swap request) for each: in the pass's Details, and
    // side by side with it on a later row.
    expect(html.match(/href="\/requests\/new\?shift=[^"]+"[^>]*>Ask for a change</g)).toHaveLength(
      2,
    );
    expect(html.match(/<div class="mt-3 grid grid-cols-2 gap-2.5">/g)).toHaveLength(1);
    expect(
      html.match(new RegExp(`class="${esc(staffBtn.danger)}">Can&#x27;t make it\\?</button>`, "g")),
    ).toHaveLength(1);
    expect(html.match(/class="[^"]*text-urgent-ink">Can&#x27;t make it\?<\/button>/g)).toHaveLength(
      1,
    );
  });
  it("shows the last 30 days with what happened, or says there's nothing", () => {
    const worked = shift({
      startsAt: at("2026-10-31T14:00:00Z"),
      endsAt: at("2026-10-31T22:00:00Z"),
      status: "completed",
    });
    const missed = shift({
      startsAt: at("2026-10-20T14:00:00Z"),
      endsAt: at("2026-10-20T22:00:00Z"),
      status: "no_show",
    });
    const unmarked = shift({
      startsAt: at("2026-10-10T14:00:00Z"),
      endsAt: at("2026-10-10T22:00:00Z"),
    });
    const html = render({ view: "past", shifts: [worked, missed, unmarked] });
    const words = text(html);
    expect(words).toContain("The last 30 days");
    expect(words).toContain("Worked");
    expect(words).toContain("Marked as not attended");
    expect(words).toContain("Booked");
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Past 30 days<\/a>/);
    expect(text(render({ view: "past" }))).toContain("No shifts in the last 30 days.");
  });

  it("the tab bar: Home, Shifts, Messages, Pay, Profile, the current one marked, a count on Profile and Messages when needed", () => {
    for (const current of ["home", "shifts", "messages", "pay", "profile"] as const) {
      const html = renderToStaticMarkup(createElement(TabBar, { current }));
      const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)];
      expect(links.map((m) => [m[1], text(m[2] ?? "").trim()])).toEqual([
        ["/", "Home"],
        ["/shifts", "Shifts"],
        ["/messages", "Messages"],
        ["/pay", "Pay"],
        ["/profile", "Profile"],
      ]);
      const marked = links.filter((m) => m[0].includes('aria-current="page"')).map((m) => m[1]);
      expect(marked).toEqual([
        {
          home: "/",
          shifts: "/shifts",
          messages: "/messages",
          pay: "/pay",
          profile: "/profile",
        }[current],
      ]);
      // Phase 28 (28.1, as the office rail's lit item): the current tab solid ink, its icon and
      // word on it in the ink's own words colour, the word bold, its focus ring in that colour too:
      // not colour alone. No lens and no firm's colour. The others grey, their words medium, the
      // rail's grey wash under the pointer.
      const here = links.find((m) => m[0].includes('aria-current="page"'))?.[0] ?? "";
      expect(here).toMatch(
        /class="[^"]*(?<![\w-])bg-ink font-semibold text-on-ink focus-visible:outline-on-ink"/,
      );
      expect(html.match(/(?<![\w-])bg-ink(?![\w-])/g)).toHaveLength(1);
      expect(html).not.toMatch(/(?<![\w-])(?:lens|text-brand-ink)(?![\w-])/);
      expect(
        html.match(
          /font-medium text-ink-muted hover:bg-active hover:text-ink active:bg-button-press/g,
        ),
      ).toHaveLength(4);
      // A floating glass capsule 12px round, 12px from the screen's edges and its foot (over the
      // phone's safe area), inside a bar that lets the page take taps around it; no line.
      expect(html).toMatch(
        /^<nav aria-label="Main" data-tab-bar="" class="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-3 pb-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\]"><div class="glass-float pointer-events-auto mx-auto grid h-17 max-w-md grid-cols-5 gap-1 rounded-card p-1\.5 /,
      );
      expect(html).not.toMatch(/(?<![\w-])shadow-bar(?![\w-])/);
      expect(html).not.toContain("border-t");
      // Scrolling down shrinks it to its icons (54px tall, at most 290px wide: ChromeWatch's
      // data-tabs-mini on <html>); the words stay for screen readers. It moves only when motion is
      // fine.
      expect(html).toContain(
        "[html[data-tabs-mini]_&amp;]:h-13.5 [html[data-tabs-mini]_&amp;]:max-w-72.5 [html[data-tabs-mini]_&amp;]:p-1.25",
      );
      expect(html).toContain("motion-safe:transition-[height,max-width] motion-safe:duration-300");
      expect(
        html.match(/<span class="leading-tight \[html\[data-tabs-mini\]_&amp;\]:sr-only">/g),
      ).toHaveLength(5);
      // The words at 14px, under their icons; each tab 8px round.
      expect(html.match(/rounded-row px-1 text-sm /g)).toHaveLength(5);
      expect(html).toContain('aria-label="Main"');
      expect(html).not.toContain("data-profile-count");
      expect(html).not.toContain("data-messages-count");
      expect(html).not.toContain("data-pay-count");
    }
    const counted = renderToStaticMarkup(
      createElement(TabBar, { current: "home", profileCount: 2 }),
    );
    expect(counted).toMatch(
      /<span aria-hidden="true" data-profile-count="" class="[^"]*bg-hivis[^"]*">2<\/span>/,
    );
    // The Profile link's whole name, with no gap before the comma; the other tabs keep their word.
    const profileTag = /<a [^>]*href="\/profile"[^>]*>/.exec(counted)?.[0] ?? "";
    expect(profileTag).toContain('aria-label="Profile, 2 things need doing"');
    expect(counted.match(/aria-label="[^"]*need doing"/g)).toHaveLength(1);
    expect(
      renderToStaticMarkup(createElement(TabBar, { current: "home", profileCount: 1 })),
    ).toContain('aria-label="Profile, 1 thing needs doing"');
    // Messages (Phase 25.6): the office's replies she hasn't opened, in the firm's colour.
    const replies = renderToStaticMarkup(
      createElement(TabBar, { current: "home", messagesCount: 2 }),
    );
    expect(replies).toMatch(
      /<span aria-hidden="true" data-messages-count="" class="[^"]*glass-tint[^"]*">2<\/span>/,
    );
    expect(replies).not.toContain("data-profile-count");
    expect(/<a [^>]*href="\/messages"[^>]*>/.exec(replies)?.[0]).toContain(
      'aria-label="Messages, 2 new replies"',
    );
    expect(
      renderToStaticMarkup(createElement(TabBar, { current: "home", messagesCount: 1 })),
    ).toContain('aria-label="Messages, 1 new reply"');
  });
  it("names the later list 'Later', with its count beside the heading, not in it; kept, with Find open shifts, when nothing else is booked", () => {
    const html = render({
      shifts: [
        shift({ startsAt: at("2026-11-07T14:00:00Z"), endsAt: at("2026-11-07T22:00:00Z") }),
        shift({ startsAt: at("2026-11-08T14:00:00Z"), endsAt: at("2026-11-08T22:00:00Z") }),
        shift({ startsAt: at("2026-11-09T14:00:00Z"), endsAt: at("2026-11-09T22:00:00Z") }),
      ],
    });
    // The section is named by the heading's words alone; the 2 sits right after the </h2>.
    expect(html).toContain('aria-labelledby="later-heading"');
    expect(html).toMatch(/<h2 id="later-heading"[^>]*>Later<\/h2><span[^>]*>2<\/span>/);
    // Nothing else booked: "Later" keeps its place, says so, with the way to open shifts.
    const one = render({
      shifts: [shift({ startsAt: at("2026-11-07T14:00:00Z"), endsAt: at("2026-11-07T22:00:00Z") })],
    });
    expect(one).toMatch(/<h2 id="later-heading"[^>]*>Later<\/h2><\/div>/);
    expect(text(one)).toContain("Later Nothing else booked yet. Find open shifts");
    expect(one).toMatch(/<a class="[^"]*" href="\/shifts\/open">Find open shifts<svg/);
  });

  it("gives every bullet-free list role=list, so Safari still announces it as a list", () => {
    const later = shift({
      startsAt: at("2026-11-08T14:00:00Z"),
      endsAt: at("2026-11-08T22:00:00Z"),
    });
    const now = shift({ startsAt: at("2026-11-07T14:00:00Z"), endsAt: at("2026-11-07T22:00:00Z") });
    const worked = shift({
      startsAt: at("2026-10-31T14:00:00Z"),
      endsAt: at("2026-10-31T22:00:00Z"),
      status: "completed",
    });
    for (const html of [
      render({ shifts: [now, later] }),
      render({ view: "past", shifts: [worked] }),
    ]) {
      // (The links to every other page moved to the tab bar: one list here now.)
      const lists = [...html.matchAll(/<ul\b[^>]*>/g)].map((m) => m[0]);
      expect(lists.length).toBeGreaterThanOrEqual(1);
      for (const tag of lists) expect(tag).toContain('role="list"');
    }
  });

  it("Home's Needs doing row: the worst thing first, its own sentence, where she sorts it (12F.1)", () => {
    const row = (html: string) => {
      const at = html.indexOf('data-for-you="needs"');
      return at < 0 ? null : html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at));
    };
    // Five things: how many, the one stopping a booked shift first (its whole sentence), Profile.
    const manyHtml = home({ needs: EVERY_LEVEL });
    const many = row(manyHtml) ?? "";
    expect(spoken(many)).toContain(
      "Needs doing now 5 things need doing SIA door supervisor licence expires on 5 Nov, and your door supervisor shift on Fri 6 Nov needs it. Upload the new one, or message the office. And 4 more.",
    );
    expect(many).toMatch(/href="\/profile"/);
    // Under "Do this" (Phase 24), since Phase 28.7 one glass section with an amber leaf before its
    // heading inside it, and its rows as clear glass tiles 8px apart, 12px under it; no band.
    // Something that stops her working: the office's pale red disc as its lead and a red "Needs
    // doing now" plate over the words; otherwise the pale amber disc (something to do).
    expect(manyHtml).toMatch(
      /<section aria-labelledby="do-this-heading" class="glass animate-in rounded-inner p-4"><div class="flex items-center gap-3 px-1"><svg[^>]*class="shrink-0 text-attention-ink"><path d="M5 19C5 10[^"]*"[^>]*><\/path><\/svg><h2 id="do-this-heading" class="[^"]*">Do this<\/h2><\/div><ul role="list" class="mt-3 flex flex-col gap-2"><li data-for-you="needs">/,
    );
    const lead = (tone: "urgent" | "attention") =>
      `<span aria-hidden="true" class="flex w-13 shrink-0 justify-center"><span class="${disc.base} ${disc[tone]}"><svg`;
    expect(many).toContain(lead("urgent"));
    expect(many).toMatch(
      /<span class="[^"]*bg-urgent-fill text-on-urgent mb-1">Needs doing now<\/span>/,
    );
    expect(many).toMatch(
      /<a class="[^"]*(?<![\w-])glass-tile rounded-row min-h-20(?![\w-])[^"]*" href="\/profile">/,
    );
    // One she can sort herself: straight to its upload.
    const oneHtml = home({ needs: EVERY_LEVEL.slice(3, 4) });
    const one = row(oneHtml) ?? "";
    expect(spoken(one)).toBe(
      "Renew your SIA security guard licence SIA security guard licence expires on 25 Nov. Renew it to keep getting security officer shifts.",
    );
    expect(one).toContain('href="/profile/upload/SIA_SG"');
    expect(one).toContain(lead("attention"));
    expect(one).not.toContain("Needs doing now");
    for (const html of [manyHtml, oneHtml]) {
      const doThis = html.slice(html.indexOf('aria-labelledby="do-this-heading"'));
      expect(doThis.slice(0, doThis.indexOf("</section>"))).not.toMatch(
        /glass-band|rounded-\[|rounded-[23]xl/,
      );
    }
    // One the office records (CSAS): to Profile.
    expect(row(home({ needs: EVERY_LEVEL.slice(4) })) ?? "").toContain('href="/profile"');
    // Nothing to do: no row.
    expect(row(home({}))).toBeNull();
  });
  it("Needs doing shows her photo when it's overdue or due soon, at its level, with one action", () => {
    const photo = (status: "overdue" | "due_soon" | "up_to_date" | "missing" | "waiting") => ({
      status,
      current: { id: "p1", uploadedOn: "2023-11-20", renewBy: "2026-11-20" },
      waiting: null,
    });
    const row = (html: string) => {
      const at = html.indexOf('data-for-you="needs"');
      return at < 0
        ? null
        : spoken(html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at)));
    };
    const due = home({ photo: photo("due_soon") });
    // Round 7's words: what to do, and by when; since Phase 28.7 a camera on the pale amber disc
    // beside it, never her initials.
    expect(row(due)).toBe("Renew your staff photo Due by 20 Nov.");
    expect(due).toContain('href="/profile#photo-heading"');
    expect(due).toMatch(
      new RegExp(
        `href="/profile#photo-heading"><span aria-hidden="true" class="flex w-13 shrink-0 justify-center"><span class="${esc(`${disc.base} ${disc.attention}`)}"><svg[^>]*><path d="M4 7\\.5h3\\.5L9 5h6`,
      ),
    );
    expect(due).not.toContain(">SU<");
    // Overdue: the camera on the pale red disc.
    expect(home({ photo: photo("overdue") })).toMatch(
      new RegExp(
        `href="/profile#photo-heading"><span aria-hidden="true" class="flex w-13 shrink-0 justify-center"><span class="${esc(`${disc.base} ${disc.urgent}`)}"><svg[^>]*><path d="M4 7\\.5h3\\.5L9 5h6`,
      ),
    );
    // Due soon (level 3) comes after a level-3 qualification, before a missing one.
    expect(row(home({ needs: EVERY_LEVEL.slice(3), photo: photo("due_soon") }))).toContain(
      "3 things need doing SIA security guard licence expires on 25 Nov.",
    );
    // Overdue (level 2): first, red.
    const overdue = home({ needs: EVERY_LEVEL.slice(3, 4), photo: photo("overdue") });
    expect(row(overdue)).toBe(
      "Needs doing now 2 things need doing It was due by 20 Nov. And 1 more.",
    );
    // Up to date, missing or waiting for the office: nothing to do on Home.
    for (const status of ["up_to_date", "missing", "waiting"] as const) {
      expect(row(home({ photo: photo(status) }))).toBeNull();
    }
  });
});

const open = (o: Partial<OpenShift> & { shiftId: string }): OpenShift => ({
  role: "steward",
  startsAt: at("2026-11-07T09:30:00Z"),
  endsAt: at("2026-11-07T17:30:00Z"),
  placesLeft: 2,
  site: {
    id: "site-1",
    name: "Riverside Arena",
    addressLine1: null,
    addressLine2: null,
    town: null,
    postcode: "ZZ1 1AA",
  },
  opensAt: null,
  isUrgent: false,
  travel: {
    kind: "estimated",
    straightMetres: 4000,
    arriveBy: at("2026-11-07T09:00:00Z"),
    car: { minutes: 12, metres: 4989 },
    publicTransport: { minutes: 24 },
  },
  eventName: "Raceday",
  casualEvent: "Raceday", // the loader sets both (null for an automatic event: 12H.2)
  payRatePence: 1260,
  post: "Gate B",
  ...o,
});

describe("Home: what she can take, and her next shift in full", () => {
  it("Shifts you can take, then Pay (Phase 24): the urgent shifts she can take, the others she can apply for, pay day, each one row", () => {
    const shifts = [
      open({ shiftId: "u1", isUrgent: true, payRatePence: 1550 }),
      open({ shiftId: "u2", isUrgent: true, startsAt: at("2026-11-08T09:30:00Z") }),
      open({ shiftId: "a1" }),
      open({ shiftId: "a2", eventName: null, casualEvent: null, post: null, payRatePence: null }),
      open({ shiftId: "a3", startsAt: at("2026-11-10T09:30:00Z") }),
    ];
    const html = home({ open: { ...noOpen, shifts, further: { count: 2, atLeast: false } } });
    const section = html.slice(html.indexOf('aria-labelledby="can-take-heading"'));
    expect(section).toContain('<h2 id="can-take-heading"');
    expect(html).not.toContain("for-you-heading");
    const rowsOf = [...section.matchAll(/<li [^>]*data-for-you="([a-z]+)"[^>]*>(.*?)<\/li>/g)].map(
      (m) => [m[1], spoken(m[2] ?? "")],
    );
    expect(rowsOf).toEqual([
      ["urgent", "2 urgent shifts near you Sat 7 and Sun 8 Nov · up to £15.50/hour"],
      [
        "offline",
        "Open shifts need signal 2 were urgent at 09:00 on Mon 2 Nov. We'll check again when you're online.",
      ],
      ["apply", "3 more you can take Sat 7 and Tue 10 Nov · up to £12.60/hour"],
      ["pay", "Pay day: Fri 13 Nov For shifts Mon 2 to Sun 8 Nov"],
    ]);
    expect(section).toMatch(
      /<li data-online-only="" data-for-you="urgent"><a class="[^"]*" href="\/urgent"/,
    );
    expect(section).toMatch(/<li data-offline-only="" data-for-you="offline">/);
    expect(section).toMatch(
      /<li data-online-only="" data-for-you="apply"><a class="[^"]*" href="\/shifts\/open"/,
    );
    // Each section one glass section with its heading inside (Phase 28.7), its rows 12px under it,
    // each row a clear glass tile 8px from the next (at least 80px tall): its lead, its words and a
    // chevron. The lead: the soonest shift's day (pale red when urgent), the office's clear disc
    // with an icon offline, pay day's date.
    expect(section).toMatch(
      /^aria-labelledby="can-take-heading" class="glass animate-in rounded-inner p-4"><div class="flex items-center gap-3 px-1"><h2 id="can-take-heading" class="[^"]*">Shifts you can take<\/h2><\/div><ul role="list" class="mt-3 flex flex-col gap-2"><li data-online-only="" data-for-you="urgent">/,
    );
    for (const kind of ["urgent", "offline", "apply", "pay"]) {
      expect(section).toMatch(
        new RegExp(
          `data-for-you="${kind}"><(?:a|div) class="[^"]*(?<![\\w-])glass-tile rounded-row min-h-20(?![\\w-])[^"]*"`,
        ),
      );
    }
    const tile = (kind: string) =>
      new RegExp(
        `data-for-you="${kind}"><(?:a|div) class="[^"]*"(?: href="[^"]*")?><span aria-hidden="true" class="([^"]*)">(.*?)</span>(?:</span>)?<span class="min-w-0 flex-1">`,
      ).exec(section);
    expect(tile("urgent")?.[1]).toContain("bg-urgent-tile text-urgent-ink");
    expect(text(tile("urgent")?.[2] ?? "").trim()).toBe("Sat 7");
    expect(tile("offline")?.[1]).toBe("flex w-13 shrink-0 justify-center");
    expect(tile("offline")?.[2]).toContain(`<span class="${disc.base} ${disc.quiet}"><svg`);
    expect(tile("apply")?.[1]).toContain("glass-button text-ink");
    expect(text(tile("apply")?.[2] ?? "").trim()).toBe("Sat 7");
    expect(text(tile("pay")?.[2] ?? "").trim()).toBe("Fri 13");
    expect(
      section.match(
        /<svg[^>]*class="shrink-0 text-ink-muted"><path d="m9 5\.5 6\.5 6\.5L9 18\.5"/g,
      ),
    ).toHaveLength(3);
    expect(section).not.toMatch(/(?<![\w-])shadow-lift(?![\w-])/);
    expect(section).toMatch(/<h2 id="pay-heading"[^>]*>Pay<\/h2>/);
    expect(section).toMatch(/<li data-for-you="pay"><a class="[^"]*" href="\/pay"/);
    // No shift's own travel line on Home: that's on each shift.
    expect(html).not.toContain("data-travel-line");
  });
  it("with no travel area: a row to add one, its pin on the office's clear disc", () => {
    const html = home({ open: { ...noOpen, area: null, shifts: [open({ shiftId: "a1" })] } });
    const at = html.indexOf('data-for-you="area"');
    expect(spoken(html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at)))).toBe(
      "Add your travel area Add your travel area to see how far each shift is and only see shifts you can get to.",
    );
    expect(html.slice(at, html.indexOf("</li>", at))).toMatch(
      new RegExp(
        `^data-for-you="area"><a class="[^"]*min-h-20 press" href="/profile/travel"><span aria-hidden="true" class="flex w-13 shrink-0 justify-center"><span class="${esc(`${disc.base} ${disc.quiet}`)}"><svg[^>]*><path d="M12 21s7-6\\.2`,
      ),
    );
    expect(html.slice(at)).toContain('href="/profile/travel"');
    expect(text(home({ open: { ...noOpen, shifts: [open({ shiftId: "a1" })] } }))).not.toContain(
      "Add your travel area",
    );
  });
  it("her next shift as a pass that opens into its details: getting there, report to, bring and wear, pay, actions", () => {
    const next = shift({
      startsAt: at("2026-11-07T14:00:00Z"),
      endsAt: at("2026-11-07T22:00:00Z"),
      role: "steward",
      eventName: "Raceday",
      post: "Gate B",
      payRatePence: 1260,
      meetingPoint: "Staff entrance, Gate B",
      uniform: "Black trousers, hi-vis tabard (we provide it)",
      instructions: "Ask for the steward lead.",
      travel: {
        kind: "estimated",
        straightMetres: 4000,
        arriveBy: at("2026-11-07T09:00:00Z"),
        car: { minutes: 12, metres: 4989 },
        publicTransport: { minutes: 24 },
      },
      site: {
        name: "Demo Arena",
        addressLine1: "1 Test Road",
        addressLine2: null,
        town: "Leeds",
        postcode: "LS1 1AA",
      },
    });
    const html = home({ next });
    const card = html.slice(html.indexOf('aria-labelledby="next-heading"'));
    const pass = card.slice(0, card.indexOf("</section>"));
    // Phase 24 (round 7): the pass is one glass card; its heading is for screen readers (the pass
    // speaks for itself).
    expect(pass).toMatch(
      /^aria-labelledby="next-heading" data-pass="" class="flex flex-col gap-3">/,
    );
    expect(pass).toContain('<h2 id="next-heading" class="sr-only">Your next shift</h2>');
    // Phase 28.7: one glass section 12px round, 16px inside its edges, with no band; when above a
    // faint line, where under it.
    const [, band = "", foot = ""] =
      /^aria-labelledby="next-heading" data-pass="" class="flex flex-col gap-3"><h2 id="next-heading" class="sr-only">Your next shift<\/h2><div class="glass rounded-inner px-4 py-4 animate-in"><div>([\s\S]*?)<\/div><div class="mt-4 flex flex-col gap-4 border-t border-line pt-4">([\s\S]*?)<\/div><\/div><div id="pass-details"/.exec(
        pass,
      ) ?? [];
    expect(pass).not.toContain("glass-band");
    // (The card under it, Details, is the shift parts'; the pass itself keeps to the token corners.)
    expect(pass.slice(0, pass.indexOf('id="pass-details"'))).not.toMatch(
      /rounded-\[|rounded-[23]xl/,
    );
    // Its top: how soon as a tag (a clear glass pill), the date in words, the time large, the
    // role and event.
    expect(text(band).trim()).toBe("In 5 days Saturday 7 November 14:00–22:00 Steward · Raceday");
    expect(band).toContain(`<span class="${tag}">In 5 days</span>`);
    expect(band).toMatch(
      /<p class="mt-3 font-sign text-4xl leading-tight text-ink">14:00–22:00<\/p>/,
    );
    // Under it the place, its town and postcode, and the gate on a clear glass plate 8px round
    // (its words 16px, to read at a gate); then Directions (the maps link, the main button) and
    // Details (clear glass) side by side, "Can't make it?" in red words under them.
    expect(text(foot).trim().replace(/\s+/g, " ")).toBe(
      "Demo Arena Leeds, LS1 1AA Gate B Directions Details Hide details Can't make it?",
    );
    expect(foot).toMatch(
      /<span class="glass-button shrink-0 rounded-row px-3 py-1\.5 text-base font-medium text-ink">Gate B<\/span>/,
    );
    // No travel time on the pass itself: a drive alone would mislead someone without a car (12G.3).
    expect(text(band + foot)).not.toContain("by car");
    const buttons =
      /<div class="grid auto-cols-fr grid-flow-col gap-2">([\s\S]*?)<\/details><\/div>/.exec(
        foot,
      )?.[1] ?? "";
    expect(buttons).toMatch(
      new RegExp(
        `^<a href="https://www\\.google\\.com/maps/search/\\?api=1&amp;query=Demo%20Arena[^"]*" target="_blank" rel="noopener noreferrer" class="${esc(staffBtn.primary)}"><svg[\\s\\S]*?</svg>Directions</a>`,
      ),
    );
    // Details is a <details> whose summary is the button: it opens without JavaScript, and the
    // card under the pass shows while it's open (a :has() rule on the pass).
    expect(buttons).toMatch(
      new RegExp(
        `<details data-pass-more="" class="group"><summary aria-controls="pass-details" class="${esc(staffBtn.secondary)} list-none [^"]*"><svg[\\s\\S]*?</summary>$`,
      ),
    );
    expect(foot).toMatch(
      new RegExp(
        `</details></div><button type="button" disabled="" class="${esc(staffBtn.danger)}">Can&#x27;t make it\\?</button>`,
      ),
    );
    expect(pass).toMatch(
      /<div id="pass-details" class="[^"]*hidden animate-open \[\[data-pass\]:has\(\[data-pass-more\]\[open\]\)_&amp;\]:flex">/,
    );
    // The card: getting there as three figures, report to (with where), the uniform (what the firm
    // gives in hi-vis yellow), the pay, the instructions, then Directions and Ask for a change.
    const details = text(pass.slice(pass.indexOf('id="pass-details"'))).replace(/\s+/g, " ");
    expect(details).toContain(
      "Getting there, from your travel area 3.1 miles · 12 min by car · 24 min by public transport 3.1 miles away 12 min by car 24 min by public transport",
    );
    expect(details).toContain(
      "Report to Staff entrance, Gate B Demo Arena, 1 Test Road, Leeds, LS1 1AA",
    );
    expect(details).toContain("Bring and wear Hi-vis tabard We provide it Black trousers");
    expect(pass).toMatch(/<span class="[^"]*bg-hivis[^"]*text-on-hivis">We provide it<\/span>/);
    expect(details).toContain(
      "Pay £12.60 an hour, about £100.80 before tax £12.60 an hour About £100.80 before tax for the 8 hours",
    );
    expect(details).toContain("Instructions Ask for the steward lead.");
    expect(pass).toMatch(
      new RegExp(
        `<a href="[^"]*" target="_blank" rel="noopener noreferrer" class="${staffBtn.primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`,
      ),
    );
    expect(details).toContain("Directions Ask for a change");
    expect(pass).toMatch(
      new RegExp(
        `<a class="${staffBtn.secondary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" href="/requests/new\\?shift=[^"]+">Ask for a change</a>`,
      ),
    );
    expect(text(html)).not.toContain("No shifts booked");
    // On now: the pass and its heading say so, and there's nothing to cancel or change.
    const onNow = home({ next, now: at("2026-11-07T15:00:00Z") });
    expect(onNow).toContain('<h2 id="next-heading" class="sr-only">On now</h2>');
    expect(text(onNow)).toContain("On now Saturday 7 November 14:00–22:00");
    expect(onNow).not.toContain("Can&#x27;t make it?");
    expect(onNow).not.toContain("Ask for a change");
    // No pay rate set: the pay row says to ask, never left out (Phase 27.2, C3).
    const noRate = home({ next: { ...next, payRatePence: null } });
    const noRateDetails = text(noRate.slice(noRate.indexOf('id="pass-details"'))).replace(
      /\s+/g,
      " ",
    );
    expect(noRateDetails).toContain("Bring and wear Hi-vis tabard We provide it Black trousers");
    expect(noRateDetails).toContain("Pay Ask the office Instructions");
    expect(noRateDetails).not.toContain("an hour");
  });
  it("puts pay and the event into words", () => {
    expect(payWords(1260, at("2026-11-07T14:00:00Z"), at("2026-11-07T22:00:00Z"))).toBe(
      "£12.60 an hour, about £100.80 before tax",
    );
    expect(payWords(1155, at("2026-11-07T14:00:00Z"), at("2026-11-07T20:30:00Z"))).toBe(
      "£11.55 an hour, about £75.08 before tax",
    );
    expect(roleAndEvent("door_supervisor", "Raceday")).toBe("Door supervisor · Raceday");
    expect(roleAndEvent("door_supervisor", null)).toBe("Door supervisor");
  });

  it("gives every bullet-free list on Home role=list", () => {
    const html = home({
      needs: EVERY_LEVEL,
      next: shift({
        startsAt: at("2026-11-07T14:00:00Z"),
        endsAt: at("2026-11-07T22:00:00Z"),
        uniform: "Black trousers, hi-vis tabard",
      }),
      open: {
        ...noOpen,
        shifts: [open({ shiftId: "u1", isUrgent: true }), open({ shiftId: "a1" })],
      },
    });
    const lists = [...html.matchAll(/<ul\b[^>]*>/g)].map((m) => m[0]);
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const tag of lists) expect(tag).toContain('role="list"');
  });
});

describe("Booked: every upcoming shift's details", () => {
  it("shows a later shift's address, maps button and instructions inside its row", () => {
    const next = shift({
      startsAt: at("2026-11-07T14:00:00Z"),
      endsAt: at("2026-11-07T22:00:00Z"),
    });
    const sunday = shift({
      startsAt: at("2026-11-08T10:00:00Z"),
      endsAt: at("2026-11-08T18:00:00Z"),
      instructions: "Report to Gate C.",
      site: {
        name: "Demo Racecourse",
        addressLine1: "2 Test Lane",
        addressLine2: null,
        town: "York",
        postcode: "YO1 1AA",
      },
    });
    const bare = shift({
      startsAt: at("2026-11-09T10:00:00Z"),
      endsAt: at("2026-11-09T18:00:00Z"),
    });
    const html = renderToStaticMarkup(
      createElement(BookedView, { ...base, shifts: [next, sunday, bare] }),
    );
    const rowsOf = html.split("<details>").slice(1);
    expect(rowsOf).toHaveLength(2);
    const row = rowsOf[0] ?? "";
    expect(text(row)).toContain("Sun 8 10:00–18:00");
    expect(text(row)).toContain("2 Test Lane, York, YO1 1AA");
    expect(text(row)).toContain("Directions");
    expect(text(row)).toContain("Report to Gate C.");
    expect(text(rowsOf[1] ?? "")).toContain("Mon 9 10:00–18:00");
    expect(text(rowsOf[1] ?? "")).toContain("No site or instructions yet.");
  });
});

describe("Booked, after taking a shift (Phase 18)", () => {
  const first = shift({ startsAt: at("2026-11-07T14:00:00Z"), endsAt: at("2026-11-07T22:00:00Z") });
  const second = shift({
    startsAt: at("2026-11-08T10:00:00Z"),
    endsAt: at("2026-11-08T18:00:00Z"),
  });
  const marked = (html: string) => (html.match(/animate-move/g) ?? []).length;
  const news = (html: string) => (html.match(/>New<\/span>/g) ?? []).length;

  it("the shift just taken moves into its place, marked New; nothing else is", () => {
    // It's the next one: the next shift's card.
    const next = render({ shifts: [first, second], newShiftId: first.shiftId });
    expect([marked(next), news(next)]).toEqual([1, 1]);
    const card = next.slice(
      next.lastIndexOf("<section", next.indexOf("Your next shift")),
      next.indexOf('id="later-heading"'),
    );
    // The pass moves into its place (Phase 20: the pass itself; one glass section with no band
    // since 28.7), "New" beside its heading.
    expect(card).toMatch(/<div class="glass rounded-inner px-4 py-4 animate-move"><div>/);
    expect(card).not.toContain("glass-band");
    expect(card).toMatch(/Your next shift<\/h2><span class="[^"]*">New<\/span>/);
    // It's later: its row under Later.
    const later = render({ shifts: [first, second], newShiftId: second.shiftId });
    expect([marked(later), news(later)]).toEqual([1, 1]);
    const rows = later.slice(later.indexOf('id="later-heading"'));
    expect(rows).toMatch(/<li class="px-3\.5 animate-move rounded-xl border-2 border-brand-ink">/);
    // Not one of hers (or none given): nothing marked.
    for (const html of [
      render({ shifts: [first, second] }),
      render({ shifts: [first, second], newShiftId: "s-not-hers" }),
    ]) {
      expect([marked(html), news(html)]).toEqual([0, 0]);
    }
  });
});
