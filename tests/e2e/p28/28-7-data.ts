import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { addWorker, homeScene } from "../db";

// Task 28.7's rows (Phase 28; tests/e2e/casual.p28-home.spec.ts), made with tests/e2e/db.ts's
// helpers (imported, never edited). Made-up details only, on drama-range numbers no other spec or
// the seed uses:
// - Rhea: Home's scene (homeScene: her next shift as the pass, an urgent open shift in her role, an
//   overdue staff photo for "Do this"). Once she's logged in, the spec makes her unreachable and
//   turns her open-shift alerts off (`cutOff`), so "Do this" holds both of 28.7's rows: no phone
//   with notifications on, a STOP to our texts, no email address held, and "Tell me about open
//   shifts" off. Her login link needs texts, so `reachable` puts her back first (a rerun too) and
//   after the spec.
// - Noel: a steward of the spec's own with nothing booked, for the empty pass and "See open shifts".
export const P28_7_RHEA = {
  firstName: "Rhea",
  lastName: "Calder",
  mobileE164: "+447700900287",
} as const;
export const P28_7_RHEA_TYPED = "07700 900287";
export const P28_7_NOEL = {
  firstName: "Noel",
  lastName: "Varga",
  mobileE164: "+447700900787",
} as const;
export const P28_7_NOEL_TYPED = "07700 900787";

// The e2e database only (never the dev one), as the app role inside Acme, as tests/e2e/db.ts does.
function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

async function inAcme<T>(fn: (tx: FirmTx) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    return await createWithFirm(pool)(seedId("firm/acme"), fn);
  } finally {
    await pool.end();
  }
}

// Rhea's scene, with her texts and alerts as a new casual's (so her login link can go by text).
export async function rheaScene(): Promise<Awaited<ReturnType<typeof homeScene>>> {
  const scene = await homeScene("acme", P28_7_RHEA);
  await reachable(scene.workerId);
  return scene;
}

// Nothing can reach her any more, and her open-shift alerts are off.
export async function cutOff(workerId: string): Promise<void> {
  await inAcme(async (tx) => {
    await tx.execute(sql`delete from push_subscriptions where worker_id = ${workerId}`);
    await tx.execute(sql`
      update workers
         set sms_opted_out_at = now(), email = null, notify_channel = 'sms', offer_alerts = false
       where id = ${workerId}`);
  });
}

// Back as a new casual is: texts on, alerts on.
export async function reachable(workerId: string): Promise<void> {
  await inAcme(async (tx) => {
    await tx.execute(sql`
      update workers set sms_opted_out_at = null, offer_alerts = true where id = ${workerId}`);
  });
}

// Noel, added once and found after that: a steward with nothing booked (the spec never books him).
export async function noelScene(): Promise<string> {
  const found = await inAcme<string | null>(async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(
      sql`select id::text as id from workers where mobile_e164 = ${P28_7_NOEL.mobileE164}`,
    );
    return rows[0]?.id ?? null;
  });
  return found ?? (await addWorker("acme", P28_7_NOEL));
}
