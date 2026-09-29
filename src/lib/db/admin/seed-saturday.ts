import { requestPayloadSchemas } from "../../portal/request-kinds";
import { noticeHours } from "../../roster/notice";
import { addDays, localDateOf, zonedToUtc } from "../../time/zoned";
import { rng, seedId, type SeedFirm } from "./seed-data";

// Acme's Saturday event day for the demo (docs/testing.md, "Fixtures and the demo seed"): a pure
// builder, loaded by seed.ts. Fake data only (golden rule 7).
//
// - The next Saturday after the day the seed runs: 40 shifts across Acme's three sites, each
//   with instructions; 32 booked by workers who hold the right licence, 8 open.
// - The urgent dropout: the early door supervisor at the arena was booked, then the worker
//   cancelled at 06:00 on the day the seed runs (or just now, before 06:00), giving notice; the
//   shift is open again and marked urgent.
// - Two open requests from booked workers: a time change and a swap.
// - Pay records for every Acme worker for the last 8 complete weeks, as payroll's file would
//   give them (hours, rate, gross, pay date).
// Workers 0 to FREE_WORKERS - 1 (07700 900100 to 900104) are never booked: free for a demo login.
// Ids are fixed and include the Saturday's date, so a re-run the same week adds nothing and a
// re-run the next week adds that week's Saturday without moving anything already booked. The
// shifts are dated a week before the seed ran (before any booking); the action log's entries are
// dated when the seed ran (the log can't be backdated).

const TZ = "Europe/London";
const HOUR = 3_600_000;
export const FREE_WORKERS = 5;

export interface SaturdaySeed {
  day: string; // the Saturday, yyyy-mm-dd (London)
  urgentShiftId: string; // the dropout's shift, for the seed's summary (a link to open in a demo)
  shiftsCreatedAt: Date; // a week before the seed ran: before every seeded booking
  shifts: {
    id: string;
    siteId: string;
    role: string;
    startsAt: Date;
    endsAt: Date;
    status: "open" | "filled";
    isUrgent: boolean;
    instructions: string;
  }[];
  bookings: {
    id: string;
    shiftId: string;
    workerId: string;
    status: "confirmed" | "cancelled_worker";
    confirmedAt: Date;
    cancelledAt: Date | null;
    cancelReason: string | null;
    noticeHours: number | null; // only for the cancellation
    bookedNoticeHours: number; // shift start minus when it was booked, for the log
  }[];
  requests: {
    id: string;
    workerId: string;
    shiftId: string;
    type: "time_change" | "swap";
    payload: Record<string, unknown>;
  }[];
  pay: {
    id: string;
    workerId: string;
    periodStart: string;
    periodEnd: string;
    hours: string; // numeric(6,2) as payroll wrote it
    ratePence: number;
    grossPence: number;
    payDate: string;
  }[];
}

// Monday = 0 ... Sunday = 6, for a yyyy-mm-dd date.
const weekday = (isoDate: string) => (new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7;

export function nextSaturday(today: string): string {
  let d = addDays(today, 1);
  while (weekday(d) !== 5) d = addDays(d, 1);
  return d;
}

const at = (date: string, time: string) => {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return zonedToUtc({ year, month, day, hour, minute }, TZ);
};

// The day's plan: [key, site, role, start, end, places, the workers booked (by index)].
const PLAN: {
  key: string;
  site: "stadium" | "racecourse" | "centre";
  role: string;
  start: string;
  end: string;
  places: number;
  booked: number[];
  instructions: string;
}[] = [
  {
    key: "arena-steward",
    site: "stadium",
    role: "steward",
    start: "12:00",
    end: "18:30",
    places: 14,
    booked: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    instructions: "Steward briefing at Gate C at 11:45. Hi-vis and radio provided.",
  },
  {
    key: "arena-door",
    site: "stadium",
    role: "door_supervisor",
    start: "11:30",
    end: "19:00",
    places: 8,
    booked: [30, 31, 32, 33, 34, 35, 36],
    instructions: "Search lanes at Gate A. Briefing at 11:15 in the control room.",
  },
  {
    key: "arena-door-early",
    site: "stadium",
    role: "door_supervisor",
    start: "08:00",
    end: "16:00",
    places: 1,
    booked: [], // worker 37 booked it and dropped out: see the dropout below
    instructions: "Early start: key handover in the control room at 07:50, then the main gates.",
  },
  {
    key: "race-steward",
    site: "racecourse",
    role: "steward",
    start: "10:30",
    end: "18:30",
    places: 6,
    booked: [16, 17, 18, 19, 20],
    instructions: "Enclosure stewarding. Meet at the Main Stand office at 10:15.",
  },
  {
    key: "race-security",
    site: "racecourse",
    role: "security_officer",
    start: "09:00",
    end: "19:00",
    places: 4,
    booked: [48, 49, 50],
    instructions: "Car park patrols. Collect a radio from the control room.",
  },
  {
    key: "centre-security-early",
    site: "centre",
    role: "security_officer",
    start: "07:00",
    end: "15:00",
    places: 4,
    booked: [51, 52, 53, 54],
    instructions: "Sign in at the security office on Level 1.",
  },
  {
    key: "centre-security-late",
    site: "centre",
    role: "security_officer",
    start: "15:00",
    end: "23:00",
    places: 3,
    booked: [55, 56],
    instructions: "Sign in at the security office on Level 1. Lock-up walk at 22:30.",
  },
];
const DROPOUT = { key: "arena-door-early", worker: 37, reason: "I'm unwell" };

// Hourly rates, all comfortably above the National Living Wage (so no demo shows pay under it).
const RATE_PENCE: Record<string, number> = {
  steward: 1300,
  door_supervisor: 1450,
  security_officer: 1350,
};
const HOURS = ["8.00", "10.50", "16.00", "21.00", "24.00", "32.00", "37.50"];

export function acmeSaturday(
  workers: SeedFirm["workers"],
  sites: SeedFirm["sites"],
  now: Date,
): SaturdaySeed {
  const today = localDateOf(now, TZ);
  const day = nextSaturday(today);
  const siteId = (key: string) => {
    const site = sites.find((s) => s.id === seedId(`acme/site/${key}`));
    if (!site) throw new Error(`no seeded site ${key}`);
    return site.id;
  };
  const worker = (i: number) => {
    const w = workers[i];
    if (!w) throw new Error(`no seeded worker ${i}`);
    if (i < FREE_WORKERS) throw new Error(`worker ${i} must stay free for demo logins`);
    return w;
  };
  const id = (what: string) => seedId(`acme/saturday/${day}/${what}`);

  const shifts: SaturdaySeed["shifts"] = [];
  const bookings: SaturdaySeed["bookings"] = [];
  let n = 0;
  for (const p of PLAN) {
    for (let place = 0; place < p.places; place++) {
      const shiftId = id(`shift/${p.key}/${place}`);
      const startsAt = at(day, p.start);
      const bookedBy = p.booked[place];
      shifts.push({
        id: shiftId,
        siteId: siteId(p.site),
        role: p.role,
        startsAt,
        endsAt: at(day, p.end),
        status: bookedBy === undefined ? "open" : "filled",
        isUrgent: p.key === DROPOUT.key,
        instructions: p.instructions,
      });
      if (bookedBy !== undefined) {
        const confirmedAt = new Date(now.getTime() - (72 + n) * HOUR);
        n += 1;
        bookings.push({
          id: id(`booking/${p.key}/${place}`),
          shiftId,
          workerId: worker(bookedBy).id,
          status: "confirmed",
          confirmedAt,
          cancelledAt: null,
          cancelReason: null,
          noticeHours: null,
          bookedNoticeHours: noticeHours(startsAt, confirmedAt),
        });
      }
    }
  }

  // The dropout: booked three days ago, cancelled at 06:00 today (or now, if that's still ahead).
  const dropoutShift = id(`shift/${DROPOUT.key}/0`);
  const dropoutStart = at(day, "08:00");
  const six = at(today, "06:00");
  const cancelledAt = six.getTime() <= now.getTime() ? six : now;
  const bookedAt = new Date(now.getTime() - 72 * HOUR);
  bookings.push({
    id: id(`booking/${DROPOUT.key}/0`),
    shiftId: dropoutShift,
    workerId: worker(DROPOUT.worker).id,
    status: "cancelled_worker",
    confirmedAt: bookedAt,
    cancelledAt,
    cancelReason: DROPOUT.reason,
    noticeHours: noticeHours(dropoutStart, cancelledAt),
    bookedNoticeHours: noticeHours(dropoutStart, bookedAt),
  });

  const firstShift = (key: string) => id(`shift/${key}/0`);
  const colleague = worker(21);
  const requests: SaturdaySeed["requests"] = [
    {
      id: id("request/time-change"),
      workerId: worker(5).id,
      shiftId: firstShift("arena-steward"),
      type: "time_change",
      payload: requestPayloadSchemas.time_change.parse({
        start: "13:00",
        end: "18:30",
        note: "My train gets in at 12:40.",
      }),
    },
    {
      id: id("request/swap"),
      workerId: worker(16).id,
      shiftId: firstShift("race-steward"),
      type: "swap",
      payload: requestPayloadSchemas.swap.parse({
        swapWith: `${colleague.firstName} ${colleague.lastName}`,
        note: "Family wedding. Happy to take a Sunday instead.",
      }),
    },
  ];

  // Pay: the 8 complete Monday-to-Sunday weeks before this one, paid the Friday after.
  const thisMonday = addDays(today, -weekday(today));
  const pay: SaturdaySeed["pay"] = [];
  workers.forEach((w, i) => {
    const r = rng(1000 + i);
    const rate = RATE_PENCE[w.roles[0] ?? "steward"] ?? RATE_PENCE.steward ?? 1300;
    for (let week = 1; week <= 8; week++) {
      // Most weeks worked; the last complete week always, so everyone has something to see.
      if (week > 1 && r() < 0.35) continue;
      const periodStart = addDays(thisMonday, -7 * week);
      const periodEnd = addDays(periodStart, 6);
      const hours = HOURS[Math.floor(r() * HOURS.length)] ?? "16.00";
      pay.push({
        id: seedId(`acme/pay/${i}/${periodStart}`),
        workerId: w.id,
        periodStart,
        periodEnd,
        hours,
        ratePence: rate,
        grossPence: Math.round(Number(hours) * rate),
        payDate: addDays(periodEnd, 5),
      });
    }
  });

  return {
    day,
    urgentShiftId: dropoutShift,
    shiftsCreatedAt: new Date(now.getTime() - 7 * 24 * HOUR),
    shifts,
    bookings,
    requests,
    pay,
  };
}
