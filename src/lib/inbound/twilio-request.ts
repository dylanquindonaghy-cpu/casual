import type { Logger } from "../log";
import { isValidTwilioSignature } from "./twilio-signature";

// The checks every Twilio webhook makes before reading anything from it (docs/api-and-jobs.md;
// golden rule 3). Nothing from the request is logged.
// - no auth token configured: 503 (Twilio isn't connected yet);
// - not a form post, or too big (by its declared length before reading, then by what arrived):
//   415 / 413;
// - a field sent twice (Twilio never does): 400;
// - a missing or wrong X-Twilio-Signature for this webhook's own address: 403.
// Otherwise the form's fields (no prototype, so a "__proto__" field is kept like any other: it's in
// the signature).

// Room for a long WhatsApp (up to 4,096 characters, percent-encoded) and Twilio's other fields.
export const MAX_WEBHOOK_BYTES = 65_536;

export type TwilioRequest =
  { ok: true; fields: Record<string, string> } | { ok: false; response: Response };

export const plainResponse = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function readTwilioRequest(
  request: Request,
  opts: { authToken: string | undefined; webhookUrl: string; logger: Logger },
): Promise<TwilioRequest> {
  const refuse = (status: number, body: string): TwilioRequest => ({
    ok: false,
    response: plainResponse(status, body),
  });
  if (!opts.authToken) {
    opts.logger.warn("twilio webhook: no auth token configured");
    return refuse(503, "Not configured");
  }
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) return refuse(415, "Unsupported");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) return refuse(413, "Too big");
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) return refuse(413, "Too big");
  const fields = Object.create(null) as Record<string, string>;
  for (const [name, value] of new URLSearchParams(raw)) {
    if (Object.hasOwn(fields, name)) return refuse(400, "Bad request");
    fields[name] = value;
  }
  const signature = request.headers.get("x-twilio-signature");
  if (!isValidTwilioSignature(opts.authToken, opts.webhookUrl, fields, signature)) {
    opts.logger.warn("twilio webhook: bad signature");
    return refuse(403, "Forbidden");
  }
  return { ok: true, fields: { ...fields } };
}
