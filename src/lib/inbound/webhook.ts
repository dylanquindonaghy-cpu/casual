import { z } from "zod";
import type { ResolveFirmByLine } from "../db/directory";
import { log, type Logger } from "../log";
import type { InboundWhatsApp } from "./receive";
import { isValidTwilioSignature } from "./twilio-signature";

// Twilio's WhatsApp webhook (docs/api-and-jobs.md `POST /api/webhooks/twilio/whatsapp`; golden rule
// 3): check the signature, check the fields, find the firm by the number the message was sent to,
// store one row and queue one job, and answer 200 at once with an empty TwiML reply. Replies go from
// the job (src/lib/inbound/reply.ts). Nothing from the message is logged.
// - no auth token configured: 503, nothing read or stored (Twilio isn't connected yet);
// - not a form post, or too big (by its declared length before reading, then by what arrived):
//   415 / 413;
// - a missing or wrong X-Twilio-Signature: 403;
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

// Room for a long WhatsApp (up to 4,096 characters, percent-encoded) and Twilio's other fields.
export const MAX_WEBHOOK_BYTES = 65_536;
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

const plain = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const twiml = () =>
  new Response(EMPTY_TWIML, { status: 200, headers: { "content-type": "text/xml" } });

export async function handleTwilioWhatsApp(
  request: Request,
  deps: WhatsAppWebhookDeps,
): Promise<Response> {
  const logger = deps.logger ?? log;
  if (!deps.authToken) {
    logger.warn("twilio webhook: no auth token configured");
    return plain(503, "Not configured");
  }
  if (
    !(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")
  ) {
    return plain(415, "Unsupported");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) return plain(413, "Too big");
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) return plain(413, "Too big");
  const params = new URLSearchParams(raw);
  // No prototype, so a field named "__proto__" is kept like any other (it's in the signature).
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, value] of params) {
    if (Object.hasOwn(fields, name)) return plain(400, "Bad request"); // Twilio never repeats one
    fields[name] = value;
  }
  const signature = request.headers.get("x-twilio-signature");
  if (!isValidTwilioSignature(deps.authToken, deps.webhookUrl, fields, signature)) {
    logger.warn("twilio webhook: bad signature");
    return plain(403, "Forbidden");
  }
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
