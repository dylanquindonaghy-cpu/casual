import { createHash } from "node:crypto";
import { z } from "zod";
import type { FirmDirectoryEntry } from "../db/directory";
import { readBoundedBody, strictUtf8 } from "../http/bounded-body";
import { verifySignature } from "../integrations/sign";
import { log, type Logger } from "../log";
import { emailAddress } from "./address";
import type { InboundEmail } from "./receive";

// The staffing inbox's webhook in (P7.2; golden rule 3): `POST /api/webhooks/email`, from the
// firm's email provider (the made-up one until it's chosen: its ADR), on the platform address. In
// order, and nothing read from the database before the signature passes:
// - EMAIL_INBOUND_SECRET must be set (503: no secret, nothing can be checked);
// - JSON only (415), at most 512 kB (413), UTF-8 (400);
// - the Standard Webhooks headers (webhook-id, webhook-timestamp, webhook-signature), signed with
//   that secret, the timestamp within 5 minutes: missing or wrong, 403 and nothing stored;
// - the body is an email: anything else 400 (field names logged, never values). The made-up
//   provider's contract, which the real one's adapter keeps to:
//   - `to`: the envelope recipients, who the provider delivered it to. With the firm's mailbox
//     forwarding (a mailbox-level forward or a "Redirect" rule, which keep the sender: never an
//     inbox rule's "Forward", which sends it from the firm's own mailbox), that's the firm's
//     inbox address, not the To header (which still names the firm's own mailbox);
//   - `from`: the sender's address; `authenticated`: the provider's word that it passed DMARC (or
//     DKIM aligned with it), so it isn't someone else's address put in. Without that, the email
//     is nobody's: who wrote is kept, never the words (receive.ts);
//   - `attachments`: their details only (never the files): how many is all that's kept;
//   - `message_id`: the email's Message-ID. Missing or unusable, a stand-in that the same email
//     sent again repeats (a hash of it, or the webhook's own id);
//   - `subject` and `text` of any length up to the body's limit: cut, never refused;
// - each firm whose inbox it was sent to (resolveFirmByInbox; several firms, a row each), and a
//   sender address that can be read: neither, 200 and nothing stored (it needn't be sent again);
// - one row per Message-ID in each firm (receive.ts): the same email again stores nothing. 200 at
//   once either way. Nothing of the email is logged: codes and counts only.

export const MAX_EMAIL_WEBHOOK_BYTES = 512 * 1024;
const WEBHOOK_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const MESSAGE_ID = /^[!-~]{1,250}$/;
const MAX_RECIPIENTS = 50; // the first ones looked at; any more aren't

const bodySchema = z.object({
  message_id: z.string().nullable().optional(),
  from: z.string(),
  to: z.union([z.string(), z.array(z.string()).min(1)]),
  authenticated: z.boolean().optional(),
  subject: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  attachments: z.array(z.unknown()).optional(),
});

// The Message-ID as stored: as sent when it's usable, else a stand-in the same email repeats.
function messageIdOf(raw: string | null | undefined, webhookId: string): string {
  const id = raw?.trim() ?? "";
  if (MESSAGE_ID.test(id)) return id;
  if (id !== "") return `sha256:${createHash("sha256").update(id).digest("hex")}`;
  return `webhook:${webhookId}`;
}

export interface EmailWebhookDeps {
  secret: string | undefined; // EMAIL_INBOUND_SECRET
  resolveFirmByInbox: (address: string) => Promise<FirmDirectoryEntry | null>;
  receive: (firmId: string, email: InboundEmail) => Promise<{ stored: boolean }>;
  now: () => Date;
  logger?: Logger;
}

const answer = (status: number, text: string) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

// A Standard Webhooks secret: "whsec_" and the key in base64.
const keyOf = (secret: string) => Buffer.from(secret.slice("whsec_".length), "base64");

export async function handleEmailWebhook(
  request: Request,
  deps: EmailWebhookDeps,
): Promise<Response> {
  const logger = deps.logger ?? log;
  if (!deps.secret) return answer(503, "Not configured");
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return answer(415, "JSON only");
  const read = await readBoundedBody(request, MAX_EMAIL_WEBHOOK_BYTES);
  if ("tooBig" in read) return answer(413, "Too big");
  const raw = strictUtf8(read.bytes);
  if (raw === null) return answer(400, "Bad request");

  const id = request.headers.get("webhook-id") ?? "";
  const timestamp = request.headers.get("webhook-timestamp") ?? "";
  const signature = request.headers.get("webhook-signature") ?? "";
  const signed =
    WEBHOOK_ID.test(id) &&
    verifySignature(
      keyOf(deps.secret),
      { id, timestamp, signature },
      raw,
      Math.floor(deps.now().getTime() / 1000),
    );
  if (!signed) {
    logger.warn("email webhook: a missing or wrong signature");
    return answer(403, "Forbidden");
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return answer(400, "Bad request");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "?")))];
    logger.warn("email webhook: a body that isn't an email", { fields });
    return answer(400, "Bad request");
  }
  const body = parsed.data;
  // Each firm whose inbox it was sent to, once.
  const firms = new Map<string, string>(); // firm id -> its inbox
  for (const candidate of (Array.isArray(body.to) ? body.to : [body.to]).slice(0, MAX_RECIPIENTS)) {
    const to = emailAddress(candidate);
    const entry = to ? await deps.resolveFirmByInbox(to) : null;
    if (entry && to && !firms.has(entry.id)) firms.set(entry.id, to);
  }
  if (firms.size === 0) {
    logger.warn("email webhook: sent to no firm's inbox");
    return answer(200, "OK");
  }
  const from = emailAddress(body.from);
  if (!from) {
    logger.warn("email webhook: a sender that can't be read", { firms: firms.size });
    return answer(200, "OK");
  }
  for (const [firmId, to] of firms) {
    const { stored } = await deps.receive(firmId, {
      messageId: messageIdOf(body.message_id, id),
      from,
      authenticated: body.authenticated === true,
      to,
      subject: body.subject ?? null,
      text: body.text ?? null,
      attachments: body.attachments?.length ?? 0,
    });
    logger.info("email webhook: received", { firmId, stored });
  }
  return answer(200, "OK");
}
