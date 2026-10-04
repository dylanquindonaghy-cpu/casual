import { sql } from "drizzle-orm";
import { z } from "zod";
import type { FirmDirectoryEntry, ResolveFirmByLine } from "../db/directory";
import { messages } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { errorCode } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import {
  CALL_FALLBACK_END,
  CALL_GOODBYE,
  CALL_NOT_IN_USE,
  callFallbackGreeting,
  callGreeting,
  type CallLink,
} from "../messaging/templates";
import { queueInboundMessage } from "./job";
import { plainResponse, readTwilioRequest } from "./twilio-request";

// Call-to-text (docs/api-and-jobs.md `POST /api/webhooks/twilio/voice…`; docs/architecture.md
// "Call-to-text"). Someone rings the firm's shifts line:
// - the voice webhook finds the firm by the number called, stores the call once (a `messages` row,
//   channel voice, Twilio's CallSid, a withheld number's too: a repeat of the same call does
//   nothing more), logs `call.received`, and asks for the caller's login link as the login page
//   does (the same throttle and the same answer for any number: a worker's number gets their link
//   by message, any other number nothing; on the firm's portal address, as a call comes in on
//   neither of its web addresses). Its answer is TwiML: the doc's spoken message (no
//   link promised when the number is withheld, or when the login limits stopped it or asking
//   failed), then a voicemail (<Record transcribe>, 2 minutes at most) and hang up;
// - the transcription webhook stores the voicemail's text once (the RecordingSid) and queues the
//   inbound-message job, which makes it a request for the office (src/lib/inbound/reply.ts);
// - the "done" webhook answers <Record>'s action with a goodbye.
// Every webhook checks Twilio's signature for its own address (src/lib/inbound/twilio-request.ts).
// Nothing from a call is logged; Twilio's ids stay out of events (a long run of digits in one looks
// like a phone number to the masker).

export interface VoiceWebhookDeps {
  authToken: string | undefined;
  voiceUrl: string; // this webhook's address, as Twilio was given it
  transcriptionUrl: string; // the transcription webhook's address (in the TwiML)
  doneUrl: string; // <Record>'s action
  resolveFirmByLine: ResolveFirmByLine;
  // The login page's own request (requestWorkerLoginLink): throttled, the same for any number.
  requestLink: (firm: FirmDirectoryEntry, mobile: string) => Promise<{ status: string }>;
  run?: WithFirm;
  logger?: Logger;
}

export const VOICEMAIL_MAX_SECONDS = 120;

const e164 = /^\+[1-9]\d{6,14}$/;
// What Twilio puts in From when the caller ID is hidden ("anonymous", or one of its placeholder
// numbers for ANONYMOUS, RESTRICTED, UNKNOWN, BLOCKED and UNAVAILABLE: check against Twilio's docs
// when connecting). Treated as withheld: no link, and never matched to earlier messages.
const HIDDEN_CALLER_IDS = new Set([
  "+266696687",
  "+7378742833",
  "+8656696",
  "+2562533",
  "+86282452253",
]);
const callerNumber = (from: string | undefined): string | null =>
  from && e164.test(from) && !HIDDEN_CALLER_IDS.has(from) ? from : null;
const callFields = z.object({
  CallSid: z.string().regex(/^CA[0-9a-f]{32}$/),
  From: z.string().max(40).optional(), // "anonymous" (or missing) when withheld
  To: z.string().regex(e164),
});

const xml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function twiml(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
}

const say = (text: string) => `<Say language="en-GB">${xml(text)}</Say>`;

// The spoken message, the voicemail, then hang up (<Record>'s action says goodbye first).
export function callTwiml(
  firm: { name: string; signOff: string },
  opts: { link: CallLink; transcriptionUrl: string; doneUrl: string },
): string {
  return (
    say(callGreeting(firm, opts.link)) +
    `<Record maxLength="${VOICEMAIL_MAX_SECONDS}" playBeep="true" timeout="5" transcribe="true"` +
    ` transcribeCallback="${xml(opts.transcriptionUrl)}" action="${xml(opts.doneUrl)}"/>` +
    "<Hangup/>"
  );
}

// Twilio's fallback for a firm's number (Phase 8): the TwiML to paste into a TwiML Bin, which
// Twilio serves itself when our voice webhook doesn't answer (the app down or too slow): why, then
// the manager's phone for up to 30 seconds (their own voicemail usually answers first), then the
// closing line. `npm run firm:call-fallback` prints it.
export function callFallbackTwiml(firm: { name: string }, managerE164: string): string {
  if (!e164.test(managerE164)) throw new Error("the manager's phone must be an E.164 number");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    say(callFallbackGreeting(firm)) +
    `<Dial timeout="30">${managerE164}</Dial>` +
    say(CALL_FALLBACK_END) +
    "<Hangup/></Response>"
  );
}

export async function handleTwilioVoice(
  request: Request,
  deps: VoiceWebhookDeps,
): Promise<Response> {
  const logger = deps.logger ?? log;
  const read = await readTwilioRequest(request, {
    authToken: deps.authToken,
    webhookUrl: deps.voiceUrl,
    logger,
  });
  if (!read.ok) return read.response;
  const parsed = callFields.safeParse(read.fields);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "?")))];
    logger.warn("twilio voice webhook: fields that aren't a call", { fields: names });
    return plainResponse(400, "Bad request");
  }
  const firm = await deps.resolveFirmByLine(parsed.data.To);
  if (!firm) return twiml(`${say(CALL_NOT_IN_USE)}<Hangup/>`);
  const from = callerNumber(parsed.data.From);

  const run = deps.run ?? withFirm;
  // The call, once (by its CallSid; a withheld number's is stored without one): its id when this
  // is the first delivery, null for a repeat.
  const callId = await run(firm.id, async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        firmId: sql`app_current_firm_id()`,
        direction: "in",
        channel: "voice",
        providerMessageId: parsed.data.CallSid,
        fromE164: from,
        toE164: parsed.data.To,
        body: null,
        handledAt: new Date(), // a call itself needs no reply job
      })
      .onConflictDoNothing({ target: [messages.firmId, messages.providerMessageId] })
      .returning({ id: messages.id });
    if (!row) return null;
    // Whether the link was asked for; the login flow logs what came of it (auth.link_requested,
    // or auth.rate_limited).
    await recordEvent(tx, {
      actorType: "system",
      action: "call.received",
      entityType: "call",
      entityId: row.id,
      data: { linkRequested: from !== null, withheld: from === null },
    });
    return row.id;
  });

  // The link. The first delivery asks for it and logs what the caller was told (call.answered
  // {link}); a repeat of the call asks nothing again and says the same (audit L28: it used to say
  // "sent" even when the first said "not now"). A repeat that finds no answer logged (the first is
  // still running, or stopped part-way) can't promise a link: "not now".
  let link: CallLink = "withheld";
  if (from && callId) {
    link = "sent";
    try {
      if ((await deps.requestLink(firm, from)).status !== "sent") link = "not_now";
    } catch (err) {
      // The call is still answered and the voicemail still taken; Twilio isn't asked to retry.
      logger.error("twilio voice webhook: asking for the link failed", {
        firmId: firm.id,
        code: errorCode(err),
      });
      link = "not_now";
    }
    const told = link;
    try {
      await run(firm.id, (tx) =>
        recordEvent(tx, {
          actorType: "system",
          action: "call.answered",
          entityType: "call",
          entityId: callId,
          data: { link: told },
        }),
      );
    } catch (err) {
      // Still answered; a repeat of this call would then say "not now".
      logger.error("twilio voice webhook: logging the answer failed", {
        firmId: firm.id,
        code: errorCode(err),
      });
    }
  } else if (from) {
    link = await run(firm.id, async (tx) => {
      const { rows } = await tx.execute<{ link: string }>(sql`
        select e.data ->> 'link' as link from events e
          join messages m on m.firm_id = e.firm_id and m.id = e.entity_id
         where m.provider_message_id = ${parsed.data.CallSid} and m.channel = 'voice'
           and e.action = 'call.answered'
         order by e.id
         limit 1
      `);
      return rows[0]?.link === "sent" ? "sent" : "not_now";
    });
  }
  logger.info("twilio voice webhook: call", { firmId: firm.id, repeat: callId === null });
  return twiml(
    callTwiml(firm, { link, transcriptionUrl: deps.transcriptionUrl, doneUrl: deps.doneUrl }),
  );
}

const transcriptionFields = z.object({
  CallSid: z.string().regex(/^CA[0-9a-f]{32}$/),
  RecordingSid: z.string().regex(/^RE[0-9a-f]{32}$/),
  TranscriptionStatus: z.string().max(20),
  TranscriptionText: z.string().optional(),
  From: z.string().max(40).optional(),
  To: z.string().regex(e164),
});

export interface TranscriptionWebhookDeps {
  authToken: string | undefined;
  webhookUrl: string;
  resolveFirmByLine: ResolveFirmByLine;
  run?: WithFirm;
  logger?: Logger;
}

// The voicemail's text (or none, when Twilio couldn't make any), stored once and handed to the
// reply job. 200 with nothing to say.
export async function handleTwilioTranscription(
  request: Request,
  deps: TranscriptionWebhookDeps,
): Promise<Response> {
  const logger = deps.logger ?? log;
  const read = await readTwilioRequest(request, {
    authToken: deps.authToken,
    webhookUrl: deps.webhookUrl,
    logger,
  });
  if (!read.ok) return read.response;
  const parsed = transcriptionFields.safeParse(read.fields);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "?")))];
    logger.warn("twilio transcription webhook: fields that aren't a voicemail", { fields: names });
    return plainResponse(400, "Bad request");
  }
  const firm = await deps.resolveFirmByLine(parsed.data.To);
  if (!firm) return twiml("");
  const from = callerNumber(parsed.data.From);
  const text =
    parsed.data.TranscriptionStatus === "completed" && parsed.data.TranscriptionText?.trim()
      ? parsed.data.TranscriptionText.slice(0, 1600)
      : null;
  const stored = await (deps.run ?? withFirm)(firm.id, async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        firmId: sql`app_current_firm_id()`,
        direction: "in",
        channel: "voice",
        providerMessageId: parsed.data.RecordingSid,
        fromE164: from,
        toE164: parsed.data.To,
        body: text,
      })
      .onConflictDoNothing({ target: [messages.firmId, messages.providerMessageId] })
      .returning({ id: messages.id });
    if (!row) return false;
    await queueInboundMessage(tx, row.id);
    return true;
  });
  logger.info("twilio transcription webhook: voicemail", { firmId: firm.id, stored });
  return twiml("");
}

// <Record>'s action: the voicemail is in; say goodbye and hang up.
export async function handleTwilioVoiceDone(
  request: Request,
  deps: { authToken: string | undefined; webhookUrl: string; logger?: Logger },
): Promise<Response> {
  const read = await readTwilioRequest(request, {
    authToken: deps.authToken,
    webhookUrl: deps.webhookUrl,
    logger: deps.logger ?? log,
  });
  if (!read.ok) return read.response;
  return twiml(`${say(CALL_GOODBYE)}<Hangup/>`);
}
