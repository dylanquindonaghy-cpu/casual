import { describe, expect, it } from "vitest";
import {
  cancellationLine,
  eventLine,
  eventTabHref,
  initialsOf,
  offerBestButton,
  offerOpenPlacesButton,
  offerOpenResultText,
  openPlacesLine,
  openTimes,
  openTitle,
  roleLine,
  rolePlural,
  shortName,
  startsInWords,
  tileLabel,
  whyOpen,
} from "@/lib/office/event-page-copy";
import type { OpenPlace } from "@/lib/office/event-staffing";

// An event's page, round 8, in words (Phase 26.5; the spec page's evt-1 to evt-6 and aud-5). NOW is
// Monday 2 November 2026, 09:00 London (GMT).

const TZ = "Europe/London";
const NOW = new Date("2026-11-02T09:00:00Z");
const at = (iso: string) => new Date(iso);

const open = (o: Partial<OpenPlace> = {}): OpenPlace => ({
  shiftId: "s1",
  role: "door_supervisor",
  startsAt: at("2026-11-07T08:00:00Z"),
  endsAt: at("2026-11-07T16:00:00Z"),
  placesFree: 1,
  urgent: true,
  showing: true,
  offers: 0,
  offering: false,
  requirements: ["SIA door supervisor licence"],
  lastCancel: null,
  ...o,
});

describe("the head and the tabs", () => {
  it("the day, the venue's town and postcode, and how many sessions", () => {
    const venue = { name: "Acme Demo Arena", town: "Exampleton", postcode: "ZZ1 1AA" };
    const sat = at("2026-11-07T08:00:00Z");
    expect(eventLine(sat, sat, venue, 23, TZ)).toBe(
      "Sat 7 Nov · Exampleton, ZZ1 1AA · 23 sessions",
    );
    expect(eventLine(sat, at("2026-11-08T10:00:00Z"), null, 1, TZ)).toBe(
      "Sat 7 Nov to Sun 8 Nov · 1 session",
    );
    // No town or postcode yet: its name.
    expect(eventLine(sat, sat, { ...venue, town: null, postcode: null }, 2, TZ)).toBe(
      "Sat 7 Nov · Acme Demo Arena · 2 sessions",
    );
    expect(offerOpenPlacesButton(5)).toBe("Offer 5 open places");
    expect(offerOpenPlacesButton(1)).toBe("Offer 1 open place");
    expect(eventTabHref("e1", "staffing")).toBe("/office/events/e1");
    expect(eventTabHref("e1", "history")).toBe("/office/events/e1?tab=history");
  });

  it("Offer N open places: what came of it", () => {
    expect(offerOpenResultText({ status: "offered", sessions: 3, hidden: 0 })).toBe(
      "Offers are going out for 3 sessions.",
    );
    expect(offerOpenResultText({ status: "offered", sessions: 1, hidden: 1 })).toBe(
      "Offers are going out for 1 session. 1 session is hidden from casuals: no offers go out while hidden.",
    );
    expect(offerOpenResultText({ status: "none" })).toBe(
      "Every open place is already being offered.",
    );
  });
});

describe("the staffing layout", () => {
  it("roles, names and each place's words to a screen reader (each different: aud-5)", () => {
    expect(rolePlural("door_supervisor")).toBe("Door supervisors");
    expect(
      roleLine(
        {
          role: "door_supervisor",
          booked: 7,
          needed: 9,
          requirements: ["SIA door supervisor licence"],
          starts: [at("2026-11-07T08:00:00Z"), at("2026-11-07T11:30:00Z")],
        },
        TZ,
      ),
    ).toBe("SIA door supervisor licence · 08:00 and 11:30");
    expect(shortName("Amira Zaidi")).toBe("Amira Z.");
    expect(shortName("Cher")).toBe("Cher");
    expect(initialsOf("Amira Zaidi")).toBe("AZ");
    const s = {
      role: "steward",
      startsAt: at("2026-11-07T12:00:00Z"),
      endsAt: at("2026-11-07T18:30:00Z"),
    };
    expect(tileLabel({ slot: 3, state: "open", worker: null }, s, TZ)).toBe(
      "Open place: Steward, 12:00 to 18:30, place 3",
    );
    expect(tileLabel({ slot: 1, state: "urgent", worker: null }, s, TZ)).toBe(
      "Urgent open place: Steward, 12:00 to 18:30, place 1",
    );
    expect(tileLabel({ slot: 2, state: "booked", worker: { name: "Priya Shah" } }, s, TZ)).toBe(
      "Priya Shah: Steward, 12:00 to 18:30, place 2. Open the session",
    );
  });
});

describe("open places", () => {
  it("each one's title, times, when it starts, and the panel's count", () => {
    expect(openTitle(open())).toBe("Door supervisor");
    expect(openTitle(open({ role: "steward", placesFree: 3 }))).toBe("Steward × 3");
    expect(openTimes(open(), TZ)).toBe("Sat 7 Nov, 08:00–16:00 · 8 h");
    expect(openTimes(open({ endsAt: at("2026-11-07T15:30:00Z") }), TZ)).toBe(
      "Sat 7 Nov, 08:00–15:30 · 7.5 h",
    );
    expect(startsInWords(at("2026-11-07T08:00:00Z"), NOW)).toBe("4 days");
    expect(startsInWords(at("2026-11-03T05:00:00Z"), NOW)).toBe("20 h");
    expect(startsInWords(at("2026-11-02T09:45:00Z"), NOW)).toBe("45 min");
    expect(openPlacesLine([open(), open({ urgent: false, placesFree: 3 })])).toBe(
      "4 open · 1 urgent",
    );
    expect(offerBestButton(5)).toBe("Offer to the best 5");
    expect(offerBestButton(null)).toBe("Offer to the best people");
  });

  it("why it's open: who cancelled, when, the notice and the strike", () => {
    const c = {
      worker: "Chloe Quigley",
      at: at("2026-11-02T04:00:00Z"),
      noticeHours: 124,
      byCasual: true,
      strike: null,
    };
    expect(whyOpen(c, TZ)).toBe(
      "Chloe Quigley cancelled this place at 04:00 on Mon 2 Nov, with 5 days' notice. No strike.",
    );
    expect(whyOpen({ ...c, noticeHours: 10, strike: "live" }, TZ)).toMatch(/ Strike issued\.$/);
    expect(whyOpen({ ...c, byCasual: false }, TZ)).toBe(
      "The office cancelled Chloe Quigley's booking at 04:00 on Mon 2 Nov.",
    );
    expect(cancellationLine({ worker: "Mo Rahman", byCasual: true, noticeHours: 9 })).toBe(
      "Mo Rahman cancelled · 9 hours' notice",
    );
  });
});

// The Interested tab's words (Phase 26.6, evt-2): its link to choose, and the empty line, which
// says how casuals come to ask on an event that lets them, and how to let them on one that doesn't.
// Phase 36.1: the switch is on the tab itself now (it was only on each session's page, and the empty
// line sent the office there), so the line points at the switch above it, and the switch's own words
// say what Off and On mean.
describe("the Interested tab's words", () => {
  it("Choose who works it, and nothing asked yet either way", async () => {
    const { CHOOSE_WHO, noInterestText } = await import("@/lib/office/event-page-copy");
    expect(CHOOSE_WHO).toBe("Choose who works it");
    expect(noInterestText(true)).toBe(
      'No one has asked yet. Casuals see "I can do this" on this event\'s sessions, and the ones who ask show here.',
    );
    expect(noInterestText(false)).toBe(
      'No one has asked yet. Switch it on and the casuals who ask show here, with "Choose who works it" for each session.',
    );
    // Nothing sends the office to a session's page for the switch any more.
    expect(noInterestText(false)).not.toMatch(/session's page/);
  });

  it("the switch: its title, what Off and On mean, and its word", async () => {
    const { CASUALS_ASK_EVENT_LINE, switchWord } = await import("@/lib/office/event-page-copy");
    const { CASUALS_ASK } = await import("@/lib/office/session-page-copy");
    expect(CASUALS_ASK).toBe("Casuals ask, you choose");
    expect(CASUALS_ASK_EVENT_LINE).toBe(
      'Off: casuals take places on this event straight away. On: they tap "I can do this" and you choose who works each session, here and on each session\'s page.',
    );
    expect([switchWord(true), switchWord(false)]).toEqual(["On", "Off"]);
  });
});
