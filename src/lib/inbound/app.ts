import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { LIMITS, throttle } from "../auth/throttle";
import { messages } from "../db/schema";
import { withFirm, type FirmTx, type WithFirm } from "../db/scoped";
import { isVisibleToCasuals } from "../roster/visibility";
import { appEnv } from "../env";
import { APP_MESSAGE_MAX, appMessageText, charCount } from "./app-limits";
import { queueInboundMessage } from "./job";

export { APP_MESSAGE_MAX };

// A casual's message to the office in the app (P8; Phase 25.6; docs/screens.md "Messages: the
// in-app chat"). Stored as the shifts line's are (src/lib/inbound/receive.ts): one `messages` row
// (channel `app`, theirs by `worker_id`, no numbers) and one inbound-message job, in the same
// transaction; the job sorts and answers it in the app (src/lib/inbound/reply.ts). Every send
// counts against LIMITS.appMessagePerWorker first, in its own short transaction, so a refused or
// failed one still counts. The worker comes from their session, never the browser. The form gives
// each message an id of its own (`clientId`, kept when she taps Send again after a send that seemed
// to fail), stored as `app:{clientId}`: a repeat of one already stored stores nothing and queues
// nothing (golden rule 3's shape), and answers as the first did. One that isn't hers is refused.
//
// About a session (Phase 28.2; 28.6's "Message the office", src/lib/portal/message-office.ts): the
// session's id is kept on the row (messages.shift_id) only for one she's booked on or can see
// (shown to casuals: src/lib/roster/visibility.ts), that isn't a draft or cancelled and hasn't
// ended, checked in the same transaction as the insert. Anything else (another firm's session, a
// hidden one, one that has ended, not an id) is stored with no session, and the message is sorted
// as any other: a pay question about a worked shift goes towards the pay query (golden rule 9).
//
// About her pay, with no session (the guardrails review of 28.10; Messages opened from Pay's
// "Message the office", src/lib/portal/message-office.ts MESSAGES_ABOUT_PAY): stored already
// marked for the office (intent 'office' before the job claims it), and the job never sorts it
// (src/lib/inbound/reply.ts): a person answers. Pay sends her there only when Pay can't take the
// question (no way to send her a code, or older than 90 days), so the automatic pay link, which
// points back to Pay, would loop. Asking for a person is always the safe side: it widens nothing.

export type SendAppMessageOutcome =
  | { status: "sent"; messageId: string }
  | { status: "empty" }
  | { status: "too_long" }
  | { status: "rate_limited"; retryAfterMinutes: number }
  | { status: "logged_out" }
  | { status: "error" };

export async function receiveAppMessage(
  ctx: { firmId: string; run?: WithFirm; clock?: Clock; secret?: string },
  workerId: string,
  raw: string,
  clientId?: string, // a UUID (checked by the action)
  shiftId?: string | null, // the session it's about, if any (kept only when allowed: above)
  aboutPay?: boolean, // sent from Messages opened about her pay: for the office (above)
): Promise<SendAppMessageOutcome> {
  const text = appMessageText(raw);
  if (text === "") return { status: "empty" };
  if (charCount(text) > APP_MESSAGE_MAX) return { status: "too_long" };
  const run = ctx.run ?? withFirm;
  const limited = await throttle(
    run,
    ctx.firmId,
    [{ limit: LIMITS.appMessagePerWorker, value: workerId }],
    {
      now: (ctx.clock ?? systemClock).now(),
      secret: ctx.secret ?? appEnv().SESSION_SECRET,
      entityType: "worker",
      entityId: workerId,
    },
  );
  if (limited) return { status: "rate_limited", retryAfterMinutes: limited.retryAfterMinutes };
  const providerMessageId = `app:${clientId ?? randomUUID()}`;
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firmId, async (tx): Promise<SendAppMessageOutcome> => {
    const about = await sessionToTag(tx, workerId, shiftId, now);
    const [row] = await tx
      .insert(messages)
      .values({
        firmId: sql`app_current_firm_id()`,
        direction: "in",
        channel: "app",
        providerMessageId,
        workerId,
        body: text,
        shiftId: about,
        intent: aboutPay === true ? "office" : null, // about her pay: for the office (above)
      })
      .onConflictDoNothing({ target: [messages.firmId, messages.providerMessageId] })
      .returning({ id: messages.id });
    if (!row) {
      // Sent before (a repeat): hers, or nothing.
      const [before] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.providerMessageId, providerMessageId),
            eq(messages.workerId, workerId),
            eq(messages.direction, "in"),
          ),
        );
      return before ? { status: "sent", messageId: before.id } : { status: "error" };
    }
    await queueInboundMessage(tx, row.id);
    return { status: "sent", messageId: row.id };
  });
}

const uuid = z.uuid();

// The session a message may name: hers (a booking that isn't cancelled) or one shown to casuals,
// not a draft or cancelled, and not ended. Null otherwise (RLS hides another firm's session).
// Messages' About line asks the same (Phase 28.6, src/lib/portal/messages.ts), so the line shows
// exactly when a send would keep the session.
export async function sessionToTag(
  tx: FirmTx,
  workerId: string,
  shiftId: string | null | undefined,
  now: Date,
): Promise<string | null> {
  if (!shiftId || !uuid.safeParse(shiftId).success) return null;
  const { rows } = await tx.execute<{ booked: boolean }>(sql`
    select exists (select 1 from assignments a
                    where a.firm_id = s.firm_id and a.shift_id = s.id and a.worker_id = ${workerId}
                      and a.status in ('confirmed', 'completed', 'no_show')) as booked
      from shifts s
     where s.id = ${shiftId} and s.status not in ('draft', 'cancelled') and s.ends_at > ${now}
  `);
  const session = rows[0];
  if (!session) return null;
  if (session.booked) return shiftId;
  return (await isVisibleToCasuals(tx, shiftId)) ? shiftId : null;
}
