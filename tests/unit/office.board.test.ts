import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { officeMenu } from "@/app/office/office-menu";
import {
  bannerText,
  cardLabel,
  chartSummary,
  chartTop,
  COLUMN_IDS,
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
  takeCard,
  toMarkLine,
  toOfferLine,
  whenText,
  whereText,
} from "@/lib/office/board-copy";
import type { Board, BoardSession, ChartDay } from "@/lib/office/dashboard-board";
import { SECTION_ERROR } from "@/lib/office/dashboard-copy";
import type { OfferPage } from "@/lib/office/offer-page";

// The office dashboard (Phase 24, 24.3: round 7 of the canvas; docs/mockups/phase-24/README.md;
// docs/screens.md `/office`): its words (src/lib/office/board-copy.ts) and the page as the server
// renders it (src/app/office/dashboard-view.tsx and ./dashboard/), from made-up data: the head and
// its line, the track, the places chart (its bars, axis, today and its table), the detail card,
// the board's four columns and their cards, each part that couldn't load, and the offer panel
// listing who can take a session as the offer page does. tests/integration/office.board.test.ts
// checks the loader on the database; tests/e2e/office.dashboard.spec.ts the page in a browser.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
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
  ...o,
});

const session = (o: Partial<BoardSession> & Pick<BoardSession, "shiftId">): BoardSession => ({
  eventId: "e1",
  eventName: "Northern Lights Live",
  role: "door_supervisor",
  post: "Gate A",
  site: "Acme Demo Arena",
  startsAt: at("2026-10-27T08:00:00Z"),
  endsAt: at("2026-10-27T16:00:00Z"),
  headcount: 4,
  placesFree: 1,
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
  now: NOW,
  show: "all",
  planner: ok({ kind: "api", lastChangeAt: at("2026-10-26T11:20:00Z") }),
  counts: ok({ all: 6, urgent: 2, "this-week": 6, "next-week": 0 }),
  chart: ok({ first: "2026-10-26", days }),
  gaps: ok({
    toOffer: { sessions: toOffer, total: 4, places: 4, waiting: 0, more: false },
    offered: { sessions: [nll1, rff], total: 2, places: 3, waiting: 3, more: false },
    chosen: nll1,
  }),
  overnight: ok({
    from: at("2026-10-25T18:00:00Z"),
    to: at("2026-10-26T08:00:00Z"),
    more: false,
    takes: [
      {
        offerId: "o1",
        shiftId: "nll3",
        worker: "Ben Fraser",
        role: "steward",
        eventName: "Northern Lights Live",
        startsAt: at("2026-11-01T17:00:00Z"),
        endsAt: at("2026-11-01T23:00:00Z"),
        answeredAt: at("2026-10-25T23:12:00Z"),
        channel: "whatsapp",
      },
    ],
  }),
  toMark: ok({
    more: false,
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
};

const render = (b: Board) => renderToStaticMarkup(createElement(DashboardContent, { board: b }));
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
    expect(emptyText("offered", true, "all")).toBe("No offers waiting.");
    expect(emptyText("overnight", true, "all")).toBe("Nothing taken last night.");
    expect(emptyText("toMark", true, "all")).toBe("Nothing to mark.");
    expect(columnMoreText(1)).toBe("1 more session on Events & sessions");
    expect(columnMoreText(7)).toBe("7 more sessions on Events & sessions");
  });

  it("a take last night: who said yes, to what, how the offer reached them and when", () => {
    const t = board.overnight.ok ? board.overnight.data.takes[0]! : null;
    if (!t) throw new Error("fixture");
    expect(takeCard(t, TZ)).toEqual({
      title: "Ben Fraser said yes",
      sub: "Steward · Northern Lights Live",
      when: "Sun 1 · 17:00",
      said: "23:12 · WhatsApp",
      label:
        "Ben Fraser took steward, Northern Lights Live, Sun 1 Nov at 17:00: said yes at 23:12 by WhatsApp. Open the shift.",
    });
    expect(takeCard({ ...t, channel: "sms" }, TZ).said).toBe("23:12 · text message");
    expect(takeCard({ ...t, channel: "push" }, TZ).said).toBe("23:12 · app notification");
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

describe("the dashboard page", () => {
  it("one heading for the page, its line, and the track: each filter a link with its count, the chosen one current", () => {
    const html = render(board);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toMatch(/<h1 class="text-title text-ink">Dashboard<\/h1>/);
    expect(words(html)).toContain(
      "Monday 26 October · Week 44 · Pay Fri 6 Nov · Updated 11:20 from your planner",
    );
    const track = /<nav aria-label="Show"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    expect(links(track).map((l) => [l.href, l.name, l.current])).toEqual([
      ["/office", "All 6", "page"],
      ["/office?show=urgent", "Urgent 2", null],
      ["/office?show=this-week", "This week 6", null],
      ["/office?show=next-week", "Next week 0", null],
    ]);
    // Under another filter, that one is current.
    const urgent = render({ ...board, show: "urgent" });
    const t2 = /<nav aria-label="Show"[^>]*>([\s\S]*?)<\/nav>/.exec(urgent)?.[1] ?? "";
    expect(
      links(t2)
        .filter((l) => l.current)
        .map((l) => l.name),
    ).toEqual(["Urgent 2"]);
  });

  it("the places chart: a bar a day for two weeks, stacked to offer under offered, today marked, the numbers as a table", () => {
    const html = render(board);
    const chart = section(html, "places-chart");
    expect(words(chart)).toMatch(/^Places to fill This week and next, by day /);
    expect(links(chart)).toEqual([
      {
        href: "/office/events?view=need",
        label: "Open Events & sessions",
        current: null,
        name: "",
      },
    ]);
    const bars = [...chart.matchAll(/data-day="([^"]+)"/g)].map((m) => m[1]);
    expect(bars).toEqual(days.map((d) => d.date));
    // Tue 27: 1 offered of a top of 10; Sat 31: 3 to offer.
    expect(chart).toMatch(
      /data-day="2026-10-27"[^>]*>\s*<span data-part="offered" style="height:10%"/,
    );
    expect(chart).toMatch(
      /data-day="2026-10-31"[^>]*>\s*<span data-part="to-offer" style="height:30%"/,
    );
    // The axis: 10, 5, 0. Today in its ink disc.
    expect(words(chart)).toContain("10 5 0");
    expect(chart).toMatch(
      /<span class="min-w-6 rounded-full bg-ink px-1 font-semibold text-on-ink">26<\/span>/,
    );
    expect(chart.match(/bg-ink px-1/g)).toHaveLength(1);
    // Read out: its sentence, and a table of every day.
    expect(html).toContain(
      '<section id="places-chart" aria-labelledby="places-chart-title" aria-describedby="places-chart-summary"',
    );
    expect(chart).toContain(chartSummary(days));
    expect(chart.match(/<tr>/g)).toHaveLength(15);
    expect(chart).toContain('<th scope="row">Saturday 31 October</th><td>3</td><td>0</td>');
  });

  it("the detail card: the chosen session in full, with Offer to someone, Open the shift and …", () => {
    const html = render(board);
    const detail =
      /<section aria-labelledby="chosen-title" data-chosen="nll1"[^>]*>([\s\S]*?)<\/section>/.exec(
        html,
      )?.[1] ?? "";
    expect(words(detail)).toBe(
      [
        "Tue 27 Door supervisor Urgent",
        "Northern Lights Live · Gate A, Acme Demo Arena",
        // The "…" menu's own words (shut until its button is pressed).
        "Mark as filled Only if you've filled it another way. Nobody else will be offered it.",
        "Yes, mark as filled Not urgent",
        "Tue 27 Oct, 08:00–16:00 1 place to fill",
        "Starts in 20 h Offers sent 1 No reply yet",
        "Mo Rahman hasn't replied since 07:19.",
        "Offer to someone Open the shift",
      ].join(" "),
    );
    expect(detail).toMatch(/<details class="group relative shrink-0"><summary aria-label=/);
    expect(links(detail).map((l) => [l.href, l.name])).toEqual([
      ["/office/offer/nll1", "Offer to someone"],
      ["/office/shifts/nll1", "Open the shift"],
    ]);
    expect(detail).toContain('aria-label="More for Tuesday&#x27;s door supervisor at 08:00"');
    // Starting in under 2 days: red.
    expect(detail).toMatch(/text-urgent">20 h</);
    // A planner's session: no Mark as filled, but Offer to someone.
    const planner = render({
      ...board,
      gaps: ok({
        ...(board.gaps.ok ? board.gaps.data : ({} as never)),
        chosen: { ...nll1, fromPlanner: true },
      }),
    });
    expect(planner).not.toContain("Mark as filled");
    expect(planner).toContain("Not urgent");
    expect(planner).toContain(">Offer to someone<");
  });

  it("the board: four columns, each with its leaf, count, line, first three cards and Show N more", () => {
    const html = render(board);
    const ids = [...html.matchAll(/<section id="([a-z-]+)" aria-labelledby="\1-title"/g)].map(
      (m) => m[1],
    );
    // The chart first (beside the detail card), then the four columns.
    expect(ids).toEqual([
      "places-chart",
      "to-offer",
      "offered",
      "while-you-were-out",
      "who-worked",
    ]);
    expect(COLUMN_IDS.offered).toBe("offered");
    const head = (id: string) => words(section(html, id)).split(/ (?=[A-Z][a-z]{2} \d)/)[0];
    expect(head("to-offer")).toBe("To offer 4 4 sessions 4 places, no offers out");
    expect(head("offered")).toBe("Offered 2 2 sessions 3 places · 3 offers, no reply yet");
    expect(words(section(html, "while-you-were-out"))).toMatch(
      /^While you were out 1 1 place taken Taken by casuals from offers, 18:00 to 08:00 /,
    );
    expect(words(section(html, "who-worked"))).toMatch(
      /^Who worked\? 3 3 sessions to mark 3 sessions from Sun 25 Oct /,
    );
    // To offer: soonest first, three shown, then "Show 1 more".
    const col = section(html, "to-offer");
    expect([...col.matchAll(/data-session="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "np1",
      "nll2",
      "rc",
    ]);
    expect(col).toMatch(/<button type="button" class="[^"]*">Show 1 more<\/button>/);
    expect(section(html, "offered")).not.toMatch(/>Show \d+ more</);
  });

  it("a session card: a link that picks it (current when it's the chosen one), its paper plane to the offer page, its chips", () => {
    const col = section(render(board), "offered");
    const l = links(col);
    expect(l.map((x) => [x.href, x.label, x.current])).toEqual([
      ["/office?session=nll1", cardLabel(nll1, TZ), "true"],
      ["/office/offer/nll1", offerLabel(nll1, TZ), null],
      ["/office?session=rff", cardLabel(rff, TZ), null],
      ["/office/offer/rff", offerLabel(rff, TZ), null],
    ]);
    // The chips: when it starts, how many to fill (red when urgent), the offers waiting.
    const card = col.split('data-session="').find((c) => c.startsWith('nll1"')) ?? "";
    expect(words(card)).toContain("08:00 1 to fill 1");
    expect(card).toMatch(/bg-urgent-soft[^"]*">.*?1 to fill/);
    expect(card).toMatch(/outline-ink/);
  });

  it("the cards of last night's takes and of sessions to mark, each one link to where it's dealt with", () => {
    const html = render(board);
    expect(links(section(html, "while-you-were-out")).map((l) => [l.href, l.label])).toEqual([
      [
        "/office/shifts/nll3",
        takeCard(board.overnight.ok ? board.overnight.data.takes[0]! : ({} as never), TZ).label,
      ],
    ]);
    expect(words(section(html, "while-you-were-out"))).toContain(
      "BF Ben Fraser said yes Steward · Northern Lights Live Sun 1 · 17:00 23:12 · WhatsApp",
    );
    // Two alike sessions in one card, to Needs attention; one on its own to its page.
    expect(links(section(html, "who-worked")).map((l) => l.href)).toEqual([
      "/office/needs-attention#to-mark",
      "/office/shifts/m3",
    ]);
    expect(words(section(html, "who-worked"))).toContain(
      "Steward Acme Demo Racecourse 2 sessions Since yesterday",
    );
  });

  it("empty columns say so; with nothing to fill, the detail card says that instead", () => {
    const none: Board = {
      ...board,
      counts: ok({ all: 0, urgent: 0, "this-week": 0, "next-week": 0 }),
      gaps: ok({
        toOffer: { sessions: [], total: 0, places: 0, waiting: 0, more: false },
        offered: { sessions: [], total: 0, places: 0, waiting: 0, more: false },
        chosen: null,
      }),
      overnight: ok({ ...(board.overnight.ok ? board.overnight.data : ({} as never)), takes: [] }),
      toMark: ok({ items: [], more: false }),
    };
    const html = render(none);
    expect(words(section(html, "to-offer"))).toContain("No places to fill.");
    expect(words(section(html, "offered"))).toContain("No offers waiting.");
    expect(words(section(html, "while-you-were-out"))).toContain("Nothing taken last night.");
    expect(words(section(html, "who-worked"))).toContain("Nothing to mark.");
    expect(html).toMatch(/<section aria-label="Chosen session"[^>]*>.*No places to fill\./);
  });

  it("a column cut at 50 says where the rest are, once its cards are all shown", () => {
    const many = Array.from({ length: 2 }, (_, i) => session({ shiftId: `s${i}` }));
    const html = render({
      ...board,
      gaps: ok({
        toOffer: { sessions: many, total: 52, places: 52, waiting: 0, more: true },
        offered: { sessions: [], total: 0, places: 0, waiting: 0, more: false },
        chosen: many[0]!,
      }),
    });
    expect(links(section(html, "to-offer")).at(-1)).toMatchObject({
      href: "/office/events?view=need",
      name: "50 more sessions on Events & sessions",
    });
  });

  it("a part that couldn't load says so where it shows; the rest still shows", () => {
    const html = render({
      ...board,
      counts: failed,
      chart: failed,
      gaps: failed,
      overnight: failed,
      toMark: failed,
      planner: failed,
    });
    // The track, the chart, the detail card and the four columns.
    expect(html.split(SECTION_ERROR.replace("'", "&#x27;")).length - 1).toBe(7);
    expect(html).toContain(">Dashboard</h1>");
    expect(words(html)).toContain("Monday 26 October · Week 44 · Pay Fri 6 Nov");
    expect(words(html)).not.toContain("Updated");
    // The track keeps its links, without counts.
    const track = /<nav aria-label="Show"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    expect(links(track).map((l) => l.name)).toEqual(["All", "Urgent", "This week", "Next week"]);
  });

  it("no link on the dashboard repeats a menu link's name", () => {
    const menu = officeMenu("admin").flatMap((g) => g.links.map((l) => l.label));
    expect(menu).toEqual(expect.arrayContaining(["Dashboard", "Events & sessions"]));
    const names = links(render(board)).map((l) => l.label ?? l.name);
    expect(names.length).toBeGreaterThan(15);
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
      { workerId: "w1", name: "Priya Shah", hoursThisWeek: 4, channel: "whatsapp" },
      { workerId: "w2", name: "Kieran Doyle", hoursThisWeek: 8, channel: "whatsapp" },
      { workerId: "w3", name: "Tom Hale", hoursThisWeek: 16, channel: "sms" },
    ] as OfferPage["candidates"],
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
    for (const line of [
      "4 hours booked that week · by WhatsApp",
      "16 hours booked that week · by text message",
    ]) {
      expect(words(panel(page))).toContain(line);
      expect(words(offerPage(page))).toContain(line);
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
  });
});
