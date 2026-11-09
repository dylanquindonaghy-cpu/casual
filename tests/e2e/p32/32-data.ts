import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import { assignments, credentials, shifts, sites, workers } from "../../../src/lib/db/schema";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { createNamedEvent } from "../../../src/lib/roster/shift-events";

// Phase 32's rows (tests/e2e/casual.p32-look.spec.ts), this file's own. Made-up details only, on
// drama-range numbers 07700 900560 to 900569 (outside tests/e2e/spare-mobiles.ts's blocks; no
// other spec or the seed uses them). In a role of this spec's own (P32_ROLE, its rule the Level 2
// spectator safety qualification), so only its own sessions are open to its casuals and no other
// spec sees them:
// - Mina: booked on a session 3 days ahead at a venue of this spec's own with a point on the map
//   ("Gate 2", £13.50 an hour); two venues of this spec's own with sessions of the role open to
//   her: one urgent tomorrow, one 9 days ahead; and one venue with no point yet (no pin).
// - Noor: nothing booked (the nothing-booked card), the same open sessions.
// A rerun cancels the last run's sessions of the role first, so it starts the same way.

export const P32_ROLE = "p32_map_check";
export const P32_MINA = {
  firstName: "Mina",
  lastName: "Mapleton",
  mobileE164: "+447700900560",
  typed: "07700 900560",
} as const;
export const P32_NOOR = {
  firstName: "Noor",
  lastName: "Nobook",
  mobileE164: "+447700900561",
  typed: "07700 900561",
} as const;

function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

async function inAcme<T>(fn: (tx: FirmTx, firmId: string) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId("firm/acme");
    return await createWithFirm(pool)(firmId, (tx) => fn(tx, firmId));
  } finally {
    await pool.end();
  }
}

const hourFrom = (days: number) => {
  const at = new Date(Date.now() + days * 86_400_000);
  at.setUTCMinutes(0, 0, 0);
  return at;
};

async function casual(
  tx: FirmTx,
  firmId: string,
  who: { firstName: string; lastName: string; mobileE164: string },
): Promise<string> {
  await tx
    .insert(workers)
    .values({
      firmId,
      firstName: who.firstName,
      lastName: who.lastName,
      mobileE164: who.mobileE164,
      roles: [P32_ROLE],
    })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ id: workers.id })
    .from(workers)
    .where(eq(workers.mobileE164, who.mobileE164));
  if (!row) throw new Error("casual neither added nor found");
  await tx.delete(credentials).where(eq(credentials.workerId, row.id));
  await tx
    .insert(credentials)
    .values({ firmId, workerId: row.id, type: "STEWARD_L2", status: "valid", expiresOn: null });
  return row.id;
}

// A session of the role at a venue of its own (with its point, or none), `days` ahead.
async function session(
  tx: FirmTx,
  firmId: string,
  o: {
    site: string;
    days: number;
    point: { lat: number; lng: number } | null;
    urgent?: boolean;
    status: "open" | "filled";
  },
): Promise<string> {
  const [site] = await tx
    .insert(sites)
    .values({
      firmId,
      name: o.site,
      addressLine1: "1 Test Road",
      town: "Leeds",
      postcode: "ZZ1 1AA",
      ...(o.point ? { lat: o.point.lat.toFixed(6), lng: o.point.lng.toFixed(6) } : {}),
    })
    .returning({ id: sites.id });
  if (!site) throw new Error("site insert returned nothing");
  const startsAt = hourFrom(o.days);
  const [row] = await tx
    .insert(shifts)
    .values({
      firmId,
      siteId: site.id,
      shiftEventId: await createNamedEvent(tx, { name: `${o.site} event`, siteId: site.id }),
      role: P32_ROLE,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 3_600_000),
      headcount: 1,
      status: o.status,
      isUrgent: o.urgent ?? false,
      source: "native",
      payRatePence: 1350,
      post: "Gate 2",
    })
    .returning({ id: shifts.id });
  if (!row) throw new Error("shift insert returned nothing");
  return row.id;
}

export interface P32Scene {
  booked: { site: string; shiftId: string };
  urgent: { site: string; shiftId: string };
  later: { site: string; shiftId: string };
  unplaced: { site: string; shiftId: string };
}

export async function p32Scene(): Promise<P32Scene> {
  const run = Date.now().toString(36);
  return inAcme(async (tx, firmId) => {
    await tx.execute(sql`
      insert into credential_rules (firm_id, sector, role, required_types)
      values (${firmId}, 'security', ${P32_ROLE}, '{STEWARD_L2}')
      on conflict (firm_id, role) do nothing`);
    // The last run's sessions go first (its bookings with them).
    await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.role, P32_ROLE));
    const mina = await casual(tx, firmId, P32_MINA);
    await casual(tx, firmId, P32_NOOR);
    const bookedSite = `P32 Riverside ${run}`;
    const bookedId = await session(tx, firmId, {
      site: bookedSite,
      days: 3,
      point: { lat: 53.795, lng: -1.548 },
      status: "filled",
    });
    await tx.insert(assignments).values({
      firmId,
      shiftId: bookedId,
      slot: 1,
      workerId: mina,
      status: "confirmed",
      confirmedAt: new Date(),
    });
    const urgentSite = `P32 Northgate ${run}`;
    const urgentId = await session(tx, firmId, {
      site: urgentSite,
      days: 1,
      point: { lat: 53.82, lng: -1.52 },
      urgent: true,
      status: "open",
    });
    const laterSite = `P32 Southbank ${run}`;
    const laterId = await session(tx, firmId, {
      site: laterSite,
      days: 9,
      point: { lat: 53.77, lng: -1.5 },
      status: "open",
    });
    const unplacedSite = `P32 No Postcode ${run}`;
    const unplacedId = await session(tx, firmId, {
      site: unplacedSite,
      days: 5,
      point: null,
      status: "open",
    });
    return {
      booked: { site: bookedSite, shiftId: bookedId },
      urgent: { site: urgentSite, shiftId: urgentId },
      later: { site: laterSite, shiftId: laterId },
      unplaced: { site: unplacedSite, shiftId: unplacedId },
    };
  });
}

// After the spec: its open sessions go, so no later spec sees an open place of the role.
export async function p32Cleanup(): Promise<void> {
  await inAcme((tx) =>
    tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.role, P32_ROLE)),
  );
}
