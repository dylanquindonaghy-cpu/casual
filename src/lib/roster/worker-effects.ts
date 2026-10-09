import { and, eq, gt, inArray } from "drizzle-orm";
import { assignments, pushSubscriptions, shifts } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// What follows a change to a worker's access, whoever made it: the office
// (src/lib/office/worker-access.ts), a rota sheet or a file (src/lib/roster/workers.ts). Inside
// the caller's transaction; the caller logs it.

// The worker's confirmed bookings on shifts still ahead (and not cancelled), optionally at one
// site, are flagged on Today again: "kept" is cleared. Returns how many there are.
export async function reflagFutureBookings(
  tx: FirmTx,
  opts: { workerId: string; now: Date; siteId?: string },
): Promise<number> {
  const ahead = tx
    .select({ id: shifts.id })
    .from(shifts)
    .where(
      and(
        gt(shifts.startsAt, opts.now),
        inArray(shifts.status, ["open", "filled"]),
        ...(opts.siteId ? [eq(shifts.siteId, opts.siteId)] : []),
      ),
    );
  const rows = await tx
    .update(assignments)
    .set({ officeKeptAt: null })
    .where(
      and(
        eq(assignments.workerId, opts.workerId),
        eq(assignments.status, "confirmed"),
        inArray(assignments.shiftId, ahead),
      ),
    )
    .returning({ id: assignments.id });
  return rows.length;
}

// The worker's phones' notification addresses, removed (a lost phone, a new mobile).
export async function forgetPhones(tx: FirmTx, workerId: string): Promise<number> {
  const gone = await tx
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.workerId, workerId))
    .returning({ id: pushSubscriptions.id });
  return gone.length;
}
