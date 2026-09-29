import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { classifyMessage } from "../ai/classify-message";
import { noAi, type AiClient } from "../ai/client";
import { firms, messages, officeUsers, requests, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { errorCode, type FirmTask } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import {
  shiftsLineReply,
  unknownNumberAlertEmail,
  unknownNumberMessage,
  type ShiftsLineReply,
} from "../messaging/templates";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { inboundMessageJob, type InboundMessagePayload } from "./job";
import { keywordIntent, type Intent } from "./keywords";

// Answering a WhatsApp on the shifts line (docs/api-and-jobs.md `inbound-message`;
// docs/messaging-templates.md "Instant replies on the shifts line"). One job per stored message
// (src/lib/inbound/receive.ts). Nothing is written before the point of no return, so a failure or a
// crash before the reply goes is simply retried; after it, the reply is never sent again:
//   1. a read: the message, the firm, the worker by the number it came from (an active worker of
//      this firm) and a keyword: cancel, pay, shifts or the office, in that order
//      (src/lib/inbound/keywords.ts). A number that isn't an active worker's: answerUnknown()
//      below (a polite reply and an office alert, once per number per 24 hours);
//   2. no keyword: the AI picks one of those four labels from the worker's text, outside any
//      transaction (src/lib/ai/classify-message.ts); no answer, a failure or anything else: the
//      office. A message with no text (a photo) goes to the office;
//   3. the claim, in one transaction: the message locked and, if no one has handled it yet, marked
//      handled (how, and what they asked); the office's `general` request (the message as its
//      note) when it's for the office; `message.received`;
//   4. the reply goes outside any transaction, from the number they wrote to, at once (a reply to
//      their own message: quiet hours don't apply);
//   5. the reply stored as an outbound message, and `message.replied`, or `message.reply_failed`
//      (never retried).
// The reply is always one of the app's fixed texts (shiftsLineReply): the AI only ever picks which,
// so nothing it writes reaches the worker, and a pay question gets the pay link, never an answer
// (golden rules 1 and 9). Events hold labels and ids, never the text or a number.

export interface InboundReplyDeps {
  transport: MessagingTransport;
  ai: AiClient;
  baseDomain: string;
  aiTimeoutMs?: number; // tests pass a short one
}

export type InboundResult =
  | { status: "replied"; intent: Intent; handledAs: "keyword" | "ai" | "office" }
  | { status: "reply_failed"; intent: Intent; code: string }
  | {
      status: "unknown_sender";
      reply: "sent" | "failed" | "none"; // the polite reply (none: a former worker, or a repeat)
      alerted: number; // office users emailed
    }
  | { status: "already" }
  | { status: "gone" };

const OFFICE_NOTE_MAX = 500;
const NO_TEXT_NOTE = "(A photo or file, with no text.)";

type Read =
  | { kind: "done"; result: InboundResult }
  | {
      kind: "unknown";
      from: string;
      line: string;
      formerWorkerId: string | null; // the number is a worker's here who isn't active
      firm: { name: string; slug: string; signOff: string };
    }
  | {
      kind: "known";
      workerId: string;
      mobile: string;
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
      handledAt: messages.handledAt,
      from: messages.fromE164,
      to: messages.toE164,
      body: messages.body,
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
  const [worker] = await tx
    .select({ id: workers.id })
    .from(workers)
    .where(and(eq(workers.mobileE164, m.from), eq(workers.status, "active")))
    .limit(1);
  const voice = {
    name: firm.name,
    slug: firm.slug,
    signOff: signOffFor(firm.name, firm.settings.sign_off),
  };
  if (!worker) {
    const [former] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(eq(workers.mobileE164, m.from))
      .limit(1);
    return {
      kind: "unknown",
      from: m.from,
      line: m.to,
      formerWorkerId: former?.id ?? null,
      firm: voice,
    };
  }
  return {
    kind: "known",
    workerId: worker.id,
    mobile: m.from,
    line: m.to,
    body: m.body,
    keyword: m.body ? keywordIntent(m.body) : null,
    firm: {
      name: firm.name,
      slug: firm.slug,
      signOff: signOffFor(firm.name, firm.settings.sign_off),
    },
  };
}

// Locks the message: true if this run is the one handling it (nobody has yet).
async function lockUnhandled(tx: FirmTx, messageId: string): Promise<boolean> {
  const [m] = await tx
    .select({ handledAt: messages.handledAt })
    .from(messages)
    .where(eq(messages.id, messageId))
    .for("update");
  return m !== undefined && m.handledAt === null;
}

export async function runInboundMessage(
  payload: InboundMessagePayload,
  run: WithFirm,
  deps: InboundReplyDeps,
): Promise<InboundResult> {
  const c = await run(payload.firmId, (tx) => read(tx, payload.messageId));
  if (c.kind === "done") return c.result;
  if (c.kind === "unknown") return answerUnknown(payload, run, deps, c);

  // Step 2: what they asked: a keyword, else the AI's label (outside any transaction), else the
  // office.
  let intent: Intent;
  let handledAs: "keyword" | "ai" | "office";
  if (c.keyword) {
    intent = c.keyword;
    handledAs = "keyword";
  } else {
    const picked = c.body
      ? await classifyMessage(c.body, deps.ai, { timeoutMs: deps.aiTimeoutMs })
      : null;
    intent = picked ?? "office";
    handledAs = picked ? "ai" : "office";
  }

  // Step 3: the claim, the office's request and the event, together.
  const portal = portalUrl(c.firm.slug, deps.baseDomain);
  const replyText = await run(payload.firmId, async (tx): Promise<string | null> => {
    if (!(await lockUnhandled(tx, payload.messageId))) return null;
    let reply: ShiftsLineReply;
    if (intent === "office") {
      const [request] = await tx
        .insert(requests)
        .values({
          firmId: sql`app_current_firm_id()`,
          workerId: c.workerId,
          type: "general",
          payload: {
            note: c.body ? c.body.slice(0, OFFICE_NOTE_MAX) : NO_TEXT_NOTE,
            via: "whatsapp",
            messageId: payload.messageId,
          },
        })
        .returning({ id: requests.id });
      if (!request) throw new Error("request insert returned nothing");
      await recordEvent(tx, {
        actorType: "worker",
        actorId: c.workerId,
        action: "request.created",
        entityType: "request",
        entityId: request.id,
        data: { type: "general", shiftId: null, via: "whatsapp", workerId: c.workerId },
      });
      reply = { intent: "office", ref: request.id.slice(0, 8).toUpperCase() };
    } else {
      const path = intent === "shifts" ? "/shifts/open" : intent === "pay" ? "/pay" : "/";
      reply = { intent, link: `${portal}${path}` };
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
      data: { channel: "whatsapp", handledAs, intent, workerId: c.workerId },
    });
    return shiftsLineReply({ name: c.firm.name, signOff: c.firm.signOff }, reply);
  });
  if (replyText === null) return { status: "already" };

  let sent: { providerMessageId: string } | { error: string };
  try {
    sent = await deps.transport.send({
      channel: "whatsapp",
      to: c.mobile,
      from: c.line,
      body: replyText,
    });
  } catch (err) {
    sent = { error: errorCode(err) };
  }

  return run(payload.firmId, async (tx): Promise<InboundResult> => {
    if ("error" in sent) {
      await recordEvent(tx, {
        actorType: "system",
        action: "message.reply_failed",
        entityType: "message",
        entityId: payload.messageId,
        data: { channel: "whatsapp", intent, workerId: c.workerId, code: sent.error },
      });
      return { status: "reply_failed", intent, code: sent.error };
    }
    const [out] = await tx
      .insert(messages)
      .values({
        firmId: sql`app_current_firm_id()`,
        direction: "out",
        channel: "whatsapp",
        providerMessageId: sent.providerMessageId,
        workerId: c.workerId,
        fromE164: c.line,
        toE164: c.mobile,
        body: replyText,
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
        channel: "whatsapp",
        intent,
        workerId: c.workerId,
        // The provider's id is on the stored reply (replyId), not here: a Twilio id with a long
        // run of digits looks like a phone number to the log's masker.
        replyId: out?.id ?? null,
      },
    });
    return { status: "replied", intent, handledAs };
  });
}

// Someone who isn't one of the firm's active workers (docs/messaging-templates.md
// `unknown_number`, `unknown_number_alert`). Only the first message from a number in 24 hours gets
// the polite reply and alerts the office: later ones are stored and shown on Today, so an
// auto-reply or a bot can't loop and the office gets one email, not one per message. A former
// worker (their number is on file, not active) gets no "we don't recognise this number" (we do):
// the office is alerted and decides. Same shape as the known path: the claim, then the sends
// outside any transaction, then the record. The alert email holds neither the number nor the
// message: they're on Today.
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
      sql`select pg_advisory_xact_lock(hashtextextended('unknown-number:' || app_current_firm_id()::text || ':' || ${c.from}, 0))`,
    );
    // A repeat: this number's last answered message (a first one: logged with repeat false) was
    // under 24 hours ago. So a number gets at most one reply and one alert in any 24 hours, and
    // writing every day still brings one a day.
    const { rows: earlier } = await tx.execute(sql`
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
        channel: "whatsapp",
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
      reply: c.formerWorkerId === null ? unknownNumberMessage(c.firm) : null,
      recipients,
      skipped: office.length - recipients.length,
    };
  });
  if (plan === null) return { status: "already" };
  if (plan.repeat) return { status: "unknown_sender", reply: "none", alerted: 0 };

  let reply: { providerMessageId: string } | { error: string } | null = null;
  if (plan.reply) {
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
  const email = unknownNumberAlertEmail(
    c.firm,
    `${portalUrl(c.firm.slug, deps.baseDomain)}/office`,
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
    } else if (reply && plan.reply) {
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

// The worker's wiring. No AI yet: "Connect Bedrock" (PLAN.md Parking lot) replaces `noAi`, and
// until then every message no keyword matches goes to the office.
export const inboundMessageFirmTask = inboundMessageTask(() => {
  const env = workerEnv();
  return { transport: getTransport(env), ai: noAi, baseDomain: env.APP_BASE_DOMAIN };
});
