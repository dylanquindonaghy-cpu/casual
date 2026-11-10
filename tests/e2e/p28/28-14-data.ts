import { and, eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import {
  assignments,
  clients,
  officeUserClients,
  officeUsers,
  shifts,
  sites,
  workers,
} from "../../../src/lib/db/schema";
import { createWithFirm } from "../../../src/lib/db/scoped";
import { addBookedShift, addOfficeUser } from "../db";

// Task 28.14's rows (Phase 28; tests/e2e/casual.p28-still-coming.spec.ts), in Acme's e2e database,
// built with tests/e2e/db.ts's helpers (imported, never edited) and a few rows of its own written
// as the app role, exactly as the app would:
//
// - a casual of this spec's own, booked on a session about 20 hours away (inside "Still coming?"'s
//   24 hours) at a venue of its own, with nothing else booked (so it's her pass on Home);
// - that venue a contract of its own, looked after by the spec's own office user, so the
//   dashboard's Coming up shows only it, whatever else the other specs and the seed have booked.
//
// A rerun starts the same way: her last run's bookings' sessions are cancelled first, and the last
// contract's venue let go. Made-up details only: a drama-range number no other spec uses.
export const P28_14_CASUAL = {
  firstName: "Tess",
  lastName: "Comer",
  mobileE164: "+447700900314",
} as const;
// As she types it on the login page.
export const P28_14_TYPED = "07700 900314";

function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

async function inE2e<T>(work: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    return await work(pool);
  } finally {
    await pool.end();
  }
}

export interface StillComingScene {
  workerId: string;
  shiftId: string;
  site: string;
  clientId: string;
}

export async function stillComingScene(
  tag: string,
  email: string,
  slug = "acme",
): Promise<StillComingScene> {
  const firmId = seedId(`firm/${slug}`);
  await addOfficeUser(slug, { email, name: "Still Coming Resourcer", role: "resourcer" });
  const workerId = await inE2e((pool) =>
    createWithFirm(pool)(firmId, async (tx) => {
      await tx
        .insert(workers)
        .values({ firmId, tourSeenAt: new Date(), ...P28_14_CASUAL, roles: ["steward"] })
        .onConflictDoNothing();
      const [me] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(eq(workers.mobileE164, P28_14_CASUAL.mobileE164));
      if (!me) throw new Error("28.14's casual neither added nor found");
      // The last run's sessions: those of her live bookings.
      const mine = tx
        .select({ id: assignments.shiftId })
        .from(assignments)
        .where(and(eq(assignments.workerId, me.id), eq(assignments.status, "confirmed")));
      await tx.update(shifts).set({ status: "cancelled" }).where(inArray(shifts.id, mine));
      return me.id;
    }),
  );
  // About 20 hours away (the helper rounds down to the hour: between 19 and 20 hours ahead).
  const site = `P28.14 Still Hall ${tag}`;
  const { shiftId, siteId } = await addBookedShift(slug, { workerId, daysAhead: 20 / 24, site });
  const clientId = await inE2e((pool) =>
    createWithFirm(pool)(firmId, async (tx) => {
      const [client] = await tx
        .insert(clients)
        .values({ firmId, name: `Still Council ${tag}` })
        .returning({ id: clients.id });
      const [me] = await tx
        .select({ id: officeUsers.id })
        .from(officeUsers)
        .where(eq(officeUsers.email, email));
      if (!client || !me) throw new Error("no contract, or no office user to look after it");
      await tx.update(sites).set({ clientId: client.id }).where(eq(sites.id, siteId));
      await tx
        .insert(officeUserClients)
        .values({ firmId, officeUserId: me.id, clientId: client.id });
      return client.id;
    }),
  );
  return { workerId, shiftId, site, clientId };
}

// Ends the scene: its session cancelled (no later spec sees her booking) and its contract removed
// (its venue stays, as Settings' "Remove" leaves it).
export async function endStillComingScene(scene: StillComingScene, slug = "acme"): Promise<void> {
  await inE2e((pool) =>
    createWithFirm(pool)(seedId(`firm/${slug}`), async (tx) => {
      await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.id, scene.shiftId));
      await tx.update(sites).set({ clientId: null }).where(eq(sites.clientId, scene.clientId));
      await tx.delete(clients).where(eq(clients.id, scene.clientId));
    }),
  );
}

// When she said "Yes, I'm coming" on the booking (null: not yet), as the office's Coming up reads it.
export async function saidComingAt(scene: StillComingScene, slug = "acme"): Promise<Date | null> {
  return inE2e((pool) =>
    createWithFirm(pool)(seedId(`firm/${slug}`), async (tx) => {
      const [row] = await tx
        .select({ at: assignments.stillComingAt })
        .from(assignments)
        .where(
          and(eq(assignments.shiftId, scene.shiftId), eq(assignments.workerId, scene.workerId)),
        );
      return row?.at ?? null;
    }),
  );
}
