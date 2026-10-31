import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { LIMITS, throttle } from "../auth/throttle";
import { messages } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
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
  return run(ctx.firmId, async (tx): Promise<SendAppMessageOutcome> => {
    const [row] = await tx
      .insert(messages)
      .values({
        firmId: sql`app_current_firm_id()`,
        direction: "in",
        channel: "app",
        providerMessageId,
        workerId,
        body: text,
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
