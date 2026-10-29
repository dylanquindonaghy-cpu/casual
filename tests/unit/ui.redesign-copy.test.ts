import { describe, expect, it } from "vitest";
import type { EventCardData, SessionRow } from "@/lib/office/events";
import {
  cardSessionTime,
  EVENT_VIEW_WORDS,
  eventCardTitle,
  eventFilters,
  eventsLine,
  filledPlaces,
  filledSessionsText,
  moreSessionsText,
  sessionWhere,
} from "@/lib/office/events-copy";
import {
  applyRowText,
  daysText,
  needsRowText,
  offlineUrgentText,
  payDayRowText,
  travelStrip,
  uniformItems,
  urgentRowText,
} from "@/lib/portal/home-copy";
import { shiftsStrip } from "@/lib/portal/shifts-strip";
import { dateParts, inDays, placesLeftText, shiftLine, timeRange } from "@/lib/portal/sign-copy";
import { need } from "../helpers/qualifications";

// The words and choices behind Phase 18's redesign (docs/screens.md "The redesign"): the sign
// parts' dates and times, Home's rows (Phase 24: "Do this", "Shifts you can take", "Pay"), the
// pass's travel figures and uniform tiles, Open
// shifts' 8-day strip and the rota board's pills (the dashboard's headline and rows went with
// Phase 24's dashboard, whose words tests/unit/office.board.test.ts checks). All pure, so each is
// checked here with made-up shifts.

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);

describe("the sign parts' words", () => {
  it("a date's parts, in London time, with the long words for screen readers", () => {
    expect(dateParts(at("2026-10-24T13:00:00Z"), TZ)).toEqual({
      dow: "Sat",
      day: "24",
      month: "Oct",
      long: "Saturday 24 October",
    });
    // 23:30 UTC on 31 May is 00:30 on 1 June in London (BST).
    expect(dateParts(at("2026-05-31T23:30:00Z"), TZ).long).toBe("Monday 1 June");
  });

  it("a time range with an en dash; a night shift says when it finishes; midnight is that day's", () => {
    expect(timeRange(at("2026-10-24T13:00:00Z"), at("2026-10-24T21:00:00Z"), TZ)).toEqual({
      range: "14:00–22:00",
      endsNote: null,
      spoken: "14:00 to 22:00",
    });
    expect(timeRange(at("2026-10-23T18:00:00Z"), at("2026-10-24T00:00:00Z"), TZ)).toEqual({
      range: "19:00–01:00",
      endsNote: "Finishes Saturday morning",
      spoken: "19:00 to 01:00",
    });
    // 16:00 to midnight GMT: no second day.
    expect(timeRange(at("2026-11-07T16:00:00Z"), at("2026-11-08T00:00:00Z"), TZ)).toEqual({
      range: "16:00–00:00",
      endsNote: null,
      spoken: "16:00 to midnight",
    });
    // Ending the next afternoon: no "morning".
    expect(timeRange(at("2026-11-07T22:00:00Z"), at("2026-11-08T14:00:00Z"), TZ).endsNote).toBe(
      "Finishes Sunday",
    );
  });

  it("how far off a shift is: on now, today, tomorrow, in calendar days", () => {
    const now = at("2026-10-21T15:00:00Z"); // Wed 21 Oct, 16:00 BST
    const s = (iso: string) => [at(iso), new Date(at(iso).getTime() + 8 * 3_600_000)] as const;
    expect(inDays(...s("2026-10-21T13:00:00Z"), now, TZ)).toBe("On now");
    expect(inDays(...s("2026-10-21T18:00:00Z"), now, TZ)).toBe("Today");
    expect(inDays(...s("2026-10-22T07:00:00Z"), now, TZ)).toBe("Tomorrow");
    expect(inDays(...s("2026-10-24T13:00:00Z"), now, TZ)).toBe("In 3 days");
    // Over the clock change (25 Oct) it still counts days, not 24-hour spans.
    expect(inDays(...s("2026-10-26T09:00:00Z"), now, TZ)).toBe("In 5 days");
  });

  it("places left, with and without the total; a shift in one line", () => {
    expect(placesLeftText(1)).toBe("1 place left");
    expect(placesLeftText(3)).toBe("3 places left");
    expect(placesLeftText(1, 4)).toBe("1 of 4 places left");
    expect(placesLeftText(0, 4)).toBe("No places left");
    expect(
      shiftLine("csas_officer", at("2026-10-24T13:00:00Z"), at("2026-10-24T21:00:00Z"), TZ),
    ).toBe("CSAS officer, Sat 24 Oct, 14:00–22:00");
  });
});

describe("Home's rows", () => {
  const shift = (iso: string, pay: number | null = 1260) => ({
    startsAt: at(iso),
    payRatePence: pay,
  });

  it("the days, each once, soonest first, the month on the last; past three, 'and more'", () => {
    expect(daysText([shift("2026-10-23T18:00:00Z"), shift("2026-10-22T07:00:00Z")], TZ)).toBe(
      "Thu 22 and Fri 23 Oct",
    );
    expect(daysText([shift("2026-10-22T07:00:00Z"), shift("2026-10-22T12:00:00Z")], TZ)).toBe(
      "Thu 22 Oct",
    );
    expect(
      daysText(
        ["2026-10-25", "2026-10-27", "2026-10-28"].map((d) => shift(`${d}T10:00:00Z`)),
        TZ,
      ),
    ).toBe("Sun 25, Tue 27 and Wed 28 Oct");
    expect(
      daysText(
        ["2026-10-25", "2026-10-27", "2026-10-28", "2026-10-30"].map((d) =>
          shift(`${d}T10:00:00Z`),
        ),
        TZ,
      ),
    ).toBe("Sun 25, Tue 27, Wed 28 Oct and more");
  });

  it("the urgent row (Phase 24, round 7's words): how many, near you when her home area chose them, the days and the best pay", () => {
    expect(
      urgentRowText(
        [shift("2026-10-22T07:00:00Z", 1550), shift("2026-10-23T18:00:00Z", 1500)],
        true,
        TZ,
      ),
    ).toEqual({
      title: "2 urgent near you",
      sub: "Thu 22 and Fri 23 Oct · up to £15.50/hour",
    });
    expect(urgentRowText([shift("2026-10-22T07:00:00Z", null)], false, TZ)).toEqual({
      title: "1 urgent",
      sub: "Thu 22 Oct",
    });
  });

  it("the apply row says 'more' only under the urgent one, and with none when she'll hear; offline, the urgent count", () => {
    const three = ["2026-10-25", "2026-10-27", "2026-10-28"].map((d) => shift(`${d}T10:00:00Z`));
    expect(applyRowText(three, true, true, TZ)).toEqual({
      title: "3 more to apply for",
      sub: "Sun 25, Tue 27 and Wed 28 Oct · up to £12.60/hour",
    });
    expect(applyRowText(three, false, true, TZ)).toEqual({
      title: "3 shifts to apply for",
      sub: "Sun 25, Tue 27 and Wed 28 Oct · up to £12.60/hour",
    });
    expect(applyRowText([shift("2026-10-25T10:00:00Z", null)], false, true, TZ)).toEqual({
      title: "1 shift to apply for",
      sub: "Sun 25 Oct",
    });
    expect(applyRowText([], true, true, TZ)).toEqual({
      title: "No other shifts now",
      sub: "We'll message you when something matches.",
    });
    expect(applyRowText([], false, false, TZ)).toEqual({
      title: "No shifts right now",
      sub: "Check back later.",
    });
    // Pay day: the pay week's Friday (D8), for the week she's in.
    expect(payDayRowText("2026-10-30")).toEqual({
      title: "Pay day: Fri 30 Oct",
      sub: "For this week's shifts",
    });
    expect(offlineUrgentText(2, "14:49")).toBe(
      "2 were urgent at 14:49. We'll check again when you're online.",
    );
    expect(offlineUrgentText(1, "14:49")).toMatch(/^1 was urgent at 14:49\./);
  });

  it("what needs doing: the one thing with where to sort it, the worst first, or how many", () => {
    const photo = {
      status: "due_soon" as const,
      current: { id: "p", uploadedOn: "2025-11-10", renewBy: "2026-11-10" },
      waiting: null,
    };
    const ok = { status: "up_to_date" as const, current: photo.current, waiting: null };
    expect(needsRowText([], ok, 2026)).toBeNull();
    expect(needsRowText([], photo, 2026)).toEqual({
      title: "Renew your staff photo",
      sub: "Due by 10 Nov.",
      href: "/profile#photo-heading",
      urgent: false,
      photo: true,
    });
    expect(needsRowText([], { ...photo, status: "overdue" }, 2026)).toMatchObject({
      sub: "It was due by 10 Nov.",
      urgent: true,
    });
    const expired = need(2, { status: "expired", expiresOn: "2026-10-01" });
    const one = needsRowText([expired], ok, 2026);
    expect(one).toMatchObject({
      title: "Renew your SIA door supervisor licence",
      href: "/profile/upload/SIA_DS",
      urgent: true,
    });
    expect(one?.sub).toContain("expired on");
    const missing = need(4, { status: "missing", expiresOn: null, uploadable: false });
    const three = needsRowText([missing, expired], photo, 2026);
    expect(three).toMatchObject({ title: "3 things need doing", href: "/profile", urgent: true });
    // The worst one's own sentence, then how many more.
    expect(three?.sub).toBe(`${one?.sub} And 2 more.`);
    expect(needsRowText([missing], ok, 2026)).toMatchObject({
      title: "Add your SIA door supervisor licence",
      href: "/profile",
      urgent: false,
    });
  });
});

describe("the pass's travel figures and uniform tiles", () => {
  const arriveBy = at("2026-10-24T12:45:00Z");

  it('three figures when worked out, how far first (Phase 24, round 7: "3.1" miles away); words when they aren\'t', () => {
    expect(
      travelStrip({
        kind: "estimated",
        straightMetres: 7000,
        arriveBy,
        car: { minutes: 15, metres: 8047 },
        publicTransport: { minutes: 31 },
      }),
    ).toEqual({
      kind: "cells",
      cells: [
        { figure: "5.0", words: "miles away" },
        { figure: "15 min", words: "by car" },
        { figure: "31 min", words: "by public transport" },
      ],
    });
    expect(
      travelStrip({
        kind: "estimated",
        straightMetres: 9000,
        arriveBy,
        car: null,
        publicTransport: null,
      }),
    ).toEqual({
      kind: "cells",
      cells: [
        { figure: "6", words: "miles in a straight line" },
        { figure: "90+ min", words: "by car" },
        { figure: "None", words: "public transport in time" },
      ],
    });
    expect(travelStrip({ kind: "unknown" })).toEqual({
      kind: "words",
      words: "Distance not known yet",
    });
    expect(travelStrip({ kind: "straight", straightMetres: 1000 })).toEqual({
      kind: "cells",
      cells: [
        { figure: "1", words: "mile in a straight line" },
        { figure: "Not known", words: "travel time yet" },
      ],
    });
  });

  it("the uniform split at commas (not in brackets), hi-vis first, brackets as the note", () => {
    expect(
      uniformItems("Black trousers, hi-vis tabard (we provide it), comfortable shoes"),
    ).toEqual([
      { words: "Hi-vis tabard", note: "We provide it", kind: "hivis" },
      { words: "Black trousers", note: null, kind: "trousers" },
      { words: "Comfortable shoes", note: null, kind: "shoe" },
    ]);
    expect(uniformItems("Black suit; white shirt (ironed, please)")).toEqual([
      { words: "Black suit", note: null, kind: "garment" },
      { words: "White shirt", note: "Ironed, please", kind: "garment" },
    ]);
    expect(uniformItems(null)).toBeNull();
    expect(uniformItems("  ")).toBeNull();
    expect(uniformItems("a, b, c, d, e, f, g")).toBeNull();
    expect(uniformItems(`${"x".repeat(61)}`)).toBeNull();
    // Sentences stay as written.
    expect(uniformItems("Black trousers, boots. Hi-vis provided.")).toBeNull();
  });
});

describe("Open shifts' strip of the next 8 days", () => {
  it("booked wins, then urgent, then open; today first; each day's words", () => {
    const now = at("2026-10-21T15:00:00Z");
    const open = [
      { startsAt: at("2026-10-22T07:00:00Z"), isUrgent: true },
      { startsAt: at("2026-10-22T12:00:00Z"), isUrgent: false },
      { startsAt: at("2026-10-25T10:00:00Z"), isUrgent: false },
      { startsAt: at("2026-10-25T14:00:00Z"), isUrgent: false },
      { startsAt: at("2026-10-24T10:00:00Z"), isUrgent: true },
      { startsAt: at("2026-10-30T10:00:00Z"), isUrgent: true }, // past the 8 days
    ];
    const strip = shiftsStrip(now, TZ, open, ["2026-10-24"]);
    expect(strip).toHaveLength(8);
    expect(strip.map((d) => [d.dow, d.day, d.kind, d.count])).toEqual([
      ["Today", "21", "none", 0],
      ["Thu", "22", "urgent", 1],
      ["Fri", "23", "none", 0],
      ["Sat", "24", "booked", 0],
      ["Sun", "25", "open", 2],
      ["Mon", "26", "none", 0],
      ["Tue", "27", "none", 0],
      ["Wed", "28", "none", 0],
    ]);
    expect(strip[0]?.label).toBe("Wed 21 Oct, today: nothing open");
    expect(strip[1]?.label).toBe("Thu 22 Oct: 1 urgent shift");
    expect(strip[3]?.label).toBe("Sat 24 Oct: you're booked");
    expect(strip[4]?.label).toBe("Sun 25 Oct: 2 open shifts");
  });
});

// --- The event cards (Phase 24, 24.4; Phase 18's rota board until then) ----------------------------

const session = (o: Partial<SessionRow>): SessionRow => ({
  shiftId: "s1",
  role: "steward",
  startsAt: at("2026-10-22T09:00:00Z"),
  endsAt: at("2026-10-22T17:00:00Z"),
  status: "open",
  headcount: 4,
  booked: 3,
  isUrgent: false,
  urgentGap: false,
  showing: true,
  payRatePence: 1260,
  post: null,
  meetingPoint: null,
  uniform: null,
  requirements: [],
  fromSheet: false,
  fromPlanner: false,
  started: false,
  ended: false,
  ...o,
});

const event = (sessions: SessionRow[], o: Partial<EventCardData> = {}): EventCardData => ({
  eventId: "e1",
  name: "Northern Lights Live",
  place: "Acme Demo Arena",
  firstStartsAt: sessions[0]?.startsAt ?? at("2026-10-22T09:00:00Z"),
  lastStartsAt: sessions.at(-1)?.startsAt ?? at("2026-10-22T09:00:00Z"),
  showing: true,
  sessions,
  moreSessions: 0,
  sessionCount: sessions.length,
  placesFree: 1,
  full: false,
  urgentGap: false,
  ...o,
});

describe("the event cards' words", () => {
  it("the filters: All, Showing, Hidden, Urgent not filled; Need people only while it's chosen", () => {
    expect(eventFilters("all")).toEqual(["all", "showing", "hidden", "urgent"]);
    expect(eventFilters("hidden")).toEqual(["all", "showing", "hidden", "urgent"]);
    // The top bar's To fill opens "Need people": shown after All while it's the one chosen.
    expect(eventFilters("need")).toEqual(["all", "need", "showing", "hidden", "urgent"]);
    expect(eventFilters("all").map((v) => EVENT_VIEW_WORDS[v])).toEqual([
      "All",
      "Showing",
      "Hidden",
      "Urgent, not filled",
    ]);
    expect(EVENT_VIEW_WORDS.need).toBe("Need people");
  });

  it("the line beside them: events with sessions to come and their places free", () => {
    expect(eventsLine(8, 26)).toBe("8 events with sessions to come · 26 places free");
    expect(eventsLine(1, 1)).toBe("1 event with sessions to come · 1 place free");
    expect(eventsLine(0, 0)).toBe("0 events with sessions to come · 0 places free");
  });

  it("a card's heading and line; an automatic event's place over its day, neither said twice", () => {
    expect(eventCardTitle(event([session({})]), TZ)).toEqual({
      title: "Northern Lights Live",
      line: "Acme Demo Arena · Thu 22 Oct",
    });
    const days = event([
      session({}),
      session({ shiftId: "s2", startsAt: at("2026-10-24T09:00:00Z") }),
    ]);
    expect(eventCardTitle(days, TZ).line).toBe("Acme Demo Arena · Thu 22 Oct to Sat 24 Oct");
    // An automatic event (named for its place and day).
    expect(
      eventCardTitle(event([session({})], { name: "Acme Demo Arena · Thu 22 Oct" }), TZ),
    ).toEqual({ title: "Acme Demo Arena", line: "Thu 22 Oct" });
    // No place: the day alone under the name.
    expect(eventCardTitle(event([session({})], { place: null }), TZ)).toEqual({
      title: "Northern Lights Live",
      line: "Thu 22 Oct",
    });
  });

  it("a session's time on its card: the day too when the event spans days (London's clock)", () => {
    const s = session({});
    expect(cardSessionTime(s, TZ, false)).toBe("10:00–18:00");
    expect(cardSessionTime(s, TZ, true)).toBe("Thu 22, 10:00–18:00");
    // Over midnight, and after the clocks go back (Sun 25 Oct 2026): GMT again.
    const night = session({
      startsAt: at("2026-10-27T21:00:00Z"),
      endsAt: at("2026-10-28T05:00:00Z"),
    });
    expect(cardSessionTime(night, TZ, true)).toBe("Tue 27, 21:00–05:00");
  });

  it("its meter's places (marked filled counts as full) and where its casuals go", () => {
    expect(filledPlaces(session({ booked: 3, headcount: 4 }))).toBe(3);
    expect(filledPlaces(session({ status: "filled", booked: 1, headcount: 4 }))).toBe(4);
    expect(filledPlaces(session({ booked: 5, headcount: 4 }))).toBe(4);
    expect(sessionWhere(session({ post: "Gate A", meetingPoint: "Main gate" }))).toBe(
      "Post: Gate A",
    );
    expect(sessionWhere(session({ meetingPoint: "Gate 2" }))).toBe("Meeting point: Gate 2");
    expect(sessionWhere(session({}))).toBeNull();
  });

  it("the folded filled sessions, and those past the card's 30", () => {
    expect(filledSessionsText(1)).toBe("1 filled session");
    expect(filledSessionsText(18)).toBe("18 filled sessions");
    expect(moreSessionsText(1)).toBe("+ 1 more session");
    expect(moreSessionsText(3)).toBe("+ 3 more sessions");
  });
});
