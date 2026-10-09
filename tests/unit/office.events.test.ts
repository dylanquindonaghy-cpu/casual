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

// Events & sessions (12B.5; docs/office-v2.md 3.3): the card's words, each session's unique switch
// label, and a session row with every field, rendered. The switches and buttons use Next's router,
// so a stand-in is given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { EventCard } = await import("@/app/office/events/event-card");
const { SessionItem } = await import("@/app/office/events/session-row");

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

  it("renders the card: name as a link, the switch, the tags, the sessions, View sessions", () => {
    const html = renderToStaticMarkup(createElement(EventCard, { event: event(), timeZone: TZ }));
    const words = text(html);
    expect(words).toContain("Northern Lights Live");
    expect(words).toContain("Acme Demo Arena · Sat 7 Nov");
    expect(words).toContain("Showing to casuals");
    expect(words).toContain("Urgent, not filled");
    expect(words).toContain("2 sessions · 1 place free");
    expect(words).toContain("View sessions");
    expect(html).toContain('href="/office/events/22222222-2222-4222-8222-222222222222"');
    expect(html).toMatch(
      /role="switch" aria-checked="true" aria-label="Show Northern Lights Live to casuals"/,
    );
    // The list's session rows have no switch of their own (only the event's page has them).
    expect(html.match(/role="switch"/g)).toHaveLength(1);
    // Hidden: the tag says so, and there's no urgent tag without an urgent gap.
    const hidden = text(
      renderToStaticMarkup(
        createElement(EventCard, {
          event: event({ showing: false, urgentGap: false }),
          timeZone: TZ,
        }),
      ),
    );
    expect(hidden).toContain("Hidden from casuals");
    expect(hidden).not.toContain("Urgent, not filled");
    expect(
      text(
        renderToStaticMarkup(
          createElement(EventCard, { event: event({ moreSessions: 3 }), timeZone: TZ }),
        ),
      ),
    ).toContain("+ 3 more sessions");
    // An automatic event's name is its place and day: not said twice.
    const automatic = text(
      renderToStaticMarkup(
        createElement(EventCard, {
          event: event({ name: "Acme Demo Arena · Sat 7 Nov" }),
          timeZone: TZ,
        }),
      ),
    );
    expect(automatic.split("Acme Demo Arena · Sat 7 Nov")).toHaveLength(2);
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
  });

  it("two sessions alike get different names for their menu and urgent buttons too", () => {
    const html = renderToStaticMarkup(
      createElement(EventCard, {
        event: event({
          sessions: [
            session({ shiftId: "a1111111-1111-4111-8111-111111111111", role: "steward" }),
            session({ shiftId: "a2222222-2222-4222-8222-222222222222", role: "steward" }),
          ],
        }),
        timeZone: TZ,
      }),
    );
    expect(html).toContain('aria-label="More for Steward 08:00–16:00"');
    expect(html).toContain('aria-label="More for Steward 08:00–16:00 (2)"');
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
