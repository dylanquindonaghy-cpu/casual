import { and, eq, inArray, like, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import {
  assignments,
  firms,
  payRecords,
  shiftEvents,
  shifts,
  sites,
} from "../../../src/lib/db/schema";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { automaticEventId } from "../../../src/lib/roster/shift-events";
import { addBookedShift, addEventWithSession, addSteward, cancelOwnShift } from "../db";

// Task 28.16's rows (Phase 28; tests/e2e/casual.p28-unseen.spec.ts): the pages the review couldn't
// see, each with something on it, for a casual of this spec's own at Acme. Built with
// tests/e2e/db.ts's helpers (imported, never edited) and a few rows of its own written as the app
// role inside Acme, exactly as the app would. Made-up details only, on drama-range numbers no
// other spec or the seed uses:
//
// - Rhea, a steward (STEWARD_L2, valid: addSteward), and Cal, a steward with no hours that week
//   (so fair rotation holds Rhea's "held" session for him: the lowest hours first);
// - Rhea's booking on a Tuesday at least 3 days ahead, 06:00 to 14:00 UTC (the Booked page's
//   "Can't make it?" opens the cancel sheet on it; and it gives her 8 hours that week);
// - open steward sessions of events of the spec's own, in that same Monday-to-Sunday week:
//   "held" on the Thursday at 18:00 (Acme shares out new places by fair rotation, the lowest
//   hours that week first, and she has 8), "blocked" on the Tuesday at 09:00 (she's already booked
//   then: the rules' overlap reason), and "ask" on the Friday at 12:00 (its event's "Casuals ask,
//   you choose" on: "I can do this");
// - four open steward sessions on the Tuesdays 1, 2, 3 and 4 weeks later at 10:00, 4 hours each,
//   one a week so she has no hours that week when she takes it (fair rotation holds none of them
//   from her): one to take at each size and theme ("You're booked.");
// - a shift she worked 3 days ago and two weeks of pay lines from payroll (Pay after the code, and
//   /pay/query?shift= with it).
//
// A rerun starts the same way: the last run's sessions (its sites are named "P28.16 …") and her
// live bookings' sessions are cancelled first. `endUnseenScene` cancels this run's open sessions.
export const P28_16_RHEA = {
  firstName: "Rhea",
  lastName: "Calloway",
  mobileE164: "+447700900816",
} as const;
// As she types it on the login page.
export const P28_16_TYPED = "07700 900816";
export const P28_16_CAL = {
  firstName: "Cal",
  lastName: "Breen",
  mobileE164: "+447700900916",
} as const;

const SITE_PREFIX = "P28.16 ";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

async function inAcme<T>(work: (tx: FirmTx, firmId: string) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId("firm/acme");
    return await createWithFirm(pool)(firmId, (tx) => work(tx, firmId));
  } finally {
    await pool.end();
  }
}

// The first Tuesday, 00:00 UTC, at least 3 days from now (Monday to Sunday is one week in UTC and
// in London alike for the times used here: 06:00 to 22:00).
function tuesdayAhead(now = Date.now()): Date {
  const at = new Date(now + 3 * DAY);
  at.setUTCHours(0, 0, 0, 0);
  while (at.getUTCDay() !== 2) at.setTime(at.getTime() + DAY);
  return at;
}

// The helpers take "days from now" and round down to the hour: a time on the hour, as days ahead.
const daysUntil = (at: Date) => (at.getTime() - Date.now()) / DAY;

export interface UnseenScene {
  workerId: string;
  booked: string; // her Tuesday booking (the cancel sheet)
  held: string;
  blocked: string;
  ask: string;
  toTake: string[]; // four, one per size and theme
  worked: string; // the shift she worked 3 days ago (/pay/query?shift=)
}

export async function unseenScene(): Promise<UnseenScene> {
  const workerId = await addSteward("acme", P28_16_RHEA);
  await addSteward("acme", P28_16_CAL);

  // The last run's sessions, and her live bookings' sessions.
  await inAcme(async (tx) => {
    const ours = tx
      .select({ id: sites.id })
      .from(sites)
      .where(like(sites.name, `${SITE_PREFIX}%`));
    await tx
      .update(shifts)
      .set({ status: "cancelled" })
      .where(and(inArray(shifts.siteId, ours), sql`${shifts.status} <> 'cancelled'`));
    const mine = tx
      .select({ id: assignments.shiftId })
      .from(assignments)
      .where(and(eq(assignments.workerId, workerId), eq(assignments.status, "confirmed")));
    await tx.update(shifts).set({ status: "cancelled" }).where(inArray(shifts.id, mine));
  });

  const stamp = Date.now().toString(36);
  const tuesday = tuesdayAhead();
  const at = (days: number, hour: number) => new Date(tuesday.getTime() + days * DAY + hour * HOUR);

  const { shiftId: booked } = await addBookedShift("acme", {
    workerId,
    daysAhead: daysUntil(at(0, 6)),
    site: `${SITE_PREFIX}Booked Hall ${stamp}`,
  });
  const session = (name: string, start: Date) =>
    addEventWithSession("acme", {
      name: `P28.16 ${name} ${stamp}`,
      site: `${SITE_PREFIX}${name} Hall ${stamp}`,
      role: "steward",
      daysAhead: daysUntil(start),
      hours: 4,
    });
  const held = (await session("Held", at(2, 18))).shiftId;
  const blocked = (await session("Blocked", at(0, 9))).shiftId;
  const askSession = await session("Ask", at(3, 12));
  const toTake: string[] = [];
  for (const [i, days] of [7, 14, 21, 28].entries())
    toTake.push((await session(`Take ${i + 1}`, at(days, 10))).shiftId);

  const worked = await inAcme(async (tx, firmId) => {
    // "Casuals ask, you choose" on the ask session's event.
    await tx
      .update(shiftEvents)
      .set({ casualsAsk: true })
      .where(eq(shiftEvents.id, askSession.eventId));

    // The shift she worked, 3 days ago, at a site of its own, in its automatic event.
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, firmId));
    const startsAt = new Date(Date.now() - 3 * DAY);
    startsAt.setUTCHours(9, 0, 0, 0);
    const [site] = await tx
      .insert(sites)
      .values({ firmId, name: `${SITE_PREFIX}Worked Hall ${stamp}` })
      .returning({ id: sites.id });
    if (!site) throw new Error("site insert returned nothing");
    const [shift] = await tx
      .insert(shifts)
      .values({
        firmId,
        shiftEventId: await automaticEventId(tx, {
          siteId: site.id,
          startsAt,
          source: "native",
          timeZone: firm?.timezone ?? "Europe/London",
        }),
        role: "steward",
        siteId: site.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 8 * HOUR),
        headcount: 1,
        status: "filled",
        source: "native",
        payRatePence: 1300,
      })
      .returning({ id: shifts.id });
    if (!shift) throw new Error("shift insert returned nothing");
    await tx.insert(assignments).values({
      firmId,
      shiftId: shift.id,
      slot: 1,
      workerId,
      status: "completed",
      confirmedAt: new Date(startsAt.getTime() - 4 * DAY),
    });

    // Two weeks of pay lines (Monday to Sunday, paid the Friday after), as payroll sends them.
    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7);
    for (const [weeksBack, hours] of [
      [0, "20.00"],
      [1, "12.50"],
    ] as const) {
      const start = new Date(monday.getTime() - weeksBack * 7 * DAY);
      const end = new Date(start.getTime() + 6 * DAY);
      await tx
        .insert(payRecords)
        .values({
          firmId,
          workerId,
          periodStart: ymd(start),
          periodEnd: ymd(end),
          hours,
          ratePence: 1300,
          grossPence: Math.round(Number(hours) * 1300),
          payDate: ymd(new Date(end.getTime() + 5 * DAY)),
        })
        .onConflictDoNothing();
    }
    return shift.id;
  });

  return { workerId, booked, held, blocked, ask: askSession.shiftId, toTake, worked };
}

// Done: this run's open sessions cancelled, so no later spec sees their places.
export async function endUnseenScene(s: UnseenScene): Promise<void> {
  for (const id of [s.held, s.blocked, s.ask, ...s.toTake]) await cancelOwnShift("acme", id);
}
