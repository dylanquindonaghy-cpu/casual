import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import { assignments, events, pushSubscriptions, shifts } from "../../../src/lib/db/schema";
import { createWithFirm } from "../../../src/lib/db/scoped";
import { addBookedShift, addWorker, unusedMobile } from "../db";

// Task 28.3's rows (Phase 28; tests/e2e/office.p28-details-notice.spec.ts): a session of this
// spec's own, 15 days ahead at a made-up venue, with two casuals of its own booked on it (made with
// tests/e2e/db.ts's helpers, imported, never edited): Eli, whose phone has notifications on (a
// made-up push address), and Dora, who has none (so a text, in the console outbox). Each run makes
// new ones, on numbers no casual of the firm has (07700 900330 to 900349). Fake details only.

// The e2e database (never the dev one), as the app role or as the jobs role (pg-boss's tables).
function e2eUrl(name: "DATABASE_URL" | "DATABASE_JOBS_URL"): string {
  const url = process.env[name];
  if (!url) throw new Error(`${name} must be set`);
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

async function inE2e<T>(
  name: "DATABASE_URL" | "DATABASE_JOBS_URL",
  work: (pool: Pool) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: e2eUrl(name), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    return await work(pool);
  } finally {
    await pool.end();
  }
}

export interface DetailsScene {
  shiftId: string;
  pushWorker: string; // Eli: notifications on
  textWorker: string; // Dora: none, so a text
  textMobile: string;
}

export async function detailsScene(slug: string): Promise<DetailsScene> {
  const run = randomBytes(3).toString("hex");
  const pushMobile = await unusedMobile(slug, 330, 349);
  const pushWorker = await addWorker(slug, {
    firstName: "Eli",
    lastName: `Briefing ${run}`,
    mobileE164: pushMobile,
  });
  const textMobile = await unusedMobile(slug, 330, 349);
  const textWorker = await addWorker(slug, {
    firstName: "Dora",
    lastName: `Briefing ${run}`,
    mobileE164: textMobile,
  });
  // Eli on the session's first place (tests/e2e/db.ts), then a second place for Dora.
  const { shiftId } = await addBookedShift(slug, {
    workerId: pushWorker,
    daysAhead: 15,
    site: `P28.3 Arena ${run}`,
  });
  const firmId = seedId(`firm/${slug}`);
  await inE2e("DATABASE_URL", (pool) =>
    createWithFirm(pool)(firmId, async (tx) => {
      await tx.update(shifts).set({ headcount: 2 }).where(eq(shifts.id, shiftId));
      await tx.insert(assignments).values({
        firmId,
        shiftId,
        slot: 2,
        workerId: textWorker,
        status: "confirmed",
        confirmedAt: new Date(),
      });
      await tx.insert(pushSubscriptions).values({
        firmId,
        workerId: pushWorker,
        endpoint: `https://fcm.googleapis.com/fcm/send/e2e-details-${run}`,
        p256dh: "e2e-made-up-key",
        auth: "e2e-made-up-auth",
      });
    }),
  );
  return { shiftId, pushWorker, textWorker, textMobile };
}

// The notice's job waits 2 minutes for more saves (src/lib/notices/details-changed.ts: a burst is
// one message). The test doesn't wait: its job is due now, as if the 2 minutes had passed. Returns
// how many jobs it moved (one for the save).
export async function startDetailsNoticeNow(slug: string, shiftId: string): Promise<number> {
  const firmId = seedId(`firm/${slug}`);
  return inE2e("DATABASE_JOBS_URL", async (pool) => {
    const moved = await pool.query(
      `update pgboss.job set start_after = now()
        where name = 'details-notice' and state = 'created'
          and data ->> 'firmId' = $1 and data ->> 'shiftId' = $2`,
      [firmId, shiftId],
    );
    return moved.rowCount ?? 0;
  });
}

// How each casual's notice went, from its logged outcome (shift.details_notice_sent): by worker,
// its channel ("push", "sms"). The console push sender prints to the worker's own log, not the
// outbox, so the record is where a push shows.
export async function detailsNoticeChannels(
  slug: string,
  shiftId: string,
): Promise<Record<string, string>> {
  const firmId = seedId(`firm/${slug}`);
  return inE2e("DATABASE_URL", (pool) =>
    createWithFirm(pool)(firmId, async (tx) => {
      const rows = await tx
        .select({ data: events.data })
        .from(events)
        .where(
          and(
            eq(events.action, "shift.details_notice_sent"),
            sql`${events.data} ->> 'shiftId' = ${shiftId}`,
          ),
        );
      return Object.fromEntries(
        rows.map((r) => [String(r.data.workerId), String(r.data.channel)] as const),
      );
    }),
  );
}
