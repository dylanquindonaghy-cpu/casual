import { z } from "zod";
import type { ResolveFirmByLine } from "../db/directory";
import { log, type Logger } from "../log";
import type { InboundWhatsApp } from "./receive";
import { plainResponse as plain, readTwilioRequest } from "./twilio-request";

export { MAX_WEBHOOK_BYTES } from "./twilio-request";

// Twilio's WhatsApp webhook (docs/api-and-jobs.md `POST /api/webhooks/twilio/whatsapp`; golden rule
// 3): check the signature, check the fields, find the firm by the number the message was sent to,
// store one row and queue one job, and answer 200 at once with an empty TwiML reply. Replies go from
// the job (src/lib/inbound/reply.ts). Nothing from the message is logged.
// - the checks every Twilio webhook makes (src/lib/inbound/twilio-request.ts): no auth token 503,
//   not a form post or too big 415 / 413, a repeated field 400, a missing or wrong signature 403;
// - fields that aren't a WhatsApp message: 400 (the failing field names are logged, never values);
//   a text longer than we store (1,600 characters) is kept, cut to size;
// - a number no firm has: 200 and nothing stored (Twilio needn't retry).

export interface WhatsAppWebhookDeps {
  authToken: string | undefined;
  webhookUrl: string; // the address Twilio was given for this webhook (the signature covers it)
  resolveFirmByLine: ResolveFirmByLine;
  receive: (firmId: string, message: InboundWhatsApp) => Promise<{ stored: boolean }>;
  logger?: Logger;
}

const MAX_BODY_CHARS = 1600;
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const e164 = /^\+[1-9]\d{6,14}$/;
const whatsappNumber = z
  .string()
  .regex(/^whatsapp:\+[1-9]\d{6,14}$/)
  .transform((v) => v.slice("whatsapp:".length));

const fieldsSchema = z.object({
  MessageSid: z.string().regex(/^(SM|MM)[0-9a-f]{32}$/),
  From: whatsappNumber,
  To: whatsappNumber,
  Body: z.string().optional(),
});

const twiml = () =>
  new Response(EMPTY_TWIML, { status: 200, headers: { "content-type": "text/xml" } });

export async function handleTwilioWhatsApp(
  request: Request,
  deps: WhatsAppWebhookDeps,
): Promise<Response> {
  const logger = deps.logger ?? log;
  const read = await readTwilioRequest(request, {
    authToken: deps.authToken,
    webhookUrl: deps.webhookUrl,
    logger,
  });
  if (!read.ok) return read.response;
  const fields = read.fields;
  const parsed = fieldsSchema.safeParse({ ...fields });
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "?")))];
    logger.warn("twilio webhook: fields that aren't a WhatsApp message", { fields: names });
    return plain(400, "Bad request");
  }
  if (!e164.test(parsed.data.To)) return plain(400, "Bad request");
  const firm = await deps.resolveFirmByLine(parsed.data.To);
  if (!firm) {
    logger.warn("twilio webhook: a number no firm has");
    return twiml();
  }
  const body = parsed.data.Body?.trim() ? parsed.data.Body.slice(0, MAX_BODY_CHARS) : null;
  const { stored } = await deps.receive(firm.id, {
    messageSid: parsed.data.MessageSid,
    from: parsed.data.From,
    to: parsed.data.To,
    body,
  });
  logger.info("twilio webhook: whatsapp received", { firmId: firm.id, stored });
  return twiml();
}
