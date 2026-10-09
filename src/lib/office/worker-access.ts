import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { endEverySession } from "../auth/sessions";
import { qualificationsFor, type CasualQualifications } from "../credentials/qualifications";
import {
  assignments,
  firms,
  sites,
  workers,
  workerSiteBlocks,
  workerTravel,
  type SITE_BLOCK_REASONS,
  type TravelMode,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { retryAborted } from "../db/retry";
import { recordEvent } from "../events/record";
import { forgetPhones, reflagFutureBookings } from "../roster/worker-effects";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import { STRIKES_PER_CASUAL, strikesOf, type CasualStrike } from "./strikes";
import type {
  DeactivateReason,
  ReactivateReason,
  SiteUnblockReason,
  UnblockReason,
} from "./worker-reasons";

// The office's controls for one worker (Phase 10; audit M22, M23, L24, L81; docs/screens.md
// `/office/casuals/[id]`, `/office/workers/[id]` until 12F.1), for active admins and resourcers (checked again inside each change).
// One transaction each, the worker's row locked first (FOR NO KEY UPDATE, as the office team's
// changes: a login finishing at the same moment can't deadlock with it, and its session is ended
// too: src/lib/auth/sessions.ts endEverySession). Every change has a reason from a fixed list and
// is logged with ids, codes and counts only. An erased worker can't be changed.
//
// - Make inactive (they've left): status inactive, and the office's mark that it decided this
//   (`office_deactivated_at`): no rota sheet or file makes them active again, only the office.
//   Every session and unused login link ended. Their future bookings are flagged on Today.
// - Make active again (inactive only) and unblock (blocked only): status active, the mark
//   cleared, anything left from before ended. A rota sheet or file still saying "blocked" blocks
//   them again at its next sync: the page says to change it there too.
// - Block from a site / unblock from a site: rules check 9 (src/lib/rules/eligibility.ts). Their
//   future bookings at that site are flagged on Today.
// - Log out on every device (a lost phone): sessions and links ended, and the phone's
//   notifications forgotten (so a reminder can't show on the lost phone).
// - Keep a flagged booking: Today's "Bookings to check" no longer shows it, until the worker's
//   status or a site block changes again.

type WorkerStatus = "active" | "inactive" | "blocked";

export type WorkerStatusChange =
  | { kind: "deactivate"; reason: DeactivateReason }
  | { kind: "reactivate"; reason: ReactivateReason }
  | { kind: "unblock"; reason: UnblockReason };

type Common = { status: "not_found" } | { status: "not_allowed" } | { status: "erased" };

export type WorkerStatusResult =
  | {
      status: "done";
      change: WorkerStatusChange["kind"];
      name: string;
      futureBookings: number; // flagged on Today (making inactive)
      // After the change: unblocking someone the office made inactive leaves them inactive.
      now: WorkerStatus;
    }
  | { status: "unchanged"; change: WorkerStatusChange["kind"]; name: string; current: WorkerStatus }
  | Common;

export type SignOutResult =
  | {
      status: "done" | "unchanged";
      name: string;
      sessionsEnded: number;
      loggedIn: boolean; // they had a session or an unused link (else only phones' notifications)
    }
  | Common;

export type SiteBlockResult =
  | { status: "done" | "unchanged"; name: string; site: string; futureBookings: number }
  | { status: "no_site" }
  | Common;

export type KeepResult =
  | {
      status: "kept" | "already" | "not_flagged";
      name: string;
      cause?: "inactive" | "blocked" | "site_blocked";
    }
  | { status: "not_found" }
  | { status: "not_allowed" };

const nowOf = (ctx: OfficeContext) => (ctx.clock ?? systemClock).now();

// Inside the firm's transaction: the acting office user may use `area`, and the worker, locked.
async function lockWorker(tx: FirmTx, ctx: OfficeContext, workerId: string) {
  if (!(await officeUserMay(tx, ctx.officeUserId, "casuals"))) return "not_allowed" as const;
  const [worker] = await tx
    .select({
      id: workers.id,
      firstName: workers.firstName,
      lastName: workers.lastName,
      status: workers.status,
      erasedAt: workers.erasedAt,
      officeDeactivatedAt: workers.officeDeactivatedAt,
    })
    .from(workers)
    .where(eq(workers.id, workerId))
    .for("no key update");
  if (!worker) return "not_found" as const;
  if (worker.erasedAt !== null) return "erased" as const;
  return { ...worker, name: `${worker.firstName} ${worker.lastName}` };
}

const logBy =
  (tx: FirmTx, ctx: OfficeContext) => (action: string, workerId: string, data: object) =>
    recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action,
      entityType: "worker",
      entityId: workerId,
      data: { workerId, ...data },
    });

export async function changeWorkerStatus(
  ctx: OfficeContext,
  workerId: string,
  change: WorkerStatusChange,
): Promise<WorkerStatusResult> {
  const { run } = parts(ctx);
  const now = nowOf(ctx);
  // A deadlock or serialisation failure (the sheet sync at the same moment): tried again.
  return retryAborted(() =>
    run(ctx.firm.id, async (tx): Promise<WorkerStatusResult> => {
      const worker = await lockWorker(tx, ctx, workerId);
      if (typeof worker === "string") return { status: worker };
      const from: Record<WorkerStatusChange["kind"], WorkerStatus> = {
        deactivate: "active",
        reactivate: "inactive",
        unblock: "blocked",
      };
      if (worker.status !== from[change.kind]) {
        return {
          status: "unchanged",
          change: change.kind,
          name: worker.name,
          current: worker.status,
        };
      }
      const log = logBy(tx, ctx);
      const deactivating = change.kind === "deactivate";
      // Unblocking someone the office had made inactive (a sheet blocked them since) leaves them
      // inactive: that was the office's own decision, and "Make active again" undoes it.
      const stillInactive = change.kind === "unblock" && worker.officeDeactivatedAt !== null;
      const after: WorkerStatus = deactivating || stillInactive ? "inactive" : "active";
      await tx
        .update(workers)
        .set(
          deactivating
            ? { status: "inactive", officeDeactivatedAt: now }
            : stillInactive
              ? { status: "inactive" }
              : { status: "active", officeDeactivatedAt: null },
        )
        .where(eq(workers.id, worker.id));
      // Making inactive logs them out; making active again ends anything left from before, so no
      // old session comes back.
      const ended = await endEverySession(tx, { kind: "worker", subjectId: worker.id, now });
      // No longer active: their phones' notifications go too (a firm-change notice's push must not
      // reach a leaver's phone). Any change: their bookings ahead are looked at again on Today (one
      // kept while they were inactive may still be at a site they're blocked from).
      const phones = after === "active" ? 0 : await forgetPhones(tx, worker.id);
      // "They've left": their travel area goes (docs/office-v2.md 5.4: the start point is kept only
      // while it's of use). Any other reason keeps it for when they're made active again.
      const travelRemoved =
        change.kind === "deactivate" && change.reason === "left"
          ? (
              await tx
                .delete(workerTravel)
                .where(eq(workerTravel.workerId, worker.id))
                .returning({ id: workerTravel.id })
            ).length
          : 0;
      const flagged = await reflagFutureBookings(tx, { workerId: worker.id, now });
      const futureBookings = deactivating ? flagged : 0;
      await log(
        {
          deactivate: "worker.deactivated",
          reactivate: "worker.reactivated",
          unblock: "worker.unblocked",
        }[change.kind],
        worker.id,
        {
          reason: change.reason,
          sessionsEnded: ended.sessions,
          linksSpent: ended.links,
          ...(deactivating ? { futureBookings } : {}),
          ...(phones > 0 ? { devicesForgotten: phones } : {}),
          ...(travelRemoved > 0 ? { travelAreaRemoved: true } : {}),
          ...(stillInactive ? { stillInactive } : {}),
        },
      );
      return { status: "done", change: change.kind, name: worker.name, futureBookings, now: after };
    }),
  );
}

export async function signOutWorker(ctx: OfficeContext, workerId: string): Promise<SignOutResult> {
  const { run } = parts(ctx);
  const now = nowOf(ctx);
  // A deadlock or serialisation failure (the sheet sync at the same moment): tried again.
  return retryAborted(() =>
    run(ctx.firm.id, async (tx): Promise<SignOutResult> => {
      const worker = await lockWorker(tx, ctx, workerId);
      if (typeof worker === "string") return { status: worker };
      const ended = await endEverySession(tx, { kind: "worker", subjectId: worker.id, now });
      const phones = await forgetPhones(tx, worker.id);
      if (ended.sessions === 0 && ended.links === 0 && phones === 0) {
        return { status: "unchanged", name: worker.name, sessionsEnded: 0, loggedIn: false };
      }
      await logBy(tx, ctx)("worker.signed_out", worker.id, {
        sessionsEnded: ended.sessions,
        linksSpent: ended.links,
        devicesForgotten: phones,
      });
      return {
        status: "done",
        name: worker.name,
        sessionsEnded: ended.sessions,
        loggedIn: ended.sessions + ended.links > 0,
      };
    }),
  );
}

export async function blockFromSite(
  ctx: OfficeContext,
  workerId: string,
  siteId: string,
  reason: (typeof SITE_BLOCK_REASONS)[number],
): Promise<SiteBlockResult> {
  const { run } = parts(ctx);
  const now = nowOf(ctx);
  // A deadlock or serialisation failure (the sheet sync at the same moment): tried again.
  return retryAborted(() =>
    run(ctx.firm.id, async (tx): Promise<SiteBlockResult> => {
      const worker = await lockWorker(tx, ctx, workerId);
      if (typeof worker === "string") return { status: worker };
      const [site] = await tx
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(eq(sites.id, siteId));
      if (!site) return { status: "no_site" };
      const [added] = await tx
        .insert(workerSiteBlocks)
        .values({
          firmId: sql`app_current_firm_id()`,
          workerId: worker.id,
          siteId: site.id,
          reason,
          blockedBy: ctx.officeUserId,
        })
        .onConflictDoNothing({
          target: [workerSiteBlocks.firmId, workerSiteBlocks.workerId, workerSiteBlocks.siteId],
        })
        .returning({ id: workerSiteBlocks.id });
      if (!added) {
        return { status: "unchanged", name: worker.name, site: site.name, futureBookings: 0 };
      }
      const futureBookings = await reflagFutureBookings(tx, {
        workerId: worker.id,
        now,
        siteId: site.id,
      });
      await logBy(tx, ctx)("worker.site_blocked", worker.id, {
        siteId: site.id,
        reason,
        futureBookings,
      });
      return { status: "done", name: worker.name, site: site.name, futureBookings };
    }),
  );
}

export async function unblockFromSite(
  ctx: OfficeContext,
  workerId: string,
  siteId: string,
  reason: SiteUnblockReason,
): Promise<SiteBlockResult> {
  const { run } = parts(ctx);
  // A deadlock or serialisation failure (the sheet sync at the same moment): tried again.
  return retryAborted(() =>
    run(ctx.firm.id, async (tx): Promise<SiteBlockResult> => {
      const worker = await lockWorker(tx, ctx, workerId);
      if (typeof worker === "string") return { status: worker };
      const [site] = await tx
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(eq(sites.id, siteId));
      if (!site) return { status: "no_site" };
      const removed = await tx
        .delete(workerSiteBlocks)
        .where(and(eq(workerSiteBlocks.workerId, worker.id), eq(workerSiteBlocks.siteId, site.id)))
        .returning({ id: workerSiteBlocks.id });
      if (removed.length === 0) {
        return { status: "unchanged", name: worker.name, site: site.name, futureBookings: 0 };
      }
      await logBy(tx, ctx)("worker.site_unblocked", worker.id, { siteId: site.id, reason });
      return { status: "done", name: worker.name, site: site.name, futureBookings: 0 };
    }),
  );
}

// Today's "Bookings to check": the office keeps a booking whose worker isn't active, or is
// blocked from the shift's site. Only a booking still flagged (confirmed, ahead, not kept).
export async function keepFlaggedBooking(
  ctx: OfficeContext,
  shiftId: string,
  workerId: string,
): Promise<KeepResult> {
  const { run } = parts(ctx);
  const now = nowOf(ctx);
  // A deadlock or serialisation failure (the sheet sync at the same moment): tried again.
  return retryAborted(() =>
    run(ctx.firm.id, async (tx): Promise<KeepResult> => {
      if (!(await officeUserMay(tx, ctx.officeUserId, "today"))) return { status: "not_allowed" };
      const { rows } = await tx.execute<{
        id: string;
        kept: boolean;
        first_name: string;
        last_name: string;
        worker_status: WorkerStatus;
        site_blocked: boolean;
      }>(sql`
      select a.id, a.office_kept_at is not null as kept, w.first_name, w.last_name,
             w.status as worker_status,
             exists (select 1 from worker_site_blocks b
                      where b.firm_id = a.firm_id and b.worker_id = a.worker_id
                        and b.site_id = s.site_id) as site_blocked
        from assignments a
        join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
        join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
       where a.shift_id = ${shiftId} and a.worker_id = ${workerId} and a.status = 'confirmed'
         and s.starts_at > ${now} and s.status in ('open', 'filled')
       for no key update of a
    `);
      const row = rows[0];
      if (!row) return { status: "not_found" };
      const name = `${row.first_name} ${row.last_name}`;
      const cause =
        row.worker_status !== "active"
          ? row.worker_status
          : row.site_blocked
            ? "site_blocked"
            : null;
      if (!cause) return { status: "not_flagged", name };
      if (row.kept) return { status: "already", name };
      await tx
        .update(assignments)
        .set({ officeKeptAt: now })
        .where(and(eq(assignments.id, row.id), isNull(assignments.officeKeptAt)));
      await recordEvent(tx, {
        actorType: "office",
        actorId: ctx.officeUserId,
        action: "booking.kept",
        entityType: "shift",
        entityId: shiftId,
        data: { shiftId, workerId, cause },
      });
      return { status: "kept", name, cause };
    }),
  );
}

// What a casual's page shows (docs/screens.md `/office/casuals/[id]`; 12F.1): who they are, their
// status, what needs updating, their qualifications and right to work (src/lib/credentials/
// status.ts), their travel district, their strikes, the sites they're blocked from and could be
// blocked from, and their bookings ahead (the first 20). Null: not an office user who may see
// casuals, or no such casual here.
export interface WorkerAccessView {
  id: string;
  name: string;
  mobile: string | null;
  status: WorkerStatus;
  roles: string[];
  erased: boolean;
  byOffice: boolean; // made inactive by the office (a sheet or file can't undo it)
  siteBlocks: { siteId: string; site: string; reason: string; since: Date }[];
  otherSites: { id: string; name: string }[];
  // Their travel area (12G.1): the district only ("ZZ1"), never the postcode or its point.
  travel: { district: string; maxMinutes: number; modes: TravelMode } | null;
  ahead: {
    shiftId: string;
    role: string;
    site: string | null;
    startsAt: Date;
    endsAt: Date;
  }[];
  aheadMore: boolean;
  qualifications: CasualQualifications["qualifications"];
  rightToWork: CasualQualifications["rightToWork"];
  needs: CasualQualifications["needs"];
  strikes: CasualStrike[]; // newest first, at most STRIKES_PER_CASUAL
  strikesMore: boolean;
  liveStrikes: number; // live and still counting
  timeZone: string;
}

export const WORKER_AHEAD_MAX = 20;

export async function workerAccessView(
  ctx: OfficeContext,
  workerId: string,
): Promise<WorkerAccessView | null> {
  if (!z.uuid().safeParse(workerId).success) return null; // a made-up address: not found
  const { run } = parts(ctx);
  const now = nowOf(ctx);
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "casuals"))) return null;
    const [worker] = await tx
      .select({
        id: workers.id,
        firstName: workers.firstName,
        lastName: workers.lastName,
        mobile: workers.mobileE164,
        status: workers.status,
        roles: workers.roles,
        erasedAt: workers.erasedAt,
        officeDeactivatedAt: workers.officeDeactivatedAt,
      })
      .from(workers)
      .where(eq(workers.id, workerId));
    if (!worker) return null;
    const { rows: blocks } = await tx.execute<{
      site_id: string;
      name: string;
      reason: string;
      created_at: string | Date;
    }>(sql`
      select b.site_id, s.name, b.reason, b.created_at
        from worker_site_blocks b
        join sites s on s.firm_id = b.firm_id and s.id = b.site_id
       where b.worker_id = ${worker.id}
       order by s.name
    `);
    const blocked = new Set(blocks.map((b) => b.site_id));
    // The district is cut out in the database: the full postcode never reaches the office.
    const { rows: travel } = await tx.execute<{
      district: string;
      max_minutes: number;
      modes: TravelMode;
    }>(sql`
      select split_part(t.start_postcode, ' ', 1) as district, t.max_minutes, t.modes
        from worker_travel t
       where t.worker_id = ${worker.id}
    `);
    const allSites = await tx
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .orderBy(sites.name);
    const { rows: ahead } = await tx.execute<{
      shift_id: string;
      role: string;
      site_name: string | null;
      starts_at: string | Date;
      ends_at: string | Date;
    }>(sql`
      select s.id as shift_id, s.role, si.name as site_name, s.starts_at, s.ends_at
        from assignments a
        join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
        left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
       where a.worker_id = ${worker.id} and a.status = 'confirmed'
         and s.starts_at > ${now} and s.status in ('open', 'filled')
       order by s.starts_at, s.id
       limit ${WORKER_AHEAD_MAX + 1}
    `);
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, ctx.firm.id));
    const timeZone = firm?.timezone ?? "Europe/London";
    const held = (await qualificationsFor(tx, [worker.id], { now, timeZone })).get(worker.id);
    const strikes = (await strikesOf(tx, [worker.id], now)).get(worker.id) ?? [];
    return {
      id: worker.id,
      name: `${worker.firstName} ${worker.lastName}`,
      mobile: worker.mobile,
      status: worker.status,
      roles: [...worker.roles],
      erased: worker.erasedAt !== null,
      byOffice: worker.officeDeactivatedAt !== null,
      siteBlocks: blocks.map((b) => ({
        siteId: b.site_id,
        site: b.name,
        reason: b.reason,
        since: new Date(b.created_at),
      })),
      otherSites: allSites.filter((s) => !blocked.has(s.id)),
      travel: travel[0]
        ? {
            district: travel[0].district,
            maxMinutes: Number(travel[0].max_minutes),
            modes: travel[0].modes,
          }
        : null,
      ahead: ahead.slice(0, WORKER_AHEAD_MAX).map((a) => ({
        shiftId: a.shift_id,
        role: a.role,
        site: a.site_name,
        startsAt: new Date(a.starts_at),
        endsAt: new Date(a.ends_at),
      })),
      aheadMore: ahead.length > WORKER_AHEAD_MAX,
      qualifications: held?.qualifications ?? [],
      rightToWork: held?.rightToWork ?? { checked: false, checkedOn: null },
      needs: held?.needs ?? [],
      strikes: strikes.slice(0, STRIKES_PER_CASUAL),
      strikesMore: strikes.length > STRIKES_PER_CASUAL,
      liveStrikes: strikes.filter((s) => s.counting).length,
      timeZone,
    };
  });
}
