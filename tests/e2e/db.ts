import { Pool } from "pg";
import { seedId } from "../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../src/lib/db/admin/urls";
import { shifts } from "../../src/lib/db/schema";
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
