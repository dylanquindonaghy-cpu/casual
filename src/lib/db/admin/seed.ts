import { sql } from "drizzle-orm";
import { Client, Pool } from "pg";
import { applyCredentialPack } from "../../credentials/apply-pack";
import { recordEvent } from "../../events/record";
import { createWithFirm, type FirmTx } from "../scoped";
import {
  assignments,
  credentials,
  officeUsers,
  payRecords,
  requests,
  shifts,
  sites,
  workers,
} from "../schema";
import { seedFirms, type SeedFirm } from "./seed-data";
import { acmeSaturday, type SaturdaySeed } from "./seed-saturday";
import { isLocalHost } from "./urls";

// Loads the demo firms (docs/testing.md). Firms are created through the owner connection (the
// app role can't create firms); everything else goes through withFirm as the app role, like the
// app itself. Rows are upserted by fixed ids, so running it again changes nothing, and it puts
// seeded rows back as seeded (status included). Acme's Saturday event day (seed-saturday.ts:
// shifts, bookings, the urgent dropout, requests, pay records) is only ever added, never reset,
// so a re-run mid-demo can't undo the demo; its bookings, dropout and requests are logged as the
// app would log them, once, when first added. Rows added during a demo stay: only
// `npm run db:reset` returns the database to exactly the demo state.

export interface SeedSummary {
  firms: {
    slug: string;
    sites: number;
    officeUsers: number;
    workers: number;
    credentials: number;
    shifts: number; // on the event day (Acme only)
    eventDay: string | null;
    urgentShiftId: string | null; // the dropout's shift
  }[];
}

export async function seed(opts: {
  adminUrl: string;
  appUrl: string;
  nodeEnv: string;
  today?: Date;
}): Promise<SeedSummary> {
  // Checked before any connection is made (golden rule 7: fake data, never near real data).
  if (opts.nodeEnv === "production")
    throw new Error("The seed never runs with NODE_ENV=production");
  if (!isLocalHost(opts.adminUrl) || !isLocalHost(opts.appUrl)) {
    throw new Error("The seed only runs against a database on this machine");
  }

  const now = opts.today ?? new Date();
  const firms = seedFirms(now);
  const owner = new Client({ connectionString: opts.adminUrl });
  const appPool = new Pool({ connectionString: opts.appUrl, max: 2 });
  const withFirm = createWithFirm(appPool);
  await owner.connect();
  try {
    const summary: SeedSummary = { firms: [] };
    for (const firm of firms) {
      await provisionFirm(owner, firm);
      const saturday = firm.slug === "acme" ? acmeSaturday(firm.workers, firm.sites, now) : null;
      await withFirm(firm.id, async (tx) => {
        await loadFirm(tx, firm);
        if (saturday) await loadSaturday(tx, firm.id, saturday);
      });
      summary.firms.push({
        slug: firm.slug,
        sites: firm.sites.length,
        officeUsers: firm.officeUsers.length,
        workers: firm.workers.length,
        credentials: firm.credentials.length,
        shifts: saturday?.shifts.length ?? 0,
        eventDay: saturday?.day ?? null,
        urgentShiftId: saturday?.urgentShiftId ?? null,
      });
    }
    return summary;
  } finally {
    await owner.end();
    await appPool.end();
  }
}

// RLS is forced for the owner too, so it sets the firm it is creating, exactly like withFirm.
async function provisionFirm(owner: Client, firm: SeedFirm): Promise<void> {
  await owner.query("begin");
  try {
    await owner.query("select set_config('app.current_firm_id', $1, true)", [firm.id]);
    await owner.query(
      `insert into firms (id, name, slug, sector, settings) values ($1, $2, $3, $4, $5)
       on conflict (id) do update set name = excluded.name, slug = excluded.slug,
         sector = excluded.sector, settings = excluded.settings`,
      [firm.id, firm.name, firm.slug, firm.sector, JSON.stringify(firm.settings)],
    );
    await owner.query("commit");
  } catch (err) {
    await owner.query("rollback");
    throw err;
  }
}

async function loadFirm(tx: FirmTx, firm: SeedFirm): Promise<void> {
  const firmId = firm.id;
  // The sector's credential types and default role rules first; existing ones stay as they are.
  await applyCredentialPack(tx, firm.sector, { type: "system" });
  await tx
    .insert(sites)
    .values(firm.sites.map((s) => ({ ...s, firmId })))
    .onConflictDoUpdate({
      target: sites.id,
      set: { name: sql`excluded.name`, town: sql`excluded.town`, postcode: sql`excluded.postcode` },
    });
  await tx
    .insert(officeUsers)
    .values(firm.officeUsers.map((u) => ({ ...u, firmId })))
    .onConflictDoUpdate({
      target: officeUsers.id,
      set: {
        email: sql`excluded.email`,
        name: sql`excluded.name`,
        role: sql`excluded.role`,
        status: sql`'active'`,
      },
    });
  await tx
    .insert(workers)
    .values(firm.workers.map((w) => ({ ...w, firmId })))
    .onConflictDoUpdate({
      target: workers.id,
      set: {
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        mobileE164: sql`excluded.mobile_e164`,
        email: sql`excluded.email`,
        roles: sql`excluded.roles`,
        status: sql`'active'`,
      },
    });
  await tx
    .insert(credentials)
    .values(firm.credentials.map((c) => ({ ...c, firmId })))
    .onConflictDoUpdate({
      target: credentials.id,
      set: {
        type: sql`excluded.type`,
        number: sql`excluded.number`,
        expiresOn: sql`excluded.expires_on`,
        status: sql`excluded.status`,
        verifiedAt: sql`null`,
        verifiedBy: sql`null`,
      },
    });
}

// Acme's Saturday: added once (fixed ids, nothing overwritten), and logged once, as the app logs
// a booking, a cancellation and a request (ids and notice hours only; the reason and the notes
// stay on their rows).
async function loadSaturday(tx: FirmTx, firmId: string, day: SaturdaySeed): Promise<void> {
  const newShifts = await tx
    .insert(shifts)
    .values(
      day.shifts.map((s) => ({
        ...s,
        firmId,
        headcount: 1,
        source: "native" as const,
        createdAt: day.shiftsCreatedAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: shifts.id });
  // Bookings and requests only on shifts added just now: a shift already there (and whatever a
  // demo did with it) is left exactly as it is.
  const fresh = new Set(newShifts.map((s) => s.id));
  for (const s of newShifts) {
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.created",
      entityType: "shift",
      entityId: s.id,
      data: { source: "seed" },
    });
  }
  const bookings = day.bookings.filter((b) => fresh.has(b.shiftId));
  const toAsk = day.requests.filter((r) => fresh.has(r.shiftId));
  if (bookings.length === 0) return loadPay(tx, firmId, day);
  const added = await tx
    .insert(assignments)
    .values(
      bookings.map((b) => ({
        id: b.id,
        firmId,
        shiftId: b.shiftId,
        slot: 1,
        workerId: b.workerId,
        status: b.status,
        confirmedAt: b.confirmedAt,
        cancelledAt: b.cancelledAt,
        cancelReason: b.cancelReason,
        noticeHours: b.noticeHours === null ? null : b.noticeHours.toFixed(2),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: assignments.id });
  const newlyAdded = new Set(added.map((a) => a.id));
  for (const b of bookings) {
    if (!newlyAdded.has(b.id)) continue;
    await recordEvent(tx, {
      actorType: "worker",
      actorId: b.workerId,
      action: "shift.assigned",
      entityType: "assignment",
      entityId: b.id,
      data: {
        by: "worker",
        shiftId: b.shiftId,
        workerId: b.workerId,
        slot: 1,
        noticeHours: b.bookedNoticeHours,
      },
    });
    if (b.status === "cancelled_worker") {
      await recordEvent(tx, {
        actorType: "worker",
        actorId: b.workerId,
        action: "shift.cancelled",
        entityType: "assignment",
        entityId: b.id,
        data: {
          by: "worker",
          shiftId: b.shiftId,
          workerId: b.workerId,
          noticeHours: b.noticeHours,
        },
      });
    }
  }
  const asked =
    toAsk.length === 0
      ? []
      : await tx
          .insert(requests)
          .values(toAsk.map((r) => ({ ...r, firmId })))
          .onConflictDoNothing()
          .returning({
            id: requests.id,
            workerId: requests.workerId,
            shiftId: requests.shiftId,
            type: requests.type,
          });
  for (const r of asked) {
    await recordEvent(tx, {
      actorType: "worker",
      actorId: r.workerId,
      action: "request.created",
      entityType: "request",
      entityId: r.id,
      data: { type: r.type, shiftId: r.shiftId },
    });
  }
  await loadPay(tx, firmId, day);
}

async function loadPay(tx: FirmTx, firmId: string, day: SaturdaySeed): Promise<void> {
  await tx
    .insert(payRecords)
    .values(day.pay.map((p) => ({ ...p, firmId })))
    .onConflictDoNothing();
}
