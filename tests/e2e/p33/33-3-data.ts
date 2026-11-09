import { eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import { assignments, credentials, shifts, sites, workers } from "../../../src/lib/db/schema";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { createNamedEvent } from "../../../src/lib/roster/shift-events";

// Phase 33.3's rows (tests/e2e/casual.tour.spec.ts), this file's own. Made-up details only, on
// drama-range numbers 07700 900570 to 900579 (outside tests/e2e/spare-mobiles.ts's blocks; no
// other spec or the seed uses them), in a role of this spec's own (P33_ROLE, its rule the Level 2
// spectator safety qualification). Each casual is booked on a session 3 days ahead at a venue of
// this spec's own with an address and a point (so Home has her next shift, Directions and "Can't
// make it?") and one session of the role is open to her; and each starts the spec not having seen
// her first-login tour (tour_seen_at cleared, a retried test too). A rerun cancels the last run's
// sessions of the role first, so it starts the same way.

export const P33_ROLE = "p33_tour_check";

export const P33_CASUALS = {
  phone: {
    firstName: "Tia",
    lastName: "Tourphone",
    mobileE164: "+447700900570",
    typed: "07700 900570",
  },
  laptop: {
    firstName: "Leo",
    lastName: "Tourlaptop",
    mobileE164: "+447700900571",
    typed: "07700 900571",
  },
  notNow: {
    firstName: "Nia",
    lastName: "Notnow",
    mobileE164: "+447700900572",
    typed: "07700 900572",
  },
  offline: {
    firstName: "Oli",
    lastName: "Nosignal",
    mobileE164: "+447700900573",
    typed: "07700 900573",
  },
} as const;
export type P33Who = keyof typeof P33_CASUALS;

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

async function session(
  tx: FirmTx,
  firmId: string,
  o: { site: string; days: number; status: "open" | "filled" },
): Promise<string> {
  const [site] = await tx
    .insert(sites)
    .values({
      firmId,
      name: o.site,
      addressLine1: "3 Test Road",
      town: "Leeds",
      postcode: "ZZ1 3AA",
      lat: "53.800000",
      lng: "-1.540000",
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
      role: P33_ROLE,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 3_600_000),
      headcount: 1,
      status: o.status,
      source: "native",
      payRatePence: 1300,
      post: "North stand",
    })
    .returning({ id: shifts.id });
  if (!row) throw new Error("shift insert returned nothing");
  return row.id;
}

export type P33Scene = Record<P33Who, string>; // each casual's id

export async function p33Scene(): Promise<P33Scene> {
  const run = Date.now().toString(36);
  return inAcme(async (tx, firmId) => {
    await tx.execute(sql`
      insert into credential_rules (firm_id, sector, role, required_types)
      values (${firmId}, 'security', ${P33_ROLE}, '{STEWARD_L2}')
      on conflict (firm_id, role) do nothing`);
    await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.role, P33_ROLE));
    const ids = {} as Record<P33Who, string>;
    for (const [key, who] of Object.entries(P33_CASUALS) as [
      P33Who,
      (typeof P33_CASUALS)[P33Who],
    ][]) {
      await tx
        .insert(workers)
        .values({
          firmId,
          firstName: who.firstName,
          lastName: who.lastName,
          mobileE164: who.mobileE164,
          roles: [P33_ROLE],
          tourSeenAt: null, // the tour's own spec: not seen yet
        })
        .onConflictDoNothing();
      const [row] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(eq(workers.mobileE164, who.mobileE164));
      if (!row) throw new Error("casual neither added nor found");
      await tx.update(workers).set({ tourSeenAt: null }).where(eq(workers.id, row.id));
      await tx.delete(credentials).where(eq(credentials.workerId, row.id));
      await tx
        .insert(credentials)
        .values({ firmId, workerId: row.id, type: "STEWARD_L2", status: "valid", expiresOn: null });
      const booked = await session(tx, firmId, {
        site: `P33 ${who.firstName} Arena ${run}`,
        days: 3,
        status: "filled",
      });
      await tx.insert(assignments).values({
        firmId,
        shiftId: booked,
        slot: 1,
        workerId: row.id,
        status: "confirmed",
        confirmedAt: new Date(),
      });
      ids[key] = row.id;
    }
    await session(tx, firmId, { site: `P33 Open Ground ${run}`, days: 6, status: "open" });
    return ids;
  });
}

// After the spec: its sessions go, so no later spec sees an open place of the role.
export async function p33Cleanup(): Promise<void> {
  await inAcme((tx) =>
    tx
      .update(shifts)
      .set({ status: "cancelled" })
      .where(inArray(shifts.role, [P33_ROLE])),
  );
}
