import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { officeMenu } from "@/app/office/office-menu";
import type { Dashboard, NeedsAttention } from "@/lib/office/dashboard";
import { attentionCount, attentionOf, needsCount } from "@/lib/office/dashboard";
import {
  cancelledByText,
  COUNT_ERROR,
  countLine,
  COUNTS,
  expiredText,
  plannerRefusedText,
  SECTION_ERROR,
  SECTIONS,
  uploadsText,
  urgentLine,
} from "@/lib/office/dashboard-copy";
import { appTodayText } from "@/lib/office/enquiries-copy";
import type { EventCardData, SessionRow } from "@/lib/office/events";
import {
  closeResultText,
  offerResultText,
  placesText,
  stoppedText,
  toMarkText,
  urgentResultText,
} from "@/lib/office/today-copy";

// The office dashboard (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office`; 12E.1; Phase 18's
// redesign): its words (src/lib/office/dashboard-copy.ts, today-copy.ts, dashboard-home.ts) and the
// rendered page (src/app/office/dashboard-view.tsx), from made-up data: the headline and where to
// start, this week's days, the urgent places one at a time with their warnings, "After that",
// "Waiting on others" and "Sorted today", a part that couldn't load, no link repeating a menu
// link's name; and Needs attention's page, each item linking to where it's dealt with.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/app/office/today-actions", () => ({
  setUrgentAction: vi.fn(),
  closeShiftAction: vi.fn(),
  reopenShiftAction: vi.fn(),
  offerShiftAction: vi.fn(),
  keepBookingAction: vi.fn(),
}));
vi.mock("@/app/office/shifts/actions", () => ({
  setShowingAction: vi.fn(),
  cancelBookingAction: vi.fn(),
  cancelShiftAction: vi.fn(),
  moveShiftAction: vi.fn(),
}));

const { DashboardContent } = await import("@/app/office/dashboard-view");
const { btn, count, countUrgent } = await import("@/app/ui/classes");
const { waitingOrFailed } = await import("@/lib/office/pay-dashboard");
const { AlsoNeedsYou, NeedsItems, needsPageLine, toMarkGroups } =
  await import("@/app/office/needs-items");
const { attentionText, focusItems, greeting, moreLabels, startLine } =
  await import("@/lib/office/dashboard-home");

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);
const ok = <T>(data: T) => ({ ok: true as const, data });
const failed = { ok: false as const };

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

const empty: Dashboard = {
  timeZone: TZ,
  today: "2026-11-02",
  counts: {
    urgent: ok({ sessions: 0, places: 0, firstStartsAt: null }),
    showing: ok({ events: 0, sessions: 0, places: 0 }),
    cancellations: ok({ total: 0, underNotice: 0, strikes: 0, threshold: 48 }),
    enquiries: ok({ total: 0, automatic: 0, needPerson: 0 }),
  },
  urgent: ok({ events: [], more: false }),
  showing: ok({ events: [], more: 0 }),
  cancellations: ok({ rows: [], threshold: 48 }),
  enquiries: ok({ rows: [], replies: {}, days: 90 }),
  needs: ok(noNeeds),
  week: ok(
    [
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ].map((date) => ({ date, places: 0, filled: 0, open: 0, urgent: 0 })),
  ),
};

const session = (o: Partial<SessionRow> = {}): SessionRow => ({
  shiftId: "s1",
  role: "steward",
  startsAt: at("2026-11-07T10:00:00Z"),
  endsAt: at("2026-11-07T18:00:00Z"),
  status: "open",
  headcount: 2,
  booked: 1,
  isUrgent: false,
  urgentGap: false,
  showing: true,
  payRatePence: null,
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
const showingEvent: EventCardData = {
  eventId: "e2",
  name: "Riverside Food Festival",
  place: "Riverside Park",
  firstStartsAt: at("2026-11-07T10:00:00Z"),
  lastStartsAt: at("2026-11-07T14:00:00Z"),
  showing: true,
  sessions: [session(), session({ shiftId: "s2", startsAt: at("2026-11-07T14:00:00Z") })],
  moreSessions: 3,
  sessionCount: 5,
  placesFree: 6,
  full: false,
  urgentGap: false,
};

const full: Dashboard = {
  ...empty,
  week: ok([
    { date: "2026-11-02", places: 0, filled: 0, open: 0, urgent: 0 },
    { date: "2026-11-03", places: 4, filled: 4, open: 0, urgent: 0 },
    { date: "2026-11-04", places: 6, filled: 3, open: 3, urgent: 2 },
    { date: "2026-11-05", places: 10, filled: 6, open: 4, urgent: 0 },
    { date: "2026-11-06", places: 0, filled: 0, open: 0, urgent: 0 },
    { date: "2026-11-07", places: 3, filled: 1, open: 2, urgent: 2 },
    { date: "2026-11-08", places: 0, filled: 0, open: 0, urgent: 0 },
  ]),
  counts: {
    urgent: ok({ sessions: 2, places: 3, firstStartsAt: at("2026-11-04T10:30:00Z") }),
    showing: ok({ events: 8, sessions: 12, places: 26 }),
    cancellations: ok({ total: 2, underNotice: 1, strikes: 1, threshold: 48 }),
    enquiries: ok({ total: 18, automatic: 16, needPerson: 2 }),
  },
  urgent: ok({
    more: false,
    events: [
      {
        eventId: "e1",
        name: "Northern Lights Live",
        place: "Acme Demo Arena",
        showing: true,
        sessions: [
          {
            shiftId: "u1",
            role: "door_supervisor",
            startsAt: at("2026-11-07T06:00:00Z"),
            endsAt: at("2026-11-07T14:00:00Z"),
            headcount: 3,
            placesLeft: 2,
            fromSheet: false,
            fromPlanner: false,
            showing: true,
            offered: 4,
            stopped: null,
            escalated: false,
          },
        ],
      },
      {
        eventId: "e3",
        name: "Night patrols",
        place: null,
        showing: false,
        sessions: [
          {
            shiftId: "u2",
            role: "steward",
            startsAt: at("2026-11-08T18:00:00Z"),
            endsAt: at("2026-11-08T23:00:00Z"),
            headcount: 1,
            placesLeft: 1,
            fromSheet: false,
            fromPlanner: false,
            showing: true,
            offered: 0,
            stopped: "no_candidates",
            escalated: true,
          },
        ],
      },
    ],
  }),
  showing: ok({ events: [showingEvent], more: 2 }),
  cancellations: ok({
    threshold: 48,
    rows: [
      {
        assignmentId: "a1",
        ref: "A1B2C3D4",
        workerId: "w1",
        casual: "Ben Carter",
        staffId: null,
        eventName: "Northern Lights Live",
        role: "steward",
        startsAt: at("2026-11-07T08:00:00Z"),
        endsAt: at("2026-11-07T16:00:00Z"),
        siteName: "Acme Demo Arena",
        sitePostcode: null,
        post: null,
        payRatePence: null,
        meetingPoint: null,
        uniform: null,
        requirements: [],
        bookedAt: null,
        cancelledAt: at("2026-11-02T06:00:00Z"),
        by: "casual",
        via: "app",
        officeName: null,
        reason: "Unwell",
        noticeHours: 20,
        strikeCode: "issued",
        strike: {
          status: "live",
          expiresAt: at("2027-01-31T00:00:00Z"),
          reviewNeeded: false,
          evidence: { status: "sent", to: null, sentAt: null },
        },
        planner: { status: "none" },
        warning: null,
        then: { place: "reopened", markedUrgent: false, offeredTo: 0, replacement: null },
      },
      {
        assignmentId: "a2",
        ref: "E5F6A7B8",
        workerId: "w2",
        casual: "Dee Patel",
        staffId: null,
        eventName: null,
        role: "door_supervisor",
        startsAt: at("2026-11-12T08:00:00Z"),
        endsAt: at("2026-11-12T16:00:00Z"),
        siteName: null,
        sitePostcode: null,
        post: null,
        payRatePence: null,
        meetingPoint: null,
        uniform: null,
        requirements: [],
        bookedAt: null,
        cancelledAt: at("2026-11-02T07:00:00Z"),
        by: "office",
        via: "office",
        officeName: "Sam Rota",
        reason: "Event moved",
        noticeHours: 240,
        strikeCode: "by_firm",
        strike: null,
        planner: { status: "none" },
        warning: null,
        then: { place: "reopened", markedUrgent: false, offeredTo: 0, replacement: null },
      },
    ],
  }),
  enquiries: ok({
    rows: [
      {
        messageId: "m1",
        at: at("2026-11-02T07:30:00Z"),
        channel: "whatsapp",
        text: "Any shifts this weekend?",
        who: { kind: "casual", workerId: "w3", name: "Zoe Usman", firstName: "Zoe", active: true },
        outcome: "keyword",
      },
      {
        messageId: "m2",
        at: at("2026-11-02T08:00:00Z"),
        channel: "sms",
        text: "Can I talk to someone",
        who: { kind: "unknown", from: "+447700900998" },
        outcome: "person_waiting",
      },
    ],
    replies: { m1: "Hi Zoe, for the weekend you can take:", m2: null },
    days: 90,
  }),
  needs: ok({
    ...noNeeds,
    toCheck: [
      {
        shiftId: "t1",
        workerId: "w4",
        worker: "Lena Leaver",
        role: "steward",
        site: "Acme Demo Arena",
        startsAt: at("2026-11-08T08:00:00Z"),
        endsAt: at("2026-11-08T16:00:00Z"),
        cause: "inactive",
      },
    ],
    fromSheet: [
      {
        shiftId: "f1",
        role: "track_operative",
        site: "Demo Junction",
        startsAt: at("2026-11-07T22:00:00Z"),
        endsAt: at("2026-11-08T06:00:00Z"),
        change: null,
        names: [{ name: "Ben Example", codes: ["credential_missing"], dropped: false }],
      },
    ],
    toMark: [
      {
        shiftId: "m1",
        role: "steward",
        site: "Acme Demo Racecourse",
        startsAt: at("2026-10-31T10:00:00Z"),
        endsAt: at("2026-10-31T18:00:00Z"),
        unmarked: 3,
      },
    ],
    expired: [
      {
        assignmentId: "x1",
        workerId: "w5",
        worker: "Ben Example",
        shiftId: "x-shift",
        role: "door_supervisor",
        startsAt: at("2026-11-07T10:00:00Z"),
        type: "SIA_DS",
        credential: "SIA door supervisor licence",
        expiresOn: "2026-11-01",
      },
    ],
    uploads: 2,
    uploadList: [
      {
        id: "up1",
        workerId: "w6",
        name: "Ben Fraser",
        kind: "photo",
        qualificationType: null,
        qualificationName: null,
        sentAt: at("2026-11-02T01:29:00Z"),
      },
      {
        id: "up2",
        workerId: "w7",
        name: "Leah Ward",
        kind: "certificate",
        qualificationType: "SIA_DS",
        qualificationName: "SIA door supervisor licence",
        sentAt: at("2026-10-31T15:29:00Z"),
      },
    ],
    evidence: {
      addressConfirmed: false,
      waiting: 1,
      failed: [
        {
          assignmentId: "ev1",
          casual: "Ann Booker",
          cancelledAt: at("2026-11-02T10:00:00Z"),
          stuck: false,
          nothingSent: true,
        },
      ],
      failedMore: false,
    },
    plannerRefused: [
      {
        shiftId: "p1",
        role: "steward",
        site: "Acme Demo Racecourse",
        startsAt: at("2026-11-07T10:00:00Z"),
        endsAt: at("2026-11-07T18:00:00Z"),
        refusedAt: at("2026-11-02T08:30:00Z"),
        why: "move",
        casuals: 2,
      },
    ],
  }),
};

// `isAdmin` is for Needs attention's page (its own test below uses NeedsItems); the dashboard's
// rows are the same for admins and resourcers.
const render = (
  d: Dashboard,
  o: { isAdmin?: boolean; shiftsLine?: string; payQueriesWaiting?: number | null } = {},
) =>
  renderToStaticMarkup(
    createElement(DashboardContent, {
      d,
      firmName: "Acme Events",
      shiftsLine: o.shiftsLine,
      payQueriesWaiting: o.payQueriesWaiting === undefined ? 0 : o.payQueriesWaiting,
      // Monday 2 November, 18:30 in London: the evening.
      now: at("2026-11-02T18:30:00Z"),
    }),
  );
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
// The HTML of the section labelled by this heading id.
const section = (html: string, id: string) =>
  new RegExp(`<section[^>]*aria-labelledby="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html)?.[1] ??
  "";
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1] ?? "",
    name: words(m[2] ?? ""),
  }));

describe("the words", () => {
  it("places free; why offers stopped; people not marked yet", () => {
    expect(placesText(1, 1)).toBe("1 place free");
    expect(placesText(2, 3)).toBe("2 of 3 places free");
    expect(stoppedText({ stopped: "no_candidates" })).toBe(
      "Offers stopped: nobody else can take it.",
    );
    expect(stoppedText({ stopped: "hidden" })).toBe("Offers stopped: it's hidden from casuals.");
    expect(stoppedText({ stopped: null })).toBeNull();
    expect(toMarkText(1)).toBe("1 person not marked yet.");
    expect(toMarkText(4)).toBe("4 people not marked yet.");
  });

  it("each urgent session's line, written from its offers", () => {
    expect(urgentLine({ offered: 4, stopped: null })).toBe("Offered to 4 casuals");
    expect(urgentLine({ offered: 1, stopped: null })).toBe("Offered to 1 casual");
    expect(urgentLine({ offered: 0, stopped: null })).toBe("Offered to 0 casuals");
    expect(urgentLine({ offered: 6, stopped: "no_candidates" })).toBe(
      "Offers stopped: nobody else can take it.",
    );
  });

  it("each quick action says what happened", () => {
    expect(urgentResultText({ status: "marked" })).toBe("Marked urgent. Offers are going out.");
    expect(urgentResultText({ status: "not_allowed" })).toBe("You can't change shifts.");
    expect(closeResultText({ status: "closed", placesLeft: 1 })).toBe(
      "Marked as filled. Nobody else will be offered it.",
    );
    expect(closeResultText({ status: "sheet" })).toBe(
      "This shift comes from your Google Sheet. Change it there.",
    );
    expect(offerResultText({ status: "queued" }, "Ann Booker")).toBe(
      "Offer on its way to Ann Booker.",
    );
    expect(offerResultText({ status: "not_candidate" }, "Ann Booker")).toBe(
      "Ann Booker can't be offered this shift now.",
    );
    expect(offerResultText({ status: "logged_out" }, "Ann Booker")).toBe(
      "Your session has ended. Log in again.",
    );
    expect(urgentResultText({ status: "marked_hidden" })).toBe(
      "Marked urgent. It's hidden from casuals, so no offers go out while it's hidden.",
    );
    expect(offerResultText({ status: "hidden" }, "Ann Booker")).toBe(
      "This shift is hidden from casuals, so it can't be offered. Show it to casuals first.",
    );
  });

  it("each count's small line, at zero, with figures, and when it couldn't be read", () => {
    expect(COUNTS.map((c) => countLine(c.key, empty.counts, TZ))).toEqual([
      "Every urgent shift is filled",
      "Nothing is showing",
      "None since midnight",
      "None since midnight",
    ]);
    expect(COUNTS.map((c) => countLine(c.key, full.counts, TZ))).toEqual([
      "3 places · first starts Wed 10:30",
      "26 open places across 12 sessions",
      "1 under 48 hours · 1 strike issued",
      "16 answered automatically · 2 need a person",
    ]);
    const one = {
      ...empty.counts,
      urgent: ok({ sessions: 1, places: 1, firstStartsAt: at("2026-07-01T09:00:00Z") }),
      enquiries: ok({ total: 1, automatic: 0, needPerson: 1 }),
    };
    // Summer: the firm's clock (BST).
    expect(countLine("urgent", one, TZ)).toBe("1 place · first starts Wed 10:00");
    expect(countLine("enquiries", one, TZ)).toBe("0 answered automatically · 1 needs a person");
    const broken = { ...empty.counts, urgent: failed, enquiries: failed };
    expect(countLine("urgent", broken, TZ)).toBe("Couldn't load");
    expect(countLine("enquiries", broken, TZ)).toBe("Couldn't load");
  });

  it("who cancelled; a qualification out of date; uploads; the bell", () => {
    expect(cancelledByText({ by: "casual", casual: "Ben Carter" })).toBe("Ben Carter cancelled");
    expect(cancelledByText({ by: "office", casual: "Ben Carter" })).toBe(
      "The office cancelled Ben Carter",
    );
    const e = full.needs.ok ? full.needs.data.expired[0] : undefined;
    if (!e) throw new Error("fixture");
    expect(expiredText(e, "2026-11-02", TZ)).toBe(
      "Ben Example's SIA door supervisor licence expired on Sun 1 Nov, before their door supervisor shift on Sat 7 Nov.",
    );
    expect(expiredText({ ...e, expiresOn: "2026-11-05" }, "2026-11-02", TZ)).toBe(
      "Ben Example's SIA door supervisor licence runs out on Thu 5 Nov, before their door supervisor shift on Sat 7 Nov.",
    );
    expect(expiredText({ ...e, expiresOn: null }, "2026-11-02", TZ)).toBe(
      "Ben Example's SIA door supervisor licence is marked as expired, and they're booked on a door supervisor shift on Sat 7 Nov.",
    );
    // Runs out on the day a night shift starts: during it, not before it.
    expect(
      expiredText(
        { ...e, expiresOn: "2026-11-07", startsAt: new Date("2026-11-07T22:00:00Z") },
        "2026-11-02",
        TZ,
      ),
    ).toBe(
      "Ben Example's SIA door supervisor licence runs out on Sat 7 Nov, during their door supervisor shift on Sat 7 Nov.",
    );
    // Enquiries today's list points to the requests from the app its count includes.
    expect(appTodayText(1)).toBe("Plus 1 request made in the app today.");
    expect(appTodayText(2)).toBe("Plus 2 requests made in the app today.");
    expect(uploadsText(1)).toBe("1 upload waits for a check.");
    expect(uploadsText(3)).toBe("3 uploads wait for a check.");
    // Your planner's refused change: a move the rules refused, then what a booking blocks.
    const p = full.needs.ok ? full.needs.data.plannerRefused[0] : undefined;
    if (!p) throw new Error("fixture");
    const refused = "Your planner's change to the steward session on Sat 7 Nov was refused:";
    expect(plannerRefusedText(p, TZ)).toBe(
      `${refused} 2 booked casuals can't work it. Cancel their bookings, then ask your planner to send it again.`,
    );
    expect(plannerRefusedText({ ...p, casuals: 1 }, TZ)).toBe(
      `${refused} 1 booked casual can't work it. Cancel their booking, then ask your planner to send it again.`,
    );
    expect(plannerRefusedText({ ...p, why: "session_has_bookings", casuals: 0 }, TZ)).toBe(
      `${refused} it changes the role or the qualifications needed, and casuals are booked. Cancel their bookings, then ask your planner to send it again.`,
    );
    expect(plannerRefusedText({ ...p, why: "places_below_booked", casuals: 0 }, TZ)).toBe(
      `${refused} it takes away places casuals are booked in. Cancel those bookings, then ask your planner to send it again.`,
    );
    expect(plannerRefusedText({ ...p, why: "change_reason_required", casuals: 0 }, TZ)).toBe(
      `${refused} it moves or cancels a session casuals are booked on, and gave no reason. Ask your planner to send it again with a reason.`,
    );
    // The day is the firm's: 23:30 on Saturday in British Summer Time is still Saturday.
    expect(
      plannerRefusedText(
        { ...p, role: "door_supervisor", startsAt: at("2026-06-06T22:30:00Z") },
        TZ,
      ),
    ).toContain("the door supervisor session on Sat 6 Jun was refused");
    // Each refused session is one of Needs attention's items; a list stopped at 50 shows "50+".
    expect(needsCount({ ...noNeeds, plannerRefused: [p, p], plannerRefusedMore: true })).toEqual({
      count: 2,
      more: true,
    });
    // The one count (Phase 20): those items and the enquiries that need a person, as the menu shows.
    expect(
      attentionCount({ ...noNeeds, plannerRefused: [p, p], plannerRefusedMore: true }, 3),
    ).toEqual({ count: 5, more: true });
    expect(attentionCount(noNeeds, 0)).toEqual({ count: 0, more: false });
    // Needs attention's page: unread items give no count; unread enquiries make it "at least".
    expect(attentionOf(ok(noNeeds), ok(3))).toEqual({ count: 3, more: false });
    expect(attentionOf(ok(noNeeds), failed)).toEqual({ count: 0, more: true });
    expect(attentionOf(failed, ok(3))).toBeNull();
  });
});

describe("the page (Phases 18 and 20: the dashboard)", () => {
  const h1s = (html: string) =>
    [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => words(m[1] ?? ""));
  // The rows of a list of rows ("Needs attention", "Waiting on others", "Sorted today").
  const rows = (html: string, label: string) => {
    const list =
      new RegExp(`<ul role="list" aria-label="${label}"[^>]*>([\\s\\S]*?)</ul>`).exec(html)?.[1] ??
      "";
    return links(list).map((l) => `${l.name} → ${l.href}`);
  };
  // The four count tiles, in order: their words and where each goes.
  const tiles = (html: string) =>
    [
      ...html.matchAll(
        /<(a|div) ([^>]*class="[^"]*(?<![\w-])grid min-h-32 [^"]*rounded-card [^"]*"[^>]*)>([\s\S]*?)<\/\1>/g,
      ),
    ].map((m) => {
      const href = /href="([^"]*)"/.exec(m[2] ?? "")?.[1];
      return `${words(m[3] ?? "")}${href ? ` → ${href}` : ""}`;
    });
  // The urgent places listed, each a lifted row.
  const places = (html: string) =>
    [
      ...section(html, "urgent-places").matchAll(/<li data-urgent-place=""[^>]*>([\s\S]*?)<\/li>/g),
    ].map((m) => m[1] ?? "");

  it("the greeting and the one count: the urgent places and Needs attention's items, then where to start", () => {
    const html = render(full, { shiftsLine: "Shifts line 07700 900123" });
    // 3 urgent places + 9 of Needs attention's items + 2 enquiries that need a person.
    expect(h1s(html)).toEqual(["Evening, Acme Events. 14 things need you."]);
    // Phase 21: the date line (today, the week, its pay day) comes first, over the greeting.
    expect(words(html)).toContain(
      "Monday 2 November · Week 45 · Pay Fri 13 Nov Evening, Acme Events. 14 things need you. Start with Saturday's door supervisor at 06:00: offered to 4 casuals. Shifts line 07700 900123",
    );
    // Only urgent places: each place to fill counts.
    const onlyUrgent = render({
      ...full,
      needs: ok(noNeeds),
      counts: { ...full.counts, enquiries: ok({ total: 0, automatic: 0, needPerson: 0 }) },
    });
    expect(h1s(onlyUrgent)).toEqual(["Evening, Acme Events. 3 things need you."]);
    // Nothing urgent, other things: sorted first.
    const noUrgent = render({
      ...full,
      urgent: ok({ events: [], more: false }),
      counts: { ...full.counts, urgent: ok({ sessions: 0, places: 0, firstStartsAt: null }) },
    });
    expect(h1s(noUrgent)).toEqual(["Evening, Acme Events. 11 things need you."]);
    expect(words(noUrgent)).toContain("Urgent places are sorted. The rest is below.");
    // Nothing at all.
    const calm = render(empty);
    expect(h1s(calm)).toEqual(["Evening, Acme Events. Nothing needs you right now."]);
    expect(words(calm)).toContain(
      "Every urgent place is filled, and nothing else is waiting for you.",
    );
    // Not offered yet: where to start says so.
    expect(
      startLine({ ...focusItems(full)[0]!, notOffered: true, offered: "Offered to 0 casuals" }, 3),
    ).toBe("Start with Saturday's door supervisor at 06:00: not offered to anyone yet.");
  });

  it("Needs attention's page: its count line, and Also needs you with the urgent places (Phase 20)", () => {
    expect(needsPageLine({ count: 6, more: false })).toBe(
      "6 things for you. Each item links to where it's dealt with.",
    );
    expect(needsPageLine({ count: 1, more: false })).toBe(
      "1 thing for you. Each item links to where it's dealt with.",
    );
    expect(needsPageLine({ count: 50, more: true })).toBe(
      "50+ things for you. Each item links to where it's dealt with.",
    );
    expect(needsPageLine(null)).toBe("Each item links to where it's dealt with.");
    const also = (urgent: { places: number; firstStartsAt: Date | null } | null) =>
      renderToStaticMarkup(createElement(AlsoNeedsYou, { urgent, timeZone: TZ }));
    // Urgent places: how many and the day of the first, with the way to the dashboard.
    const some = also({ places: 3, firstStartsAt: at("2026-11-05T07:00:00Z") });
    expect(some).toMatch(/^<section aria-labelledby="also-needs-you"/);
    expect(words(some)).toBe(
      "Also needs you 3 urgent places to fill, the first on Thu 5 Nov. Go to the Dashboard",
    );
    expect(some).toMatch(/<a class="[^"]*" href="\/office">Go to the Dashboard<\/a>/);
    expect(words(also({ places: 1, firstStartsAt: null }))).toBe(
      "Also needs you 1 urgent place to fill. Go to the Dashboard",
    );
    // None: said so, with no link.
    const none = also({ places: 0, firstStartsAt: null });
    expect(words(none)).toBe("Also needs you No urgent places to fill.");
    expect(none).not.toContain("<a ");
    // Their count unread: said so.
    expect(words(also(null))).toBe(`Also needs you ${COUNT_ERROR}`);
    expect(also(null)).not.toContain("<a ");
  });

  it("names each urgent place's … button apart: its day, role and time, keeping an acronym in capitals", () => {
    const first = focusItems(full)[0]!;
    expect(
      moreLabels([
        first,
        { ...first, role: "CSAS officer" },
        // The same day, role and time again: numbered.
        first,
        // A Google Sheet's or a planner's place: only "Not urgent" is under its "…".
        { ...first, range: "16:00–22:00", fromSheet: true },
        { ...first, range: "17:00–22:00", fromPlanner: true },
      ]),
    ).toEqual([
      "More for Saturday's door supervisor at 06:00: mark as filled, not urgent",
      "More for Saturday's CSAS officer at 06:00: mark as filled, not urgent",
      "More for Saturday's door supervisor at 06:00 (2): mark as filled, not urgent",
      "More for Saturday's door supervisor at 16:00: not urgent",
      "More for Saturday's door supervisor at 17:00: not urgent",
    ]);
  });

  it("lists the urgent places soonest first, whatever order their events come in", () => {
    if (!full.urgent.ok) throw new Error("fixture");
    // Events come in the order of their first session to come: here the later urgent one first.
    const reversed: Dashboard = {
      ...full,
      urgent: ok({ ...full.urgent.data, events: [...full.urgent.data.events].reverse() }),
    };
    expect(focusItems(reversed).map((i) => i.shiftId)).toEqual(["u1", "u2"]);
    const html = render(reversed);
    expect(words(html)).toContain("Start with Saturday's door supervisor at 06:00");
    expect(places(html).map((p) => /href="\/office\/shifts\/(u\d)"/.exec(p)?.[1])).toEqual([
      "u1",
      "u2",
    ]);
    expect(tiles(html)[0]).toBe("Urgent places 3 Sat 7 and Sun 8 → #urgent-places");
  });

  it("the list of urgent places unread, its count read: where to start says to start with them", () => {
    const html = render({ ...full, urgent: failed });
    expect(h1s(html)).toEqual(["Evening, Acme Events. 14 things need you."]);
    expect(words(html)).toContain(
      "Start with the urgent places. Casuals see these first and get an alert.",
    );
    expect(words(html)).not.toContain("Urgent places are sorted.");
  });

  it("the greeting by the firm's clock: morning, afternoon, evening", () => {
    expect(greeting(at("2026-11-02T09:00:00Z"), TZ)).toBe("Morning");
    expect(greeting(at("2026-11-02T11:59:00Z"), TZ)).toBe("Morning");
    expect(greeting(at("2026-11-02T12:00:00Z"), TZ)).toBe("Afternoon");
    expect(greeting(at("2026-11-02T18:00:00Z"), TZ)).toBe("Evening");
    // Summer: 11:30 GMT is 12:30 in London.
    expect(greeting(at("2026-07-01T11:30:00Z"), TZ)).toBe("Afternoon");
  });

  // Phase 21 (Dylan's brief): each card jumps to its own section on the page; the sections keep
  // their links to the whole lists.
  it("four count tiles: urgent places, needs attention, waiting on others, sorted today", () => {
    expect(tiles(render(full, { payQueriesWaiting: 3 }))).toEqual([
      "Urgent places 3 Sat 7 and Sun 8 → #urgent-places",
      "Needs attention 11 1 booking to check, 1 change from your sheet and more → #needs-attention",
      "Waiting on others 3 Pay queries with payroll → #waiting",
      "Sorted today 20 2 cancellations, 18 enquiries → #sorted",
    ]);
    expect(tiles(render(empty))).toEqual([
      "Urgent places 0 Every urgent place is filled → #urgent-places",
      "Needs attention 0 Nothing waiting for you → #needs-attention",
      "Waiting on others 0 Nothing waiting on others → #waiting",
      "Sorted today 0 0 cancellations, 0 enquiries → #sorted",
    ]);
    // Each one's section is there, its heading the place the card jumps to.
    const page = render(full, { payQueriesWaiting: 3 });
    for (const id of ["urgent-places", "needs-attention", "waiting", "sorted"])
      expect(page).toMatch(new RegExp(`<h2 id="${id}" class="scroll-mt-20 `));
    // Phase 22: each in full flat colour with its grain and glow (`tint-…`, `shadow-tint`), lifting
    // under the pointer and dipping when pressed; a plain link to its section (Next's <Link> never
    // sets :target), which shows where you landed.
    const cards = [...page.matchAll(/<a href="(#[a-z-]+)" class="([^"]*)">/g)];
    expect(cards.map((m) => m[1])).toEqual([
      "#urgent-places",
      "#needs-attention",
      "#waiting",
      "#sorted",
    ]);
    cards.forEach((m, i) => {
      const cls = m[2]!;
      expect(cls).toMatch(/^press grain grid min-h-32 /);
      expect(cls).toContain("shadow-tint hover:-translate-y-0.5");
      expect(cls).toContain(["tint-urgent", "tint-attention", "tint-wait", "tint-done"][i]!);
      expect(cls).not.toMatch(/gradient/);
    });
    for (const id of ["urgent-places", "needs-attention", "waiting", "sorted"])
      expect(page).toMatch(
        new RegExp(`<section aria-labelledby="${id}" class="[^"]*has-\\[:target\\]:animate-landed`),
      );
    expect(attentionText([])).toBe("Nothing waiting for you");
  });

  it("this week: the places still to fill, then a bar per day, each a link to its shifts (or to the sessions to mark)", () => {
    const html = render(full);
    expect(words(section(html, "this-week"))).toContain(
      "This week 9 places still to fill. 14 of 23 filled, Tue to Sat.",
    );
    const nav = /<nav aria-label="This week"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    const days = [
      ...nav.matchAll(/<a aria-label="([^"]*)" class="([^"]*)" href="([^"]*)">([\s\S]*?)<\/a>/g),
    ].map((m) => {
      const inner = m[4] ?? "";
      // Its details over it (Phase 22), shown under the pointer or on focus: the same words as its
      // name.
      const tip = /<span aria-hidden="true" class="pointer-events-none [^"]*">([^<]*)<\/span>/;
      const rest = inner.replace(tip, "");
      return {
        label: m[1],
        href: m[3],
        inner,
        tip: tip.exec(inner)?.[1],
        // From 640px, and on a phone (the short forms).
        shown: words(rest.replace(/<span class="sm:hidden">[^<]*<\/span>/g, "")),
        phone: words(rest.replace(/<span class="hidden sm:inline">[^<]*<\/span>/g, "")),
      };
    });
    expect(days.map((d) => [d.href, d.label])).toEqual([
      ["/office/shifts?from=2026-11-02", "Mon 2 Nov, today: Nothing on"],
      ["/office/shifts?from=2026-11-03", "Tue 3 Nov: All filled, 4 of 4 places filled"],
      ["/office/shifts?from=2026-11-04", "Wed 4 Nov: 2 urgent, 3 open, 3 of 6 places filled"],
      ["/office/shifts?from=2026-11-05", "Thu 5 Nov: 4 open, 6 of 10 places filled"],
      ["/office/shifts?from=2026-11-06", "Fri 6 Nov: Nothing on"],
      ["/office/shifts?from=2026-11-07", "Sat 7 Nov: 2 urgent, 1 of 3 places filled"],
      ["/office/shifts?from=2026-11-08", "Sun 8 Nov: Nothing on"],
    ]);
    expect(days.map((d) => d.tip)).toEqual(days.map((d) => d.label));
    // Hidden until the pointer is over the day or the keyboard reaches it, then it grows out over
    // it (office.dashboard.spec.ts hovers and tabs to one).
    for (const d of days)
      expect(d.inner).toMatch(
        /<span aria-hidden="true" class="pointer-events-none [^"]* hidden [^"]*animate-pop [^"]*group-hover\/day:block group-focus-visible\/day:block /,
      );
    // An empty day says so (Phase 21).
    expect(days.map((d) => d.shown)).toEqual([
      "Today No sessions",
      "Tue 4/4",
      "Wed 3/6",
      "Thu 6/10",
      "Fri No sessions",
      "Sat 1/3",
      "Sun No sessions",
    ]);
    // On a phone, seven to a row (Phase 22: standing, not lying down): today by its day's name, an
    // empty day a dash.
    expect(days.map((d) => d.phone)).toEqual([
      "Mon –",
      "Tue 4/4",
      "Wed 3/6",
      "Thu 6/10",
      "Fri –",
      "Sat 1/3",
      "Sun –",
    ]);
    // Today in a dark pill; a day with urgent gaps in the urgent red, its bar too.
    expect(days[0]?.inner).toMatch(
      /bg-ink[^"]*font-semibold[^"]*text-on-ink[^"]*"><span class="sm:hidden">Mon<\/span><span class="hidden sm:inline">Today</,
    );
    // Today with urgent gaps keeps the pill's own text colour (red on it fails the contrast test).
    if (!full.week.ok) throw new Error("fixture");
    const week = full.week.data;
    const urgentToday = render({
      ...full,
      week: ok(week.map((w) => (w.date === "2026-11-02" ? { ...week[2]!, date: w.date } : w))),
    });
    const todayPill =
      /<span class="([^"]*)"><span class="sm:hidden">\w+<\/span><span class="hidden sm:inline">Today<\/span><\/span>/.exec(
        /<nav aria-label="This week"[^>]*>([\s\S]*?)<\/nav>/.exec(urgentToday)?.[1] ?? "",
      )?.[1] ?? "";
    expect(todayPill).toContain("bg-ink px-2 font-semibold text-on-ink");
    expect(todayPill).not.toContain("text-urgent");
    expect(urgentToday).toMatch(
      /aria-label="Mon 2 Nov, today: 2 urgent, 3 open, 3 of 6 places filled"/,
    );
    expect(days.filter((d) => /text-urgent/.test(d.inner)).map((d) => d.href)).toEqual([
      "/office/shifts?from=2026-11-04",
      "/office/shifts?from=2026-11-07",
    ]);
    expect(days[2]?.inner).toContain("bg-urgent-fill");
    // A bar's height (its width below 640px) is the share of its places filled, in ink (Phase 21).
    expect(days[3]?.inner).toMatch(/style="--fill:60%" class="[^"]*(?<![\w-])bg-ink(?![\w-])/);
    // Later in the week: a day gone by with sessions to mark goes to them, on a yellow plate; a
    // day gone by is "done", its bar grey.
    if (!full.needs.ok) throw new Error("fixture");
    const thursday: Dashboard = {
      ...full,
      today: "2026-11-05",
      needs: ok({
        ...full.needs.data,
        toMark: [{ ...full.needs.data.toMark[0]!, startsAt: at("2026-11-03T10:00:00Z") }],
      }),
    };
    const later =
      /<nav aria-label="This week"[^>]*>([\s\S]*?)<\/nav>/.exec(render(thursday))?.[1] ?? "";
    expect(later).toMatch(
      /aria-label="Tue 3 Nov: 1 to mark, 4 of 4 places filled"[^>]*href="\/office\/needs-attention#to-mark"/,
    );
    expect(later).toMatch(
      /bg-hivis[^"]*text-on-hivis[^"]*"><span class="sm:hidden">1<\/span><span class="hidden sm:inline">1 to mark</,
    );
    expect(later).toMatch(/aria-label="Wed 4 Nov: [^"]*"[^>]*>[\s\S]*?bg-line-strong[\s\S]*?done</);
    expect(later).toContain('aria-label="Thu 5 Nov, today: 4 open, 6 of 10 places filled"');
  });

  it("every urgent place listed: its places filled, who it was offered to, Offer and the rest under …", () => {
    const html = render(full);
    const [first, second] = places(html);
    expect(places(html)).toHaveLength(2);
    expect(words(section(html, "urgent-places"))).toMatch(
      /^Urgent places to fill 2 All on Events & sessions/,
    );
    expect(section(html, "urgent-places")).toMatch(
      /<a class="[^"]*" href="\/office\/events\?view=urgent">All on Events &amp; sessions<svg/,
    );
    expect(first).toContain('role="img" aria-label="Saturday 7 November"');
    // Phase 21: the role first (a link, no underline until the pointer is on it), where and when
    // in grey, then a slim bar of the places filled with "1 of 3 filled" (Dylan's words, in place
    // of "2 of 3 places free" and the seats).
    expect(words(first!)).toContain(
      "Sat 7 Nov Door supervisor Northern Lights Live, Acme Demo Arena 06:00–14:00 1 of 3 filled Offered to 4 casuals",
    );
    expect(first).toMatch(
      /<a class="underline-offset-4 hover:underline" href="\/office\/shifts\/u1">/,
    );
    expect(first).toContain('style="width:33%"');
    expect(first).not.toContain("data-seat");
    expect(words(first!)).not.toContain("Hidden from casuals");
    expect(words(first!)).not.toContain("The office was emailed about it.");
    // Its actions: offer it (the main one: "Offer", a small black pill, still named "Offer to
    // someone"); "…" opens mark as filled and not urgent.
    // Phase 22: it dips when pressed, and its word gives way to a spinner while the offer page
    // opens (office.dashboard.spec.ts holds the offer page back and sees it); the date tile a small
    // calendar page, its day on a red band; the bar set in a groove. "…" opens a menu that grows
    // out of its button: from its left edge on a phone, its right edge from 768px.
    expect(first).toMatch(
      /<a aria-label="Offer to someone" class="press [^"]*min-h-11[^"]*" href="\/office\/offer\/u1"><span class="[^"]*bg-ink[^"]*shadow-raise[^"]*"><span class="relative inline-flex items-center justify-center"><span>Offer<\/span><\/span><\/span><\/a>/,
    );
    expect(first).toMatch(
      /<span role="img" aria-label="Saturday 7 November" class="[^"]*bg-card[^"]*shadow-raise"><span class="[^"]*bg-urgent-fill[^"]*text-on-urgent[^"]*">Sat<\/span>/,
    );
    expect(first).toMatch(
      /class="block h-2 w-full overflow-hidden rounded-full bg-raised inset-shadow-sunk"/,
    );
    expect(first!.replace(/&#x27;/g, "'")).toMatch(
      /<summary aria-label="More for Saturday's door supervisor at 06:00: mark as filled, not urgent"/,
    );
    const more =
      /<summary aria-label="More for[^"]*"[^>]*>[\s\S]*?<\/summary>([\s\S]*?)<\/details>\s*<\/div>/.exec(
        first!.replace(/&#x27;/g, "'"),
      )?.[1];
    expect(words(more ?? "")).toContain("Mark as filled");
    expect(words(more ?? "")).toContain("Not urgent");
    expect(more).toMatch(
      /^<div class="[^"]* origin-top-left animate-pop [^"]*shadow-float md:right-0 md:left-auto md:origin-top-right">/,
    );
    // The second: hidden, offers stopped, the office emailed.
    expect(words(second!)).toContain("Hidden from casuals: nobody can see this gap.");
    expect(words(second!)).toContain("Offers stopped: nobody else can take it.");
    expect(words(second!)).toContain("The office was emailed about it.");
    // None: said so, with the way to the events.
    const calm = section(render(empty), "urgent-places");
    expect(words(calm)).toContain(
      "Every urgent place is filled. Nobody needs finding right now. See events",
    );
    expect(calm).not.toContain("data-urgent-place");
  });

  it("each urgent place's warnings: hidden from casuals (the event's or the session's own), offers stopped, the office emailed", () => {
    if (!full.urgent.ok) throw new Error("fixture");
    const [shown, hidden] = full.urgent.data.events;
    if (!shown || !hidden) throw new Error("fixture");
    const items = focusItems(full);
    expect(items.map((i) => [i.shiftId, i.hidden, i.offered, i.notOffered, i.escalated])).toEqual([
      ["u1", null, "Offered to 4 casuals", false, false],
      [
        "u2",
        "Hidden from casuals: nobody can see this gap.",
        "Offers stopped: nobody else can take it.",
        false,
        true,
      ],
    ]);
    // The hidden event's place, shown on its own.
    const card = section(
      render({ ...full, urgent: ok({ events: [hidden], more: false }) }),
      "urgent-places",
    );
    expect(words(card)).toContain("Hidden from casuals: nobody can see this gap.");
    expect(words(card)).toContain("Offers stopped: nobody else can take it.");
    expect(words(card)).toContain("The office was emailed about it.");
    // A session hidden on its own, in an event casuals can see: only that place warns.
    const session = shown.sessions[0];
    if (!session) throw new Error("fixture");
    const own = focusItems({
      ...full,
      urgent: ok({
        more: false,
        events: [
          {
            ...shown,
            sessions: [session, { ...session, shiftId: "u3", showing: false, offered: 0 }],
          },
        ],
      }),
    });
    expect(own.map((i) => [i.shiftId, i.hidden !== null, i.notOffered])).toEqual([
      ["u1", false, false],
      ["u3", true, true],
    ]);
    // More than the list holds: said so.
    expect(words(render({ ...full, urgent: ok({ ...full.urgent.data, more: true }) }))).toContain(
      "More urgent places are on Events & sessions.",
    );
  });

  it("Needs attention: a row per kind of thing that needs you, with its count and what to do, each to where it's dealt with", () => {
    expect(rows(render(full, { isAdmin: true }), "Needs attention")).toEqual([
      "Bookings to check Booked, but can't work these shifts as things stand 1 Check them → /office/needs-attention#to-check",
      "From your rota sheet Changes your rota sheet asked for that the app couldn't do 1 See them → /office/needs-attention#from-sheet",
      "Who worked? 1 session on Sat 31 Oct to mark 1 Mark who worked → /office/needs-attention#to-mark",
      "Qualifications out of date on a booking A booked casual's qualification runs out before their shift 1 See them → /office/needs-attention#expired",
      "Uploads to check Photos and documents from casuals 2 Check → /office/casuals?view=uploads",
      "Strike evidence Strike records the strikes team hasn't had 2 See them → /office/needs-attention#evidence",
      "Your planner's change was refused Changes to booked sessions that weren't made 1 See them → /office/needs-attention#planner-refused",
      "Enquiries that need a person Messages and requests the shifts line couldn't answer 2 Answer → /office/enquiries",
    ]);
    // Its count is the menu's: every item, and the enquiries that need a person.
    expect(full.needs.ok && attentionCount(full.needs.data, 2)).toEqual({ count: 11, more: false });
    expect(words(section(render(full), "needs-attention"))).toMatch(/^Needs attention 11 /);
    expect(section(render(full), "needs-attention")).toMatch(
      /<a class="[^"]*" href="\/office\/needs-attention">Open Needs attention/,
    );
    // A list stopped at 50 says so.
    if (!full.needs.ok) throw new Error("fixture");
    const many = render({ ...full, needs: ok({ ...full.needs.data, toCheckMore: true }) });
    expect(rows(many, "Needs attention")[0]).toContain("as things stand 1+ Check them →");
    expect(words(section(many, "needs-attention"))).toMatch(/^Needs attention 11\+ /);
    // Nothing: said so.
    const calm = section(render(empty), "needs-attention");
    expect(words(calm)).toContain(SECTIONS.needs.empty);
  });

  it("Waiting on others (pay queries with payroll, or that nothing is); Sorted today: cancellations recorded, enquiries, what casuals can see", () => {
    const html = render(full, { payQueriesWaiting: 3 });
    expect(rows(html, "Waiting on others")).toEqual([
      "Pay queries With payroll, nothing for you to do 3 → /office/pay-queries",
    ]);
    expect(words(section(render(full), "waiting"))).toBe(
      "Waiting on others Nothing is waiting on anyone else.",
    );
    expect(rows(html, "Sorted today")).toEqual([
      "2 cancellations today 1 under 48 hours' notice, 1 strike issued. Recorded automatically, never approved or declined. → /office/cancellations?day=today",
      "18 enquiries today 16 answered automatically. 2 need a person. → /office/enquiries?day=today",
      "8 events showing to casuals 26 open places across 12 sessions → /office/events?view=showing",
    ]);
    expect(rows(render(empty), "Sorted today")).toEqual([
      "0 cancellations today 0 under 48 hours' notice, 0 strikes issued. Recorded automatically, never approved or declined. → /office/cancellations?day=today",
      "0 enquiries today 0 answered automatically. None need a person. → /office/enquiries?day=today",
      "0 events showing to casuals 0 open places across 0 sessions → /office/events?view=showing",
    ]);
    // Cancellations are a record, never a request.
    expect(html).not.toMatch(/>(Approve|Decline|Deny)</);
  });

  it("a part that couldn't be read says so where it shows, the rest still shows, and nothing claims all is well", () => {
    const broken: Dashboard = {
      ...full,
      counts: { ...full.counts, urgent: failed, showing: failed, enquiries: failed },
      urgent: failed,
      needs: failed,
      week: failed,
    };
    const html = render(broken);
    // Not "Nothing needs you" or "Every urgent place is filled": it can't know.
    expect(h1s(html)).toEqual(["Evening, Acme Events. Some of the dashboard couldn't load."]);
    expect(words(html)).toContain("Reload the page to try again. What could load is below.");
    expect(words(html)).not.toMatch(/Every urgent place is filled|Nothing needs you/);
    expect(tiles(html).slice(0, 2)).toEqual([
      "Urgent places – Couldn't load → #urgent-places",
      "Needs attention – Couldn't load → #needs-attention",
    ]);
    expect(words(section(html, "urgent-places"))).toContain(SECTION_ERROR);
    expect(words(section(html, "needs-attention"))).toContain(SECTION_ERROR);
    expect(html).not.toMatch(/<nav aria-label="This week"/);
    expect(words(section(html, "this-week"))).toContain(SECTION_ERROR);
    expect(rows(html, "Sorted today")).toEqual([
      "2 cancellations today 1 under 48 hours' notice, 1 strike issued. Recorded automatically, never approved or declined. → /office/cancellations?day=today",
      "Enquiries today Couldn't load → /office/enquiries?day=today",
      "Events showing to casuals Couldn't load → /office/events?view=showing",
    ]);
    // Only Needs attention unread: what it could count is "at least" (the 3 urgent places and
    // the 2 enquiries), with the enquiries row.
    const part = render({ ...full, needs: failed });
    expect(h1s(part)).toEqual(["Evening, Acme Events. At least 5 things need you."]);
    expect(words(section(part, "needs-attention"))).toContain(SECTION_ERROR);
    expect(rows(part, "Needs attention")).toHaveLength(1);
    // A list stopped at 50: "at least" too.
    if (!full.needs.ok) throw new Error("fixture");
    expect(h1s(render({ ...full, needs: ok({ ...full.needs.data, toMarkMore: true }) }))).toEqual([
      "Evening, Acme Events. At least 14 things need you.",
    ]);
  });

  // Phase 21's parts, as drawn (Dylan's brief; the claims-auditor's round 1).
  // Phase 22 (round 2): each day's bar stands in its groove, whose top is every place filled (the
  // dashed line of Phase 21), striped on a day with no sessions.
  it("this week: each day's bar in its groove (striped with no sessions), and the rota board as a white pill", () => {
    const week = section(render(full), "this-week");
    const grooves = [
      ...week.matchAll(
        /<span aria-hidden="true" class="([^"]*rounded-row bg-raised inset-shadow-sunk[^"]*)">/g,
      ),
    ].map((m) => m[1]!);
    expect(grooves).toHaveLength(7);
    // Mon, Fri and Sun have no sessions.
    expect(grooves.map((g) => / stripes$/.test(g))).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(week).not.toContain("border-dashed");
    expect(week).toContain(
      `<a class="${btn.secondary} w-full sm:row-start-3 sm:w-auto sm:self-start" href="/office/events">Open the rota board</a>`,
    );
    expect(btn.secondary).toMatch(/(?<![\w-])bg-button(?![\w-])/);
    expect(btn.secondary).toMatch(/(?<![\w-])rounded-full(?![\w-])/);
    expect(btn.secondary).toMatch(/(?<![\w-])shadow-raise(?![\w-])/);
    // Couldn't load: neither, only the words.
    const broken = section(render({ ...full, week: failed }), "this-week");
    expect(broken).not.toContain("inset-shadow-sunk");
    expect(broken).not.toContain("Open the rota board");
  });

  it('an urgent place nobody\'s been offered says "Not offered yet" in red; the count beside the heading is red too', () => {
    if (!full.urgent.ok) throw new Error("fixture");
    const [shown] = full.urgent.data.events;
    const session = shown?.sessions[0];
    if (!shown || !session) throw new Error("fixture");
    const html = render({
      ...full,
      urgent: ok({
        more: false,
        events: [{ ...shown, sessions: [{ ...session, shiftId: "u9", offered: 0 }] }],
      }),
    });
    const [place] = places(html);
    // Phase 22: a red dot before it.
    expect(place).toMatch(
      /<p class="flex items-center gap-2 text-sm lg:w-40 font-semibold text-urgent"><span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-urgent-fill"><\/span>Not offered yet<\/p>/,
    );
    // One that was offered: its words in grey, no dot.
    expect(places(render(full))[0]).toMatch(
      /<p class="flex items-center gap-2 text-sm lg:w-40 text-ink-muted">Offered to 4 casuals<\/p>/,
    );
    // The office's one count pill; red only for the urgent places.
    expect(section(render(full), "urgent-places")).toContain(
      `<span class="${countUrgent}">2</span>`,
    );
    expect(section(render(full), "needs-attention")).toContain(`<span class="${count}">11</span>`);
    expect(countUrgent.replace("bg-urgent-tile text-urgent-ink", "bg-count text-ink-muted")).toBe(
      count,
    );
  });

  // Phase 22: a faint grain over each wash, the panel raised off the page; its rows white and raised
  // off it, lifting under the pointer and dipping when pressed; Needs attention's one to a line.
  it("Needs attention, Waiting on others and Sorted today: tinted panels (a 1px edge a shade darker) of raised white rows", () => {
    const html = render(full, { payQueriesWaiting: 3 });
    const panel = (id: string) =>
      new RegExp(`<section aria-labelledby="${id}" class="([^"]*)"`).exec(html)?.[1] ?? "";
    for (const [id, tint] of [
      ["needs-attention", "border-attention-line bg-attention-soft"],
      ["waiting", "border-wait-line bg-wait-soft"],
      ["sorted", "border-done-line bg-done-soft"],
    ] as const) {
      expect(panel(id), id).toMatch(/^grain-soft /);
      expect(panel(id), id).toMatch(/(?<![\w-])border(?![\w-]).* shadow-soft .*rounded-card /);
      expect(panel(id), id).toMatch(new RegExp(`${tint}$`));
    }
    expect(section(html, "needs-attention")).not.toContain("lg:grid-cols-2");
    for (const id of ["needs-attention", "waiting", "sorted"]) {
      const rowClasses = [...section(html, id).matchAll(/<a class="([^"]*)" href=/g)]
        .map((m) => m[1] ?? "")
        .filter((c) => c.includes("min-h-16"));
      expect(rowClasses.length, id).toBeGreaterThan(0);
      for (const c of rowClasses)
        expect(c, id).toMatch(
          /rounded-row bg-card px-4 py-3 text-ink shadow-raise press group h-full hover:-translate-y-0\.5/,
        );
    }
  });

  it("Waiting on others couldn't be read: its card and section say so, the rest still shows", () => {
    const html = render(full, { payQueriesWaiting: null });
    expect(tiles(html)[2]).toBe("Waiting on others – Couldn't load → #waiting");
    expect(words(section(html, "waiting"))).toContain(SECTION_ERROR);
    expect(words(section(html, "waiting"))).not.toContain("Nothing is waiting on anyone else.");
    expect(rows(html, "Waiting on others")).toEqual([]);
    expect(words(section(html, "needs-attention"))).not.toContain(SECTION_ERROR);
    // The headline doesn't count what waits on others: the same as when it could be read.
    expect(h1s(html)).toEqual(h1s(render(full, { payQueriesWaiting: 3 })));
    expect(h1s(html)).toEqual(["Evening, Acme Events. 14 things need you."]);
  });

  it("the page's read of it: a role without pay is 0, a failed read is null (not the whole page)", async () => {
    expect(await waitingOrFailed(async () => 4)).toBe(4);
    expect(await waitingOrFailed(async () => null)).toBe(0);
    expect(
      await waitingOrFailed(async () => {
        throw new Error("connection lost");
      }),
    ).toBeNull();
  });

  it("no dashboard link repeats a menu link's name", () => {
    const menu = officeMenu("admin").flatMap((g) => g.links.map((l) => l.label));
    expect(menu).toContain("Dashboard");
    expect(menu).toContain("Needs attention");
    const names = links(render(full, { isAdmin: true, payQueriesWaiting: 2 })).map((l) => l.name);
    for (const label of menu) expect(names).not.toContain(label);
  });
});

describe("Needs attention's page (Phase 18: the bell opens it; the dashboard's After that counts it)", () => {
  const page = (isAdmin = true) =>
    renderToStaticMarkup(
      createElement(NeedsItems, {
        n: full.needs.ok ? full.needs.data : noNeeds,
        timeZone: TZ,
        today: full.today,
        isAdmin,
      }),
    );

  it("each item, with a link to where it's dealt with", () => {
    const html = page();
    const part = (id: string) => section(html, id);
    expect(words(part("to-check"))).toContain("Lena Leaver is booked, but is no longer active.");
    expect(part("to-check")).toMatch(/href="\/office\/casuals\/w4"/);
    expect(words(part("to-check"))).toContain("Cancel Lena Leaver's booking");
    expect(words(part("from-sheet"))).toContain("Track operative at Demo Junction");
    expect(part("from-sheet")).toMatch(/href="\/office\/shifts\/f1"/);
    // Who worked?: one link per row, the shift.
    const marks = [...part("to-mark").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.[1]?.match(/<a /g)).toHaveLength(1);
    expect(marks[0]?.[1]).toMatch(/href="\/office\/shifts\/m1"/);
    expect(words(part("to-mark"))).toContain("3 people not marked yet.");
    expect(words(part("expired"))).toContain(
      "Ben Example's SIA door supervisor licence expired on Sun 1 Nov",
    );
    expect(part("expired")).toMatch(/href="\/office\/casuals\/w5"/);
    expect(part("expired")).toMatch(/href="\/office\/shifts\/x-shift"/);
    expect(words(part("uploads"))).toContain("2 uploads wait for a check.");
    expect(part("uploads")).toMatch(/href="\/office\/casuals\?view=uploads"/);
    expect(words(part("evidence"))).toContain(
      "The strikes team's email isn't set and confirmed, so strike records can't be emailed to them. 1 record waits for it.",
    );
    expect(part("evidence")).toMatch(/href="\/office\/settings"/);
    expect(part("evidence")).toMatch(/href="\/office\/cancellations\/ev1"/);
    expect(words(part("planner-refused"))).toContain(
      "Your planner's change to the steward session on Sat 7 Nov was refused: 2 booked casuals can't work it.",
    );
    expect(words(part("planner-refused"))).toContain(
      "Steward at Acme Demo Racecourse , Sat 7 Nov, 10:00 to 18:00",
    );
    expect(words(part("planner-refused"))).toContain("Refused 08:30 on Mon 2 Nov");
    expect(part("planner-refused")).toMatch(/href="\/office\/shifts\/p1"/);
    // Each part's heading, with its count (the ids the dashboard's rows link to).
    expect(
      [...html.matchAll(/<h3 id="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => [
        m[1],
        words(m[2] ?? ""),
      ]),
    ).toEqual([
      ["to-check", "Bookings to check 1"],
      ["from-sheet", "From your rota sheet 1"],
      ["to-mark", "Who worked? 1"],
      ["expired", "Qualifications out of date on a booking 1"],
      ["uploads", "Uploads to check 2"],
      ["evidence", "Strike evidence 2"],
      ["planner-refused", "Your planner's change was refused 1"],
    ]);
  });

  it("your planner's webhook failing: since when, what to do, Integrations for an admin", () => {
    const failing = (isAdmin: boolean) =>
      renderToStaticMarkup(
        createElement(NeedsItems, {
          n: { ...noNeeds, webhookFailing: { since: at("2026-11-02T03:10:00Z") } },
          timeZone: TZ,
          today: "2026-11-02",
          isAdmin,
        }),
      );
    const admin = failing(true);
    expect(admin).toContain('<h3 id="webhook"');
    expect(words(section(admin, "webhook"))).toContain(
      "Since 03:10 on Mon 2 Nov, bookings and cancellations haven't reached your planner by webhook.",
    );
    expect(
      [...admin.matchAll(/<h3 id="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => words(m[2] ?? "")),
    ).toEqual(["Your planner's webhook is failing 1"]);
    expect(section(admin, "webhook")).toMatch(
      /<a [^>]*href="\/office\/settings\/integrations"[^>]*>Open Integrations<\/a>/,
    );
    // A resourcer can't open Integrations: told who can.
    const resourcer = failing(false);
    expect(resourcer).not.toContain('href="/office/settings/integrations"');
    expect(words(resourcer)).toContain("An admin can check it in Integrations.");
  });

  it("Phase 20: each upload by name and time with its own Check; alike sessions to mark in one row; the enquiries that need a person", () => {
    const html = page();
    // Each upload: whose and what (mid-sentence), when, and its own Check to their page.
    const uploads = [...section(html, "uploads").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(
      (m) => m[1] ?? "",
    );
    expect(uploads.map((u) => words(u))).toEqual([
      "Ben Fraser's staff photo Uploaded at 01:29 on Mon 2 Nov Check",
      "Leah Ward's SIA door supervisor licence Uploaded at 15:29 on Sat 31 Oct Check",
    ]);
    expect(uploads[0]).toMatch(
      /<a aria-label="Check Ben Fraser&#x27;s upload" class="[^"]*" href="\/office\/casuals\/w6#uploads">Check<\/a>/,
    );
    expect(uploads[1]).toMatch(/href="\/office\/casuals\/w7#uploads"/);
    // More than the first 50: said so.
    if (!full.needs.ok) throw new Error("fixture");
    const lots = renderToStaticMarkup(
      createElement(NeedsItems, {
        n: { ...full.needs.data, uploads: 60 },
        timeZone: TZ,
        today: full.today,
        isAdmin: true,
      }),
    );
    expect(words(section(lots, "uploads"))).toContain("Showing the first 2.");
    // Sessions alike (role, place, times): one row, how many sessions, the people summed, and
    // each session's way in.
    const m1 = full.needs.data.toMark[0]!;
    const alike = [
      m1,
      { ...m1, shiftId: "m2", unmarked: 1 },
      { ...m1, shiftId: "m3", unmarked: 2 },
    ];
    expect(
      toMarkGroups([...alike, { ...m1, shiftId: "m4", site: "Elsewhere" }]).map((g) => [
        g.sessions.map((t) => t.shiftId),
        g.unmarked,
      ]),
    ).toEqual([
      [["m1", "m2", "m3"], 6],
      [["m4"], m1.unmarked],
    ]);
    const grouped = section(
      renderToStaticMarkup(
        createElement(NeedsItems, {
          n: { ...noNeeds, toMark: alike },
          timeZone: TZ,
          today: full.today,
          isAdmin: true,
        }),
      ),
      "to-mark",
    );
    const row = [...grouped.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)];
    expect(row).toHaveLength(1);
    expect(words(row[0]?.[1] ?? "")).toContain(
      "· 3 sessions 6 people not marked yet. Mark who worked: Session 1 Session 2 Session 3",
    );
    expect([...grouped.matchAll(/href="\/office\/shifts\/(m\d)"/g)].map((m) => m[1])).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
    // The enquiries that need a person: a part of their own, counted, to Enquiries.
    const asked = renderToStaticMarkup(
      createElement(NeedsItems, {
        n: noNeeds,
        timeZone: TZ,
        today: full.today,
        isAdmin: true,
        needPerson: 2,
      }),
    );
    expect(words(section(asked, "enquiries"))).toBe(
      "Enquiries that need a person 2 2 messages and requests the shifts line couldn't answer. Open Enquiries",
    );
    expect(section(asked, "enquiries")).toMatch(/href="\/office\/enquiries"/);
    expect(words(asked)).not.toContain(SECTIONS.needs.empty);
  });

  it("nothing: says so", () => {
    const calm = renderToStaticMarkup(
      createElement(NeedsItems, { n: noNeeds, timeZone: TZ, today: full.today, isAdmin: true }),
    );
    expect(words(calm)).toContain(SECTIONS.needs.empty);
  });
});
