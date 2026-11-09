import { and, eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import { assignments, events, shifts, workers } from "../../../src/lib/db/schema";
import { createWithFirm } from "../../../src/lib/db/scoped";
import { addBookedShift, addEventWithSession } from "../db";

// Task 28.5's rows (Phase 28; tests/e2e/casual.p28-shift-page.spec.ts), in Acme's e2e database,
// built with tests/e2e/db.ts's helpers (imported, never edited) and a few rows of its own written
// as the app role, exactly as the app would:
//
// - a casual of this spec's own, in a role of its own that needs nothing (so the urgent session is
//   hers to take), with no travel area (so "Getting there" is the travel line's one sentence);
// - an urgent open session of an event of its own, 2 days ahead (inside the firm's 48-hour strike
//   notice), with no pay rate ("Ask the office about the pay");
// - her booking starting within 3 hours ("Running late?", "Add to my calendar");
// - her booking 5 days ahead that the office then moved, and whose meeting point and instructions
//   it changed, after she booked ("The times changed. Add it to your calendar again.", "Changed
//   since you booked: instructions and meeting point (…)"); the change entry also carries a rota
//   sheet's `overridden` list naming another casual, which must never reach her page.
//
// A rerun starts the same way: the last run's sessions in the role, and her last bookings'
// sessions, are cancelled first. Made-up details only: a drama-range number no other spec uses.
export const P28_5_CASUAL = {
  firstName: "Kit",
  lastName: "Fairley",
  mobileE164: "+447700900285",
} as const;
// As she types it on the login page.
export const P28_5_TYPED = "07700 900285";
export const P28_5_ROLE = "p28_shift_page";

function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

export interface ShiftPageScene {
  workerId: string;
  urgent: string; // the urgent open session's id
  soon: string; // her booking starting within 3 hours
  moved: string; // her booking the office moved and changed since she booked
  otherCasual: string; // a seeded casual named by the sync entry's `overridden`
}

export async function shiftPageScene(slug = "acme"): Promise<ShiftPageScene> {
  const firmId = seedId(`firm/${slug}`);
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  let workerId: string;
  let otherCasual: string;
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    ({ workerId, otherCasual } = await createWithFirm(pool)(firmId, async (tx) => {
      await tx.execute(sql`
        insert into credential_rules (firm_id, sector, role, required_types)
        values (${firmId}, 'security', ${P28_5_ROLE}, '{}')
        on conflict (firm_id, role) do nothing`);
      await tx
        .insert(workers)
        .values({ firmId, tourSeenAt: new Date(), ...P28_5_CASUAL, roles: [P28_5_ROLE] })
        .onConflictDoNothing();
      const [me] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(eq(workers.mobileE164, P28_5_CASUAL.mobileE164));
      if (!me) throw new Error("28.5's casual neither added nor found");
      // The last run's sessions: the role's, and those of her live bookings.
      await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.role, P28_5_ROLE));
      const mine = tx
        .select({ id: assignments.shiftId })
        .from(assignments)
        .where(and(eq(assignments.workerId, me.id), eq(assignments.status, "confirmed")));
      await tx.update(shifts).set({ status: "cancelled" }).where(inArray(shifts.id, mine));
      const [other] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(sql`${workers.id} <> ${me.id} and ${workers.status} = 'active'`)
        .limit(1);
      if (!other) throw new Error("no other casual to name in the sync entry");
      return { workerId: me.id, otherCasual: other.id };
    }));
  } finally {
    await pool.end();
  }

  const stamp = Date.now().toString(36);
  const { shiftId: urgent } = await addEventWithSession(slug, {
    name: `P28.5 Riverside ${stamp}`,
    site: `P28.5 Urgent Hall ${stamp}`,
    role: P28_5_ROLE,
    daysAhead: 2,
    urgent: true,
  });
  // Within 3 hours (the helper rounds down to the hour: between 1h30 and 2h30 ahead).
  const { shiftId: soon } = await addBookedShift(slug, {
    workerId,
    daysAhead: 2.5 / 24,
    site: `P28.5 Soon Hall ${stamp}`,
  });
  const { shiftId: moved } = await addBookedShift(slug, {
    workerId,
    daysAhead: 5,
    site: `P28.5 Moved Hall ${stamp}`,
  });

  const again = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    await createWithFirm(again)(firmId, async (tx) => {
      const [booking] = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(and(eq(assignments.shiftId, moved), eq(assignments.workerId, workerId)));
      if (!booking) throw new Error("28.5's moved booking not found");
      // After she booked (a later transaction, so a later time): the office moved her booking
      // (logged on it), and changed the session's meeting point and instructions. The change entry
      // carries a rota sheet's `overridden` list too, as a sync's does: another casual's id.
      await tx.insert(events).values({
        firmId,
        actorType: "system",
        createdAt: new Date(),
        action: "shift.moved",
        entityType: "assignment",
        entityId: booking.id,
        data: { by: "firm", shiftId: moved, workerId, reason: "The event's times changed" },
      });
      await tx.insert(events).values({
        firmId,
        actorType: "system",
        createdAt: new Date(),
        action: "shift.changed",
        entityType: "shift",
        entityId: moved,
        data: {
          fields: ["meetingPoint", "instructions", "headcount"],
          overridden: [{ workerId: otherCasual, codes: ["rest"] }],
        },
      });
      await tx
        .update(shifts)
        .set({ meetingPoint: "Staff gate on Mill Lane", instructions: "Ask for the steward lead." })
        .where(eq(shifts.id, moved));
    });
  } finally {
    await again.end();
  }
  return { workerId, urgent, soon, moved, otherCasual };
}
