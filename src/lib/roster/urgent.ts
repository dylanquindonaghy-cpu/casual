import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, firms, shifts } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { hoursToStart, insideUrgentWindow, urgentWindowHours } from "../rules/urgent";
import { startOfferWaves } from "../offers/waves";
import { officeCanPlace } from "./book";
import { AFTER_WAVE_DELAY_SECONDS, queueTravelEstimates } from "../travel/estimate-queue";

// The urgent flag on shifts (docs/architecture.md, "Cancel" step 3; docs/api-and-jobs.md
// `makeUrgent`). The rules are in src/lib/rules/urgent.ts; this reads and writes the rows.
//
// - markUrgentAfterDropout: called in the same transaction as a cancellation that may have
//   reopened a place (cancel.ts; the Sheets sync once per shift, after the sheet's new names are
//   booked, when a name was removed). If the shift is open with a place free and starts within the
//   firm's urgent window, offer waves start (src/lib/offers/waves.ts; none while it's hidden from
//   casuals, only the office's escalation check), and it's marked urgent and
//   logged as the system's (shift.marked_urgent, cause "dropout") unless it already was. No free
//   place, or outside the window: nothing happens.
// - setShiftUrgent: the office marks the flag by hand (active admins and resourcers) on a shift
//   that hasn't started and isn't a draft or cancelled, or clears it at any time. Logged as the
//   firm's; no change, no event. Marking a session hidden from casuals starts no offers (they
//   start when it's shown again).
// The flag stays when the shift fills: the urgent board and offer waves only look at open places.

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

export async function markUrgentAfterDropout(
  tx: FirmTx,
  input: { shiftId: string; now: Date; source?: "sheets" },
): Promise<boolean> {
  const { rows } = await tx.execute<{
    firm_id: string;
    starts_at: string | Date;
    status: string;
    is_urgent: boolean;
    free: boolean;
  }>(sql`
    select s.firm_id, s.starts_at, s.status, s.is_urgent,
           (select count(*) from assignments a
             where a.shift_id = s.id and a.worker_id is not null
               and a.status not in (${CANCELLED}) and a.slot <= s.headcount) < s.headcount as free
      from shifts s where s.id = ${input.shiftId}
  `);
  const shift = rows[0];
  if (!shift || shift.status !== "open" || !shift.free) return false;
  const [firm] = await tx
    .select({ settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, shift.firm_id));
  const startsAt = new Date(shift.starts_at);
  if (!insideUrgentWindow(startsAt, input.now, urgentWindowHours(firm?.settings ?? {}))) {
    return false;
  }
  // A place reopened close to the start: offer it out, even if the shift was urgent already. Its
  // travel estimates are filled in too (12G.2; the first wave also fills them before it goes).
  await startOfferWaves(tx, { shiftId: input.shiftId, now: input.now });
  await queueTravelEstimates(tx, [input.shiftId], { startAfter: AFTER_WAVE_DELAY_SECONDS });
  if (shift.is_urgent) return true;
  await tx.update(shifts).set({ isUrgent: true }).where(eq(shifts.id, input.shiftId));
  await recordEvent(tx, {
    actorType: "system",
    action: "shift.marked_urgent",
    entityType: "shift",
    entityId: input.shiftId,
    data: {
      ...(input.source ? { source: input.source } : {}),
      by: "system",
      cause: "dropout",
      hoursToStart: hoursToStart(startsAt, input.now),
    },
  });
  return true;
}

const uuid = z.uuid();

export type SetUrgentResult =
  | { status: "marked" }
  // Marked, but hidden from casuals (the session's switch or its event's): no offers go out while
  // it's hidden (showing it again starts them if a place is free: src/lib/office/showing.ts).
  | { status: "marked_hidden" }
  | { status: "cleared" }
  | { status: "unchanged" }
  | { status: "not_found" }
  | { status: "not_open" } // a draft, cancelled, or (to mark) already started
  | { status: "not_allowed" }; // the office user can't place staff (disabled, or payroll)

// Strict: exactly these fields, a real boolean (a server action passes the session's office user).
export const setUrgentRequestSchema = z.strictObject({
  shiftId: z.string(),
  urgent: z.boolean(),
  by: z.strictObject({ type: z.literal("office"), id: z.uuid() }),
});

export async function setShiftUrgent(
  run: WithFirm,
  firmId: string,
  raw: z.input<typeof setUrgentRequestSchema>,
  deps: { clock?: Clock } = {},
): Promise<SetUrgentResult> {
  const request = setUrgentRequestSchema.parse(raw);
  if (!uuid.safeParse(request.shiftId).success) return { status: "not_found" };
  const now = (deps.clock ?? systemClock).now();
  return run(firmId, async (tx) => {
    if (!(await officeCanPlace(tx, request.by.id))) return { status: "not_allowed" };
    const [shift] = await tx
      .select({
        status: shifts.status,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        isUrgent: shifts.isUrgent,
      })
      .from(shifts)
      .where(eq(shifts.id, request.shiftId))
      .for("no key update");
    if (!shift) return { status: "not_found" };
    if (shift.isUrgent === request.urgent) return { status: "unchanged" };
    // Marking needs a shift someone could still take; clearing is always allowed.
    const live = shift.status === "open" || shift.status === "filled";
    if (request.urgent && (!live || shift.startsAt.getTime() <= now.getTime())) {
      return { status: "not_open" };
    }
    await tx.update(shifts).set({ isUrgent: request.urgent }).where(eq(shifts.id, request.shiftId));
    // Marked urgent by the office: offer it out now (the waves stop by themselves once filled),
    // unless it's hidden from casuals.
    const offering =
      request.urgent && (await startOfferWaves(tx, { shiftId: request.shiftId, now }));
    // Its travel estimates (12G.2), for the casuals it's offered to.
    if (request.urgent) {
      await queueTravelEstimates(tx, [request.shiftId], { startAfter: AFTER_WAVE_DELAY_SECONDS });
    }
    await recordEvent(tx, {
      actorType: "office",
      actorId: request.by.id,
      action: request.urgent ? "shift.marked_urgent" : "shift.urgent_cleared",
      entityType: "shift",
      entityId: request.shiftId,
      data: request.urgent
        ? { by: "firm", cause: "office", hoursToStart: hoursToStart(shift.startsAt, now) }
        : { by: "firm" },
    });
    if (!request.urgent) return { status: "cleared" };
    return { status: offering ? "marked" : "marked_hidden" };
  });
}

// "Offer to the best …" and "Offer N open places" on an event's page (Phase 26.5): offer one
// session's free places now. Under the session's lock: it must be open, not started, with a place
// free; with its offers already going out (urgent, and its wave chain not stopped: the dashboard's
// rule, src/lib/office/today.ts) there's nothing to do. Not urgent yet: marked urgent, as "Mark
// urgent" does (logged shift.marked_urgent). Urgent but its waves stopped (it filled and a place
// opened again, it ran out of people, it was hidden): its offers start again (logged
// shift.offers_restarted). Either way the waves start only while it's shown to casuals.
export type OfferPlacesResult =
  | { status: "offering" }
  | { status: "offering_hidden" } // urgent now, but hidden from casuals: nothing goes out yet
  | { status: "already_offering" }
  | { status: "full" } // no place free, or not open, or started
  | { status: "not_found" }
  | { status: "not_allowed" };

export async function offerShiftPlaces(
  run: WithFirm,
  firmId: string,
  input: { shiftId: string; by: { type: "office"; id: string } },
  deps: { clock?: Clock } = {},
): Promise<OfferPlacesResult> {
  if (!uuid.safeParse(input.shiftId).success) return { status: "not_found" };
  const now = (deps.clock ?? systemClock).now();
  return run(firmId, (tx) => offerPlacesInTx(tx, { ...input, now }));
}

// The same inside a transaction the caller holds (Phase 36.4: accepting a client's request for
// more places offers them at once, in the accept's own transaction).
export async function offerPlacesInTx(
  tx: FirmTx,
  input: { shiftId: string; by: { type: "office"; id: string }; now: Date },
): Promise<OfferPlacesResult> {
  const { now } = input;
  if (!(await officeCanPlace(tx, input.by.id))) return { status: "not_allowed" };
  const [shift] = await tx
    .select({
      status: shifts.status,
      startsAt: shifts.startsAt,
      headcount: shifts.headcount,
      isUrgent: shifts.isUrgent,
    })
    .from(shifts)
    .where(eq(shifts.id, input.shiftId))
    .for("no key update");
  if (!shift) return { status: "not_found" };
  const { rows: held } = await tx.execute<{ booked: number }>(sql`
    select count(*)::int as booked from assignments
     where shift_id = ${input.shiftId} and worker_id is not null
       and status not in (${CANCELLED}) and slot <= ${shift.headcount}
  `);
  const free = shift.headcount - (held[0]?.booked ?? 0);
  if (shift.status !== "open" || shift.startsAt.getTime() <= now.getTime() || free <= 0) {
    return { status: "full" };
  }
  if (shift.isUrgent && !(await wavesStopped(tx, input.shiftId))) {
    return { status: "already_offering" };
  }
  if (!shift.isUrgent) {
    await tx.update(shifts).set({ isUrgent: true }).where(eq(shifts.id, input.shiftId));
  }
  const offering = await startOfferWaves(tx, { shiftId: input.shiftId, now });
  await queueTravelEstimates(tx, [input.shiftId], { startAfter: AFTER_WAVE_DELAY_SECONDS });
  await recordEvent(tx, {
    actorType: "office",
    actorId: input.by.id,
    action: shift.isUrgent ? "shift.offers_restarted" : "shift.marked_urgent",
    entityType: "shift",
    entityId: input.shiftId,
    data: { by: "firm", cause: "office", hoursToStart: hoursToStart(shift.startsAt, now) },
  });
  return { status: offering ? "offering" : "offering_hidden" };
}

// Whether a session's offer waves have stopped: its latest stop names a wave no offer went in
// since (a later wave means they started again). No stop at all: they haven't.
export async function wavesStopped(tx: FirmTx, shiftId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ stopped: boolean }>(sql`
    select coalesce(
      (select (e.data ->> 'wave')::int from events e
        where e.entity_id = ${shiftId}::uuid and e.action = 'offer.waves_stopped'
        order by e.id desc limit 1)
      > coalesce((select max(o.wave) from offers o where o.shift_id = ${shiftId}::uuid), 0),
      false) as stopped
  `);
  return rows[0]?.stopped ?? false;
}
