import { and, arrayContains, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { seedId } from "../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../src/lib/db/admin/urls";
import {
  assignments,
  credentials,
  firms,
  officeUsers,
  requests,
  shifts,
  sites,
  strikes,
  uploads,
  workers,
  workerTravel,
} from "../../src/lib/db/schema";
import { createWithFirm } from "../../src/lib/db/scoped";
import type { FirmTx } from "../../src/lib/db/scoped";
import { bookShift } from "../../src/lib/roster/book";
import { cancelBooking } from "../../src/lib/roster/cancel";
import { automaticEventId, createNamedEvent } from "../../src/lib/roster/shift-events";
import { fakePoint } from "../../src/lib/travel/geocoder";

// Rows an e2e test needs that the seed doesn't have yet, written to the e2e database (never the
// dev one) as the app role, inside the seeded firm, exactly as the app would.
function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

// A shift's event: its site and day's automatic one, as "New shift" and the imports do.
async function eventFor(tx: FirmTx, siteId: string | null, startsAt: Date): Promise<string> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return automaticEventId(tx, {
    siteId,
    startsAt,
    source: "native",
    timeZone: firm?.timezone ?? "Europe/London",
  });
}

// The owner's address for the e2e database (never the dev one), for owner-only changes such as a
// firm's brand (scripts/firm-brand-owner.ts).
export function e2eAdminUrl(): string {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

// One firm setting for a seeded firm, in the e2e database (never the dev one): `value`, or
// undefined to remove it. Returns what was there before (undefined if nothing), so a test can put
// it back. Firms are the owner's to change (the app role can only read them); RLS is forced for the
// owner too, so it sets the firm first, like the seed.
export async function setFirmSetting(slug: string, key: string, value: unknown): Promise<unknown> {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  const pool = new Pool({
    connectionString: withDatabase(url, `${databaseName(url)}_e2e`),
    max: 1,
  });
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    await client.query("begin");
    try {
      await client.query("select set_config('app.current_firm_id', $1, true)", [firmId]);
      const before = await client.query<{ value: unknown }>(
        "select settings -> $2::text as value from firms where id = $1 for update",
        [firmId, key],
      );
      if (before.rowCount !== 1) throw new Error(`firm ${slug} not found`);
      await client.query(
        value === undefined
          ? "update firms set settings = settings - $2::text where id = $1"
          : "update firms set settings = settings || jsonb_build_object($2::text, $3::jsonb) where id = $1",
        value === undefined ? [firmId, key] : [firmId, key, JSON.stringify(value)],
      );
      await client.query("commit");
      return before.rows[0]?.value ?? undefined;
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// An open shift for a seeded firm ("acme" or "northline"), starting `daysAhead` days from now.
export async function addOpenShift(
  slug: string,
  o: { role: string; daysAhead: number; hours?: number; headcount?: number },
): Promise<string> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    // Where the pool really connected, not only what the URL says.
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    const startsAt = new Date(Date.now() + o.daysAhead * 86_400_000);
    startsAt.setUTCMinutes(0, 0, 0);
    const [row] = await createWithFirm(pool)(firmId, async (tx) =>
      tx
        .insert(shifts)
        .values({
          firmId,
          shiftEventId: await eventFor(tx, null, startsAt),
          role: o.role,
          startsAt,
          endsAt: new Date(startsAt.getTime() + (o.hours ?? 8) * 3_600_000),
          headcount: o.headcount ?? 1,
          status: "open",
          source: "native",
        })
        .returning({ id: shifts.id }),
    );
    if (!row) throw new Error("shift insert returned nothing");
    return row.id;
  } finally {
    await pool.end();
  }
}

// An event of a spec's own (named, as "Shifts for an event" makes) holding one open session at a
// site of its own (`site`, so a casual's list can find it), starting `daysAhead` days from now:
// switching it off can't hide another spec's shifts.
export async function addEventWithSession(
  slug: string,
  o: { name: string; site: string; role: string; daysAhead: number; hours?: number },
): Promise<{ eventId: string; shiftId: string }> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    const startsAt = new Date(Date.now() + o.daysAhead * 86_400_000);
    startsAt.setUTCMinutes(0, 0, 0);
    return await createWithFirm(pool)(firmId, async (tx) => {
      const [site] = await tx
        .insert(sites)
        .values({ firmId, name: o.site })
        .returning({ id: sites.id });
      if (!site) throw new Error("site insert returned nothing");
      const eventId = await createNamedEvent(tx, { name: o.name, siteId: site.id });
      const [row] = await tx
        .insert(shifts)
        .values({
          firmId,
          siteId: site.id,
          shiftEventId: eventId,
          role: o.role,
          startsAt,
          endsAt: new Date(startsAt.getTime() + (o.hours ?? 8) * 3_600_000),
          headcount: 1,
          status: "open",
          source: "native",
        })
        .returning({ id: shifts.id });
      if (!row) throw new Error("shift insert returned nothing");
      return { eventId, shiftId: row.id };
    });
  } finally {
    await pool.end();
  }
}

// A steward of a spec's own who may take steward shifts (the Level 2 qualification, valid, no
// expiry). Fake details only: a drama-range number the seed doesn't use. Returns their id; safe to
// call again (a retried test), when it finds them by their number.
export async function addSteward(
  slug: string,
  o: { firstName: string; lastName: string; mobileE164: string },
): Promise<string> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      const [added] = await tx
        .insert(workers)
        .values({ firmId, ...o, roles: ["steward"] })
        .onConflictDoNothing()
        .returning({ id: workers.id });
      if (added) {
        await tx
          .insert(credentials)
          .values({ firmId, workerId: added.id, type: "STEWARD_L2", status: "valid" });
        return added.id;
      }
      const [found] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(eq(workers.mobileE164, o.mobileE164));
      if (!found) throw new Error("worker neither added nor found");
      return found.id;
    });
  } finally {
    await pool.end();
  }
}

// Cancels a spec's own shift once it's done with it, so later specs don't see an open place.
export async function cancelOwnShift(slug: string, shiftId: string): Promise<void> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    await createWithFirm(pool)(seedId(`firm/${slug}`), (tx) =>
      tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.id, shiftId)),
    );
  } finally {
    await pool.end();
  }
}

// An office user of its own for a spec, so specs don't share the seeded users' login limit (3 links
// per email every 15 minutes). Fake details only; the e2e database is rebuilt on every run.
export async function addOfficeUser(
  slug: string,
  o: { email: string; name: string; role: "admin" | "resourcer" | "payroll" },
): Promise<void> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    await createWithFirm(pool)(firmId, (tx) =>
      tx
        .insert(officeUsers)
        .values({ firmId, email: o.email, name: o.name, role: o.role })
        .onConflictDoNothing(),
    );
  } finally {
    await pool.end();
  }
}

// A shift that has already happened (`daysAgo` days ago, 8 hours), with `people` seeded workers who
// have the role booked on it: for marking who worked. The workers are taken from the end of the
// list (the booking specs pick from the start), and the shift is days back, so it can't break the
// rest rule for the specs' shifts. It may add 8 hours to their week, far inside the 48-hour cap.
export async function addPastBookedShift(
  slug: string,
  o: { role: string; daysAgo: number; people: number },
): Promise<{ shiftId: string; names: string[] }> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      const startsAt = new Date(Date.now() - o.daysAgo * 86_400_000);
      startsAt.setUTCMinutes(0, 0, 0);
      const people = await tx
        .select({ id: workers.id, first: workers.firstName, last: workers.lastName })
        .from(workers)
        .where(and(eq(workers.status, "active"), arrayContains(workers.roles, [o.role])))
        .orderBy(desc(workers.lastName), desc(workers.firstName))
        .limit(o.people);
      if (people.length < o.people) throw new Error(`only ${people.length} workers with ${o.role}`);
      const [shift] = await tx
        .insert(shifts)
        .values({
          firmId,
          shiftEventId: await eventFor(tx, null, startsAt),
          role: o.role,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 8 * 3_600_000),
          headcount: o.people,
          status: "filled",
          source: "native",
        })
        .returning({ id: shifts.id });
      if (!shift) throw new Error("shift insert returned nothing");
      await tx.insert(assignments).values(
        people.map((p, i) => ({
          firmId,
          shiftId: shift.id,
          slot: i + 1,
          workerId: p.id,
          status: "confirmed" as const,
          confirmedAt: new Date(startsAt.getTime() - 3 * 86_400_000),
        })),
      );
      return { shiftId: shift.id, names: people.map((p) => `${p.first} ${p.last}`) };
    });
  } finally {
    await pool.end();
  }
}

// A swap request of this spec's own from a seeded worker booked on an upcoming shift (so the demo's
// two requests stay waiting for the other specs). Returns its reference and the worker's name.
export async function addSwapRequest(
  slug: string,
  note: string,
): Promise<{ ref: string; worker: string; firstName: string }> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      const [booked] = await tx
        .select({
          workerId: assignments.workerId,
          shiftId: assignments.shiftId,
          first: workers.firstName,
          last: workers.lastName,
        })
        .from(assignments)
        .innerJoin(
          workers,
          and(eq(workers.firmId, assignments.firmId), eq(workers.id, assignments.workerId)),
        )
        .innerJoin(
          shifts,
          and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
        )
        .where(and(eq(assignments.status, "confirmed"), gt(shifts.startsAt, new Date())))
        .orderBy(desc(workers.lastName), desc(workers.firstName))
        .limit(1);
      if (!booked?.workerId) throw new Error("no upcoming booking to ask about");
      const [created] = await tx
        .insert(requests)
        .values({
          firmId,
          workerId: booked.workerId,
          shiftId: booked.shiftId,
          type: "swap",
          payload: { swapWith: "", note },
        })
        .returning({ id: requests.id });
      if (!created) throw new Error("request insert returned nothing");
      return {
        ref: created.id.slice(0, 8).toUpperCase(),
        worker: `${booked.first} ${booked.last}`,
        firstName: booked.first,
      };
    });
  } finally {
    await pool.end();
  }
}

// A worker of a spec's own (so deleting them can't change what the other specs see). Fake details
// only: a drama-range number the seed doesn't use. Returns their id.
export async function addWorker(
  slug: string,
  o: { firstName: string; lastName: string; mobileE164: string },
): Promise<string> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      const [row] = await tx
        .insert(workers)
        .values({ firmId, ...o, roles: ["steward"] })
        .returning({ id: workers.id });
      if (!row) throw new Error("worker insert returned nothing");
      return row.id;
    });
  } finally {
    await pool.end();
  }
}

// A seeded worker's name, by mobile, in the e2e database (a file matching them by mobile must name
// them too: src/lib/imports/import.ts).
export async function workerName(slug: string, mobileE164: string): Promise<string> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      const [row] = await tx
        .select({ first: workers.firstName, last: workers.lastName })
        .from(workers)
        .where(eq(workers.mobileE164, mobileE164));
      if (!row) throw new Error(`no worker with ${mobileE164}`);
      return `${row.first} ${row.last}`;
    });
  } finally {
    await pool.end();
  }
}

// A shift `daysAhead` days from now at a site of its own (a made-up name), with `workerId` booked
// on it (confirmed): for the office's worker pages. Returns the shift's and the site's ids.
export async function addBookedShift(
  slug: string,
  o: { workerId: string; daysAhead: number; site: string },
): Promise<{ shiftId: string; siteId: string }> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    const startsAt = new Date(Date.now() + o.daysAhead * 86_400_000);
    startsAt.setUTCMinutes(0, 0, 0);
    return await createWithFirm(pool)(firmId, async (tx) => {
      const [site] = await tx
        .insert(sites)
        .values({ firmId, name: o.site })
        .returning({ id: sites.id });
      if (!site) throw new Error("site insert returned nothing");
      const [shift] = await tx
        .insert(shifts)
        .values({
          firmId,
          shiftEventId: await eventFor(tx, site.id, startsAt),
          role: "steward",
          siteId: site.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 8 * 3_600_000),
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
        status: "confirmed",
        confirmedAt: new Date(),
      });
      return { shiftId: shift.id, siteId: site.id };
    });
  } finally {
    await pool.end();
  }
}

// How many of these shifts-line messages (by Twilio's id) have been answered (a reply stored for
// each), in the e2e database: the load smoke's check that the queue drains.
export async function answeredMessages(slug: string, providerIds: string[]): Promise<number> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      const { rows: counted } = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from messages m
         where m.provider_message_id in (${sql.join(
           providerIds.map((id) => sql`${id}`),
           sql`, `,
         )})
           and exists (select 1 from messages r where r.firm_id = m.firm_id and r.reply_to = m.id)
      `);
      return counted[0]?.n ?? 0;
    });
  } finally {
    await pool.end();
  }
}

// The strikes a spec's casual has on its own sessions (12C.1): the session ids that got one.
export async function strikesOn(slug: string, shiftIds: string[]): Promise<string[]> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const found = await createWithFirm(pool)(seedId(`firm/${slug}`), (tx) =>
      tx
        .select({ shiftId: strikes.shiftId })
        .from(strikes)
        .where(inArray(strikes.shiftId, shiftIds)),
    );
    return found.map((r) => r.shiftId);
  } finally {
    await pool.end();
  }
}

// A spec's casual takes its own session and cancels it, through the real code (as the app does),
// with enough notice that it's no strike, or (`warning: "strike"`, a session inside 48 hours) as a
// strike, with the strike warning. Returns the booking's reference and its full id.
export async function bookAndCancel(
  slug: string,
  o: { shiftId: string; workerId: string; reason: string; warning?: "notice" | "strike" },
): Promise<{ ref: string; assignmentId: string }> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const run = createWithFirm(pool);
    const firmId = seedId(`firm/${slug}`);
    const by = { type: "worker" as const, id: o.workerId };
    const booked = await bookShift(run, firmId, { shiftId: o.shiftId, workerId: o.workerId, by });
    if (booked.status !== "booked") throw new Error(`not booked: ${booked.status}`);
    const cancelled = await cancelBooking(run, firmId, {
      shiftId: o.shiftId,
      workerId: o.workerId,
      reason: o.reason,
      by: { ...by, warning: { kind: o.warning ?? "notice", version: "v1" } },
    });
    if (cancelled.status !== "cancelled") throw new Error(`not cancelled: ${cancelled.status}`);
    const { assignmentId } = cancelled;
    return { ref: assignmentId.slice(0, 8).toUpperCase(), assignmentId };
  } finally {
    await pool.end();
  }
}

// Gives booking `id` a new id starting with the same 8 characters as `like`'s, so the two share a
// reference (a short reference can repeat: 12C.3). The owner's change, in the e2e database only;
// RLS is forced for the owner too, so it sets the firm first. Returns the new id.
export async function shareReference(slug: string, o: { id: string; like: string }) {
  const pool = new Pool({ connectionString: e2eAdminUrl(), max: 1 });
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    await client.query("begin");
    try {
      await client.query("select set_config('app.current_firm_id', $1, true)", [
        seedId(`firm/${slug}`),
      ]);
      const changed = await client.query<{ id: string }>(
        `update assignments set id = (left($2::text, 8) || substr(id::text, 9))::uuid
          where id = $1 returning id::text as id`,
        [o.id, o.like],
      );
      if (changed.rowCount !== 1) throw new Error("booking not found");
      await client.query("commit");
      return changed.rows[0]?.id ?? "";
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// The export.downloaded entries an office user (by email) has in the log, oldest first: what was
// downloaded (the entry's data: ids and counts only).
export async function downloadsBy(slug: string, email: string): Promise<unknown[]> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    return await createWithFirm(pool)(seedId(`firm/${slug}`), async (tx) => {
      const found = await tx.execute<{ data: unknown }>(sql`
        select e.data from events e
          join office_users u on u.firm_id = e.firm_id and u.id = e.actor_id
         where e.action = 'export.downloaded' and e.actor_type = 'office' and u.email = ${email}
         order by e.id
      `);
      return found.rows.map((r) => r.data);
    });
  } finally {
    await pool.end();
  }
}

// The strike on a booking with its evidence email failed (12C.4), as the job leaves it when the
// email may have arrived. Waits first for the e2e worker to finish the strike's own evidence job
// (it runs as soon as the strike is recorded), so the two can't overwrite each other.
export async function failEvidence(slug: string, assignmentId: string): Promise<void> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const run = createWithFirm(pool);
    const firmId = seedId(`firm/${slug}`);
    for (let i = 0; ; i++) {
      const [row] = await run(firmId, (tx) =>
        tx
          .select({ status: strikes.evidenceEmailStatus })
          .from(strikes)
          .where(eq(strikes.assignmentId, assignmentId)),
      );
      if (!row) throw new Error("no strike on that booking");
      if (row.status !== "pending") break;
      if (i >= 60) throw new Error("the evidence job didn't finish");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await run(firmId, (tx) =>
      tx
        .update(strikes)
        .set({ evidenceEmailStatus: "failed" })
        .where(eq(strikes.assignmentId, assignmentId)),
    );
  } finally {
    await pool.end();
  }
}

// A spec's own casual starts without a travel area (12G.1), so a retry starts as the first run did.
export async function clearTravel(slug: string, workerId: string): Promise<void> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    await createWithFirm(pool)(seedId(`firm/${slug}`), (tx) =>
      tx.delete(workerTravel).where(eq(workerTravel.workerId, workerId)),
    );
  } finally {
    await pool.end();
  }
}

// The travel filter's scene (12G.3; tests/e2e/travel.filter.spec.ts): a casual of its own with a
// role nobody else has (so no other spec's lists change) and a travel area (car, 45 minutes), and
// two urgent sessions in that role 9 days ahead (after the old Today page's 7-day gaps), each at a site of its
// own with the travel job's estimates: one near (20 min by car), one far (80 min by car). A rerun
// cancels the last run's sessions first, so it starts the same way (a booking on a cancelled
// session counts for nothing and isn't listed; bookings are never deleted).
export const TRAVEL_SCENE_ROLE = "travel_check";
export async function travelScene(
  slug: string,
  casual: { firstName: string; lastName: string; mobileE164: string },
): Promise<{ workerId: string; near: string; far: string }> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      await tx.execute(sql`
        insert into credential_rules (firm_id, sector, role, required_types)
        values (${firmId}, 'security', ${TRAVEL_SCENE_ROLE}, '{}')
        on conflict (firm_id, role) do nothing`);
      await tx
        .insert(workers)
        .values({ firmId, ...casual, roles: [TRAVEL_SCENE_ROLE] })
        .onConflictDoNothing();
      const [worker] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(eq(workers.mobileE164, casual.mobileE164));
      if (!worker) throw new Error("travel scene casual neither added nor found");
      await tx
        .update(shifts)
        .set({ status: "cancelled" })
        .where(eq(shifts.role, TRAVEL_SCENE_ROLE));
      const point = (postcode: string) => {
        const p = fakePoint(postcode);
        if (!p) throw new Error(`no fake point for ${postcode}`);
        return { lat: String(p.lat), lng: String(p.lng) };
      };
      const home = point("ZZ2 2BB");
      await tx
        .insert(workerTravel)
        .values({
          firmId,
          workerId: worker.id,
          startPostcode: "ZZ2 2BB",
          ...home,
          modes: "car",
          maxMinutes: 45,
          privacyNoticeVersion: "travel-v1",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [workerTravel.firmId, workerTravel.workerId],
          set: { startPostcode: "ZZ2 2BB", ...home, modes: "car", maxMinutes: 45 },
        });
      const startsAt = new Date(Date.now() + 9 * 86_400_000);
      startsAt.setUTCHours(10, 0, 0, 0);
      const session = async (name: string, at: Date, car: number, metres: number) => {
        const [site] = await tx
          .insert(sites)
          .values({ firmId, name, postcode: "ZZ1 1AA", ...point("ZZ1 1AA") })
          .returning({ id: sites.id });
        if (!site) throw new Error("site insert returned nothing");
        const [row] = await tx
          .insert(shifts)
          .values({
            firmId,
            siteId: site.id,
            shiftEventId: await eventFor(tx, site.id, at),
            role: TRAVEL_SCENE_ROLE,
            startsAt: at,
            endsAt: new Date(at.getTime() + 6 * 3_600_000),
            headcount: 1,
            status: "open",
            source: "native",
            isUrgent: true,
          })
          .returning({ id: shifts.id });
        if (!row) throw new Error("shift insert returned nothing");
        const arriveBy = new Date(at.getTime() - 30 * 60_000);
        await tx.execute(sql`
          insert into travel_estimates (firm_id, origin_postcode, site_id, mode, arrive_by,
                                        minutes, metres, provider, computed_at, expires_at)
          values (${firmId}, 'ZZ2 2BB', ${site.id}, 'car', ${arriveBy}, ${car}, ${metres}, 'fake',
                  now(), ${new Date(at.getTime() + 8 * 86_400_000)}),
                 (${firmId}, 'ZZ2 2BB', ${site.id}, 'public_transport', ${arriveBy}, null, null,
                  'fake', now(), ${new Date(at.getTime() + 8 * 86_400_000)})`);
        return row.id;
      };
      const stamp = Date.now().toString(36);
      const near = await session(`Near Hall ${stamp}`, startsAt, 20, 12070);
      const far = await session(
        `Far Field ${stamp}`,
        new Date(startsAt.getTime() + 86_400_000),
        80,
        96560,
      );
      return { workerId: worker.id, near, far };
    });
  } finally {
    await pool.end();
  }
}

// Home's scene (12H.1; tests/e2e/casual.app.spec.ts): a casual of its own in a role nobody else
// has (no qualification needed, so no other spec's lists change), with a travel area (car or public
// transport, 45 minutes) and a staff photo the office approved 1,130 days ago (overdue: photos last
// 36 months). She is booked on a session 9 days ahead with every fact Home shows (post, pay, where
// to report, uniform), and an urgent session in her role is open the day after. Each at a site of its own, with the travel job's
// estimates by car and by public transport (no travel service is called). A rerun cancels the last
// run's sessions first, so it starts the same way (bookings are never deleted).
export const HOME_SCENE_ROLE = "home_check";
export async function homeScene(
  slug: string,
  casual: { firstName: string; lastName: string; mobileE164: string },
): Promise<{
  workerId: string;
  photoOn: Date;
  booked: { site: string };
  urgent: { site: string };
}> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      await tx.execute(sql`
        insert into credential_rules (firm_id, sector, role, required_types)
        values (${firmId}, 'security', ${HOME_SCENE_ROLE}, '{}')
        on conflict (firm_id, role) do nothing`);
      await tx
        .insert(workers)
        .values({ firmId, ...casual, roles: [HOME_SCENE_ROLE] })
        .onConflictDoNothing();
      const [worker] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(eq(workers.mobileE164, casual.mobileE164));
      if (!worker) throw new Error("home scene casual neither added nor found");
      await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.role, HOME_SCENE_ROLE));
      const point = (postcode: string) => {
        const p = fakePoint(postcode);
        if (!p) throw new Error(`no fake point for ${postcode}`);
        return { lat: String(p.lat), lng: String(p.lng) };
      };
      const home = point("ZZ2 2BB");
      await tx
        .insert(workerTravel)
        .values({
          firmId,
          workerId: worker.id,
          startPostcode: "ZZ2 2BB",
          ...home,
          modes: "both",
          maxMinutes: 45,
          privacyNoticeVersion: "travel-v1",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [workerTravel.firmId, workerTravel.workerId],
          set: { startPostcode: "ZZ2 2BB", ...home, modes: "both", maxMinutes: 45 },
        });

      // Her staff photo, approved by one of the firm's office team 1,130 days ago.
      const [checker] = await tx.select({ id: officeUsers.id }).from(officeUsers).limit(1);
      if (!checker) throw new Error("no office user to approve the photo");
      const photoOn = new Date(Date.now() - 1130 * 86_400_000);
      photoOn.setUTCHours(12, 0, 0, 0);
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
      await tx.insert(uploads).values({
        firmId,
        workerId: worker.id,
        kind: "photo",
        contentType: "image/jpeg",
        size: jpeg.length,
        sha256: createHash("sha256").update(jpeg).digest("hex"),
        data: jpeg,
        status: "approved",
        checkedBy: checker.id,
        checkedAt: photoOn,
        createdAt: photoOn,
      });

      const stamp = Date.now().toString(36);
      const session = async (
        o: { site: string; at: Date; car: number; publicTransport: number; metres: number },
        facts: Partial<typeof shifts.$inferInsert>,
      ) => {
        const [site] = await tx
          .insert(sites)
          .values({ firmId, name: o.site, postcode: "ZZ1 1AA", ...point("ZZ1 1AA") })
          .returning({ id: sites.id });
        if (!site) throw new Error("site insert returned nothing");
        const [row] = await tx
          .insert(shifts)
          .values({
            firmId,
            siteId: site.id,
            shiftEventId: await eventFor(tx, site.id, o.at),
            role: HOME_SCENE_ROLE,
            startsAt: o.at,
            endsAt: new Date(o.at.getTime() + 8 * 3_600_000),
            headcount: 1,
            source: "native",
            ...facts,
          })
          .returning({ id: shifts.id });
        if (!row) throw new Error("shift insert returned nothing");
        const arriveBy = new Date(o.at.getTime() - 30 * 60_000);
        const expiresAt = new Date(o.at.getTime() + 8 * 86_400_000);
        await tx.execute(sql`
          insert into travel_estimates (firm_id, origin_postcode, site_id, mode, arrive_by,
                                        minutes, metres, provider, computed_at, expires_at)
          values (${firmId}, 'ZZ2 2BB', ${site.id}, 'car', ${arriveBy}, ${o.car}, ${o.metres},
                  'fake', now(), ${expiresAt}),
                 (${firmId}, 'ZZ2 2BB', ${site.id}, 'public_transport', ${arriveBy},
                  ${o.publicTransport}, null, 'fake', now(), ${expiresAt})`);
        return row.id;
      };
      const bookedAt = new Date(Date.now() + 9 * 86_400_000);
      bookedAt.setUTCHours(10, 0, 0, 0);
      const booked = { site: `Home Booked Hall ${stamp}` };
      const bookedId = await session(
        { site: booked.site, at: bookedAt, car: 15, publicTransport: 30, metres: 8047 },
        {
          status: "filled",
          payRatePence: 1260,
          post: "Gate 3",
          meetingPoint: "Staff entrance on Mill Lane",
          uniform: "Black trousers and your hi-vis",
        },
      );
      await tx.insert(assignments).values({
        firmId,
        shiftId: bookedId,
        slot: 1,
        workerId: worker.id,
        status: "confirmed",
        confirmedAt: new Date(),
      });
      const urgent = { site: `Home Urgent Hall ${stamp}` };
      await session(
        {
          site: urgent.site,
          at: new Date(bookedAt.getTime() + 86_400_000),
          car: 12,
          publicTransport: 24,
          metres: 5000,
        },
        { status: "open", isUrgent: true, payRatePence: 1300 },
      );
      return { workerId: worker.id, photoOn, booked, urgent };
    });
  } finally {
    await pool.end();
  }
}

// A casual of a spec's own with exactly these qualifications (12F.1; tests/e2e/casual.app.spec.ts):
// their roles, and each type they hold with its expiry `daysAhead` from today (null: none). A
// rerun puts them back the same way.
export async function addQualifiedCasual(
  slug: string,
  casual: { firstName: string; lastName: string; mobileE164: string },
  o: { roles: string[]; held: { type: string; daysAhead: number | null }[] },
): Promise<string> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      await tx
        .insert(workers)
        .values({ firmId, ...casual, roles: o.roles })
        .onConflictDoNothing();
      const [worker] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(eq(workers.mobileE164, casual.mobileE164));
      if (!worker) throw new Error("casual neither added nor found");
      await tx.update(workers).set({ roles: o.roles }).where(eq(workers.id, worker.id));
      await tx.delete(credentials).where(eq(credentials.workerId, worker.id));
      for (const h of o.held) {
        await tx.insert(credentials).values({
          firmId,
          workerId: worker.id,
          type: h.type,
          status: "valid",
          expiresOn:
            h.daysAhead === null
              ? null
              : new Date(Date.now() + h.daysAhead * 86_400_000).toISOString().slice(0, 10),
        });
      }
      return worker.id;
    });
  } finally {
    await pool.end();
  }
}

// The personal replies' scene (12D.2; tests/e2e/office.enquiries.spec.ts): two casuals of the
// spec's own in a role nobody else has, response team lead (Acme's rule: an SIA door supervisor
// licence), both with a travel area (car, 45 minutes); `holder` also holds CSAS and is booked the day
// before. Three sessions 10, 11 and 12 days ahead at a site of its own, each 20 minutes away by car
// (no public transport in time): a plain one, one that also needs a first aid at work certificate
// (neither has one), and one that also needs CSAS. A rerun cancels the last run's sessions first
// (a booking on a cancelled session counts for nothing), so it starts the same way.
export const REPLY_SCENE_ROLE = "response_team_lead";
export async function personalReplyScene(
  slug: string,
  holder: { firstName: string; lastName: string; mobileE164: string },
  other: { firstName: string; lastName: string; mobileE164: string },
): Promise<{ plain: string; firstAid: string; csas: string; booked: string; names: string[] }> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      await tx.execute(sql`
        insert into credential_rules (firm_id, sector, role, required_types)
        values (${firmId}, 'security', ${REPLY_SCENE_ROLE}, '{SIA_DS}')
        on conflict (firm_id, role) do nothing`);
      await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.role, REPLY_SCENE_ROLE));
      const point = (postcode: string) => {
        const p = fakePoint(postcode);
        if (!p) throw new Error(`no fake point for ${postcode}`);
        return { lat: String(p.lat), lng: String(p.lng) };
      };
      const home = point("ZZ2 2BB");
      const inDays = (days: number) =>
        new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      const casual = async (
        who: { firstName: string; lastName: string; mobileE164: string },
        held: { type: string; expiresOn: string }[],
      ) => {
        await tx
          .insert(workers)
          .values({ firmId, ...who, roles: [REPLY_SCENE_ROLE] })
          .onConflictDoNothing();
        const [worker] = await tx
          .select({ id: workers.id })
          .from(workers)
          .where(eq(workers.mobileE164, who.mobileE164));
        if (!worker) throw new Error("scene casual neither added nor found");
        await tx
          .update(workers)
          .set({ roles: [REPLY_SCENE_ROLE] })
          .where(eq(workers.id, worker.id));
        await tx.delete(credentials).where(eq(credentials.workerId, worker.id));
        for (const h of held) {
          await tx.insert(credentials).values({
            firmId,
            workerId: worker.id,
            type: h.type,
            status: "valid",
            expiresOn: h.expiresOn,
          });
        }
        await tx
          .insert(workerTravel)
          .values({
            firmId,
            workerId: worker.id,
            startPostcode: "ZZ2 2BB",
            ...home,
            modes: "car",
            maxMinutes: 45,
            privacyNoticeVersion: "travel-v1",
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [workerTravel.firmId, workerTravel.workerId],
            set: { startPostcode: "ZZ2 2BB", ...home, modes: "car", maxMinutes: 45 },
          });
        return worker.id;
      };
      const holderId = await casual(holder, [
        { type: "SIA_DS", expiresOn: inDays(300) },
        { type: "CSAS", expiresOn: inDays(400) },
      ]);
      await casual(other, [{ type: "SIA_DS", expiresOn: inDays(300) }]);

      const stamp = Date.now().toString(36);
      const siteName = `Scene Hall ${stamp}`;
      const [site] = await tx
        .insert(sites)
        .values({ firmId, name: siteName, postcode: "ZZ1 1AA", ...point("ZZ1 1AA") })
        .returning({ id: sites.id });
      if (!site) throw new Error("site insert returned nothing");
      const eventName = `Late Show ${stamp}`;
      const eventId = await createNamedEvent(tx, { name: eventName, siteId: site.id });
      const base = new Date(Date.now() + 10 * 86_400_000);
      base.setUTCHours(10, 0, 0, 0);
      const session = async (
        daysAfter: number,
        o: { extra?: string[]; status?: "open" | "filled"; pay?: number; post?: string } = {},
      ) => {
        const at = new Date(base.getTime() + daysAfter * 86_400_000);
        const [row] = await tx
          .insert(shifts)
          .values({
            firmId,
            siteId: site.id,
            shiftEventId: eventId,
            role: REPLY_SCENE_ROLE,
            startsAt: at,
            endsAt: new Date(at.getTime() + 8 * 3_600_000),
            headcount: 1,
            status: o.status ?? "open",
            source: "native",
            requiredCredentials: o.extra ?? [],
            payRatePence: o.pay ?? null,
            post: o.post ?? null,
          })
          .returning({ id: shifts.id });
        if (!row) throw new Error("shift insert returned nothing");
        const arriveBy = new Date(at.getTime() - 30 * 60_000);
        await tx.execute(sql`
          insert into travel_estimates (firm_id, origin_postcode, site_id, mode, arrive_by,
                                        minutes, metres, provider, computed_at, expires_at)
          values (${firmId}, 'ZZ2 2BB', ${site.id}, 'car', ${arriveBy}, 20, 12070, 'fake', now(),
                  ${new Date(at.getTime() + 8 * 86_400_000)}),
                 (${firmId}, 'ZZ2 2BB', ${site.id}, 'public_transport', ${arriveBy}, null, null,
                  'fake', now(), ${new Date(at.getTime() + 8 * 86_400_000)})
          on conflict do nothing`);
        return row.id;
      };
      // The day before: her booking, ending 16 hours before the plain session starts.
      const booked = await session(-1, { status: "filled" });
      await tx.insert(assignments).values({
        firmId,
        shiftId: booked,
        slot: 1,
        workerId: holderId,
        status: "confirmed",
        confirmedAt: new Date(),
      });
      const plain = await session(0, { pay: 1450, post: "Main gate" });
      const firstAid = await session(1, { extra: ["FIRST_AID"] });
      const csas = await session(2, { extra: ["CSAS"] });
      return { plain, firstAid, csas, booked, names: [eventName, siteName] };
    });
  } finally {
    await pool.end();
  }
}
