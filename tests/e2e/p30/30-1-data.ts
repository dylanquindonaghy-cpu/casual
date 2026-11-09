import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import {
  assignments,
  credentials,
  firms,
  officeUsers,
  shifts,
  sites,
  uploads,
  workers,
} from "../../../src/lib/db/schema";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { recordEvent } from "../../../src/lib/events/record";
import { automaticEventId } from "../../../src/lib/roster/shift-events";
import { addEventWithSession, addOpenShift } from "../db";

// Task 30.1's rows (Phase 30; tests/e2e/casual.p30-home.spec.ts), made with tests/e2e/db.ts's
// helpers (imported, never edited) and this file's own. Made-up details only, on drama-range
// numbers outside tests/e2e/spare-mobiles.ts's blocks that no other spec or the seed uses:
// - Zara: a casual in a role of this spec's own (P30_ROLE, its rule: an SIA door supervisor licence
//   and a Level 2 spectator safety qualification), holding the licence (420 days to run) and the
//   qualification (no expiry), a staff photo the office approved 1,076 days ago (due again in about
//   20 days), no right-to-work check. She is booked on a session of her role 3 days ahead (8 hours
//   at £13.50, so "about £108.00 before tax"), logged as her own booking (her shift record's
//   "Booked by you"), and two sessions of her role are open to her: one tomorrow, one urgent 4 days
//   ahead. The office has sent her one reply she hasn't read. A rerun cancels the last run's
//   sessions and her old reply's read mark first, so it starts the same way.
// - Kit: another casual in the same role, booked on a session of his own 2 days ahead, which never
//   shows on Zara's Home.
export const P30_ROLE = "p30_home_check";
export const P30_1_ZARA = {
  firstName: "Zara",
  lastName: "Okafor",
  mobileE164: "+447700900530",
} as const;
export const P30_1_ZARA_TYPED = "07700 900530";
export const P30_1_KIT = {
  firstName: "Kit",
  lastName: "Marsh",
  mobileE164: "+447700900531",
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
    .values({ firmId, tourSeenAt: new Date(), ...who, roles: [P30_ROLE] })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ id: workers.id })
    .from(workers)
    .where(eq(workers.mobileE164, who.mobileE164));
  if (!row) throw new Error("casual neither added nor found");
  return row.id;
}

// A booked session of the role, `days` ahead, at a site of its own; returns the shift's id.
async function bookedSession(
  tx: FirmTx,
  firmId: string,
  workerId: string,
  o: { days: number; site: string },
): Promise<{ shiftId: string; startsAt: Date; endsAt: Date }> {
  const startsAt = hourFrom(o.days);
  const endsAt = new Date(startsAt.getTime() + 8 * 3_600_000);
  const [site] = await tx
    .insert(sites)
    .values({ firmId, name: o.site, addressLine1: "1 Test Road", postcode: "ZZ1 1AA" })
    .returning({ id: sites.id });
  if (!site) throw new Error("site insert returned nothing");
  const [firm] = await tx.select({ timezone: firms.timezone }).from(firms);
  const [shift] = await tx
    .insert(shifts)
    .values({
      firmId,
      siteId: site.id,
      shiftEventId: await automaticEventId(tx, {
        siteId: site.id,
        startsAt,
        source: "native",
        timeZone: firm?.timezone ?? "Europe/London",
      }),
      role: P30_ROLE,
      startsAt,
      endsAt,
      headcount: 1,
      status: "filled",
      source: "native",
      payRatePence: 1350,
      post: "Gate 2",
    })
    .returning({ id: shifts.id });
  if (!shift) throw new Error("shift insert returned nothing");
  const [booking] = await tx
    .insert(assignments)
    .values({
      firmId,
      shiftId: shift.id,
      slot: 1,
      workerId,
      status: "confirmed",
      confirmedAt: new Date(),
    })
    .returning({ id: assignments.id });
  if (!booking) throw new Error("booking insert returned nothing");
  // Logged as bookShift() logs her own booking: her shift record's "Booked by you".
  await recordEvent(tx, {
    actorType: "worker",
    actorId: workerId,
    action: "shift.assigned",
    entityType: "assignment",
    entityId: booking.id,
    data: { by: "worker", shiftId: shift.id, workerId, slot: 1, noticeHours: o.days * 24 },
  });
  return { shiftId: shift.id, startsAt, endsAt };
}

export interface P30Scene {
  zaraId: string;
  kitId: string;
  booked: { shiftId: string; startsAt: Date; endsAt: Date; site: string };
  kitBooked: { shiftId: string; site: string };
  openTomorrow: string;
  urgent: { shiftId: string; site: string };
}

export async function p30HomeScene(): Promise<P30Scene> {
  const stamp = Date.now().toString(36);
  const base = await inAcme(async (tx, firmId) => {
    await tx.execute(sql`
      insert into credential_rules (firm_id, sector, role, required_types)
      values (${firmId}, 'security', ${P30_ROLE}, '{SIA_DS,STEWARD_L2}')
      on conflict (firm_id, role) do nothing`);
    // The last run's sessions go first, so the counts start the same way (bookings are kept).
    await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.role, P30_ROLE));
    const zaraId = await casual(tx, firmId, P30_1_ZARA);
    const kitId = await casual(tx, firmId, P30_1_KIT);
    // Her qualifications, as the office recorded them.
    await tx.delete(credentials).where(eq(credentials.workerId, zaraId));
    const today = new Date();
    const in420 = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 420),
    );
    await tx.insert(credentials).values([
      {
        firmId,
        workerId: zaraId,
        type: "SIA_DS",
        status: "valid",
        expiresOn: in420.toISOString().slice(0, 10),
      },
      { firmId, workerId: zaraId, type: "STEWARD_L2", status: "valid", expiresOn: null },
    ]);
    await tx.delete(credentials).where(eq(credentials.workerId, kitId));
    await tx.insert(credentials).values([
      { firmId, workerId: kitId, type: "SIA_DS", status: "valid", expiresOn: "2030-01-01" },
      { firmId, workerId: kitId, type: "STEWARD_L2", status: "valid", expiresOn: null },
    ]);
    // Her staff photo, approved 1,076 days ago (36 months last: due again in about 20 days).
    const [checker] = await tx.select({ id: officeUsers.id }).from(officeUsers).limit(1);
    if (!checker) throw new Error("no office user to approve the photo");
    await tx.delete(uploads).where(and(eq(uploads.workerId, zaraId), eq(uploads.kind, "photo")));
    const photoOn = new Date(Date.now() - 1076 * 86_400_000);
    photoOn.setUTCHours(12, 0, 0, 0);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    await tx.insert(uploads).values({
      firmId,
      workerId: zaraId,
      kind: "photo",
      contentType: "image/jpeg",
      size: jpeg.length,
      sha256: createHash("sha256").update(jpeg).digest("hex"),
      data: jpeg,
      status: "approved",
      checkedBy: checker.id,
      checkedAt: photoOn,
      createdAt: photoOn,
    });
    const bookedSite = `P30 Booked Hall ${stamp}`;
    const booked = await bookedSession(tx, firmId, zaraId, { days: 3, site: bookedSite });
    const kitSite = `P30 Kit Hall ${stamp}`;
    const kitBooked = await bookedSession(tx, firmId, kitId, { days: 2, site: kitSite });
    // One office reply she hasn't read: all before it read, then the reply. Texts and open-shift
    // alerts on, as a new casual's, so "Do this" holds only her photo.
    await tx.execute(sql`
      update workers
         set messages_read_at = now(), sms_opted_out_at = null, offer_alerts = true
       where id = ${zaraId}`);
    await tx.execute(sql`
      insert into messages (firm_id, direction, channel, provider_message_id, worker_id, body,
                            created_at)
      values (${firmId}, 'out', 'app', ${`app:p30-${stamp}`}, ${zaraId}, 'See you there.',
              now() + interval '1 second')`);
    return {
      zaraId,
      kitId,
      booked: { ...booked, site: bookedSite },
      kitBooked: { shiftId: kitBooked.shiftId, site: kitSite },
    };
  });
  const openTomorrow = await addOpenShift("acme", { role: P30_ROLE, daysAhead: 1 });
  const urgentSite = `P30 Urgent Hall ${stamp}`;
  const urgent = await addEventWithSession("acme", {
    name: `P30 urgent ${stamp}`,
    site: urgentSite,
    role: P30_ROLE,
    daysAhead: 4,
    urgent: true,
  });
  return { ...base, openTomorrow, urgent: { shiftId: urgent.shiftId, site: urgentSite } };
}
