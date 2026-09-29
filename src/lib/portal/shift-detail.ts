import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { assignments, CANCELLED_ASSIGNMENT_STATUSES, requests, shifts, sites } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { withFirm } from "../db/scoped";
import { loadAllocationGate } from "../roster/allocation-input";
import { previewBooking } from "../roster/book";
import type { MyShift, PortalContext } from "./my-shifts";

// One shift's page for the logged-in worker (docs/screens.md, `/shifts/[id]`): the blocked-shift
// screen, and the page an offer's link opens. Works out one state from the current rows, inside
// the worker's firm (RLS scopes every row to it):
//
// - booked: their confirmed booking (or one the office has marked worked or not attended), with
//   the instructions. Only a booked worker sees a shift's instructions.
// - cancelled, started: nothing to take. filled: no place left (or the office closed it).
// - open: the rules say yes (previewBooking: no locks, no pass; taking it re-checks everything).
// - held: fair rotation holds it for workers with fewer hours this week until opensAt.
// - blocked: the rules say no, with their reasons in plain English, and the worker's review
//   request for it if one is waiting (askForReview in review.ts).
// - missing: not in this firm, a draft, or not a shift id.
// Code decides every state (golden rule 1); this only reads.

export interface ShiftSummary {
  shiftId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  placesLeft: number;
  site: MyShift["site"];
}

export type ShiftPage =
  | { state: "missing" }
  | { state: "booked"; shift: MyShift }
  | { state: "open"; shift: ShiftSummary }
  | { state: "held"; shift: ShiftSummary; opensAt: Date }
  | {
      state: "blocked";
      shift: ShiftSummary;
      reasons: string[];
      review: { ref: string; askedAt: Date } | null;
    }
  | { state: "filled" | "started" | "cancelled"; shift: ShiftSummary };

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));
const uuid = z.uuid();
export const refOf = (id: string) => id.slice(0, 8).toUpperCase();

// Places taken on the shift: bookings that aren't cancelled, in its headcount's slots.
export const takenPlaces = (tx: FirmTx, shiftId: string) =>
  tx.execute<{ taken: number }>(sql`
    select count(*)::int as taken from assignments a
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
     where a.shift_id = ${shiftId} and a.worker_id is not null
       and a.status not in (${CANCELLED}) and a.slot <= s.headcount
  `);

// The worker's review request for the shift that's still waiting for the office, if any.
export async function waitingReview(tx: FirmTx, workerId: string, shiftId: string) {
  const [waiting] = await tx
    .select({ id: requests.id, createdAt: requests.createdAt })
    .from(requests)
    .where(
      and(
        eq(requests.workerId, workerId),
        eq(requests.shiftId, shiftId),
        eq(requests.type, "review"),
        inArray(requests.status, ["open", "escalated"]),
      ),
    )
    .orderBy(desc(requests.createdAt))
    .limit(1);
  return waiting ?? null;
}

export async function shiftForWorker(
  ctx: PortalContext,
  workerId: string,
  shiftId: string,
): Promise<ShiftPage> {
  if (!uuid.safeParse(shiftId).success || !uuid.safeParse(workerId).success) {
    return { state: "missing" };
  }
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [row] = await tx
      .select({
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        status: shifts.status,
        headcount: shifts.headcount,
        instructions: shifts.instructions,
        siteName: sites.name,
        addressLine1: sites.addressLine1,
        addressLine2: sites.addressLine2,
        town: sites.town,
        postcode: sites.postcode,
      })
      .from(shifts)
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .where(eq(shifts.id, shiftId));
    if (!row || row.status === "draft") return { state: "missing" };

    const site: MyShift["site"] = row.siteName
      ? {
          name: row.siteName,
          addressLine1: row.addressLine1,
          addressLine2: row.addressLine2,
          town: row.town,
          postcode: row.postcode,
        }
      : null;
    const [mine] = await tx
      .select({ id: assignments.id, status: assignments.status })
      .from(assignments)
      .where(
        and(
          eq(assignments.shiftId, shiftId),
          eq(assignments.workerId, workerId),
          inArray(assignments.status, ["confirmed", "completed", "no_show"]),
        ),
      );
    if (mine && row.status !== "cancelled") {
      return {
        state: "booked",
        shift: {
          assignmentId: mine.id,
          shiftId,
          role: row.role,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: mine.status as MyShift["status"],
          instructions: row.instructions,
          site,
        },
      };
    }

    const { rows: counted } = await takenPlaces(tx, shiftId);
    const placesLeft = Math.max(0, row.headcount - (counted[0]?.taken ?? 0));
    const shift: ShiftSummary = {
      shiftId,
      role: row.role,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      placesLeft,
      site,
    };
    if (row.status === "cancelled") return { state: "cancelled", shift };
    if (row.startsAt.getTime() <= now.getTime()) return { state: "started", shift };
    if (row.status !== "open" || placesLeft === 0) return { state: "filled", shift };

    const verdict = await previewBooking(tx, { shiftId, workerId, now });
    if (!verdict) return { state: "missing" };
    if (!verdict.ok) {
      const waiting = await waitingReview(tx, workerId, shiftId);
      return {
        state: "blocked",
        shift,
        reasons: verdict.reasons,
        review: waiting ? { ref: refOf(waiting.id), askedAt: waiting.createdAt } : null,
      };
    }
    const gate = await loadAllocationGate(tx, { shiftId, workerId, now });
    return gate.ok ? { state: "open", shift } : { state: "held", shift, opensAt: gate.opensAt };
  });
}
