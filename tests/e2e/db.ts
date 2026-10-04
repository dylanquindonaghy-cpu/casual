import { and, arrayContains, desc, eq, gt, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../src/lib/db/admin/urls";
import {
  assignments,
  officeUsers,
  requests,
  shifts,
  sites,
  workers,
} from "../../src/lib/db/schema";
import { createWithFirm } from "../../src/lib/db/scoped";

// Rows an e2e test needs that the seed doesn't have yet, written to the e2e database (never the
// dev one) as the app role, inside the seeded firm, exactly as the app would.
function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
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
    const [row] = await createWithFirm(pool)(firmId, (tx) =>
      tx
        .insert(shifts)
        .values({
          firmId,
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
