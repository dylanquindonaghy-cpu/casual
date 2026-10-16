import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getAi } from "../ai/anthropic";
import { sortMessage, type AiFallback } from "../ai/classify-message";
import type { AiClient } from "../ai/client";
import { firms, messages, officeUsers, requests, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { passesLogCheck, recordEvent } from "../events/record";
import { errorCode, type FirmTask } from "../jobs/firm-job";
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
import { inboundMessageJob, type InboundMessagePayload } from "./job";
import { keywordIntent, type Intent } from "./keywords";
import { answerOptOut, smsOptOutWord, type OptOutRead, type OptOutResult } from "./opt-out";
import { cancelReply, shiftsReply, type EnquiryChecks } from "./personal-reply";

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
// The reply is always one of the app's fixed texts (shiftsLineReply, voicemailReceivedMessage): the
// AI only ever picks which, so nothing it writes reaches the worker, and a pay question gets the
// pay link, never an answer (golden rules 1 and 9). Events hold labels and ids, never the text or a number.

export interface InboundReplyDeps {
  transport: MessagingTransport;
  ai: AiClient;
  baseDomain: string;
  aiTimeoutMs?: number; // tests pass a short one
  clock?: Clock; // tests pass a fixed one (the personal reply's "now")
}

export type InboundResult =
  | { status: "replied"; intent: Intent; handledAs: "keyword" | "ai" | "office" }
  | { status: "reply_failed"; intent: Intent; code: string }
  | {
      status: "unknown_sender";
      reply: "sent" | "failed" | "none"; // the polite reply (none: a former worker, or a repeat)
      alerted: number; // office users emailed
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
  // A text saying only STOP or START (or one Twilio's own opt-out handling acted on).
  if (m.channel === "sms" && from) {
    const ours = smsOptOutWord(m.body);
    let word = m.twilioOptOut ?? ours;
    // YES, or anything else Twilio calls START: only for a number with texts off.
    if (word === "yes" || (word === "start" && ours !== "start")) {
      const [off] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(and(eq(workers.mobileE164, from), isNotNull(workers.smsOptedOutAt)));
      word = off ? "start" : null;
    }
    if (word) {
      return {
        kind: "opt_out",
        word,
        byTwilio: m.twilioOptOut !== null,
        from,
        line: m.to,
        firm: { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) },
      };
    }
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

  // Step 2b: the personal reply to "shifts" or "cancel" (src/lib/inbound/personal-reply.ts), read
  // before the claim like the AI's label: built by code from the firm's data, never by the AI.
  const portal = portalUrl(c.firm.slug, deps.baseDomain);
  const now = (deps.clock ?? systemClock).now();
  const voiceOf = { name: c.firm.name, signOff: c.firm.signOff };
  const personal =
    intent === "shifts"
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
            // would fail the job on every try and lose the message (12L.1 guardrails review).
            note: c.body
              ? [...c.body].slice(0, OFFICE_NOTE_MAX).join("")
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
        workerId: c.workerId,
      },
    });
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
// message: they're on Enquiries.
async function answerUnknown(
  payload: InboundMessagePayload,
  run: WithFirm,
  deps: InboundReplyDeps,
  c: Extract<Read, { kind: "unknown" }>,
): Promise<InboundResult> {
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
      },
    });
    if (repeat) return { repeat, reply: null, recipients: [] as string[], skipped: 0 };
    const office = await tx
      .select({ email: officeUsers.email })
      .from(officeUsers)
      .where(
        and(eq(officeUsers.status, "active"), inArray(officeUsers.role, ["admin", "resourcer"])),
      )
      .orderBy(asc(officeUsers.email));
    const recipients = office
      .map((o) => o.email)
      .filter((email) => z.email().safeParse(email).success);
    return {
      repeat,
      // Only a WhatsApp from a number nobody here has gets the polite reply (we don't message
      // callers we don't know).
      reply:
        c.channel === "whatsapp" && c.from !== null && c.formerWorkerId === null
          ? unknownNumberMessage(c.firm)
          : null,
      recipients,
      skipped: office.length - recipients.length,
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
    return {
      status: "unknown_sender",
      reply: reply === null ? "none" : "error" in reply ? "failed" : "sent",
      alerted,
    };
  });
}

export function inboundMessageTask(deps: () => InboundReplyDeps): FirmTask<InboundMessagePayload> {
  return { ...inboundMessageJob, task: (payload, run) => runInboundMessage(payload, run, deps()) };
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
