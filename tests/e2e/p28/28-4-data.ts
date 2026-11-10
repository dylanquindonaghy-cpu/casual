import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import { offers, officeUsers, shifts, workers } from "../../../src/lib/db/schema";
import { createWithFirm } from "../../../src/lib/db/scoped";
import { recordEvent } from "../../../src/lib/events/record";
import { bookShift } from "../../../src/lib/roster/book";
import { cancelShiftByFirm } from "../../../src/lib/roster/cancel";
import { moveShiftByFirm } from "../../../src/lib/roster/firm-change";
import { noticeHours } from "../../../src/lib/roster/notice";
import { addEventWithSession, addOfficeUser, bookAndCancel } from "../db";

// Task 28.4's rows (Phase 28; tests/e2e/casual.p28-record.spec.ts): a casual of this spec's own
// whose shift record has one of each kind of row, every one made by the real code as the app makes
// it, in the seeded firm "acme" of the e2e database:
//   - a session inside 48 hours she took and cancelled herself ("Travel problem"): a strike;
//   - one six days away she took and cancelled ("I'm unwell"): no strike;
//   - one she took that the office then moved two hours later, for the weather;
//   - an offer of a session she can see;
//   - one she took that the office cancelled, the client asking: no link.
// Its sessions are in a role of its own (RECORD_ROLE, with no qualification needed), so no other
// spec's casual sees them, and a rerun cancels its last run's sessions first. tests/e2e/db.ts's
// helpers are imported, never edited. Made-up details only: a drama-range number no other spec uses.

export const P28_4_CASUAL = {
  firstName: "Wren",
  lastName: "Ashdown",
  mobileE164: "+447700900284",
} as const;
// As she types it on the login page.
export const P28_4_TYPED = "07700 900284";
export const P28_4_OFFICE = {
  email: "record.resourcer@example.com",
  name: "Record Resourcer",
  role: "resourcer",
} as const;
export const RECORD_ROLE = "record_check";

// The e2e database's address for the app role (never the dev one), as tests/e2e/db.ts's own.
function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

export interface RecordScene {
  workerId: string;
  sites: { strike: string; calm: string; moved: string; offered: string; gone: string };
  shiftIds: { moved: string; offered: string; gone: string };
  refs: { strike: string; calm: string };
}

export async function recordScene(run: string): Promise<RecordScene> {
  const firmId = seedId("firm/acme");
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const runAs = createWithFirm(pool);

    // Her, in the spec's own role (needing no qualification); last run's sessions cancelled.
    const workerId = await runAs(firmId, async (tx) => {
      await tx.execute(sql`
        insert into credential_rules (firm_id, sector, role, required_types)
        values (${firmId}, 'security', ${RECORD_ROLE}, '{}')
        on conflict (firm_id, role) do nothing`);
      await tx
        .insert(workers)
        .values({ firmId, tourSeenAt: new Date(), ...P28_4_CASUAL, roles: [RECORD_ROLE] })
        .onConflictDoNothing();
      await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.role, RECORD_ROLE));
      const [found] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(eq(workers.mobileE164, P28_4_CASUAL.mobileE164));
      if (!found) throw new Error("record casual neither added nor found");
      return found.id;
    });
    await addOfficeUser("acme", P28_4_OFFICE);
    const officeUserId = await runAs(firmId, async (tx) => {
      const [found] = await tx
        .select({ id: officeUsers.id })
        .from(officeUsers)
        .where(eq(officeUsers.email, P28_4_OFFICE.email));
      if (!found) throw new Error("record resourcer not found");
      return found.id;
    });
    const office = { type: "office" as const, id: officeUserId };

    const sites = {
      strike: `Record Strike Hall ${run}`,
      calm: `Record Calm Hall ${run}`,
      moved: `Record Moved Hall ${run}`,
      offered: `Record Offer Hall ${run}`,
      gone: `Record Gone Hall ${run}`,
    };
    const session = (site: string, daysAhead: number) =>
      addEventWithSession("acme", { name: `${site} Event`, site, role: RECORD_ROLE, daysAhead });
    const book = async (shiftId: string) => {
      const booked = await bookShift(runAs, firmId, {
        shiftId,
        workerId,
        by: { type: "worker", id: workerId },
      });
      if (booked.status !== "booked") throw new Error(`not booked: ${booked.status}`);
    };

    // Her own cancellations: one a strike, one with days of notice.
    const strike = await session(sites.strike, 1);
    const struck = await bookAndCancel("acme", {
      shiftId: strike.shiftId,
      workerId,
      reason: "Travel problem",
      warning: "strike",
    });
    const calm = await session(sites.calm, 6);
    const calmed = await bookAndCancel("acme", {
      shiftId: calm.shiftId,
      workerId,
      reason: "I'm unwell",
    });

    // She takes one; the office moves it two hours later, for the weather.
    const moved = await session(sites.moved, 4);
    await book(moved.shiftId);
    const [before] = await runAs(firmId, (tx) =>
      tx
        .select({ startsAt: shifts.startsAt, endsAt: shifts.endsAt, siteId: shifts.siteId })
        .from(shifts)
        .where(eq(shifts.id, moved.shiftId)),
    );
    if (!before) throw new Error("moved session not found");
    const shifted = await moveShiftByFirm(runAs, firmId, {
      shiftId: moved.shiftId,
      startsAt: new Date(before.startsAt.getTime() + 2 * 3_600_000),
      endsAt: new Date(before.endsAt.getTime() + 2 * 3_600_000),
      siteId: before.siteId,
      reason: "weather",
      by: office,
    });
    if (shifted.status !== "moved") throw new Error(`not moved: ${shifted.status}`);

    // An offer of a session she can see, logged as the offer job logs one.
    const offered = await session(sites.offered, 8);
    await runAs(firmId, async (tx) => {
      const [shift] = await tx
        .select({ startsAt: shifts.startsAt })
        .from(shifts)
        .where(eq(shifts.id, offered.shiftId));
      if (!shift) throw new Error("offered session not found");
      const [offer] = await tx
        .insert(offers)
        .values({ firmId, shiftId: offered.shiftId, workerId, wave: 1, channel: "push" })
        .returning({ id: offers.id });
      if (!offer) throw new Error("offer insert returned nothing");
      await recordEvent(tx, {
        actorType: "system",
        action: "offer.sent",
        entityType: "offer",
        entityId: offer.id,
        data: {
          shiftId: offered.shiftId,
          workerId,
          wave: 1,
          noticeHours: noticeHours(shift.startsAt, new Date()),
          channel: "push",
        },
      });
    });

    // She takes one; the office cancels the whole session, the client asking.
    const gone = await session(sites.gone, 10);
    await book(gone.shiftId);
    const cancelled = await cancelShiftByFirm(runAs, firmId, {
      shiftId: gone.shiftId,
      reason: "event_cancelled",
      askedBy: "client",
      by: office,
    });
    if (cancelled.status !== "cancelled") throw new Error(`not cancelled: ${cancelled.status}`);

    return {
      workerId,
      sites,
      shiftIds: { moved: moved.shiftId, offered: offered.shiftId, gone: gone.shiftId },
      refs: { strike: struck.ref, calm: calmed.ref },
    };
  } finally {
    await pool.end();
  }
}
