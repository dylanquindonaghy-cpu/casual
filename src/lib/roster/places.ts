import { eq, sql } from "drizzle-orm";
import { CANCELLED_ASSIGNMENT_STATUSES, shifts } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { refreshShiftStatus } from "./native";

// Fewer places on a session, none of them booked (Phase 36.4: accepting a client's "fewer places"
// after any bookings the cut needs were cancelled, each with notice, through cancelBookingInTx).
// Inside the caller's transaction, with the session already locked; never a rota sheet's or a
// planner's session (each owns its places: the caller sends those to the planner's to-do list).
//
// Booking rows are never deleted and never change hands: the free places' open rows are parked
// above every slot (rows above the headcount are ignored, as removeFreedPlace does), the bookings
// above the new number move down into the free slots, so every booked place stays within the
// headcount, and the headcount drops. The status then follows the places (filled when every place
// is held). Refuses (throws) if more people are booked than the new number: cancel them first.

const CANCELLED = sql.raw(`(${CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", ")})`);

export async function lowerPlacesTo(
  tx: FirmTx,
  shiftId: string,
  to: number,
  now: Date,
): Promise<{ from: number; to: number } | null> {
  const [shift] = await tx
    .select({ headcount: shifts.headcount, source: shifts.source })
    .from(shifts)
    .where(eq(shifts.id, shiftId));
  if (!shift || to < 1 || to >= shift.headcount) return null;
  if (shift.source === "sheets" || shift.source === "api") {
    throw new Error("a rota sheet's or a planner's session sets its own places");
  }
  const from = shift.headcount;
  const { rows: booked } = await tx.execute<{ id: string; slot: number }>(sql`
    select id::text as id, slot from assignments
     where shift_id = ${shiftId} and worker_id is not null and status not in ${CANCELLED}
       and slot <= ${from}
     order by slot, id
  `);
  if (booked.length > to) throw new Error("more people are booked than the places left");
  const { rows: top } = await tx.execute<{ top: number }>(sql`
    select greatest(coalesce(max(slot), 0), ${from})::int as top from assignments
     where shift_id = ${shiftId} and status not in ${CANCELLED}
  `);
  // Every free place's open row, parked above every live slot (one statement: no two collide).
  await tx.execute(sql`
    update assignments a set slot = p.slot
      from (select id, ${top[0]?.top ?? from}::int + row_number() over (order by slot, id) as slot
              from assignments
             where shift_id = ${shiftId} and worker_id is null and status = 'open'
               and slot <= ${from}) p
     where a.id = p.id
  `);
  // The bookings above the new number, each down into the lowest free slot.
  const used = new Set(booked.filter((b) => b.slot <= to).map((b) => b.slot));
  const free = Array.from({ length: to }, (_, i) => i + 1).filter((n) => !used.has(n));
  for (const b of booked.filter((x) => x.slot > to)) {
    const target = free.shift();
    if (target === undefined) throw new Error("no free slot for a booking");
    await tx.execute(sql`update assignments set slot = ${target} where id = ${b.id}::uuid`);
  }
  await tx.update(shifts).set({ headcount: to }).where(eq(shifts.id, shiftId));
  await refreshShiftStatus(tx, shiftId, now);
  return { from, to };
}
