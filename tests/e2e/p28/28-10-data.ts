import { eq, sql } from "drizzle-orm";
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

// Task 28.10's rows (Phase 28; tests/e2e/casual.p28-pay.spec.ts): a casual of this spec's own at
// Acme with a shift she worked 3 days ago (for /pay/query?shift=), two weeks of pay lines from
// payroll (for the pay page after the code), and a pay query payroll sorted half an hour ago with
// a note, after the last time she saw payroll's answers (so the Pay tab counts it until the
// answer is on her screen). Written to the e2e database only (never the dev one), as the app role
// inside Acme, exactly as the app would, the way tests/e2e/db.ts writes its rows (never edited:
// none of its helpers makes these). A rerun adds a fresh shift and a fresh answer, and moves her
// marker back. Made-up details only: a drama-range number no other spec uses.
export const P28_10_CASUAL = {
  firstName: "Nell",
  lastName: "Hadley",
  mobileE164: "+447700900810",
} as const;
// As she types it on the login page.
export const P28_10_TYPED = "07700 900810";
export const P28_10_NOTE = "Paid with Friday's run, at the new rate (28.10).";

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
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function payScene(): Promise<{ workerId: string; shiftId: string }> {
  return inAcme(async (tx, firmId) => {
    await tx
      .insert(workers)
      .values({ firmId, tourSeenAt: new Date(), ...P28_10_CASUAL, roles: ["steward"] })
      .onConflictDoNothing();
    const [worker] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(eq(workers.mobileE164, P28_10_CASUAL.mobileE164));
    if (!worker) throw new Error("the 28.10 casual neither added nor found");

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
      .values({ firmId, name: `Quayside Hall ${stamp}` })
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
        endsAt: new Date(startsAt.getTime() + 8 * 3_600_000),
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

    // Two weeks of pay lines (Monday to Sunday, paid the Friday after), as payroll sends them.
    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7);
    for (const [weeksBack, hours] of [
      [0, "24.00"],
      [1, "16.50"],
    ] as const) {
      const start = new Date(monday.getTime() - weeksBack * 7 * DAY);
      const end = new Date(start.getTime() + 6 * DAY);
      const gross = Math.round(Number(hours) * 1300);
      await tx
        .insert(payRecords)
        .values({
          firmId,
          workerId: worker.id,
          periodStart: ymd(start),
          periodEnd: ymd(end),
          hours,
          ratePence: 1300,
          grossPence: gross,
          payDate: ymd(new Date(end.getTime() + 5 * DAY)),
        })
        .onConflictDoNothing();
    }

    // Payroll's answer, sorted half an hour ago; she last saw payroll's answers two hours ago.
    const [payroll] = await tx.select({ id: officeUsers.id }).from(officeUsers).limit(1);
    if (!payroll) throw new Error("no office user to sort the pay query");
    const sortedAt = new Date(Date.now() - 30 * 60_000);
    await tx.insert(payQueries).values({
      firmId,
      workerId: worker.id,
      shiftId: shift.id,
      workDate: ymd(startsAt),
      issueType: "wrong_rate",
      status: "resolved",
      resolvedBy: payroll.id,
      resolvedAt: sortedAt,
      resolutionNote: P28_10_NOTE,
      createdAt: new Date(Date.now() - DAY),
    });
    await tx
      .update(workers)
      .set({ payAnswersReadAt: new Date(Date.now() - 2 * 3_600_000) })
      .where(eq(workers.id, worker.id));
    return { workerId: worker.id, shiftId: shift.id };
  });
}

// Payroll's answers she hasn't seen (the Pay tab's number, 28.7 shows it), read as the app does.
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
