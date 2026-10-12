import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeView, type HomeViewProps } from "@/app/home-view";
import { BookedView, type BookedViewProps } from "@/app/shifts/booked-view";
import { TabBar } from "@/app/tab-bar";
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
  area: { maxMinutes: 45 },
  further: { count: 0, atLeast: false },
  choices: { days: [], sites: [], roles: [] },
};
const homeBase: HomeViewProps = {
  firstName: "Sam",
  voice: { name: "Acme Events", signOff: "Acme Events Shift Team" },
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
    expect(text(html)).toContain("Updated 09:00 on Mon 2 Nov");
    expect(text(html)).toContain("No shifts booked yet.");
    expect(html).toContain('href="/shifts/open"');
    expect(text(html)).toContain("See all open shifts");
    expect(text(html)).toContain(
      "Nothing else open right now. We'll message you when something matches.",
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
    expect(words).toContain("Your next shift");
    expect(words).toContain("Sat 7 Nov, 14:00 to 22:00");
    expect(words).toContain("Door supervisor");
    expect(words).toContain("Demo Arena");
    expect(words).toContain("1 Test Road, Leeds, LS1 1AA");
    expect(html).toContain(
      'href="https://www.google.com/maps/search/?api=1&amp;query=Demo%20Arena',
    );
    expect(words).toContain("Open in maps");
    expect(words).toContain("Instructions");
    expect(words).toContain("Report to Gate C at 13:30.");
    expect(words).toContain("Coming up");
    expect(words).toContain("Sat 14 Nov, 09:00 to 17:00");
    expect(words).toContain("Steward at Demo Racecourse");
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
    expect(text(html)).not.toContain("Cancel this shift");
  });

  it("offers Cancel this shift on every upcoming booking that hasn't started", () => {
    const html = render({
      shifts: [
        shift({ startsAt: at("2026-11-07T14:00:00Z"), endsAt: at("2026-11-07T22:00:00Z") }),
        shift({ startsAt: at("2026-11-08T14:00:00Z"), endsAt: at("2026-11-08T22:00:00Z") }),
      ],
    });
    expect(html.match(/>Cancel this shift</g)).toHaveLength(2);
    // And "Ask for a change" (a time change or swap request) for each.
    expect(html.match(/href="\/requests\/new\?shift=[^"]+"[^>]*>Ask for a change</g)).toHaveLength(
      2,
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

  it("the tab bar: Home, Shifts, Pay, Profile, the current one marked, a dot on Profile when needed", () => {
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
      expect(html).toContain('aria-label="Main"');
      expect(html).not.toContain("data-profile-dot");
    }
    const dotted = renderToStaticMarkup(
      createElement(TabBar, { current: "home", profileDot: true }),
    );
    expect(dotted).toContain("data-profile-dot");
    expect(text(dotted)).toContain("Profile , something needs updating");
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

  it("'Needs updating' on Home: one row per qualification, the one stopping a booked shift first (12F.1)", () => {
    const html = home({ needs: EVERY_LEVEL });
    const words = text(html);
    expect(words).toContain("Needs updating");
    const card = html.slice(html.indexOf('aria-labelledby="needs-heading"'));
    const section = card.slice(0, card.indexOf("</section>"));
    const items = [...section.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1] ?? "");
    const rows = items.map((inner) =>
      inner
        .replace(/<[^>]+>/g, "")
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim(),
    );
    // A row she can sort herself ends "Upload it" (12F.2): not a suspension (an upload can't lift
    // it), not one the office records (CSAS).
    expect(rows).toEqual([
      "SIA door supervisor licence expires on 5 Nov, and your door supervisor shift on Fri 6 Nov needs it. Upload the new one, or contact the office. Upload it",
      "SIA close protection licence is suspended. Contact the office.",
      "First aid at work certificate expired on 1 Oct. Until it's renewed you won't see response team lead shifts. Upload it",
      "SIA security guard licence expires on 25 Nov. Renew it to keep getting security officer shifts. Upload it",
      "CSAS accreditation is missing. Needed for CSAS officer and steward shifts.",
    ]);
    const links = items.map((inner) => /href="([^"]+)"/.exec(inner)?.[1] ?? null);
    expect(links).toEqual([
      "/profile/upload/SIA_DS",
      null,
      "/profile/upload/FIRST_AID",
      "/profile/upload/SIA_SG",
      null,
    ]);
    expect(html).toContain('aria-label="Upload your first aid at work certificate"');
    expect(html).toContain('href="/profile"');
    expect(words).toContain("See your qualifications");
    // Something that stops her working: red; otherwise amber. Nothing to update: no card.
    expect(html).toMatch(/aria-labelledby="needs-heading"[^>]*border-urgent/);
    expect(home({ needs: EVERY_LEVEL.slice(3) })).toMatch(
      /aria-labelledby="needs-heading"[^>]*border-attention/,
    );
    expect(text(home({}))).not.toContain("Needs updating");
  });

  it("'Needs updating' shows her photo when it's overdue or due soon, at its level, with one action", () => {
    const photo = (status: "overdue" | "due_soon" | "up_to_date" | "missing" | "waiting") => ({
      status,
      current: { id: "p1", uploadedOn: "2023-11-20", renewBy: "2026-11-20" },
      waiting: null,
    });
    const rowsOf = (html: string) => {
      const card = html.slice(html.indexOf('aria-labelledby="needs-heading"'));
      const section = card.slice(0, card.indexOf("</section>"));
      return [...section.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => text(m[1] ?? "").trim());
    };
    // Due soon (level 3): after the level-3 qualification, before the missing one (level 4).
    const due = home({ needs: EVERY_LEVEL.slice(3), photo: photo("due_soon") });
    expect(rowsOf(due)).toEqual([
      "SIA security guard licence expires on 25 Nov. Renew it to keep getting security officer shifts. Upload it",
      "Your staff photo is due soon. Last uploaded 20 Nov 2023 · renew by 20 Nov. Take a new photo",
      "CSAS accreditation is missing. Needed for CSAS officer and steward shifts.",
    ]);
    expect(due).toContain('href="/profile#photo-heading"');
    expect(due).toMatch(/aria-labelledby="needs-heading"[^>]*border-attention/);
    // Overdue (level 2): red, before a level-3 row.
    const overdue = home({ needs: EVERY_LEVEL.slice(3, 4), photo: photo("overdue") });
    expect(rowsOf(overdue)[0]).toMatch(/^Your staff photo is overdue\. Last uploaded 20 Nov 2023/);
    expect(overdue).toMatch(/aria-labelledby="needs-heading"[^>]*border-urgent/);
    // Up to date, missing or waiting for the office: nothing to do on Home.
    for (const status of ["up_to_date", "missing", "waiting"] as const) {
      expect(text(home({ photo: photo(status) }))).not.toContain("Needs updating");
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
  payRatePence: 1260,
  post: "Gate B",
  ...o,
});

describe("Home: what she can take, and her next shift in full", () => {
  it("lists urgent shifts she can take, then the top 3 others, each with its facts and a link", () => {
    const shifts = [
      open({ shiftId: "u1", isUrgent: true }),
      open({ shiftId: "a1" }),
      open({ shiftId: "a2", eventName: null, post: null, payRatePence: null }),
      open({ shiftId: "a3" }),
      open({ shiftId: "a4" }),
    ];
    const html = home({ open: { ...noOpen, shifts, further: { count: 2, atLeast: false } } });
    const words = text(html);
    expect(words).toContain("Urgent: needed now, and you can take them");
    const urgent = html.slice(html.indexOf('aria-labelledby="urgent-heading"'));
    expect(text(urgent.slice(0, urgent.indexOf("</section>")))).toContain(
      "Steward · Raceday Riverside Arena Sat 7 Nov, 09:30 to 17:30 · £12.60/hour · Gate B 2 places left",
    );
    expect(urgent).toContain('href="/urgent"');
    expect(html).toContain('href="/shifts/u1"');
    // The top 3 of the rest: a1, a2, a3 (not the urgent one again, not a4).
    const apply = html.slice(html.indexOf('aria-labelledby="apply-heading"'));
    const links = [...apply.matchAll(/href="\/shifts\/([a-z]\d)"/g)].map((m) => m[1]);
    expect(links).toEqual(["a1", "a2", "a3"]);
    expect(text(apply)).toContain(
      "Only shifts your licences and hours allow, up to 45 minutes from your home area.",
    );
    expect(text(apply)).toContain(
      "Steward Riverside Arena Sat 7 Nov, 09:30 to 17:30 2 places left",
    );
    expect(text(apply)).toContain("2 more shifts are further than you travel. Change how far");
    expect(apply).toContain('href="/profile/travel"');
    expect(words).toContain("See all open shifts");
    expect(html.match(/data-travel-line/g)?.length).toBe(4);
  });

  it("with no home area: the prompt to add one instead of the limit", () => {
    const html = home({ open: { ...noOpen, area: null, shifts: [open({ shiftId: "a1" })] } });
    expect(text(html)).toContain("Add your home area to see how far each shift is");
    expect(text(html)).not.toContain("Only shifts your licences");
  });

  it("shows her next shift in full: role · event, site and address, post, pay, report to, uniform, getting there, actions", () => {
    const next = shift({
      startsAt: at("2026-11-07T14:00:00Z"),
      endsAt: at("2026-11-07T22:00:00Z"),
      role: "steward",
      eventName: "Raceday",
      post: "Gate B",
      payRatePence: 1260,
      meetingPoint: "Staff entrance, Gate B",
      uniform: "Black trousers, boots. Hi-vis provided.",
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
    const words = text(card.slice(0, card.indexOf("</section>")));
    expect(words).toContain("Your next shift Sat 7 Nov, 14:00 to 22:00 Steward · Raceday");
    expect(words).toContain("Demo Arena 1 Test Road, Leeds, LS1 1AA");
    expect(words).toContain("Post Gate B");
    expect(words).toContain("Pay £12.60 an hour, about £100.80");
    expect(words).toContain("Report to Staff entrance, Gate B");
    expect(words).toContain("Bring and wear Black trousers, boots. Hi-vis provided.");
    expect(words).toMatch(/Getting there \S+/);
    expect(words).toContain("Open in maps");
    expect(words).toContain("Ask for a change");
    expect(words).toContain("Cancel this shift");
    expect(words).toContain("Ask for the steward lead.");
    expect(words).not.toContain("No shifts booked yet.");
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
      open: {
        ...noOpen,
        shifts: [open({ shiftId: "u1", isUrgent: true }), open({ shiftId: "a1" })],
      },
    });
    const lists = [...html.matchAll(/<ul\b[^>]*>/g)].map((m) => m[0]);
    expect(lists.length).toBeGreaterThanOrEqual(3);
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
    const row = html.slice(html.indexOf("Sun 8 Nov"), html.indexOf("Mon 9 Nov"));
    expect(text(row)).toContain("2 Test Lane, York, YO1 1AA");
    expect(text(row)).toContain("Open in maps");
    expect(text(row)).toContain("Report to Gate C.");
    expect(text(html.slice(html.indexOf("Mon 9 Nov")))).toContain("No site or instructions yet.");
  });
});
