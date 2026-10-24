import { describe, expect, it } from "vitest";
import { officeMenu } from "@/app/office/office-menu";
import type { CancellationRow } from "@/lib/office/cancellations-copy";
import type { Dashboard, NeedsAttention } from "@/lib/office/dashboard";
import type {
  CancelsChart,
  EventNeed,
  EventsNeedChart,
  FillChart,
  FillDay,
  GapSession,
  LicenceRow,
  LicencesChart,
  OfferRow,
  OffersWeekChart,
  PayWaitingRow,
  WaitedChart,
  WaitedDay,
  WaitedItem,
} from "@/lib/office/dashboard-chart-types";
import {
  ageOf,
  cancelsChart,
  CHART_IDS,
  countCards,
  dashboardModel,
  dayName,
  eventsChart,
  gapRow,
  licencesChart,
  offersChart,
  offersChip,
  placesChart,
  scale,
  waitedChart,
  whenWords,
  type ChartCard,
  type ChartContext,
  type Column,
  type Mark,
  type Panel,
} from "@/lib/office/dashboard-charts";
import { COUNT_ERROR, SECTION_ERROR } from "@/lib/office/dashboard-copy";
import { addDays } from "@/lib/time/zoned";

// The dashboard's charts and count cards as the page draws them (Phase 23, 23.4;
// src/lib/office/dashboard-charts.ts; the approved mock-up, docs/mockups/phase-23/), from made-up
// loader data: each chart's marks (their values, full names and tooltips, the value first), its
// one sentence, its key, its Numbers table, the panel of real rows each mark opens (their chips'
// tones and their links), "Showing the first 50." when a list was capped, what it says when empty
// or unread; days as the firm's calendar days across the clock change (Sun 25 Oct 2026); pay
// queries only for a role that can open Pay. The page and its parts as rendered:
// tests/unit/office.dashboard.test.ts.

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);
const ok = <T>(data: T) => ({ ok: true as const, data });
const failed = { ok: false as const };
// Friday 23 October 2026, 14:00 in London (BST); the clocks go back on Sunday.
const C: ChartContext = { timeZone: TZ, today: "2026-10-23", now: at("2026-10-23T13:00:00Z") };

const marksOf = (c: ChartCard): Mark[] => {
  const b = c.body;
  if (!b) return [];
  if (b.kind === "columns") return b.columns.flatMap((col) => (col.mark ? [col.mark] : []));
  if (b.kind === "bars") return b.rows.map((r) => r.mark);
  if (b.kind === "offers")
    return [
      ...b.keys.flatMap((k) => (k.mark ? [k.mark] : [])),
      ...(b.waiting?.rows.map((r) => r.mark) ?? []),
    ];
  return b.dots.map((d) => d.mark);
};
const columnsOf = (c: ChartCard): Column[] => {
  if (c.body?.kind !== "columns") throw new Error(`${c.id} has no columns`);
  return c.body.columns;
};
const panelOf = (c: ChartCard, key: string): Panel => {
  const m = marksOf(c).find((x) => x.key === key);
  if (!m) throw new Error(`no mark ${key}`);
  return m.panel;
};
// A panel's rows as words: title, line, count, chips (tone: words), then its action and where it
// goes; and its foot.
const rowsOf = (p: Panel) =>
  p.groups.flatMap((g) =>
    g.rows.map((r) =>
      [
        r.title,
        r.href ? `(${r.href})` : null,
        r.sub,
        r.count,
        ...r.chips.map((c) => `[${c.tone}: ${c.text}]`),
        r.action ? `${r.action.label} → ${r.action.href}${r.action.main ? " (main)" : ""}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    ),
  );
const footOf = (p: Panel) => p.foot.map((l) => `${l.label} → ${l.href}`);

// --- Scales and days ------------------------------------------------------------------------

describe("the scale, the days and the ages", () => {
  it("a scale: a round top at or over the biggest value, at most four steps", () => {
    expect(scale(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(scale(3)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
    expect(scale(4)).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
    expect(scale(8)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(scale(11)).toEqual({ max: 12, ticks: [0, 4, 8, 12] });
    expect(scale(37)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
    expect(scale(180)).toEqual({ max: 200, ticks: [0, 50, 100, 150, 200] });
  });

  it("a day's name from today, by the calendar (the clock change can't move it)", () => {
    expect(dayName("2026-10-23", "2026-10-23")).toBe("Today");
    expect(dayName("2026-10-24", "2026-10-23")).toBe("Tomorrow");
    // Sunday 25 October is 25 hours long; Monday is still 3 days on.
    expect(dayName("2026-10-25", "2026-10-23")).toBe("Sunday");
    expect(dayName("2026-10-26", "2026-10-23")).toBe("Monday");
    expect(dayName("2026-10-29", "2026-10-23")).toBe("Thursday");
    expect(dayName("2026-10-30", "2026-10-23")).toBe("Fri 30 Oct");
  });

  it("when something went, on the firm's clock: today, yesterday, or its day", () => {
    // 23:30 UTC on Saturday is 00:30 on Sunday in British Summer Time.
    expect(whenWords(at("2026-10-24T23:30:00Z"), { ...C, today: "2026-10-25" })).toBe(
      "at 00:30 today",
    );
    // After the clocks go back, 23:30 UTC on Sunday is 23:30 on Sunday.
    expect(whenWords(at("2026-10-25T23:30:00Z"), { ...C, today: "2026-10-26" })).toBe(
      "at 23:30 yesterday",
    );
    expect(whenWords(at("2026-10-19T08:05:00Z"), C)).toBe("at 09:05 on Mon 19 Oct");
  });

  it("how long something has waited: today, yesterday, 2–3, 4–6, a week or more (calendar days)", () => {
    expect(
      [
        "2026-10-26",
        "2026-10-25",
        "2026-10-24",
        "2026-10-23",
        "2026-10-22",
        "2026-10-20",
        "2026-10-19",
        "2026-09-01",
      ].map((d) => ageOf(d, "2026-10-26")),
    ).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
    // Across the clock change: Saturday to Monday is 2 days, not 49 hours' worth.
    expect(ageOf("2026-10-24", "2026-10-26")).toBe(2);
  });
});

// --- 1. Places to fill ------------------------------------------------------------------------

const noOffers = { offered: 0, waiting: 0, declined: 0, accepted: 0, stopped: null };
const gap = (o: Partial<GapSession> & Pick<GapSession, "shiftId" | "date">): GapSession => ({
  eventId: "e1",
  eventName: "Northern Lights Live",
  site: "Acme Demo Arena",
  role: "steward",
  startsAt: at(`${o.date}T13:00:00Z`),
  endsAt: at(`${o.date}T21:00:00Z`),
  headcount: 4,
  booked: 3,
  placesFree: 1,
  urgentGap: false,
  hidden: false,
  eventShowing: true,
  showing: true,
  fromSheet: false,
  fromPlanner: false,
  offers: noOffers,
  ...o,
});
// `hidden`: of `open`, the places free in sessions casuals can't see (counted in full, whatever
// rows the chart holds).
const day = (
  date: string,
  places = 0,
  filled = 0,
  open = 0,
  urgent = 0,
  gapSessions = 0,
  hidden = 0,
): FillDay => ({
  date,
  places,
  filled,
  open,
  urgent,
  gapSessions,
  hidden,
});
const fortnight = (first: string, days: FillDay[]): FillDay[] =>
  Array.from({ length: 14 }, (_, i) => {
    const date = addDays(first, i);
    return days.find((d) => d.date === date) ?? day(date);
  });

describe("the places chart's days (the week strip's rules, Phases 18 to 22, from today for 2 weeks)", () => {
  // Wednesday 21 October: today's sessions have ended (5 to mark); Friday's started with 2 places
  // never filled; Sunday is the day the clocks go back.
  const W: ChartContext = { timeZone: TZ, today: "2026-10-21", now: at("2026-10-21T18:00:00Z") };
  const fill: FillChart = {
    first: "2026-10-21",
    days: fortnight("2026-10-21", [
      day("2026-10-21", 5, 5, 0, 0, 0),
      day("2026-10-22", 4, 3, 1, 1, 1),
      day("2026-10-23", 6, 4, 0, 0, 0),
      day("2026-10-24", 21, 19, 2, 1, 2),
      // 1 of its places free is in the session casuals can't see (f).
      day("2026-10-25", 41, 30, 11, 0, 3, 1),
      day("2026-10-26", 2, 2, 0, 0, 0),
    ]),
    gaps: [
      gap({ shiftId: "a", date: "2026-10-22", urgentGap: true }),
      gap({ shiftId: "b", date: "2026-10-24" }),
      gap({
        shiftId: "c",
        date: "2026-10-24",
        urgentGap: true,
        offers: { ...noOffers, offered: 3, waiting: 3 },
      }),
      gap({ shiftId: "d", date: "2026-10-25", headcount: 20, booked: 12, placesFree: 8 }),
      gap({ shiftId: "e", date: "2026-10-25", placesFree: 2, booked: 2 }),
      gap({ shiftId: "f", date: "2026-10-25", hidden: true, eventShowing: false }),
    ],
    more: false,
  };
  const toMark = Array.from({ length: 5 }, () => ({ startsAt: at("2026-10-21T09:30:00Z") }));
  const chart = placesChart(ok(fill), W, toMark);

  it("each day: what's to fill first, then what it is (to mark, urgent, how full, hidden)", () => {
    const cols = columnsOf(chart);
    expect(cols).toHaveLength(14);
    expect(cols.map((c) => c.key)).toEqual(
      Array.from({ length: 14 }, (_, i) => addDays("2026-10-21", i)),
    );
    expect(cols.slice(0, 7).map((c) => [c.top, c.bottom, c.mark?.aria ?? null])).toEqual([
      ["Today", "21", "Every place filled. Wed 21 Oct, today: 5 to mark, 5 of 5 places filled."],
      ["Thu", "22", "1 place to fill. Thu 22 Oct: 1 urgent, 3 of 4 places filled."],
      // Places never filled, its sessions started: how many were.
      ["Fri", "23", "4 of 6 filled. Fri 23 Oct."],
      ["Sat", "24", "2 places to fill. Sat 24 Oct: 1 urgent, 19 of 21 places filled."],
      [
        "Sun",
        "25",
        "11 places to fill. Sun 25 Oct: 30 of 41 places filled, some hidden from casuals.",
      ],
      ["Mon", "26", "Every place filled. Mon 26 Oct: 2 of 2 places filled."],
      // Nothing on: no mark (not a button).
      ["Tue", "27", null],
    ]);
    // The tooltip: the value first, then what it is; the name is the two.
    for (const c of cols)
      if (c.mark) expect(c.mark.aria).toBe(`${c.mark.tip.value} ${c.mark.tip.label}`);
    expect(cols[3]!.mark!.tip).toEqual({
      value: "2 places to fill.",
      label: "Sat 24 Oct: 1 urgent, 19 of 21 places filled.",
    });
    // Urgent at the baseline, the rest of the gap over it; a full day's tick; today marked.
    expect(
      cols
        .map((c) => [
          c.segments.map((s) => `${s.tone} ${s.value}`).join(", "),
          c.total,
          c.full,
          c.now,
          c.dim,
        ])
        .slice(0, 7),
    ).toEqual([
      ["", 0, true, true, false],
      ["urgent 1", 1, false, false, false],
      ["", 0, false, false, false],
      ["urgent 1, open 1", 2, false, false, false],
      ["open 11", 11, false, false, false],
      ["", 0, true, false, false],
      ["", 0, false, false, true],
    ]);
  });

  it("a day's panel: its sessions with places free, urgent first, each with Offer; its sessions to mark; the day's list and the rota board", () => {
    const sat = panelOf(chart, "places-chart:2026-10-24");
    expect(sat.title).toBe("Sat 24 Oct: 2 places to fill");
    expect(sat.sub).toBe("19 of 21 places filled. 1 urgent.");
    expect(rowsOf(sat)).toEqual([
      "Steward, Northern Lights Live | (/office/shifts/c) | Sat 24 Oct, 14:00–22:00 at Acme Demo Arena. 3 of 4 filled. | [urgent: Urgent] | [wait: 3 waiting for a reply] | Offer → /office/offer/c (main)",
      "Steward, Northern Lights Live | (/office/shifts/b) | Sat 24 Oct, 14:00–22:00 at Acme Demo Arena. 3 of 4 filled. | [attention: Not offered yet] | Offer → /office/offer/b",
    ]);
    expect(footOf(sat)).toEqual([
      "See this day's sessions → /office/shifts?from=2026-10-24",
      "Open the rota board → /office/events",
    ]);
    expect(footOf(panelOf(chart, "places-chart:2026-10-22"))[0]).toBe(
      "See this day's sessions → /office/shifts?from=2026-10-22",
    );
    // Sunday (25 hours long): the biggest gap first, the hidden one without Offer (its page has its
    // switch), and its time in Greenwich Mean Time.
    const sun = panelOf(chart, "places-chart:2026-10-25");
    expect(rowsOf(sun)).toEqual([
      "Steward, Northern Lights Live | (/office/shifts/d) | Sun 25 Oct, 13:00–21:00 at Acme Demo Arena. 12 of 20 filled. | [attention: Not offered yet] | Offer → /office/offer/d",
      "Steward, Northern Lights Live | (/office/shifts/e) | Sun 25 Oct, 13:00–21:00 at Acme Demo Arena. 2 of 4 filled. | [attention: Not offered yet] | Offer → /office/offer/e",
      "Steward, Northern Lights Live | (/office/shifts/f) | Sun 25 Oct, 13:00–21:00 at Acme Demo Arena. 3 of 4 filled. | [quiet: Hidden from casuals] | [attention: Not offered yet]",
    ]);
    // Today: its sessions to mark first (the strip's "to mark" day went to Needs attention's
    // "Who worked?"), and every place filled.
    const today = panelOf(chart, "places-chart:2026-10-21");
    expect(today.title).toBe("Wed 21 Oct: every place is filled");
    expect(today.groups.map((g) => [g.label, g.empty])).toEqual([
      ["Needs you", null],
      ["Places to fill", "Every place is filled."],
    ]);
    expect(rowsOf(today)).toEqual([
      "Who worked? | 5 sessions to mark | 5 | Mark who worked → /office/needs-attention#to-mark",
    ]);
    // Started with places never filled: nothing left to fill, said so.
    const fri = panelOf(chart, "places-chart:2026-10-23");
    expect(fri.title).toBe("Fri 23 Oct: nothing left to fill");
    expect(fri.groups[0]!.empty).toBe(
      "No places are left to fill: the sessions with places free have started.",
    );
    // More sessions that day than the chart's rows held: said so.
    const capped = placesChart(ok({ ...fill, gaps: fill.gaps.slice(0, 4), more: true }), W);
    expect(panelOf(capped, "places-chart:2026-10-25").groups[0]!.more).toBe("Showing the first 1.");
    expect(
      panelOf(placesChart(ok({ ...fill, gaps: [] }), W), "places-chart:2026-10-25").groups[0]!.more,
    ).toBe("See this day's sessions for the list.");
  });

  it("its one sentence, its key, its table, the rota board, and its empty and unread states", () => {
    // From today: 14 places still to fill (Phases 18 to 22's "14 places still to fill"), Sunday
    // the most; a day whose sessions started (Friday) adds nothing.
    expect(chart.take).toBe(
      "Sunday needs 11 more people. 1 place in the next 2 weeks is hidden from casuals.",
    );
    // The hidden places are the days' own counts: none of them hidden, the total (the hidden row
    // the chart holds, f, adds nothing of its own); none of the rows held, still the days'.
    expect(
      placesChart(ok({ ...fill, days: fill.days.map((d) => ({ ...d, hidden: 0 })) }), W).take,
    ).toBe("Sunday needs 11 more people. 14 places to fill in all.");
    expect(placesChart(ok({ ...fill, gaps: [] }), W).take).toBe(
      "Sunday needs 11 more people. 1 place in the next 2 weeks is hidden from casuals.",
    );
    expect(
      placesChart(
        ok({
          ...fill,
          days: fortnight("2026-10-21", [day("2026-10-24", 21, 19, 2, 1, 2)]),
          gaps: [],
        }),
        W,
      ).take,
    ).toBe("Saturday needs 2 more people, 1 of them urgently.");
    // Every place filled only when every day's is.
    expect(
      placesChart(ok({ ...fill, days: fortnight("2026-10-21", [day("2026-10-26", 2, 2)]) }), W)
        .take,
    ).toBe("Every place in the next 2 weeks is filled.");
    // A session today that started with places free (1 of 3 booked) and nothing else open:
    // nothing is left to fill, but its places aren't filled (its column says so, with no tick).
    const started = placesChart(
      ok({
        ...fill,
        days: fortnight("2026-10-21", [day("2026-10-21", 3, 1), day("2026-10-26", 2, 2)]),
        gaps: [],
      }),
      W,
    );
    expect(started.take).toBe("Nothing is left to fill in the next 2 weeks.");
    expect([columnsOf(started)[0]!.full, columnsOf(started)[0]!.mark?.tip.value]).toEqual([
      false,
      "1 of 3 filled.",
    ]);
    expect(chart.legend).toEqual([
      { tone: "urgent", label: "Urgent" },
      { tone: "open", label: "To fill" },
      { tone: "tick", label: "Every place filled" },
    ]);
    expect(chart.tables).toEqual([
      {
        caption: null,
        head: ["Day", "Urgent", "To fill", "Filled", "Places"],
        rows: [
          ["Wed 21 Oct", "0", "0", "5", "5"],
          ["Thu 22 Oct", "1", "0", "3", "4"],
          ["Fri 23 Oct", "0", "0", "4", "6"],
          ["Sat 24 Oct", "1", "1", "19", "21"],
          ["Sun 25 Oct", "0", "11", "30", "41"],
          ["Mon 26 Oct", "0", "0", "2", "2"],
        ],
      },
    ]);
    expect(chart.body).toMatchObject({
      kind: "columns",
      max: 12,
      ticks: [0, 4, 8, 12],
      end: false,
    });
    expect([chart.hint, chart.swipe]).toEqual([
      "Pick a day to see its sessions.",
      "Swipe for later days.",
    ]);
    expect(chart.notes).toEqual([
      { text: null, links: [{ text: "Open the rota board", href: "/office/events" }] },
    ]);
    const none = placesChart(ok({ ...fill, days: fortnight("2026-10-21", []), gaps: [] }), W);
    expect([none.empty, none.body, none.error]).toEqual([
      "No sessions in the next 2 weeks.",
      null,
      false,
    ]);
    expect(none.notes[0]!.links[0]!.href).toBe("/office/events");
    const unread = placesChart(failed, W);
    expect([unread.error, unread.body, unread.title, unread.id]).toEqual([
      true,
      null,
      "Places to fill, next 2 weeks",
      "places-chart",
    ]);
  });

  it("hidden from casuals: each day's own count, past the 50 rows the chart holds", () => {
    // The rows held are all seen by casuals; the hidden session (f) and Monday 2 November's 6
    // hidden places sit past the cap.
    const capped = placesChart(
      ok({
        ...fill,
        days: fill.days.map((d) => (d.date === "2026-11-02" ? day(d.date, 6, 0, 6, 0, 2, 6) : d)),
        gaps: fill.gaps.filter((g) => !g.hidden),
        more: true,
      }),
      W,
    );
    expect(capped.take).toBe(
      "Sunday needs 11 more people. 7 places in the next 2 weeks are hidden from casuals.",
    );
    const aria = (date: string) => columnsOf(capped).find((c) => c.key === date)?.mark?.aria;
    expect(aria("2026-10-25")).toBe(
      "11 places to fill. Sun 25 Oct: 30 of 41 places filled, some hidden from casuals.",
    );
    expect(aria("2026-11-02")).toBe(
      "6 places to fill. Mon 2 Nov: 0 of 6 places filled, some hidden from casuals.",
    );
    // A day with none hidden never says so.
    expect(aria("2026-10-24")).toBe(
      "2 places to fill. Sat 24 Oct: 1 urgent, 19 of 21 places filled.",
    );
    expect(panelOf(capped, "places-chart:2026-11-02").groups[0]!.more).toBe(
      "See this day's sessions for the list.",
    );
  });

  it("a session's offers as a chip: replies to come, stopped, not offered, said no, offered", () => {
    expect(offersChip({ ...noOffers, offered: 3, waiting: 2, declined: 1 })).toEqual({
      tone: "wait",
      text: "2 waiting for a reply",
    });
    expect(offersChip({ ...noOffers, offered: 6, stopped: "no_candidates" })).toEqual({
      tone: "quiet",
      text: "Offers stopped",
    });
    expect(offersChip(noOffers)).toEqual({ tone: "attention", text: "Not offered yet" });
    expect(offersChip({ ...noOffers, offered: 2, declined: 2 })).toEqual({
      tone: "quiet",
      text: "2 said no",
    });
    expect(offersChip({ ...noOffers, offered: 1 })).toEqual({
      tone: "quiet",
      text: "Offered to 1 casual",
    });
    expect(
      gapRow(gap({ shiftId: "z", date: "2026-10-24", site: null, role: "csas_officer" }), TZ).title,
    ).toBe("CSAS officer, Northern Lights Live");
  });
});

// --- 2. Which events need people ----------------------------------------------------------------

const event = (o: Partial<EventNeed> & Pick<EventNeed, "eventId" | "name">): EventNeed => ({
  site: "Acme Demo Arena",
  places: 4,
  urgent: 0,
  gapSessions: 1,
  firstGap: at("2026-10-24T13:00:00Z"),
  showing: true,
  hiddenSessions: false,
  hidden: false,
  sessions: [],
  moreSessions: false,
  ...o,
});

describe("which events need people", () => {
  const needs: EventsNeedChart = {
    events: [
      event({
        eventId: "e1",
        name: "Northern Lights Live",
        places: 8,
        urgent: 2,
        gapSessions: 3,
        sessions: [
          gap({ shiftId: "s1", date: "2026-10-24", urgentGap: true, placesFree: 2, booked: 2 }),
        ],
        moreSessions: true,
      }),
      event({
        eventId: "e2",
        name: "Hillside Christmas Market",
        site: null,
        places: 8,
        showing: false,
        hidden: true,
      }),
      event({ eventId: "e3", name: "Raceday", places: 2, hiddenSessions: true, hidden: true }),
    ],
    more: 2,
    total: { events: 5, places: 21, urgent: 2 },
    hiddenEvents: 2,
    full: ["Northgate Charity 10K", "Riverside Food Festival"],
    fullMore: 1,
  };
  const chart = eventsChart(ok(needs), C);

  it("a bar each, urgent part first, hidden marked; its sentence from the data; the full ones named", () => {
    if (chart.body?.kind !== "bars") throw new Error("bars");
    expect(chart.body.max).toBe(8);
    expect(
      chart.body.rows.map((r) => [r.name, r.hidden, r.segments, r.total, r.mark.aria]),
    ).toEqual([
      [
        "Northern Lights Live",
        false,
        [
          { tone: "urgent", value: 2 },
          { tone: "open", value: 6 },
        ],
        8,
        "8 places to fill. Northern Lights Live: 2 urgent.",
      ],
      [
        "Hillside Christmas Market",
        true,
        [{ tone: "open", value: 8 }],
        8,
        "8 places to fill. Hillside Christmas Market: hidden from casuals.",
      ],
      [
        "Raceday",
        true,
        [{ tone: "open", value: 2 }],
        2,
        "2 places to fill. Raceday: some sessions hidden from casuals.",
      ],
    ]);
    // The number counts events, and says so (never "2 of them", read as 2 of the people).
    expect(chart.take).toBe(
      "Northern Lights Live needs 8 more people, 2 of them urgently. 2 events have gaps casuals can't see.",
    );
    expect(
      eventsChart(ok({ ...needs, events: [needs.events[1]!, needs.events[2]!] }), C).take,
    ).toBe("Hillside Christmas Market needs 8 more people. 2 events have gaps casuals can't see.");
    expect(chart.notes).toEqual([
      { text: "Northgate Charity 10K, Riverside Food Festival and 1 more are full.", links: [] },
      {
        text: "2 more events need people.",
        links: [{ text: "See every event that needs people", href: "/office/events?view=need" }],
      },
    ]);
    expect(chart.tables[0]!.rows).toEqual([
      ["Northern Lights Live", "2", "6", "No"],
      ["Hillside Christmas Market", "0", "8", "Yes"],
      ["Raceday", "0", "2", "Yes"],
    ]);
    expect(chart.hint).toBe("Pick an event to see the sessions with gaps.");
    // One hidden: named; a session hidden on its own: said so; none: the total.
    expect(
      eventsChart(
        ok({ ...needs, events: [needs.events[0]!, needs.events[1]!], hiddenEvents: 1 }),
        C,
      ).take,
    ).toBe(
      "Northern Lights Live needs 8 more people, 2 of them urgently. Casuals can't see Hillside Christmas Market yet.",
    );
    expect(
      eventsChart(
        ok({ ...needs, events: [needs.events[0]!, needs.events[2]!], hiddenEvents: 1 }),
        C,
      ).take,
    ).toBe(
      "Northern Lights Live needs 8 more people, 2 of them urgently. Some of Raceday's sessions are hidden from casuals.",
    );
    expect(eventsChart(ok({ ...needs, events: [needs.events[0]!], hiddenEvents: 0 }), C).take).toBe(
      "Northern Lights Live needs 8 more people, 2 of them urgently. 5 events need 21 people in all.",
    );
  });

  // The bars are the 8 most urgent; the sentence counts every event with a gap casuals can't see.
  it("hidden events past the 8 bars: counted in the sentence, never only the bars", () => {
    // 10 events need people; those ranked 2, 5 and 9 are hidden, and the first 8 are drawn.
    const ten = Array.from({ length: 10 }, (_, i) =>
      event({
        eventId: `r${i + 1}`,
        name: `Event ${i + 1}`,
        places: 20 - i,
        ...([1, 4, 8].includes(i) ? { showing: false, hidden: true } : {}),
      }),
    );
    const eight: EventsNeedChart = {
      ...needs,
      events: ten.slice(0, 8),
      more: 2,
      total: { events: 10, places: 155, urgent: 0 },
      hiddenEvents: 3,
    };
    expect(eight.events.filter((e) => e.hidden)).toHaveLength(2);
    expect(eventsChart(ok(eight), C).take).toBe(
      "Event 1 needs 20 more people. 3 events have gaps casuals can't see.",
    );
    // The only hidden one is the 9th, not drawn: counted, not named.
    const none = ten.slice(0, 8).map((e) => ({ ...e, showing: true, hidden: false }));
    expect(eventsChart(ok({ ...eight, events: none, hiddenEvents: 1 }), C).take).toBe(
      "Event 1 needs 20 more people. 1 event has gaps casuals can't see.",
    );
    // One drawn and one past the bars: two, never the drawn one named alone.
    expect(
      eventsChart(
        ok({ ...eight, events: [none[0]!, ten[1]!, ...none.slice(2)], hiddenEvents: 2 }),
        C,
      ).take,
    ).toBe("Event 1 needs 20 more people. 2 events have gaps casuals can't see.");
  });

  it("an event's panel: its sessions with places free, the event's page and every event that needs people", () => {
    const p = panelOf(chart, "events-chart:e1");
    expect(p.title).toBe("Northern Lights Live: 8 places to fill");
    expect(p.sub).toBe("Acme Demo Arena. 3 sessions with places free.");
    expect(rowsOf(p)).toEqual([
      "Steward, Northern Lights Live | (/office/shifts/s1) | Sat 24 Oct, 14:00–22:00 at Acme Demo Arena. 2 of 4 filled. | [urgent: Urgent] | [attention: Not offered yet] | Offer → /office/offer/s1 (main)",
    ]);
    expect(p.groups[0]!.more).toBe("Showing the first 1.");
    expect(footOf(p)).toEqual([
      "Open this event → /office/events/e1",
      "See every event that needs people → /office/events?view=need",
    ]);
    expect(panelOf(chart, "events-chart:e2").sub).toBe(
      "1 session with places free. Casuals can't see this event yet.",
    );
    expect(panelOf(chart, "events-chart:e3").sub).toBe(
      "Acme Demo Arena. 1 session with places free. Some of its sessions are hidden from casuals.",
    );
  });

  // Only what was loaded is said: an event to come whose sessions are drafts, or whose gap has
  // started, is neither in the list nor full, so never "every event to come has the people it
  // needs" or "no events have sessions to come".
  it("none need people: said so, with or without full events (named under it); unread: said so", () => {
    const none = eventsChart(
      ok({
        ...needs,
        events: [],
        more: 0,
        total: { events: 0, places: 0, urgent: 0 },
        hiddenEvents: 0,
      }),
      C,
    );
    expect([none.empty, none.body]).toEqual(["No event needs people right now.", null]);
    expect(none.notes).toEqual([
      { text: "Northgate Charity 10K, Riverside Food Festival and 1 more are full.", links: [] },
    ]);
    const noneFull = eventsChart(
      ok({
        ...needs,
        events: [],
        full: [],
        fullMore: 0,
        more: 0,
        total: { events: 0, places: 0, urgent: 0 },
        hiddenEvents: 0,
      }),
      C,
    );
    expect([noneFull.empty, noneFull.body, noneFull.notes]).toEqual([
      "No event needs people right now.",
      null,
      [],
    ]);
    expect(eventsChart(failed, C).error).toBe(true);
  });
});

// --- 3. Offers this week ------------------------------------------------------------------------

const offer = (o: Partial<OfferRow> & Pick<OfferRow, "offerId" | "state">): OfferRow => ({
  shiftId: "s1",
  workerId: "w1",
  casual: "Ella Shaw",
  role: "steward",
  eventName: "Northern Lights Live",
  startsAt: at("2026-10-24T13:00:00Z"),
  sentAt: at("2026-10-22T08:12:00Z"),
  answeredAt: null,
  byOffice: false,
  why: null,
  ...o,
});
const week: OffersWeekChart = {
  week: { monday: "2026-10-19", sunday: "2026-10-25" },
  counts: { yes: 21, waiting: 9, closed: 16 },
  closedWhy: { said_no: 11, filled_elsewhere: 2, changed: 1, no_reply: 2 },
  rows: {
    yes: [
      offer({
        offerId: "y1",
        state: "yes",
        casual: "Aisha Khan",
        answeredAt: at("2026-10-23T09:40:00Z"),
      }),
    ],
    waiting: [
      offer({ offerId: "w1", state: "waiting", sentAt: at("2026-10-23T09:40:00Z") }),
      offer({ offerId: "w2", state: "waiting", casual: "Jack Moss" }),
      offer({
        offerId: "w3",
        state: "waiting",
        shiftId: "s2",
        casual: "Kofi Mensah",
        role: "csas_officer",
        eventName: "Night patrols",
        startsAt: at("2026-10-25T19:00:00Z"),
      }),
    ],
    closed: [
      offer({ offerId: "c1", state: "closed", why: "said_no", casual: "Dan Morris" }),
      offer({ offerId: "c2", state: "closed", why: "no_reply", casual: "Finn Doyle" }),
    ],
  },
  more: { yes: true, waiting: false, closed: true },
  waitingSessions: [
    {
      shiftId: "s1",
      role: "steward",
      eventName: "Northern Lights Live",
      startsAt: at("2026-10-24T13:00:00Z"),
      endsAt: at("2026-10-24T22:00:00Z"),
      waiting: 2,
    },
    {
      shiftId: "s2",
      role: "csas_officer",
      eventName: "Night patrols",
      startsAt: at("2026-10-25T19:00:00Z"),
      endsAt: at("2026-10-26T01:00:00Z"),
      waiting: 4,
    },
  ],
  waitingSessionsMore: false,
};

describe("offers this week", () => {
  const chart = offersChart(ok(week), C);

  it("one bar of three parts, each a number to pick, its share; the sessions still waiting", () => {
    if (chart.body?.kind !== "offers") throw new Error("offers");
    expect(chart.body.total).toBe(46);
    expect(chart.body.aria).toBe("21 said yes, 9 waiting for a reply, 16 said no or closed");
    expect(chart.body.keys.map((k) => [k.key, k.tone, k.n, k.pct, k.mark?.aria])).toEqual([
      ["yes", "done", 21, 46, "21 of 46, 46%. Said yes."],
      ["waiting", "wait", 9, 20, "9 of 46, 20%. Waiting for a reply."],
      ["closed", "calm", 16, 35, "16 of 46, 35%. Said no or closed."],
    ]);
    expect(chart.body.waiting?.rows.map((r) => [r.name, r.sub, r.total, r.mark.aria])).toEqual([
      [
        "Steward, Northern Lights Live",
        "Sat 24 Oct, 14:00–23:00",
        2,
        "2 replies to come. Steward, Northern Lights Live, Sat 24 Oct, 14:00–23:00.",
      ],
      // After the clocks go back: 19:00 GMT.
      [
        "CSAS officer, Night patrols",
        "Sun 25 Oct, 19:00–01:00",
        4,
        "4 replies to come. CSAS officer, Night patrols, Sun 25 Oct, 19:00–01:00.",
      ],
    ]);
    expect(chart.tables).toEqual([
      {
        caption: null,
        head: ["Answer", "Offers", "Share"],
        rows: [
          ["Said yes", "21", "46%"],
          ["Waiting for a reply", "9", "20%"],
          ["Said no or closed", "16", "35%"],
        ],
      },
      {
        caption: "Still waiting for a reply",
        head: ["Session", "Replies to come"],
        rows: [
          ["Steward, Northern Lights Live, Sat 24 Oct, 14:00–23:00", "2"],
          ["CSAS officer, Night patrols, Sun 25 Oct, 19:00–01:00", "4"],
        ],
      },
    ]);
    // A part with none isn't a mark to pick.
    const noneYes = offersChart(ok({ ...week, counts: { yes: 0, waiting: 9, closed: 16 } }), C);
    if (noneYes.body?.kind !== "offers") throw new Error("offers");
    expect(noneYes.body.keys[0]!.mark).toBeNull();
  });

  it("its sentence: how many went, how many wait and since when (the oldest, when every one is loaded)", () => {
    expect(chart.take).toBe(
      "46 offers went out this week. 9 haven't had a reply yet; the oldest went at 09:12 yesterday.",
    );
    expect(offersChart(ok({ ...week, more: { ...week.more, waiting: true } }), C).take).toBe(
      "46 offers went out this week. 9 haven't had a reply yet.",
    );
    expect(
      offersChart(
        ok({
          ...week,
          counts: { yes: 1, waiting: 1, closed: 0 },
          rows: { ...week.rows, waiting: [week.rows.waiting[0]!] },
        }),
        C,
      ).take,
    ).toBe("2 offers went out this week. 1 hasn't had a reply yet; it went at 10:40 today.");
    expect(offersChart(ok({ ...week, counts: { yes: 3, waiting: 0, closed: 1 } }), C).take).toBe(
      "4 offers went out this week. 3 said yes.",
    );
    expect(offersChart(ok({ ...week, counts: { yes: 0, waiting: 0, closed: 0 } }), C).empty).toBe(
      "No offers have gone out this week.",
    );
    expect(offersChart(failed, C).error).toBe(true);
  });

  it("each part's panel: who, for what, when; why the closed ones closed; their session; the week's notice report", () => {
    const closed = panelOf(chart, "offers-chart:closed");
    expect(closed.title).toBe("16 offers said no or closed");
    expect(closed.sub).toBe(
      "11 said no, 2 went to someone else, 1 closed when the session changed, 2 had no reply before it started.",
    );
    expect(rowsOf(closed)).toEqual([
      "Dan Morris | Steward, Northern Lights Live. 14:00 on Sat 24 Oct. Sent 09:12 on Thu 22 Oct. | [quiet: Said no] | Open the session → /office/shifts/s1",
      "Finn Doyle | Steward, Northern Lights Live. 14:00 on Sat 24 Oct. Sent 09:12 on Thu 22 Oct. | [quiet: No reply] | Open the session → /office/shifts/s1",
    ]);
    expect(closed.groups[0]!.more).toBe("Showing the first 2.");
    expect(footOf(closed)).toEqual([
      "Open the notice report → /office/reports/notice?kind=offers&from=2026-10-19&to=2026-10-23",
    ]);
    const yes = panelOf(chart, "offers-chart:yes");
    expect([yes.title, yes.sub]).toEqual(["21 casuals said yes", "They were booked."]);
    expect(rowsOf(yes)).toEqual([
      "Aisha Khan | Steward, Northern Lights Live. 14:00 on Sat 24 Oct. Said yes 10:40 on Fri 23 Oct. | [done: Said yes] | Open the session → /office/shifts/s1",
    ]);
    const waiting = panelOf(chart, "offers-chart:waiting");
    expect([waiting.title, waiting.sub, waiting.groups[0]!.more]).toEqual([
      "9 offers waiting for a reply",
      "No answer yet. The first to say yes gets the place.",
      null,
    ]);
    expect(rowsOf(waiting)[0]).toBe(
      "Ella Shaw | Steward, Northern Lights Live. 14:00 on Sat 24 Oct. Sent 10:40 on Fri 23 Oct. | [wait: Waiting] | Open the session → /office/shifts/s1",
    );
    // A session's replies to come: its offers waiting, the session, and Offer.
    const s2 = panelOf(chart, "offers-chart:session:s2");
    expect([s2.title, s2.sub]).toEqual([
      "CSAS officer, Night patrols: 4 replies to come",
      "Sun 25 Oct, 19:00–01:00. The first to say yes gets the place.",
    ]);
    expect(rowsOf(s2)).toEqual([
      "Kofi Mensah | CSAS officer, Night patrols. 19:00 on Sun 25 Oct. Sent 09:12 on Thu 22 Oct. | [wait: Waiting] | Open the session → /office/shifts/s2",
    ]);
    expect(s2.groups[0]!.more).toBe("Showing the first 1.");
    expect(footOf(s2)).toEqual([
      "Open the session → /office/shifts/s2",
      "Offer it to someone else → /office/offer/s2",
    ]);
    // An offer row is titled with the casual, so its link names where it goes: the session's
    // page, never a bare "Open" beside a person's name.
    const offerRows = [
      ...(["yes", "waiting", "closed"] as const).map((s) => panelOf(chart, `offers-chart:${s}`)),
      s2,
    ].flatMap((p) => p.groups.flatMap((g) => g.rows));
    expect(offerRows.length).toBeGreaterThan(0);
    for (const r of offerRows) {
      expect(r.action?.label).toBe("Open the session");
      expect(r.action?.href).toMatch(/^\/office\/shifts\/s[12]$/);
    }
  });
});

// --- 4. How long things have waited -------------------------------------------------------------

const kinds = (o: Partial<WaitedDay["needsYou"]>): WaitedDay["needsYou"] => ({
  "to-mark": 0,
  uploads: 0,
  enquiries: 0,
  evidence: 0,
  "planner-refused": 0,
  webhook: 0,
  ...o,
});
// An enquiry as a loader might hand it over with the message's words by mistake: no panel shows
// them (a variable, not a literal in the list, so the extra field type-checks).
const enquiryWithWords = {
  kind: "enquiries" as const,
  since: at("2026-10-26T08:00:00Z"),
  day: "2026-10-26",
  messageId: "m1",
  channel: "whatsapp" as const,
  who: { kind: "withheld" as const },
  text: "Their own words, never shown",
};
const items: WaitedItem[] = [
  {
    kind: "to-mark",
    since: at("2026-10-24T17:00:00Z"),
    day: "2026-10-24",
    shiftId: "m1",
    role: "steward",
    site: "Acme Demo Arena",
    startsAt: at("2026-10-24T09:00:00Z"),
    endsAt: at("2026-10-24T17:00:00Z"),
    unmarked: 2,
  },
  {
    kind: "uploads",
    since: at("2026-10-25T23:40:00Z"),
    day: "2026-10-25",
    uploadId: "up1",
    workerId: "w6",
    casual: "Omar Price",
    upload: "certificate",
    qualificationName: "first aid certificate",
  },
  enquiryWithWords,
  {
    kind: "evidence",
    since: at("2026-10-26T07:00:00Z"),
    day: "2026-10-26",
    assignmentId: "a1",
    casual: "Ann Booker",
    stuck: true,
    nothingSent: false,
  },
  {
    kind: "planner-refused",
    since: at("2026-10-12T08:30:00Z"),
    day: "2026-10-12",
    shiftId: "p1",
    role: "door_supervisor",
    site: null,
    startsAt: at("2026-10-31T10:00:00Z"),
    why: "move",
    casuals: 1,
  },
  { kind: "webhook", since: at("2026-10-12T03:10:00Z"), day: "2026-10-12" },
];
const payRows: PayWaitingRow[] = [
  {
    payQueryId: "q1",
    workerId: "w2",
    casual: "Maya Cole",
    issue: "late_pay",
    workDate: "2026-09-28",
    since: at("2026-10-16T09:00:00Z"),
    day: "2026-10-16",
    inDigest: true,
  },
];
// Monday 26 October, after the clocks went back.
const M: ChartContext = { timeZone: TZ, today: "2026-10-26", now: at("2026-10-26T12:00:00Z") };
const waited = (pay: boolean): WaitedChart => ({
  today: "2026-10-26",
  days: [
    { day: "2026-10-12", needsYou: kinds({ "planner-refused": 1, webhook: 1 }) },
    { day: "2026-10-24", needsYou: kinds({ "to-mark": 1 }) },
    { day: "2026-10-25", needsYou: kinds({ uploads: 60 }) },
    { day: "2026-10-26", needsYou: kinds({ enquiries: 1, evidence: 1 }) },
  ],
  items,
  more: {
    "to-mark": false,
    uploads: true,
    enquiries: false,
    evidence: false,
    "planner-refused": false,
    webhook: false,
  },
  undated: { toCheck: 2, fromSheet: 0, expired: 1, strikesAddress: 1 },
  needsYouTotal: 69,
  needsYouMore: false,
  pay: pay
    ? { total: 3, days: [{ day: "2026-10-16", count: 3 }], rows: payRows, more: false }
    : null,
});

describe("how long things have waited", () => {
  it("five ages, what needs you and (only for a role that can open Pay) what's with payroll", () => {
    const admin = waitedChart(ok(waited(true)), M);
    expect(columnsOf(admin).map((c) => [c.bottom, c.segments, c.mark?.aria ?? null])).toEqual([
      [
        "Today",
        [{ tone: "open", value: 2 }],
        "2 things waiting. Today: 2 for you, 0 with payroll.",
      ],
      // The clock change's own day: still yesterday.
      [
        "Yesterday",
        [{ tone: "open", value: 60 }],
        "60 things waiting. Yesterday: 60 for you, 0 with payroll.",
      ],
      [
        "2–3 days",
        [{ tone: "open", value: 1 }],
        "1 thing waiting. 2–3 days: 1 for you, 0 with payroll.",
      ],
      ["4–6 days", [], null],
      [
        "A week or more",
        [
          { tone: "open", value: 2 },
          { tone: "wait", value: 3 },
        ],
        "5 things waiting. A week or more: 2 for you, 3 with payroll.",
      ],
    ]);
    expect(admin.legend).toEqual([
      { tone: "open", label: "Needs you" },
      { tone: "wait", label: "With payroll" },
    ]);
    expect(admin.tables[0]!.head).toEqual(["Waited", "Needs you", "With payroll"]);
    expect(admin.take).toBe(
      "2 things for you and 3 pay queries with payroll have waited a week or more.",
    );
    // A resourcer: no pay query anywhere (no count, row, name or issue: the loader read none).
    const resourcer = waitedChart(ok(waited(false)), M);
    expect(resourcer.legend).toEqual([{ tone: "open", label: "Needs you" }]);
    expect(resourcer.tables[0]!.head).toEqual(["Waited", "Needs you"]);
    expect(columnsOf(resourcer)[4]!.mark?.aria).toBe(
      "2 things waiting. A week or more: 2 for you.",
    );
    expect(resourcer.take).toBe("2 things for you have waited a week or more.");
    const json = JSON.stringify(resourcer);
    for (const word of ["payroll", "Maya Cole", "Paid late", "/office/pay-queries"])
      expect(json).not.toContain(word);
    // The words of a message never reach a panel.
    expect(JSON.stringify(admin)).not.toContain("Their own words");
  });

  it("an age's panel: each thing for you (oldest first) to where it's dealt with, then payroll's", () => {
    const admin = waitedChart(ok(waited(true)), M);
    const old = panelOf(admin, "waited-chart:4");
    expect([old.title, old.sub]).toEqual([
      "A week or more: 5 things waiting",
      "2 for you, 3 with payroll.",
    ]);
    expect(old.groups.map((g) => [g.label, g.more])).toEqual([
      ["Needs you", null],
      ["With payroll", "Showing the first 1."],
    ]);
    expect(rowsOf(old)).toEqual([
      "Your planner's webhook is failing | Failing since 04:10 on Mon 12 Oct. | [attention: Webhook] | See it → /office/needs-attention#webhook",
      "Door supervisor | Your planner's change was refused 09:30 on Mon 12 Oct. The session is on Sat 31 Oct. | [attention: Planner] | Open → /office/shifts/p1",
      "Maya Cole: Paid late or not paid | For Mon 28 Sep. Sent 10:00 on Fri 16 Oct. | [wait: In payroll's digest]",
    ]);
    expect(footOf(old)).toEqual([
      "Open Needs attention → /office/needs-attention",
      "Open the pay queries → /office/pay-queries",
    ]);
    expect(rowsOf(panelOf(admin, "waited-chart:0"))).toEqual([
      "Ann Booker's strike record | It hasn't been emailed to the strikes team. Cancelled 07:00 on Mon 26 Oct. | [attention: Strike evidence] | Open → /office/cancellations/a1",
      "A message from a withheld number | WhatsApp, 08:00 on Mon 26 Oct. | [attention: Needs a person] | Answer → /office/enquiries/m1",
    ]);
    // 60 uploads yesterday, 1 of them loaded: said so; each to the casual's uploads.
    const yesterday = panelOf(admin, "waited-chart:1");
    expect(rowsOf(yesterday)).toEqual([
      "Omar Price's first aid certificate | Uploaded 23:40 on Sun 25 Oct. | [attention: Upload] | Check → /office/casuals/w6#uploads",
    ]);
    expect(yesterday.groups[0]!.more).toBe("Showing the first 1.");
    expect(rowsOf(panelOf(admin, "waited-chart:2"))).toEqual([
      "Steward at Acme Demo Arena | Sat 24 Oct, 10:00–18:00. 2 people not marked yet. | [attention: To mark] | Mark who worked → /office/shifts/m1",
    ]);
  });

  it("what has no date of its own, named under the chart, each to its part of Needs attention", () => {
    const chart = waitedChart(ok(waited(false)), M);
    expect(chart.notes).toEqual([
      {
        text: "Not counted by age:",
        links: [
          { text: "2 bookings to check", href: "/office/needs-attention#to-check" },
          {
            text: "1 qualification out of date on a booking",
            href: "/office/needs-attention#expired",
          },
          { text: "The strikes team's email to set", href: "/office/needs-attention#evidence" },
        ],
      },
    ]);
    const onlyUndated = waitedChart(ok({ ...waited(false), days: [], items: [] }), M);
    expect([onlyUndated.empty, onlyUndated.notes.length]).toEqual([
      "Nothing with a date of its own is waiting.",
      1,
    ]);
    expect(
      waitedChart(
        ok({
          ...waited(false),
          days: [],
          items: [],
          undated: { toCheck: 0, fromSheet: 0, expired: 0, strikesAddress: 0 },
        }),
        M,
      ).empty,
    ).toBe("Nothing is waiting.");
    expect(waitedChart(failed, M).error).toBe(true);
    // Everything from today: said so.
    expect(
      waitedChart(
        ok({ ...waited(false), days: [{ day: "2026-10-26", needsYou: kinds({ enquiries: 2 }) }] }),
        M,
      ).take,
    ).toBe("Everything waiting came in today.");
    expect(
      waitedChart(
        ok({ ...waited(true), days: [{ day: "2026-10-26", needsYou: kinds({ uploads: 1 }) }] }),
        M,
      ).take,
    ).toBe("3 pay queries have waited a week or more with payroll.");
  });

  it('an age with a count but none of its rows loaded says where they are, never "Showing the first 0."', () => {
    const upload = (i: number, d: string): WaitedItem => ({
      kind: "uploads",
      since: at(`${d}T09:00:00Z`),
      day: d,
      uploadId: `up-${i}`,
      workerId: `w-${i}`,
      casual: "Omar Price",
      upload: "photo",
      qualificationName: null,
    });
    // 60 uploads: 59 sent over a week ago (the oldest 50 loaded), 1 today. 52 pay queries: 50
    // from Fri 16 Oct (the oldest 50 loaded), 2 today.
    const unloaded: WaitedChart = {
      ...waited(true),
      days: [
        { day: "2026-10-12", needsYou: kinds({ uploads: 59 }) },
        { day: "2026-10-26", needsYou: kinds({ uploads: 1 }) },
      ],
      items: Array.from({ length: 50 }, (_, i) => upload(i, "2026-10-12")),
      pay: {
        total: 52,
        days: [
          { day: "2026-10-16", count: 50 },
          { day: "2026-10-26", count: 2 },
        ],
        rows: Array.from({ length: 50 }, (_, i) => ({ ...payRows[0]!, payQueryId: `q-${i}` })),
        more: true,
      },
    };
    const chart = waitedChart(ok(unloaded), M);
    const groups = (age: number) =>
      panelOf(chart, `waited-chart:${age}`).groups.map((g) => [g.label, g.rows.length, g.more]);
    expect(groups(0)).toEqual([
      ["Needs you", 0, "They're on Needs attention."],
      ["With payroll", 0, "They're on the pay queries page."],
    ]);
    expect(footOf(panelOf(chart, "waited-chart:0"))).toEqual([
      "Open Needs attention → /office/needs-attention",
      "Open the pay queries → /office/pay-queries",
    ]);
    expect(groups(4)).toEqual([
      ["Needs you", 50, "Showing the first 50."],
      ["With payroll", 50, null],
    ]);
    expect(JSON.stringify(chart)).not.toContain("Showing the first 0.");
  });

  it('a Needs attention list stopped at 50: said under the chart, "at least" in its sentence, and on the ages it holds', () => {
    const toMark = (i: number, d: string): WaitedItem => ({
      kind: "to-mark",
      since: at(`${d}T18:00:00Z`),
      day: d,
      shiftId: `t-${i}`,
      role: "steward",
      site: null,
      startsAt: at(`${d}T10:00:00Z`),
      endsAt: at(`${d}T18:00:00Z`),
      unmarked: 1,
    });
    const fifty = (d: string) => Array.from({ length: 50 }, (_, i) => toMark(i, d));
    // 51 sessions to mark: Needs attention keeps the 50 that ended last (yesterday), so the one
    // that ended 6 days ago isn't here at all. One enquiry today, every one loaded.
    const capped: WaitedChart = {
      ...waited(false),
      days: [
        { day: "2026-10-25", needsYou: kinds({ "to-mark": 50 }) },
        { day: "2026-10-26", needsYou: kinds({ enquiries: 1 }) },
      ],
      items: [...fifty("2026-10-25"), items[2]!],
      more: { ...waited(false).more, uploads: false, "to-mark": true },
      needsYouMore: true,
    };
    const chart = waitedChart(ok(capped), M);
    const sentence = "Some lists stop at 50, so more are waiting than shown.";
    expect(chart.notes).toEqual([
      waitedChart(ok(waited(false)), M).notes[0],
      { text: sentence, links: [] },
    ]);
    expect(chart.take).toBe("At least 50 things for you have waited since yesterday.");
    // The age that holds the stopped list says how many it shows; an age without it, nothing.
    const groups = (c: ChartCard, age: number) =>
      panelOf(c, `waited-chart:${age}`).groups.map((g) => [g.label, g.rows.length, g.more]);
    expect(groups(chart, 1)).toEqual([["Needs you", 50, "Showing the first 50."]]);
    expect(groups(chart, 0)).toEqual([["Needs you", 1, null]]);
    // All of it today: never "Everything waiting came in today."
    expect(
      waitedChart(
        ok({
          ...capped,
          days: [{ day: "2026-10-26", needsYou: kinds({ "to-mark": 50, enquiries: 1 }) }],
          items: [...fifty("2026-10-26"), items[2]!],
        }),
        M,
      ).take,
    ).toBe("At least 51 things came in today.");
    // Uploads and enquiries are counted in full: their list stopping at 50 (as here) changes no
    // count, so nothing more is said.
    const uploadsStopped = waitedChart(ok(waited(false)), M);
    expect(waited(false).more.uploads).toBe(true);
    expect(uploadsStopped.notes).toHaveLength(1);
    expect(uploadsStopped.take).toBe("2 things for you have waited a week or more.");
    // A list with no date of its own stopped at 50: "50+" under the chart, and the sentence too;
    // the ages are still exact.
    const undatedStopped = waitedChart(
      ok({
        ...waited(false),
        undated: { toCheck: 50, fromSheet: 3, expired: 50, strikesAddress: 0 },
        needsYouMore: true,
      }),
      M,
      { toCheck: true, fromSheet: false, expired: true },
    );
    expect(undatedStopped.notes).toEqual([
      {
        text: "Not counted by age:",
        links: [
          { text: "50+ bookings to check", href: "/office/needs-attention#to-check" },
          { text: "3 changes from your sheet", href: "/office/needs-attention#from-sheet" },
          {
            text: "50+ qualifications out of date on a booking",
            href: "/office/needs-attention#expired",
          },
        ],
      },
      { text: sentence, links: [] },
    ]);
    expect(undatedStopped.take).toBe("2 things for you have waited a week or more.");
  });

  it('a stopped list over two ages: "Showing the first N." only where rows can be missing', () => {
    const toMark = (i: number, d: string): WaitedItem => ({
      kind: "to-mark",
      since: at(`${d}T08:00:00Z`),
      day: d,
      shiftId: `t-${d}-${i}`,
      role: "steward",
      site: null,
      startsAt: at(`${d}T01:00:00Z`),
      endsAt: at(`${d}T08:00:00Z`),
      unmarked: 1,
    });
    const groups = (c: ChartCard, age: number) =>
      panelOf(c, `waited-chart:${age}`).groups.map((g) => [g.label, g.rows.length, g.more]);
    // 51 sessions to mark: 20 ended today, 31 on Wed 21 Oct. Needs attention keeps the 50 that
    // ended last, so the one left out is Wednesday's: today's 20 are all here.
    const twoAges: WaitedChart = {
      ...waited(false),
      days: [
        { day: "2026-10-21", needsYou: kinds({ "to-mark": 30 }) },
        { day: "2026-10-26", needsYou: kinds({ "to-mark": 20 }) },
      ],
      items: [
        ...Array.from({ length: 30 }, (_, i) => toMark(i, "2026-10-21")),
        ...Array.from({ length: 20 }, (_, i) => toMark(i, "2026-10-26")),
      ],
      more: { ...waited(false).more, uploads: false, "to-mark": true },
      needsYouMore: true,
    };
    const chart = waitedChart(ok(twoAges), M);
    expect(panelOf(chart, "waited-chart:0").title).toBe("Today: 20 things waiting");
    expect(groups(chart, 0)).toEqual([["Needs you", 20, null]]);
    expect(groups(chart, 3)).toEqual([["Needs you", 30, "Showing the first 30."]]);
    expect(chart.take).toBe("At least 30 things for you have waited 4 to 6 days.");
    expect(chart.notes.at(-1)).toEqual({
      text: "Some lists stop at 50, so more are waiting than shown.",
      links: [],
    });

    // Strike evidence is kept newest first too: only its oldest age can be short.
    const evidence = (i: number, d: string): WaitedItem => ({
      kind: "evidence",
      since: at(`${d}T10:00:00Z`),
      day: d,
      assignmentId: `a-${d}-${i}`,
      casual: "Ann Booker",
      stuck: false,
      nothingSent: false,
    });
    const evidenceTwoAges = waitedChart(
      ok({
        ...twoAges,
        days: [
          { day: "2026-10-12", needsYou: kinds({ evidence: 45 }) },
          { day: "2026-10-25", needsYou: kinds({ evidence: 5 }) },
        ],
        items: [
          ...Array.from({ length: 45 }, (_, i) => evidence(i, "2026-10-12")),
          ...Array.from({ length: 5 }, (_, i) => evidence(i, "2026-10-25")),
        ],
        more: { ...twoAges.more, "to-mark": false, evidence: true },
      }),
      M,
    );
    expect(groups(evidenceTwoAges, 1)).toEqual([["Needs you", 5, null]]);
    expect(groups(evidenceTwoAges, 4)).toEqual([["Needs you", 45, "Showing the first 45."]]);

    // Planner-refused is kept by the session's start, not by when it was refused: any age that
    // holds it can be short.
    const refused = (i: number, d: string): WaitedItem => ({
      kind: "planner-refused",
      since: at(`${d}T09:00:00Z`),
      day: d,
      shiftId: `p-${d}-${i}`,
      role: "steward",
      site: null,
      startsAt: at("2026-11-07T10:00:00Z"),
      why: "move",
      casuals: 1,
    });
    const refusedTwoAges = waitedChart(
      ok({
        ...twoAges,
        days: [
          { day: "2026-10-21", needsYou: kinds({ "planner-refused": 30 }) },
          { day: "2026-10-26", needsYou: kinds({ "planner-refused": 20 }) },
        ],
        items: [
          ...Array.from({ length: 30 }, (_, i) => refused(i, "2026-10-21")),
          ...Array.from({ length: 20 }, (_, i) => refused(i, "2026-10-26")),
        ],
        more: { ...twoAges.more, "to-mark": false, "planner-refused": true },
      }),
      M,
    );
    expect(groups(refusedTwoAges, 0)).toEqual([["Needs you", 20, "Showing the first 20."]]);
    expect(groups(refusedTwoAges, 3)).toEqual([["Needs you", 30, "Showing the first 30."]]);
  });
});

// --- 5. Cancellations, the last 14 days -----------------------------------------------------

const cancellation = (
  o: Partial<CancellationRow> & Pick<CancellationRow, "assignmentId" | "ref" | "cancelledAt">,
): CancellationRow => ({
  workerId: "w1",
  casual: "Liam Ford",
  staffId: null,
  eventName: "Raceday",
  role: "gate_steward",
  startsAt: at("2026-10-26T10:00:00Z"),
  endsAt: at("2026-10-26T18:00:00Z"),
  siteName: null,
  sitePostcode: null,
  post: null,
  payRatePence: 1260,
  meetingPoint: null,
  uniform: null,
  requirements: [],
  bookedAt: null,
  by: "casual",
  via: "app",
  officeName: null,
  reason: "A casual's own reason, never shown",
  noticeHours: 26,
  strikeCode: null,
  strike: null,
  planner: { status: "none" },
  warning: null,
  then: { place: "reopened", markedUrgent: false, offeredTo: 0, replacement: null },
  ...o,
});

describe("cancellations over the last 2 weeks", () => {
  // The strike notice setting of 12 hours (the law's 72 has nothing to do with it).
  const ch: CancelsChart = {
    first: "2026-10-13",
    days: Array.from({ length: 14 }, (_, i) => {
      const date = addDays("2026-10-13", i);
      return date === "2026-10-25"
        ? { date, total: 2, short: 1, byCasuals: 1 }
        : date === "2026-10-26"
          ? { date, total: 1, short: 0, byCasuals: 0 }
          : { date, total: 0, short: 0, byCasuals: 0 };
    }),
    threshold: 12,
    rows: [
      cancellation({
        assignmentId: "a3",
        ref: "A3",
        cancelledAt: at("2026-10-26T09:00:00Z"),
        by: "office",
        casual: "Ben Carter",
      }),
      // 23:30 UTC on Sunday after the clocks went back: still Sunday.
      cancellation({
        assignmentId: "a2",
        ref: "A2",
        cancelledAt: at("2026-10-25T23:30:00Z"),
        noticeHours: 10.5,
      }),
      // 23:30 UTC on Saturday in summer time: already Sunday.
      cancellation({
        assignmentId: "a1",
        ref: "A1",
        cancelledAt: at("2026-10-24T23:30:00Z"),
        casual: "Grace Lee",
        noticeHours: 40,
      }),
    ],
    more: false,
  };
  const chart = cancelsChart(ok(ch), M);

  it("a column a day, today last, short notice (the firm's setting) at the baseline; scrolled to today", () => {
    const cols = columnsOf(chart);
    expect(cols).toHaveLength(14);
    expect([cols[0]!.key, cols[13]!.key, cols[13]!.top, cols[13]!.now]).toEqual([
      "2026-10-13",
      "2026-10-26",
      "M",
      true,
    ]);
    // 14 narrow columns can't fit "Today" or "Wed": the weekday's first letter over each date,
    // today's too (its date pill marks it, `now`); each mark's name says the full day (below).
    expect(cols.map((c) => c.top).join(" ")).toBe("T W T F S S M T W T F S S M");
    expect(cols.filter((c) => c.now).map((c) => c.key)).toEqual(["2026-10-26"]);
    expect(cols.filter((c) => c.mark).map((c) => [c.key, c.segments, c.mark!.aria])).toEqual([
      [
        "2026-10-25",
        [
          { tone: "urgent", value: 1 },
          { tone: "calm", value: 1 },
        ],
        "2 cancellations. Sun 25 Oct: 1 under 12 hours' notice.",
      ],
      ["2026-10-26", [{ tone: "calm", value: 1 }], "1 cancellation. Mon 26 Oct, today."],
    ]);
    expect(chart.body).toMatchObject({ kind: "columns", end: true });
    expect(chart.legend).toEqual([
      { tone: "urgent", label: "Under 12 hours' notice" },
      { tone: "calm", label: "With notice" },
    ]);
    expect(chart.take).toBe(
      "3 cancellations in the last 2 weeks. 1 came with under 12 hours' notice.",
    );
    expect(
      cancelsChart(ok({ ...ch, days: ch.days.map((d) => ({ ...d, short: 0 })) }), M).take,
    ).toBe("3 cancellations in the last 2 weeks. All came with 12 hours' notice or more.");
    expect(chart.tables[0]!.rows).toEqual([
      ["Sun 25 Oct", "1", "1"],
      ["Mon 26 Oct", "0", "1"],
    ]);
    expect([chart.hint, chart.swipe]).toEqual([
      "Pick a day to see who cancelled.",
      "Swipe for earlier days.",
    ]);
  });

  it("a day's panel: who cancelled what, its notice, each record; recorded, never approved or declined", () => {
    const sun = panelOf(chart, "cancellations-chart:2026-10-25");
    expect([sun.title, sun.sub]).toEqual([
      "Sun 25 Oct: 2 cancellations",
      "1 under 12 hours' notice. Recorded automatically, never approved or declined.",
    ]);
    expect(rowsOf(sun)).toEqual([
      "Liam Ford cancelled | Gate steward, Raceday. The shift: 10:00 on Mon 26 Oct. 10 hours' notice. | [urgent: Short notice] | Open → /office/cancellations/A2",
      "Grace Lee cancelled | Gate steward, Raceday. The shift: 10:00 on Mon 26 Oct. 40 hours' notice. | [quiet: With notice] | Open → /office/cancellations/A1",
    ]);
    expect(footOf(sun)).toEqual(["See all cancellations → /office/cancellations"]);
    const today = panelOf(chart, "cancellations-chart:2026-10-26");
    expect(rowsOf(today)).toEqual([
      "The office cancelled Ben Carter | Gate steward, Raceday. The shift: 10:00 on Mon 26 Oct. 26 hours' notice. | [quiet: With notice] | Open → /office/cancellations/A3",
    ]);
    expect(footOf(today)).toEqual(["See today's cancellations → /office/cancellations?day=today"]);
    // A casual's own reason and the pay rate never reach a panel.
    const json = JSON.stringify(chart);
    expect(json).not.toContain("own reason");
    expect(json).not.toContain("1260");
    // More that day than the rows held: said so.
    const capped = cancelsChart(ok({ ...ch, rows: ch.rows.slice(0, 2), more: true }), M);
    expect(panelOf(capped, "cancellations-chart:2026-10-25").groups[0]!.more).toBe(
      "Showing the first 1.",
    );
    expect(
      cancelsChart(ok({ ...ch, days: ch.days.map((d) => ({ ...d, total: 0, short: 0 })) }), M)
        .empty,
    ).toBe("No cancellations in the last 2 weeks.");
    expect(cancelsChart(failed, M).error).toBe(true);
  });
});

// --- 6. Licences running out ------------------------------------------------------------------

const licence = (
  o: Partial<LicenceRow> & Pick<LicenceRow, "credentialId" | "casual" | "expiresOn" | "days">,
): LicenceRow => ({
  workerId: `w-${o.credentialId}`,
  type: "SIA_DS",
  name: "SIA door supervisor licence",
  soon: o.days <= 30,
  renewalWaiting: false,
  booked: null,
  ...o,
});

describe("licences running out over the next 8 weeks", () => {
  const lc: LicencesChart = {
    today: "2026-10-23",
    windowDays: 56,
    soonDays: 30,
    rows: [
      licence({
        credentialId: "c1",
        casual: "Tom Reid",
        expiresOn: "2026-10-28",
        days: 5,
        booked: {
          assignmentId: "x1",
          shiftId: "s9",
          role: "door_supervisor",
          startsAt: at("2026-10-31T12:00:00Z"),
          lastDay: "2026-10-31",
        },
      }),
      licence({ credentialId: "c2", casual: "Priya Shah", expiresOn: "2026-11-02", days: 10 }),
      licence({
        credentialId: "c3",
        casual: "Ellis Grant",
        name: "First aid at work certificate",
        expiresOn: "2026-11-06",
        days: 14,
      }),
      licence({
        credentialId: "c4",
        casual: "Leah Ward",
        expiresOn: "2026-12-04",
        days: 42,
        renewalWaiting: true,
      }),
    ],
    more: true,
    counts: { total: 63, soon: 3, booked: 1 },
  };
  const chart = licencesChart(ok(lc), C);

  it("a dot each along the 8 weeks: booked after it runs out red and bigger, soon amber, later grey; close dates on the lanes above", () => {
    if (chart.body?.kind !== "timeline") throw new Error("timeline");
    expect(
      chart.body.dots.map((d) => [d.key, Math.round(d.x * 10) / 10, d.lane, d.tone, d.big, d.name]),
    ).toEqual([
      ["c1", 8.9, 0, "urgent", true, "Tom Reid"],
      ["c2", 17.9, 1, "open", false, null],
      ["c3", 25, 0, "open", false, null],
      ["c4", 75, 0, "calm", false, null],
    ]);
    expect(chart.body.lanes).toBe(2);
    // A tick each Monday, every other one's date hidden on a phone.
    expect(chart.body.ticks.map((t) => [t.label, t.alt])).toEqual([
      ["26 Oct", false],
      ["2 Nov", true],
      ["9 Nov", false],
      ["16 Nov", true],
      ["23 Nov", false],
      ["30 Nov", true],
      ["7 Dec", false],
      ["14 Dec", true],
    ]);
    expect(chart.body.dots[0]!.mark.aria).toBe(
      "Runs out Wed 28 Oct. Tom Reid, SIA door supervisor licence. Booked on Sat 31 Oct, after it runs out.",
    );
    expect(chart.legend.map((l) => [l.tone, l.label, l.round])).toEqual([
      ["urgent", "Booked after it runs out", true],
      ["open", "Runs out within 30 days", true],
      ["calm", "Later", true],
    ]);
    expect(chart.take).toBe(
      "3 licences run out in the next 30 days. Tom Reid's runs out on Wed 28 Oct, and they're booked on Sat 31 Oct.",
    );
    expect(
      licencesChart(ok({ ...lc, rows: [lc.rows[3]!], counts: { total: 1, soon: 0, booked: 0 } }), C)
        .take,
    ).toBe("1 licence runs out in the next 8 weeks, none in the next 30 days.");
    expect(chart.notes).toEqual([{ text: "Showing the first 4 of 63.", links: [] }]);
    expect(chart.tables[0]!.rows[0]).toEqual([
      "Tom Reid",
      "SIA door supervisor licence",
      "Wed 28 Oct",
      "Yes",
    ]);
  });

  it("a dot's panel: the booking it won't be in date for, a renewal to check, the casual's record", () => {
    const tom = panelOf(chart, "licences-chart:c1");
    expect([tom.title, tom.sub]).toEqual([
      "Tom Reid: SIA door supervisor licence",
      "Runs out Wed 28 Oct, in 5 days.",
    ]);
    expect(rowsOf(tom)).toEqual([
      "Booked on Sat 31 Oct: Door supervisor | It won't be in date for this booking. | [urgent: Booked after it runs out] | Open the booking → /office/shifts/s9 (main)",
      "Tom Reid's record | Their licences, bookings and contact details. | Open → /office/casuals/w-c1",
    ]);
    expect(rowsOf(panelOf(chart, "licences-chart:c4"))).toEqual([
      "A new one is waiting for a check | [attention: Upload] | Check → /office/casuals/w-c4#uploads",
      "Leah Ward's record | Their licences, bookings and contact details. | Open → /office/casuals/w-c4",
    ]);
    expect(
      licencesChart(ok({ ...lc, rows: [{ ...lc.rows[1]!, days: 0 }] }), C).body?.kind ===
        "timeline" &&
        panelOf(
          licencesChart(ok({ ...lc, rows: [{ ...lc.rows[1]!, days: 0 }] }), C),
          "licences-chart:c2",
        ).sub,
    ).toBe("Runs out Mon 2 Nov, at the end of today.");
    expect(
      licencesChart(
        ok({ ...lc, rows: [], more: false, counts: { total: 0, soon: 0, booked: 0 } }),
        C,
      ).empty,
    ).toBe("No licences run out in the next 8 weeks.");
    expect(licencesChart(failed, C).error).toBe(true);
  });

  // A licence is in date on the day it runs out. A night session that starts that evening runs
  // past it: never "booked on Sat 24 Oct, after it runs out" for one that "runs out Sat 24 Oct".
  it("a night session starting on the day it runs out: named by its span, past the day it runs out", () => {
    const jo = licence({
      credentialId: "c5",
      casual: "Jo Booker",
      expiresOn: "2026-10-24",
      days: 1,
      booked: {
        assignmentId: "x5",
        shiftId: "s7",
        role: "door_supervisor",
        // Sat 24 Oct 22:00 to Sun 25 Oct 06:00 in London (the clocks go back in between).
        startsAt: at("2026-10-24T21:00:00Z"),
        lastDay: "2026-10-25",
      },
    });
    const night = licencesChart(
      ok({ ...lc, rows: [jo, ...lc.rows.slice(1)], counts: { total: 63, soon: 3, booked: 1 } }),
      C,
    );
    if (night.body?.kind !== "timeline") throw new Error("timeline");
    const dot = night.body.dots[0]!;
    expect([dot.tone, dot.big, dot.name]).toEqual(["urgent", true, "Jo Booker"]);
    expect(dot.mark.tip).toEqual({
      value: "Runs out Sat 24 Oct.",
      label:
        "Jo Booker, SIA door supervisor licence. Booked Sat 24 Oct to Sun 25 Oct, past the day it runs out.",
    });
    expect(night.take).toBe(
      "3 licences run out in the next 30 days. Jo Booker's runs out on Sat 24 Oct, and they're booked until Sun 25 Oct.",
    );
    expect(rowsOf(panelOf(night, "licences-chart:c5"))[0]).toBe(
      "Booked Sat 24 Oct to Sun 25 Oct: Door supervisor | It won't be in date for this booking. | [urgent: Booked after it runs out] | Open the booking → /office/shifts/s7 (main)",
    );
    // The key stays.
    expect(night.legend[0]).toEqual({
      tone: "urgent",
      label: "Booked after it runs out",
      round: true,
    });
    expect(JSON.stringify(night)).not.toContain("Booked on Sat 24 Oct");

    // A night session that starts after the day it runs out keeps its first day's words.
    const tom = lc.rows[0]!;
    if (!tom.booked) throw new Error("fixture");
    const later = licencesChart(
      ok({ ...lc, rows: [{ ...tom, booked: { ...tom.booked, lastDay: "2026-11-01" } }] }),
      C,
    );
    expect(marksOf(later)[0]!.tip.label).toBe(
      "Tom Reid, SIA door supervisor licence. Booked on Sat 31 Oct, after it runs out.",
    );
    expect(later.take).toBe(
      "3 licences run out in the next 30 days. Tom Reid's runs out on Wed 28 Oct, and they're booked on Sat 31 Oct.",
    );
    expect(rowsOf(panelOf(later, "licences-chart:c1"))[0]).toMatch(/^Booked on Sat 31 Oct: /);
  });
});

// --- The count cards and the whole dashboard ----------------------------------------------------

const noNeeds: NeedsAttention = {
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
};
const dashboard = (pay: boolean): Dashboard => ({
  timeZone: TZ,
  today: "2026-10-26",
  counts: {
    urgent: ok({ sessions: 0, places: 0, firstStartsAt: null }),
    showing: ok({ events: 0, sessions: 0, places: 0 }),
    cancellations: ok({ total: 1, underNotice: 0, strikes: 0, threshold: 12 }),
    enquiries: ok({ total: 2, automatic: 1, needPerson: 1 }),
  },
  urgent: ok({ events: [], more: false }),
  showing: ok({ events: [], more: 0 }),
  cancellations: ok({ rows: [], threshold: 12 }),
  enquiries: ok({ rows: [], replies: {}, days: 90 }),
  needs: ok({ ...noNeeds, uploads: 60 }),
  fill: ok({
    first: "2026-10-26",
    days: fortnight("2026-10-26", [day("2026-10-27", 4, 3, 1, 0, 1)]),
    gaps: [gap({ shiftId: "g", date: "2026-10-27" })],
    more: false,
  }),
  eventsNeed: ok({
    events: [
      event({
        eventId: "e1",
        name: "Raceday",
        places: 1,
        sessions: [gap({ shiftId: "g", date: "2026-10-27" })],
      }),
    ],
    more: 0,
    total: { events: 1, places: 1, urgent: 0 },
    hiddenEvents: 0,
    full: [],
    fullMore: 0,
  }),
  offersWeek: ok(week),
  waited: ok(waited(pay)),
  cancels14: ok({ first: "2026-10-13", days: [], threshold: 12, rows: [], more: false }),
  licences: ok({
    today: "2026-10-26",
    windowDays: 56,
    soonDays: 30,
    rows: [],
    more: false,
    counts: { total: 0, soon: 0, booked: 0 },
  }),
});

describe("the count cards' lists, and the dashboard as a whole", () => {
  it("Waiting on others: the pay queries for a role that can open Pay, the waiting chart otherwise", () => {
    const admin = countCards(dashboard(true), { pay: true, payQueriesWaiting: 3 })[2]!;
    expect([admin.label, admin.value, admin.caption, admin.href]).toEqual([
      "Waiting on others",
      "3",
      "Pay queries with payroll",
      "/office/pay-queries",
    ]);
    expect(rowsOf(admin.panel)).toEqual([
      "Maya Cole: Paid late or not paid | For Mon 28 Sep. Sent 10:00 on Fri 16 Oct. | [wait: In payroll's digest]",
    ]);
    expect(footOf(admin.panel)).toEqual(["Open the pay queries → /office/pay-queries"]);
    // 50 loaded of more: said so.
    const many = dashboard(true);
    if (!many.waited.ok || !many.waited.data.pay) throw new Error("fixture");
    many.waited = ok({
      ...many.waited.data,
      pay: {
        ...many.waited.data.pay,
        total: 70,
        rows: Array.from({ length: 50 }, (_, i) => ({ ...payRows[0]!, payQueryId: `q${i}` })),
        more: true,
      },
    });
    expect(countCards(many, { pay: true, payQueriesWaiting: 70 })[2]!.panel.groups[0]!.more).toBe(
      "Showing the first 50.",
    );
    const resourcer = countCards(dashboard(false), { pay: false, payQueriesWaiting: 0 })[2]!;
    expect([resourcer.value, resourcer.caption, resourcer.href, resourcer.panel.title]).toEqual([
      "0",
      "Nothing waiting on others",
      "#waited-chart",
      "Nothing is waiting on anyone else",
    ]);
    expect(footOf(resourcer.panel)).toEqual(["See how long things have waited → #waited-chart"]);
    const unread = countCards(dashboard(true), { pay: true, payQueriesWaiting: null })[2]!;
    expect([unread.value, unread.caption, unread.panel.error]).toEqual([
      "–",
      COUNT_ERROR,
      SECTION_ERROR,
    ]);
  });

  it('a Needs attention list with no date of its own stopped at 50: "50+" under the waiting chart, and the count card\'s words', () => {
    const stopped: Dashboard = {
      ...dashboard(false),
      needs: ok({ ...noNeeds, uploads: 60, expiredMore: true }),
      waited: ok({
        ...waited(false),
        undated: { toCheck: 2, fromSheet: 0, expired: 50, strikesAddress: 1 },
        needsYouMore: true,
      }),
    };
    const o = { now: M.now, pay: false, payQueriesWaiting: 0 };
    const chart = dashboardModel(stopped, o).charts[3]!;
    expect(chart.id).toBe(CHART_IDS.waited);
    expect(chart.notes.flatMap((n) => [n.text, ...n.links.map((l) => l.text)])).toEqual([
      "Not counted by age:",
      "2 bookings to check",
      "50+ qualifications out of date on a booking",
      "The strikes team's email to set",
      "Some lists stop at 50, so more are waiting than shown.",
    ]);
    expect(countCards(stopped, o)[1]!.panel.groups[0]!.more).toBe(
      "Some lists stop at 50, so more are waiting than shown.",
    );
    // None stopped: the counts as they are, and nothing more said.
    const exact = dashboardModel(dashboard(false), o).charts[3]!;
    expect(exact.notes.flatMap((n) => [n.text, ...n.links.map((l) => l.text)])).toEqual([
      "Not counted by age:",
      "2 bookings to check",
      "1 qualification out of date on a booking",
      "The strikes team's email to set",
    ]);
  });

  it("Sorted today: unread parts say so; both unread, the card says it couldn't load", () => {
    const d = dashboard(false);
    const both = countCards(
      { ...d, counts: { ...d.counts, cancellations: failed, enquiries: failed } },
      { pay: false, payQueriesWaiting: 0 },
    )[3]!;
    expect([both.value, both.caption]).toEqual(["–", COUNT_ERROR]);
    const one = countCards(
      { ...d, counts: { ...d.counts, enquiries: failed } },
      { pay: false, payQueriesWaiting: 0 },
    )[3]!;
    expect([one.value, one.caption]).toEqual(["1", "1 cancellation"]);
  });

  it("the six charts in order; no link named as a menu link; nothing to approve, decline or deny", () => {
    for (const pay of [true, false]) {
      const m = dashboardModel(dashboard(pay), { now: M.now, pay, payQueriesWaiting: pay ? 3 : 0 });
      expect(m.charts.map((c) => c.id)).toEqual(Object.values(CHART_IDS));
      const panels = [
        ...m.cards.map((c) => c.panel),
        ...m.charts.flatMap(marksOf).map((x) => x.panel),
      ];
      expect(panels.length).toBeGreaterThan(10);
      const names = [
        ...panels.flatMap((p) => [
          ...p.foot.map((l) => l.label),
          ...p.groups.flatMap((g) =>
            g.rows.flatMap((r) => [r.action?.label ?? "", r.href ? r.title : ""]),
          ),
        ]),
        ...m.charts.flatMap((c) => c.notes.flatMap((n) => n.links.map((l) => l.text))),
      ].filter(Boolean);
      for (const label of officeMenu(pay ? "admin" : "resourcer").flatMap((g) =>
        g.links.map((l) => l.label),
      ))
        expect(names).not.toContain(label);
      expect(JSON.stringify(m)).not.toMatch(/\b(Approve|Decline|Deny)\b/);
      // Every mark's name is its tooltip's words, value first.
      for (const c of m.charts)
        for (const x of marksOf(c)) expect(x.aria).toBe(`${x.tip.value} ${x.tip.label}`);
    }
  });
});
