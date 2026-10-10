import { FIRM_CHANGE_REASONS } from "../../roster/firm-reasons";
import { noticeHours } from "../../roster/notice";
import { addDays, localDateOf, zonedToUtc } from "../../time/zoned";
import { seedId, type SeedFirm } from "./seed-data";

// More of the demo, for the states the walkthrough visits (Phase 10 task 20, docs/walkthrough.md;
// docs/testing.md "Fixtures and the demo seed"). Pure builders, loaded by seed.ts. Fake data only
// (golden rule 7). Ids are fixed and include the dates they're about, so a re-run adds nothing
// for the same dates: the same day for Northline's night (tomorrow's), the same week for Acme's last
// event and pay queries. A re-run on a later day adds that day's, as the Saturday does for its week
// (`npm run db:reset` for exactly one of each). A booking that would overlap one the worker already
// holds is left out (seed.ts). The workers used are ones no browser test uses. The pay queries'
// kinds aren't any a browser test raises ("paid late"), so they never share or split its group.
//
// - Acme's last event: yesterday (so it's always among the dashboard's "Who worked?", which looks
//   back 7 days), 3 stewards at the racecourse and 2 security officers at the shopping centre, all
//   booked and none marked yet (the office's "Mark who worked"; "Past 30 days" on their My shifts).
// - Acme's pay queries: 10 open, 7 from stewards about the same week's rate (paid the old rate),
//   2 about hours missing at the shopping centre on the last event, 1 something else (payroll's
//   groups and digest).
// - Northline's night possession: 3 track operatives booked tomorrow night at the junction; the
//   office cancelled one of them at short notice when the seed ran ("Weather or safety"), so the
//   notice report has a short-notice firm cancellation (audit L25).

const TZ = "Europe/London";
const HOUR = 3_600_000;
const at = (date: string, time: string) => {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return zonedToUtc({ year, month, day, hour, minute }, TZ);
};
const weekday = (isoDate: string) => (new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7;

// The last event's day: yesterday.
export const lastEventDay = (today: string): string => addDays(today, -1);

export interface ExtraShift {
  id: string;
  siteId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  status: "open" | "filled";
  instructions: string;
}

export interface ExtraBooking {
  id: string;
  shiftId: string;
  workerId: string;
  status: "confirmed" | "cancelled_firm";
  confirmedAt: Date;
  bookedNoticeHours: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
  noticeHours: number | null;
}

export interface PastEventSeed {
  day: string;
  shiftsCreatedAt: Date;
  shifts: ExtraShift[];
  bookings: ExtraBooking[];
}

const workerAt = (workers: SeedFirm["workers"], i: number) => {
  const w = workers[i];
  if (!w) throw new Error(`no seeded worker ${i}`);
  return w;
};
const siteOf = (sites: SeedFirm["sites"], id: string) => {
  const site = sites.find((s) => s.id === id);
  if (!site) throw new Error(`no seeded site ${id}`);
  return site.id;
};

// Acme workers 10, 17 and 18 (07700 900110, 900117, 900118: stewards) and 50 and 51 (07700
// 900150, 900151: security officers).
const PAST_STEWARDS = [10, 17, 18];
const PAST_OFFICERS = [50, 51];

export function acmePastEvent(
  workers: SeedFirm["workers"],
  sites: SeedFirm["sites"],
  now: Date,
): PastEventSeed {
  const day = lastEventDay(localDateOf(now, TZ));
  const id = (what: string) => seedId(`acme/past/${day}/${what}`);
  const bookedAt = new Date(at(day, "09:00").getTime() - 72 * HOUR);
  const shifts: ExtraShift[] = [];
  const bookings: ExtraBooking[] = [];
  const add = (
    key: string,
    site: string,
    role: string,
    start: string,
    end: string,
    who: number[],
    instructions: string,
  ) => {
    who.forEach((i, place) => {
      const shiftId = id(`shift/${key}/${place}`);
      const startsAt = at(day, start);
      shifts.push({
        id: shiftId,
        siteId: siteOf(sites, seedId(`acme/site/${site}`)),
        role,
        startsAt,
        endsAt: at(day, end),
        status: "filled",
        instructions,
      });
      bookings.push({
        id: id(`booking/${key}/${place}`),
        shiftId,
        workerId: workerAt(workers, i).id,
        status: "confirmed",
        confirmedAt: bookedAt,
        bookedNoticeHours: noticeHours(startsAt, bookedAt),
        cancelledAt: null,
        cancelReason: null,
        noticeHours: null,
      });
    });
  };
  add(
    "race-steward",
    "racecourse",
    "steward",
    "10:30",
    "18:30",
    PAST_STEWARDS,
    "Race day. Report to the main gate.",
  );
  add(
    "centre-officer",
    "centre",
    "security_officer",
    "07:00",
    "15:00",
    PAST_OFFICERS,
    "Report to the control room by the north entrance.",
  );
  return { day, shiftsCreatedAt: new Date(bookedAt.getTime() - 96 * HOUR), shifts, bookings };
}

export interface PayQuerySeed {
  id: string;
  workerId: string;
  shiftId: string | null;
  workDate: string;
  issue: "wrong_rate" | "missing_hours" | "other";
  details: string;
}

// Acme workers 10, 17, 18, 19, 20, 21 and 24 (stewards) raised the rate; 50 and 51 the hours
// missing on the last event; 52 something else.
const RATE_STEWARDS = [10, 17, 18, 19, 20, 21, 24];

export function acmePayQueries(
  workers: SeedFirm["workers"],
  past: PastEventSeed,
  now: Date,
): PayQuerySeed[] {
  // The rate: the Saturday of the last complete week, which every Acme worker has a pay line for
  // (seed-saturday.ts; the last event, yesterday, can be in this week).
  const today = localDateOf(now, TZ);
  const rateDay = addDays(today, -weekday(today) - 2);
  const id = (what: string) => seedId(`acme/pay-query/${past.day}/${what}`);
  const queries: PayQuerySeed[] = RATE_STEWARDS.map((i) => ({
    id: id(`rate/${i}`),
    workerId: workerAt(workers, i).id,
    shiftId: null,
    workDate: rateDay,
    issue: "wrong_rate",
    details: "The steward rate went up to £13.50 this month, but I was paid £13.00 an hour.",
  }));
  for (const booking of past.bookings) {
    const i = PAST_OFFICERS.find((n) => workerAt(workers, n).id === booking.workerId);
    if (i === undefined) continue;
    queries.push({
      id: id(`hours/${i}`),
      workerId: booking.workerId,
      shiftId: booking.shiftId,
      workDate: past.day,
      issue: "missing_hours",
      details: "My hours for Saturday aren't on my payslip.",
    });
  }
  queries.push({
    id: id("other/52"),
    workerId: workerAt(workers, 52).id,
    shiftId: null,
    workDate: past.day,
    issue: "other",
    details: "My payslip shows the wrong address.",
  });
  return queries;
}

export interface NightSeed {
  day: string;
  shiftsCreatedAt: Date;
  shifts: ExtraShift[];
  bookings: ExtraBooking[];
}

// Northline workers 0, 1 and 2 (07700 900300 to 900302): booked; worker 2's booking cancelled by
// the office when the seed ran.
export function northlineNight(
  workers: SeedFirm["workers"],
  sites: SeedFirm["sites"],
  now: Date,
): NightSeed {
  const day = addDays(localDateOf(now, TZ), 1);
  const id = (what: string) => seedId(`northline/night/${day}/${what}`);
  const startsAt = at(day, "23:00");
  const endsAt = at(addDays(day, 1), "07:00");
  const bookedAt = new Date(now.getTime() - 72 * HOUR);
  const shifts: ExtraShift[] = [];
  const bookings: ExtraBooking[] = [];
  [0, 1, 2].forEach((i, place) => {
    const shiftId = id(`shift/${place}`);
    const cancelled = place === 2;
    shifts.push({
      id: shiftId,
      siteId: siteOf(sites, seedId("northline/site/junction")),
      role: "track_operative",
      startsAt,
      endsAt,
      status: cancelled ? "open" : "filled",
      instructions: "Possession briefing at the junction compound, 22:30. PPE and PTS card.",
    });
    bookings.push({
      id: id(`booking/${place}`),
      shiftId,
      workerId: workerAt(workers, i).id,
      status: cancelled ? "cancelled_firm" : "confirmed",
      confirmedAt: bookedAt,
      bookedNoticeHours: noticeHours(startsAt, bookedAt),
      cancelledAt: cancelled ? now : null,
      cancelReason: cancelled ? FIRM_CHANGE_REASONS.weather : null,
      noticeHours: cancelled ? noticeHours(startsAt, now) : null,
    });
  });
  return { day, shiftsCreatedAt: new Date(bookedAt.getTime() - 24 * HOUR), shifts, bookings };
}
