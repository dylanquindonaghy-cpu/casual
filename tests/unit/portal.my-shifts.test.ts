import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeView, type HomeViewProps } from "@/app/home-view";
import { BookedView, type BookedViewProps } from "@/app/shifts/booked-view";
import { TabBar } from "@/app/tab-bar";
import { staffBtn, staffBtnSmall, switchTrack, tapRow } from "@/app/ui/classes";
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
    expect(text(html)).toContain("Hello Sam");
    expect(text(html)).toContain("Updated 09:00");
    // Phase 18: an empty pass, and the way to find a shift.
    expect(text(html)).toContain(
      "No shifts booked Take a shift and it shows up here as your pass, with the time and the gate. Find a shift",
    );
    expect(html).toMatch(/<a class="[^"]*bg-brand[^"]*" href="\/shifts\/open">Find a shift<\/a>/);
    expect(text(html)).toContain(
      "No open shifts right now We'll message you when something matches.",
    );
    expect(text(home({ open: { ...noOpen, offerAlerts: false } }))).toContain(
      "No open shifts right now Check back later.",
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
    // A hairline card, like Home's (Phase 17), with its date tile and the time in sign figures
    // (Phase 18).
    expect(html).toMatch(
      /<section aria-labelledby="next-heading" class="mt-6 rounded-2xl bg-card p-4 border border-line">/,
    );
    expect(words).toContain("Your next shift");
    expect(html).toContain('role="img" aria-label="Saturday 7 November"');
    expect(words).toContain("Sat 7 Nov 14:00–22:00 Door supervisor");
    expect(words).toContain("Demo Arena");
    expect(words).toContain("1 Test Road, Leeds, LS1 1AA");
    expect(html).toContain(
      'href="https://www.google.com/maps/search/?api=1&amp;query=Demo%20Arena',
    );
    expect(words).toContain("Open in maps");
    expect(words).toContain("Instructions");
    expect(words).toContain("Report to Gate C at 13:30.");
    expect(words).toContain("Coming up");
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
    // Phase 18: "Can't make it?" opens the sheet that cancels it.
    expect(html.match(/>Can&#x27;t make it\?</g)).toHaveLength(2);
    // And "Ask for a change" (a time change or swap request) for each, side by side with it.
    expect(html.match(/href="\/requests\/new\?shift=[^"]+"[^>]*>Ask for a change</g)).toHaveLength(
      2,
    );
    expect(html.match(/<div class="mt-3 grid grid-cols-2 gap-2.5">/g)).toHaveLength(2);
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
      // Its icon on a pill of the firm's pale tint, its word bold in the firm's colour (Phase 18):
      // not colour alone.
      const here = links.find((m) => m[0].includes('aria-current="page"'))?.[0] ?? "";
      expect(here).toMatch(/<span class="[^"]*(?<![\w-])bg-brand-soft(?![\w-])/);
      expect(here).toMatch(/class="[^"]*font-semibold text-brand-ink/);
      expect(html.match(/bg-brand-soft/g)).toHaveLength(1);
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
  it("names the later list 'Coming up', with its count beside the heading, not in it", () => {
    const html = render({
      shifts: [
        shift({ startsAt: at("2026-11-07T14:00:00Z"), endsAt: at("2026-11-07T22:00:00Z") }),
        shift({ startsAt: at("2026-11-08T14:00:00Z"), endsAt: at("2026-11-08T22:00:00Z") }),
        shift({ startsAt: at("2026-11-09T14:00:00Z"), endsAt: at("2026-11-09T22:00:00Z") }),
      ],
    });
    // The section is named by the heading's words alone; the 2 sits right after the </h2>.
    expect(html).toContain('aria-labelledby="later-heading"');
    expect(html).toMatch(/<h2 id="later-heading"[^>]*>Coming up<\/h2><span[^>]*>2<\/span>/);
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
    // Something that stops her working: a red tile; otherwise sign yellow.
    expect(many).toContain("bg-urgent-fill");
    // One she can sort herself: straight to its upload.
    const one = row(home({ needs: EVERY_LEVEL.slice(3, 4) })) ?? "";
    expect(text(one)).toContain(
      "Needs doing Renew your SIA security guard licence SIA security guard licence expires on 25 Nov. Renew it to keep getting security officer shifts.",
    );
    expect(one).toContain('href="/profile/upload/SIA_SG"');
    expect(one).toContain("bg-hivis");
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
  it("For you: the urgent shifts she can take, then the others she can apply for, each one row", () => {
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
      ["urgent", "Urgent 2 shifts you can take Sat 7 and Sun 8 Nov, up to £15.50 an hour"],
      [
        "offline",
        "Open shifts need signal 2 were urgent at 09:00 on Mon 2 Nov. We'll check again when you're online.",
      ],
      ["apply", "3 more shifts you can apply for Sat 7 and Tue 10 Nov"],
    ]);
    expect(section).toMatch(
      /<li data-online-only="" data-for-you="urgent"><a class="[^"]*" href="\/urgent"/,
    );
    expect(section).toMatch(/<li data-offline-only="" data-for-you="offline">/);
    expect(section).toMatch(
      /<li data-online-only="" data-for-you="apply"><a class="[^"]*" href="\/shifts\/open"/,
    );
    // One card of rows (Phase 17), each a big tap target with its tile.
    expect(section).toContain(
      '<ul role="list" class="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">',
    );
    expect(
      section.match(new RegExp(tapRow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")),
    ).toHaveLength(2);
    // No shift's own travel line on Home: that's on each shift.
    expect(html).not.toContain("data-travel-line");
  });
  it("with no home area: a row to add one", () => {
    const html = home({ open: { ...noOpen, area: null, shifts: [open({ shiftId: "a1" })] } });
    const at = html.indexOf('data-for-you="area"');
    expect(text(html.slice(at, html.indexOf("</li>", at)))).toContain(
      "Add your home area Add your home area to see how far each shift is",
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
    // The pass: the band, then when, what and where, closed; a <details> (no JavaScript needed).
    expect(pass).toMatch(
      /^aria-labelledby="next-heading" data-pass="" class="overflow-hidden rounded-2xl border border-line bg-card shadow-pass">/,
    );
    const summary = pass.slice(pass.indexOf("<summary"), pass.indexOf("</summary>"));
    expect(summary).toContain(
      'aria-label="Steward, Saturday 7 November, 14:00 to 22:00, Raceday, Gate B. Details"',
    );
    expect(text(pass.slice(0, pass.indexOf("<details")))).toContain("Your next shift In 5 days");
    expect(text(summary)).toContain("Sat 7 Nov 14:00–22:00 Steward");
    // Closed, no travel time: a drive alone would mislead someone without a car (12G.3).
    expect(text(summary)).toContain("Raceday Demo Arena Gate B Details Hide details");
    expect(text(summary)).not.toContain("by car");
    // Opened: the address, getting there as three figures, report to, the uniform as tiles (hi-vis
    // first), the pay, the instructions, then the actions.
    const details = text(pass.slice(pass.indexOf("</summary>")));
    expect(details).toContain("Gate B Raceday 1 Test Road, Leeds, LS1 1AA");
    expect(details).toContain("3.1 miles · 12 min by car · 24 min by public transport");
    expect(details).toContain("12 min by car 24 min by public transport 3.1 mi away");
    expect(details).toContain("Report to Staff entrance, Gate B");
    expect(details).toContain("Bring and wear Hi-vis tabard We provide it Black trousers");
    expect(pass).toMatch(/<li class="[^"]*col-span-2 bg-hivis text-on-hivis">/);
    expect(details).toContain("Pay £12.60 an hour, about £100.80");
    expect(details).toContain("Instructions Ask for the steward lead.");
    expect(pass).toMatch(/class="[^"]*">.*Open in maps<\/a>/);
    expect(pass).toContain(`class="${staffBtn.primary}"`);
    const pair =
      /<div class="grid grid-cols-2 gap-2.5">(.*?)<\/div><\/div><\/div><\/details>/.exec(
        pass,
      )?.[1] ?? "";
    expect(pair).toMatch(
      new RegExp(
        `<a class="${staffBtnSmall.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" href="/requests/new\\?shift=[^"]+">Ask for a change</a>`,
      ),
    );
    expect(pair).toMatch(
      /<button type="button" disabled="" class="[^"]*text-urgent-ink">Can&#x27;t make it\?<\/button>/,
    );
    expect(text(html)).not.toContain("No shifts booked");
    // On now: the band says so, and there's nothing to cancel.
    const onNow = home({ next, now: at("2026-11-07T15:00:00Z") });
    expect(text(onNow)).toContain("On now On now");
    expect(onNow).not.toContain("Can&#x27;t make it?");
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
