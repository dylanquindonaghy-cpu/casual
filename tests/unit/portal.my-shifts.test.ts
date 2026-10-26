import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeView, type HomeViewProps } from "@/app/home-view";
import { BookedView, type BookedViewProps } from "@/app/shifts/booked-view";
import { TabBar } from "@/app/tab-bar";
import { staffBtn, switchTrack } from "@/app/ui/classes";
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
  firmName: "Acme Events",
  // The Friday after the week of Mon 2 Nov (D8).
  payDay: "2026-11-13",
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

describe("Home and Booked: the empty pages", () => {
  it("Home greets her, and says so plainly when nothing is booked, with a way to open shifts", () => {
    const html = home({});
    // Phase 20: "Hi Sam", in the greeting's face (Geist medium since Phase 24; a serif before).
    expect(text(html)).toContain("Hi Sam");
    expect(html).toMatch(/<h1 class="font-greet text-4xl text-ink">Hi Sam<\/h1>/);
    expect(text(html)).toContain("Updated 09:00");
    // Phase 18: an empty pass, and the way to find a shift.
    expect(text(html)).toContain(
      "No shifts booked Take a shift and it shows up here as your pass, with the time and the gate. Find a shift",
    );
    // The main button: tinted glass in the firm's colour (Phase 24).
    expect(html).toMatch(
      /<a class="[^"]*(?<![\w-])glass-tint(?![\w-])[^"]*" href="\/shifts\/open">Find a shift<\/a>/,
    );
    expect(text(html)).toContain(
      "To apply for None right now We'll message you when something matches.",
    );
    expect(text(home({ open: { ...noOpen, offerAlerts: false } }))).toContain(
      "To apply for None right now Check back later.",
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
    expect(html).toMatch(/<h2 id="next-heading" class="text-lg[^"]*">Your next shift<\/h2>/);
    expect(words).toContain(
      "Acme Events In 5 days Saturday 7 November 14:00–22:00 Door supervisor",
    );
    expect(words).toContain("Demo Arena");
    expect(words).toContain("Demo Arena, 1 Test Road, Leeds, LS1 1AA");
    expect(html).toContain(
      'href="https://www.google.com/maps/search/?api=1&amp;query=Demo%20Arena',
    );
    expect(words).toContain("Open in maps");
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
    // Phase 18: "Can't make it?" opens the sheet that cancels it (on the pass, one of its three
    // buttons: Phase 20).
    expect(html.match(/>Can&#x27;t make it\?</g)).toHaveLength(2);
    // And "Ask for a change" (a time change or swap request) for each: in the pass's Details, and
    // side by side with it on a later row.
    expect(html.match(/href="\/requests\/new\?shift=[^"]+"[^>]*>Ask for a change</g)).toHaveLength(
      2,
    );
    expect(html.match(/<div class="mt-3 grid grid-cols-2 gap-2.5">/g)).toHaveLength(1);
    expect(html).toMatch(/<\/svg>Can&#x27;t make it\?<\/button>/);
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

  it("the tab bar: Home, Shifts, Pay, Profile, the current one marked, a count on Profile when needed", () => {
    for (const current of ["home", "shifts", "pay", "profile"] as const) {
      const html = renderToStaticMarkup(createElement(TabBar, { current }));
      const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)];
      expect(links.map((m) => [m[1], text(m[2] ?? "").trim()])).toEqual([
        ["/", "Home"],
        ["/shifts", "Shifts"],
        ["/pay", "Pay"],
        ["/profile", "Profile"],
      ]);
      const marked = links.filter((m) => m[0].includes('aria-current="page"')).map((m) => m[1]);
      expect(marked).toEqual([
        { home: "/", shifts: "/shifts", pay: "/pay", profile: "/profile" }[current],
      ]);
      // Its icon on a pill filled in the firm's colour, its word bold (Phase 20): not colour alone.
      const here = links.find((m) => m[0].includes('aria-current="page"'))?.[0] ?? "";
      expect(here).toMatch(/<span class="[^"]*(?<![\w-])bg-brand text-on-brand(?![\w-])/);
      expect(here).toMatch(/class="[^"]*font-semibold text-ink/);
      expect(html.match(/bg-brand text-on-brand/g)).toHaveLength(1);
      // It floats over the page: floating glass (Phase 24; the bar depth token before), no line.
      expect(html).toMatch(/<nav aria-label="Main" class="glass-float fixed inset-x-0 bottom-0 /);
      expect(html).not.toMatch(/(?<![\w-])shadow-bar(?![\w-])/);
      expect(html).not.toContain("border-t");
      // The words at 15px.
      expect(html.match(/text-base/g)?.length).toBeGreaterThanOrEqual(4);
      expect(html).toContain('aria-label="Main"');
      expect(html).not.toContain("data-profile-count");
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
      return at < 0 ? null : html.slice(at, html.indexOf("</li>", at));
    };
    // Five things: how many, the one stopping a booked shift first (its whole sentence), Profile.
    const many = row(home({ needs: EVERY_LEVEL })) ?? "";
    expect(text(many)).toContain(
      "Needs doing now 5 things need doing SIA door supervisor licence expires on 5 Nov, and your door supervisor shift on Fri 6 Nov needs it. Upload the new one, or contact the office. And 4 more.",
    );
    expect(many).toMatch(/href="\/profile"/);
    // Something that stops her working: a pale red tile; otherwise the to-do yellow (Phase 20).
    expect(many).toContain("bg-urgent-tile text-urgent-ink");
    // One she can sort herself: straight to its upload.
    const one = row(home({ needs: EVERY_LEVEL.slice(3, 4) })) ?? "";
    expect(text(one)).toContain(
      "Needs doing Renew your SIA security guard licence SIA security guard licence expires on 25 Nov. Renew it to keep getting security officer shifts.",
    );
    expect(one).toContain('href="/profile/upload/SIA_SG"');
    expect(one).toContain("bg-hivis text-on-hivis");
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
      return at < 0 ? null : text(html.slice(at, html.indexOf("</li>", at)));
    };
    const due = home({ photo: photo("due_soon") });
    expect(row(due)).toContain(
      "Needs doing Renew your staff photo Due by 20 Nov. Take a new photo.",
    );
    expect(due).toContain('href="/profile#photo-heading"');
    // Due soon (level 3) comes after a level-3 qualification, before a missing one.
    expect(row(home({ needs: EVERY_LEVEL.slice(3), photo: photo("due_soon") }))).toContain(
      "3 things need doing SIA security guard licence expires on 25 Nov.",
    );
    // Overdue (level 2): first, red.
    const overdue = home({ needs: EVERY_LEVEL.slice(3, 4), photo: photo("overdue") });
    expect(row(overdue)).toContain(
      "Needs doing now 2 things need doing It was due by 20 Nov. Take a new photo. And 1 more.",
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
  it("For you: the urgent shifts she can take, then the others she can apply for, then pay day, each one tile", () => {
    const shifts = [
      open({ shiftId: "u1", isUrgent: true, payRatePence: 1550 }),
      open({ shiftId: "u2", isUrgent: true, startsAt: at("2026-11-08T09:30:00Z") }),
      open({ shiftId: "a1" }),
      open({ shiftId: "a2", eventName: null, casualEvent: null, post: null, payRatePence: null }),
      open({ shiftId: "a3", startsAt: at("2026-11-10T09:30:00Z") }),
    ];
    const html = home({ open: { ...noOpen, shifts, further: { count: 2, atLeast: false } } });
    const section = html.slice(html.indexOf('aria-labelledby="for-you-heading"'));
    expect(section).toContain('<h2 id="for-you-heading"');
    const rowsOf = [...section.matchAll(/<li [^>]*data-for-you="([a-z]+)"[^>]*>(.*?)<\/li>/g)].map(
      (m) => [m[1], text(m[2] ?? "").trim()],
    );
    expect(rowsOf).toEqual([
      ["urgent", "Urgent near you 2 shifts Sat 7 and Sun 8 Nov, up to £15.50 an hour"],
      [
        "offline",
        "Open shifts Need signal 2 were urgent at 09:00 on Mon 2 Nov. We'll check again when you're online.",
      ],
      ["apply", "More to apply for 3 shifts Sat 7 and Tue 10 Nov"],
      ["pay", "Pay day Fri 13 Nov For this week's shifts"],
    ]);
    expect(section).toMatch(
      /<li data-online-only="" data-for-you="urgent"><a class="[^"]*" href="\/urgent"/,
    );
    expect(section).toMatch(/<li data-offline-only="" data-for-you="offline">/);
    expect(section).toMatch(
      /<li data-online-only="" data-for-you="apply"><a class="[^"]*" href="\/shifts\/open"/,
    );
    // Tiles two to a row (Phase 20), each in the colour of what it is, lifted off the page.
    expect(section).toContain('<ul role="list" class="grid grid-cols-2 gap-2.5">');
    const tone = (kind: string) =>
      new RegExp(`data-for-you="${kind}"><(?:a|div) class="([^"]*)"`).exec(section)?.[1] ?? "";
    expect(tone("urgent")).toContain("bg-urgent-tile text-urgent-ink");
    expect(tone("offline")).toContain("bg-raised text-ink");
    expect(tone("apply")).toContain("bg-wait-tile text-wait-ink");
    expect(tone("pay")).toContain("bg-done-tile text-done-ink");
    for (const kind of ["urgent", "offline", "apply", "pay"])
      expect(tone(kind)).toContain("shadow-lift");
    expect(section).toMatch(/<li data-for-you="pay"><a class="[^"]*" href="\/pay"/);
    // No shift's own travel line on Home: that's on each shift.
    expect(html).not.toContain("data-travel-line");
  });
  it("with no home area: a tile to add one, in the waiting blue", () => {
    const html = home({ open: { ...noOpen, area: null, shifts: [open({ shiftId: "a1" })] } });
    const at = html.indexOf('data-for-you="area"');
    expect(text(html.slice(at, html.indexOf("</li>", at)))).toContain(
      "Your home area Add your home area Add your home area to see how far each shift is",
    );
    expect(html.slice(at, html.indexOf("</li>", at))).toMatch(
      /^data-for-you="area"><a class="[^"]*shadow-lift bg-wait-tile text-wait-ink[^"]*"/,
    );
    expect(html.slice(at)).toContain('href="/profile/travel"');
    expect(text(home({ open: { ...noOpen, shifts: [open({ shiftId: "a1" })] } }))).not.toContain(
      "Add your home area",
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
    // Phase 20: the pass is a card in the firm's colour, lifted off the page; its heading is for
    // screen readers (the pass speaks for itself).
    expect(pass).toMatch(
      /^aria-labelledby="next-heading" data-pass="" class="flex flex-col gap-3">/,
    );
    expect(pass).toContain('<h2 id="next-heading" class="sr-only">Your next shift</h2>');
    const band =
      /<div class="[^"]*rounded-3xl bg-brand-bar[^"]*text-on-brand-bar shadow-pass[^"]*">([\s\S]*?)<\/div><div class="grid/.exec(
        pass,
      )?.[1] ?? "";
    // The firm and how soon; the date in words, the time large, the role and event; the gate on
    // a white plate, and the place.
    expect(text(band).trim()).toBe(
      "A Acme Events In 5 days Saturday 7 November 14:00–22:00 Steward, Raceday Gate B Demo Arena",
    );
    expect(band).toMatch(/<p class="font-sign text-4xl leading-tight">14:00–22:00<\/p>/);
    // The gate on a white plate (Phase 20), its words the band's colour (or ink on a pale band).
    expect(band).toMatch(/<span class="[^"]*bg-pass-plate[^"]*text-on-pass-plate">Gate B<\/span>/);
    expect(band).toMatch(/text-on-brand-bar-soft">In 5 days</);
    // No travel time on the pass itself: a drive alone would mislead someone without a car (12G.3).
    expect(text(band)).not.toContain("by car");
    // Under it, one tap each: Directions (the maps link), Details, Can't make it?.
    const buttons =
      /<div class="grid auto-cols-fr grid-flow-col gap-2">([\s\S]*?)<\/div><div id="pass-details"/.exec(
        pass,
      )?.[1] ?? "";
    expect(text(buttons).trim().replace(/\s+/g, " ")).toBe(
      "Directions Details Hide details Can't make it?",
    );
    expect(buttons).toMatch(
      /<a href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=Demo%20Arena[^"]*" target="_blank" rel="noopener noreferrer" class="[^"]*(?<![\w-])glass-button press-glass(?![\w-])[^"]*">/,
    );
    // Details is a <details> whose summary is the button: it opens without JavaScript, and the
    // card under the buttons shows while it's open (a :has() rule on the pass).
    expect(buttons).toMatch(
      /<details data-pass-more="" class="group"><summary aria-controls="pass-details" class="[^"]*"><svg[\s\S]*?<\/summary><\/details>/,
    );
    expect(buttons).toMatch(
      /<button type="button" disabled="" class="[^"]*text-urgent-ink[^"]*"><svg[\s\S]*?<\/svg>Can&#x27;t make it\?<\/button>/,
    );
    expect(pass).toMatch(
      /<div id="pass-details" class="[^"]*hidden animate-open \[\[data-pass\]:has\(\[data-pass-more\]\[open\]\)_&amp;\]:flex">/,
    );
    // The card: getting there as three figures, report to (with where), the uniform (what the firm
    // gives in hi-vis yellow), the pay, the instructions, then Open in maps and Ask for a change.
    const details = text(pass.slice(pass.indexOf('id="pass-details"'))).replace(/\s+/g, " ");
    expect(details).toContain(
      "Getting there, from your home area 3.1 miles · 12 min by car · 24 min by public transport 12 min by car 24 min by public transport 3.1 mi away",
    );
    expect(details).toContain(
      "Report to Staff entrance, Gate B Demo Arena, 1 Test Road, Leeds, LS1 1AA",
    );
    expect(details).toContain("Bring and wear Hi-vis tabard We provide it Black trousers");
    expect(pass).toMatch(/<span class="[^"]*bg-hivis[^"]*text-on-hivis">We provide it<\/span>/);
    expect(details).toContain(
      "Pay £12.60 an hour, about £100.80 £12.60 an hour About £100.80 for the 8 hours",
    );
    expect(details).toContain("Instructions Ask for the steward lead.");
    expect(pass).toMatch(
      new RegExp(
        `<a href="[^"]*" target="_blank" rel="noopener noreferrer" class="${staffBtn.primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`,
      ),
    );
    expect(details).toContain("Open in maps Ask for a change");
    expect(pass).toMatch(
      new RegExp(
        `<a class="${staffBtn.secondary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" href="/requests/new\\?shift=[^"]+">Ask for a change</a>`,
      ),
    );
    expect(text(html)).not.toContain("No shifts booked");
    // On now: the pass and its heading say so, and there's nothing to cancel or change.
    const onNow = home({ next, now: at("2026-11-07T15:00:00Z") });
    expect(onNow).toContain('<h2 id="next-heading" class="sr-only">On now</h2>');
    expect(text(onNow)).toContain("Acme Events On now Saturday 7 November");
    expect(onNow).not.toContain("Can&#x27;t make it?");
    expect(onNow).not.toContain("Ask for a change");
  });
  it("puts pay and the event into words", () => {
    expect(payWords(1260, at("2026-11-07T14:00:00Z"), at("2026-11-07T22:00:00Z"))).toBe(
      "£12.60 an hour, about £100.80",
    );
    expect(payWords(1155, at("2026-11-07T14:00:00Z"), at("2026-11-07T20:30:00Z"))).toBe(
      "£11.55 an hour, about £75.08",
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
    expect(text(row)).toContain("Open in maps");
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
    // The pass moves into its place (Phase 20: the pass itself), "New" beside its heading.
    expect(card).toMatch(/rounded-3xl bg-brand-bar[^"]*animate-move"/);
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
