import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { officeMenu } from "@/app/office/office-menu";
import {
  bannerText,
  cardLabel,
  chartSummary,
  chartTop,
  columnMoreText,
  dayTip,
  emptyText,
  headLine,
  initials,
  markLabel,
  moreLabel,
  offeredLine,
  offerLabel,
  pickHref,
  repliesText,
  showHref,
  sinceText,
  startsIn,
  toMarkLine,
  toOfferLine,
  whenText,
  whereText,
} from "@/lib/office/board-copy";
import type { Board, BoardSession, ChartDay } from "@/lib/office/dashboard-board";
import { DEFAULT_CARDS } from "@/lib/office/dashboard-cards";
import { SECTION_ERROR } from "@/lib/office/dashboard-copy";
import type { OfferPage } from "@/lib/office/offer-page";
import { DEFAULT_PAY_CALENDAR, payCalendar } from "@/lib/pay/calendar";

// The office dashboard (Phase 24, 24.3: round 7 of the canvas; docs/mockups/phase-24/README.md;
// docs/screens.md `/office`): its words (src/lib/office/board-copy.ts) and the page as the server
// renders it (src/app/office/dashboard-view.tsx and ./dashboard/), from made-up data: the head and
// its line, the track, the places chart (its bars, axis, today and its table), the detail card,
// the board's four columns and their cards, each part that couldn't load, and the offer panel
// listing who can take a session as the offer page does. tests/integration/office.board.test.ts
// checks the loader on the database; tests/e2e/office.dashboard.spec.ts the page in a browser.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/app/office/shifts/actions", () => ({
  markAttendanceAction: vi.fn(),
  markRestWorkedAction: vi.fn(),
}));
vi.mock("@/app/office/today-actions", () => ({
  setUrgentAction: vi.fn(),
  closeShiftAction: vi.fn(),
  reopenShiftAction: vi.fn(),
  offerShiftAction: vi.fn(),
  offerPanelAction: vi.fn(),
  keepBookingAction: vi.fn(),
}));

const { DashboardContent } = await import("@/app/office/dashboard-view");
const { OfferContent } = await import("@/app/office/dashboard/offer-panel");
const { OfferView } = await import("@/app/office/offer/[shiftId]/offer-view");

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);
// Monday 26 October 2026, 11:20 London (GMT: the clocks went back the day before).
const NOW = at("2026-10-26T11:20:00Z");
const ok = <T>(data: T) => ({ ok: true as const, data });
const failed = { ok: false as const };

const offers = (o: Partial<BoardSession["offers"]> = {}): BoardSession["offers"] => ({
  sent: 0,
  waiting: 0,
  saidNo: 0,
  tookIt: 0,
  closed: 0,
  failed: 0,
  waitingSince: null,
  waitingNames: [],
  atLimit: false,
  ...o,
});

const session = (o: Partial<BoardSession> & Pick<BoardSession, "shiftId">): BoardSession => ({
  eventId: "e1",
  eventName: "Northern Lights Live",
  role: "door_supervisor",
  post: "Gate A",
  site: "Acme Demo Arena",
  siteId: "site-arena",
  startsAt: at("2026-10-27T08:00:00Z"),
  endsAt: at("2026-10-27T16:00:00Z"),
  headcount: 4,
  placesFree: 1,
  payRatePence: 1550,
  urgent: false,
  hidden: false,
  fromSheet: false,
  fromPlanner: false,
  offers: offers(),
  ...o,
});

// The mock-up's board: an urgent door supervisor tomorrow offered to Mo Rahman at 07:19; a
// steward on Friday offered to two; four never offered; a take last night; two sessions to mark.
const nll1 = session({
  shiftId: "nll1",
  urgent: true,
  offers: offers({
    sent: 1,
    waiting: 1,
    waitingSince: at("2026-10-26T07:19:00Z"),
    waitingNames: ["Mo Rahman"],
  }),
});
const rff = session({
  shiftId: "rff",
  role: "steward",
  eventName: "Riverside Food Festival",
  post: "Gate 2",
  site: "Riverside Demo Park",
  siteId: "site-riverside",
  startsAt: at("2026-10-30T14:00:00Z"),
  endsAt: at("2026-10-30T22:00:00Z"),
  placesFree: 2,
  offers: offers({
    sent: 2,
    waiting: 2,
    waitingSince: at("2026-10-26T08:02:00Z"),
    waitingNames: ["Ben Fraser", "Priya Shah"],
  }),
});
const toOffer = ["np1", "nll2", "rc", "sc"].map((id, i) =>
  session({
    shiftId: id,
    role: i === 0 ? "csas_officer" : "steward",
    eventName: i === 0 ? "Night patrols" : "Acme Demo Racecourse",
    startsAt: at(`2026-10-${28 + i}T19:00:00Z`),
    endsAt: at(`2026-10-${28 + i}T23:00:00Z`),
    urgent: i === 0,
  }),
);
const days: ChartDay[] = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-${i < 6 ? "10" : "11"}-${String(i < 6 ? 26 + i : i - 5).padStart(2, "0")}`,
  toOffer: i === 2 ? 1 : i === 5 ? 3 : 0,
  offered: i === 1 ? 1 : i === 4 ? 2 : 0,
}));

const board: Board = {
  timeZone: TZ,
  today: "2026-10-26",
  payCalendar: DEFAULT_PAY_CALENDAR,
  now: NOW,
  show: "all",
  planner: ok({ kind: "api", lastChangeAt: at("2026-10-26T11:20:00Z") }),
  counts: ok({ all: 6, urgent: 2, "this-week": 6, "next-week": 0 }),
  gaps: ok({
    toOffer: { sessions: toOffer, total: 4, places: 4, waiting: 0, more: false },
    offered: { sessions: [nll1, rff], total: 2, places: 3, waiting: 3, more: false },
    chosen: nll1,
  }),
  toMark: ok({
    total: 3,
    items: [
      // Two alike (one card), one on its own.
      ...["m1", "m2"].map((id) => ({
        shiftId: id,
        role: "steward",
        site: "Acme Demo Racecourse",
        startsAt: at("2026-10-25T09:00:00Z"),
        endsAt: at("2026-10-25T17:00:00Z"),
        unmarked: 2,
      })),
      {
        shiftId: "m3",
        role: "security_officer",
        site: "Acme Demo Shopping Centre",
        startsAt: at("2026-10-25T10:00:00Z"),
        endsAt: at("2026-10-25T18:00:00Z"),
        unmarked: 1,
      },
    ],
  }),
  // Round 8 (Phase 26.2): the venue map, who can take the chosen session, Updates and Who worked?
  // by name.
  full: false,
  role: null,
  roles: ok(["csas_officer", "door_supervisor", "steward"]),
  venues: ok([
    {
      siteId: "site-arena",
      name: "Acme Demo Arena",
      town: "Exampleton",
      lat: 53.83,
      lng: -1.53,
      places: 5,
      sessions: 5,
      urgent: true,
      hidden: false,
      days: ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"],
      firstShiftId: "nll1",
    },
    {
      siteId: "site-riverside",
      name: "Riverside Demo Park",
      town: "Exampleton",
      lat: 54.01,
      lng: -1.41,
      places: 2,
      sessions: 1,
      urgent: false,
      hidden: false,
      days: ["2026-10-30"],
      firstShiftId: "rff",
    },
    {
      siteId: "site-hillside",
      name: "Hillside Demo Square",
      town: "Sampleford",
      lat: null,
      lng: null,
      places: 4,
      sessions: 1,
      urgent: false,
      hidden: true,
      days: ["2026-11-22"],
      firstShiftId: "hs1",
    },
  ]),
  takers: ok({ count: 1, only: { workerId: "w-zoe", name: "Zoe Adeyemi", hoursThisWeek: 8 } }),
  updates: ok({
    more: false,
    items: [
      {
        kind: "took",
        at: at("2026-10-26T09:06:00Z"),
        shiftId: "nll3",
        worker: "Ben Fraser",
        role: "steward",
        site: "Acme Demo Arena",
        startsAt: at("2026-11-01T17:00:00Z"),
        placesFree: 0,
      },
      {
        kind: "cancelled",
        at: at("2026-10-26T06:00:00Z"),
        shiftId: "nll1",
        ref: "a-chloe",
        worker: "Chloe Quigley",
        role: "door_supervisor",
        site: "Acme Demo Arena",
        startsAt: at("2026-10-27T08:00:00Z"),
        noticeHours: 26,
        strike: "live",
        reopened: true,
      },
      {
        kind: "no-reply",
        at: at("2026-10-26T08:02:00Z"),
        oldest: at("2026-10-26T07:19:00Z"),
        offers: 3,
        sessions: 2,
      },
      {
        kind: "upload",
        at: at("2026-10-25T15:44:00Z"),
        workerId: "w-ben",
        worker: "Ben Fraser",
        what: "photo",
      },
    ],
  }),
  whoWorked: ok([
    // The two alike sessions together, each person with their own.
    {
      role: "steward",
      site: "Acme Demo Racecourse",
      startsAt: at("2026-10-25T09:00:00Z"),
      endsAt: at("2026-10-25T17:00:00Z"),
      shiftIds: ["m1", "m2"],
      people: [
        { shiftId: "m1", workerId: "w-nr", name: "Nathan Reid" },
        { shiftId: "m2", workerId: "w-tw", name: "Tomasz Walsh" },
      ],
    },
    {
      role: "security_officer",
      site: "Acme Demo Shopping Centre",
      startsAt: at("2026-10-25T10:00:00Z"),
      endsAt: at("2026-10-25T18:00:00Z"),
      shiftIds: ["m3"],
      people: [{ shiftId: "m3", workerId: "w-bp", name: "Bea Patel" }],
    },
  ]),
  // Phase 26.3: their own dashboard (the default cards, no contracts), every date, no extra cards.
  me: ok({ cards: [...DEFAULT_CARDS], clientIds: [], sites: null, choices: [] }),
  mine: false,
  day: null,
  days: ok([
    { date: "2026-10-27", places: 5 },
    { date: "2026-10-30", places: 2 },
  ]),
  nextTwoWeeks: null,
  cancelWeeks: null,
  noShowWeeks: null,
  fillRates: null,
  watchList: null,
};

const render = (b: Board) =>
  renderToStaticMarkup(createElement(DashboardContent, { board: b, tiles: null }));
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
// The HTML of the section with this id.
const section = (html: string, id: string) =>
  new RegExp(`<section id="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html)?.[1] ?? "";
const links = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: (/href="([^"]*)"/.exec(m[1] ?? "")?.[1] ?? "").replace(/&amp;/g, "&"),
    label:
      /aria-label="([^"]*)"/
        .exec(m[1] ?? "")?.[1]
        ?.replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&") ?? null,
    current: /aria-current="([^"]*)"/.exec(m[1] ?? "")?.[1] ?? null,
    name: words(m[2] ?? ""),
  }));

describe("the dashboard's words", () => {
  it("the head's line: the day, the pay week and its pay day, and when the planner or sheet last sent changes", () => {
    expect(headLine("2026-10-26", { kind: "api", lastChangeAt: NOW }, NOW, TZ)).toBe(
      "Monday 26 October · Week 44 · Pay Fri 6 Nov · Updated 11:20 from your planner",
    );
    expect(
      headLine("2026-10-26", { kind: "sheet", syncedAt: at("2026-10-25T21:05:00Z") }, NOW, TZ),
    ).toBe(
      "Monday 26 October · Week 44 · Pay Fri 6 Nov · Updated Sun 25 Oct, 21:05 from your rota sheet",
    );
    // Nothing connected, a sheet never synced, or its part unread: nothing to say.
    for (const p of [{ kind: "none" as const }, { kind: "sheet" as const, syncedAt: null }, null])
      expect(headLine("2026-10-26", p, NOW, TZ)).toBe(
        "Monday 26 October · Week 44 · Pay Fri 6 Nov",
      );
  });

  it("the head on the firm's pay calendar, in its word (Phase 25.2)", () => {
    const fortnight = payCalendar({
      pay_calendar: { days: 14, anchor: "2026-01-05", pay_day_after: 5, label: "cycle" },
    });
    // 26 Oct is the first day of cycle 22 (5 Jan + 21 fortnights), paid Fri 13 Nov.
    expect(headLine("2026-10-30", null, NOW, TZ, fortnight)).toBe(
      "Friday 30 October · Cycle 22 · Pay Fri 13 Nov",
    );
    // Its second week is the same cycle and pay day.
    expect(headLine("2026-11-02", null, NOW, TZ, fortnight)).toBe(
      "Monday 2 November · Cycle 22 · Pay Fri 13 Nov",
    );
    // A firm that calls its fortnight a week, and paid on the Thursday: its own word and day.
    const weeks = payCalendar({
      pay_calendar: { days: 14, anchor: "2026-01-05", pay_day_after: 4, label: "week" },
    });
    expect(headLine("2026-10-30", null, NOW, TZ, weeks)).toBe(
      "Friday 30 October · Week 22 · Pay Thu 12 Nov",
    );
    // A day before the calendar starts has no number.
    expect(headLine("2026-01-02", null, NOW, TZ, fortnight)).toMatch(
      /^Friday 2 January · Cycle · Pay /,
    );
  });

  it("the track's links and a picked session's address keep the filter", () => {
    expect(showHref("all")).toBe("/office");
    expect(showHref("next-week")).toBe("/office?show=next-week");
    expect(pickHref("all", "s1")).toBe("/office?session=s1");
    expect(pickHref("urgent", "s1")).toBe("/office?show=urgent&session=s1");
  });

  it("the chart: its top in tens, a bar's tip, and what it shows in a sentence", () => {
    expect(chartTop(days)).toBe(10);
    expect(chartTop([{ date: "2026-10-26", toOffer: 7, offered: 6 }])).toBe(20);
    expect(chartTop([{ date: "2026-10-26", toOffer: 10, offered: 0 }])).toBe(10);
    expect(dayTip({ date: "2026-10-31", toOffer: 3, offered: 7 })).toBe(
      "Sat 31: 3 to offer, 7 offered",
    );
    expect(dayTip({ date: "2026-10-31", toOffer: 0, offered: 2 })).toBe("Sat 31: 2 offered");
    expect(dayTip({ date: "2026-11-01", toOffer: 0, offered: 0 })).toBe("Sun 1: nothing to fill");
    expect(chartSummary(days)).toBe(
      "Places to fill this week and next: 4 to offer, 3 offered with no reply yet. Saturday 31 October has the most, 3.",
    );
    expect(chartSummary(days.map((d) => ({ ...d, toOffer: 0, offered: 0 })))).toBe(
      "No places to fill this week or next.",
    );
  });

  it("a session: when, where, how soon (the firm's calendar), its replies and what's in its way", () => {
    expect(whenText(nll1, TZ)).toBe("Tue 27 Oct, 08:00–16:00");
    expect(whereText(nll1)).toBe("Northern Lights Live · Gate A, Acme Demo Arena");
    expect(whereText({ ...nll1, post: null })).toBe("Northern Lights Live · Acme Demo Arena");
    expect(whereText({ ...nll1, post: null, site: null })).toBe("Northern Lights Live");
    expect(startsIn(nll1.startsAt, NOW, TZ)).toEqual({ text: "20 h", soon: true });
    expect(startsIn(at("2026-10-26T12:05:00Z"), NOW, TZ)).toEqual({ text: "45 min", soon: true });
    expect(startsIn(at("2026-10-28T19:00:00Z"), NOW, TZ)).toEqual({ text: "2 days", soon: false });
    // Across the clocks going back: calendar days, not 24-hour steps.
    expect(startsIn(at("2026-10-25T23:30:00Z"), at("2026-10-23T09:00:00Z"), TZ)).toEqual({
      text: "2 days",
      soon: false,
    });
    expect(repliesText(offers())).toBe("Not offered yet");
    expect(repliesText(offers({ sent: 1, waiting: 1 }))).toBe("No reply yet");
    expect(repliesText(offers({ sent: 4, waiting: 1, saidNo: 1, tookIt: 1, closed: 1 }))).toBe(
      "1 took it · 1 said no · 1 closed · 1 no reply yet",
    );
    expect(bannerText(nll1, NOW, TZ)).toEqual({
      text: "Mo Rahman hasn't replied since 07:19.",
      tone: "amber",
    });
    expect(bannerText(rff, NOW, TZ).text).toBe(
      "Ben Fraser and Priya Shah haven't replied since 08:02.",
    );
    expect(
      bannerText(
        {
          ...rff,
          offers: offers({
            sent: 3,
            waiting: 3,
            waitingSince: at("2026-10-25T21:40:00Z"),
            waitingNames: ["Ben Fraser", "Priya Shah"],
          }),
        },
        NOW,
        TZ,
      ).text,
    ).toBe("Ben Fraser and 2 others haven't replied since Sun 25 Oct, 21:40.");
    expect(bannerText(session({ shiftId: "x" }), NOW, TZ)).toEqual({
      text: "Not offered to anyone yet.",
      tone: "red",
    });
    expect(
      bannerText(session({ shiftId: "x", offers: offers({ sent: 2, saidNo: 2 }) }), NOW, TZ),
    ).toEqual({ text: "No offers out. Offer it to someone else.", tone: "red" });
    // The waves stopped at the most for its free places (Phase 25.3): said so, with the count.
    expect(
      bannerText(
        session({ shiftId: "x", placesFree: 1, offers: offers({ sent: 25, atLimit: true }) }),
        NOW,
        TZ,
      ),
    ).toEqual({
      text: "Offers stopped: 25 casuals were offered it, the most for 1 place. Offer it to someone yourself.",
      tone: "red",
    });
    expect(
      bannerText(
        session({ shiftId: "x", placesFree: 2, offers: offers({ sent: 50, atLimit: true }) }),
        NOW,
        TZ,
      ).text,
    ).toBe(
      "Offers stopped: 50 casuals were offered it, the most for 2 places. Offer it to someone yourself.",
    );
    // While offers wait, that comes first.
    expect(
      bannerText(
        session({
          shiftId: "x",
          offers: offers({
            sent: 25,
            waiting: 1,
            atLimit: true,
            waitingSince: at("2026-10-26T11:00:00Z"),
            waitingNames: ["Mo Rahman"],
          }),
        }),
        NOW,
        TZ,
      ).text,
    ).toBe("Mo Rahman hasn't replied since 11:00.");
    // Hidden from casuals comes first: it can't be offered at all.
    expect(bannerText({ ...nll1, hidden: true }, NOW, TZ)).toEqual({
      text: "Hidden from casuals, so it can't be offered. Show it to casuals first.",
      tone: "red",
    });
  });

  it("a card's names: its pick, its paper plane, the detail card's …", () => {
    expect(cardLabel(nll1, TZ)).toBe(
      "Urgent. Door supervisor, Northern Lights Live, Tue 27 Oct, 08:00–16:00. 1 to fill, 1 offered, no reply yet. Show its details.",
    );
    expect(cardLabel(toOffer[1]!, TZ)).toBe(
      "Steward, Acme Demo Racecourse, Thu 29 Oct, 19:00–23:00. 1 to fill. Show its details.",
    );
    expect(offerLabel(nll1, TZ)).toBe("Offer door supervisor, Tue 27 Oct 08:00, to someone");
    // An acronym stays in capitals.
    expect(offerLabel(toOffer[0]!, TZ)).toBe("Offer CSAS officer, Wed 28 Oct 19:00, to someone");
    expect(moreLabel(nll1, TZ)).toBe("More for Tuesday's door supervisor at 08:00");
  });

  it("the columns' lines, what an empty one says, and where the rest of a long one are", () => {
    expect(toOfferLine(13)).toBe("13 places, no offers out");
    expect(toOfferLine(1)).toBe("1 place, no offers out");
    expect(offeredLine(13, 11)).toBe("13 places · 11 offers, no reply yet");
    expect(offeredLine(1, 1)).toBe("1 place · 1 offer, no reply yet");
    const items = (...days: string[]) => days.map((d) => ({ startsAt: at(`${d}T10:00:00Z`) }));
    expect(toMarkLine(items("2026-10-25", "2026-10-25"), TZ)).toBe("2 sessions from Sun 25 Oct");
    expect(toMarkLine(items("2026-10-25", "2026-10-22"), TZ)).toBe(
      "2 sessions from Thu 22 to Sun 25 Oct",
    );
    expect(toMarkLine(items("2026-11-02", "2026-10-30"), TZ)).toBe(
      "2 sessions from Fri 30 Oct to Mon 2 Nov",
    );
    expect(emptyText("toOffer", false, "all")).toBe("Every place here has been offered.");
    expect(emptyText("toOffer", true, "all")).toBe("No places to fill.");
    expect(emptyText("toOffer", true, "urgent")).toBe("No urgent places to fill.");
    expect(emptyText("toOffer", true, "next-week")).toBe("No places to fill next week.");
    expect(emptyText("toMark", true, "all")).toBe("Nothing to mark.");
    expect(columnMoreText(1)).toBe("1 more session on Events & sessions");
    expect(columnMoreText(7)).toBe("7 more sessions on Events & sessions");
  });

  it("a person's initials", () => {
    expect(initials("Ben Fraser")).toBe("BF");
    expect(initials("Mo  Rahman Smith")).toBe("MR");
  });

  it("a session to mark: since when, and its link's name", () => {
    expect(sinceText(at("2026-10-26T09:30:00Z"), NOW, TZ)).toBe("Since 09:30");
    expect(sinceText(at("2026-10-25T17:00:00Z"), NOW, TZ)).toBe("Since yesterday");
    expect(sinceText(at("2026-10-24T17:00:00Z"), NOW, TZ)).toBe("Since Sat 24 Oct");
    const g = {
      role: "steward",
      site: "Acme Demo Racecourse",
      startsAt: at("2026-10-25T09:00:00Z"),
      endsAt: at("2026-10-25T17:00:00Z"),
      unmarked: 4,
    };
    expect(markLabel(g, 2, TZ)).toBe(
      "Mark who worked: Steward at Acme Demo Racecourse, Sun 25 Oct, 2 sessions, 4 people to mark",
    );
    expect(markLabel({ ...g, site: null, unmarked: 1 }, 1, TZ)).toBe(
      "Mark who worked: Steward, Sun 25 Oct, 09:00–17:00, 1 person to mark",
    );
  });
});

describe("the dashboard page (round 8: Phase 26.2)", () => {
  const track = (html: string) =>
    /<nav aria-label="Show"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
  const map = (html: string) =>
    /<section aria-labelledby="venue-map-title"[^>]*>([\s\S]*)/
      .exec(html)?.[1]
      ?.split('<section id="to-offer"')[0] ?? "";
  const card = (html: string) =>
    /<section aria-labelledby="chosen-title" data-chosen="nll1"[^>]*>([\s\S]*?)<\/section>/.exec(
      html,
    )?.[1] ?? "";

  it("one heading for the page, its line, the track with its counts, and Show full venues", () => {
    const html = render(board);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toMatch(/<h1 class="text-title text-ink">Dashboard<\/h1>/);
    expect(words(html)).toContain(
      "Monday 26 October · Week 44 · Pay Fri 6 Nov · Updated 11:20 from your planner",
    );
    expect(links(track(html)).map((l) => [l.href, l.name, l.current])).toEqual([
      ["/office", "All 6", "page"],
      ["/office?show=urgent", "Urgent 2", null],
      ["/office?show=this-week", "This week 6", null],
      ["/office?show=next-week", "Next week 0", null],
    ]);
    // Show full venues: a switch, off; on, the track keeps it and the switch goes back.
    expect(html).toMatch(
      /<a role="switch" aria-checked="false" [^>]*href="\/office\?full=1"[^>]*>Show full venues/,
    );
    const full = render({ ...board, full: true, show: "urgent", role: "steward" });
    expect(full).toMatch(
      /<a role="switch" aria-checked="true" [^>]*href="\/office\?show=urgent&amp;role=steward"[^>]*>Show full venues/,
    );
    expect(links(track(full)).map((l) => l.href)).toEqual([
      "/office?role=steward&full=1",
      "/office?show=urgent&role=steward&full=1",
      "/office?show=this-week&role=steward&full=1",
      "/office?show=next-week&role=steward&full=1",
    ]);
    // A picked session keeps the whole view.
    expect(links(map(full)).find((l) => l.href.includes("session="))?.href).toBe(
      "/office?show=urgent&role=steward&full=1&session=nll1",
    );
  });

  it("Filter: the roles with places to fill, by name, and Every role; the chosen one current", () => {
    const filter = (html: string) =>
      /<details class="group relative"><summary aria-label="(Filter[^"]*)"[^>]*>([\s\S]*?)<\/details>/.exec(
        html,
      );
    const off = filter(render(board));
    expect(off?.[1]).toBe("Filter by role");
    expect(links(off?.[2] ?? "").map((l) => [l.href, l.name, l.current])).toEqual([
      ["/office", "Every role", "true"],
      ["/office?role=csas_officer", "CSAS officer", null],
      ["/office?role=door_supervisor", "Door supervisor", null],
      ["/office?role=steward", "Steward", null],
    ]);
    const on = filter(render({ ...board, role: "steward" }));
    expect(on?.[1]).toBe("Filter: Steward");
    expect(words(on?.[2] ?? "")).toMatch(/^Steward /);
    expect(
      links(on?.[2] ?? "")
        .filter((l) => l.current)
        .map((l) => l.name),
    ).toEqual(["Steward"]);
    // No roles with places to fill: no Filter.
    expect(filter(render({ ...board, roles: ok([]) }))).toBeNull();
  });

  it("the venue map: a pin per placed venue, its number its places, each a link to its soonest session; the rest listed", () => {
    const m = map(render(board));
    const pins = links(m).filter((l) => l.label?.includes("place"));
    expect(pins.map((l) => [l.href, l.label, l.current])).toEqual([
      [
        "/office?session=nll1",
        "Acme Demo Arena: 5 places to fill, urgent, Tue 27, Wed 28, Thu 29 and 1 more",
        "true",
      ],
      ["/office?session=rff", "Riverside Demo Park: 2 places to fill, Fri 30", null],
    ]);
    // Placed by their positions (no street map here): the further north, the higher up. As the
    // page arrives (before it has measured the map), by share of the part right of the card (the
    // box's --inset: 27rem from 1024px, where the card sits over the map).
    const spots = [
      ...m.matchAll(
        /style="left:calc\(var\(--inset\) \+ \(100% - var\(--inset\)\) \* ([\d.]+)\);top:([\d.]+)%"/g,
      ),
    ].map((x) => [Number(x[1]), Number(x[2])] as const);
    expect(spots).toHaveLength(2);
    expect(spots[1]![1]).toBeLessThan(spots[0]![1]);
    for (const [x] of spots) expect(x).toBeGreaterThanOrEqual(0);
    expect(m).toMatch(
      /data-venue-map="plain" class="[^"]*\[--inset:0px\][^"]*@min-\[64rem\]:\[--inset:27rem\]/,
    );
    expect(m).toContain('data-venue-map="plain"');
    // The urgent venue's pin red; a venue with no position listed under the map, never guessed.
    expect(m).toMatch(/border-urgent-fill bg-urgent-fill text-on-urgent[^"]*">5</);
    expect(words(m)).toContain(
      "Placed by each venue's postcode · a pin's number is its places to fill 3 venues · 11 places to fill",
    );
    expect(words(m)).toContain(
      "Not on the map (no postcode yet): Hillside Demo Square, 4 places to fill.",
    );
    // The key: what a pin's ring means; "All filled" too while Show full venues is on.
    const key = (html: string) =>
      words(/<ul role="list" aria-label="Key"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "");
    expect(key(m)).toBe("Urgent Places to fill Hidden from casuals");
    expect(key(map(render({ ...board, full: true })))).toBe(
      "Urgent Places to fill Hidden from casuals All filled",
    );
    // The same figures as a table, one tap away (aud-9): every venue, placed or not, each a link
    // like its pin.
    const table =
      /<details[^>]*><summary[^>]*>Show as a table[\s\S]*?<\/details>/.exec(m)?.[0] ?? "";
    expect(words(table)).toBe(
      [
        "Show as a table Venues with places to fill Venue Places to fill Days",
        "Acme Demo Arena Exampleton 5 · urgent Tue 27, Wed 28, Thu 29 and 1 more",
        "Riverside Demo Park Exampleton 2 Fri 30",
        "Hillside Demo Square Sampleford 4 Sun 22 · hidden",
      ].join(" "),
    );
    expect(links(table).map((l) => l.href)).toEqual([
      "/office?session=nll1",
      "/office?session=rff",
      "/office?session=hs1",
    ]);
  });

  it("the session card on the map: what, where, when, pay, booked, who can take it and what to do", () => {
    const html = render(board);
    expect(words(card(html))).toBe(
      [
        "Tue 27 Door supervisor Urgent",
        "Northern Lights Live · Gate A, Acme Demo Arena",
        // The "…" menu's own words (shut until its button is pressed).
        "Mark as filled Only if you've filled it another way. Nobody else will be offered it.",
        "Yes, mark as filled Not urgent",
        "Tue 27 Oct, 08:00–16:00 8 h · £15.50/h",
        "Starts in 20 h 1 place to fill",
        "Booked Urgent 3 / 4 booked",
        "Can take it 1 offered 1 Under the rules, right now",
        // An offer still waiting: who hasn't replied, before who else could take it.
        "Mo Rahman hasn't replied since 07:19.",
        "Offer to Zoe Open the shift",
      ].join(" "),
    );
    expect(links(card(html)).map((l) => [l.href, l.name])).toEqual([
      ["/office/offer/nll1", "Offer to Zoe"],
      ["/office/shifts/nll1", "Open the shift"],
    ]);
    // Starting in under 2 days: red.
    expect(card(html)).toMatch(/text-urgent">Starts in 20 h</);
    // No offer waiting: who can take it, when it's one person or nobody.
    const quiet = (takers: Board["takers"]) =>
      render({
        ...board,
        takers,
        gaps: ok({
          ...(board.gaps.ok ? board.gaps.data : ({} as never)),
          chosen: { ...nll1, offers: offers({ sent: 1, saidNo: 1 }) },
        }),
      });
    expect(words(card(quiet(board.takers)))).toContain(
      "Only Zoe Adeyemi can take it: 8 hours booked that week. Offer to Zoe",
    );
    expect(words(card(quiet(ok({ count: 0, only: null }))))).toContain(
      "Nobody can be offered it right now. Offer to someone",
    );
    // Several can take it: "Offer to someone", and the session's own line.
    const several = render({ ...board, takers: ok({ count: 4, only: null }) });
    expect(words(card(several))).toContain(
      "Can take it 1 offered 4 Under the rules, right now Mo Rahman hasn't replied since 07:19. Offer to someone",
    );
    // A planner's session: no Mark as filled.
    const planner = render({
      ...board,
      gaps: ok({
        ...(board.gaps.ok ? board.gaps.data : ({} as never)),
        chosen: { ...nll1, fromPlanner: true },
      }),
    });
    expect(planner).not.toContain("Mark as filled");
    expect(planner).toContain("Not urgent");
  });

  it("three columns under the map: To offer, Updates and Who worked?", () => {
    const html = render(board);
    const ids = [...html.matchAll(/<section id="([a-z-]+)" aria-labelledby="\1-title"/g)].map(
      (m) => m[1],
    );
    expect(ids).toEqual(["to-offer", "updates", "who-worked"]);
    expect(html.indexOf('aria-labelledby="venue-map-title"')).toBeLessThan(
      html.indexOf('<section id="to-offer"'),
    );
    expect(html).not.toContain('id="offered"');
    expect(html).not.toContain('id="while-you-were-out"');
    expect(html).not.toContain('id="places-chart"');
  });

  it("To offer: every session with places, soonest first, four rows then View all", () => {
    const col = section(render(board), "to-offer");
    expect(words(col)).toMatch(/^To offer 6 6 sessions 7 places · 3 offers, no reply yet /);
    expect([...col.matchAll(/data-session="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "nll1",
      "np1",
      "nll2",
      // Fri 30 at 14:00, before the racecourse's at 19:00 that day.
      "rff",
    ]);
    const l = links(col);
    expect(l.slice(0, 2).map((x) => [x.href, x.label, x.current])).toEqual([
      ["/office?session=nll1", cardLabel(nll1, TZ), "true"],
      ["/office/offer/nll1", offerLabel(nll1, TZ), null],
    ]);
    expect(l.at(-1)).toMatchObject({ href: "/office/events?view=need", name: "View all 6" });
    // A row: its role, "Urgent", venue and start, booked of how many.
    const row = col.split('data-session="').find((c) => c.startsWith('nll1"')) ?? "";
    expect(words(row)).toContain("Door supervisor Urgent Acme Demo Arena · 08:00 3/4 booked");
  });

  it("Updates: each one a link to where it's dealt with, then All updates (Phase 26.4)", () => {
    const col = section(render(board), "updates");
    expect(words(col)).toMatch(/^Updates 4 4 updates /);
    expect(words(col)).toContain(
      "Ben Fraser took a place Steward, Acme Demo Arena, Sun 1 Nov 17:00 · now full 09:06",
    );
    expect(words(col)).toContain(
      "Chloe Quigley cancelled · 26 hours' notice Door supervisor, Acme Demo Arena, Tue 27 Oct 08:00 · strike issued · reopened 06:00",
    );
    expect(words(col)).toContain(
      "No reply yet · 3 offers On 2 sessions · the oldest sent Mon 07:19 08:02",
    );
    expect(words(col)).toContain("Ben Fraser sent a staff photo Waiting for a check Sun 15:44");
    expect(links(col).map((l) => l.href)).toEqual([
      "/office/shifts/nll3",
      "/office/cancellations/a-chloe",
      "/office/events?view=need",
      "/office/casuals/w-ben",
      "/office/updates",
    ]);
  });

  it("Who worked?: alike sessions together with their day, each person by name with Worked and Didn't attend; Everyone else worked for several", () => {
    const col = section(render(board), "who-worked");
    expect(words(col)).toMatch(/^Who worked\? 3 3 sessions to mark 3 sessions from Sun 25 Oct /);
    expect(words(col)).toContain(
      "Sun 25 Oct · Steward · Acme Demo Racecourse · 09:00–17:00 · 2 sessions NR Nathan Reid",
    );
    expect(words(col)).toContain(
      "Sun 25 Oct · Security officer · Acme Demo Shopping Centre · 10:00–18:00 BP Bea Patel",
    );
    // A group's heading: a link to the session for one; plain words for several (no one page).
    expect(links(col).map((l) => l.href)).toEqual(["/office/shifts/m3"]);
    const buttons = [...col.matchAll(/<button [^>]*aria-label="([^"]+)"/g)].map((m) =>
      m[1]!.replace(/&#x27;/g, "'"),
    );
    // Each named for its person and session (unique on the page: aud-5).
    expect(buttons).toEqual([
      "Nathan Reid worked, Sun 25 Oct 09:00",
      "Nathan Reid didn't attend, Sun 25 Oct 09:00",
      "Tomasz Walsh worked, Sun 25 Oct 09:00",
      "Tomasz Walsh didn't attend, Sun 25 Oct 09:00",
      "Bea Patel worked, Sun 25 Oct 10:00",
      "Bea Patel didn't attend, Sun 25 Oct 10:00",
    ]);
    // Everyone else, after a "Yes": only where there are several.
    expect(col.match(/>Everyone else worked</g)).toHaveLength(1);
    expect(col).toContain(
      'aria-label="Everyone else worked: Sun 25 Oct · Steward · Acme Demo Racecourse · 09:00–17:00 · 2 sessions"',
    );
    expect(col).toContain(">Yes, everyone else worked<");
    // Both groups shown: nothing more. More than three: the first three, then "Show all 4"
    // (Phase 26.4: every session to mark is here now, none on Needs attention).
    expect(col).not.toContain("Show all");
    const group = (n: number) => ({
      ...(board.whoWorked.ok ? board.whoWorked.data : [])[1]!,
      shiftIds: [`g${n}`],
      people: [{ shiftId: `g${n}`, workerId: `w${n}`, name: `Person ${n}` }],
    });
    const many = section(
      render({ ...board, whoWorked: ok([1, 2, 3, 4].map(group)) }),
      "who-worked",
    );
    expect(many.match(/ worked, /g)).toHaveLength(3);
    expect(many).toMatch(/<button type="button"[^>]*>Show all 4<svg /);
    expect(many).not.toContain("needs-attention");
  });

  it("empty columns say so; with nothing to fill, the card says that instead", () => {
    const none: Board = {
      ...board,
      counts: ok({ all: 0, urgent: 0, "this-week": 0, "next-week": 0 }),
      gaps: ok({
        toOffer: { sessions: [], total: 0, places: 0, waiting: 0, more: false },
        offered: { sessions: [], total: 0, places: 0, waiting: 0, more: false },
        chosen: null,
      }),
      venues: ok([]),
      takers: null,
      updates: ok({ items: [], more: false }),
      toMark: ok({ items: [], total: 0 }),
      whoWorked: ok([]),
    };
    const html = render(none);
    // Each says what will show there (the pre-build audit's aud-10).
    expect(words(section(html, "to-offer"))).toContain(
      "No places to fill. Sessions with a place free show here, soonest first.",
    );
    expect(words(section(html, "updates"))).toContain(
      "Nothing new in the last two days. Places taken, cancellations, and photos or certificates to check show here.",
    );
    expect(words(section(html, "who-worked"))).toContain(
      "Nothing to mark. Sessions show here when they end, so you can mark who worked.",
    );
    // Nothing on the map, so no table of it.
    expect(html).not.toContain("Show as a table");
    expect(html).toMatch(/<section aria-label="Chosen session"[^>]*>.*No places to fill\./);
    expect(words(map(html))).toContain("No places to fill here.");
  });

  it("a part that couldn't load says so where it shows; the rest still shows", () => {
    const html = render({
      ...board,
      counts: failed,
      gaps: failed,
      toMark: failed,
      venues: failed,
      updates: failed,
      whoWorked: failed,
      planner: failed,
    });
    // The track, the map, To offer, Updates and Who worked?.
    expect(html.split(SECTION_ERROR.replace("'", "&#x27;")).length - 1).toBe(5);
    expect(html).toContain(">Dashboard</h1>");
    expect(words(html)).toContain("Monday 26 October · Week 44 · Pay Fri 6 Nov");
    expect(words(html)).not.toContain("Updated");
    expect(links(track(html)).map((l) => l.name)).toEqual([
      "All",
      "Urgent",
      "This week",
      "Next week",
    ]);
  });

  it("no link on the dashboard repeats a menu link's name", () => {
    const menu = officeMenu("admin").flatMap((g) => g.links.map((l) => l.label));
    expect(menu).toEqual(expect.arrayContaining(["Dashboard", "Events & sessions"]));
    const names = links(render(board)).map((l) => l.label ?? l.name);
    expect(names.length).toBeGreaterThan(12);
    for (const label of menu) expect(names).not.toContain(label);
  });
});

describe("the offer panel lists who can take it as the offer page does", () => {
  const page: OfferPage = {
    timeZone: TZ,
    shift: {
      shiftId: "nll1",
      role: "door_supervisor",
      site: "Acme Demo Arena",
      startsAt: at("2026-10-27T08:00:00Z"),
      endsAt: at("2026-10-27T16:00:00Z"),
      placesLeft: 1,
      isUrgent: true,
      open: true,
      hidden: false,
    },
    candidates: [
      {
        workerId: "w1",
        name: "Priya Shah",
        hoursThisWeek: 4,
        channel: "sms",
        reach: { how: "push" },
        outsideArea: false,
      },
      {
        workerId: "w2",
        name: "Kieran Doyle",
        hoursThisWeek: 8,
        channel: "email",
        reach: { how: "email", why: "chose_email" },
        outsideArea: true,
      },
      {
        workerId: "w3",
        name: "Tom Hale",
        hoursThisWeek: 16,
        channel: "sms",
        reach: { how: "sms" },
        outsideArea: false,
      },
    ] as OfferPage["candidates"],
    notOffered: [
      { workerId: "w4", name: "Ben Fraser", why: "booked" },
      { workerId: "w5", name: "Mo Rahman", why: "licence" },
      { workerId: "w6", name: "Zoe Adeyemi", why: "cap" },
    ],
    notOfferedMore: 2,
    offered: [
      { worker: "Mo Rahman", wave: null, response: null, sentAt: at("2026-10-26T07:19:00Z") },
      { worker: "Ben Fraser", wave: 1, response: "declined", sentAt: at("2026-10-25T10:00:00Z") },
      { worker: "Leah Ward", wave: 2, response: "expired", sentAt: at("2026-10-25T11:00:00Z") },
    ],
  };
  const panel = (p: OfferPage) => renderToStaticMarkup(createElement(OfferContent, { page: p }));
  const offerPage = (p: OfferPage) => renderToStaticMarkup(createElement(OfferView, { page: p }));
  const people = (html: string) =>
    [...html.matchAll(/aria-label="Send offer to ([^"]+)"/g)].map((m) => m[1]);
  const answers = (html: string) => words(/Already offered([\s\S]*)$/.exec(words(html))?.[1] ?? "");

  it("the same people in the same order, each with the same line and Send offer", () => {
    expect(people(panel(page))).toEqual(["Priya Shah", "Kieran Doyle", "Tom Hale"]);
    expect(people(panel(page))).toEqual(people(offerPage(page)));
    // How each offer will reach them, and why (Phase 26.9, off-1), and the travel area.
    for (const line of [
      "4 hours booked that week By app notification",
      "8 hours booked that week By email: they chose email Outside their travel area",
      "16 hours booked that week By text: no app notifications on their phone",
    ]) {
      expect(words(panel(page))).toContain(line);
      expect(words(offerPage(page))).toContain(line);
    }
    expect(words(panel(page))).not.toContain("WhatsApp");
    expect(words(offerPage(page))).not.toContain("WhatsApp");
    // Not offered, and why (off-2), in the same words in both.
    for (const html of [panel(page), offerPage(page)]) {
      expect(words(html)).toContain(
        "Not offered, and why Ben Fraser Booked on it Mo Rahman No licence in date Zoe Adeyemi Over today's 3 offers And 2 more.",
      );
    }
    expect(words(panel(page))).toContain("This shift is urgent: they get the urgent message.");
  });

  it("who has been offered it and how they answered, in the same words (an expired offer closed when the shift changed)", () => {
    expect(answers(panel(page))).toBe(
      "Mo Rahman: waiting (by the office, 07:19 on Mon 26 Oct) Ben Fraser: said no (wave 1, 10:00 on Sun 25 Oct) Leah Ward: closed when the shift changed (wave 2, 11:00 on Sun 25 Oct)",
    );
    expect(answers(offerPage(page)).startsWith(answers(panel(page)))).toBe(true);
  });

  it("nobody when it's hidden from casuals or not open, as the page says", () => {
    const hidden = { ...page, shift: { ...page.shift, hidden: true }, candidates: [] };
    expect(words(panel(hidden))).toContain(
      "This shift is hidden from casuals, so it can't be offered.",
    );
    expect(people(panel(hidden))).toEqual([]);
    const closed = { ...page, shift: { ...page.shift, open: false }, candidates: [] };
    expect(words(panel(closed))).toContain("This shift isn't open any more.");
    expect(words(panel({ ...page, candidates: [] }))).toContain(
      "Nobody else can be offered this shift right now.",
    );
    expect(words(panel({ ...page, notOffered: [], notOfferedMore: 0 }))).toContain(
      "Everyone with the role can be offered it.",
    );
  });
});

// Phase 26.3: each person's own dashboard (the spec page's "Customise and contracts", dash-7).
describe("the dashboard, each person's own (Phase 26.3)", () => {
  it("Customise and the date choice in the title row: every day with places, the chosen one current", () => {
    const html = render(board);
    const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    // Customise: the page of its own until the page is ready (then the panel).
    expect(links(header).find((l) => l.name === "Customise")?.href).toBe("/office/customise");
    expect(header).toContain('aria-haspopup="dialog"');
    const choice = /<summary aria-label="(Choose a date|Date: [^"]+)"[\s\S]*?<\/details>/.exec(
      header,
    );
    expect(choice?.[1]).toBe("Choose a date");
    expect(links(choice?.[0] ?? "").map((l) => [l.href, l.name, l.current])).toEqual([
      ["/office", "All dates", "true"],
      ["/office?day=2026-10-27", "Tue 27 Oct · 5 places", null],
      ["/office?day=2026-10-30", "Fri 30 Oct · 2 places", null],
    ]);
    const picked = /<header[\s\S]*?<\/header>/.exec(render({ ...board, day: "2026-10-30" }))?.[0];
    expect(picked).toContain('aria-label="Date: Fri 30 Oct"');
    // Every other link on the page keeps the day.
    expect(
      links(render({ ...board, day: "2026-10-30" })).find((l) => l.name.startsWith("Urgent"))?.href,
    ).toBe("/office?show=urgent&day=2026-10-30");
    // No day with places: no date choice.
    expect(render({ ...board, days: ok([]) })).not.toContain("All dates");
  });

  it("My contracts: a switch only for someone with contracts, on while narrowed to them", () => {
    expect(render(board)).not.toContain("My contracts");
    const me = ok({
      cards: [...DEFAULT_CARDS],
      clientIds: ["c1"],
      sites: ["site-arena"],
      choices: [{ clientId: "c1", name: "Acme Demo Arena", sites: 1, sessions: 4 }],
    });
    const mine =
      /<a role="switch" aria-checked="(true|false)"[^>]*href="([^"]+)"[^>]*>My contracts/.exec(
        render({ ...board, me, mine: true }),
      );
    // On: its link shows everything (`?all=1`), and the page's other links keep that choice.
    expect(mine?.slice(1)).toEqual(["true", "/office?all=1"]);
    const everything = render({ ...board, me, mine: false });
    expect(
      /<a role="switch" aria-checked="(true|false)"[^>]*href="([^"]+)"[^>]*>My contracts/
        .exec(everything)
        ?.slice(1),
    ).toEqual(["false", "/office"]);
    expect(links(everything).find((l) => l.name.startsWith("Urgent"))?.href).toBe(
      "/office?show=urgent&all=1",
    );
  });

  it("contracts with no venues yet: the dashboard says why it's empty, and Show everything", () => {
    const me = ok({ cards: [...DEFAULT_CARDS], clientIds: ["c1"], sites: [], choices: [] });
    const html = render({ ...board, me, mine: true });
    expect(words(html)).toContain(
      "Your contracts have no venues yet, so nothing shows here. An admin adds venues to contracts on Settings. Show everything",
    );
    expect(links(html).find((l) => l.name === "Show everything")?.href).toBe("/office?all=1");
    expect(render({ ...board, me, mine: false })).not.toContain("Your contracts have no venues");
  });

  it("only the cards chosen: no map (the session card on its own), the columns chosen, the extra cards", () => {
    const me = (cards: string[]) =>
      ok({ cards: cards as never, clientIds: [], sites: null, choices: [] });
    const html = render({
      ...board,
      me: me(["toOffer", "noShows"]),
      noShowWeeks: ok([{ week: "2026-10-19", noShows: 2 }]),
    });
    expect(html).not.toContain("data-venue-map");
    expect(html).toContain("data-chosen");
    expect(html).toContain('id="to-offer"');
    expect(html).not.toContain('id="updates"');
    expect(html).not.toContain('id="who-worked"');
    expect(
      words(/<section id="no-shows-by-week"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ""),
    ).toMatch(
      /^No-shows People marked as not attending, by the week of the session 2 no-shows in the last 8 weeks\./,
    );
    // The defaults: the map and the three columns, no extra card.
    const all = render(board);
    expect(all).toContain("data-venue-map");
    for (const id of ["to-offer", "updates", "who-worked"]) expect(all).toContain(`id="${id}"`);
    expect(all).not.toContain("no-shows-by-week");
  });
});
