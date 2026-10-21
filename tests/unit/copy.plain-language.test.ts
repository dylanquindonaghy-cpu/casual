import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { REJECT_REASONS as REJECT_REASON_LIST } from "@/lib/db/schema";
import { statusLabel } from "@/lib/portal/qualification-copy";
import {
  CARD_GUIDANCE,
  PHOTO_GUIDANCE,
  PHOTO_WORDS,
  sendUploadText,
  type SendUploadOutcome,
} from "@/lib/portal/upload-copy";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import type { ShiftFacts } from "@/lib/portal/shift-facts";
import { REASONS } from "@/lib/rules/reasons";
import { shiftsStrip } from "@/lib/portal/shifts-strip";
import { EVERY_LEVEL, EVERY_STATUS } from "../helpers/qualifications";

// Copy is product (golden rule 11; docs/screens.md copy rules): every staff screen, in every
// empty, error and answer state, in plain words. This renders them all and fails on jargon, raw
// codes, "undefined"/"null" in the text, and sentences over 25 words. A new screen or state
// belongs in SCREENS below.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/",
}));

const { BookedView } = await import("@/app/shifts/booked-view");
const { HomeView } = await import("@/app/home-view");
const { OpenShiftsView } = await import("@/app/shifts/open/open-shifts-view");
const { UrgentView } = await import("@/app/urgent/urgent-view");
const { TakeShiftResult } = await import("@/app/shifts/open/take-shift-result");
const { ShiftView } = await import("@/app/shifts/[id]/shift-view");
const { ReviewResult } = await import("@/app/shifts/[id]/review-form");
const { CancelShiftResult } = await import("@/app/shifts/cancel-shift-result");
const { RequestsList } = await import("@/app/requests/requests-list");
const { RequestResult } = await import("@/app/requests/request-result");
const { RequestForm } = await import("@/app/requests/new/request-form");
const { PayView } = await import("@/app/pay/pay-view");
const { CodeGate } = await import("@/app/pay/code-gate");
const { ProfileView } = await import("@/app/profile/profile-view");
const { say } = await import("@/app/profile/availability-form");
const { savedText } = await import("@/app/profile/notification-form");
const { LoginForm } = await import("@/app/login/login-form");
const { TooManyTries } = await import("@/app/too-many-tries");
const { default: NotFound } = await import("@/app/not-found");
const { default: ErrorPage } = await import("@/app/error");
const { ErrorBody } = await import("@/app/error-body");
const { default: GlobalError } = await import("@/app/global-error");
const { tryAgainText } = await import("@/lib/portal/copy");
const { PushSetting } = await import("@/app/profile/push-setting");
const { PushSettingView } = await import("@/app/profile/push-setting-view");
import { postcodeAttribution } from "@/lib/travel/attribution";
const { HelpView } = await import("@/app/help/help-view");
// The firm's own strike and photo numbers the help page states (12H.3).
// A firm with travel areas on: every help section shows.
const HELP_FACTS = { noticeHours: 48, liveDays: 90, photoRenewalMonths: 36, travelOn: true };

// Words a worker shouldn't have to know. Whole words, any case.
const JARGON = [
  "error",
  "errors",
  "invalid",
  "exception",
  "session",
  "token",
  "tenant",
  "roster",
  "plug",
  "credential",
  "credentials",
  "eligible",
  "eligibility",
  "assignment",
  "payload",
  "server",
  "database",
  "unauthorized",
  "forbidden",
  "404",
  "500",
  "null",
  "undefined",
  "nan",
];
const MAX_WORDS = 25;

const text = (html: string) =>
  html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, " ")
    .replace(/<\/(p|h1|h2|h3|li|button|a|label|legend|option|span|div)>/g, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

function problems(words: string): string[] {
  const found: string[] = [];
  for (const word of JARGON) {
    if (new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, "i").test(words))
      found.push(`jargon: ${word}`);
  }
  const code = words.match(/\b[a-z]+_[a-z_]+\b/);
  if (code) found.push(`raw code: ${code[0]}`);
  if (words.includes("[object")) found.push("an object printed as text");
  for (const sentence of words.split(/(?<=[.!?:])\s+/)) {
    const count = sentence.split(/\s+/).filter((w) => /[a-z0-9£]/i.test(w)).length;
    if (count > MAX_WORDS) found.push(`long sentence (${count} words): ${sentence.trim()}`);
  }
  return found;
}

const TZ = "Europe/London";
const NOW = new Date("2026-11-02T09:00:00Z");
const site = {
  name: "Demo Arena",
  addressLine1: "1 Test Road",
  addressLine2: null,
  town: "Leeds",
  postcode: "LS1 1AA",
};
const booked: MyShift = {
  assignmentId: "22222222-2222-4222-8222-222222222222",
  shiftId: "11111111-1111-4111-8111-111111111111",
  role: "door_supervisor",
  startsAt: new Date("2026-11-07T14:00:00Z"),
  endsAt: new Date("2026-11-07T22:00:00Z"),
  status: "confirmed",
  instructions: "Meet at gate C.",
  site,
};
const summary: ShiftSummary = {
  shiftId: booked.shiftId,
  role: "door_supervisor",
  startsAt: booked.startsAt,
  endsAt: booked.endsAt,
  placesLeft: 2,
  site,
};
const voice = { name: "Acme Events", signOff: "Acme Events Shift Team" };
const signOff = voice.signOff;
const everyReason = [
  REASONS.started(),
  REASONS.not_active(),
  REASONS.wrong_role("close_protection_officer"),
  REASONS.no_rule(),
  REASONS.credential_missing("SIA door supervisor licence"),
  REASONS.credential_expired("SIA door supervisor licence", "3 Oct", true),
  REASONS.credential_expired("SIA door supervisor licence", "3 Dec", false),
  REASONS.credential_marked_expired("SIA door supervisor licence"),
  REASONS.credential_suspended("SIA door supervisor licence"),
  REASONS.applied_not_allowed("SIA door supervisor licence"),
  REASONS.applied_over_allowance("SIA door supervisor licence"),
  REASONS.overlap("14:00", "Sat 7 Nov"),
  REASONS.overlap("14:00", null),
  REASONS.travel("14:00"),
  REASONS.rest("previous", 11),
  REASONS.weekly_hours(),
  REASONS.unavailable(),
  REASONS.blocked_site(),
];
// The page in full (12H.2), with a requirement in every status and every way of getting there.
const requirementIn = (
  status: ShiftFacts["requirements"][number]["status"],
  uploadable = true,
): ShiftFacts["requirements"][number] => ({
  code: `T_${status.status.toUpperCase()}_${uploadable ? "U" : "O"}`,
  name: "SIA door supervisor licence",
  chip: "SIA DS",
  status,
  uploadable,
});
const pageFacts = (travel: ShiftFacts["travel"]): ShiftFacts => ({
  eventName: "Riverside Festival",
  payRatePence: 1550,
  post: "Gate A",
  meetingPoint: "Staff entrance",
  uniform: "Black trousers",
  isUrgent: true,
  headcount: 4,
  travel,
  requirements: [
    requirementIn({ status: "valid", expiresOn: "2027-03-03", renewing: false }),
    requirementIn({ status: "valid", expiresOn: null, renewing: false }),
    requirementIn({ status: "expiring_soon", expiresOn: "2026-11-05", renewing: false }),
    requirementIn({ status: "expiring_soon", expiresOn: "2026-11-05", renewing: false }, false),
    requirementIn({ status: "expiring_soon", expiresOn: "2026-11-05", renewing: true }),
    requirementIn({ status: "being_checked", expiresOn: null, renewing: false }),
    requirementIn({ status: "applied", expiresOn: null, renewing: false }),
    requirementIn({ status: "missing", expiresOn: null, renewing: false }),
    requirementIn({ status: "missing", expiresOn: null, renewing: false }, false),
    requirementIn({ status: "expired", expiresOn: "2026-10-01", renewing: false }),
    requirementIn({ status: "expired", expiresOn: null, renewing: false }, false),
    requirementIn({ status: "rejected", expiresOn: null, renewing: false }),
    requirementIn({ status: "suspended", expiresOn: null, renewing: false }),
  ],
  noticeHours: 48,
  lastDay: "2026-11-07",
});
const arriveBy = new Date("2026-11-07T13:30:00Z");
const facts = pageFacts({
  kind: "estimated",
  straightMetres: 4000,
  arriveBy,
  car: { minutes: 12, metres: 5000 },
  publicTransport: { minutes: 24 },
});
const shiftPages: ShiftPage[] = [
  { state: "missing" },
  { state: "booked", shift: booked, facts },
  { state: "open", shift: summary, facts },
  {
    state: "open",
    shift: summary,
    facts: pageFacts({
      kind: "estimated",
      straightMetres: 4000,
      arriveBy,
      car: null,
      publicTransport: null,
    }),
  },
  { state: "open", shift: summary, facts: pageFacts({ kind: "straight", straightMetres: 11000 }) },
  { state: "open", shift: summary, facts: pageFacts({ kind: "unknown" }) },
  { state: "held", shift: summary, facts, opensAt: new Date("2026-11-02T09:15:00Z") },
  { state: "blocked", shift: summary, facts, reasons: everyReason, review: null },
  {
    state: "blocked",
    shift: summary,
    facts,
    reasons: everyReason.slice(0, 1),
    review: { ref: "3F2A9C1B", askedAt: NOW },
  },
  { state: "filled", shift: summary },
  { state: "started", shift: summary },
  { state: "cancelled", shift: summary },
];
const myShifts = (o: Partial<Parameters<typeof BookedView>[0]>) =>
  createElement(BookedView, {
    timeZone: TZ,
    now: NOW,
    view: "upcoming",
    shifts: [],
    ...o,
  });
const openList = (o: Partial<Parameters<typeof OpenShiftsView>[0]["list"]> = {}) => ({
  shifts: [],
  truncated: false,
  offerAlerts: true,
  travelOn: true,
  area: { maxMinutes: 45 },
  further: { count: 0, atLeast: false },
  choices: { days: [], sites: [], roles: [] },
  ...o,
});
// Home (12H.1): her next shift, Needs updating, urgent shifts and the shifts she can apply for.
const homeScreen = (o: Partial<Parameters<typeof HomeView>[0]>) =>
  createElement(HomeView, {
    firstName: "Sam",
    timeZone: TZ,
    now: NOW,
    next: null,
    needs: [],
    photo: { status: "up_to_date", current: null, waiting: null },
    open: openList(),
    ...o,
  });
const urgentOpen = (n: number) =>
  openList({
    further: { count: 2, atLeast: false },
    shifts: Array.from({ length: n }, (_, i) => ({
      shiftId: `3333333${i}-3333-4333-8333-333333333333`,
      role: "door_supervisor",
      startsAt: booked.startsAt,
      endsAt: booked.endsAt,
      placesLeft: 1,
      opensAt: null,
      travel: { kind: "unknown" as const },
      isUrgent: i === 0,
      site: { id: "33333333-3333-4333-8333-333333333333", ...site },
      eventName: "Raceday",
      payRatePence: 1260,
      post: "Gate B",
    })),
  });
// Open shifts with its week strip (Phase 18), worked out from the list as the page does.
const openScreen = (
  list: ReturnType<typeof openList>,
  filters: Parameters<typeof OpenShiftsView>[0]["filters"],
) =>
  createElement(OpenShiftsView, {
    list,
    filters,
    strip: shiftsStrip(NOW, TZ, list.shifts, []),
    timeZone: TZ,
    now: NOW,
  });
const paragraph = (s: string) => createElement("p", null, s);

const SCREENS: [string, ReactElement][] = [
  ["Booked, nothing booked", myShifts({})],
  ["Booked, past, nothing", myShifts({ view: "past" })],
  ["Home, nothing booked or open", homeScreen({})],
  ["Home, one urgent shift and others to apply for", homeScreen({ open: urgentOpen(4) })],
  ["Home, no home area", homeScreen({ open: openList({ area: null }) })],
  ["Urgent board, none", createElement(UrgentView, { list: openList(), timeZone: TZ, now: NOW })],
  [
    "Urgent board, one urgent shift",
    createElement(UrgentView, {
      list: openList({
        shifts: [
          {
            shiftId: booked.shiftId,
            role: "door_supervisor",
            startsAt: booked.startsAt,
            endsAt: booked.endsAt,
            placesLeft: 1,
            opensAt: null,
            travel: { kind: "unknown" },
            isUrgent: true,
            site: { id: "33333333-3333-4333-8333-333333333333", ...site },
          },
        ],
      }),
      timeZone: TZ,
      now: NOW,
    }),
  ],
  ["Booked, a booking", myShifts({ shifts: [booked] })],
  [
    "Home, her next shift and every level of Needs updating, the photo due soon (12F.1, 12H.1)",
    homeScreen({
      next: { ...booked, eventName: "Raceday", post: "Gate B", payRatePence: 1260 },
      needs: EVERY_LEVEL,
      photo: {
        status: "due_soon",
        current: { id: "p1", uploadedOn: "2023-11-20", renewBy: "2026-11-20" },
        waiting: null,
      },
    }),
  ],
  ["Open shifts, no travel area (12G.3)", openScreen(openList({ area: null }), {})],
  [
    "Open shifts, a shift with its travel line and more further away (12G.3)",
    openScreen(
      openList({
        further: { count: 2, atLeast: false },
        shifts: [
          {
            shiftId: booked.shiftId,
            role: "door_supervisor",
            startsAt: booked.startsAt,
            endsAt: booked.endsAt,
            placesLeft: 2,
            opensAt: null,
            isUrgent: false,
            site: { id: "33333333-3333-4333-8333-333333333333", ...site },
            travel: {
              kind: "estimated",
              straightMetres: 9000,
              arriveBy: new Date("2026-11-07T13:30:00Z"),
              car: { minutes: 18, metres: 11587 },
              publicTransport: null,
            },
          },
        ],
      }),
      {},
    ),
  ],
  [
    "Urgent board, at least 50 more further away (12G.3)",
    createElement(UrgentView, {
      list: openList({ further: { count: 50, atLeast: true } }),
      timeZone: TZ,
      now: NOW,
    }),
  ],
  [
    "My shifts, a booking with its travel line (12G.3)",
    myShifts({ shifts: [{ ...booked, travel: { kind: "straight", straightMetres: 12000 } }] }),
  ],
  ["Open shifts, nothing open", openScreen(openList(), {})],
  ["Open shifts, no alerts", openScreen(openList({ offerAlerts: false }), {})],
  ["Open shifts, filters match nothing", openScreen(openList(), { role: "steward" })],
  ["Open shifts, too many to check", openScreen(openList({ truncated: true }), {})],
  ...(
    [
      {
        status: "booked",
        ref: "3F2A9C1B",
        when: "Sat 7 Nov, 14:00 to 22:00",
        role: "Door supervisor",
        siteName: "Demo Arena",
        signOff,
      },
      { status: "booked", ref: "3F2A9C1B", when: null, role: null, siteName: null, signOff },
      { status: "filled" },
      { status: "already_assigned" },
      { status: "gone" },
      { status: "not_eligible", reasons: everyReason },
      { status: "try_again" },
      { status: "not_yet", opensAt: "14:15" },
      { status: "rate_limited", retryAfterMinutes: 12 },
      { status: "error" },
    ] as const
  ).map((outcome): [string, ReactElement] => [
    `Take shift: ${outcome.status}`,
    createElement(TakeShiftResult, { outcome, reviewHref: "/shifts/x" }),
  ]),
  ...shiftPages.map((page): [string, ReactElement] => [
    `Shift page: ${page.state}`,
    createElement(ShiftView, { page, timeZone: TZ, now: NOW }),
  ]),
  ...(
    [
      { status: "created", ref: "3F2A9C1B", sentAt: "09:14 on Mon 2 Nov", signOff },
      { status: "already_open", ref: "3F2A9C1B" },
      { status: "eligible_now" },
      { status: "already_booked" },
      { status: "not_open" },
    ] as const
  ).map((outcome): [string, ReactElement] => [
    `Review: ${outcome.status}`,
    createElement(ReviewResult, { outcome }),
  ]),
  ...(
    [
      {
        status: "cancelled",
        ref: "3F2A9C1B",
        noticeHours: 53,
        recordedAt: "09:14 on Mon 2 Nov",
        when: "Sat 7 Nov, 14:00 to 22:00",
        role: "Door supervisor",
        siteName: "Demo Arena",
        signOff,
        strike: null,
      },
      {
        status: "cancelled",
        ref: "3F2A9C1B",
        noticeHours: 2,
        recordedAt: "09:14 on Mon 2 Nov",
        when: null,
        role: null,
        siteName: null,
        signOff,
        strike: { until: "Sun 31 Jan" },
      },
      { status: "started" },
      { status: "not_booked" },
      { status: "error" },
    ] as const
  ).map((outcome): [string, ReactElement] => [
    `Cancel: ${outcome.status}`,
    createElement(CancelShiftResult, { outcome, shiftId: "11111111-1111-4111-8111-111111111111" }),
  ]),
  ["My requests, none", createElement(RequestsList, { requests: [], timeZone: TZ })],
  [
    "My requests, one of each kind and status",
    createElement(RequestsList, {
      timeZone: TZ,
      requests: [
        {
          ref: "AAAA0001",
          type: "time_change",
          status: "open",
          note: null,
          createdAt: NOW,
          shift: {
            when: "Sat 7 Nov, 14:00 to 22:00",
            role: "Door supervisor",
            siteName: "Demo Arena",
          },
        },
        {
          ref: "AAAA0002",
          type: "swap",
          status: "approved",
          note: "Sam will take it.",
          createdAt: NOW,
          shift: null,
        },
        {
          ref: "AAAA0003",
          type: "review",
          status: "declined",
          note: "Your licence needs renewing first.",
          createdAt: NOW,
          shift: null,
        },
        {
          ref: "AAAA0004",
          type: "general",
          status: "auto_resolved",
          note: null,
          createdAt: NOW,
          shift: null,
        },
        {
          ref: "AAAA0005",
          type: "availability",
          status: "escalated",
          note: null,
          createdAt: NOW,
          shift: null,
        },
      ],
    }),
  ],
  ...(
    [
      {
        status: "created",
        ref: "3F2A9C1B",
        kind: "time_change",
        when: "Sat 7 Nov, 14:00 to 22:00",
        asked: "15:00 to 23:00",
        sentAt: "09:14 on Mon 2 Nov",
        signOff,
      },
      {
        status: "created",
        ref: "3F2A9C1B",
        kind: "swap",
        when: null,
        asked: null,
        sentAt: "09:14 on Mon 2 Nov",
        signOff,
      },
      { status: "already_open", ref: "3F2A9C1B", kind: "swap" },
      { status: "not_yours" },
      { status: "invalid" },
      { status: "error" },
    ] as const
  ).map((outcome): [string, ReactElement] => [
    `Request: ${outcome.status}`,
    createElement(RequestResult, { outcome }),
  ]),
  [
    "New request form",
    createElement(RequestForm, {
      shifts: [
        {
          shiftId: booked.shiftId,
          label: "Sat 7 Nov, 14:00 to 22:00, Door supervisor at Demo Arena",
        },
      ],
      preselected: null,
    }),
  ],
  ["Pay, nothing yet", createElement(PayView, { lines: [], firmName: "Acme Events" })],
  [
    "Pay, a week",
    createElement(PayView, {
      firmName: "Acme Events",
      lines: [
        {
          periodStart: "2026-10-26",
          periodEnd: "2026-11-01",
          hours: 37.5,
          ratePence: 1250,
          grossPence: 46875,
          payDate: "2026-11-06",
        },
      ],
    }),
  ],
  ["Pay code, first", createElement(CodeGate, { codeWaiting: false })],
  ["Pay code, waiting", createElement(CodeGate, { codeWaiting: true })],
  [
    "Profile, every licence state and marked days",
    createElement(ProfileView, {
      signOff,
      profile: {
        firstName: "Sam",
        lastName: "Booker",
        mobile: "+447700900123",
        email: null,
        notifyChannel: "whatsapp",
        offerAlerts: true,
        textsOff: true,
        today: "2026-11-02",
        unavailable: [
          { day: "2026-11-04", booked: true },
          { day: "2026-11-07", booked: false },
        ],
        qualifications: EVERY_STATUS,
        rightToWork: { checked: true, checkedOn: "2026-01-12", expired: false },
        rolesWithoutRule: ["response_team_lead"],
        photo: {
          status: "waiting",
          current: {
            id: "7c1d2e3f-0000-4000-8000-0000000000aa",
            uploadedOn: "2024-08-03",
            renewBy: "2027-08-03",
          },
          waiting: { id: "7c1d2e3f-0000-4000-8000-0000000000ab", uploadedOn: "2026-10-01" },
        },
      },
    }),
  ],
  [
    "Profile, nothing on file",
    createElement(ProfileView, {
      signOff,
      profile: {
        firstName: "Sam",
        lastName: "Booker",
        mobile: "+447700900123",
        email: null,
        notifyChannel: "sms",
        offerAlerts: false,
        textsOff: false,
        today: "2026-11-02",
        unavailable: [],
        qualifications: [],
        rightToWork: { checked: false, checkedOn: null, expired: true },
        rolesWithoutRule: [],
        photo: { status: "missing", current: null, waiting: null },
      },
    }),
  ],
  ...(
    [
      { status: "added", day: "2026-11-04", bookedThatDay: true },
      { status: "added", day: "2026-11-04", bookedThatDay: false },
      { status: "removed", day: "2026-11-04" },
      { status: "already" },
      { status: "not_marked" },
      { status: "past" },
      { status: "too_far" },
      { status: "too_many" },
      { status: "invalid" },
      { status: "error" },
    ] as const
  ).map((outcome): [string, ReactElement] => [
    `Unavailable day: ${outcome.status}`,
    paragraph(say(outcome).text),
  ]),
  ["Settings saved (text, no alerts)", paragraph(savedText("sms", false))],
  ["Settings saved (WhatsApp, alerts)", paragraph(savedText("whatsapp", true))],
  ["Settings saved (texts, but texts are off)", paragraph(savedText("sms", true, true))],
  ["Log in", createElement(LoginForm, { firmName: "Acme Events", signOff })],
  ["Too many tries", createElement(TooManyTries, { minutes: 847 })],
  ["A tap failed, with signal", paragraph(tryAgainText(true))],
  ["A tap failed, no signal", paragraph(tryAgainText(false))],
  [
    "Phone notifications not switched on",
    createElement(PushSetting, { publicKey: null, firmName: "Acme Events" }),
  ],
  ...(["unsupported", "add_to_home_screen", "blocked", "on", "off"] as const).map(
    (state): [string, ReactElement] => [
      `Phone notifications: ${state}`,
      createElement(PushSettingView, { state, firmName: "Acme Events" }),
    ],
  ),
  [
    "Phone notifications turned off",
    createElement(PushSettingView, { state: "off", firmName: "Acme Events", justTurnedOff: true }),
  ],
  ["Page not found", createElement(NotFound)],
  ["Something went wrong", createElement(ErrorPage, { retry: () => undefined })],
  [
    "A page failed with no signal",
    createElement(ErrorBody, { online: false, ready: true, retry: () => undefined }),
  ],
  ["The whole page failed", createElement(GlobalError)],
  ["Help", createElement(HelpView, { firmName: "Acme Events", facts: HELP_FACTS, year: 2026 })],
  // Uploads (12F.2): every answer after sending a photo or card, the guidance, the photo's statuses
  // and why one wasn't accepted, as she reads them.
  [
    "Uploads: every answer, the guidance, the photo's statuses and the reasons",
    createElement(
      "div",
      null,
      ...(
        [
          { status: "sent", kind: "photo" },
          { status: "sent", kind: "certificate" },
          { status: "empty" },
          { status: "too_big" },
          { status: "not_an_image" },
          { status: "not_needed" },
          { status: "not_active" },
          { status: "logged_out" },
          { status: "no_signal" },
          { status: "error" },
        ] as SendUploadOutcome[]
      ).map((o, i) => createElement("p", { key: `s${i}` }, sendUploadText(o))),
      createElement("p", { key: "g1" }, PHOTO_GUIDANCE),
      createElement("p", { key: "g2" }, CARD_GUIDANCE),
      ...Object.values(PHOTO_WORDS).map((w) => createElement("p", { key: w }, w)),
      ...REJECT_REASON_LIST.map((r) =>
        createElement(
          "p",
          { key: r },
          statusLabel({
            status: "rejected",
            rejected: { uploadId: "u", sentOn: "2026-10-30", reason: r },
          }),
        ),
      ),
    ),
  ],
];

// The postcode data's licence requires its attribution word for word (src/lib/travel/attribution.ts;
// docs/office-v2.md 4.7): the one passage these checks can't make plainer ("database right"), so
// it alone is taken out before them, and the test below holds Help to the exact words.
const LICENCE_WORDS = [postcodeAttribution(2026)];
const withoutLicence = (words: string) =>
  LICENCE_WORDS.reduce((rest, required) => rest.replace(required, " "), words);

describe("every staff screen and state is in plain words", () => {
  it.each(SCREENS)("%s", (_name, element) => {
    const words = text(renderToStaticMarkup(element));
    expect(words.trim().length).toBeGreaterThan(0);
    expect(problems(withoutLicence(words))).toEqual([]);
  });

  it("Help carries the postcode licence's attribution word for word, and nothing else is let off", () => {
    const words = text(
      renderToStaticMarkup(
        createElement(HelpView, { firmName: "Acme Events", facts: HELP_FACTS, year: 2026 }),
      ),
    );
    expect(words).toContain(postcodeAttribution(2026));
    // Only that exact passage is taken out: the same word anywhere else still fails.
    expect(problems(withoutLicence(`${postcodeAttribution(2026)} Check the database.`))).toEqual([
      "jargon: database",
    ]);
  });

  it("the offline pages from the service worker too", () => {
    const sandbox = vm.createContext({
      self: { location: { origin: "http://acme.localhost:3100" }, addEventListener() {} },
      Response: class {
        constructor(public body: string) {}
      },
      Headers,
      URL,
      Set,
      Number,
      Promise,
      Date,
      setTimeout,
    });
    vm.runInContext(readFileSync("public/sw.js", "utf8"), sandbox);
    const page = (sandbox.noSignalPage as () => { body: string })();
    expect(problems(text(page.body))).toEqual([]);
  });

  it("the check itself catches what it's meant to", () => {
    expect(problems("Invalid session token.")).toEqual([
      "jargon: invalid",
      "jargon: session",
      "jargon: token",
    ]);
    expect(problems("This shift needs a door_supervisor.")).toEqual(["raw code: door_supervisor"]);
    expect(problems("Booked at undefined.")).toEqual(["jargon: undefined"]);
    expect(problems(`${"word ".repeat(26).trim()}.`)).toHaveLength(1);
    expect(problems("You're booked. Reference: 3F2A9C1B. — Acme Events Shift Team")).toEqual([]);
  });

  it("with no signal, says so rather than 'Something went wrong'", () => {
    const words = text(
      renderToStaticMarkup(
        createElement(ErrorBody, { online: false, ready: true, retry: () => undefined }),
      ),
    );
    expect(words).toContain("No signal");
    expect(words).toContain("Check your signal and try again.");
    expect(words).not.toContain("Something went wrong");
    const online = text(
      renderToStaticMarkup(
        createElement(ErrorBody, { online: true, ready: true, retry: () => undefined }),
      ),
    );
    expect(online).toContain("Something went wrong");
    expect(online).toContain("If it keeps happening, contact the office.");
    expect(online).toContain("Go to my shifts");
    expect(tryAgainText(false)).toBe("No signal. Try again when you have signal.");
    expect(tryAgainText(true)).toBe("Something went wrong. Try again.");
  });

  it("reads the browser's online flag for the answer to a failed tap", () => {
    vi.stubGlobal("navigator", { onLine: false });
    try {
      expect(tryAgainText()).toBe("No signal. Try again when you have signal.");
      vi.stubGlobal("navigator", { onLine: true });
      expect(tryAgainText()).toBe("Something went wrong. Try again.");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(tryAgainText()).toBe("Something went wrong. Try again."); // no browser: assume signal
  });
});

// The office dashboard's gaps are "Urgent gaps", not a casting call (Phase 12E.1: Dylan turned the
// other wording down). Every file under src/ and the screens doc, any case, line breaks counted
// as spaces.
const TURNED_DOWN = /urgently\s+looking\s+for/i;

function everyFile(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? everyFile(path) : [path];
  });
}

describe("wording Dylan turned down", () => {
  it("'urgently looking for' is nowhere in src/ or docs/screens.md", () => {
    const files = [
      ...everyFile(join(process.cwd(), "src")),
      join(process.cwd(), "docs/screens.md"),
    ];
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((f) => TURNED_DOWN.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("the check itself catches it", () => {
    expect(TURNED_DOWN.test("We're Urgently looking for stewards")).toBe(true);
    expect(TURNED_DOWN.test("urgently\n  looking for")).toBe(true);
    expect(TURNED_DOWN.test("Urgent gaps")).toBe(false);
  });
});
