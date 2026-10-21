import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { officeMenu } from "@/app/office/office-menu";
import type { Dashboard, NeedsAttention } from "@/lib/office/dashboard";
import { needsCount } from "@/lib/office/dashboard";
import {
  bellLabel,
  cancelledByText,
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
const { NeedsItems } = await import("@/app/office/needs-items");
const { focusItems } = await import("@/lib/office/dashboard-home");

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
  o: { isAdmin?: boolean; shiftsLine?: string; payQueriesWaiting?: number } = {},
) =>
  renderToStaticMarkup(
    createElement(DashboardContent, {
      d,
      shiftsLine: o.shiftsLine,
      payQueriesWaiting: o.payQueriesWaiting ?? 0,
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
    // Each refused session is one of the bell's items; a list stopped at 50 shows "50+".
    expect(needsCount({ ...noNeeds, plannerRefused: [p, p], plannerRefusedMore: true })).toEqual({
      count: 2,
      more: true,
    });
    expect(bellLabel(3, false)).toBe("Needs attention, 3");
    expect(bellLabel(50, true)).toBe("Needs attention, 50+");
    expect(bellLabel(null, false)).toBe("Needs attention");
  });
});

describe("the page (Phase 18's dashboard)", () => {
  const h1s = (html: string) =>
    [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => words(m[1] ?? ""));
  // The rows of a list of rows ("After that", "Waiting on others", "Sorted today").
  const rows = (html: string, label: string) => {
    const list =
      new RegExp(`<ul role="list" aria-label="${label}"[^>]*>([\\s\\S]*?)</ul>`).exec(html)?.[1] ??
      "";
    return links(list).map((l) => `${l.name} → ${l.href}`);
  };

  it("the headline: how many things need you (the urgent places as one, then each row after them), and where to start", () => {
    const html = render(full, { shiftsLine: "Shifts line 07700 900123" });
    expect(h1s(html)).toEqual(["9 things need you"]);
    expect(words(html)).toContain(
      "9 things need you Start with the urgent places. Casuals see these first and get an alert. Shifts line 07700 900123",
    );
    // Only urgent places: one thing.
    const onlyUrgent = render({
      ...full,
      needs: ok(noNeeds),
      counts: { ...full.counts, enquiries: ok({ total: 0, automatic: 0, needPerson: 0 }) },
    });
    expect(h1s(onlyUrgent)).toEqual(["1 thing needs you"]);
    // Nothing urgent, other things: sorted first.
    const noUrgent = render({ ...full, urgent: ok({ events: [], more: false }) });
    expect(h1s(noUrgent)).toEqual(["8 things need you"]);
    expect(words(noUrgent)).toContain("Urgent places are sorted. The rest is below.");
    // Nothing at all.
    const calm = render(empty);
    expect(h1s(calm)).toEqual(["Nothing needs you right now"]);
    expect(words(calm)).toContain(
      "Every urgent place is filled, and nothing else is waiting for you.",
    );
  });

  it("this week: seven days, each a link to its shifts (or to the sessions to mark), how full, its urgent gaps", () => {
    const nav = /<nav aria-label="This week">([\s\S]*?)<\/nav>/.exec(render(full))?.[1] ?? "";
    const days = [
      ...nav.matchAll(/<a aria-label="([^"]*)" class="([^"]*)" href="([^"]*)">([\s\S]*?)<\/a>/g),
    ].map((m) => ({ label: m[1], cls: m[2] ?? "", href: m[3], shown: words(m[4] ?? "") }));
    expect(days.map((d) => [d.href, d.label])).toEqual([
      ["/office/shifts?from=2026-11-02", "Mon 2 Nov, today: Nothing on"],
      ["/office/shifts?from=2026-11-03", "Tue 3 Nov: All filled, 4 of 4 places filled"],
      ["/office/shifts?from=2026-11-04", "Wed 4 Nov: 2 urgent, 3 open, 3 of 6 places filled"],
      ["/office/shifts?from=2026-11-05", "Thu 5 Nov: 4 open, 6 of 10 places filled"],
      ["/office/shifts?from=2026-11-06", "Fri 6 Nov: Nothing on"],
      ["/office/shifts?from=2026-11-07", "Sat 7 Nov: 2 urgent, 1 of 3 places filled"],
      ["/office/shifts?from=2026-11-08", "Sun 8 Nov: Nothing on"],
    ]);
    expect(days.map((d) => d.shown)).toEqual([
      "2 Today Nothing on",
      "3 Tue All filled",
      "4 Wed 2 urgent 3 open",
      "5 Thu 4 open",
      "6 Fri Nothing on",
      "7 Sat 2 urgent",
      "8 Sun Nothing on",
    ]);
    // Today marked by a bar along its top; a day with urgent gaps on the red tint.
    expect(days[0]?.cls).toContain("border-t-ink");
    expect(days.filter((d) => d.cls.includes("bg-urgent-soft")).map((d) => d.href)).toEqual([
      "/office/shifts?from=2026-11-04",
      "/office/shifts?from=2026-11-07",
    ]);
    // Later in the week: a day gone by with sessions to mark goes to them, on a sign-yellow plate.
    if (!full.needs.ok) throw new Error("fixture");
    const thursday: Dashboard = {
      ...full,
      today: "2026-11-05",
      needs: ok({
        ...full.needs.data,
        toMark: [{ ...full.needs.data.toMark[0]!, startsAt: at("2026-11-03T10:00:00Z") }],
      }),
    };
    const later = /<nav aria-label="This week">([\s\S]*?)<\/nav>/.exec(render(thursday))?.[1] ?? "";
    expect(later).toMatch(
      /aria-label="Tue 3 Nov: 1 to mark, 4 of 4 places filled"[^>]*href="\/office\/needs-attention#to-mark"/,
    );
    expect(later).toMatch(/bg-hivis text-on-hivis[^"]*">1 to mark</);
    expect(later).toContain('aria-label="Thu 5 Nov, today: 4 open, 6 of 10 places filled"');
  });

  it("Next up: one urgent place at a time, its seats, who it was offered to and its actions, then the way to them all", () => {
    const html = render(full);
    const next = section(html, "next-up");
    const card = /<article[^>]*data-focus=""[^>]*>([\s\S]*?)<\/article>/.exec(next)?.[1] ?? "";
    expect(words(card)).toContain("Urgent place to fill 1 of 2");
    expect(card).toContain('aria-label="Previous urgent place"');
    expect(card).toContain('aria-label="Next urgent place"');
    expect(card).toContain('role="img" aria-label="Saturday 7 November"');
    expect(words(card)).toContain(
      "06:00–14:00 Door supervisor Northern Lights Live, Acme Demo Arena",
    );
    expect(card).toMatch(/href="\/office\/shifts\/u1"/);
    expect(card.match(/data-seat="taken"/g)).toHaveLength(1);
    expect(card.match(/data-seat="free"/g)).toHaveLength(2);
    expect(words(card)).toContain("2 of 3 places free");
    expect(words(card)).toContain("Offered to 4 casuals");
    expect(words(card)).not.toContain("Hidden from casuals");
    expect(words(card)).not.toContain("The office was emailed about it.");
    // Its actions: offer it (the main one), mark it as filled, not urgent.
    expect(card).toMatch(/<a class="[^"]*" href="\/office\/offer\/u1">Offer to someone<\/a>/);
    expect(words(card)).toContain("Mark as filled");
    expect(words(card)).toContain("Not urgent");
    expect(links(next).at(-1)).toEqual({
      href: "/office/events?view=urgent",
      name: "All urgent places on Events & sessions",
    });
    // None: said so, with the way to the events.
    const calm = section(render(empty), "next-up");
    expect(words(calm)).toContain(
      "Every urgent place is filled. Nobody needs finding right now. See events",
    );
    expect(calm).not.toContain("data-focus");
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
      "next-up",
    );
    expect(words(card)).toContain("Urgent place to fill 1 of 1");
    expect(words(card)).toContain("Hidden from casuals: nobody can see this gap.");
    expect(words(card)).toContain("Offers stopped: nobody else can take it.");
    expect(words(card)).toContain("The office was emailed about it.");
    expect(card).not.toContain('aria-label="Next urgent place"');
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
  });

  it("After that: a row per kind of thing that needs you, with its count, each to where it's dealt with", () => {
    expect(rows(render(full, { isAdmin: true }), "After that")).toEqual([
      "Bookings to check Booked, but can't work these shifts as things stand 1 → /office/needs-attention#to-check",
      "From your rota sheet Changes your rota sheet asked for that the app couldn't do 1 → /office/needs-attention#from-sheet",
      "Who worked? 1 session on Sat 31 Oct to mark 1 → /office/needs-attention#to-mark",
      "Qualifications out of date on a booking A booked casual's qualification runs out before their shift 1 → /office/needs-attention#expired",
      "Uploads to check Photos and documents from casuals 2 → /office/casuals?view=uploads",
      "Strike evidence Strike records the strikes team hasn't had 2 → /office/needs-attention#evidence",
      "Your planner's change was refused Changes to booked sessions that weren't made 1 → /office/needs-attention#planner-refused",
      "Enquiries that need a person Messages and requests the shifts line couldn't answer 2 → /office/enquiries",
    ]);
    // The bell (→ Needs attention's page) counts every item, as the page lists them.
    expect(full.needs.ok && needsCount(full.needs.data)).toEqual({ count: 9, more: false });
    // A list stopped at 50 says so.
    if (!full.needs.ok) throw new Error("fixture");
    const many = render({ ...full, needs: ok({ ...full.needs.data, toCheckMore: true }) });
    expect(rows(many, "After that")[0]).toContain("as things stand 1+ →");
    // Nothing: said so.
    const calm = section(render(empty), "after-that");
    expect(words(calm)).toContain(SECTIONS.needs.empty);
  });

  it("Waiting on others (pay queries with payroll, when there are some); Sorted today: cancellations recorded, enquiries, what casuals can see", () => {
    const html = render(full, { payQueriesWaiting: 3 });
    expect(rows(html, "Waiting on others")).toEqual([
      "Pay queries With payroll, nothing for you to do 3 → /office/pay-queries",
    ]);
    expect(render(full)).not.toContain("Waiting on others");
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
      counts: { ...full.counts, showing: failed, enquiries: failed },
      urgent: failed,
      needs: failed,
      week: failed,
    };
    const html = render(broken);
    // Not "Nothing needs you" or "Every urgent place is filled": it can't know.
    expect(h1s(html)).toEqual(["Some of the dashboard couldn't load"]);
    expect(words(html)).toContain("Reload the page to try again. What could load is below.");
    expect(words(html)).not.toMatch(/Every urgent place is filled|Nothing needs you/);
    expect(words(section(html, "next-up"))).toContain(SECTION_ERROR);
    expect(words(section(html, "after-that"))).toContain(SECTION_ERROR);
    expect(html).not.toContain('<nav aria-label="This week">');
    expect(words(html)).toContain(SECTION_ERROR);
    expect(rows(html, "Sorted today")).toEqual([
      "2 cancellations today 1 under 48 hours' notice, 1 strike issued. Recorded automatically, never approved or declined. → /office/cancellations?day=today",
      "Enquiries today Couldn't load → /office/enquiries?day=today",
      "Events showing to casuals Couldn't load → /office/events?view=showing",
    ]);
    // Only Needs attention unread: what it could count is "at least", with the enquiries row.
    const part = render({ ...full, needs: failed });
    expect(h1s(part)).toEqual(["At least 2 things need you"]);
    expect(words(section(part, "after-that"))).toContain(SECTION_ERROR);
    expect(rows(part, "After that")).toHaveLength(1);
  });

  it("no dashboard link repeats a menu link's name", () => {
    const menu = officeMenu("admin").flatMap((g) => g.links.map((l) => l.label));
    expect(menu).toContain("Dashboard");
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

  it("nothing: says so", () => {
    const calm = renderToStaticMarkup(
      createElement(NeedsItems, { n: noNeeds, timeZone: TZ, today: full.today, isAdmin: true }),
    );
    expect(words(calm)).toContain(SECTIONS.needs.empty);
  });
});
