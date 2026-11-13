import { eq } from "drizzle-orm";
import { messages, workers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { lockUnhandled } from "./claim";
import { claimOptOut, optOutWordOf } from "./opt-out";

// Marking an unsorted message for a person (Wave 1, w1-04): one rule, in the caller's transaction,
// shared by the shifts line's last try (src/lib/inbound/reply.ts, runInboundWithLastTry: the job
// failed every try) and the office's reply or close on Enquiries (src/lib/office/enquiry-actions.ts:
// the shifts line hadn't sorted it 10 minutes after it came in). It takes the same claim as an
// answer (lockUnhandled, FOR UPDATE), so it happens at most once and the shifts line never answers
// the message afterwards (the job finds it handled).
//
// A STOP or START text still counts: it's claimed as the reply job claims one (claimOptOut), with
// no confirmation text. Anything else is marked handled as the office's, so it waits in Need a
// person (intent 'office'), with the number's worker (any status; one per number in a firm) or the
// app message's own, and `message.received` says why: `answerFailed` (the error's code, never its
// text) or `late: true`. Imports nothing that reaches the AI code (tests/unit/ai.boundary.test.ts).
export type ForAPersonWhy = { answerFailed: string } | { late: true };

export async function markForAPerson(
  tx: FirmTx,
  messageId: string,
  why: ForAPersonWhy,
  now: Date,
): Promise<"person" | "opt_out" | "already" | "gone"> {
  if (!(await lockUnhandled(tx, messageId))) return "already";
  // Only the message's own row and the number's worker: whatever failed may be in the full read.
  const [m] = await tx
    .select({
      direction: messages.direction,
      channel: messages.channel,
      from: messages.fromE164,
      body: messages.body,
      twilioOptOut: messages.twilioOptOut,
      workerId: messages.workerId,
    })
    .from(messages)
    .where(eq(messages.id, messageId));
  if (!m || m.direction !== "in") return "gone";
  const word = await optOutWordOf(tx, m);
  if (word && m.from) {
    const claimed = await claimOptOut(
      tx,
      messageId,
      { word, byTwilio: m.twilioOptOut !== null, from: m.from },
      why,
    );
    return claimed ? "opt_out" : "already";
  }
  // The worker with this number, whatever their status (one per number in a firm), as the
  // shifts line names them. (A message in the app says whose it is.)
  const [worker] =
    m.channel === "app" && m.workerId
      ? await tx
          .select({ id: workers.id, status: workers.status })
          .from(workers)
          .where(eq(workers.id, m.workerId))
      : m.from
        ? await tx
            .select({ id: workers.id, status: workers.status })
            .from(workers)
            .where(eq(workers.mobileE164, m.from))
            .limit(1)
        : [];
  const active = worker?.status === "active";
  await tx
    .update(messages)
    .set({
      handledAt: now,
      handledAs: "office",
      intent: "office",
      workerId: worker?.id ?? null,
    })
    .where(eq(messages.id, messageId));
  await recordEvent(tx, {
    ...(worker && active ? { actorType: "worker", actorId: worker.id } : { actorType: "system" }),
    action: "message.received",
    entityType: "message",
    entityId: messageId,
    data: {
      channel: m.channel,
      handledAs: "office",
      intent: "office",
      ...why,
      ...(worker ? { workerId: worker.id, ...(active ? {} : { formerWorker: true }) } : {}),
    },
  });
  return "person";
}
