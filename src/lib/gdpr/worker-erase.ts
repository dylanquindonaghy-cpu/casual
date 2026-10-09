import { and, eq, gt, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { retryAborted } from "../db/retry";
import {
  assignments,
  credentials,
  magicLinks,
  payQueries,
  pushSubscriptions,
  requests,
  sessions,
  shifts,
  strikes,
  workerSiteBlocks,
  workerUnavailableDays,
  workers,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeUserMay, parts, type OfficeContext } from "../office/office-context";
import { rosterId } from "../roster/book";
import { ERASED_REASON, erasedCancelReason, REQUEST_FREE_TEXT_KEYS } from "./free-text";

// Deleting a worker's personal details (a GDPR erasure request: docs/runbooks.md "GDPR requests",
// docs/compliance.md). The worker's row stays, anonymous, because offers, bookings, cancellations,
// reminders and pay lines point at it: they are the notice report's evidence and payroll's. In one
// transaction:
// - an active admin (the `data` area), and the worker row locked (a booking locks it too, so one
//   waits for the other);
// - refused while they are booked on a shift that hasn't ended (the office cancels those first,
//   with a reason and the notice logged: golden rule 12);
// - app_erase_worker() (owner-run): the row becomes "Deleted worker" (no mobile, email or staff id,
//   no roles, inactive; a check in the database holds it to exactly that) and their shifts-line
//   messages are deleted (theirs, replies to them, and ones from or to their number before it was
//   known, found by the number the row held);
// - deleted: their credentials, login links, sessions (and codes), phones' push addresses, days off;
// - cleared: the free text on their requests (their note, a colleague's name, the office's answer),
//   pay queries (their details, payroll's note) and cancellations (a typed reason; the app's fixed
//   wording stays: free-text.ts) and the office's reasons for withdrawing their strikes (the strike
//   stays withdrawn, with who and when: 12C.5);
// - worker.erased with how many of each (never what they were).
// - replaced: the office's typed reasons for placing them despite a rule (on their bookings: from
//   Phase 10 never in the log), with the fixed wording; and their staff id taken out of our copy of
//   the rota sheet's names (shifts.synced_holders).
// What can't be reached: the office's typed reason in an older log entry (written before Phase 10,
// checked for phones and emails only), words other people typed that name them (a colleague's swap
// request, someone else's message or pay query: those go on the firm's retention schedule), the
// firm's own rota sheet or staff file
// (the next sync or import would add them back: the runbook says to remove them there too), and
// the copy of My shifts on the worker's own phone (public/sw.js): it goes the next time that phone
// opens My shifts with signal (the server then says "not logged in"), and is never shown once
// it's 14 days old (audit L93).

export interface ErasedCounts {
  licences: number; // credentials (the log masker refuses a key named "credentials")
  loginLinks: number;
  sessions: number;
  devices: number; // phones' push addresses
  daysUnavailable: number;
  siteBlocks: number; // sites the office kept them off (Phase 10)
  messages: number;
  requests: number;
  payQueries: number;
  cancelReasons: number; // typed cancellation reasons replaced (free-text.ts)
  overrideReasons: number; // the office's typed reasons on their bookings, replaced likewise
  sheetMentions: number; // shifts whose kept rota-sheet names (synced_holders) held their staff id
  withdrawalReasons: number; // the office's typed reasons for withdrawing their strikes (12C.5)
}

export type EraseWorkerResult =
  | { status: "erased"; name: string; counts: ErasedCounts }
  | { status: "booked"; name: string; upcoming: number }
  | { status: "already" }
  | { status: "not_found" }
  | { status: "not_allowed" };

async function eraseLocked(tx: FirmTx, id: string, now: Date): Promise<ErasedCounts> {
  // Their staff id, read before the row loses it: our copy of the rota sheet's names holds it too.
  const [before] = await tx
    .select({ ref: workers.externalRef })
    .from(workers)
    .where(eq(workers.id, id));
  // Owner-run (the app role may not delete messages): the row becomes "Deleted worker" and their
  // messages go, found by the number the row held.
  const erased = await tx.execute<{ n: number }>(sql`select app_erase_worker(${id}::uuid) as n`);
  const deleted = async (rows: Promise<{ id: string }[]>) => (await rows).length;

  // Their cancellation reasons: fixed wording stays, anything typed goes (free-text.ts).
  const cancelled = await tx
    .select({ id: assignments.id, reason: assignments.cancelReason })
    .from(assignments)
    .where(and(eq(assignments.workerId, id), isNotNull(assignments.cancelReason)));
  let cancelReasons = 0;
  for (const row of cancelled) {
    const kept = erasedCancelReason(row.reason);
    if (kept === row.reason) continue;
    await tx.update(assignments).set({ cancelReason: kept }).where(eq(assignments.id, row.id));
    cancelReasons += 1;
  }

  // The office's reason for placing them despite a rule: the booking still says there was one.
  const overrideReasons = await deleted(
    tx
      .update(assignments)
      .set({ overrideReason: ERASED_REASON })
      .where(and(eq(assignments.workerId, id), isNotNull(assignments.overrideReason)))
      .returning({ id: assignments.id }),
  );
  // Their staff id in the names we last read from the firm's sheet (the merge base), on shifts that
  // have ended: taken out (audit L86). Not on shifts still ahead, where the base decides the next
  // sync's merge (a cancellation the sheet hasn't caught up with yet must still be written back).
  // While the firm's sheet still names them, the next sync of that row puts the id back: the page
  // and the runbook tell the office to remove them from the sheet too.
  const ref = before?.ref ?? null;
  const sheetMentions =
    ref === null
      ? 0
      : await deleted(
          tx
            .update(shifts)
            .set({ syncedHolders: sql`array_remove(${shifts.syncedHolders}, ${ref})` })
            .where(
              and(sql`${shifts.syncedHolders} @> array[${ref}]::text[]`, lte(shifts.endsAt, now)),
            )
            .returning({ id: shifts.id }),
        );

  const typed = sql.raw(`array[${REQUEST_FREE_TEXT_KEYS.map((k) => `'${k}'`).join(", ")}]`);
  const counts: ErasedCounts = {
    licences: await deleted(
      tx.delete(credentials).where(eq(credentials.workerId, id)).returning({ id: credentials.id }),
    ),
    loginLinks: await deleted(
      tx.delete(magicLinks).where(eq(magicLinks.workerId, id)).returning({ id: magicLinks.id }),
    ),
    // Their one-time codes go with the sessions (ON DELETE CASCADE).
    sessions: await deleted(
      tx.delete(sessions).where(eq(sessions.workerId, id)).returning({ id: sessions.id }),
    ),
    devices: await deleted(
      tx
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.workerId, id))
        .returning({ id: pushSubscriptions.id }),
    ),
    daysUnavailable: await deleted(
      tx
        .delete(workerUnavailableDays)
        .where(eq(workerUnavailableDays.workerId, id))
        .returning({ id: workerUnavailableDays.id }),
    ),
    siteBlocks: await deleted(
      tx
        .delete(workerSiteBlocks)
        .where(eq(workerSiteBlocks.workerId, id))
        .returning({ id: workerSiteBlocks.id }),
    ),
    messages: Number(erased.rows[0]?.n ?? 0),
    requests: await deleted(
      tx
        .update(requests)
        .set({ payload: sql`${requests.payload} - ${typed}::text[]`, resolutionNote: null })
        .where(
          and(
            eq(requests.workerId, id),
            or(sql`${requests.payload} ?| ${typed}::text[]`, isNotNull(requests.resolutionNote)),
          ),
        )
        .returning({ id: requests.id }),
    ),
    payQueries: await deleted(
      tx
        .update(payQueries)
        .set({ details: null, resolutionNote: null })
        .where(
          and(
            eq(payQueries.workerId, id),
            or(isNotNull(payQueries.details), isNotNull(payQueries.resolutionNote)),
          ),
        )
        .returning({ id: payQueries.id }),
    ),
    cancelReasons,
    overrideReasons,
    sheetMentions,
    withdrawalReasons: await deleted(
      tx
        .update(strikes)
        .set({ withdrawnReason: null })
        .where(and(eq(strikes.workerId, id), isNotNull(strikes.withdrawnReason)))
        .returning({ id: strikes.id }),
    ),
  };
  return counts;
}

// Bookings (held or confirmed) on shifts that haven't ended.
async function upcomingBookings(tx: FirmTx, workerId: string, now: Date): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(assignments)
    .innerJoin(
      shifts,
      and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
    )
    .where(
      and(
        eq(assignments.workerId, workerId),
        inArray(assignments.status, ["offered", "confirmed"]),
        gt(shifts.endsAt, now),
      ),
    );
  return row?.n ?? 0;
}

export interface WorkerDataSummary {
  id: string;
  name: string;
  mobile: string | null;
  status: string;
  erasedAt: Date | null;
  upcoming: number; // bookings on shifts that haven't ended: they stop a deletion
}

// The worker's data page: who they are, and whether they can be deleted now. Admins only.
export async function workerDataSummary(
  ctx: OfficeContext,
  rawWorkerId: string,
): Promise<WorkerDataSummary | null> {
  const workerId = rosterId.safeParse(rawWorkerId);
  if (!workerId.success) return null;
  const now = (ctx.clock ?? systemClock).now();
  const { run } = parts(ctx);
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "data"))) return null;
    const [w] = await tx
      .select({
        id: workers.id,
        firstName: workers.firstName,
        lastName: workers.lastName,
        mobile: workers.mobileE164,
        status: workers.status,
        erasedAt: workers.erasedAt,
      })
      .from(workers)
      .where(eq(workers.id, workerId.data));
    if (!w) return null;
    return {
      id: w.id,
      name: `${w.firstName} ${w.lastName}`,
      mobile: w.mobile,
      status: w.status,
      erasedAt: w.erasedAt,
      upcoming: await upcomingBookings(tx, w.id, now),
    };
  });
}

export async function eraseWorker(
  ctx: OfficeContext,
  rawWorkerId: string,
): Promise<EraseWorkerResult> {
  const id = rosterId.safeParse(rawWorkerId);
  if (!id.success) return { status: "not_found" };
  const workerId = id.data;
  const { run, by } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return retryAborted(() =>
    run(ctx.firm.id, async (tx): Promise<EraseWorkerResult> => {
      if (!(await officeUserMay(tx, by.id, "data"))) return { status: "not_allowed" };
      const [worker] = await tx
        .select({
          id: workers.id,
          firstName: workers.firstName,
          lastName: workers.lastName,
          mobile: workers.mobileE164,
          erasedAt: workers.erasedAt,
        })
        .from(workers)
        .where(eq(workers.id, workerId))
        .for("update");
      if (!worker) return { status: "not_found" };
      if (worker.erasedAt !== null || worker.mobile === null) return { status: "already" };
      const name = `${worker.firstName} ${worker.lastName}`;

      const upcoming = await upcomingBookings(tx, workerId, now);
      if (upcoming > 0) return { status: "booked", name, upcoming };

      const counts = await eraseLocked(tx, worker.id, now);
      await recordEvent(tx, {
        actorType: "office",
        actorId: by.id,
        action: "worker.erased",
        entityType: "worker",
        entityId: workerId,
        data: { workerId, ...counts },
      });
      return { status: "erased", name, counts };
    }),
  );
}
