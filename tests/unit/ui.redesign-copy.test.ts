import { describe, expect, it } from "vitest";
import type { Dashboard, NeedsAttention } from "@/lib/office/dashboard";
import {
  afterRows,
  attentionText,
  headline,
  oneCount,
  sortedRows,
  subline,
  urgentDaysText,
  weekCells,
  weekSummary,
} from "@/lib/office/dashboard-home";
import {
  boardDays,
  boardWindow,
  DAY_PILLS,
  eventCells,
  eventNote,
  windowText,
} from "@/lib/office/events-board";
import type { EventCardData, SessionRow } from "@/lib/office/events";
import { placesFilledText } from "@/lib/office/focus-copy";
import {
  applyTileText,
  daysText,
  needsRowText,
  offlineUrgentText,
  payDayTileText,
  travelStrip,
  uniformItems,
  urgentTileText,
} from "@/lib/portal/home-copy";
import { shiftsStrip } from "@/lib/portal/shifts-strip";
import { dateParts, inDays, placesLeftText, shiftLine, timeRange } from "@/lib/portal/sign-copy";
import { need } from "../helpers/qualifications";

// The words and choices behind Phase 18's redesign (docs/screens.md "The redesign"): the sign
// parts' dates and times, Home's "For you" rows, the pass's travel figures and uniform tiles, Open
// shifts' 8-day strip, the dashboard's headline, week and rows, and the rota board's pills. All
// pure, so each is checked here with made-up shifts.

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

  it("places left, with and without the total; a shift in one line; places filled", () => {
    expect(placesLeftText(1)).toBe("1 place left");
    expect(placesLeftText(3)).toBe("3 places left");
    expect(placesLeftText(1, 4)).toBe("1 of 4 places left");
    expect(placesLeftText(0, 4)).toBe("No places left");
    expect(
      shiftLine("csas_officer", at("2026-10-24T13:00:00Z"), at("2026-10-24T21:00:00Z"), TZ),
    ).toBe("CSAS officer, Sat 24 Oct, 14:00–22:00");
    // The dashboard's urgent place beside its bar (Phase 21, Dylan's words): filled, not free.
    expect(placesFilledText(1, 4)).toBe("3 of 4 filled");
    expect(placesFilledText(1, 1)).toBe("0 of 1 filled");
    expect(placesFilledText(0, 2)).toBe("2 of 2 filled");
  });
});

describe("Home's For you rows", () => {
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

  it("the urgent tile (Phase 20): near you when her home area chose them, how many, the days and the best pay", () => {
    expect(
      urgentTileText(
        [shift("2026-10-22T07:00:00Z", 1550), shift("2026-10-23T18:00:00Z", 1500)],
        true,
        TZ,
      ),
    ).toEqual({
      label: "Urgent near you",
      value: "2 shifts",
      caption: "Thu 22 and Fri 23 Oct, up to £15.50 an hour",
    });
    expect(urgentTileText([shift("2026-10-22T07:00:00Z", null)], false, TZ)).toEqual({
      label: "Urgent",
      value: "1 shift",
      caption: "Thu 22 Oct",
    });
  });

  it("the apply tile says 'more' only under the urgent one, and with none when she'll hear; offline, the urgent count", () => {
    const three = ["2026-10-25", "2026-10-27", "2026-10-28"].map((d) => shift(`${d}T10:00:00Z`));
    expect(applyTileText(three, true, true, TZ)).toEqual({
      label: "More to apply for",
      value: "3 shifts",
      caption: "Sun 25, Tue 27 and Wed 28 Oct",
    });
    expect(applyTileText(three, false, true, TZ).label).toBe("To apply for");
    expect(applyTileText(three.slice(0, 1), false, true, TZ).value).toBe("1 shift");
    expect(applyTileText([], true, true, TZ)).toEqual({
      label: "More to apply for",
      value: "No others now",
      caption: "We'll message you when something matches.",
    });
    expect(applyTileText([], false, false, TZ)).toEqual({
      label: "To apply for",
      value: "None right now",
      caption: "Check back later.",
    });
    // Pay day: the pay week's Friday (D8), for the week she's in.
    expect(payDayTileText("2026-10-30")).toEqual({
      label: "Pay day",
      value: "Fri 30 Oct",
      caption: "For this week's shifts",
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
      sub: "Due by 10 Nov. Take a new photo.",
      href: "/profile#photo-heading",
      urgent: false,
      photo: true,
    });
    expect(needsRowText([], { ...photo, status: "overdue" }, 2026)).toMatchObject({
      sub: "It was due by 10 Nov. Take a new photo.",
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

  it("three figures when worked out; words when they aren't", () => {
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
        { figure: "15 min", words: "by car" },
        { figure: "31 min", words: "by public transport" },
        { figure: "5.0 mi", words: "away" },
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
        { figure: "90+ min", words: "by car" },
        { figure: "None", words: "public transport in time" },
        { figure: "6 mi", words: "in a straight line" },
      ],
    });
    expect(travelStrip({ kind: "unknown" })).toEqual({
      kind: "words",
      words: "Distance not known yet",
    });
    expect(travelStrip({ kind: "straight", straightMetres: 1000 }).kind).toBe("cells");
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

// --- The dashboard ------------------------------------------------------------------------------

const emptyNeeds = (): NeedsAttention => ({
  toCheck: [],
  toCheckMore: false,
  fromSheet: [],
  fromSheetMore: false,
  toMark: [],
  toMarkMore: false,
  expired: [],
  expiredMore: false,
  uploads: 0,
  uploadList: [],
  evidence: { addressConfirmed: true, waiting: 0, failed: [], failedMore: false },
  plannerRefused: [],
  plannerRefusedMore: false,
  webhookFailing: null,
});

describe("the dashboard's headline, week and rows", () => {
  it("the headline counts the things, and the line under it says where to start", () => {
    expect(headline(0)).toBe("Nothing needs you right now");
    expect(headline(1)).toBe("1 thing needs you");
    expect(headline(3)).toBe("3 things need you");
    // The one count (Phase 20): each urgent place still to fill, and each item of Needs attention.
    expect(oneCount(3, 7)).toBe(10);
    expect(oneCount(0, 2)).toBe(2);
    expect(oneCount(0, 0)).toBe(0);
    expect(subline(2, 3)).toBe(
      "Start with the urgent places. Casuals see these first and get an alert.",
    );
    expect(subline(0, 2)).toBe("Urgent places are sorted. The rest is below.");
    expect(subline(0, 0)).toMatch(/^Every urgent place is filled/);
  });

  it("each day of the week: to mark first, then urgent places with the others open, then how full", () => {
    // In places: `open` can still be filled (open sessions not started), `urgent` of those.
    const days = [
      // Monday, gone by: 2 places never filled (it started), so not "All filled".
      { date: "2026-10-19", places: 6, filled: 4, open: 0, urgent: 0 },
      { date: "2026-10-20", places: 5, filled: 5, open: 0, urgent: 0 },
      { date: "2026-10-21", places: 0, filled: 0, open: 0, urgent: 0 },
      { date: "2026-10-22", places: 4, filled: 3, open: 1, urgent: 1 },
      { date: "2026-10-24", places: 21, filled: 19, open: 2, urgent: 1 },
      // A draft's places aren't in `places`; 11 open of 41.
      { date: "2026-10-25", places: 41, filled: 30, open: 11, urgent: 0 },
      { date: "2026-10-26", places: 2, filled: 2, open: 0, urgent: 0 },
    ];
    const toMark = Array.from({ length: 5 }, () => ({ startsAt: at("2026-10-20T09:30:00Z") }));
    const cells = weekCells(days, toMark, "2026-10-21", TZ);
    expect(cells.map((c) => [c.dow, c.note])).toEqual([
      ["Mon", { kind: "short", text: "4 of 6 filled" }],
      ["Tue", { kind: "mark", text: "5 to mark" }],
      ["Today", { kind: "none", text: "Nothing on" }],
      ["Thu", { kind: "urgent", text: "1 urgent", extra: null }],
      ["Sat", { kind: "urgent", text: "1 urgent", extra: "2 open" }],
      ["Sun", { kind: "open", text: "11 open" }],
      ["Mon", { kind: "filled", text: "All filled" }],
    ]);
    expect(cells[1]?.href).toBe("/office/needs-attention#to-mark");
    expect(cells[3]?.href).toBe("/office/shifts?from=2026-10-22");
    expect(cells[3]?.filledShare).toBe(0.75);
    expect(cells[4]?.label).toBe("Sat 24 Oct: 1 urgent, 2 open, 19 of 21 places filled");
    expect(cells[2]?.label).toBe("Wed 21 Oct, today: Nothing on");
    expect(cells[0]?.label).toBe("Mon 19 Oct: 4 of 6 filled");
    // Phase 20: each day's places, filled and open, and whether it's gone by.
    expect(cells.map((c) => [c.places, c.filled, c.open, c.past])).toEqual([
      [6, 4, 0, true],
      [5, 5, 0, true],
      [0, 0, 0, false],
      [4, 3, 1, false],
      [21, 19, 2, false],
      [41, 30, 11, false],
      [2, 2, 0, false],
    ]);
    // From today on: 14 places still to fill; 54 of 68 filled, over the days with places.
    expect(weekSummary(cells)).toEqual({ toFill: 14, filled: 54, places: 68, days: "Thu to Mon" });
    // A day gone by never counts, even with open places left in the data.
    expect(
      weekSummary(weekCells([{ ...days[0]!, open: 3 }, days[2]!], [], "2026-10-21", TZ)),
    ).toEqual({ toFill: 0, filled: 0, places: 0, days: null });
    expect(weekSummary(weekCells([days[2]!, days[3]!], [], "2026-10-21", TZ)).days).toBe("Thu");
  });

  it("the dashboard's tiles: the urgent places' days, and what Needs attention's count is made of", () => {
    const item = (dow: string, day: string, shiftId: string) => ({ dow, day, shiftId });
    expect(urgentDaysText([])).toBe("");
    expect(urgentDaysText([item("Thu", "22", "a")])).toBe("Thu 22");
    expect(
      urgentDaysText([item("Thu", "22", "a"), item("Thu", "22", "b"), item("Fri", "23", "c")]),
    ).toBe("Thu 22 and Fri 23");
    expect(urgentDaysText(["22", "23", "24", "25"].map((d, i) => item("Thu", d, String(i))))).toBe(
      "Thu 22, Thu 23, Thu 24 and more",
    );
    const row = (key: string, count: string | null) => ({
      key,
      title: "",
      sub: "",
      count,
      href: "",
    });
    expect(attentionText([row("to-mark", "5"), row("uploads", "2")])).toBe(
      "5 sessions to mark, 2 uploads",
    );
    expect(attentionText([row("to-mark", "1"), row("uploads", "1")])).toBe(
      "1 session to mark, 1 upload",
    );
    expect(
      attentionText([row("to-check", "50+"), row("webhook", null), row("enquiries", "2")]),
    ).toBe("50+ bookings to check, webhook failing and more");
    expect(attentionText([])).toBe("Nothing waiting for you");
  });

  it("After that: a row per kind of to-do, in Needs attention's order, each to where it's dealt with", () => {
    expect(afterRows(emptyNeeds(), 0, TZ)).toEqual([]);
    const n = emptyNeeds();
    n.toMark = Array.from({ length: 5 }, (_, i) => ({
      shiftId: `s${i}`,
      role: "steward",
      site: null,
      startsAt: at("2026-10-20T09:30:00Z"),
      endsAt: at("2026-10-20T17:30:00Z"),
      unmarked: 1,
    }));
    n.uploads = 2;
    n.webhookFailing = { since: at("2026-10-20T10:00:00Z") };
    const rows = afterRows(n, 3, TZ);
    expect(rows.map((r) => [r.key, r.title, r.count, r.href])).toEqual([
      ["to-mark", "Who worked?", "5", "/office/needs-attention#to-mark"],
      ["uploads", "Uploads to check", "2", "/office/casuals?view=uploads"],
      ["webhook", "Your planner's webhook is failing", null, "/office/needs-attention#webhook"],
      ["enquiries", "Enquiries that need a person", "3", "/office/enquiries"],
    ]);
    expect(rows[0]?.sub).toBe("5 sessions on Tue 20 Oct to mark");
    // A list that stopped at 50 says so.
    n.toMarkMore = true;
    expect(afterRows(n, 0, TZ)[0]?.count).toBe("5+");
    // Couldn't be read: only what else is known.
    expect(afterRows(null, 1, TZ).map((r) => r.key)).toEqual(["enquiries"]);
  });

  it("Sorted today: cancellations recorded automatically, enquiries answered, what casuals see", () => {
    const d = {
      counts: {
        urgent: { ok: true, data: { sessions: 0, places: 0, firstStartsAt: null } },
        showing: { ok: true, data: { events: 8, sessions: 16, places: 29 } },
        cancellations: { ok: true, data: { total: 1, underNotice: 0, strikes: 0, threshold: 48 } },
        enquiries: { ok: true, data: { total: 5, automatic: 2, needPerson: 0 } },
      },
    } as unknown as Dashboard;
    expect(sortedRows(d).map((r) => [r.title, r.sub, r.href])).toEqual([
      [
        "1 cancellation today",
        "0 under 48 hours' notice, 0 strikes issued. Recorded automatically, never approved or declined.",
        "/office/cancellations?day=today",
      ],
      [
        "5 enquiries today",
        "2 answered automatically. None need a person.",
        "/office/enquiries?day=today",
      ],
      [
        "8 events showing to casuals",
        "29 open places across 16 sessions",
        "/office/events?view=showing",
      ],
    ]);
    const failed = { counts: { ...d.counts, enquiries: { ok: false } } } as unknown as Dashboard;
    expect(sortedRows(failed)[1]).toMatchObject({ title: "Enquiries today", sub: "Couldn't load" });
  });
});

// --- The rota board ------------------------------------------------------------------------------

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

describe("the rota board", () => {
  it("Earlier and Later: two weeks at a time, never before today, only real days", () => {
    const today = "2026-10-21";
    // Today: nothing earlier; Later starts the next two weeks.
    expect(boardWindow(undefined, today)).toEqual({
      from: today,
      earlier: null,
      later: "2026-11-04",
    });
    // Two weeks on: Earlier goes back to today (no `from` needed), Later on again.
    expect(boardWindow("2026-11-04", today)).toEqual({
      from: "2026-11-04",
      earlier: "today",
      later: "2026-11-18",
    });
    // Four weeks on: Earlier is the two weeks before.
    expect(boardWindow("2026-11-18", today)).toMatchObject({ earlier: "2026-11-04" });
    // A day just after today: back to today, not before it.
    expect(boardWindow("2026-10-25", today)).toMatchObject({ earlier: "today" });
    // Before today, today itself, not a day, not a real date: today.
    for (const bad of [
      "2026-10-01",
      today,
      "soon",
      "2026-13-45",
      "2026-02-30",
      7,
      ["2026-11-04"],
    ]) {
      expect(boardWindow(bad, today), String(bad)).toEqual({
        from: today,
        earlier: null,
        later: "2026-11-04",
      });
    }
    expect(windowText(boardDays("2026-11-04", today))).toBe("4 Nov to 17 Nov");
  });

  it("14 days from the first, today and the weekend marked, and the window in words", () => {
    const days = boardDays("2026-10-21", "2026-10-21");
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({
      date: "2026-10-21",
      dow: "Today",
      day: "21",
      weekend: false,
      today: true,
    });
    expect(days[3]).toMatchObject({ dow: "Sat", weekend: true });
    expect(windowText(days)).toBe("21 Oct to 3 Nov");
  });

  it("a pill per session on its day: filled out of needed, red for an urgent gap, grey when full", () => {
    const days = boardDays("2026-10-21", "2026-10-21");
    const cells = eventCells(
      event([
        session({ shiftId: "a", urgentGap: true, isUrgent: true, role: "door_supervisor" }),
        session({ shiftId: "b", booked: 2, headcount: 2 }),
        session({ shiftId: "c", startsAt: at("2026-10-27T18:00:00Z"), booked: 0 }),
        session({ shiftId: "d", status: "cancelled" }),
      ]),
      days,
      TZ,
    );
    expect(cells[1]?.map((p) => [p.text, p.tone])).toEqual([
      ["3/4", "urgent"],
      ["2/2", "full"],
    ]);
    expect(cells[1]?.[0]?.label).toBe(
      "Door supervisor, Thu 22, 10:00–18:00: 3 of 4 filled, urgent",
    );
    expect(cells[6]?.map((p) => [p.text, p.tone])).toEqual([["0/4", "open"]]);
    expect(cells.flat()).toHaveLength(3);
    // Marked filled by the office: all its places count.
    expect(
      eventCells(event([session({ status: "filled", booked: 1 })]), days, TZ)[1]?.[0],
    ).toMatchObject({
      text: "4/4",
      tone: "full",
    });
  });

  it(`more than ${DAY_PILLS} sessions on a day are one pill, their places added up`, () => {
    const days = boardDays("2026-10-21", "2026-10-21");
    const many = Array.from({ length: 5 }, (_, i) =>
      session({ shiftId: `m${i}`, headcount: 1, booked: i === 0 ? 0 : 1, urgentGap: i === 0 }),
    );
    expect(eventCells(event(many), days, TZ)[1]).toEqual([
      {
        shiftId: "2026-10-22-day",
        text: "4/5",
        tone: "urgent",
        sessions: 5,
        label: "5 sessions on Thu 22: 4 of 5 places filled, 1 urgent",
      },
    ]);
  });

  it("an event's line: hidden first, its open places or full, its urgent gaps", () => {
    expect(eventNote(event([session({ urgentGap: true })], { placesFree: 6 }))).toEqual({
      text: "6 open, 1 urgent",
      urgent: true,
    });
    expect(
      eventNote(event([session({ urgentGap: true })], { placesFree: 4, showing: false })),
    ).toEqual({
      text: "Hidden from casuals, 4 open, 1 urgent",
      urgent: false,
    });
    expect(eventNote(event([session({ booked: 4 })], { placesFree: 0 }))).toEqual({
      text: "Full",
      urgent: false,
    });
  });
});
