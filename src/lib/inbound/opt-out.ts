import { and, eq, isNotNull, sql } from "drizzle-orm";
import { messages, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { errorCode } from "../jobs/firm-job";
import type { MessagingTransport } from "../messaging";
import { smsStartedMessage, smsStoppedMessage, type FirmVoice } from "../messaging/templates";
import { lockUnhandled } from "./claim";
import type { InboundMessagePayload } from "./job";

// STOP and START by text (docs/messaging-templates.md "Notification policy"; docs/api-and-jobs.md
// `inbound-message`). A text to the shifts line that is only an opt-out word turns texts off for
// that number's worker (workers.sms_opted_out_at), and a start word turns them back on. Every
// sender then leaves texts out for them (src/lib/notify/send.ts).
//
// The words are Twilio's standard English ones (with OPTOUT and REVOKE, which Twilio added more
// recently: check its list when connecting), the whole message only (any case, spaces and a full
// stop or "!" around it), so our record matches what Twilio does when its own opt-out handling is
// on: "cancel" alone is an opt-out, "can I cancel my shift" isn't. When Twilio acted on a text, it
// says so (OptOutType, stored as messages.twilio_opt_out) and has sent its own confirmation. "YES"
// (or anything else Twilio calls START) only turns texts back on for a number that has them off
// (otherwise it's an ordinary message). A STOP or START handled after a later one from the same
// number (a retried job) changes nothing: the latest word counts.
//
// The same claim / send / record shape as every reply: in one transaction the message is locked
// and marked `opt_out`, the worker's setting changed and logged (only when it changes); then at
// most one confirmation text, only when it changed and Twilio didn't confirm it itself (no loops,
// no double confirmations); then it's recorded. The confirmation goes even though texts are now
// off: it's the answer to their STOP.

export type OptOutWord = "stop" | "start";

const STOP_WORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "optout",
  "revoke",
]);
const START_WORDS = new Set(["start", "unstop"]);
const START_IF_OFF = new Set(["yes"]);

// A text's opt-out word: "stop", "start", "yes" (start, only for a number with texts off), or none.
// Pure.
export function smsOptOutWord(body: string | null): OptOutWord | "yes" | null {
  const word =
    body
      ?.trim()
      .replace(/[.!]+$/, "")
      .trim()
      .toLowerCase() ?? "";
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (START_IF_OFF.has(word)) return "yes";
  return null;
}

export interface OptOutRead {
  kind: "opt_out";
  word: OptOutWord;
  byTwilio: boolean; // Twilio's own opt-out handling acted on it (and confirmed it)
  from: string;
  line: string;
  firm: FirmVoice;
}

export type OptOutResult = {
  status: "opt_out";
  optOut: OptOutWord;
  changed: boolean; // a worker's texts were turned off or on by it
  confirmation: "sent" | "failed" | "none";
};

// A stored text's opt-out word, as the reply job reads it: Twilio's own (when its opt-out handling
// acted on it) or ours; "yes", or what Twilio calls START without our START word, counts only for
// a number that has texts off. Null for anything else (and for anything but a text).
export async function optOutWordOf(
  tx: FirmTx,
  m: {
    channel: string;
    from: string | null;
    body: string | null;
    twilioOptOut: OptOutWord | null;
  },
): Promise<OptOutWord | null> {
  if (m.channel !== "sms" || !m.from) return null;
  const ours = smsOptOutWord(m.body);
  const word = m.twilioOptOut ?? ours;
  if (word === "yes" || (word === "start" && ours !== "start")) {
    const [off] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(and(eq(workers.mobileE164, m.from), isNotNull(workers.smsOptedOutAt)));
    return off ? "start" : null;
  }
  return word;
}

export async function answerOptOut(
  payload: InboundMessagePayload,
  run: WithFirm,
  deps: { transport: MessagingTransport },
  c: OptOutRead,
): Promise<OptOutResult | { status: "already" }> {
  const plan = await run(payload.firmId, (tx) => claimOptOut(tx, payload.messageId, c));
  if (plan === null) return { status: "already" };
  if (!plan.confirm) {
    return { status: "opt_out", optOut: c.word, changed: plan.changed, confirmation: "none" };
  }

  const body = c.word === "stop" ? smsStoppedMessage(c.firm) : smsStartedMessage(c.firm);
  const reply = c.word === "stop" ? "sms_stopped" : "sms_started";
  let sent: { providerMessageId: string } | { error: string };
  try {
    sent = await deps.transport.send({ channel: "sms", to: c.from, from: c.line, body });
  } catch (err) {
    sent = { error: errorCode(err) };
  }

  return run(payload.firmId, async (tx): Promise<OptOutResult> => {
    if ("error" in sent) {
      await recordEvent(tx, {
        actorType: "system",
        action: "message.reply_failed",
        entityType: "message",
        entityId: payload.messageId,
        data: { channel: "sms", reply, workerId: plan.workerId, code: sent.error },
      });
      return { status: "opt_out", optOut: c.word, changed: true, confirmation: "failed" };
    }
    const [out] = await tx
      .insert(messages)
      .values({
        firmId: sql`app_current_firm_id()`,
        direction: "out",
        channel: "sms",
        providerMessageId: sent.providerMessageId,
        workerId: plan.workerId,
        fromE164: c.line,
        toE164: c.from,
        body,
        replyTo: payload.messageId,
      })
      .returning({ id: messages.id });
    await recordEvent(tx, {
      actorType: "system",
      action: "message.replied",
      entityType: "message",
      entityId: payload.messageId,
      data: { channel: "sms", reply, workerId: plan.workerId, replyId: out?.id ?? null },
    });
    return { status: "opt_out", optOut: c.word, changed: true, confirmation: "sent" };
  });
}

// The claim for a STOP or START, in the caller's transaction: the message locked and, if nobody has
// handled it, marked `opt_out`, the worker's setting changed and logged (only when it changes), and
// `message.received`. Null: already handled. Also the shifts line's last try (src/lib/inbound/
// reply.ts), with the failure's code: the word still counts, though no confirmation goes.
export async function claimOptOut(
  tx: FirmTx,
  messageId: string,
  c: { word: OptOutWord; byTwilio: boolean; from: string },
  lastTry?: { answerFailed: string },
): Promise<{ changed: boolean; workerId: string | null; confirm: boolean } | null> {
  if (!(await lockUnhandled(tx, messageId))) return null;
  // The worker with this number, whatever their status (one per number in a firm).
  const [worker] = await tx
    .select({ id: workers.id, optedOutAt: workers.smsOptedOutAt })
    .from(workers)
    .where(eq(workers.mobileE164, c.from))
    .for("update");
  // A later STOP or START from this number already handled (this job ran late, a retry): the
  // latest word counts, so this one changes nothing. (The worker row's lock above puts two jobs
  // for one number in turn, so each sees the other's.)
  const { rows: later } = await tx.execute(sql`
      select 1 from messages this, messages later
       where this.id = ${messageId}::uuid
         and later.direction = 'in' and later.channel = 'sms' and later.handled_as = 'opt_out'
         and later.from_e164 = this.from_e164 and later.id <> this.id
         and later.created_at > this.created_at
       limit 1`);
  const superseded = later.length > 0;
  const changed =
    worker !== undefined && !superseded && (c.word === "stop") === (worker.optedOutAt === null);
  if (worker && changed) {
    await tx
      .update(workers)
      .set({ smsOptedOutAt: c.word === "stop" ? new Date() : null })
      .where(eq(workers.id, worker.id));
    await recordEvent(tx, {
      actorType: "worker",
      actorId: worker.id,
      action: c.word === "stop" ? "worker.sms_opted_out" : "worker.sms_opted_in",
      entityType: "worker",
      entityId: worker.id,
      data: { via: "sms", byTwilio: c.byTwilio },
    });
  }
  await tx
    .update(messages)
    .set({ handledAt: new Date(), handledAs: "opt_out", workerId: worker?.id ?? null })
    .where(eq(messages.id, messageId));
  await recordEvent(tx, {
    actorType: worker ? "worker" : "system",
    ...(worker ? { actorId: worker.id } : {}),
    action: "message.received",
    entityType: "message",
    entityId: messageId,
    data: {
      channel: "sms",
      handledAs: "opt_out",
      optOut: c.word,
      changed,
      ...(superseded ? { superseded } : {}),
      ...(lastTry ? { answerFailed: lastTry.answerFailed } : {}),
      workerId: worker?.id ?? null,
    },
  });
  // On the last try nothing is sent: the confirmation waits on the failure being fixed.
  return { changed, workerId: worker?.id ?? null, confirm: changed && !c.byTwilio && !lastTry };
}

// Whether a number that isn't one of the firm's casuals last texted STOP to the shifts line (its
// latest STOP or START, as handled above): the office's reply on Enquiries never texts it then
// (12D.1). A casual's own setting is workers.sms_opted_out_at instead.
export async function strangerTextsOff(tx: FirmTx, from: string): Promise<boolean> {
  const { rows } = await tx.execute<{ word: string | null }>(sql`
    select e.data ->> 'optOut' as word
      from messages m
      join events e on e.firm_id = m.firm_id and e.entity_id = m.id
                   and e.action = 'message.received'
     where m.direction = 'in' and m.handled_as = 'opt_out' and m.from_e164 = ${from}
     order by m.created_at desc, m.id desc
     limit 1
  `);
  return rows[0]?.word === "stop";
}
