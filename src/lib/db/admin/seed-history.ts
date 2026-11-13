import { createHash } from "node:crypto";
import { noticeHours } from "../../roster/notice";
import { strikeDecision, type StrikeCode } from "../../strikes/decide";
import { strikeSettings } from "../../strikes/settings";
import { urgentWindowHours } from "../../rules/urgent";
import { addDays, localDateOf, zonedToUtc } from "../../time/zoned";
import type { StrikeReviewReason } from "../schema/strikes";
import { rng, seedId, type SeedFirm } from "./seed-data";

// Acme's worked history (Phase 37.8, w1-12; docs/testing.md "Fixtures and the demo seed"): the
// worked sessions behind the Saturday seed's pay lines (seed-saturday.ts), so the demo agrees with
// itself: a casual paid for a week has the sessions she worked that week, at the line's rate, and
// her record, Booked's Past 90 days and the pay query picker show them. A pure builder, loaded by
// seed.ts (loadHistory). Fake data only (golden rule 7).
//
// - HISTORY_WORKERS: 30 of Acme's 60 casuals. Never worker 0 (a new starter: no work, no pay; the
//   login test reads "No shifts in the last 90 days."), never 25 to 29 (an expired SIA licence) or
//   45 to 47 (an SIA licence applied for): every booking is one the rules allowed when it was made
//   (golden rule 6). The others get no pay lines either.
// - Each pay week becomes 6, 8 or 10-hour sessions adding up to the line's hours, in the worker's
//   first role at the role's Acme site, 09:00 onwards, on weekdays only (Saturdays are the Saturday
//   seed's), never on yesterday's weekday (the last event's: seed-extras.ts, whose workers the
//   rules would then refuse), at the line's rate; in the rate query's week, the stewards' sessions
//   carry the new £13.50 against their £13.00 line (what their pay queries say). Nothing in this
//   week or the future (fair rotation reads this week's hours). Two workers have a no-show too
//   (unpaid: no line).
// - LATE_CANCELLERS: 3 of them each cancelled 3 sessions under 48 hours before the start in the last
//   60 days, each with the strike the rules give (strikeDecision) and its row; each place was filled
//   again by the history worker whose session (and pay) it is.
// - A login (auth.login) the day before each week worked, at 08:00, as the app logs one. Its
//   session id has no sessions row: a login's row is deleted 30 days after it ends (docs/testing.md).
// - Re-runs: ids and draws are per (worker, pay week), so a run a week later keeps every week it
//   already wrote, and adds the new last week with its pay. The no-shows' weeks are fixed weeks of
//   the calendar, so they keep their ids too. Which weekdays a week's sessions fall on follows the
//   run's own weekday (never yesterday's, the last event's): a run on another weekday makes the same
//   sessions (ids, hours, rates) on other days, and a re-run keeps the rows already there.

const TZ = "Europe/London";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const HISTORY_WORKERS: readonly number[] = [
  1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 30, 31, 50,
  51, 52, 55, 57,
];
// Workers no browser test uses (tests/e2e: 07700 9001xx): their records change.
export const LATE_CANCELLERS: readonly number[] = [19, 20, 55];
// Two workers who once didn't turn up.
const NO_SHOWS: readonly number[] = [12, 14];
// Their weeks: the first one's number (weekNumber) is 3 in every 8, the second's 6.
const NO_SHOW_WEEK = 3;
// A Monday's week number, counted from Monday 5 January 1970.
export const weekNumber = (monday: string): number =>
  Math.round((Date.parse(`${monday}T12:00:00Z`) - Date.parse("1970-01-05T12:00:00Z")) / (7 * DAY));
// The stewards whose pay queries are about the rate (seed-extras.ts RATE_STEWARDS).
export const RATE_STEWARDS: readonly number[] = [10, 17, 18, 19, 20, 21, 24];
export const OLD_STEWARD_RATE = 1300;
export const NEW_STEWARD_RATE = 1350;

// Weekly totals that split into whole 6, 8 or 10-hour sessions (seed-saturday.ts draws from these).
export const HISTORY_HOURS = ["6.00", "8.00", "10.00", "16.00", "18.00", "24.00", "30.00"];
const SPLIT: Record<string, number[]> = {
  "6.00": [6],
  "8.00": [8],
  "10.00": [10],
  "16.00": [8, 8],
  "18.00": [10, 8],
  "24.00": [8, 8, 8],
  "30.00": [10, 10, 10],
};
export const sessionsFor = (hours: string): number[] => {
  const s = SPLIT[hours];
  if (!s) throw new Error(`no split for ${hours} hours`);
  return s;
};

// The draw for one worker's pay week: the same whatever day the seed runs.
export function weekDraw(worker: number, periodStart: string): () => number {
  const h = createHash("sha256").update(`acme/history/${worker}/${periodStart}`).digest();
  return rng(h.readInt32BE(0));
}

const weekday = (isoDate: string) => (new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7;
export const mondayOf = (isoDate: string) => addDays(isoDate, -weekday(isoDate));

// The day the rate queries are about: a weekday of the last complete week the stewards worked:
// Thursday, or Tuesday when yesterday (the last event) was a Thursday.
export function rateDayFor(today: string): string {
  const day = weekday(addDays(today, -1)) === 3 ? 1 : 3;
  return addDays(mondayOf(today), -7 + day);
}

// The weekdays a worker's sessions use in a week, in order: the rate day's weekday first, never
// yesterday's weekday.
function weekdaysFor(today: string): number[] {
  const first = weekday(rateDayFor(today));
  const blocked = weekday(addDays(today, -1));
  return [first, 1, 3, 0, 2, 4].filter((d, i, all) => d !== blocked && all.indexOf(d) === i);
}

const at = (date: string, hour: number) => {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return zonedToUtc({ year, month, day, hour, minute: 0 }, TZ);
};

const SITE_FOR: Record<string, string> = {
  steward: "racecourse",
  door_supervisor: "stadium",
  security_officer: "centre",
};
const INSTRUCTIONS: Record<string, string> = {
  steward: "Enclosure stewarding. Meet at the Main Stand office.",
  door_supervisor: "Search lanes at Gate A. Briefing in the control room.",
  security_officer: "Sign in at the security office on Level 1.",
};

export interface HistoryPayLine {
  workerId: string;
  periodStart: string;
  hours: string;
  ratePence: number;
}

export interface HistorySession {
  id: string;
  siteId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  payRatePence: number;
  instructions: string;
  createdAt: Date;
}

export interface HistoryBooking {
  id: string;
  shiftId: string;
  workerId: string;
  status: "completed" | "no_show" | "cancelled_worker";
  confirmedAt: Date;
  bookedNoticeHours: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
  noticeHours: number | null;
  strikeCode: StrikeCode | null;
  reopenedId: string | null; // the place it reopened: the filler's booking below
}

export interface HistoryStrike {
  id: string;
  bookingId: string;
  workerId: string;
  shiftId: string;
  noticeHours: number;
  issuedAt: Date;
  expiresAt: Date;
  reviewReasons: StrikeReviewReason[];
}

export interface HistoryLogin {
  id: string;
  workerId: string;
  at: Date;
  sessionId: string; // the week's first session: logged with it, once
}

export interface HistorySeed {
  sessions: HistorySession[];
  bookings: HistoryBooking[];
  strikes: HistoryStrike[];
  logins: HistoryLogin[];
}

const CANCEL_REASONS = ["Travel problem", "Something else: childcare fell through", "I'm unwell"];
// Hours: each under Acme's 48 (a strike) and at least its urgent window of 24, so the reopened
// place didn't go urgent (the app would have marked it and sent offer waves: cancel.ts).
const CANCEL_NOTICE = [30, 36, 44];

export function acmeHistory(
  workers: SeedFirm["workers"],
  sites: SeedFirm["sites"],
  pay: readonly HistoryPayLine[],
  now: Date,
  settings: Record<string, unknown>,
): HistorySeed {
  const today = localDateOf(now, TZ);
  const thisMonday = mondayOf(today);
  const days = weekdaysFor(today);
  const rateWeek = mondayOf(rateDayFor(today));
  const siteId = (role: string) => {
    const key = SITE_FOR[role] ?? "racecourse";
    const site = sites.find((s) => s.id === seedId(`acme/site/${key}`));
    if (!site) throw new Error(`no seeded site ${key}`);
    return site.id;
  };
  const indexOf = new Map(workers.map((w, i) => [w.id, i]));

  const sessions: HistorySession[] = [];
  const bookings: HistoryBooking[] = [];
  const logins: HistoryLogin[] = [];
  const add = (
    i: number,
    periodStart: string,
    n: number,
    day: string,
    hours: number,
    rate: number,
    status: "completed" | "no_show",
  ) => {
    const w = workers[i];
    if (!w) throw new Error(`no seeded worker ${i}`);
    const role = w.roles[0] ?? "steward";
    const startsAt = at(day, 9);
    const sessionId = seedId(`acme/history/${i}/${periodStart}/${n}/session`);
    const confirmedAt = new Date(startsAt.getTime() - 6 * DAY);
    sessions.push({
      id: sessionId,
      siteId: siteId(role),
      role,
      startsAt,
      endsAt: new Date(startsAt.getTime() + hours * HOUR),
      payRatePence: rate,
      instructions: INSTRUCTIONS[role] ?? "",
      createdAt: new Date(confirmedAt.getTime() - DAY),
    });
    bookings.push({
      id: seedId(`acme/history/${i}/${periodStart}/${n}`),
      shiftId: sessionId,
      workerId: w.id,
      status,
      confirmedAt,
      bookedNoticeHours: noticeHours(startsAt, confirmedAt),
      cancelledAt: null,
      cancelReason: null,
      noticeHours: null,
      strikeCode: null,
      reopenedId: null,
    });
  };

  // The worked sessions behind each pay line (only complete weeks before this one).
  for (const line of pay) {
    const i = indexOf.get(line.workerId);
    if (i === undefined || !HISTORY_WORKERS.includes(i)) continue;
    if (line.periodStart >= thisMonday) continue;
    const role = workers[i]?.roles[0] ?? "steward";
    const rate =
      line.periodStart === rateWeek && RATE_STEWARDS.includes(i) && role === "steward"
        ? NEW_STEWARD_RATE
        : line.ratePence;
    const parts = sessionsFor(line.hours);
    parts.forEach((hours, n) => {
      add(
        i,
        line.periodStart,
        n,
        addDays(line.periodStart, days[n] ?? n),
        hours,
        rate,
        "completed",
      );
    });
    // A login the day before the week's first session, at 08:00 (the app logs each one).
    logins.push({
      id: seedId(`acme/history/${i}/${line.periodStart}/login`),
      workerId: workers[i]?.id ?? "",
      at: at(addDays(line.periodStart, (days[0] ?? 1) - 1), 8),
      sessionId: seedId(`acme/history/${i}/${line.periodStart}/0/session`),
    });
  }

  // Two no-shows, unpaid, on a day the worker has no session, in a fixed week of the calendar (one
  // in every 8, by the week's number: NO_SHOW_WEEK), so a run a week later finds the same week and
  // the same id, and adds no second one (a week counted back from today moved every week).
  NO_SHOWS.forEach((i, k) => {
    const periodStart = [1, 2, 3, 4, 5, 6, 7, 8]
      .map((n) => addDays(thisMonday, -7 * n))
      .find((monday) => weekNumber(monday) % 8 === (NO_SHOW_WEEK + 3 * k) % 8);
    if (!periodStart) return;
    const used = sessions
      .filter((s, k) => bookings[k]?.workerId === workers[i]?.id)
      .map((s) => localDateOf(s.startsAt, TZ));
    const day = days.map((d) => addDays(periodStart, d)).find((d) => !used.includes(d));
    if (!day) return;
    const role = workers[i]?.roles[0] ?? "steward";
    add(i, periodStart, 9, day, 8, roleRate(role), "no_show");
  });

  // The late cancellers: for each, 3 sessions of the same role other history workers worked in
  // weeks 2 to 7 (inside 60 days), on days the canceller had no session. The canceller booked it
  // first, cancelled under 48 hours before, and the worker it belongs to filled the place again.
  const rules = strikeSettings(settings);
  const urgentHours = urgentWindowHours(settings);
  for (const n of CANCEL_NOTICE) {
    if (n < urgentHours || n >= rules.noticeHours) {
      throw new Error(
        `a late cancellation's notice of ${n} hours isn't a strike outside the urgent window`,
      );
    }
  }
  const strikes: HistoryStrike[] = [];
  const earliest = addDays(thisMonday, -49);
  const latest = addDays(thisMonday, -7);
  for (const c of LATE_CANCELLERS) {
    const canceller = workers[c];
    if (!canceller) throw new Error(`no seeded worker ${c}`);
    const role = canceller.roles[0] ?? "steward";
    const ownDays = new Set(
      bookings
        .filter((b) => b.workerId === canceller.id)
        .map((b) => sessions.find((s) => s.id === b.shiftId))
        .map((s) => (s ? localDateOf(s.startsAt, TZ) : "")),
    );
    const taken = new Set(bookings.filter((b) => b.reopenedId).map((b) => b.shiftId));
    const picked: HistoryBooking[] = [];
    for (const b of bookings) {
      if (picked.length === 3) break;
      if (b.status !== "completed" || b.workerId === canceller.id || taken.has(b.shiftId)) continue;
      if (LATE_CANCELLERS.includes(indexOf.get(b.workerId) ?? -1)) continue;
      const s = sessions.find((x) => x.id === b.shiftId);
      if (!s || s.role !== role) continue;
      const day = localDateOf(s.startsAt, TZ);
      if (day < earliest || day >= latest || ownDays.has(day)) continue;
      picked.push(b);
      ownDays.add(day);
    }
    if (picked.length < 3) throw new Error(`not enough sessions for late canceller ${c}`);
    picked.forEach((filler, k) => {
      const s = sessions.find((x) => x.id === filler.shiftId);
      if (!s) return;
      const notice = CANCEL_NOTICE[k] ?? 30;
      const reason = CANCEL_REASONS[k] ?? "Travel problem";
      const cancelledAt = new Date(s.startsAt.getTime() - notice * HOUR);
      const confirmedAt = new Date(s.startsAt.getTime() - 6 * DAY);
      const decision = strikeDecision({
        cancelledBy: "worker",
        noticeHours: notice,
        thresholdHours: rules.noticeHours,
        booking: { by: "worker", overridden: false },
        changedAfterBooking: false,
        reason,
        ...(rules.enabled ? {} : { strikesOff: true as const }),
      });
      const id = seedId(`acme/history/late/${c}/${s.id}`);
      bookings.push({
        id,
        shiftId: s.id,
        workerId: canceller.id,
        status: "cancelled_worker",
        confirmedAt,
        bookedNoticeHours: noticeHours(s.startsAt, confirmedAt),
        cancelledAt,
        cancelReason: reason,
        noticeHours: notice,
        strikeCode: decision.code,
        reopenedId: filler.id,
      });
      // The filler took the reopened place an hour after it reopened.
      filler.confirmedAt = new Date(cancelledAt.getTime() + HOUR);
      filler.bookedNoticeHours = noticeHours(s.startsAt, filler.confirmedAt);
      if (decision.result === "strike") {
        strikes.push({
          id: seedId(`acme/history/late/${c}/${s.id}/strike`),
          bookingId: id,
          workerId: canceller.id,
          shiftId: s.id,
          noticeHours: notice,
          issuedAt: cancelledAt,
          expiresAt: new Date(cancelledAt.getTime() + rules.liveDays * DAY),
          reviewReasons: decision.reviewReasons,
        });
      }
      // The session was created before either booking.
      s.createdAt = new Date(Math.min(s.createdAt.getTime(), confirmedAt.getTime() - DAY));
    });
  }

  return { sessions, bookings, strikes, logins };
}

function roleRate(role: string): number {
  return role === "door_supervisor" ? 1450 : role === "security_officer" ? 1350 : 1300;
}
