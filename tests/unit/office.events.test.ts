import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EventCardData, SessionRow } from "@/lib/office/events";
import {
  eventDateText,
  eventStatus,
  eventSummary,
  eventSwitchLabel,
  eventWhereWhen,
  requirementChip,
  SHEET_SESSION_WORDS,
  sessionDetails,
  sessionShowingText,
  sessionSwitchLabels,
} from "@/lib/office/events-copy";

// Events & sessions (12B.5; docs/office-v2.md 3.3; Phase 24, 24.4: round 7's event cards, Phase
// 18's rota board until then): an event's words, its card (its switch and answer, its tags, its
// sessions as tiles, the filled ones folded, its page), each session's unique switch label, and a
// session row (the event's own page) with every field, rendered. The switches and buttons use
// Next's router, so a stand-in is given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { EventCard } = await import("@/app/office/events/event-card");
const { SessionItem } = await import("@/app/office/events/session-row");

const card = (e: EventCardData) =>
  renderToStaticMarkup(createElement(EventCard, { event: e, timeZone: TZ }));

const TZ = "Europe/London";
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Saturday 7 November 2026 (GMT, so London times are UTC).
const at = (hhmm: string, day = "2026-11-07") => new Date(`${day}T${hhmm}:00Z`);

const session = (o: Partial<SessionRow> = {}): SessionRow => ({
  shiftId: "11111111-1111-4111-8111-111111111111",
  role: "door_supervisor",
  startsAt: at("08:00"),
  endsAt: at("16:00"),
  status: "open",
  headcount: 4,
  booked: 3,
  isUrgent: true,
  urgentGap: true,
  showing: true,
  payRatePence: 1550,
  post: "Gate A",
  meetingPoint: "Main gate",
  uniform: "Black trousers, boots",
  requirements: [
    { code: "SIA_DS", name: "SIA door supervisor licence" },
    { code: "CSAS", name: "CSAS accreditation" },
    { code: "FIRST_AID", name: "first aid at work certificate" },
  ],
  fromSheet: false,
  fromPlanner: false,
  started: false,
  ended: false,
  ...o,
});

const event = (o: Partial<EventCardData> = {}): EventCardData => ({
  eventId: "22222222-2222-4222-8222-222222222222",
  name: "Northern Lights Live",
  place: "Acme Demo Arena",
  firstStartsAt: at("08:00"),
  lastStartsAt: at("10:00"),
  showing: true,
  sessions: [
    session(),
    session({
      shiftId: "33333333-3333-4333-8333-333333333333",
      role: "steward",
      booked: 12,
      headcount: 12,
      isUrgent: false,
      urgentGap: false,
      startsAt: at("10:00"),
      endsAt: at("18:00"),
      requirements: [],
      payRatePence: null,
      post: null,
      meetingPoint: null,
      uniform: null,
    }),
  ],
  moreSessions: 0,
  sessionCount: 2,
  placesFree: 1,
  full: false,
  urgentGap: true,
  ...o,
});

describe("an event card's words", () => {
  it("says where and when, one status tag, and the sessions and places", () => {
    expect(eventWhereWhen(event(), TZ)).toBe("Acme Demo Arena · Sat 7 Nov");
    expect(eventWhereWhen(event({ place: null }), TZ)).toBe("Sat 7 Nov");
    expect(eventDateText(event({ lastStartsAt: at("09:00", "2026-11-08") }), TZ)).toBe(
      "Sat 7 Nov to Sun 8 Nov",
    );
    expect(eventStatus(event())).toEqual({ tone: "done", words: "Showing to casuals" });
    expect(eventStatus(event({ showing: false }))).toEqual({
      tone: "quiet",
      words: "Hidden from casuals",
    });
    expect(eventSummary(event())).toBe("2 sessions · 1 place free");
    expect(eventSummary(event({ sessionCount: 1, placesFree: 3 }))).toBe(
      "1 session · 3 places free",
    );
    expect(eventSummary(event({ placesFree: 0, full: true }))).toBe("2 sessions · Full");
    // None free to offer, but not full (one has started, or is a draft).
    expect(eventSummary(event({ placesFree: 0, full: false }))).toBe(
      "2 sessions · No places to offer",
    );
    expect(eventSwitchLabel(event())).toBe("Show Northern Lights Live to casuals");
  });
});

describe("an event's card (Phase 24, round 7)", () => {
  it("its heading and line, its switch described by its answer, its tags and its sessions and places", () => {
    const html = card(event());
    const words = text(html);
    expect(html).toMatch(
      /^<article aria-labelledby="event-22222222-2222-4222-8222-222222222222-title" data-event="22222222-2222-4222-8222-222222222222" class="glass @container /,
    );
    expect(html).toContain(
      '<h2 id="event-22222222-2222-4222-8222-222222222222-title" class="text-lg font-semibold break-words text-ink">Northern Lights Live</h2>',
    );
    expect(words).toContain("Northern Lights Live Acme Demo Arena · Sat 7 Nov");
    // The switch on the card (round 7), on, named for the event and described by its answer.
    expect(html).toMatch(
      /role="switch" aria-checked="true" aria-label="Show Northern Lights Live to casuals" aria-describedby="event-22222222-2222-4222-8222-222222222222-status"/,
    );
    expect(html).toMatch(
      /<span id="event-22222222-2222-4222-8222-222222222222-status"><span class="[^"]*">[\s\S]*?Showing to casuals<\/span><\/span>/,
    );
    expect(words).toContain("Urgent, not filled");
    expect(words).toContain("2 sessions · 1 place free");
    // Hidden: the switch off, its answer in words; no urgent tag without an urgent gap.
    const hidden = card(event({ showing: false, urgentGap: false }));
    expect(hidden).toMatch(
      /role="switch" aria-checked="false" aria-label="Show Northern Lights Live/,
    );
    expect(text(hidden)).toContain("Hidden from casuals");
    expect(text(hidden)).not.toContain("Urgent, not filled");
  });

  it("a session to fill as a tile: role (→ its page), time, Urgent, needs, post, its meter, pay and menu", () => {
    const html = card(event());
    const tiles = [...html.matchAll(/<li data-session="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)];
    // The full one (12/12) is folded, not a tile here.
    const fold = html.indexOf('<details class="group/filled">');
    const open = tiles.filter((t) => fold < 0 || (t.index ?? 0) < fold);
    expect(open.map((t) => t[1])).toEqual(["11111111-1111-4111-8111-111111111111"]);
    const tile = open[0]?.[2] ?? "";
    const words = text(tile);
    expect(tile).toContain('href="/office/shifts/11111111-1111-4111-8111-111111111111"');
    // One day: the card's line has the date, the tile the times.
    expect(words).toMatch(
      /^Door supervisor 08:00–16:00 Urgent SIA DS CSAS First aid Post: Gate A 3\/4 filled £15\.50\/h/,
    );
    // The post, not the meeting point or uniform (on the event's page).
    expect(words).not.toContain("Main gate");
    expect(words).not.toContain("Black trousers");
    // The meter: 3 of 4, three quarters full.
    expect(tile).toContain(
      'data-meter="true" class="block h-full rounded-full bg-ink" style="width:75%"',
    );
    // Its menu, named apart from the others.
    expect(tile).toContain('aria-label="More for Door supervisor 08:00–16:00"');
    expect(tile).toContain('href="/office/offer/11111111-1111-4111-8111-111111111111"');
    expect(tile).toContain('aria-label="Not urgent: Door supervisor 08:00–16:00"');
  });

  it("full sessions fold under 'N filled sessions' (marked filled counts as full)", () => {
    const html = card(
      event({
        sessions: [
          session({ shiftId: "a1111111-1111-4111-8111-111111111111", booked: 1, headcount: 4 }),
          session({
            shiftId: "b1111111-1111-4111-8111-111111111111",
            booked: 4,
            headcount: 4,
            urgentGap: false,
          }),
          session({
            shiftId: "c1111111-1111-4111-8111-111111111111",
            booked: 2,
            headcount: 4,
            status: "filled",
            urgentGap: false,
          }),
        ],
      }),
    );
    const fold = html.indexOf('<details class="group/filled">');
    expect(fold).toBeGreaterThan(0);
    const folded = html.slice(fold);
    expect(text(folded)).toMatch(/^2 filled sessions/);
    expect([...folded.matchAll(/<li data-session="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "b1111111-1111-4111-8111-111111111111",
      "c1111111-1111-4111-8111-111111111111",
    ]);
    // Marked filled: its meter full.
    expect(folded).toMatch(/4\/4<\/span> filled[\s\S]*4\/4<\/span> filled/);
    // None full: nothing folded.
    expect(card(event({ sessions: [session()] }))).not.toContain("group/filled");
  });

  it("View sessions opens its page, named for the event; past the card's 30, the rest counted", () => {
    const html = card(event({ moreSessions: 3 }));
    expect(html).toMatch(
      /<a aria-label="View sessions: Northern Lights Live" [^>]*href="\/office\/events\/22222222-2222-4222-8222-222222222222">View sessions<svg/,
    );
    expect(text(html)).toContain("+ 3 more sessions");
    expect(text(card(event()))).not.toContain("more session");
  });

  it("an automatic event: its place over its day; over more than one day, the day in each time", () => {
    const auto = text(card(event({ name: "Acme Demo Arena · Sat 7 Nov" })));
    expect(auto.split("Acme Demo Arena").length - 1).toBe(1);
    expect(auto).toMatch(/^Acme Demo Arena Sat 7 Nov /);
    const days = text(
      card(
        event({
          lastStartsAt: at("10:00", "2026-11-08"),
          sessions: [
            session(),
            session({
              shiftId: "z",
              startsAt: at("10:00", "2026-11-08"),
              endsAt: at("18:00", "2026-11-08"),
            }),
          ],
        }),
      ),
    );
    expect(days).toContain("Sat 7, 08:00–16:00");
    expect(days).toContain("Sun 8, 10:00–18:00");
  });

  it("a session with nothing set shows nothing extra; a draft says so", () => {
    const bare = session({
      payRatePence: null,
      post: null,
      meetingPoint: null,
      uniform: null,
      requirements: [],
      isUrgent: false,
      urgentGap: false,
      status: "draft",
      booked: 0,
    });
    const words = text(card(event({ sessions: [bare], urgentGap: false })));
    expect(words).not.toContain("£");
    expect(words).not.toContain("Post:");
    expect(words).toContain("Draft");
    expect(words).toContain("0/4 filled");
  });
});

describe("each session's switch label", () => {
  it("names the role and times, unique on the page", () => {
    const sessions = [
      session(),
      session({ shiftId: "a", role: "steward" }),
      session({ shiftId: "b", role: "steward" }), // the same role and times
      session({ shiftId: "c", role: "steward", startsAt: at("12:00"), endsAt: at("20:00") }),
    ];
    const labels = sessionSwitchLabels(sessions, TZ, false);
    expect([...labels.values()]).toEqual([
      "Show Door supervisor 08:00–16:00 to casuals",
      "Show Steward 08:00–16:00 to casuals",
      "Show Steward 08:00–16:00 (2) to casuals",
      "Show Steward 12:00–20:00 to casuals",
    ]);
    expect(new Set(labels.values()).size).toBe(sessions.length);
    // Over more than one day, the day is in the label.
    expect(
      sessionSwitchLabels(
        [session({ startsAt: at("22:00"), endsAt: at("06:00", "2026-11-08") })],
        TZ,
        true,
      ).get("11111111-1111-4111-8111-111111111111"),
    ).toBe("Show Door supervisor Sat 7 Nov 22:00–06:00 to casuals");
  });

  it("says beside it whether casuals see it", () => {
    expect(sessionShowingText(session(), true)).toBe("Showing to casuals");
    expect(sessionShowingText(session({ showing: false }), true)).toBe("Hidden from casuals");
    expect(sessionShowingText(session(), false)).toBe("Its event is hidden from casuals");
    expect(sessionShowingText(session({ booked: 4 }), true)).toBe("Full: not showing");
    expect(sessionShowingText(session({ started: true }), true)).toBe("Started: not showing");
    expect(sessionShowingText(session({ status: "cancelled" }), true)).toBe("Cancelled");
    expect(sessionShowingText(session({ status: "draft" }), true)).toBe("Draft: not showing");
  });
});

describe("a session row with every field", () => {
  it("role, times, Urgent, a chip per requirement, N/M filled, £/hour, post, meeting point, uniform", () => {
    expect(sessionDetails(session())).toEqual([
      "£15.50/h",
      "Post: Gate A",
      "Meeting point: Main gate",
      "Uniform: Black trousers, boots",
    ]);
    expect(session().requirements.map(requirementChip)).toEqual(["SIA DS", "CSAS", "First aid"]);
    expect(requirementChip({ code: "DBS", name: "DBS check" })).toBe("DBS check");
    const html = renderToStaticMarkup(
      createElement(
        "ul",
        null,
        createElement(SessionItem, {
          session: session(),
          timeZone: TZ,
          withDay: false,
          eventShowing: true,
          full: true,
          uniqueName: "Door supervisor 08:00–16:00",
          booked: [
            {
              workerId: "44444444-4444-4444-8444-444444444444",
              name: "Ann Booker",
              status: "confirmed",
            },
          ],
        }),
      ),
    );
    const words = text(html);
    for (const part of [
      "Door supervisor",
      "08:00–16:00",
      "Urgent",
      "SIA DS",
      "CSAS",
      "First aid",
      "3/4 filled",
      "£15.50/h",
      "Post: Gate A",
      "Meeting point: Main gate",
      "Uniform: Black trousers, boots",
      "Showing to casuals",
      "Ann Booker: Booked",
    ]) {
      expect(words).toContain(part);
    }
    expect(html).toMatch(
      /role="switch" aria-checked="true" aria-label="Show Door supervisor 08:00–16:00 to casuals" aria-describedby="showing-11111111-1111-4111-8111-111111111111"/,
    );
    // The words beside the switch are what it's described by.
    expect(html).toContain('id="showing-11111111-1111-4111-8111-111111111111"');
    // The "…" menu reaches today's forms.
    expect(html).toContain('aria-label="More for Door supervisor 08:00–16:00"');
    expect(html).toContain('href="/office/offer/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('href="/office/shifts/11111111-1111-4111-8111-111111111111#assign"');
    // It's urgent: the menu offers to clear that.
    expect(words).toContain("Not urgent");
    expect(html).toContain('aria-label="Not urgent: Door supervisor 08:00–16:00"');
    expect(words).toContain("Change or cancel");
    // Phase 24 (24.5): a clear glass tile with no hairline, and no red edge though it's urgent
    // (its "Urgent" chip says so); each requirement a clear glass chip, as on the event cards.
    const tile = /^<ul><li class="([^"]*)"/.exec(html)?.[1]?.split(" ") ?? [];
    expect(tile).toEqual(expect.arrayContaining(["glass-tile", "rounded-row"]));
    expect(tile.filter((c) => /^border/.test(c))).toEqual([]);
    expect(html).toMatch(/<span class="[^"]*(?<![\w-])glass-button(?![\w-])[^"]*">SIA DS<\/span>/);
    expect(html).not.toMatch(/bg-quiet-soft[^"]*">(?:SIA DS|CSAS|First aid)</);
  });

  it("two sessions alike get different names for their menu and urgent buttons too", () => {
    // On an event's card (Phase 24).
    const html = card(
      event({
        sessions: [
          session({ shiftId: "a1111111-1111-4111-8111-111111111111", role: "steward" }),
          session({ shiftId: "a2222222-2222-4222-8222-222222222222", role: "steward" }),
        ],
      }),
    );
    expect(html).toContain('aria-label="More for Steward 08:00–16:00"');
    expect(html).toContain('aria-label="More for Steward 08:00–16:00 (2)"');
    expect(html).toContain('aria-label="Not urgent: Steward 08:00–16:00"');
    expect(html).toContain('aria-label="Not urgent: Steward 08:00–16:00 (2)"');
  });

  it("a session hidden from casuals isn't offered from its menu", () => {
    const menu = (s: SessionRow, eventShowing: boolean) =>
      renderToStaticMarkup(
        createElement(SessionItem, { session: s, timeZone: TZ, withDay: false, eventShowing }),
      );
    expect(menu(session(), true)).toContain("Offer a place");
    expect(menu(session({ showing: false }), true)).not.toContain("Offer a place");
    expect(menu(session(), false)).not.toContain("Offer a place");
    expect(menu(session({ showing: false }), true)).toContain("Assign someone");
  });

  it("leaves out what isn't set, and a sheet's session can't be changed or cancelled as a whole", () => {
    const bare = session({
      payRatePence: null,
      post: null,
      meetingPoint: null,
      uniform: null,
      requirements: [],
      fromSheet: true,
      isUrgent: false,
      urgentGap: false,
    });
    expect(sessionDetails(bare)).toEqual([]);
    const words = text(
      renderToStaticMarkup(
        createElement(SessionItem, {
          session: bare,
          timeZone: TZ,
          withDay: false,
          eventShowing: true,
        }),
      ),
    );
    expect(words).not.toContain("£");
    expect(words).not.toContain("Urgent");
    expect(words).toContain("Mark urgent");
    expect(words).toContain(SHEET_SESSION_WORDS);
    expect(words).not.toContain("Change or cancel");
  });
});
