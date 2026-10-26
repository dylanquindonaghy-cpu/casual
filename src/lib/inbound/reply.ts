import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getAi } from "../ai/anthropic";
import { sortMessage, type AiFallback } from "../ai/classify-message";
import type { AiClient } from "../ai/client";
import { firms, messages, officeUsers, requests, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { passesLogCheck, recordEvent } from "../events/record";
import { errorCode, type FirmTask, type JobAttempt } from "../jobs/firm-job";
import { log } from "../log";
import { getTransport, type MessagingTransport } from "../messaging";
import { sendToWorker, smsAllowedFor } from "../notify/send";
import {
  shiftsLineReply,
  unknownNumberAlertEmail,
  unknownNumberMessage,
  voicemailReceivedMessage,
  type ShiftsLineReply,
} from "../messaging/templates";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { systemClock, type Clock } from "../auth/clock";
import { lockUnhandled } from "./claim";
import { INBOUND_RETRY_LIMIT, inboundMessageJob, type InboundMessagePayload } from "./job";
import { keywordIntent, type Intent } from "./keywords";
import { autoRepliesOn, takeUnknownAlert } from "./limits";
import {
  answerOptOut,
  claimOptOut,
  optOutWordOf,
  type OptOutRead,
  type OptOutResult,
} from "./opt-out";
import { cancelReply, shiftsReply, type EnquiryChecks } from "./personal-reply";
import { cutChars } from "../text/cut";

// Answering a WhatsApp, a text or a voicemail on the shifts line (docs/api-and-jobs.md `inbound-message`;
// docs/messaging-templates.md "Instant replies on the shifts line", "Call-to-text recording").
// One job per stored message (src/lib/inbound/receive.ts, src/lib/inbound/voice.ts). A voicemail
// always goes to the office (no keywords or AI) and its answer is `voicemail_received`, by the
// channel the worker chose (a call opens no WhatsApp window for free text). Nothing is written before the point of no return, so a failure or a
// crash before the reply goes is simply retried; after it, the reply is never sent again:
//   1. a read: the message, the firm, the worker by the number it came from (an active worker of
//      this firm) and a keyword: cancel, pay, shifts or the office, in that order
//      (src/lib/inbound/keywords.ts). A text that is only STOP or START (or that Twilio's own
//      opt-out handling acted on): answerOptOut() (src/lib/inbound/opt-out.ts). A number that isn't
//      an active worker's: answerUnknown() below (a polite reply and an office alert, once per
//      number per 24 hours);
//   2. no keyword: the AI picks one of those four labels from the worker's text, outside any
//      transaction (src/lib/ai/classify-message.ts); no answer, a failure or anything else: the
//      office. A message with no text (a photo) goes to the office;
//   3. the claim, in one transaction: the message locked and, if no one has handled it yet, marked
//      handled (how, and what they asked); the office's `general` request (the message as its
//      note, linked by `message_id`) when it's for the office; `message.received`;
//   4. the reply goes outside any transaction, from the number they wrote to, at once (a reply to
//      their own message: quiet hours don't apply);
//   5. the reply stored as an outbound message, and `message.replied`, or `message.reply_failed`
//      (never retried).
// A failure before the claim (a bug, or the database failing) is retried by the queue; on its last
// try the message is passed to a person, and the job still fails (runInboundWithLastTry, below).
// The reply is always one of the app's fixed texts (shiftsLineReply, voicemailReceivedMessage): the
// AI only ever picks which, so nothing it writes reaches the worker, and a pay question gets the
// pay link, never an answer (golden rules 1 and 9). Events hold labels and ids, never the text or a number.
// Automatic replies are off unless the firm switches them on (P4.7, src/lib/inbound/limits.ts):
// then a casual's message is sorted as above but made the office's question (step 3's request),
// `message.received` says `replyHeld` and what it was sorted as (`sortedAs`), and nothing is sent
// (steps 4 and 5 don't happen; nor does the personal reply's read).

export interface InboundReplyDeps {
  transport: MessagingTransport;
  ai: AiClient;
  baseDomain: string;
  aiTimeoutMs?: number; // tests pass a short one
  clock?: Clock; // tests pass a fixed one (the personal reply's "now")
}

export type InboundResult =
  | { status: "replied"; intent: Intent; handledAs: "keyword" | "ai" | "office" }
  // Automatic replies off: the office's (intent), with what it was sorted as.
  | { status: "held"; intent: "office"; sortedAs: Intent; handledAs: "keyword" | "ai" | "office" }
  | { status: "reply_failed"; intent: Intent; code: string }
  | {
      status: "unknown_sender";
      // The polite reply (none: a former worker, or a repeat; held: automatic replies are off).
      reply: "sent" | "failed" | "none" | "held";
      alerted: number; // office users emailed
      alertHeld?: true; // the firm's 5 unknown-number alerts this hour were used up
    }
  | OptOutResult
  | { status: "already" }
  | { status: "gone" };

const OFFICE_NOTE_MAX = 500;
const NO_TEXT_NOTE = "(A photo or file, with no text.)";
const NO_VOICE_TEXT_NOTE = "(A voicemail we couldn't turn into text.)";

type Channel = "whatsapp" | "sms" | "voice";

type Read =
  | { kind: "done"; result: InboundResult }
  | OptOutRead
  | {
      kind: "unknown";
      channel: Channel;
      from: string | null; // null: a withheld number (a voicemail)
      line: string;
      formerWorkerId: string | null; // the number is a worker's here who isn't active
      firm: { name: string; slug: string; signOff: string };
      autoReplies: boolean; // the firm's automatic replies (off: nothing is sent back)
    }
  | {
      kind: "known";
      channel: Channel;
      workerId: string;
      mobile: string;
      notifyChannel: "whatsapp" | "sms"; // how they asked to be messaged (a voicemail's reply)
      smsAllowed: boolean; // false: they replied STOP to a text
      line: string;
      body: string | null;
      keyword: Intent | null;
      firm: { name: string; slug: string; signOff: string };
      autoReplies: boolean; // the firm's automatic replies (off: nothing is sent back)
    };

// Step 1: reads only.
async function read(tx: FirmTx, messageId: string): Promise<Read> {
  const [m] = await tx
    .select({
      direction: messages.direction,
      channel: messages.channel,
      handledAt: messages.handledAt,
      from: messages.fromE164,
      to: messages.toE164,
      body: messages.body,
      twilioOptOut: messages.twilioOptOut,
    })
    .from(messages)
    .where(eq(messages.id, messageId));
  if (!m || m.direction !== "in") return { kind: "done", result: { status: "gone" } };
  if (m.handledAt) return { kind: "done", result: { status: "already" } };
  const [firm] = await tx
    .select({ name: firms.name, slug: firms.slug, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  if (!firm) throw new Error("firm not visible inside its own transaction");
  const from = m.from;
  const autoReplies = autoRepliesOn(firm.settings);
  // A text saying only STOP or START (or one Twilio's own opt-out handling acted on; YES, or
  // anything else Twilio calls START, only for a number with texts off).
  const word = await optOutWordOf(tx, m);
  if (word && from) {
    return {
      kind: "opt_out",
      word,
      byTwilio: m.twilioOptOut !== null,
      from,
      line: m.to,
      firm: { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) },
      autoReplies,
    };
  }
  const [worker] = from
    ? await tx
        .select({
          id: workers.id,
          notifyChannel: workers.notifyChannel,
          smsOptedOutAt: workers.smsOptedOutAt,
        })
        .from(workers)
        .where(and(eq(workers.mobileE164, from), eq(workers.status, "active")))
        .limit(1)
    : [];
  const voice = {
    name: firm.name,
    slug: firm.slug,
    signOff: signOffFor(firm.name, firm.settings.sign_off),
  };
  if (!worker || !from) {
    const [former] = from
      ? await tx
          .select({ id: workers.id })
          .from(workers)
          .where(eq(workers.mobileE164, from))
          .limit(1)
      : [];
    return {
      kind: "unknown",
      channel: m.channel,
      from,
      line: m.to,
      formerWorkerId: former?.id ?? null,
      firm: voice,
      autoReplies,
    };
  }
  return {
    kind: "known",
    channel: m.channel,
    workerId: worker.id,
    mobile: from,
    notifyChannel: worker.notifyChannel,
    smsAllowed: smsAllowedFor(worker),
    line: m.to,
    body: m.body,
    // A voicemail is for the office: no keywords (nor AI) for it.
    keyword: m.body && m.channel !== "voice" ? keywordIntent(m.body) : null,
    firm: {
      name: firm.name,
      slug: firm.slug,
      signOff: signOffFor(firm.name, firm.settings.sign_off),
    },
    autoReplies,
  };
}

// Where an office request came from, in its payload and event.
const via = (channel: Channel) => (channel === "voice" ? "voicemail" : channel);

// One sender's messages are answered in the order they arrived, whatever order their jobs run in
// (several run at once: src/worker/jobs/index.ts). So before this message, any older one from the
// same number that nobody has answered yet is answered first, by this job: a STOP is always handled
// before the text that came after it. If another job is answering one of them, this waits for its
// claim (the message row's lock) and then finds it handled. Best effort: an older message that
// fails here is logged and left to its own job's retries, so one bad message never stops a worker
// getting answers (if it was a STOP or START, the later word counts when it's retried:
// src/lib/inbound/opt-out.ts). At most OLDER_LIMIT at a time, so one job stays short.
export async function runInboundMessage(
  payload: InboundMessagePayload,
  run: WithFirm,
  deps: InboundReplyDeps,
): Promise<InboundResult> {
  const older = await run(payload.firmId, (tx) => olderUnhandled(tx, payload.messageId));
  for (const messageId of older) {
    try {
      await answerMessage(
        { ...payload, messageId, idempotencyKey: `inbound-message:${messageId}` },
        run,
        deps,
      );
    } catch (err) {
      log.warn("inbound: an older message from the same number failed; its own job retries it", {
        firmId: payload.firmId,
        messageId,
        code: errorCode(err),
      });
    }
  }
  return answerMessage(payload, run, deps);
}

// The most older messages one job answers first. Anything beyond is still answered by its own job,
// just not ahead of this one: only a sender with 50 unanswered messages queued would notice.
export const OLDER_LIMIT = 50;

// The same number's earlier inbound messages to the same line, not yet handled, oldest first.
async function olderUnhandled(tx: FirmTx, messageId: string): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    select o.id::text as id
      from messages m
      join messages o
        on o.firm_id = m.firm_id and o.from_e164 = m.from_e164 and o.to_e164 = m.to_e164
       and o.direction = 'in' and o.handled_at is null
       and (o.created_at, o.id) < (m.created_at, m.id)
     where m.id = ${messageId} and m.direction = 'in' and m.from_e164 is not null
     order by o.created_at, o.id
     limit ${OLDER_LIMIT}
  `);
  return rows.map((r) => r.id);
}

async function answerMessage(
  payload: InboundMessagePayload,
  run: WithFirm,
  deps: InboundReplyDeps,
): Promise<InboundResult> {
  const c = await run(payload.firmId, (tx) => read(tx, payload.messageId));
  if (c.kind === "done") return c.result;
  if (c.kind === "opt_out") return answerOptOut(payload, run, deps, c);
  if (c.kind === "unknown") return answerUnknown(payload, run, deps, c);

  // Step 2: what they asked: a keyword, else the AI's label (outside any transaction), else the
  // office.
  let intent: Intent;
  let handledAs: "keyword" | "ai" | "office";
  // Why the AI didn't sort it (for the office's "How it was answered"): a photo with no text, or
  // the AI's own reason.
  let aiFallback: AiFallback | "no_text" | null = null;
  if (c.keyword) {
    intent = c.keyword;
    handledAs = "keyword";
  } else if (c.channel === "voice") {
    intent = "office";
    handledAs = "office";
  } else {
    const sorted = c.body
      ? await sortMessage(c.body, deps.ai, { timeoutMs: deps.aiTimeoutMs })
      : ({ label: null, why: "no_text" } as const);
    intent = sorted.label ?? "office";
    handledAs = sorted.label ? "ai" : "office";
    if (!sorted.label) aiFallback = sorted.why;
  }

  // Automatic replies off (P4.7; decision 11, "a text that comes in goes to the office"): every
  // casual's message is the office's question, so a dropout, a pay question or a shifts question
  // never sits on Enquiries as answered when nothing went. What it was sorted as stays in the log
  // (`sortedAs`).
  const sortedAs = intent;
  if (!c.autoReplies) intent = "office";

  // Step 2b: the personal reply to "shifts" or "cancel" (src/lib/inbound/personal-reply.ts), read
  // before the claim like the AI's label: built by code from the firm's data, never by the AI. Not
  // read when nothing will be sent (automatic replies off).
  const portal = portalUrl(c.firm.slug, deps.baseDomain);
  const now = (deps.clock ?? systemClock).now();
  const voiceOf = { name: c.firm.name, signOff: c.firm.signOff };
  const personal = !c.autoReplies
    ? null
    : intent === "shifts"
      ? await shiftsReply(run, {
          firmId: payload.firmId,
          workerId: c.workerId,
          text: c.body,
          now,
          firm: voiceOf,
          portal,
        })
      : intent === "cancel"
        ? await cancelReply(run, {
            firmId: payload.firmId,
            workerId: c.workerId,
            now,
            firm: voiceOf,
            portal,
          })
        : null;
  // What the office's Enquiries page will read, settled before the claim: the reply goes once, so
  // an entry the log would refuse must never roll back the stored reply after the send.
  const logged = personal
    ? { whatsapp: settled(personal.checks.whatsapp), sms: settled(personal.checks.sms) }
    : null;

  // Step 3: the claim, the office's request and the event, together.
  const texts = await run(payload.firmId, async (tx) => {
    if (!(await lockUnhandled(tx, payload.messageId))) return null;
    // The fixed reply (pay, the office); null for shifts and cancel (the personal reply).
    let built: ShiftsLineReply | null = null;
    if (intent === "office") {
      const [request] = await tx
        .insert(requests)
        .values({
          firmId: sql`app_current_firm_id()`,
          workerId: c.workerId,
          type: "general",
          payload: {
            // Cut by characters, never inside an emoji: half of one is refused by jsonb, which
            // would fail the job on every try and lose the message (12L.1 guardrails review; the
            // shared cut since 13.5, which also keeps a flag or skin tone whole).
            note: c.body
              ? cutChars(c.body, OFFICE_NOTE_MAX)
              : c.channel === "voice"
                ? NO_VOICE_TEXT_NOTE
                : NO_TEXT_NOTE,
            via: via(c.channel),
          },
          messageId: payload.messageId,
        })
        .returning({ id: requests.id });
      if (!request) throw new Error("request insert returned nothing");
      await recordEvent(tx, {
        actorType: "worker",
        actorId: c.workerId,
        action: "request.created",
        entityType: "request",
        entityId: request.id,
        data: { type: "general", shiftId: null, via: via(c.channel), workerId: c.workerId },
      });
      built = { intent: "office", ref: request.id.slice(0, 8).toUpperCase() };
    } else if (intent === "pay") {
      built = { intent: "pay", link: `${portal}/pay` };
    }
    await tx
      .update(messages)
      .set({ handledAt: new Date(), workerId: c.workerId, handledAs, intent })
      .where(eq(messages.id, payload.messageId));
    await recordEvent(tx, {
      actorType: "worker",
      actorId: c.workerId,
      action: "message.received",
      entityType: "message",
      entityId: payload.messageId,
      data: {
        channel: c.channel,
        handledAs,
        intent,
        ...(aiFallback ? { aiFallback } : {}),
        ...(c.autoReplies ? {} : { replyHeld: true, sortedAs }),
        workerId: c.workerId,
      },
    });
    // Nothing goes back (automatic replies off): the office has the message, and its question.
    if (!c.autoReplies) return "held" as const;
    // Shifts and cancel: the personal reply, in each channel's words.
    if (!built) {
      if (!personal) throw new Error("a shifts or cancel message without its personal reply");
      return { replyText: personal.whatsapp, smsText: personal.sms };
    }
    const reply = built;
    const voice = { name: c.firm.name, signOff: c.firm.signOff };
    const fixed = (): string => {
      return c.channel === "voice" && reply.intent === "office"
        ? voicemailReceivedMessage(voice, reply.ref)
        : shiftsLineReply(voice, reply);
    };
    const text = fixed();
    return { replyText: text, smsText: text };
  });
  if (texts === null) return { status: "already" };
  if (texts === "held") return { status: "held", intent: "office", sortedAs, handledAs };
  const { replyText, smsText } = texts;

  // By WhatsApp to a WhatsApp (a text if WhatsApp refuses it); a voicemail's by the channel the
  // worker chose. Always from the number they contacted.
  const sent = await sendToWorker(deps, {
    mobile: c.mobile,
    channel: c.channel === "voice" ? c.notifyChannel : c.channel,
    smsAllowed: c.smsAllowed,
    body: { whatsapp: replyText, sms: smsText },
    from: c.line,
  });

  return run(payload.firmId, async (tx): Promise<InboundResult> => {
    // What the personal reply was built from (docs/office-v2.md 3.6, 6.1), whether it went or not.
    // The entry for the words that went (a text lists fewer than a WhatsApp).
    if (logged) {
      await recordEvent(tx, {
        actorType: "system",
        action: "enquiry.checks",
        entityType: "message",
        entityId: payload.messageId,
        data: {
          ...logged[sent.channel === "sms" ? "sms" : "whatsapp"],
          sent: sent.ok,
          channel: sent.channel,
          workerId: c.workerId,
        },
      });
    }
    if (!sent.ok) {
      await recordEvent(tx, {
        actorType: "system",
        action: "message.reply_failed",
        entityType: "message",
        entityId: payload.messageId,
        data: { channel: sent.channel, intent, workerId: c.workerId, code: sent.code },
      });
      return { status: "reply_failed", intent, code: sent.code };
    }
    const [out] = await tx
      .insert(messages)
      .values({
        firmId: sql`app_current_firm_id()`,
        direction: "out",
        channel: sent.channel,
        providerMessageId: sent.providerMessageId,
        workerId: c.workerId,
        fromE164: c.line,
        toE164: c.mobile,
        body: sent.channel === "sms" ? smsText : replyText,
        intent,
        replyTo: payload.messageId,
      })
      .returning({ id: messages.id });
    await recordEvent(tx, {
      actorType: "system",
      action: "message.replied",
      entityType: "message",
      entityId: payload.messageId,
      data: {
        channel: sent.channel,
        intent,
        ...(sent.fellBackFrom ? { fellBackFrom: sent.fellBackFrom } : {}),
        workerId: c.workerId,
        // The provider's id is on the stored reply (replyId).
        replyId: out?.id ?? null,
      },
    });
    return { status: "replied", intent, handledAs };
  });
}

// Someone who isn't one of the firm's active workers (docs/messaging-templates.md
// `unknown_number`, `unknown_number_alert`). Only the first message from a number in 24 hours gets
// the polite reply and alerts the office: later ones are stored and shown on Enquiries, so an
// auto-reply or a bot can't loop and the office gets one email, not one per message. A former
// worker (their number is on file, not active) gets no "we don't recognise this number" (we do):
// the office is alerted and decides. Same shape as the known path: the claim, then the sends
// outside any transaction, then the record. The alert email holds neither the number nor the
// message: they're on Enquiries. Since P4.7 (src/lib/inbound/limits.ts): the polite reply is held
// when the firm's automatic replies are off (`replyHeld`), and the alert email when the firm's 5
// this hour are used up (`alertHeld`: counted in the claim, so once however often the job runs;
// that number's later messages that day are repeats, as before, and wait on Enquiries).
async function answerUnknown(
  payload: InboundMessagePayload,
  run: WithFirm,
  deps: InboundReplyDeps,
  c: Extract<Read, { kind: "unknown" }>,
): Promise<InboundResult> {
  const now = (deps.clock ?? systemClock).now();
  const plan = await run(payload.firmId, async (tx) => {
    if (!(await lockUnhandled(tx, payload.messageId))) return null;
    // One of these at a time per number (two messages from one stranger handled at once would
    // otherwise both look like the first). The check below then sees the other's committed claim.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('unknown-number:' || app_current_firm_id()::text || ':' || ${c.from ?? "withheld"}, 0))`,
    );
    // A repeat: this number's last answered message (a first one: logged with repeat false) was
    // under 24 hours ago. So a number gets at most one reply and one alert in any 24 hours, and
    // writing every day still brings one a day.
    // A withheld number can't be matched to its earlier messages: each voicemail is its own first.
    const { rows: earlier } =
      c.from === null
        ? { rows: [] }
        : await tx.execute(sql`
      select 1 from messages m
        join events e on e.firm_id = m.firm_id and e.entity_id = m.id
       where m.direction = 'in' and m.handled_as = 'unknown' and m.from_e164 = ${c.from}
         and m.id <> ${payload.messageId}::uuid
         and e.action = 'message.received' and e.data ->> 'repeat' = 'false'
         and e.created_at > now() - interval '24 hours'
       limit 1`);
    const repeat = earlier.length > 0;
    await tx
      .update(messages)
      .set({ handledAt: new Date(), handledAs: "unknown", workerId: c.formerWorkerId })
      .where(eq(messages.id, payload.messageId));
    // Only a WhatsApp from a number nobody here has gets the polite reply (we don't message callers
    // we don't know); held when the firm's automatic replies are off.
    const wouldReply =
      !repeat && c.channel === "whatsapp" && c.from !== null && c.formerWorkerId === null;
    const replyHeld = wouldReply && !c.autoReplies;
    let recipients: string[] = [];
    let skipped = 0;
    let alertHeld = false;
    if (!repeat) {
      const office = await tx
        .select({ email: officeUsers.email })
        .from(officeUsers)
        .where(
          and(eq(officeUsers.status, "active"), inArray(officeUsers.role, ["admin", "resourcer"])),
        )
        .orderBy(asc(officeUsers.email));
      recipients = office.map((o) => o.email).filter((email) => z.email().safeParse(email).success);
      skipped = office.length - recipients.length;
      // At most 5 alerts per firm an hour, counted only when there's someone to email.
      if (recipients.length > 0 && !(await takeUnknownAlert(tx, now))) {
        alertHeld = true;
        recipients = [];
      }
    }
    await recordEvent(tx, {
      actorType: "system",
      action: "message.received",
      entityType: "message",
      entityId: payload.messageId,
      data: {
        channel: c.channel,
        handledAs: "unknown",
        repeat,
        formerWorker: c.formerWorkerId !== null,
        ...(replyHeld ? { replyHeld: true } : {}),
        ...(alertHeld ? { alertHeld: true } : {}),
      },
    });
    return {
      repeat,
      reply: wouldReply && c.autoReplies ? unknownNumberMessage(c.firm) : null,
      replyHeld,
      recipients,
      skipped,
      alertHeld,
    };
  });
  if (plan === null) return { status: "already" };
  if (plan.repeat) return { status: "unknown_sender", reply: "none", alerted: 0 };

  let reply: { providerMessageId: string } | { error: string } | null = null;
  if (plan.reply && c.from) {
    try {
      reply = await deps.transport.send({
        channel: "whatsapp",
        to: c.from,
        from: c.line,
        body: plan.reply,
      });
    } catch (err) {
      reply = { error: errorCode(err) };
    }
  }
  // Says whether they were asked for their name: only a WhatsApp from a number nobody here has
  // gets the polite reply (not a text, a voicemail or a former worker), and only if it went.
  const email = unknownNumberAlertEmail(
    c.firm,
    `${portalUrl(c.firm.slug, deps.baseDomain)}/office/enquiries?view=person`,
    { askedName: reply !== null && !("error" in reply) },
  );
  let alerted = 0;
  const failures: string[] = [];
  for (const to of plan.recipients) {
    try {
      await deps.transport.send({ channel: "email", to, ...email });
      alerted += 1;
    } catch (err) {
      failures.push(errorCode(err));
    }
  }

  return run(payload.firmId, async (tx): Promise<InboundResult> => {
    if (reply && "error" in reply) {
      await recordEvent(tx, {
        actorType: "system",
        action: "message.reply_failed",
        entityType: "message",
        entityId: payload.messageId,
        data: { channel: "whatsapp", reply: "unknown_number", code: reply.error },
      });
    } else if (reply && plan.reply && c.from) {
      const [out] = await tx
        .insert(messages)
        .values({
          firmId: sql`app_current_firm_id()`,
          direction: "out",
          channel: "whatsapp",
          providerMessageId: reply.providerMessageId,
          fromE164: c.line,
          toE164: c.from,
          body: plan.reply,
          replyTo: payload.messageId,
        })
        .returning({ id: messages.id });
      await recordEvent(tx, {
        actorType: "system",
        action: "message.replied",
        entityType: "message",
        entityId: payload.messageId,
        data: { channel: "whatsapp", reply: "unknown_number", replyId: out?.id ?? null },
      });
    }
    const reason = c.formerWorkerId === null ? "unknown_number" : "former_worker";
    // An alert held by the hour's limit is said by `message.received` (alertHeld) alone.
    if (!plan.alertHeld) {
      await recordEvent(tx, {
        actorType: "system",
        // Nobody to email (no active admin or resourcer with a usable address): said so, never
        // "emailed 0 people".
        action:
          plan.recipients.length === 0
            ? "message.office_alert_skipped"
            : alerted === 0
              ? "message.office_alert_failed"
              : "message.office_alerted",
        entityType: "message",
        entityId: payload.messageId,
        data:
          plan.recipients.length === 0
            ? { reason, skipped: plan.skipped }
            : { reason, recipients: alerted, failed: failures.length, skipped: plan.skipped },
      });
    }
    return {
      status: "unknown_sender",
      reply:
        reply === null ? (plan.replyHeld ? "held" : "none") : "error" in reply ? "failed" : "sent",
      alerted,
      ...(plan.alertHeld ? { alertHeld: true as const } : {}),
    };
  });
}

// The last try (13.2). A failure before the claim (a bug, or the database failing) is thrown, and
// the queue tries again (src/worker/jobs/queues.ts: 3 more tries, 2 seconds apart). On the last
// try the message is first passed to a person, then the failure is thrown anyway: the job ends
// failed, so the ops alert for failed jobs tells Dylan (failedJobCounts(): the failure is always
// ours, unlike a firm's own webhook endpoint), and the job's log line carries the error.
// (3 more tries 2 seconds apart: about 15 seconds of waiting and polling, plus each try's own time.)
// Passed to a person: marked handled as the office's, so it waits in Need a person on Enquiries,
// with `message.received` saying why ({ answerFailed: the error's code, never its text }). Nothing
// is sent: the casual's answer comes from the office. A STOP or START text still counts: it's
// claimed as the reply job claims one (claimOptOut), without the confirmation text. A message
// someone else answered meanwhile is left as it is: the mark takes the same claim as an answer, so
// it happens at most once, and a later try finds it handled. Not covered: a worker killed in the
// middle of the last try (pg-boss counts the try when it's taken), or the mark failing too (the
// database unreachable throughout): Parking lot "Messages stranded".
export async function runInboundWithLastTry(
  payload: InboundMessagePayload,
  run: WithFirm,
  deps: InboundReplyDeps,
  attempt: JobAttempt,
): Promise<InboundResult> {
  try {
    return await runInboundMessage(payload, run, deps);
  } catch (err) {
    if (attempt.retryCount < (attempt.retryLimit ?? INBOUND_RETRY_LIMIT)) throw err;
    const code = safeCode(errorCode(err));
    try {
      const marked = await passToAPerson(payload, run, code);
      log.warn("inbound: the last try failed", {
        firmId: payload.firmId,
        messageId: payload.messageId,
        code,
        passedTo: marked,
      });
    } catch (markErr) {
      log.error("inbound: the last try failed, and so did passing it to a person", {
        firmId: payload.firmId,
        messageId: payload.messageId,
        code,
        markCode: errorCode(markErr),
        error: markErr,
      });
    }
    throw err;
  }
}

// An error's code as the log and the office see it: a Postgres SQLSTATE (5 characters) or an error
// class's name (a letter first), never anything longer or stranger (a run of digits could read as
// a phone number, which the log refuses).
const safeCode = (code: string) =>
  /^[0-9A-Z]{5}$/.test(code) || /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(code) ? code : "unknown";

async function passToAPerson(
  payload: InboundMessagePayload,
  run: WithFirm,
  code: string,
): Promise<"person" | "opt_out" | "already" | "gone"> {
  return run(payload.firmId, async (tx) => {
    if (!(await lockUnhandled(tx, payload.messageId))) return "already";
    // Only the message's own row and the number's worker: whatever failed may be in the full read.
    const [m] = await tx
      .select({
        direction: messages.direction,
        channel: messages.channel,
        from: messages.fromE164,
        body: messages.body,
        twilioOptOut: messages.twilioOptOut,
      })
      .from(messages)
      .where(eq(messages.id, payload.messageId));
    if (!m || m.direction !== "in") return "gone";
    const word = await optOutWordOf(tx, m);
    if (word && m.from) {
      const claimed = await claimOptOut(
        tx,
        payload.messageId,
        { word, byTwilio: m.twilioOptOut !== null, from: m.from },
        { answerFailed: code },
      );
      return claimed ? "opt_out" : "already";
    }
    // The worker with this number, whatever their status (one per number in a firm), as the
    // shifts line names them.
    const [worker] = m.from
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
        handledAt: new Date(),
        handledAs: "office",
        intent: "office",
        workerId: worker?.id ?? null,
      })
      .where(eq(messages.id, payload.messageId));
    await recordEvent(tx, {
      ...(worker && active ? { actorType: "worker", actorId: worker.id } : { actorType: "system" }),
      action: "message.received",
      entityType: "message",
      entityId: payload.messageId,
      data: {
        channel: m.channel,
        handledAs: "office",
        intent: "office",
        answerFailed: code,
        ...(worker ? { workerId: worker.id, ...(active ? {} : { formerWorker: true }) } : {}),
      },
    });
    return "person";
  });
}

export function inboundMessageTask(deps: () => InboundReplyDeps): FirmTask<InboundMessagePayload> {
  return {
    ...inboundMessageJob,
    task: (payload, run, attempt) => runInboundWithLastTry(payload, run, deps(), attempt),
  };
}

// The worker's wiring. The AI is Claude once AI_TRANSPORT=anthropic ("Connect the Anthropic API",
// PLAN.md Parking lot); until then `getAi` gives none, and every message no keyword matches goes
// to the office.
export const inboundMessageFirmTask = inboundMessageTask(() => {
  const env = workerEnv();
  return { transport: getTransport(env), ai: getAi(env), baseDomain: env.APP_BASE_DOMAIN };
});

// An `enquiry.checks` entry as the log will take it. Every sample passes the log's check
// (tests/unit/inbound.personal-reply.test.ts), so this only guards the unforeseen: an entry the
// check refuses keeps its ids, minutes and counts, without the checks' figures.
function settled(checks: EnquiryChecks): EnquiryChecks {
  const sample = {
    ...checks,
    sent: true,
    channel: "whatsapp",
    workerId: "00000000-0000-0000-0000-000000000000",
  };
  if (passesLogCheck(sample)) return checks;
  return {
    ...checks,
    days: [],
    area: null,
    offered: checks.offered.map((o) => ({ ...o, checks: [] })),
    notOffered: [],
    notOfferedMore: checks.notOffered.length + checks.notOfferedMore,
  };
}
