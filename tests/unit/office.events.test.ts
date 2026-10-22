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

// Events & sessions (12B.5; docs/office-v2.md 3.3; Phase 18's rota board): an event's words, its
// row on the board and its open row's table of sessions, each session's unique switch label, and a
// session row (the event's own page) with every field, rendered. The switches and buttons use
// Next's router, so a stand-in is given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { EventRow } = await import("@/app/office/events/event-row");
const { SessionsTable } = await import("@/app/office/events/sessions-table");
const { ShowingSwitch } = await import("@/app/office/events/showing-switch");
const { SessionItem } = await import("@/app/office/events/session-row");
const { boardDays, eventCells, eventNote } = await import("@/lib/office/events-board");
const { BoardDays, BoardKey } = await import("@/app/office/events/board-parts");

// The board's two weeks from Saturday 7 November, and an event's open row in them.
const DAYS = boardDays("2026-11-07", "2026-11-07");
const WINDOW = { first: "2026-11-07", last: "2026-11-20" };
const table = (e: EventCardData, hasPlanner = false) =>
  renderToStaticMarkup(
    createElement(SessionsTable, {
      event: e,
      timeZone: TZ,
      hasPlanner,
      window: WINDOW,
      showingSwitch: createElement(ShowingSwitch, {
        target: "event",
        id: e.eventId,
        showing: e.showing,
        label: eventSwitchLabel(e),
        small: true,
      }),
    }),
  );
const row = (e: EventCardData) =>
  renderToStaticMarkup(
    createElement(EventRow, {
      eventId: e.eventId,
      name: e.name,
      note: eventNote(e).text,
      urgent: eventNote(e).urgent,
      hidden: !e.showing,
      first: true,
      weekend: DAYS.map((d) => d.weekend),
      cells: eventCells(e, DAYS, TZ),
      panel: createElement("p", null, "PANEL"),
    }),
  );

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

  it("its row on the board: the name opens it (shut at first), its line, no switch, a pill on its day", () => {
    const html = row(event());
    const words = text(html);
    // The name and its line are one button that opens the row into its sessions.
    expect(html).toMatch(
      /<button type="button" aria-expanded="false" aria-controls="event-22222222-2222-4222-8222-222222222222-sessions"[^>]*>/,
    );
    expect(words).toContain("Northern Lights Live");
    expect(words).toContain(eventNote(event()).text);
    // Phase 20: no switch on the row (it's in the opened row, so a slip can't hide an event).
    expect(html).not.toContain('role="switch"');
    // The name in full: it wraps rather than being cut short.
    expect(html).toMatch(
      /<span class="block leading-snug font-semibold break-words ">Northern Lights Live<\/span>/,
    );
    expect(html).not.toContain("truncate");
    // Both sessions are on Saturday 7: one pill each, named for screen readers.
    const pills = [
      ...html.matchAll(/<button type="button" aria-label="([^"]+)" aria-expanded/g),
    ].map((m) => m[1]);
    expect(pills).toHaveLength(2);
    // Shut: its sessions aren't drawn until it's opened.
    expect(html).toMatch(
      /<div id="event-22222222-2222-4222-8222-222222222222-sessions" hidden="">/,
    );
    expect(html).not.toContain("PANEL");
    // Hidden: its line says so, with its mark; its name and pills fade.
    const hidden = row(event({ showing: false, urgentGap: false }));
    expect(text(hidden)).toContain("Hidden from casuals");
    expect(hidden).toMatch(/<svg [^>]*>[\s\S]*?<\/svg>Hidden from casuals/);
    expect(hidden).toContain("opacity-50");
    expect(html).not.toMatch(/<svg [^>]*>[\s\S]*?<\/svg>Hidden from casuals/);
    // An automatic event's name is its place and day: said once.
    const automatic = text(row(event({ name: "Acme Demo Arena · Sat 7 Nov" })));
    expect(automatic.split("Acme Demo Arena · Sat 7 Nov")).toHaveLength(2);
    // Its 14 days' cells: the weekends (Sat 7, Sun 8, Sat 14, Sun 15) a shade darker, as their
    // headers are (Phase 20).
    const cells = [
      ...html.matchAll(/<div class="flex flex-col justify-center gap-1 px-1 py-2 ?([^"]*)">/g),
    ].map((m) => m[1]);
    expect(cells).toHaveLength(14);
    expect(cells.flatMap((c, i) => (c === "bg-canvas" ? [i] : []))).toEqual([0, 1, 7, 8]);
  });

  it("the board's days (Phase 20): today marked (in ink in the office: Phase 21), weekends a shade darker", () => {
    const html = renderToStaticMarkup(
      createElement(BoardDays, { days: boardDays("2026-11-07", "2026-11-09") }),
    );
    const days = [
      ...html.matchAll(/<div data-day="([^"]+)" class="([^"]*)">([\s\S]*?)<\/div><\/div>/g),
    ].map((m) => ({ date: m[1], cls: m[2] ?? "", inner: m[3] ?? "" }));
    expect(days).toHaveLength(14);
    // Today (Monday 9): a bar along its top (the `brand` token: ink in the office), "Today" bold;
    // no other day.
    const barred = days.filter((d) =>
      d.inner.includes('class="absolute inset-x-0 top-0 h-1 bg-brand"'),
    );
    expect(barred.map((d) => d.date)).toEqual(["2026-11-09"]);
    expect(barred[0]?.inner).toContain('<div class="text-xs font-semibold text-ink">Today');
    expect(html.match(/bg-brand/g)).toHaveLength(1);
    // The weekends on the canvas grey, a shade darker than the board's card; weekdays not.
    expect(days.filter((d) => d.cls.split(" ").includes("bg-canvas")).map((d) => d.date)).toEqual([
      "2026-11-07",
      "2026-11-08",
      "2026-11-14",
      "2026-11-15",
    ]);
  });

  it("the board's key, in plain words", () => {
    const key = renderToStaticMarkup(createElement(BoardKey));
    expect(text(key).trim().replace(/\s+/g, " ")).toBe(
      "Urgent gap Places open Full Pills show places filled out of places needed.",
    );
    // Each mark is the pill it explains, scaled down (Phase 21: round, as the pills are): red,
    // outlined, grey.
    expect(key).toContain('class="h-3 w-5 rounded-full bg-urgent-fill"');
    expect(key).toContain('class="h-3 w-5 rounded-full border border-ink-muted bg-card"');
    expect(key).toContain('class="h-3 w-5 rounded-full bg-raised"');
  });
});

describe("an event's open row: its sessions in the board's two weeks (Phase 18)", () => {
  it("every one, full ones too (grey seats), each with its urgent switch and menu; the others counted", () => {
    const html = table(
      event({
        sessionCount: 4,
        sessions: [
          session({ shiftId: "a1111111-1111-4111-8111-111111111111", booked: 1, headcount: 4 }),
          session({ shiftId: "b1111111-1111-4111-8111-111111111111", booked: 4, headcount: 4 }),
          session({
            shiftId: "c1111111-1111-4111-8111-111111111111",
            booked: 2,
            headcount: 4,
            status: "filled",
          }),
          // After the two weeks: on the event's page, counted here.
          session({
            shiftId: "d1111111-1111-4111-8111-111111111111",
            startsAt: at("08:00", "2026-11-25"),
            endsAt: at("16:00", "2026-11-25"),
          }),
        ],
      }),
    );
    const words = text(html);
    // Set into the board a step darker (the canvas grey; Phase 21: no sunk shadow, the office has
    // one depth token), not a card of its own.
    expect(html).toMatch(/^<div class="[^"]*rounded-row bg-canvas/);
    expect(html.slice(0, html.indexOf(">"))).not.toMatch(/shadow/);
    expect(html.slice(0, html.indexOf(">"))).not.toContain("bg-card");
    // Its head: where, how many to come, then its "show to casuals" switch (Phase 20: here, not on
    // the row), Add a session and its own page.
    expect(words).toContain(
      "Acme Demo Arena 4 sessions to come Show to casuals Add a session Open the event's page",
    );
    expect(html).toMatch(
      /role="switch" aria-checked="true" aria-label="Show Northern Lights Live to casuals"/,
    );
    // Each session a body of its own, on two lines: the session, then its post, meeting point and
    // uniform.
    const rows = [...html.matchAll(/<tbody data-session="([^"]+)"[^>]*>([\s\S]*?)<\/tbody>/g)];
    expect(rows.map((r) => (r[2]?.match(/<tr>/g) ?? []).length)).toEqual([2, 2, 2]);
    expect(text(rows[0]?.[2] ?? "")).toContain(
      "Gate A · Meet at main gate · Black trousers, boots",
    );
    expect(rows.map((r) => r[1])).toEqual([
      "a1111111-1111-4111-8111-111111111111",
      "b1111111-1111-4111-8111-111111111111",
      "c1111111-1111-4111-8111-111111111111",
    ]);
    // Places as seats and "filled/places" (marked filled counts as full).
    expect(rows.map((r) => text(r[2] ?? "").match(/\d+\/4/)?.[0])).toEqual(["1/4", "4/4", "4/4"]);
    expect(rows[0]?.[2]).toContain('data-seat="free"');
    expect(rows[1]?.[2]).not.toContain('data-seat="free"');
    // Every session keeps its "…" menu and its urgent switch (and the event's own switch).
    expect(html.match(/aria-label="More for /g)).toHaveLength(3);
    expect(html.match(/role="switch"/g)).toHaveLength(4);
    // Pay on the right.
    expect(html).toMatch(/<th scope="col" class="[^"]*text-right">Pay an hour<\/th>/);
    // A session with no post, meeting point or uniform says so on its second line.
    expect(text(table(event({ sessions: [event().sessions[1]!] })))).toContain(
      "No post, meeting point or uniform",
    );
    expect(words).toContain("1 more session to come, outside these two weeks.");
    // Pay an hour; the role links to the session; its own page; Add a session (no planner).
    expect(words).toContain("Pay an hour");
    expect(words).toContain("£15.50");
    expect(html).toContain('href="/office/shifts/a1111111-1111-4111-8111-111111111111"');
    expect(html).toContain('aria-label="Open the event&#x27;s page: Northern Lights Live"');
    expect(words).toContain("Add a session");
    // A firm with a planner adds sessions there.
    expect(text(table(event(), true))).not.toContain("Add a session");
  });

  it("none in these two weeks: says so", () => {
    const later = event({
      sessions: [
        session({ startsAt: at("08:00", "2026-12-01"), endsAt: at("16:00", "2026-12-01") }),
      ],
      sessionCount: 1,
    });
    const words = text(table(later));
    expect(words).toContain("No sessions in these two weeks.");
    expect(words).toContain("1 more session to come, outside these two weeks.");
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
    // On the board's open row (Phase 18).
    const html = table(
      event({
        sessions: [
          session({ shiftId: "a1111111-1111-4111-8111-111111111111", role: "steward" }),
          session({ shiftId: "a2222222-2222-4222-8222-222222222222", role: "steward" }),
        ],
      }),
    );
    expect(html).toContain('aria-label="More for Steward 08:00–16:00"');
    expect(html).toContain('aria-label="More for Steward 08:00–16:00 (2)"');
    expect(html).toContain('aria-label="Not urgent: Steward 08:00–16:00 (2)"');
    expect(html).toContain('aria-label="Urgent: Steward 08:00–16:00 (2)"');
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
