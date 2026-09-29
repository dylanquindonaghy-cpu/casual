import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import { REASONS } from "@/lib/rules/reasons";

// Copy is product (golden rule 11; docs/screens.md copy rules): every staff screen, in every
// empty, error and answer state, in plain words. This renders them all and fails on jargon, raw
// codes, "undefined"/"null" in the text, and sentences over 25 words. A new screen or state
// belongs in SCREENS below.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/",
}));

const { MyShiftsView } = await import("@/app/my-shifts-view");
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
const shiftPages: ShiftPage[] = [
  { state: "missing" },
  { state: "booked", shift: booked },
  { state: "open", shift: summary },
  { state: "held", shift: summary, opensAt: new Date("2026-11-02T09:15:00Z") },
  { state: "blocked", shift: summary, reasons: everyReason, review: null },
  {
    state: "blocked",
    shift: summary,
    reasons: everyReason.slice(0, 1),
    review: { ref: "3F2A9C1B", askedAt: NOW },
  },
  { state: "filled", shift: summary },
  { state: "started", shift: summary },
  { state: "cancelled", shift: summary },
];
const myShifts = (o: Partial<Parameters<typeof MyShiftsView>[0]>) =>
  createElement(MyShiftsView, {
    firstName: "Sam",
    voice,
    timeZone: TZ,
    now: NOW,
    view: "upcoming",
    shifts: [],
    notices: [],
    ...o,
  });
const openList = (o: Partial<Parameters<typeof OpenShiftsView>[0]["list"]> = {}) => ({
  shifts: [],
  truncated: false,
  offerAlerts: true,
  choices: { days: [], sites: [], roles: [] },
  ...o,
});
const paragraph = (s: string) => createElement("p", null, s);

const SCREENS: [string, ReactElement][] = [
  ["My shifts, nothing booked", myShifts({})],
  ["My shifts, past, nothing", myShifts({ view: "past" })],
  ["My shifts, one urgent shift", myShifts({ urgentCount: 1 })],
  ["My shifts, several urgent shifts", myShifts({ urgentCount: 3 })],
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
            isUrgent: true,
            site: { id: "33333333-3333-4333-8333-333333333333", ...site },
          },
        ],
      }),
      timeZone: TZ,
      now: NOW,
    }),
  ],
  [
    "My shifts, a booking and licence notices",
    myShifts({
      shifts: [booked],
      notices: [
        {
          type: "SIA_DS",
          name: "SIA door supervisor licence",
          expiresOn: "2026-11-20",
          expired: false,
        },
        {
          type: "FIRST_AID",
          name: "first aid at work certificate",
          expiresOn: "2026-10-01",
          expired: true,
        },
        { type: "SIA_SG", name: "SIA security guard licence", expiresOn: null, expired: true },
      ],
    }),
  ],
  [
    "Open shifts, nothing open",
    createElement(OpenShiftsView, { list: openList(), filters: {}, timeZone: TZ, now: NOW }),
  ],
  [
    "Open shifts, no alerts",
    createElement(OpenShiftsView, {
      list: openList({ offerAlerts: false }),
      filters: {},
      timeZone: TZ,
      now: NOW,
    }),
  ],
  [
    "Open shifts, filters match nothing",
    createElement(OpenShiftsView, {
      list: openList(),
      filters: { role: "steward" },
      timeZone: TZ,
      now: NOW,
    }),
  ],
  [
    "Open shifts, too many to check",
    createElement(OpenShiftsView, {
      list: openList({ truncated: true }),
      filters: {},
      timeZone: TZ,
      now: NOW,
    }),
  ],
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
      },
      { status: "started" },
      { status: "not_booked" },
      { status: "error" },
    ] as const
  ).map((outcome): [string, ReactElement] => [
    `Cancel: ${outcome.status}`,
    createElement(CancelShiftResult, { outcome }),
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
          createdAt: NOW,
          shift: {
            when: "Sat 7 Nov, 14:00 to 22:00",
            role: "Door supervisor",
            siteName: "Demo Arena",
          },
        },
        { ref: "AAAA0002", type: "swap", status: "approved", createdAt: NOW, shift: null },
        { ref: "AAAA0003", type: "review", status: "declined", createdAt: NOW, shift: null },
        { ref: "AAAA0004", type: "general", status: "auto_resolved", createdAt: NOW, shift: null },
        { ref: "AAAA0005", type: "availability", status: "escalated", createdAt: NOW, shift: null },
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
        today: "2026-11-02",
        unavailable: [
          { day: "2026-11-04", booked: true },
          { day: "2026-11-07", booked: false },
        ],
        credentials: [
          {
            type: "SIA_DS",
            name: "SIA door supervisor licence",
            status: "valid",
            expiresOn: "2029-01-01",
            expired: false,
          },
          {
            type: "FIRST_AID",
            name: "first aid at work certificate",
            status: "valid",
            expiresOn: "2026-10-01",
            expired: true,
          },
          {
            type: "SIA_SG",
            name: "SIA security guard licence",
            status: "applied",
            expiresOn: null,
            expired: false,
          },
          {
            type: "SIA_CP",
            name: "SIA close protection licence",
            status: "suspended",
            expiresOn: null,
            expired: false,
          },
          {
            type: "STEWARD_L2",
            name: "Level 2 spectator safety qualification",
            status: "valid",
            expiresOn: null,
            expired: false,
          },
        ],
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
        today: "2026-11-02",
        unavailable: [],
        credentials: [],
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
  ["Something went wrong", createElement(ErrorPage, { reset: () => undefined })],
  [
    "A page failed with no signal",
    createElement(ErrorBody, { online: false, reset: () => undefined }),
  ],
  ["The whole page failed", createElement(GlobalError, { reset: () => undefined })],
];

describe("every staff screen and state is in plain words", () => {
  it.each(SCREENS)("%s", (_name, element) => {
    const words = text(renderToStaticMarkup(element));
    expect(words.trim().length).toBeGreaterThan(0);
    expect(problems(words)).toEqual([]);
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
      renderToStaticMarkup(createElement(ErrorBody, { online: false, reset: () => undefined })),
    );
    expect(words).toContain("No signal");
    expect(words).toContain("Check your signal and try again.");
    expect(words).not.toContain("Something went wrong");
    const online = text(
      renderToStaticMarkup(createElement(ErrorBody, { online: true, reset: () => undefined })),
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
