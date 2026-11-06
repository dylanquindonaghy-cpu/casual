import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import {
  credentials,
  officeUsers,
  workers,
  workerUnavailableDays,
} from "../../../src/lib/db/schema";
import { createWithFirm } from "../../../src/lib/db/scoped";
import { markNeedsSorted } from "../../../src/lib/office/casual-follow-up";
import { worstNeed } from "../../../src/lib/office/casuals";
import { addQualifiedCasual } from "../db";

// Task 28.11's rows (Phase 28; tests/e2e/casual.p28-profile.spec.ts), in the e2e database only (never
// the dev one), as the app role inside Acme, exactly as the app would; tests/e2e/db.ts's helpers by
// import, never edited. A casual of this spec's own (a drama-range number no other spec uses) who:
// - is a steward and a door supervisor (Acme's rules: a Level 2 spectator safety qualification and
//   an SIA door supervisor licence);
// - holds the licence, in date, with its number on her record;
// - let the Level 2 qualification run out 10 days ago, and the office marked that sorted (Casuals'
//   "Mark as sorted", the real path), so Profile reads "The office has this in hand.";
// - has a long email address, to see it break only after its @ or a dot;
// - has no days marked and no travel area.
// A rerun starts the same way (her records and days are rewritten; a new mark is the latest).
// Made-up details only.
export const P28_11_CASUAL = {
  firstName: "Tamsin",
  lastName: "Okafor",
  mobileE164: "+447700900311",
} as const;
// As she types it on the login page.
export const P28_11_TYPED = "07700 900311";
export const P28_11_EMAIL = "tamsin.okafor-hyphenated@long-staffing-agency.example.test";
export const P28_11_NUMBER = "1012 3456 7890 1234";
const RESOURCER = "p28-11.resourcer@example.com";

function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

export async function profileScene(): Promise<{ workerId: string }> {
  const workerId = await addQualifiedCasual("acme", P28_11_CASUAL, {
    roles: ["steward", "door_supervisor"],
    held: [
      { type: "SIA_DS", daysAhead: 700 },
      { type: "STEWARD_L2", daysAhead: -10 },
    ],
  });
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId("firm/acme");
    const withFirm = createWithFirm(pool);
    const resourcer = await withFirm(firmId, async (tx) => {
      await tx
        .update(workers)
        .set({ email: P28_11_EMAIL, notifyChannel: "sms", offerAlerts: true, smsOptedOutAt: null })
        .where(eq(workers.id, workerId));
      await tx
        .update(credentials)
        .set({ number: P28_11_NUMBER })
        .where(eq(credentials.workerId, workerId));
      await tx.delete(workerUnavailableDays).where(eq(workerUnavailableDays.workerId, workerId));
      await tx
        .insert(officeUsers)
        .values({ firmId, email: RESOURCER, name: "Pip Resourcer", role: "resourcer" })
        .onConflictDoNothing();
      const [me] = await tx
        .select({ id: officeUsers.id })
        .from(officeUsers)
        .where(eq(officeUsers.email, RESOURCER));
      if (!me) throw new Error("resourcer neither added nor found");
      return me.id;
    });
    // The office marks her worst need (the expired Level 2 qualification) sorted, as Casuals does.
    const sorted = await markNeedsSorted(
      { firm: { id: firmId }, officeUserId: resourcer, run: withFirm },
      workerId,
      worstNeed,
    );
    if (sorted.status !== "sorted") throw new Error(`not marked sorted: ${sorted.status}`);
    return { workerId };
  } finally {
    await pool.end();
  }
}
