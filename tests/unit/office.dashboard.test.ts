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
import type { CancellationRow } from "@/lib/office/cancellations-copy";
import type { GapSession, OfferRow } from "@/lib/office/dashboard-chart-types";
import type {
  ChartCard,
  CountCard,
  DashboardModel,
  Mark,
  Panel,
} from "@/lib/office/dashboard-charts";
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
// redesign; Phase 23's charts): its words (src/lib/office/dashboard-copy.ts, today-copy.ts,
// dashboard-home.ts, dashboard-charts.ts) and the rendered page (src/app/office/dashboard-view.tsx
// and its charts and panel, src/app/office/dashboard/), from made-up data: the headline and where
// to start, the four count cards and the lists they open (Needs attention's rows, "Waiting on
// others", "Sorted today"), the urgent places as cards with their warnings, the six charts with
// their marks, keys, tables and panels (the week strip's days and links now in the places chart),
// a part that couldn't load, no link repeating a menu link's name, every old link still there; and
// Needs attention's page, each item linking to where it's dealt with. tests/unit/
// office.dashboard-charts.test.ts checks the chart builders one by one.

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
const { PanelView } = await import("@/app/office/dashboard/chart-panel");
const { btn, chip, count, countNeeds, countUrgent, quietLink } = await import("@/app/ui/classes");
const { CHART_IDS, CHART_TITLES, dashboardModel } = await import("@/lib/office/dashboard-charts");
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
  // The six charts (Phase 23), empty.
  fill: ok({
    first: "2026-11-02",
    days: Array.from({ length: 14 }, (_, i) => ({
      date: `2026-11-${String(2 + i).padStart(2, "0")}`,
      places: 0,
      filled: 0,
      open: 0,
      urgent: 0,
      gapSessions: 0,
      hidden: 0,
    })),
    gaps: [],
    more: false,
  }),
  eventsNeed: ok({
    events: [],
    more: 0,
    total: { events: 0, places: 0, urgent: 0 },
    hiddenEvents: 0,
    full: [],
    fullMore: 0,
  }),
  offersWeek: ok({
    week: { monday: "2026-11-02", sunday: "2026-11-08" },
    counts: { yes: 0, waiting: 0, closed: 0 },
    closedWhy: { said_no: 0, filled_elsewhere: 0, changed: 0, no_reply: 0 },
    rows: { yes: [], waiting: [], closed: [] },
    more: { yes: false, waiting: false, closed: false },
    waitingSessions: [],
    waitingSessionsMore: false,
  }),
  waited: ok({
    today: "2026-11-02",
    days: [],
    items: [],
    more: {
      "to-mark": false,
      uploads: false,
      enquiries: false,
      evidence: false,
      "planner-refused": false,
      webhook: false,
    },
    undated: { toCheck: 0, fromSheet: 0, expired: 0, strikesAddress: 0 },
    needsYouTotal: 0,
    needsYouMore: false,
    pay: null,
  }),
  cancels14: ok({
    first: "2026-10-20",
    days: Array.from({ length: 14 }, (_, i) => ({
      date: i < 12 ? `2026-10-${String(20 + i).padStart(2, "0")}` : `2026-11-0${i - 11}`,
      total: 0,
      short: 0,
      byCasuals: 0,
    })),
    threshold: 48,
    rows: [],
    more: false,
  }),
  licences: ok({
    today: "2026-11-02",
    windowDays: 56,
    soonDays: 30,
    rows: [],
    more: false,
    counts: { total: 0, soon: 0, booked: 0 },
  }),
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

// The charts' made-up rows (Phase 23): Monday 2 November, London. Sessions with places free over
// the next 2 weeks (the urgent places u1 and u2 among them), as the loaders give them.
const noOffers = { offered: 0, waiting: 0, declined: 0, accepted: 0, stopped: null };
const gap = (o: Partial<GapSession> & Pick<GapSession, "shiftId" | "date">): GapSession => ({
  eventId: "e2",
  eventName: "Riverside Food Festival",
  site: "Riverside Demo Park",
  role: "steward",
  startsAt: at(`${o.date}T10:00:00Z`),
  endsAt: at(`${o.date}T18:00:00Z`),
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
const gaps: GapSession[] = [
  gap({
    shiftId: "g1",
    date: "2026-11-04",
    eventId: "e1",
    eventName: "Northern Lights Live",
    site: "Acme Demo Arena",
    role: "door_supervisor",
    startsAt: at("2026-11-04T10:30:00Z"),
    endsAt: at("2026-11-04T18:30:00Z"),
    headcount: 3,
    booked: 1,
    placesFree: 2,
    urgentGap: true,
  }),
  gap({ shiftId: "g2", date: "2026-11-04", offers: { ...noOffers, offered: 2, waiting: 2 } }),
  gap({
    shiftId: "g3",
    date: "2026-11-05",
    headcount: 10,
    booked: 6,
    placesFree: 4,
    offers: { ...noOffers, offered: 1, declined: 1 },
  }),
  gap({
    shiftId: "u1",
    date: "2026-11-07",
    eventId: "e1",
    eventName: "Northern Lights Live",
    site: "Acme Demo Arena",
    role: "door_supervisor",
    startsAt: at("2026-11-07T06:00:00Z"),
    endsAt: at("2026-11-07T14:00:00Z"),
    headcount: 3,
    booked: 1,
    placesFree: 2,
    urgentGap: true,
    offers: { ...noOffers, offered: 4, waiting: 4 },
  }),
  gap({
    shiftId: "u2",
    date: "2026-11-08",
    eventId: "e3",
    eventName: "Night patrols",
    site: null,
    startsAt: at("2026-11-08T18:00:00Z"),
    endsAt: at("2026-11-08T23:00:00Z"),
    headcount: 1,
    booked: 0,
    placesFree: 1,
    urgentGap: true,
    hidden: true,
    eventShowing: false,
    offers: { ...noOffers, stopped: "no_candidates" },
  }),
];
const fillDays: Record<string, [number, number, number, number, number, number]> = {
  // places, filled, open, urgent, sessions with a place free, places free casuals can't see
  "2026-11-03": [4, 4, 0, 0, 0, 0],
  "2026-11-04": [6, 3, 3, 2, 2, 0],
  "2026-11-05": [10, 6, 4, 0, 1, 0],
  "2026-11-07": [3, 1, 2, 2, 1, 0],
  // u2, its event hidden from casuals.
  "2026-11-08": [1, 0, 1, 1, 1, 1],
};
const offer = (o: Partial<OfferRow> & Pick<OfferRow, "offerId" | "state">): OfferRow => ({
  shiftId: "u1",
  workerId: "w8",
  casual: "Ella Shaw",
  role: "door_supervisor",
  eventName: "Northern Lights Live",
  startsAt: at("2026-11-07T06:00:00Z"),
  sentAt: at("2026-11-02T09:12:00Z"),
  answeredAt: null,
  byOffice: true,
  why: null,
  ...o,
});
const cancelRows: CancellationRow[] = [
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
];
const twoWeeksBack = Array.from({ length: 14 }, (_, i) =>
  i < 12 ? `2026-10-${String(20 + i).padStart(2, "0")}` : `2026-11-0${i - 11}`,
);

const full: Dashboard = {
  ...empty,
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
    rows: cancelRows,
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
  fill: ok({
    first: "2026-11-02",
    days: Array.from({ length: 14 }, (_, i) => {
      const date = `2026-11-${String(2 + i).padStart(2, "0")}`;
      const [places, filled, open, urgent, gapSessions, hidden] = fillDays[date] ?? [
        0, 0, 0, 0, 0, 0,
      ];
      return { date, places, filled, open, urgent, gapSessions, hidden };
    }),
    gaps,
    more: false,
  }),
  eventsNeed: ok({
    events: [
      {
        eventId: "e1",
        name: "Northern Lights Live",
        site: "Acme Demo Arena",
        places: 4,
        urgent: 4,
        gapSessions: 2,
        firstGap: at("2026-11-04T10:30:00Z"),
        showing: true,
        hiddenSessions: false,
        hidden: false,
        sessions: [gaps[0]!, gaps[3]!],
        moreSessions: false,
      },
      {
        eventId: "e3",
        name: "Night patrols",
        site: null,
        places: 1,
        urgent: 1,
        gapSessions: 1,
        firstGap: at("2026-11-08T18:00:00Z"),
        showing: false,
        hiddenSessions: false,
        hidden: true,
        sessions: [gaps[4]!],
        moreSessions: false,
      },
      {
        eventId: "e2",
        name: "Riverside Food Festival",
        site: "Riverside Demo Park",
        places: 5,
        urgent: 0,
        gapSessions: 2,
        firstGap: at("2026-11-04T10:00:00Z"),
        showing: true,
        hiddenSessions: false,
        hidden: false,
        sessions: [gaps[1]!, gaps[2]!],
        moreSessions: false,
      },
    ],
    more: 0,
    total: { events: 3, places: 10, urgent: 5 },
    hiddenEvents: 1,
    full: ["Northgate Charity 10K"],
    fullMore: 0,
  }),
  offersWeek: ok({
    week: { monday: "2026-11-02", sunday: "2026-11-08" },
    counts: { yes: 1, waiting: 3, closed: 1 },
    closedWhy: { said_no: 1, filled_elsewhere: 0, changed: 0, no_reply: 0 },
    rows: {
      yes: [
        offer({
          offerId: "o1",
          state: "yes",
          casual: "Aisha Khan",
          answeredAt: at("2026-11-02T10:05:00Z"),
        }),
      ],
      waiting: [
        offer({ offerId: "o2", state: "waiting", sentAt: at("2026-11-02T11:40:00Z") }),
        offer({ offerId: "o3", state: "waiting", casual: "Jack Moss" }),
        offer({
          offerId: "o4",
          state: "waiting",
          shiftId: "g2",
          casual: "Omar Price",
          role: "steward",
          eventName: "Riverside Food Festival",
          startsAt: at("2026-11-04T10:00:00Z"),
        }),
      ],
      closed: [offer({ offerId: "o5", state: "closed", why: "said_no", casual: "Dan Morris" })],
    },
    more: { yes: false, waiting: false, closed: false },
    waitingSessions: [
      {
        shiftId: "u1",
        role: "door_supervisor",
        eventName: "Northern Lights Live",
        startsAt: at("2026-11-07T06:00:00Z"),
        endsAt: at("2026-11-07T14:00:00Z"),
        waiting: 2,
      },
      {
        shiftId: "g2",
        role: "steward",
        eventName: "Riverside Food Festival",
        startsAt: at("2026-11-04T10:00:00Z"),
        endsAt: at("2026-11-04T18:00:00Z"),
        waiting: 1,
      },
    ],
    waitingSessionsMore: false,
  }),
  // Needs attention's items with a date (below), each on its firm day: 1 session to mark (Sat 31
  // Oct), 2 uploads (today, Sat 31 Oct), 2 enquiries that need a person, 1 strike record and 1
  // refused change (today); with the 4 undated ones, 11: the menu's count.
  waited: ok({
    today: "2026-11-02",
    days: [
      {
        day: "2026-10-31",
        needsYou: {
          "to-mark": 1,
          uploads: 1,
          enquiries: 0,
          evidence: 0,
          "planner-refused": 0,
          webhook: 0,
        },
      },
      {
        day: "2026-11-02",
        needsYou: {
          "to-mark": 0,
          uploads: 1,
          enquiries: 2,
          evidence: 1,
          "planner-refused": 1,
          webhook: 0,
        },
      },
    ],
    items: [
      {
        kind: "to-mark",
        since: at("2026-10-31T18:00:00Z"),
        day: "2026-10-31",
        shiftId: "m1",
        role: "steward",
        site: "Acme Demo Racecourse",
        startsAt: at("2026-10-31T10:00:00Z"),
        endsAt: at("2026-10-31T18:00:00Z"),
        unmarked: 3,
      },
      {
        kind: "uploads",
        since: at("2026-10-31T15:29:00Z"),
        day: "2026-10-31",
        uploadId: "up2",
        workerId: "w7",
        casual: "Leah Ward",
        upload: "certificate",
        qualificationName: "SIA door supervisor licence",
      },
      {
        kind: "uploads",
        since: at("2026-11-02T01:29:00Z"),
        day: "2026-11-02",
        uploadId: "up1",
        workerId: "w6",
        casual: "Ben Fraser",
        upload: "photo",
        qualificationName: null,
      },
      {
        kind: "enquiries",
        since: at("2026-11-02T08:00:00Z"),
        day: "2026-11-02",
        messageId: "m2",
        channel: "sms",
        who: { kind: "unknown" },
      },
      {
        kind: "enquiries",
        since: at("2026-11-02T08:10:00Z"),
        day: "2026-11-02",
        messageId: "m3",
        channel: "whatsapp",
        who: { kind: "casual", workerId: "w3", name: "Zoe Usman" },
      },
      {
        kind: "evidence",
        since: at("2026-11-02T10:00:00Z"),
        day: "2026-11-02",
        assignmentId: "ev1",
        casual: "Ann Booker",
        stuck: false,
        nothingSent: true,
      },
      {
        kind: "planner-refused",
        since: at("2026-11-02T08:30:00Z"),
        day: "2026-11-02",
        shiftId: "p1",
        role: "steward",
        site: "Acme Demo Racecourse",
        startsAt: at("2026-11-07T10:00:00Z"),
        why: "move",
        casuals: 2,
      },
    ],
    more: {
      "to-mark": false,
      uploads: false,
      enquiries: false,
      evidence: false,
      "planner-refused": false,
      webhook: false,
    },
    undated: { toCheck: 1, fromSheet: 1, expired: 1, strikesAddress: 1 },
    needsYouTotal: 11,
    needsYouMore: false,
    pay: null,
  }),
  cancels14: ok({
    first: "2026-10-20",
    days: twoWeeksBack.map((date) =>
      date === "2026-11-02"
        ? { date, total: 2, short: 1, byCasuals: 1 }
        : date === "2026-10-28"
          ? { date, total: 1, short: 0, byCasuals: 1 }
          : { date, total: 0, short: 0, byCasuals: 0 },
    ),
    threshold: 48,
    rows: [
      ...cancelRows,
      {
        ...cancelRows[0]!,
        assignmentId: "a3",
        ref: "C9D0E1F2",
        casual: "Maya Cole",
        cancelledAt: at("2026-10-28T12:00:00Z"),
        noticeHours: 70,
        strikeCode: null,
        strike: null,
      },
    ],
    more: false,
  }),
  licences: ok({
    today: "2026-11-02",
    windowDays: 56,
    soonDays: 30,
    rows: [
      {
        credentialId: "c1",
        workerId: "w5",
        casual: "Ben Example",
        type: "SIA_DS",
        name: "SIA door supervisor licence",
        expiresOn: "2026-11-05",
        days: 3,
        soon: true,
        renewalWaiting: false,
        booked: {
          assignmentId: "x1",
          shiftId: "x-shift",
          role: "door_supervisor",
          startsAt: at("2026-11-07T10:00:00Z"),
          lastDay: "2026-11-07",
        },
      },
      {
        credentialId: "c2",
        workerId: "w7",
        casual: "Leah Ward",
        type: "FIRST_AID",
        name: "First aid at work certificate",
        expiresOn: "2026-12-10",
        days: 38,
        soon: false,
        renewalWaiting: true,
        booked: null,
      },
    ],
    more: false,
    counts: { total: 2, soon: 1, booked: 1 },
  }),
};

// `isAdmin` is for Needs attention's page (its own test below uses NeedsItems); the dashboard's
// rows are the same for admins and resourcers. `pay`: the office user's role can open Pay.
type Opts = {
  isAdmin?: boolean;
  shiftsLine?: string;
  payQueriesWaiting?: number | null;
  pay?: boolean;
};
// Monday 2 November, 18:30 in London: the evening.
const NOW = at("2026-11-02T18:30:00Z");
const render = (d: Dashboard, o: Opts = {}) =>
  renderToStaticMarkup(
    createElement(DashboardContent, {
      d,
      firmName: "Acme Events",
      shiftsLine: o.shiftsLine,
      payQueriesWaiting: o.payQueriesWaiting === undefined ? 0 : o.payQueriesWaiting,
      pay: o.pay ?? false,
      now: NOW,
    }),
  );
// What the page draws (src/lib/office/dashboard-charts.ts), as DashboardContent builds it.
const modelOf = (d: Dashboard, o: Opts = {}): DashboardModel =>
  dashboardModel(d, {
    now: NOW,
    pay: o.pay ?? false,
    payQueriesWaiting: o.payQueriesWaiting === undefined ? 0 : o.payQueriesWaiting,
  });
// A panel as the dialog shows it.
const panelHtml = (panel: Panel) => renderToStaticMarkup(createElement(PanelView, { panel }));
// Every mark of a chart, and every panel the page can open (its cards' and its charts' marks').
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
  return b.dots.map((dot) => dot.mark);
};
const allPanels = (m: DashboardModel) => [
  ...m.cards.map((c) => c.panel),
  ...m.charts.flatMap(marksOf).map((mk) => mk.panel),
];
const panelOf = (c: ChartCard, key: string) => {
  const mk = marksOf(c).find((x) => x.key === key);
  if (!mk) throw new Error(`no mark ${key}`);
  return mk.panel;
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A count card (Phase 23; glass since Phase 24): a section of glass, 22px round, dipping when
// pressed; brighter under the pointer.
const CARD =
  "press grid grid-cols-[minmax(0,1fr)_auto] content-start gap-x-2 gap-y-3 glass rounded-inner p-4 text-ink hover:bg-button-hover sm:p-6";
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
    href: (m[1] ?? "").replace(/&amp;/g, "&"),
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

describe("the page (Phases 18 to 23: the dashboard)", () => {
  const h1s = (html: string) =>
    [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => words(m[1] ?? ""));
  // The four count cards, in order: their words and where each goes without script.
  const tiles = (html: string) =>
    [
      ...html.matchAll(new RegExp(`<a href="([^"]*)" class="${esc(CARD)}">([\\s\\S]*?)</a>`, "g")),
    ].map((m) => `${words(m[2] ?? "")} → ${m[1]}`);
  // The urgent places listed, each a card.
  const places = (html: string) =>
    [
      ...section(html, "urgent-places").matchAll(/<li data-urgent-place=""[^>]*>([\s\S]*?)<\/li>/g),
    ].map((m) => m[1] ?? "");
  // A panel's rows: their words, then where the row's last link goes.
  const rows = (html: string) =>
    [
      ...html.matchAll(
        /<li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">([\s\S]*?)<\/li>/g,
      ),
    ].map((m) => {
      const hrefs = links(m[1] ?? "").map((l) => l.href);
      return `${words(m[1] ?? "")}${hrefs.length > 0 ? ` → ${hrefs.at(-1)}` : ""}`;
    });
  const card = (d: Dashboard, key: CountCard["key"], o: Opts = {}) =>
    modelOf(d, o).cards.find((c) => c.key === key)!;
  // A rendered panel's "couldn't load" notice: the words of its status line (null: it has none).
  const notice = (html: string) => {
    const m = /<p role="status"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    return m ? words(m[1] ?? "") : null;
  };

  it("the greeting and the one count: the urgent places and Needs attention's items, then where to start", () => {
    const html = render(full, { shiftsLine: "Shifts line 07700 900123" });
    // 3 urgent places + 9 of Needs attention's items + 2 enquiries that need a person.
    expect(h1s(html)).toEqual(["Evening, Acme Events. 14 things need you."]);
    // Phase 23: today and the week over the greeting (the pay date is in the top bar now).
    expect(words(html)).toContain(
      "Monday 2 November · Week 45 Evening, Acme Events. 14 things need you. Start with Saturday's door supervisor at 06:00: offered to 4 casuals. Shifts line 07700 900123",
    );
    expect(words(html)).not.toContain("Pay Fri 13 Nov");
    // The page's one <h1>: the greeting in the headline's own style, then the count.
    expect(html).toMatch(
      /<h1 class="text-ink"><span class="block text-title">Evening, Acme Events\.<\/span> <span class="mt-2 block text-lg font-bold">14 things need you\.<\/span><\/h1>/,
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

  // Phase 23 (round 3, the approved mock-up): each a card (22px; glass since Phase 24), the
  // label, the number (`font-stat`), one line, and a tinted icon chip; no shadow, grain, tint or
  // lift. A plain link (it works without script: Next's <Link> would put its class first) to its
  // list, which once the page is ready opens in the panel instead.
  it("four count cards: urgent places, needs attention, waiting on others, sorted today", () => {
    const page = render(full, { payQueriesWaiting: 3 });
    expect(tiles(page)).toEqual([
      "Urgent places 3 Sat 7 and Sun 8 → #urgent-places",
      "Needs attention 11 1 booking to check, 1 change from your sheet and more → /office/needs-attention",
      "Waiting on others 3 Pay queries with payroll → #waited-chart",
      "Sorted today 20 2 cancellations, 18 enquiries → /office/cancellations?day=today",
    ]);
    // A role that can open Pay: to the pay queries (a resourcer's goes to the waiting chart).
    expect(tiles(render(full, { payQueriesWaiting: 3, pay: true }))[2]).toBe(
      "Waiting on others 3 Pay queries with payroll → /office/pay-queries",
    );
    expect(tiles(render(empty))).toEqual([
      "Urgent places 0 Every urgent place is filled → #urgent-places",
      "Needs attention 0 Nothing waiting for you → /office/needs-attention",
      "Waiting on others 0 Nothing waiting on others → #waited-chart",
      "Sorted today 0 0 cancellations, 0 enquiries → /office/cancellations?day=today",
    ]);
    // Label, then the number (the browser test reads it as the second span), then the line, then
    // the icon chip in its colour's tint.
    const cards = [
      ...page.matchAll(
        new RegExp(
          `<a href="[^"]*" class="${esc(CARD)}"><span class="([^"]*)">[^<]*</span><span class="([^"]*)">[^<]*</span><span class="([^"]*)">[^<]*</span><span aria-hidden="true" class="([^"]*)"><svg`,
          "g",
        ),
      ),
    ];
    expect(cards).toHaveLength(4);
    cards.forEach((m, i) => {
      expect(m[1]).toBe("col-start-1 row-start-1 self-center text-sm font-semibold text-ink-muted");
      expect(m[2]).toBe("col-span-2 row-start-2 font-stat text-4xl leading-none text-ink");
      expect(m[3]).toBe("col-span-2 row-start-3 text-sm text-ink-muted");
      expect(m[4]).toBe(
        `col-start-2 row-start-1 flex size-10 items-center justify-center rounded-row ${
          [
            "bg-urgent-tile text-urgent-ink",
            "bg-hivis text-on-hivis",
            "bg-wait-tile text-wait-ink",
            "bg-done-tile text-done-ink",
          ][i]
        }`,
      );
    });
    for (const cls of ["shadow", "grain", "tint-", "translate-y", "gradient"])
      expect(CARD).not.toContain(cls);
    // Each one's list: its panel's title.
    expect(
      modelOf(full, { payQueriesWaiting: 3, pay: true }).cards.map((c) => c.panel.title),
    ).toEqual([
      "3 urgent places to fill",
      "11 things need attention",
      "3 pay queries with payroll",
      "20 things sorted today",
    ]);
    expect(attentionText([])).toBe("Nothing waiting for you");
  });

  // The page's parts, in order (Phase 23): the urgent places, then the six charts in place of the
  // week strip and the three text panels; each heading's id where a link lands, and focus with it
  // from a panel (tabindex -1: focusable from code, never a Tab stop). The office's scroll padding
  // in globals.css keeps it clear of the top bar (office.dashboard-ui.test.ts pins it), so no
  // heading carries its own scroll margin.
  it("the urgent places, then six charts, each a glass card with its heading, its one sentence, its key, its chart, a hint and Numbers", () => {
    const html = render(full, { payQueriesWaiting: 3 });
    expect(
      [
        ...html.matchAll(
          /<h2 id="([^"]+)" tabindex="-1" class="text-lg font-bold tracking-heading (?:text-balance )?text-ink">([^<]*)<\/h2>/g,
        ),
      ].map((m) => [m[1], words(m[2] ?? "")]),
    ).toEqual([
      ["urgent-places", "Urgent places to fill"],
      ["places-chart", "Places to fill, next 2 weeks"],
      ["events-chart", "Which events need people"],
      ["offers-chart", "Offers this week"],
      ["waited-chart", "How long things have waited"],
      ["cancellations-chart", "Cancellations, last 2 weeks"],
      ["licences-chart", "Licences running out, next 8 weeks"],
    ]);
    // No other second-level heading on the page (the panel's is in its closed dialog).
    expect(html.match(/<h2\b/g)).toHaveLength(7);
    expect(html).not.toMatch(/scroll-mt-/);
    // Where a count card's own link lands shows for a moment (the urgent places' section, and a
    // chart's).
    expect(html).toContain(
      '<section aria-labelledby="urgent-places" class="flex min-w-0 flex-col gap-4 rounded-inner has-[:target]:animate-landed">',
    );
    expect(Object.values(CHART_TITLES)).toEqual([
      "Places to fill, next 2 weeks",
      "Which events need people",
      "Offers this week",
      "How long things have waited",
      "Cancellations, last 2 weeks",
      "Licences running out, next 8 weeks",
    ]);
    // Each chart's card, its one sentence written from the data.
    const take = (id: string) =>
      words(
        new RegExp(
          `<h2 id="${id}"[^>]*>[^<]*</h2><p class="mt-1 text-base text-ink-muted">([^<]*)</p>`,
        ).exec(html)?.[1] ?? "",
      );
    expect(Object.values(CHART_IDS).map(take)).toEqual([
      "Thursday needs 4 more people. 1 place in the next 2 weeks is hidden from casuals.",
      "Northern Lights Live needs 4 more people, 4 of them urgently. Casuals can't see Night patrols yet.",
      "5 offers went out this week. 3 haven't had a reply yet; the oldest went at 09:12 today.",
      "2 things for you have waited 2 or 3 days.",
      "3 cancellations in the last 2 weeks. 1 came with under 48 hours' notice.",
      "1 licence runs out in the next 30 days. Ben Example's runs out on Thu 5 Nov, and they're booked on Sat 7 Nov.",
    ]);
    for (const id of Object.values(CHART_IDS)) {
      const box = new RegExp(`<section aria-labelledby="${id}" class="([^"]*)">`).exec(html)?.[1];
      expect(box, id).toBe(
        `glass flex min-w-0 flex-col gap-4 rounded-inner p-4 has-[:target]:animate-landed sm:p-6${
          ["places-chart", "licences-chart"].includes(id) ? " xl:col-span-2" : ""
        }`,
      );
      const part = section(html, id);
      // Numbers: a toggle (aria-pressed), the chart's table hidden behind it; a hint.
      expect(part, id).toContain(
        '<button type="button" aria-pressed="false" class="press-glass glass-button inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold text-ink-muted hover:bg-button-hover hover:text-ink active:bg-button-press aria-pressed:lens aria-pressed:text-ink">Numbers</button>',
      );
      expect(part, id).toMatch(
        /<div hidden="" class="flex flex-col gap-4"><div class="glass overflow-x-auto rounded-inner"><table /,
      );
      expect(part, id).toMatch(
        /<p class="text-sm text-ink-faint">Pick an? [a-z ]+ to see [^<]+\.(<span|<\/p>)/,
      );
    }
    // The keys: a swatch and words for every colour (colour is never the only clue).
    const keys = (id: string) =>
      [
        ...section(html, id).matchAll(
          /<li class="inline-flex items-center gap-2">([\s\S]*?)<\/li>/g,
        ),
      ].map((m) => {
        const swatch = /class="size-3 shrink-0 (rounded-mark|rounded-full) (bg-mark-[a-z]+)"/.exec(
          m[1] ?? "",
        );
        return `${swatch ? `${swatch[2]} ` : m[1]?.includes("text-mark-done") ? "tick " : ""}${words(m[1] ?? "")}`;
      });
    expect(keys("places-chart")).toEqual([
      "bg-mark-urgent Urgent",
      "bg-mark-open To fill",
      "tick Every place filled",
    ]);
    expect(keys("events-chart")).toEqual(["bg-mark-urgent Urgent", "bg-mark-open To fill"]);
    expect(keys("waited-chart")).toEqual(["bg-mark-open Needs you"]);
    expect(keys("cancellations-chart")).toEqual([
      "bg-mark-urgent Under 48 hours' notice",
      "bg-mark-calm With notice",
    ]);
    expect(keys("licences-chart")).toEqual([
      "bg-mark-urgent Booked after it runs out",
      "bg-mark-open Runs out within 30 days",
      "bg-mark-calm Later",
    ]);
  });

  // In place of the week strip (Phases 18 to 22; its rules and links moved here): the next 14
  // days from today, each with sessions a button with its full name (its tooltip's words, the
  // value first), opening its sessions, the day's list and the rota board.
  it("places to fill: 14 days from today, each day with sessions a mark opening its sessions, the day's list and the rota board", () => {
    const html = render(full);
    const part = section(html, "places-chart");
    const cols = [
      ...part.matchAll(/<(button|span) (?:type="button" )?data-col="([^"]+)"([^>]*)>/g),
    ].map((m) => ({ tag: m[1], day: m[2], aria: /aria-label="([^"]*)"/.exec(m[3] ?? "")?.[1] }));
    expect(cols.map((c) => c.day)).toEqual(
      Array.from({ length: 14 }, (_, i) => `2026-11-${String(2 + i).padStart(2, "0")}`),
    );
    // Days with no sessions aren't buttons.
    expect(cols.filter((c) => c.tag === "button").map((c) => [c.day, c.aria])).toEqual([
      ["2026-11-03", "Every place filled. Tue 3 Nov: 4 of 4 places filled."],
      ["2026-11-04", "3 places to fill. Wed 4 Nov: 2 urgent, 3 of 6 places filled."],
      ["2026-11-05", "4 places to fill. Thu 5 Nov: 6 of 10 places filled."],
      ["2026-11-07", "2 places to fill. Sat 7 Nov: 2 urgent, 1 of 3 places filled."],
      [
        "2026-11-08",
        "1 place to fill. Sun 8 Nov: 1 urgent, 0 of 1 places filled, some hidden from casuals.",
      ],
    ]);
    // Each mark's tooltip says the same: the value, then what it is.
    const chart = modelOf(full).charts[0]!;
    if (chart.body?.kind !== "columns") throw new Error("columns");
    for (const col of chart.body.columns)
      if (col.mark) expect(col.mark.aria).toBe(`${col.mark.tip.value} ${col.mark.tip.label}`);
    // Today first, in a dark pill; a day with no sessions faint; Tuesday's tick.
    expect(part).toMatch(
      /<span class="hidden sm:block">Today<\/span><span class="rounded-full bg-ink px-2 text-sm font-bold text-on-ink">2<\/span>/,
    );
    expect(part).toMatch(
      /data-col="2026-11-03"[^>]*>[\s\S]*?<span class="absolute bottom-1 left-1\/2 -translate-x-1\/2 text-mark-done"><svg/,
    );
    expect(part.match(/text-mark-done"><svg/g)).toHaveLength(1);
    // Wednesday's panel: its sessions, the urgent one first, each with Offer; the day's list and
    // the rota board (this week's strip's day links).
    const wed = panelOf(chart, "places-chart:2026-11-04");
    expect(wed.title).toBe("Wed 4 Nov: 3 places to fill");
    expect(words(panelHtml(wed))).toContain(
      "Wed 4 Nov: 3 places to fill 3 of 6 places filled. 2 urgent.",
    );
    expect(rows(panelHtml(wed))).toEqual([
      "Door supervisor, Northern Lights Live Wed 4 Nov, 10:30–18:30 at Acme Demo Arena. 1 of 3 filled. Urgent Not offered yet Offer → /office/offer/g1",
      "Steward, Riverside Food Festival Wed 4 Nov, 10:00–18:00 at Riverside Demo Park. 3 of 4 filled. 2 waiting for a reply Offer → /office/offer/g2",
    ]);
    expect(links(panelHtml(wed)).map((l) => `${l.name} → ${l.href}`)).toEqual([
      "Door supervisor, Northern Lights Live → /office/shifts/g1",
      "Offer → /office/offer/g1",
      "Steward, Riverside Food Festival → /office/shifts/g2",
      "Offer → /office/offer/g2",
      "See this day's sessions → /office/shifts?from=2026-11-04",
      "Open the rota board → /office/events",
    ]);
    // An urgent place's Offer is the sky main button; the rest white.
    expect(panelHtml(wed)).toContain(`class="${btn.primary}" aria-describedby=`);
    // The hidden one can't be offered: no Offer, its page (with its switch) instead.
    const sun = panelHtml(panelOf(chart, "places-chart:2026-11-08"));
    expect(rows(sun)).toEqual([
      "Steward, Night patrols Sun 8 Nov, 18:00–23:00. 0 of 1 filled. Urgent Hidden from casuals Offers stopped → /office/shifts/u2",
    ]);
    // Today, with sessions ended earlier to mark: said so on the day, and its way to mark them.
    if (!full.needs.ok || !full.fill.ok) throw new Error("fixture");
    const marked: Dashboard = {
      ...full,
      fill: ok({
        ...full.fill.data,
        days: full.fill.data.days.map((d) =>
          d.date === "2026-11-02" ? { ...d, places: 4, filled: 4 } : d,
        ),
      }),
      needs: ok({
        ...full.needs.data,
        toMark: [{ ...full.needs.data.toMark[0]!, startsAt: at("2026-11-02T06:00:00Z") }],
      }),
    };
    const today = modelOf(marked).charts[0]!;
    if (today.body?.kind !== "columns") throw new Error("columns");
    expect(today.body.columns[0]!.mark?.aria).toBe(
      "Every place filled. Mon 2 Nov, today: 1 to mark, 4 of 4 places filled.",
    );
    expect(rows(panelHtml(panelOf(today, "places-chart:2026-11-02")))).toEqual([
      "Who worked? 1 session to mark 1 Mark who worked → /office/needs-attention#to-mark",
    ]);
    // The rota board stays a link on the card, whatever the days hold.
    expect(part).toContain(`<a class="${quietLink}" href="/office/events">Open the rota board</a>`);
    expect(section(render(empty), "places-chart")).toContain(
      `<a class="${quietLink}" href="/office/events">Open the rota board</a>`,
    );
  });

  it("every urgent place a card: its day, role, event and site, its chips, places filled, a wide Offer and the rest under …", () => {
    const html = render(full);
    const [first, second] = places(html);
    expect(places(html)).toHaveLength(2);
    expect(words(section(html, "urgent-places"))).toMatch(
      /^Urgent places to fill 2 All on Events & sessions/,
    );
    expect(section(html, "urgent-places")).toMatch(
      /<a class="[^"]*" href="\/office\/events\?view=urgent">All on Events &amp; sessions<svg/,
    );
    // Phase 23: one to a row on a phone, two from 1024px, three from 1280px; each a section of
    // glass (Phase 24; a white card in 23).
    expect(section(html, "urgent-places")).toContain(
      '<ul role="list" class="grid gap-3 lg:grid-cols-2 xl:grid-cols-3"><li data-urgent-place="" class="glass flex min-w-0 flex-col gap-4 rounded-inner p-4 sm:p-6">',
    );
    // Its day and times in an outlined chip (the day named in full for a screen reader).
    expect(first).toMatch(
      /^<p class="inline-flex min-h-7 w-fit items-center gap-2 rounded-full glass-button px-3 text-sm font-semibold text-ink-muted tabular-nums"><svg[\s\S]*?<\/svg><span role="img" aria-label="Saturday 7 November">Sat 7 Nov<\/span> · 06:00–14:00<\/p>/,
    );
    expect(words(first!)).toContain(
      "Sat 7 Nov · 06:00–14:00 Door supervisor Northern Lights Live, Acme Demo Arena Urgent Offered to 4 casuals 1 of 3 filled",
    );
    expect(first).toMatch(
      /<h3 class="text-2xl font-bold tracking-heading text-ink"><a class="underline-offset-4 hover:underline" href="\/office\/shifts\/u1">Door supervisor<\/a><\/h3>/,
    );
    // The places filled: a slim bar in its track (no groove), and the words.
    expect(first).toContain(
      '<span aria-hidden="true" class="block h-2 w-full overflow-hidden rounded-full border border-line bg-raised"><span class="block h-full rounded-full bg-accent-press" style="width:33%"></span></span><span class="text-sm text-ink-muted tabular-nums">1 of 3 filled</span>',
    );
    expect(first).not.toContain("data-seat");
    expect(words(first!)).not.toContain("Hidden from casuals");
    expect(words(first!)).not.toContain("The office was emailed about it.");
    // Its actions: "Offer", the wide main button (still named "Offer to someone"; its word
    // gives way to a spinner while the offer page opens: office.dashboard.spec.ts); "…" opens mark
    // as filled and not urgent, a menu that grows out of its button and floats.
    expect(first).toContain(
      `<a aria-label="Offer to someone" class="${btn.primary} flex-1" href="/office/offer/u1"><span class="relative inline-flex items-center justify-center"><span>Offer</span></span></a>`,
    );
    expect(btn.primary).toMatch(/ glass-tint /);
    expect(first!.replace(/&#x27;/g, "'")).toMatch(
      /<summary aria-label="More for Saturday's door supervisor at 06:00: mark as filled, not urgent" class="[^"]* press-glass glass-button inline-flex size-11 items-center justify-center rounded-full /,
    );
    const more =
      /<summary aria-label="More for[^"]*"[^>]*>[\s\S]*?<\/summary>([\s\S]*?)<\/details>\s*<\/div>/.exec(
        first!.replace(/&#x27;/g, "'"),
      )?.[1];
    expect(words(more ?? "")).toContain("Mark as filled");
    expect(words(more ?? "")).toContain("Not urgent");
    expect(more).toMatch(
      /^<div class="absolute [^"]* origin-top-left animate-pop [^"]*rounded-inner glass-float p-3 md:right-0 md:left-auto md:origin-top-right">/,
    );
    // The second: hidden, offers stopped, the office emailed.
    expect(words(second!)).toContain("Hidden from casuals: nobody can see this gap.");
    expect(words(second!)).toContain("Offers stopped: nobody else can take it.");
    expect(words(second!)).toContain("The office was emailed about it.");
    // None: said so, with the way to the events (inside the list's own part, so the confirmation
    // of marking the last one not urgent stays on screen).
    const calm = section(render(empty), "urgent-places");
    expect(words(calm)).toContain(
      "Every urgent place is filled. Nobody needs finding right now. See events",
    );
    expect(calm).toContain(
      '<div class="glass flex flex-wrap items-center gap-4 rounded-inner p-4 sm:p-6">',
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

  // The old Needs attention panel's rows (Phase 21), now in the Needs attention card's panel.
  it("Needs attention: a row per kind of thing that needs you, with its count and what to do, each to where it's dealt with", () => {
    const panel = card(full, "needs").panel;
    expect(rows(panelHtml(panel))).toEqual([
      "Bookings to check Booked, but can't work these shifts as things stand 1 Check them → /office/needs-attention#to-check",
      "From your rota sheet Changes your rota sheet asked for that the app couldn't do 1 See them → /office/needs-attention#from-sheet",
      "Who worked? 1 session on Sat 31 Oct to mark 1 Mark who worked → /office/needs-attention#to-mark",
      "Qualifications out of date on a booking A booked casual's qualification runs out before their shift 1 See them → /office/needs-attention#expired",
      "Uploads to check Photos and documents from casuals 2 Check → /office/casuals?view=uploads",
      "Strike evidence Strike records the strikes team hasn't had 2 See them → /office/needs-attention#evidence",
      "Your planner's change was refused Changes to booked sessions that weren't made 1 See them → /office/needs-attention#planner-refused",
      "Enquiries that need a person Messages and requests the shifts line couldn't answer 2 Answer → /office/enquiries",
    ]);
    // Its count is the menu's: every item, and the enquiries that need a person (and the waiting
    // chart's: what needs you, dated or not).
    expect(full.needs.ok && attentionCount(full.needs.data, 2)).toEqual({ count: 11, more: false });
    expect(full.waited.ok && full.waited.data.needsYouTotal).toBe(11);
    expect(panel.title).toBe("11 things need attention");
    expect(links(panelHtml(panel)).at(-1)).toEqual({
      href: "/office/needs-attention",
      name: "Open Needs attention",
    });
    // Each count a pill in Needs attention's amber; each action white, named by its row.
    expect(panelHtml(panel)).toContain(`<span class="${countNeeds}">1</span>`);
    expect(panelHtml(panel)).toMatch(
      new RegExp(
        `<a class="${esc(btn.secondary)}" aria-describedby="[^"]+" href="/office/needs-attention#to-check">Check them</a>`,
      ),
    );
    // A list stopped at 50 says so.
    if (!full.needs.ok) throw new Error("fixture");
    const many = card({ ...full, needs: ok({ ...full.needs.data, toCheckMore: true }) }, "needs");
    expect(rows(panelHtml(many.panel))[0]).toContain("as things stand 1+ Check them →");
    expect(many.panel.title).toBe("11+ things need attention");
    expect(many.value).toBe("11+");
    expect(words(panelHtml(many.panel))).toContain(
      "Some lists stop at 50, so more are waiting than shown.",
    );
    // A webhook failing: its row, to its part of the page.
    const hook = card(
      { ...full, needs: ok({ ...noNeeds, webhookFailing: { since: at("2026-11-02T03:10:00Z") } }) },
      "needs",
    );
    expect(rows(panelHtml(hook.panel))).toContain(
      "Your planner's webhook is failing Your planner isn't hearing about changes See it → /office/needs-attention#webhook",
    );
    // Nothing: said so.
    expect(words(panelHtml(card(empty, "needs").panel))).toContain(SECTIONS.needs.empty);
  });

  // The old "Waiting on others" and "Sorted today" panels (Phases 20 to 22), in their cards'
  // panels; cancellations are recorded, never approved or declined.
  it("Waiting on others (pay queries with payroll, or that nothing is); Sorted today: cancellations recorded, enquiries, what casuals can see", () => {
    if (!full.waited.ok) throw new Error("fixture");
    const withPay: Dashboard = {
      ...full,
      waited: ok({
        ...full.waited.data,
        pay: {
          total: 3,
          days: [{ day: "2026-10-26", count: 3 }],
          rows: [
            {
              payQueryId: "q1",
              workerId: "w9",
              casual: "Grace Lee",
              issue: "missing_hours",
              workDate: "2026-10-24",
              since: at("2026-10-26T09:47:00Z"),
              day: "2026-10-26",
              inDigest: false,
            },
          ],
          more: false,
        },
      }),
    };
    const waiting = card(withPay, "waiting", { payQueriesWaiting: 3, pay: true });
    expect(waiting.href).toBe("/office/pay-queries");
    expect(words(panelHtml(waiting.panel))).toBe(
      "3 pay queries with payroll Payroll gets them grouped in its digest. Nothing for you to do. Grace Lee: Hours missing For Sat 24 Oct. Sent 09:47 on Mon 26 Oct. With payroll Open the pay queries",
    );
    expect(links(panelHtml(waiting.panel))).toEqual([
      { href: "/office/pay-queries", name: "Open the pay queries" },
    ]);
    // A role that can't open Pay never has a pay query in the panel, nor a way to them.
    const theirs = card(withPay, "waiting", { payQueriesWaiting: 0 });
    expect(words(panelHtml(theirs.panel))).toBe(
      "Nothing is waiting on anyone else See how long things have waited",
    );
    expect(theirs.href).toBe("#waited-chart");
    expect(JSON.stringify(theirs)).not.toContain("Grace Lee");
    const sorted = card(full, "sorted");
    expect(rows(panelHtml(sorted.panel))).toEqual([
      "2 cancellations today 1 under 48 hours' notice, 1 strike issued. Recorded automatically, never approved or declined. → /office/cancellations?day=today",
      "18 enquiries today 16 answered automatically. 2 need a person. → /office/enquiries?day=today",
      "8 events showing to casuals 26 open places across 12 sessions → /office/events?view=showing",
    ]);
    expect(rows(panelHtml(card(empty, "sorted").panel))).toEqual([
      "0 cancellations today 0 under 48 hours' notice, 0 strikes issued. Recorded automatically, never approved or declined. → /office/cancellations?day=today",
      "0 enquiries today 0 answered automatically. None need a person. → /office/enquiries?day=today",
      "0 events showing to casuals 0 open places across 0 sessions → /office/events?view=showing",
    ]);
    // Cancellations are a record, never a request: nothing on the page or in any panel says
    // otherwise.
    for (const html of [
      render(full, { payQueriesWaiting: 3 }),
      ...allPanels(modelOf(withPay, { payQueriesWaiting: 3, pay: true })).map(panelHtml),
    ])
      expect(html).not.toMatch(/>(Approve|Decline|Deny)</);
  });

  it("a part that couldn't be read says so where it shows, the rest still shows, and nothing claims all is well", () => {
    const broken: Dashboard = {
      ...full,
      counts: { ...full.counts, urgent: failed, showing: failed, enquiries: failed },
      urgent: failed,
      needs: failed,
      fill: failed,
      eventsNeed: failed,
      offersWeek: failed,
      waited: failed,
      cancels14: failed,
      licences: failed,
    };
    const html = render(broken);
    // Not "Nothing needs you" or "Every urgent place is filled": it can't know.
    expect(h1s(html)).toEqual(["Evening, Acme Events. Some of the dashboard couldn't load."]);
    expect(words(html)).toContain("Reload the page to try again. What could load is below.");
    expect(words(html)).not.toMatch(/Every urgent place is filled|Nothing needs you/);
    expect(tiles(html).slice(0, 2)).toEqual([
      "Urgent places – Couldn't load → #urgent-places",
      "Needs attention – Couldn't load → /office/needs-attention",
    ]);
    expect(words(section(html, "urgent-places"))).toContain(SECTION_ERROR);
    // Each chart: "–" with the words, and the section's error; no chart, key or Numbers.
    for (const id of Object.values(CHART_IDS)) {
      const part = section(html, id);
      expect(words(part), id).toContain(`– ${COUNT_ERROR} ${SECTION_ERROR}`);
      expect(part, id).toContain('role="status"');
      expect(part, id).not.toContain("Numbers");
      expect(part, id).not.toContain("data-col");
    }
    // The panels say so too, drawn as a status line (the urgent places' and Needs attention's),
    // with the rows that could be worked out (the enquiries).
    const panels = modelOf(broken).cards;
    expect(panels.map((c) => c.key)).toEqual(["urgent", "needs", "waiting", "sorted"]);
    for (const p of [panels[0]!.panel, panels[1]!.panel]) {
      expect(p.error).toBe(SECTION_ERROR);
      expect(panelHtml(p)).toContain('role="status"');
      expect(words(panelHtml(p))).toContain(SECTION_ERROR);
      expect(notice(panelHtml(p))).toBe(SECTION_ERROR);
    }
    expect(rows(panelHtml(panels[3]!.panel))).toEqual([
      "2 cancellations today 1 under 48 hours' notice, 1 strike issued. Recorded automatically, never approved or declined. → /office/cancellations?day=today",
      "Enquiries today Couldn't load → /office/enquiries?day=today",
      "Events showing to casuals Couldn't load → /office/events?view=showing",
    ]);
    // Only Needs attention unread: what it could count is "at least" (the 3 urgent places and
    // the 2 enquiries), with the enquiries row.
    const part = render({ ...full, needs: failed });
    expect(h1s(part)).toEqual(["Evening, Acme Events. At least 5 things need you."]);
    const needs = card({ ...full, needs: failed }, "needs");
    expect(needs.panel.error).toBe(SECTION_ERROR);
    expect(panelHtml(needs.panel)).toContain('role="status"');
    expect(words(panelHtml(needs.panel))).toContain(SECTION_ERROR);
    expect(notice(panelHtml(needs.panel))).toBe(SECTION_ERROR);
    expect(rows(panelHtml(needs.panel))).toHaveLength(1);
    // The rest still shows: the other cards' panels, read, have no notice.
    for (const key of ["urgent", "waiting", "sorted"] as const) {
      const other = card({ ...full, needs: failed }, key).panel;
      expect(other.error, key).toBeNull();
      expect(notice(panelHtml(other)), key).toBeNull();
      expect(words(panelHtml(other)), key).not.toContain(SECTION_ERROR);
    }
    // A list stopped at 50: "at least" too.
    if (!full.needs.ok) throw new Error("fixture");
    expect(h1s(render({ ...full, needs: ok({ ...full.needs.data, toMarkMore: true }) }))).toEqual([
      "Evening, Acme Events. At least 14 things need you.",
    ]);
    // Nothing to draw: each chart says so in plain words.
    const calm = render(empty);
    expect(
      Object.values(CHART_IDS).map(
        (id) =>
          /<p class="rounded-row bg-raised px-4 py-6 text-center text-ink-muted">([^<]*)<\/p>/.exec(
            section(calm, id),
          )?.[1],
      ),
    ).toEqual([
      "No sessions in the next 2 weeks.",
      "No event needs people right now.",
      "No offers have gone out this week.",
      "Nothing is waiting.",
      "No cancellations in the last 2 weeks.",
      "No licences run out in the next 8 weeks.",
    ]);
  });

  // Phase 23 (the approved mock-up): flat bars, at most 24px thick, 4px round at the data end and
  // square at the baseline, a 2px gap of the card between a stack's parts, on a hairline grid with
  // its numbers in the faint ink; heights in style, colours only by token; a day chart 24px a
  // column on a laptop and 36px on a phone, where it scrolls inside its card (cancellations from
  // its end, today); nothing at rest has depth (Phase 22's grooves, stripes and raised rows gone).
  it("the charts' marks: flat bars on a hairline grid, scrolling inside their card on a phone", () => {
    const html = render(full, { payQueriesWaiting: 3 });
    const part = section(html, "cancellations-chart");
    // The cancellations' 14 narrow columns (half width) can't fit "Today" or "Wed": the weekday's
    // first letter over each date, today's too, in its dark date pill (the approved mock-up). The
    // places chart, full width, keeps "Today" and "Tue". Each mark's name says the full day.
    const tops = (h: string) =>
      [...h.matchAll(/<span class="hidden sm:block">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(tops(part).join(" ")).toBe("T W T F S S M T W T F S S M");
    expect(part).toContain(
      '<span class="hidden sm:block">M</span><span class="rounded-full bg-ink px-2 text-sm font-bold text-on-ink">2</span>',
    );
    expect(tops(section(html, "places-chart")).join(" ")).toBe(
      "Today Tue Wed Thu Fri Sat Sun Mon Tue Wed Thu Fri Sat Sun",
    );
    // Today's two parts: short notice at the baseline, the rest over it, 2px apart, round on top.
    expect(part).toContain(
      '<span class="relative flex h-full w-3/5 max-w-6 flex-col-reverse"><span style="height:50%" class="block w-full shrink-0 bg-mark-urgent transition-opacity duration-200"></span><span style="height:50%" class="block w-full shrink-0 bg-mark-calm border-b-2 border-transparent bg-clip-padding rounded-t-mark transition-opacity duration-200"></span>',
    );
    const segs = [
      ...html.matchAll(/<span style="(height|width):[^"]*" class="(block [^"]*)"><\/span>/g),
    ].map((m) => m[2]!);
    expect(segs.length).toBeGreaterThan(10);
    for (const s of segs)
      expect(s).toMatch(/(?<![\w-])bg-mark-(?:urgent|open|wait|done|calm)(?![\w-])/);
    // Only a size or a place in a style: never a colour.
    for (const m of html.matchAll(/style="([^"]*)"/g))
      expect(m[1]).toMatch(/^(?:(?:height|width|bottom|left|--n):[^;]+;?)+$/);
    // The grid: hairlines, the baseline, numbers in the faint ink.
    expect(part).toContain(
      'class="absolute top-6 right-0 bottom-0 left-8 border-b border-mark-base"',
    );
    expect(part).toMatch(
      /class="absolute inset-x-0 h-px bg-mark-grid" style="bottom:50%"><span class="absolute right-full bottom-0 mr-2 translate-y-1\/2 text-xs leading-none text-ink-faint tabular-nums">1<\/span>/,
    );
    // 36px a column on a phone, 24px from 640px, inside a card that scrolls sideways (the page
    // never does); the cancellations chart from its end.
    expect(part).toContain(
      '<div class="overflow-x-auto overscroll-x-contain" data-scroll-end=""><div style="--n:14" class="min-w-[calc(2rem_+_var(--n)_*_2.25rem)] sm:min-w-[calc(2rem_+_var(--n)_*_1.5rem)]">',
    );
    expect(section(html, "places-chart")).toContain(
      '<div class="overflow-x-auto overscroll-x-contain"><div style="--n:14" ',
    );
    // A mark: a button with its full name, saying it opens a panel; a slot's grey under the
    // pointer, rounded at the top.
    expect(part).toContain(
      '<button type="button" data-col="2026-11-02" aria-label="2 cancellations. Mon 2 Nov, today: 1 under 48 hours&#x27; notice." aria-haspopup="dialog" class="press relative flex min-w-0 flex-1 justify-center rounded-t-row hover:bg-raised">',
    );
    // Bars along (events): round at the end only.
    expect(section(html, "events-chart")).toContain(
      '<span style="width:100%" class="block h-full bg-mark-urgent rounded-r-mark transition-opacity duration-200"></span>',
    );
    // The licences' dots: the booking after it runs out bigger, in red, and named.
    expect(section(html, "licences-chart")).toContain(
      'aria-label="Runs out Thu 5 Nov. Ben Example, SIA door supervisor licence. Booked on Sat 7 Nov, after it runs out." aria-haspopup="dialog" style="left:5.357142857142857%;bottom:56px" class="press absolute flex size-11 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full"><span class="block rounded-full border-2 border-card size-5 bg-mark-urgent',
    );
    // The offers: one bar of three parts, each in words for a screen reader, and its key as three
    // numbers to pick.
    expect(section(html, "offers-chart")).toContain(
      '<div role="img" aria-label="1 said yes, 3 waiting for a reply, 1 said no or closed" class="flex h-6">',
    );
    expect(
      [
        ...section(html, "offers-chart").matchAll(/<button type="button" aria-label="([^"]*)"/g),
      ].map((m) => m[1]),
    ).toEqual([
      "1 of 5, 20%. Said yes.",
      "3 of 5, 60%. Waiting for a reply.",
      "1 of 5, 20%. Said no or closed.",
      "2 replies to come. Door supervisor, Northern Lights Live, Sat 7 Nov, 06:00–14:00.",
      "1 reply to come. Steward, Riverside Food Festival, Wed 4 Nov, 10:00–18:00.",
    ]);
    // Nothing at rest has a shadow class, grain, stripes or a groove (Phase 24: the glass draws its
    // own rim and drop); what floats is floating glass (the panel, each "…" menu), and the solid
    // ink tooltip keeps the one overlay.
    const classes = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]!);
    for (const c of classes) {
      expect(c).not.toMatch(/(?<![\w-])(?:inset-)?shadow-(?!float(?![\w-]))/);
      expect(c).not.toMatch(/(?<![\w-])(?:grain|grain-soft|stripes|tint-\w+)(?![\w-])/);
      expect(c).not.toMatch(/hover:-?translate-y/);
    }
    const floats = classes.filter((c) => /(?<![\w-])shadow-float(?![\w-])/.test(c));
    expect(floats).toEqual([
      // The tooltip takes the pointer (WCAG 1.4.13: you can move onto it). Its bridge is its own
      // box plus 8px on the side facing its mark: above, below, left or right.
      expect.stringMatching(
        /^fixed top-0 left-0 z-50 w-max max-w-64 animate-pop rounded-row bg-ink px-3 py-2 text-sm text-on-ink shadow-float before:absolute before:inset-0 data-\[side=above\]:before:-bottom-2 data-\[side=below\]:before:-top-2 data-\[side=left\]:before:-right-2 data-\[side=right\]:before:-left-2$/,
      ),
    ]);
    const glassFloats = classes.filter((c) => /(?<![\w-])glass-float(?![\w-])/.test(c));
    expect(glassFloats).toEqual([
      expect.stringMatching(/^absolute top-full left-0 z-10 mt-2 flex w-64 /),
      expect.stringMatching(/^absolute top-full left-0 z-10 mt-2 flex w-64 /),
      expect.stringMatching(/^top-auto bottom-0 left-0 m-0 h-auto max-h-\[86dvh\] w-full /),
    ]);
    expect(btn.secondary).not.toMatch(/shadow/);
  });

  // Phase 23: the rows behind a mark, in a native dialog (a side panel from 1024px, a sheet from
  // the foot on a phone; office.dashboard.spec.ts opens and closes it): its title, a line, the rows
  // with their chips and actions, "Showing the first 50." when there were more, and the ways on.
  it("the panel: a modal dialog labelled by its title; rows with their chips and actions; every old dashboard link still there", () => {
    const html = render(full, { payQueriesWaiting: 3, pay: true });
    expect(html).toMatch(
      /<dialog aria-modal="true" aria-labelledby="chart-panel-title" class="[^"]*rounded-t-inner glass-float p-0 [^"]*starting:translate-y-full lg:top-0 lg:right-0 lg:left-auto lg:h-dvh lg:max-h-none lg:w-\[30rem\] [^"]*lg:starting:translate-x-full lg:starting:translate-y-0"><\/dialog>/,
    );
    // Its insides: the title (the dialog's name), Close, then the rows.
    const panel = panelHtml(card(full, "urgent").panel);
    expect(panel).toMatch(
      /<h2 id="chart-panel-title" class="text-2xl font-extrabold tracking-heading text-ink">3 urgent places to fill<\/h2>/,
    );
    expect(panel).toContain(
      '<button type="button" aria-label="Close" class="press-glass glass-button inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press">',
    );
    expect(panel).toMatch(
      /<ul role="list" aria-label="3 urgent places to fill" class="divide-y divide-line">/,
    );
    expect(rows(panel)).toEqual([
      "Door supervisor Sat 7 Nov, 06:00–14:00. Northern Lights Live, Acme Demo Arena. 1 of 3 filled. Urgent Offered to 4 casuals Offer → /office/offer/u1",
      "Steward Sun 8 Nov, 18:00–23:00. Night patrols. 0 of 1 filled. Urgent Hidden from casuals Offers stopped: nobody else can take it. → /office/shifts/u2",
    ]);
    // Capped at 50: said so.
    if (!full.offersWeek.ok) throw new Error("fixture");
    const capped = modelOf({
      ...full,
      offersWeek: ok({
        ...full.offersWeek.data,
        counts: { yes: 80, waiting: 3, closed: 1 },
        rows: {
          ...full.offersWeek.data.rows,
          yes: Array.from({ length: 50 }, (_, i) => offer({ offerId: `y${i}`, state: "yes" })),
        },
        more: { yes: true, waiting: false, closed: false },
      }),
    }).charts[2]!;
    const yes = panelHtml(panelOf(capped, "offers-chart:yes"));
    expect(rows(yes)).toHaveLength(50);
    expect(words(yes)).toContain("Showing the first 50.");
    // An offer row is titled with the casual, so its link names where it goes: the session.
    const toSession = links(yes).filter((l) => l.href === "/office/shifts/u1");
    expect(toSession).toHaveLength(50);
    expect([...new Set(toSession.map((l) => l.name))]).toEqual(["Open the session"]);
    // Every link the old dashboard's week strip and panels had (Phases 18 to 22) is still on the
    // page or in a panel.
    const everything = [
      html,
      ...allPanels(modelOf(full, { payQueriesWaiting: 3, pay: true })).map(panelHtml),
    ];
    const hrefs = new Set(everything.flatMap((h) => links(h).map((l) => l.href)));
    for (const href of [
      "/office/shifts?from=2026-11-04",
      "/office/needs-attention#to-check",
      "/office/needs-attention#from-sheet",
      "/office/needs-attention#to-mark",
      "/office/needs-attention#expired",
      "/office/needs-attention#evidence",
      "/office/needs-attention#planner-refused",
      "/office/needs-attention",
      "/office/casuals?view=uploads",
      "/office/enquiries",
      "/office/pay-queries",
      "/office/cancellations?day=today",
      "/office/enquiries?day=today",
      "/office/events?view=showing",
      "/office/events?view=urgent",
      "/office/events",
    ])
      expect(hrefs, href).toContain(href);
    expect(everything.map(words).join(" ")).toContain(
      "Recorded automatically, never approved or declined.",
    );
    // And the new ways in: an event, the events that need people, a cancellation's record, a
    // casual's record and a booking.
    for (const href of [
      "/office/events/e1",
      "/office/events?view=need",
      "/office/cancellations/A1B2C3D4",
      "/office/casuals/w5",
      "/office/shifts/x-shift",
      "/office/offer/u1",
      "/office/reports/notice?kind=offers&from=2026-11-02&to=2026-11-02",
    ])
      expect(hrefs, href).toContain(href);
  });

  it('an urgent place nobody\'s been offered says "Not offered yet" in amber; the count beside the heading is red', () => {
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
    // Phase 23: a tinted chip (words and icon, never colour alone), after the red "Urgent".
    expect(words(place!)).toContain("Urgent Not offered yet");
    expect(place).toContain(`<span class="${chip.base} ${chip.attention}"><svg`);
    // One that was offered: in the blue of waiting on someone else.
    expect(places(render(full))[0]).toContain(`<span class="${chip.base} ${chip.wait}"><svg`);
    // The office's one count pill; red only for the urgent places.
    expect(section(render(full), "urgent-places")).toContain(
      `<span class="${countUrgent}">2</span>`,
    );
    expect(
      countUrgent.replace("bg-urgent-tile text-urgent-ink", "glass-button text-ink-muted"),
    ).toBe(count);
  });

  it("Waiting on others couldn't be read: its card and panel say so, the rest still shows", () => {
    const html = render(full, { payQueriesWaiting: null });
    expect(tiles(html)[2]).toBe("Waiting on others – Couldn't load → #waited-chart");
    const panel = card(full, "waiting", { payQueriesWaiting: null }).panel;
    expect(panel.error).toBe(SECTION_ERROR);
    expect(panelHtml(panel)).toContain('role="status"');
    expect(words(panelHtml(panel))).toContain(SECTION_ERROR);
    expect(notice(panelHtml(panel))).toBe(SECTION_ERROR);
    expect(words(panelHtml(panel))).not.toContain("Nothing is waiting on anyone else");
    expect(rows(panelHtml(panel))).toEqual([]);
    // The rest still shows: Needs attention's panel (and the others) with their rows, no notice.
    const needs = card(full, "needs", { payQueriesWaiting: null }).panel;
    expect(needs.error).toBeNull();
    expect(rows(panelHtml(needs)).length).toBeGreaterThan(0);
    for (const key of ["urgent", "needs", "sorted"] as const) {
      const other = card(full, key, { payQueriesWaiting: null }).panel;
      expect(other.error, key).toBeNull();
      expect(notice(panelHtml(other)), key).toBeNull();
      expect(words(panelHtml(other)), key).not.toContain(SECTION_ERROR);
    }
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

  it("no dashboard link repeats a menu link's name, on the page or in a panel", () => {
    const menu = officeMenu("admin").flatMap((g) => g.links.map((l) => l.label));
    expect(menu).toContain("Dashboard");
    expect(menu).toContain("Needs attention");
    const o = { payQueriesWaiting: 2, pay: true };
    const names = [render(full, o), ...allPanels(modelOf(full, o)).map(panelHtml)].flatMap((h) =>
      links(h).map((l) => l.name),
    );
    expect(names.length).toBeGreaterThan(40);
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
