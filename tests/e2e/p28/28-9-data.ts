import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import {
  assignments,
  firms,
  officeUsers,
  requests,
  shifts,
  sites,
  workers,
} from "../../../src/lib/db/schema";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { withdrawRequest } from "../../../src/lib/portal/requests";
import { automaticEventId } from "../../../src/lib/roster/shift-events";

// Task 28.9's rows (Phase 28; tests/e2e/casual.p28-requests.spec.ts and
// tests/e2e/office.p28-requests.spec.ts): requests on both sides. Two casuals of these specs' own,
// each in a role nobody else has (no qualification needed), so no other spec's lists change:
//
// - Rhea (the casual's spec): two upcoming bookings at sites with long names (the picker shows
//   them in full), a time change waiting on the first (to take back), and a session three days ago
//   she said she worked, marked again as worked since, whose attendance question the office has
//   answered (an answer she hasn't seen: her marker is set back before it).
// - Idris (the office's spec): a session two days ago marked not attended, with his attendance
//   question waiting, and a swap waiting on an upcoming booking (which the spec takes back with
//   28.2's withdrawRequest, as the app does).
//
// A rerun starts the same way: the last run's upcoming sessions are cancelled and its requests
// still waiting are taken back (bookings and requests are never deleted). Made-up people only:
// drama-range numbers no other spec uses.

export const P28_9_ROLE = "p28_requests_check";
export const P28_9_CASUAL = {
  firstName: "Rhea",
  lastName: "Calloway",
  mobileE164: "+447700900289",
} as const;
export const P28_9_TYPED = "07700 900289";
export const P28_9_OFFICE_CASUAL = {
  firstName: "Idris",
  lastName: "Fenwick",
  mobileE164: "+447700900829",
} as const;
// The two sites' names, long on purpose: a select cut them off on a phone.
export const P28_9_SITES = [
  "Royal Exchange Conference Centre, East Hall",
  "Northern Riverside Stadium, South Stand Gate C",
] as const;

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

const refOf = (id: string) => id.slice(0, 8).toUpperCase();
const HOUR = 3_600_000;

// The casual of a spec's own, in its role (added once, found after), with her last run's
// upcoming sessions cancelled and her requests still waiting taken back.
async function casual(
  tx: FirmTx,
  firmId: string,
  who: { firstName: string; lastName: string; mobileE164: string },
): Promise<string> {
  await tx.execute(sql`
    insert into credential_rules (firm_id, sector, role, required_types)
    values (${firmId}, 'security', ${P28_9_ROLE}, '{}')
    on conflict (firm_id, role) do nothing`);
  await tx
    .insert(workers)
    .values({ firmId, tourSeenAt: new Date(), ...who, roles: [P28_9_ROLE] })
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

// A session of the role at a site (found by name, or added), with `workerId` booked on it.
async function bookedSession(
  tx: FirmTx,
  firmId: string,
  o: { site: string; at: Date; workerId: string; mark: "confirmed" | "completed" | "no_show" },
): Promise<{ shiftId: string; assignmentId: string }> {
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
      role: P28_9_ROLE,
      startsAt: o.at,
      endsAt: new Date(o.at.getTime() + 8 * HOUR),
      headcount: 1,
      status: "filled",
      source: "native",
    })
    .returning({ id: shifts.id });
  if (!shift) throw new Error("shift insert returned nothing");
  const [booking] = await tx
    .insert(assignments)
    .values({
      firmId,
      shiftId: shift.id,
      slot: 1,
      workerId: o.workerId,
      status: o.mark,
      confirmedAt: new Date(o.at.getTime() - 72 * HOUR),
    })
    .returning({ id: assignments.id });
  if (!booking) throw new Error("booking insert returned nothing");
  return { shiftId: shift.id, assignmentId: booking.id };
}

const dayAt = (days: number, hour = 10) => {
  const at = new Date(Date.now() + days * 86_400_000);
  at.setUTCHours(hour, 0, 0, 0);
  return at;
};

export interface CasualRequestsScene {
  workerId: string;
  waitingRef: string; // the time change she takes back
  answeredRef: string; // the attendance question the office answered
  answeredAt: Date;
}

export function casualRequestsScene(slug = "acme"): Promise<CasualRequestsScene> {
  return inFirm(slug, async (tx, firmId) => {
    const workerId = await casual(tx, firmId, P28_9_CASUAL);
    const first = await bookedSession(tx, firmId, {
      site: P28_9_SITES[0],
      at: dayAt(4),
      workerId,
      mark: "confirmed",
    });
    await bookedSession(tx, firmId, {
      site: P28_9_SITES[1],
      at: dayAt(6, 17),
      workerId,
      mark: "confirmed",
    });
    const [waiting] = await tx
      .insert(requests)
      .values({
        firmId,
        workerId,
        shiftId: first.shiftId,
        type: "time_change",
        payload: { start: "11:00", end: "19:00", note: "" },
      })
      .returning({ id: requests.id });
    // Three days ago: marked not attended, she said she worked, the office marked it again as
    // worked on who-worked and answered her question.
    const past = await bookedSession(tx, firmId, {
      site: P28_9_SITES[1],
      at: dayAt(-3),
      workerId,
      mark: "completed",
    });
    const answeredAt = new Date(Date.now() - HOUR);
    // An answer always names who in the office gave it: one of the firm's seeded office users.
    const [office] = await tx
      .select({ id: officeUsers.id })
      .from(officeUsers)
      .where(eq(officeUsers.status, "active"))
      .orderBy(asc(officeUsers.createdAt), asc(officeUsers.id))
      .limit(1);
    if (!office) throw new Error("no office user to answer with");
    const [answered] = await tx
      .insert(requests)
      .values({
        firmId,
        workerId,
        shiftId: past.shiftId,
        type: "attendance",
        payload: { said: "worked", note: "" },
        status: "approved",
        resolvedAt: answeredAt,
        resolvedBy: office.id,
        resolutionNote: "We checked the gate log. Sorry for the mix-up.",
        createdAt: new Date(Date.now() - 20 * HOUR),
      })
      .returning({ id: requests.id });
    if (!waiting || !answered) throw new Error("request insert returned nothing");
    // The answer is one she hasn't seen.
    await tx
      .update(workers)
      .set({ requestsReadAt: new Date(answeredAt.getTime() - 24 * HOUR) })
      .where(eq(workers.id, workerId));
    return { workerId, waitingRef: refOf(waiting.id), answeredRef: refOf(answered.id), answeredAt };
  });
}

// When her answers were last marked seen (null: never).
export function answersReadAt(workerId: string, slug = "acme"): Promise<Date | null> {
  return inFirm(slug, async (tx) => {
    const [row] = await tx
      .select({ at: workers.requestsReadAt })
      .from(workers)
      .where(eq(workers.id, workerId));
    return row?.at ?? null;
  });
}

export interface OfficeRequestsScene {
  workerId: string;
  attendanceId: string;
  attendanceRef: string;
  sessionId: string;
  assignmentId: string;
  swapId: string;
  swapRef: string;
}

export function officeRequestsScene(slug = "acme"): Promise<OfficeRequestsScene> {
  return inFirm(slug, async (tx, firmId) => {
    const workerId = await casual(tx, firmId, P28_9_OFFICE_CASUAL);
    const past = await bookedSession(tx, firmId, {
      site: P28_9_SITES[0],
      at: dayAt(-2),
      workerId,
      mark: "no_show",
    });
    const upcoming = await bookedSession(tx, firmId, {
      site: P28_9_SITES[1],
      at: dayAt(5),
      workerId,
      mark: "confirmed",
    });
    const [attendance] = await tx
      .insert(requests)
      .values({
        firmId,
        workerId,
        shiftId: past.shiftId,
        type: "attendance",
        payload: { said: "worked", note: "I signed in at the north gate." },
      })
      .returning({ id: requests.id });
    const [swap] = await tx
      .insert(requests)
      .values({
        firmId,
        workerId,
        shiftId: upcoming.shiftId,
        type: "swap",
        payload: { swapWith: "", note: "" },
      })
      .returning({ id: requests.id });
    if (!attendance || !swap) throw new Error("request insert returned nothing");
    return {
      workerId,
      attendanceId: attendance.id,
      attendanceRef: refOf(attendance.id),
      sessionId: past.shiftId,
      assignmentId: past.assignmentId,
      swapId: swap.id,
      swapRef: refOf(swap.id),
    };
  });
}

// Idris takes his swap back, as "Take back this request" does (28.2's withdrawRequest).
export async function takeBack(
  workerId: string,
  requestId: string,
  slug = "acme",
): Promise<string> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    const outcome = await withdrawRequest(
      {
        firm: { id: firmId, timezone: "Europe/London", signOff: "Acme Events Shift Team" },
        run: createWithFirm(pool),
      },
      workerId,
      requestId,
    );
    return outcome.status;
  } finally {
    await pool.end();
  }
}

// A booking's mark now (answering never changes it).
export function markOf(assignmentId: string, slug = "acme"): Promise<string | null> {
  return inFirm(slug, async (tx) => {
    const [row] = await tx
      .select({ status: assignments.status })
      .from(assignments)
      .where(eq(assignments.id, assignmentId));
    return row?.status ?? null;
  });
}
