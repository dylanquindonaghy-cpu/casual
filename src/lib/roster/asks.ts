import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, offers, sessionAsks } from "../db/schema";
import { retryAborted } from "../db/retry";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { queueAskAnswer } from "../notices/ask-answer";
import { officeCanPlace, previewBooking } from "./book";
import { isVisibleToCasuals } from "./visibility";

// "Casuals ask, you choose" (Phase 26.6; decision 2; docs/screens.md "A session, round 8"): on an
// event with the setting on (shift_events.casuals_ask), a casual taps "I can do this" on a session
// instead of taking a place, and the office books from who asked (bookShift by the office: every
// rule and licence check, first yes wins). The setting is ShiftDesk's own, like the casuals switch.
//
// - askForShift(): a casual's "I can do this". Under the shift's lock (the order booking takes),
//   then a share of its event (switching the setting waits for it, src/lib/office/casuals-ask.ts):
//   the session must be shown to casuals, open, not started, with a place free; the rules are run on
//   the current rows (previewBooking: never a pass, so nothing books with it). A casual holding an
//   offer of it takes it instead ("take_it"): an offer is the office's (or its waves') choice.
//   Logged shift.asked {workerId}, or shift.ask_refused {workerId, codes} when the rules say no.
// - declineAsk(): the office's "Not this time". Logged shift.ask_declined {workerId}; the casual is
//   told (src/lib/notices/ask-answer.ts).
// - When a session fills (closeOpenOffers, src/lib/offers/close.ts, called by every change that
//   can fill one), the asks of whoever holds a place are booked and every other waiting ask closes:
//   logged shift.ask_closed {workerId, reason: "filled"} each, and each casual is told.
// - When the office cancels or moves the session (its move, its Edit with nobody booked, or the
//   planner's change), waiting asks close (shift.asks_closed {reason, count}): nobody is told (it's
//   not a "no"; the casual may ask again for the new time, even after a "Not this time").
// - A booking marks its casual's ask booked (bookOwnAsk, in bookShift's transaction).
// Asks never decide anything: the office books, through the same rules as every booking.

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

// Ids as the database writes them (book.ts's rosterId, defined here too: book.ts imports this file,
// so a value from it isn't ready while this one loads).
const rosterId = z.uuid().transform((id) => id.toLowerCase());

export const askRequestSchema = z.strictObject({ shiftId: rosterId, workerId: rosterId });

export type AskResult =
  | { status: "asked"; askedAt: Date }
  | { status: "already_asked"; askedAt: Date }
  | { status: "not_this_time" } // the office said no to this one
  | { status: "take_it" } // the office doesn't choose for it (now), or they hold an offer of it
  | { status: "booked" } // they hold a place on it
  | { status: "filled" }
  | { status: "gone" } // not open, started, hidden or not there
  | { status: "not_eligible"; reasons: string[] };

type SessionRow = {
  status: string;
  starts_at: Date | string;
  casuals_ask: boolean;
  taken: number;
  headcount: number;
  mine: boolean;
};

// The session for an ask, locked (the shift, then a share of its event).
async function lockedSession(
  tx: FirmTx,
  shiftId: string,
  workerId: string,
): Promise<(SessionRow & { visible: boolean }) | null> {
  const { rows } = await tx.execute<SessionRow>(sql`
    select s.status, s.starts_at, s.headcount, e.casuals_ask,
           (select count(*)::int from assignments a
             where a.shift_id = s.id and a.worker_id is not null
               and a.status not in (${CANCELLED}) and a.slot <= s.headcount) as taken,
           exists (select 1 from assignments a
                    where a.shift_id = s.id and a.worker_id = ${workerId}
                      and a.status not in (${CANCELLED})) as mine
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
     where s.id = ${shiftId}
       for no key update of s
  `);
  const row = rows[0];
  if (!row) return null;
  // The share lock on the event, after the shift's (booking's order), and its switches as they are.
  const visible = await isVisibleToCasuals(tx, shiftId, { lock: true });
  // The setting read again under the event's lock: a switch that just finished is seen.
  const { rows: setting } = await tx.execute<{ casuals_ask: boolean }>(sql`
    select e.casuals_ask from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
     where s.id = ${shiftId}
  `);
  return { ...row, casuals_ask: setting[0]?.casuals_ask === true, visible };
}

// Whether the casual holds an offer of the session still waiting for their answer.
async function holdsOffer(tx: FirmTx, shiftId: string, workerId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.shiftId, shiftId), eq(offers.workerId, workerId), isNull(offers.response)))
    .limit(1);
  return row !== undefined;
}

// Whether the casual's ask for the session is still waiting (booking from an ask: bookShift, under
// the shift's lock).
export async function askWaiting(tx: FirmTx, shiftId: string, workerId: string): Promise<boolean> {
  const [row] = await tx
    .select({ status: sessionAsks.status })
    .from(sessionAsks)
    .where(and(eq(sessionAsks.shiftId, shiftId), eq(sessionAsks.workerId, workerId)));
  return row?.status === "asked";
}

// Whether a casual's own booking of this session must be an ask instead (bookShift, under the same
// locks): the office chooses for its event, and they hold no offer of it.
export async function officeChooses(
  tx: FirmTx,
  shiftId: string,
  workerId: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ casuals_ask: boolean }>(sql`
    select e.casuals_ask from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
     where s.id = ${shiftId}
  `);
  if (rows[0]?.casuals_ask !== true) return false;
  return !(await holdsOffer(tx, shiftId, workerId));
}

export async function askForShift(
  run: WithFirm,
  firmId: string,
  raw: z.input<typeof askRequestSchema>,
  deps: { clock?: Clock } = {},
): Promise<AskResult> {
  const parsed = askRequestSchema.safeParse(raw);
  if (!parsed.success) return { status: "gone" };
  const { shiftId, workerId } = parsed.data;
  const now = (deps.clock ?? systemClock).now();
  return retryAborted(() =>
    run(firmId, async (tx): Promise<AskResult> => {
      const s = await lockedSession(tx, shiftId, workerId);
      if (!s || !s.visible || s.status === "draft" || s.status === "cancelled") {
        return { status: "gone" };
      }
      if (new Date(s.starts_at).getTime() <= now.getTime()) return { status: "gone" };
      if (s.mine) return { status: "booked" };
      if (s.status === "filled" || s.taken >= s.headcount) return { status: "filled" };
      if (!s.casuals_ask || (await holdsOffer(tx, shiftId, workerId))) {
        return { status: "take_it" };
      }
      const [mine] = await tx
        .select({ status: sessionAsks.status, askedAt: sessionAsks.askedAt })
        .from(sessionAsks)
        .where(and(eq(sessionAsks.shiftId, shiftId), eq(sessionAsks.workerId, workerId)));
      if (mine?.status === "asked") return { status: "already_asked", askedAt: mine.askedAt };
      if (mine?.status === "not_this_time") return { status: "not_this_time" };
      const verdict = await previewBooking(tx, { shiftId, workerId, now });
      if (!verdict) return { status: "gone" };
      if (!verdict.ok) {
        await recordEvent(tx, {
          actorType: "worker",
          actorId: workerId,
          action: "shift.ask_refused",
          entityType: "shift",
          entityId: shiftId,
          data: { workerId, codes: verdict.codes },
        });
        return { status: "not_eligible", reasons: verdict.reasons };
      }
      // A first ask, or asking again after a cancelled booking or a closed ask.
      const saved = await tx
        .insert(sessionAsks)
        .values({ firmId, shiftId, workerId, askedAt: now, status: "asked" })
        .onConflictDoUpdate({
          target: [sessionAsks.firmId, sessionAsks.shiftId, sessionAsks.workerId],
          set: { status: "asked", askedAt: now, answeredAt: null },
          setWhere: inArray(sessionAsks.status, ["booked", "closed"]),
        })
        .returning({ id: sessionAsks.id });
      if (saved.length === 0) return { status: "gone" };
      await recordEvent(tx, {
        actorType: "worker",
        actorId: workerId,
        action: "shift.asked",
        entityType: "shift",
        entityId: shiftId,
        data: { workerId },
      });
      return { status: "asked", askedAt: now };
    }),
  );
}

export const declineAskSchema = z.strictObject({
  shiftId: rosterId,
  workerId: rosterId,
  by: rosterId, // the office user
});

export type DeclineAskResult =
  | { status: "declined" }
  | { status: "not_waiting" } // no ask of theirs waiting (answered already, or never asked)
  | { status: "not_allowed" };

// The office's "Not this time" for one casual's ask, under the shift's lock (so a booking of them
// at this moment finishes first, and its ask is then booked, not waiting).
export async function declineAsk(
  run: WithFirm,
  firmId: string,
  raw: z.input<typeof declineAskSchema>,
  deps: { clock?: Clock } = {},
): Promise<DeclineAskResult> {
  const parsed = declineAskSchema.safeParse(raw);
  if (!parsed.success) return { status: "not_waiting" };
  const { shiftId, workerId, by } = parsed.data;
  const now = (deps.clock ?? systemClock).now();
  return retryAborted(() =>
    run(firmId, async (tx): Promise<DeclineAskResult> => {
      if (!(await officeCanPlace(tx, by))) return { status: "not_allowed" };
      await tx.execute(sql`select 1 from shifts where id = ${shiftId} for no key update`);
      const [ask] = await tx
        .update(sessionAsks)
        .set({ status: "not_this_time", answeredAt: now })
        .where(
          and(
            eq(sessionAsks.shiftId, shiftId),
            eq(sessionAsks.workerId, workerId),
            eq(sessionAsks.status, "asked"),
          ),
        )
        .returning({ id: sessionAsks.id });
      if (!ask) return { status: "not_waiting" };
      const eventId = await recordEvent(tx, {
        actorType: "office",
        actorId: by,
        action: "shift.ask_declined",
        entityType: "shift",
        entityId: shiftId,
        data: { workerId },
      });
      await queueAskAnswer(tx, { eventId, askId: ask.id });
      return { status: "declined" };
    }),
  );
}

// A casual now holding a place on the session: their ask (if any) is booked. In the booking's
// transaction (bookShift).
export async function bookOwnAsk(
  tx: FirmTx,
  shiftId: string,
  workerId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(sessionAsks)
    .set({ status: "booked", answeredAt: now })
    .where(
      and(
        eq(sessionAsks.shiftId, shiftId),
        eq(sessionAsks.workerId, workerId),
        ne(sessionAsks.status, "booked"),
      ),
    );
}

// The session is full: the asks of whoever holds a place are booked; every other one still waiting
// closes, and each casual is told. For a caller that knows it's full (closeOpenOffers).
export async function closeAsksOnFill(tx: FirmTx, shiftId: string, now: Date): Promise<number> {
  const holders = sql`(select a.worker_id from assignments a
    where a.shift_id = ${shiftId} and a.worker_id is not null
      and a.status not in (${CANCELLED}))`;
  await tx
    .update(sessionAsks)
    .set({ status: "booked", answeredAt: now })
    .where(
      and(
        eq(sessionAsks.shiftId, shiftId),
        ne(sessionAsks.status, "booked"),
        sql`${sessionAsks.workerId} in ${holders}`,
      ),
    );
  const closed = await tx
    .update(sessionAsks)
    .set({ status: "closed", answeredAt: now })
    .where(and(eq(sessionAsks.shiftId, shiftId), eq(sessionAsks.status, "asked")))
    .returning({ id: sessionAsks.id, workerId: sessionAsks.workerId });
  // One entry and one message each, in a fixed order.
  closed.sort((a, b) => a.workerId.localeCompare(b.workerId));
  for (const ask of closed) {
    const eventId = await recordEvent(tx, {
      actorType: "system",
      action: "shift.ask_closed",
      entityType: "shift",
      entityId: shiftId,
      data: { workerId: ask.workerId, reason: "filled" },
    });
    await queueAskAnswer(tx, { eventId, askId: ask.id });
  }
  return closed.length;
}

// The office (or its planner) cancelled the session, or moved it (new times, place or role,
// whether anyone is booked or not): asks still waiting close, untold. A move closes the office's
// "Not this time" ones too: that answer was for the old session, and they may ask for the new one.
// One entry for the session.
export async function closeAsksOnChange(
  tx: FirmTx,
  shiftId: string,
  now: Date,
  reason: "cancelled" | "moved",
): Promise<number> {
  const open: ("asked" | "not_this_time")[] =
    reason === "moved" ? ["asked", "not_this_time"] : ["asked"];
  const closed = await tx
    .update(sessionAsks)
    .set({ status: "closed", answeredAt: now })
    .where(and(eq(sessionAsks.shiftId, shiftId), inArray(sessionAsks.status, open)))
    .returning({ id: sessionAsks.id });
  if (closed.length > 0) {
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.asks_closed",
      entityType: "shift",
      entityId: shiftId,
      data: { reason, count: closed.length },
    });
  }
  return closed.length;
}
