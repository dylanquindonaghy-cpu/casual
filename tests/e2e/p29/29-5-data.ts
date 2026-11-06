import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import {
  assignments,
  firms,
  officeUsers,
  payQueries,
  payRecords,
  shifts,
  sites,
  workers,
} from "../../../src/lib/db/schema";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { unseenPayAnswers } from "../../../src/lib/portal/request-answers";
import { automaticEventId } from "../../../src/lib/roster/shift-events";
import { addBookedShift } from "../db";

// Task 29.5's rows (Phase 29; tests/e2e/casual.p29-pay-count.spec.ts), in Acme's e2e database:
//
// - a casual of this spec's own with a shift she worked 3 days ago, a week of pay lines from
//   payroll, and exactly one answer from payroll she hasn't seen (a pay query sorted half an hour
//   ago, after the last time she saw payroll's answers), so the Pay tab shows "1";
// - her booking 3 days ahead with a meeting point, instructions and a pay rate (the booked shift's
//   page, for docs/mockups/phase-28/after/).
//
// Written as the app role inside Acme, exactly as the app would, the way tests/e2e/p28/28-10-data.ts
// writes its own (tests/e2e/db.ts is imported, never edited). A rerun adds a fresh shift, a fresh
// answer and a fresh booking; the answers of earlier runs are moved back before her marker, so only
// this run's answer counts. Made-up details only: a drama-range number no other spec uses.
export const P29_5_CASUAL = {
  firstName: "Ivy",
  lastName: "Marlowe",
  mobileE164: "+447700900295",
} as const;
// As she types it on the login page.
export const P29_5_TYPED = "07700 900295";
export const P29_5_NOTE = "Your hours are on Friday's run (29.5).";

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

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface PayCountScene {
  workerId: string;
  booked: string; // her booking 3 days ahead
}

export async function payCountScene(): Promise<PayCountScene> {
  const workerId = await inAcme(async (tx, firmId) => {
    await tx
      .insert(workers)
      .values({ firmId, ...P29_5_CASUAL, roles: ["steward"] })
      .onConflictDoNothing();
    const [worker] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(eq(workers.mobileE164, P29_5_CASUAL.mobileE164));
    if (!worker) throw new Error("the 29.5 casual neither added nor found");

    // The shift she worked, 3 days ago, at a site of its own.
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    const startsAt = new Date(Date.now() - 3 * DAY);
    startsAt.setUTCHours(9, 0, 0, 0);
    const stamp = Date.now().toString(36);
    const [site] = await tx
      .insert(sites)
      .values({ firmId, name: `P29.5 Harbour Hall ${stamp}` })
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
      workerId: worker.id,
      status: "completed",
      confirmedAt: new Date(startsAt.getTime() - 4 * DAY),
    });

    // Last week's pay line (Monday to Sunday, paid the Friday after), as payroll sends it.
    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7);
    const sunday = new Date(monday.getTime() + 6 * DAY);
    await tx
      .insert(payRecords)
      .values({
        firmId,
        workerId: worker.id,
        periodStart: ymd(monday),
        periodEnd: ymd(sunday),
        hours: "8.00",
        ratePence: 1300,
        grossPence: 8 * 1300,
        payDate: ymd(new Date(sunday.getTime() + 5 * DAY)),
      })
      .onConflictDoNothing();

    // Earlier runs' answers: moved back before her marker, so they no longer count.
    await tx
      .update(payQueries)
      .set({ resolvedAt: new Date(Date.now() - 3 * HOUR) })
      .where(and(eq(payQueries.workerId, worker.id), eq(payQueries.status, "resolved")));

    // Payroll's answer, sorted half an hour ago; she last saw payroll's answers two hours ago.
    const [payroll] = await tx.select({ id: officeUsers.id }).from(officeUsers).limit(1);
    if (!payroll) throw new Error("no office user to sort the pay query");
    await tx.insert(payQueries).values({
      firmId,
      workerId: worker.id,
      shiftId: shift.id,
      workDate: ymd(startsAt),
      issueType: "missing_hours",
      status: "resolved",
      resolvedBy: payroll.id,
      resolvedAt: new Date(Date.now() - 30 * 60_000),
      resolutionNote: P29_5_NOTE,
      createdAt: new Date(Date.now() - DAY),
    });
    await tx
      .update(workers)
      .set({ payAnswersReadAt: new Date(Date.now() - 2 * HOUR) })
      .where(eq(workers.id, worker.id));
    return worker.id;
  });

  // Her booking 3 days ahead, with what the shift's page shows a booked casual.
  const { shiftId: booked } = await addBookedShift("acme", {
    workerId,
    daysAhead: 3,
    site: `P29.5 Riverside Arena ${Date.now().toString(36)}`,
  });
  await inAcme(async (tx) => {
    await tx
      .update(shifts)
      .set({
        meetingPoint: "Staff gate on Wharf Road",
        instructions: "Ask for the steward lead at the gate.",
        payRatePence: 1350,
      })
      .where(eq(shifts.id, booked));
  });
  return { workerId, booked };
}

// Payroll's answers she hasn't seen (the Pay tab's number), read as the app does.
export async function payAnswersUnseen(workerId: string): Promise<number> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    return await unseenPayAnswers(
      { firm: { id: seedId("firm/acme") }, run: createWithFirm(pool) },
      workerId,
    );
  } finally {
    await pool.end();
  }
}
