import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import { assignments, firms, requests, shifts, sites, workers } from "../../../src/lib/db/schema";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { automaticEventId } from "../../../src/lib/roster/shift-events";

// Task 28.13's rows (Phase 28; tests/e2e/casual.p28-booked.spec.ts and the past booking in
// tests/e2e/offline.worker.spec.ts): Booked's Past 90 days. A casual of this spec's own, Bryony, in
// a role nobody else has (no qualification needed), so no other spec's lists change:
//
// - one upcoming booking (3 days ahead), so Upcoming has its pass;
// - a session 5 days ago marked not attended (the one she questions), one 40 days ago marked worked
//   (outside the old 30 days, inside reliability's 90), and one 2 days ago not marked yet;
// - each run's sessions at sites named for the run, so a rerun's rows are told apart from the last
//   run's (bookings and requests are never deleted; the last run's upcoming sessions are cancelled
//   and its waiting requests taken back).
//
// Made-up people only: drama-range numbers no other spec uses.

export const P28_13_ROLE = "p28_booked_check";
export const P28_13_CASUAL = {
  firstName: "Bryony",
  lastName: "Ashdown",
  mobileE164: "+447700900313",
} as const;
export const P28_13_TYPED = "07700 900313";

// The e2e database (never the dev one), as the app role, as tests/e2e/db.ts writes its rows.
function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

async function inFirm<T>(slug: string, fn: (tx: FirmTx, firmId: string) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, (tx) => fn(tx, firmId));
  } finally {
    await pool.end();
  }
}

const HOUR = 3_600_000;

// A casual of a spec's own, in her role (added once, found after), with her last run's upcoming
// sessions cancelled and her requests still waiting taken back.
async function casual(
  tx: FirmTx,
  firmId: string,
  who: { firstName: string; lastName: string; mobileE164: string },
  role: string,
): Promise<string> {
  await tx.execute(sql`
    insert into credential_rules (firm_id, sector, role, required_types)
    values (${firmId}, 'security', ${role}, '{}')
    on conflict (firm_id, role) do nothing`);
  await tx
    .insert(workers)
    .values({ firmId, ...who, roles: [role] })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ id: workers.id })
    .from(workers)
    .where(eq(workers.mobileE164, who.mobileE164));
  if (!row) throw new Error(`${who.firstName} neither added nor found`);
  const mine = tx
    .select({ id: assignments.shiftId })
    .from(assignments)
    .where(eq(assignments.workerId, row.id));
  await tx
    .update(shifts)
    .set({ status: "cancelled" })
    .where(and(inArray(shifts.id, mine), gt(shifts.startsAt, new Date())));
  await tx
    .update(requests)
    .set({ status: "withdrawn", resolvedAt: new Date(), resolvedBy: null })
    .where(and(eq(requests.workerId, row.id), inArray(requests.status, ["open", "escalated"])));
  return row.id;
}

// A session of the role at a site (found by name, or added), 8 hours long (or `hours`), with
// `workerId` booked on it and marked as given.
async function bookedSession(
  tx: FirmTx,
  firmId: string,
  o: {
    site: string;
    role: string;
    at: Date;
    hours?: number;
    workerId: string;
    mark: "confirmed" | "completed" | "no_show";
  },
): Promise<string> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  await tx.insert(sites).values({ firmId, name: o.site }).onConflictDoNothing();
  const [site] = await tx.select({ id: sites.id }).from(sites).where(eq(sites.name, o.site));
  if (!site) throw new Error(`no site ${o.site}`);
  const [shift] = await tx
    .insert(shifts)
    .values({
      firmId,
      siteId: site.id,
      shiftEventId: await automaticEventId(tx, {
        siteId: site.id,
        startsAt: o.at,
        source: "native",
        timeZone: firm?.timezone ?? "Europe/London",
      }),
      role: o.role,
      startsAt: o.at,
      endsAt: new Date(o.at.getTime() + (o.hours ?? 8) * HOUR),
      headcount: 1,
      status: "filled",
      source: "native",
    })
    .returning({ id: shifts.id });
  if (!shift) throw new Error("shift insert returned nothing");
  await tx.insert(assignments).values({
    firmId,
    shiftId: shift.id,
    slot: 1,
    workerId: o.workerId,
    status: o.mark,
    confirmedAt: new Date(o.at.getTime() - 72 * HOUR),
  });
  return shift.id;
}

const dayAt = (days: number, hour = 10) => {
  const at = new Date(Date.now() + days * 86_400_000);
  at.setUTCHours(hour, 0, 0, 0);
  return at;
};

export interface BookedScene {
  workerId: string;
  run: string;
  sites: { upcoming: string; missed: string; worked: string; unmarked: string };
  missedId: string; // marked not attended 5 days ago: the one she questions
  workedId: string; // marked worked 40 days ago
  unmarkedId: string; // 2 days ago, not marked yet
}

export function bookedScene(slug = "acme"): Promise<BookedScene> {
  const run = Date.now().toString(36).slice(-5).toUpperCase();
  const sites = {
    upcoming: `Booked Check Upcoming Hall ${run}`,
    missed: `Booked Check North Gate ${run}`,
    worked: `Booked Check Riverside ${run}`,
    unmarked: `Booked Check Exchange ${run}`,
  };
  return inFirm(slug, async (tx, firmId) => {
    const workerId = await casual(tx, firmId, P28_13_CASUAL, P28_13_ROLE);
    const role = P28_13_ROLE;
    await bookedSession(tx, firmId, {
      site: sites.upcoming,
      role,
      at: dayAt(3),
      workerId,
      mark: "confirmed",
    });
    const missedId = await bookedSession(tx, firmId, {
      site: sites.missed,
      role,
      at: dayAt(-5),
      workerId,
      mark: "no_show",
    });
    const workedId = await bookedSession(tx, firmId, {
      site: sites.worked,
      role,
      at: dayAt(-40),
      hours: 6.5,
      workerId,
      mark: "completed",
    });
    const unmarkedId = await bookedSession(tx, firmId, {
      site: sites.unmarked,
      role,
      at: dayAt(-2),
      workerId,
      mark: "confirmed",
    });
    return { workerId, run, sites, missedId, workedId, unmarkedId };
  });
}

// Her newest attendance question on a session: its id (for the office's `#request-{id}`) and
// status, or null.
export function attendanceQuestion(
  workerId: string,
  shiftId: string,
  slug = "acme",
): Promise<{ id: string; status: string } | null> {
  return inFirm(slug, async (tx) => {
    const [row] = await tx
      .select({ id: requests.id, status: requests.status })
      .from(requests)
      .where(
        and(
          eq(requests.workerId, workerId),
          eq(requests.shiftId, shiftId),
          eq(requests.type, "attendance"),
        ),
      )
      .orderBy(desc(requests.createdAt))
      .limit(1);
    return row ?? null;
  });
}

// A booking's mark as it is now (a question never changes it).
export function markNow(workerId: string, shiftId: string, slug = "acme"): Promise<string | null> {
  return inFirm(slug, async (tx) => {
    const [row] = await tx
      .select({ status: assignments.status })
      .from(assignments)
      .where(and(eq(assignments.workerId, workerId), eq(assignments.shiftId, shiftId)));
    return row?.status ?? null;
  });
}

// A past session for another spec's casual (offline.worker.spec.ts: the kept copy of /shifts holds
// no past row): marked worked `daysAgo` days ago at a site of its own, at a pay rate no upcoming
// shift of hers has (£17.43), so a past row's site or pay showing up in the copy is caught.
export const PAST_RATE_PENCE = 1743;
export function addPastWorkedShift(
  workerId: string,
  o: { site: string; daysAgo: number },
  slug = "acme",
): Promise<string> {
  return inFirm(slug, async (tx, firmId) => {
    const id = await bookedSession(tx, firmId, {
      site: o.site,
      role: "steward",
      at: dayAt(-o.daysAgo),
      workerId,
      mark: "completed",
    });
    await tx.update(shifts).set({ payRatePence: PAST_RATE_PENCE }).where(eq(shifts.id, id));
    return id;
  });
}
