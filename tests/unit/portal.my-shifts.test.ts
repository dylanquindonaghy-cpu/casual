import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MyShiftsView, type MyShiftsViewProps } from "@/app/my-shifts-view";
import { isOnNow, mapLink, roleLabel, shiftWhen, siteAddress } from "@/lib/portal/format";
import type { MyShift } from "@/lib/portal/my-shifts";
import { EVERY_LEVEL } from "../helpers/qualifications";

// My shifts (docs/screens.md, `/`): the display helpers, then the page body rendered to HTML with
// fake shifts, checked for what the screen spec promises. The "Cancel this shift" button uses
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

const base: MyShiftsViewProps = {
  firstName: "Sam",
  voice: { name: "Acme Events", signOff: "Acme Events Shift Team" },
  timeZone: TZ,
  now: at("2026-11-02T09:00:00Z"),
  view: "upcoming",
  shifts: [],
  needs: [],
};
const render = (props: Partial<MyShiftsViewProps>) =>
  renderToStaticMarkup(createElement(MyShiftsView, { ...base, ...props }));
// Visible text, roughly: tags out, entities decoded.
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("My shifts page body", () => {
  it("greets the worker, and says so plainly when nothing is booked, with a way to open shifts", () => {
    const html = render({});
    expect(text(html)).toContain("Hello Sam");
    expect(text(html)).toContain("No shifts booked yet.");
    expect(html).toContain('href="/shifts/open"');
    expect(text(html)).toContain("See open shifts");
    // The toggle: Upcoming is the current page.
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Upcoming<\/a>/);
    expect(html).toContain('href="/?view=past"');
  });

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

  it("ends with every other page, once each, in the spec's order, Help last (→ /help)", () => {
    const booked = shift({
      startsAt: at("2026-11-07T14:00:00Z"),
      endsAt: at("2026-11-07T22:00:00Z"),
    });
    const worked = shift({
      startsAt: at("2026-10-31T14:00:00Z"),
      endsAt: at("2026-10-31T22:00:00Z"),
      status: "completed",
    });
    const views = {
      empty: render({}),
      booked: render({ shifts: [booked] }),
      pastEmpty: render({ view: "past" }),
      past: render({ view: "past", shifts: [worked] }),
    };
    const pages = [
      ["/shifts/open", "See open shifts"],
      ["/requests", "My requests"],
      ["/pay", "See your pay"],
      ["/profile", "My profile"],
      ["/help", "Help"],
    ];
    for (const [view, html] of Object.entries(views)) {
      // The page links are the last list on the page.
      const bottom = html.slice(html.lastIndexOf("<ul"));
      const links = [...bottom.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
      expect(
        links.map((m) => [m[1], m[2]]),
        view,
      ).toEqual(pages);
      for (const [href] of pages)
        expect(html.split(`href="${href}"`), `${view} ${href}`).toHaveLength(2);
    }
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
      const lists = [...html.matchAll(/<ul\b[^>]*>/g)].map((m) => m[0]);
      expect(lists.length).toBeGreaterThanOrEqual(2);
      for (const tag of lists) expect(tag).toContain('role="list"');
    }
  });

  it("'Needs updating': one row per qualification, the one stopping a booked shift first (12F.1)", () => {
    const html = render({ needs: EVERY_LEVEL });
    const words = text(html);
    expect(words).toContain("Needs updating");
    const rows = [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((m) =>
      (m[1] ?? "").replace(/&#x27;|&#39;/g, "'"),
    );
    expect(rows).toEqual([
      "SIA door supervisor licence expires on 5 Nov, and your door supervisor shift on Fri 6 Nov needs it. Send the new details to the office, or contact them.",
      "SIA close protection licence is suspended. Contact the office.",
      "First aid at work certificate expired on 1 Oct. Until it's renewed you won't see response team lead shifts.",
      "SIA security guard licence expires on 25 Nov. Renew it to keep getting security officer shifts.",
      "CSAS accreditation is missing. Needed for CSAS officer and steward shifts.",
    ]);
    expect(html).toContain('href="/profile"');
    expect(words).toContain("See your qualifications");
    // Something that stops her working: red; otherwise amber. Nothing to update: no card.
    expect(html).toMatch(/aria-labelledby="needs-heading"[^>]*border-urgent/);
    expect(render({ needs: EVERY_LEVEL.slice(3) })).toMatch(
      /aria-labelledby="needs-heading"[^>]*border-attention/,
    );
    expect(text(render({}))).not.toContain("Needs updating");
  });
});

describe("My shifts: every upcoming shift's details", () => {
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
      createElement(MyShiftsView, { ...base, shifts: [next, sunday, bare] }),
    );
    const row = html.slice(html.indexOf("Sun 8 Nov"), html.indexOf("Mon 9 Nov"));
    expect(text(row)).toContain("2 Test Lane, York, YO1 1AA");
    expect(text(row)).toContain("Open in maps");
    expect(text(row)).toContain("Report to Gate C.");
    expect(text(html.slice(html.indexOf("Mon 9 Nov")))).toContain("No site or instructions yet.");
  });
});
