import { and, eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import { assignments, firms, shifts, sites, workers } from "../../../src/lib/db/schema";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { automaticEventId } from "../../../src/lib/roster/shift-events";
import { addBookedShift } from "../db";

// Task 28.12's rows (Phase 28; tests/e2e/casual.p28-help-cancel.spec.ts), in Acme's e2e database,
// built with tests/e2e/db.ts's helpers (imported, never edited) and a few rows of its own written
// as the app role, exactly as the app would:
//
// - a casual of this spec's own (steward, the role addBookedShift books);
// - her bookings, one at a time as the spec needs them: one 5 days ahead (outside the firm's
//   48-hour strike notice: "No strike."), and one starting about a minute and a half from now (to
//   be started by the time she taps "Can't make it?": "This shift has already started.").
//
// A rerun starts the same way: her last run's live bookings' sessions are cancelled first. Made-up
// details only: a drama-range number no other spec uses.
export const P28_12_CASUAL = {
  firstName: "Robin",
  lastName: "Ashdown",
  mobileE164: "+447700900292",
} as const;
// As she types it on the login page.
export const P28_12_TYPED = "07700 900292";

function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

async function inFirm<T>(
  slug: string,
  work: (tx: FirmTx, firmId: string) => Promise<T>,
): Promise<T> {
  const firmId = seedId(`firm/${slug}`);
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    return await createWithFirm(pool)(firmId, (tx) => work(tx, firmId));
  } finally {
    await pool.end();
  }
}

// Her (added once, found after), with nothing booked: her last run's live bookings' sessions are
// cancelled. Returns her id.
export async function helpCancelCasual(slug = "acme"): Promise<string> {
  return inFirm(slug, async (tx, firmId) => {
    await tx
      .insert(workers)
      .values({ firmId, ...P28_12_CASUAL, roles: ["steward"] })
      .onConflictDoNothing();
    const [me] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(eq(workers.mobileE164, P28_12_CASUAL.mobileE164));
    if (!me) throw new Error("28.12's casual neither added nor found");
    const mine = tx
      .select({ id: assignments.shiftId })
      .from(assignments)
      .where(and(eq(assignments.workerId, me.id), eq(assignments.status, "confirmed")));
    await tx.update(shifts).set({ status: "cancelled" }).where(inArray(shifts.id, mine));
    return me.id;
  });
}

// The firm's settings as stored (Help reads them through the rules' own parsers; the spec does the
// same to know which numbers to expect).
export async function firmSettingsOf(slug = "acme"): Promise<Record<string, unknown>> {
  return inFirm(slug, async (tx, firmId) => {
    const [firm] = await tx
      .select({ settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, firmId));
    return firm?.settings ?? {};
  });
}

// A session of the spec's own taken off Booked once it has served (test set-up, not a cancellation
// she sees).
export async function endSession(slug: string, shiftId: string): Promise<void> {
  await inFirm(slug, async (tx) => {
    await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.id, shiftId));
  });
}

// Her booking 5 days ahead (addBookedShift: steward, 8 hours, its own site).
export async function bookFarOff(
  slug: string,
  workerId: string,
  site: string,
): Promise<{ shiftId: string }> {
  return addBookedShift(slug, { workerId, daysAhead: 5, site });
}

// Her booking starting `seconds` from now, to the second (addBookedShift rounds to the hour): a
// session of its own at a site of its own, filled by her confirmed booking.
export async function bookStartingIn(
  slug: string,
  workerId: string,
  site: string,
  seconds: number,
): Promise<{ shiftId: string; startsAt: Date }> {
  const startsAt = new Date(Date.now() + seconds * 1000);
  startsAt.setUTCMilliseconds(0);
  return inFirm(slug, async (tx, firmId) => {
    const [place] = await tx
      .insert(sites)
      .values({ firmId, name: site })
      .returning({ id: sites.id });
    if (!place) throw new Error("site insert returned nothing");
    // The session's automatic event (one per site and day), as the app files a new session.
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, firmId));
    const eventId = await automaticEventId(tx, {
      siteId: place.id,
      startsAt,
      source: "native",
      timeZone: firm?.timezone ?? "Europe/London",
    });
    const [shift] = await tx
      .insert(shifts)
      .values({
        firmId,
        shiftEventId: eventId,
        role: "steward",
        siteId: place.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
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
      workerId,
      status: "confirmed",
      confirmedAt: new Date(),
    });
    return { shiftId: shift.id, startsAt };
  });
}
