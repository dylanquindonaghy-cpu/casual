import type { StopReason } from "../offers/waves";
import type { PayIssue } from "../portal/pay-query-kinds";
import type { CancellationRow } from "./cancellations-copy";

// The dashboard's six charts (Phase 23, 23.4; docs/screens.md `/office`), as the loaders give them
// (src/lib/office/dashboard-charts-load.ts) and the chart components read them. Types only: the
// components `import type` from here, so nothing of the database reaches the browser
// (tests/unit/client-boundary.test.ts). Every count comes from the same rules the rest of the
// office uses (Events' "Need people" and urgent gaps, the Cancellations page's notice, Needs
// attention's items, the Casuals pages' "expiring soon"); the rows behind each mark are loaded with
// the chart, capped (`more`: there were others), so a panel needs no request of its own.
//
// Days are the firm's calendar days, yyyy-mm-dd (Europe/London), each from its own midnight: the
// clocks go back on Sun 25 Oct 2026, so that day is 25 hours long. Times are Dates (UTC instants);
// show them in the firm's time zone (Dashboard.timeZone).

// Each chart loads at most 50 rows behind a mark (CHART_ROWS in dashboard-charts-load.ts; a panel
// shows at most 50: "Showing the first 50."), with `more` when there were others.

// ---------------------------------------------------------------------------------------------
// 1. Places to fill, the next 14 days (`fill`).

// One firm day of the 14: its places in sessions casuals can be booked on (open or filled: drafts
// and cancelled ones aren't), how many are filled (booked, or all of a session marked filled), how
// many can still be filled (`open`: open sessions not started with a place free, Events' "Need
// people" rule), how many of those are urgent gaps (`urgent`, a part of `open`: the chart's red
// bar is `urgent`, its amber bar `open - urgent`), in how many sessions those open places are, and
// how many of them casuals can't see (`hidden`, a part of `open`). Every count is over all the
// day's sessions, never only the rows FillChart.gaps holds.
export interface FillDay {
  date: string;
  places: number;
  filled: number;
  open: number;
  urgent: number;
  gapSessions: number; // sessions with a place free that day (the rows below hold the first ones)
  // Of `open`, the places free in sessions casuals can't see: the session's own switch or its
  // event's is off (GapSession.hidden's rule).
  hidden: number;
}

// A session's offers, as its row's chips read them: offers that went (not failed), how many have
// no answer yet (waiting for a reply), said no, said yes, and why the waves stopped (null: they
// haven't, or an offer went since).
export interface GapOffers {
  offered: number;
  waiting: number;
  declined: number;
  accepted: number;
  stopped: StopReason | null;
}

// A session with a place free (open, not started, booked below its headcount).
export interface GapSession {
  shiftId: string; // its page: /office/shifts/{shiftId}; Offer: /office/offer/{shiftId}
  eventId: string; // its event: /office/events/{eventId}
  eventName: string;
  site: string | null; // the session's site, else its event's
  role: string; // a role code ("door_supervisor"): roleLabel() for words
  date: string; // the firm day it starts
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  booked: number;
  placesFree: number; // headcount - booked
  urgentGap: boolean; // marked urgent (every place free in it is an urgent place)
  // Casuals can't see it: its event's switch or its own is off (HIDDEN_WARNING's case).
  hidden: boolean;
  eventShowing: boolean;
  showing: boolean; // the session's own switch
  fromSheet: boolean; // from the firm's Google Sheet: its places change there
  fromPlanner: boolean; // from the firm's planner (12J.1): likewise
  offers: GapOffers;
}

export interface FillChart {
  first: string; // today
  days: FillDay[]; // 14 of them, today first
  // The window's sessions with a place free, soonest first, the first 50 of them (`more`:
  // there were others; a day's own count is FillDay.gapSessions).
  gaps: GapSession[];
  more: boolean;
}

// ---------------------------------------------------------------------------------------------
// 2. Which events need people (`eventsNeed`): over every session to come (not ended, not
// cancelled), as Events & sessions counts its "Need people".

export interface EventNeed {
  eventId: string; // /office/events/{eventId}
  name: string;
  site: string | null; // the event's own site
  places: number; // places that can still be filled (placeFree)
  urgent: number; // of those, urgent gaps (red; `places - urgent` amber)
  gapSessions: number;
  firstGap: Date; // the soonest session with a place free
  showing: boolean; // the event's switch
  hiddenSessions: boolean; // a session with a place free is switched off on its own
  hidden: boolean; // casuals can't see some of its gaps: !showing || hiddenSessions
  // Its sessions with a place free, soonest first (the first 50; `moreSessions`: others).
  sessions: GapSession[];
  moreSessions: boolean;
}

export interface EventsNeedChart {
  // Most urgent first (urgent places, then places, then the soonest gap), at most EVENT_BARS.
  events: EventNeed[];
  more: number; // events beyond those that need people too
  total: { events: number; places: number; urgent: number }; // over every event that needs people
  // Of total.events, those with a gap casuals can't see (EventNeed.hidden's rule: the event's
  // switch is off, or a session with a place free is switched off), over every one, not only the
  // events named.
  hiddenEvents: number;
  // Events with sessions to come whose every session is booked to its places or marked filled,
  // soonest first, at most EVENT_BARS (`fullMore`: how many others).
  full: string[];
  fullMore: number;
}

// ---------------------------------------------------------------------------------------------
// 3. Offers this week (`offersWeek`): offers sent in the pay week (Monday to Sunday, the top bar's
// week), not counting those that couldn't be sent (`failed` never counts as offered).

// yes: said yes (booked). waiting: no answer yet, on a session still open and to come. closed:
// everything else, with why (offers never run out by themselves).
export type OfferState = "yes" | "waiting" | "closed";
// said_no: declined. filled_elsewhere: someone else took the place. changed: the session was moved
// or cancelled (or put back to draft). no_reply: no answer before it started (or filled).
export type OfferWhy = "said_no" | "filled_elsewhere" | "changed" | "no_reply";

export interface OfferRow {
  offerId: string;
  shiftId: string; // /office/shifts/{shiftId}
  workerId: string; // /office/casuals/{workerId}
  casual: string; // "Deleted worker" once erased
  role: string; // a role code
  eventName: string;
  startsAt: Date; // the session's start
  sentAt: Date;
  answeredAt: Date | null; // when they said yes or no, or it closed
  byOffice: boolean; // sent by the office by hand (else by an offer wave)
  state: OfferState;
  why: OfferWhy | null; // closed ones only
}

// A session still waiting for replies this week: how many offers have no answer yet.
export interface WaitingSession {
  shiftId: string;
  role: string;
  eventName: string;
  startsAt: Date;
  endsAt: Date;
  waiting: number;
}

export interface OffersWeekChart {
  week: { monday: string; sunday: string }; // the pay week
  counts: Record<OfferState, number>;
  closedWhy: Record<OfferWhy, number>; // the closed ones, by why
  // Each state's offers, newest sent first, the first 50 of each (`more` per state).
  rows: Record<OfferState, OfferRow[]>;
  more: Record<OfferState, boolean>;
  // The sessions with offers waiting, most waiting first (then the soonest), at most 50.
  waitingSessions: WaitingSession[];
  waitingSessionsMore: boolean;
}

// ---------------------------------------------------------------------------------------------
// 4. How long things have waited (`waited`): what needs the office, from when, and what's with
// payroll (only for a role that can open Pay).

// Needs attention's kinds with a date, by its anchor on /office/needs-attention (#to-mark, …):
// to-mark (since the session ended), uploads (since sent), enquiries (the messages that need a
// person: since they came in), evidence (a strike evidence email that failed: since the
// cancellation), planner-refused (since the planner's change was refused), webhook (failing since
// its first failure).
export type WaitedKind =
  "to-mark" | "uploads" | "enquiries" | "evidence" | "planner-refused" | "webhook";

// One firm day: how many of each kind have waited since then (every one: uploads and enquiries
// are counted in full, the other kinds are Needs attention's own lists, so at most 50 each, as
// its count is).
export interface WaitedDay {
  day: string;
  needsYou: Record<WaitedKind, number>;
}

export type WaitedItem =
  | {
      kind: "to-mark"; // "Mark who worked": /office/shifts/{shiftId} (or #to-mark)
      since: Date; // the session ended
      day: string;
      shiftId: string;
      role: string;
      site: string | null;
      startsAt: Date;
      endsAt: Date;
      unmarked: number;
    }
  | {
      kind: "uploads"; // "Check": /office/casuals/{workerId} (or /office/casuals?view=uploads)
      since: Date; // sent
      day: string;
      uploadId: string;
      workerId: string;
      casual: string;
      upload: "photo" | "certificate";
      qualificationName: string | null; // a certificate's, as stored (mid-sentence)
    }
  | {
      kind: "enquiries"; // "Open": /office/enquiries/{messageId}
      since: Date; // the message came in
      day: string;
      messageId: string;
      channel: "whatsapp" | "sms" | "voice";
      // Who sent it: a casual by name, a number nobody here has, or a withheld number. Never their
      // words or their number: the loader doesn't read them.
      who:
        | { kind: "casual"; workerId: string; name: string }
        | { kind: "unknown" }
        | { kind: "withheld" };
    }
  | {
      kind: "evidence"; // /office/cancellations/{ref} ("Resend evidence"), or #evidence
      since: Date; // the cancellation
      day: string;
      assignmentId: string;
      casual: string;
      stuck: boolean;
      nothingSent: boolean;
    }
  | {
      kind: "planner-refused"; // /office/shifts/{shiftId}, or #planner-refused
      since: Date; // refused
      day: string;
      shiftId: string;
      role: string;
      site: string | null;
      startsAt: Date;
      why: "move" | "session_has_bookings" | "places_below_booked" | "change_reason_required";
      casuals: number;
    }
  | {
      kind: "webhook"; // /office/settings/integrations, or #webhook
      since: Date; // its first failure since it last worked
      day: string;
    };

// A pay query with payroll (open, or in a digest): never its details (the casual's own words).
export interface PayWaitingRow {
  payQueryId: string;
  workerId: string;
  casual: string;
  issue: PayIssue; // ISSUE_LABELS (src/lib/portal/pay-query-kinds.ts) for words
  workDate: string; // yyyy-mm-dd
  since: Date; // raised
  day: string;
  inDigest: boolean;
}

export interface WaitedChart {
  today: string;
  // Every day something dated has waited since, oldest first (no empty days: bucket them by age
  // with daysUntil(day, today)).
  days: WaitedDay[];
  // The dated items, each kind oldest first: the first 50 uploads and enquiries (counted
  // in full in `days`), and Needs attention's own lists of the rest.
  items: WaitedItem[];
  more: Record<WaitedKind, boolean>; // a kind's items stop before its count
  // Needs attention's items that have no date of their own, as counts: bookings to check, changes
  // from the rota sheet, licences that won't be in date for a booking (#expired), and the strikes
  // team's address not set and confirmed (#evidence). With `days`' needsYou they add up to the
  // menu's Needs attention count (attentionCount), `more` as its `more`.
  undated: { toCheck: number; fromSheet: number; expired: number; strikesAddress: number };
  needsYouTotal: number; // every dated item for the office plus the undated ones
  needsYouMore: boolean; // a Needs attention list stopped at 50, so "at least"
  // Pay queries with payroll: how many, how many from each firm day (oldest first, every one), and
  // the oldest 50. Null for a role that can't open Pay (a resourcer: no count, row, name or issue
  // of a pay query is loaded at all).
  pay: {
    total: number;
    days: { day: string; count: number }[];
    rows: PayWaitingRow[];
    more: boolean;
  } | null;
}

// ---------------------------------------------------------------------------------------------
// 5. Cancellations, the last 14 days (`cancels14`): by anyone, each on the firm day it was made.

// One firm day: its cancellations, and those under the firm's strike notice setting (the
// Cancellations page's "Under N hours"; never the law's short-notice threshold).
export interface CancelDay {
  date: string;
  total: number;
  short: number;
  byCasuals: number; // by the casual themselves (the rest: the office, the sheet or the planner)
}

export interface CancelsChart {
  first: string; // 13 days before today
  days: CancelDay[]; // 14, oldest first, today last (today's: since midnight, as the count's)
  threshold: number; // hours: strikeSettings(settings).noticeHours
  // The window's cancellations as the Cancellations page has them (each opens
  // /office/cancellations/{ref}), newest first, the first 50 (`more`: others; a day whose
  // rows here are fewer than its total has more on /office/cancellations).
  rows: CancellationRow[];
  more: boolean;
}

// ---------------------------------------------------------------------------------------------
// 6. Licences and certificates running out in the next 8 weeks (`licences`).

export interface LicenceRow {
  credentialId: string;
  workerId: string; // /office/casuals/{workerId}
  casual: string;
  type: string; // its code ("SIA_DS")
  name: string; // its name for people ("SIA door supervisor licence")
  expiresOn: string; // yyyy-mm-dd: in date on that day, out of date the day after
  days: number; // from today: 0 (runs out at the end of today) to 55
  soon: boolean; // within EXPIRING_SOON_DAYS (Casuals' "Need updating", the expiry warnings)
  renewalWaiting: boolean; // an upload or a record of its type waits for the office's check
  // A booking it won't be in date for (Needs attention's #expired rule, over every booking, not
  // only the 50 Needs attention lists): the soonest such. `lastDay` (yyyy-mm-dd, the firm's
  // calendar) is the last day of its session, the day the rule checks: always after expiresOn. A
  // night session that starts on the day the licence runs out has its lastDay the day after.
  booked: {
    assignmentId: string;
    shiftId: string;
    role: string;
    startsAt: Date;
    lastDay: string;
  } | null;
}

export interface LicencesChart {
  today: string;
  windowDays: number; // 56: today and the 55 days after
  soonDays: number; // EXPIRING_SOON_DAYS (30)
  // Verified, valid records of active casuals running out in the window: not renewed by a longer
  // valid record, not with a suspended record of the type. Soonest first, the first 50.
  rows: LicenceRow[];
  more: boolean;
  // Over every licence in the window, not only the 50 rows: booked, those booked after they run out.
  counts: { total: number; soon: number; booked: number };
}
