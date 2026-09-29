import { and, arrayContains, desc, eq } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../src/lib/db/admin/urls";
import { assignments, officeUsers, shifts, workers } from "../../src/lib/db/schema";
import { createWithFirm } from "../../src/lib/db/scoped";

// Rows an e2e test needs that the seed doesn't have yet, written to the e2e database (never the
// dev one) as the app role, inside the seeded firm, exactly as the app would.
function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
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
