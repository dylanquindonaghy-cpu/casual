import { z } from "zod";
import { REF_PATTERN } from "../integrations/schemas";
import { verifySignature } from "../integrations/sign";
import { log, type Logger } from "../log";
import { connectorWebhookKey } from "./webhook-secret";

// A connector's webhooks in (P5.3; golden rule 3): `POST /api/webhooks/connector/{source id}`, on
// the platform address. In order, and nothing read from the database before the signature passes:
// - the source id must be a uuid (404 otherwise); INTEGRATIONS_SECRET must be set (503: no
//   secret, nothing can be checked);
// - JSON only (415), at most 16 kB (413);
// - the Standard Webhooks headers (webhook-id, webhook-timestamp, webhook-signature), signed with
//   the secret we issued this source (webhook-secret.ts), the timestamp within 5 minutes: missing
//   or wrong, 403 and nothing stored;
// - the body names what changed ({"type": "session.changed" | "staff.changed", "ref"}): anything
//   else 400 (field names logged, never values). Nothing else in it is read: the job fetches the
//   record from the source's own API (job.ts);
// - the source's firm (resolveSource): a source no firm has on now, 200 and nothing stored (it
//   needn't send it again);
// - one row per event id per source, and its job in the same transaction (receive): the same
//   event again stores and queues nothing. 200 at once either way.

export const MAX_CONNECTOR_WEBHOOK_BYTES = 16_384;
export const CONNECTOR_EVENT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,98}[A-Za-z0-9])?$/;
export const CONNECTOR_EVENT_TYPES = ["session.changed", "staff.changed"] as const;
export type ConnectorEventType = (typeof CONNECTOR_EVENT_TYPES)[number];

const uuid = z.uuid();
const bodySchema = z.object({
  type: z.enum(CONNECTOR_EVENT_TYPES),
  ref: z.string().regex(REF_PATTERN),
});

export interface ConnectorEventIn {
  sourceId: string;
  eventId: string;
  type: ConnectorEventType;
  ref: string;
}

export interface ConnectorWebhookDeps {
  secret: string | undefined; // INTEGRATIONS_SECRET
  resolveSource: (sourceId: string) => Promise<{ firmId: string } | null>;
  receive: (firmId: string, event: ConnectorEventIn) => Promise<{ stored: boolean }>;
  now: () => Date;
  logger?: Logger;
}

const answer = (status: number, text: string) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function handleConnectorWebhook(
  request: Request,
  sourceId: string,
  deps: ConnectorWebhookDeps,
): Promise<Response> {
  const logger = deps.logger ?? log;
  if (!uuid.safeParse(sourceId).success) return answer(404, "Not found");
  if (!deps.secret) return answer(503, "Not configured");
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return answer(415, "JSON only");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_CONNECTOR_WEBHOOK_BYTES) return answer(413, "Too big");
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_CONNECTOR_WEBHOOK_BYTES) return answer(413, "Too big");

  const id = request.headers.get("webhook-id") ?? "";
  const timestamp = request.headers.get("webhook-timestamp") ?? "";
  const signature = request.headers.get("webhook-signature") ?? "";
  const signed =
    CONNECTOR_EVENT_ID.test(id) &&
    verifySignature(
      connectorWebhookKey(deps.secret, sourceId),
      { id, timestamp, signature },
      raw,
      Math.floor(deps.now().getTime() / 1000),
    );
  if (!signed) {
    logger.warn("connector webhook: a missing or wrong signature", { sourceId });
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
    logger.warn("connector webhook: a body that isn't a change", { sourceId, fields });
    return answer(400, "Bad request");
  }
  const source = await deps.resolveSource(sourceId);
  if (!source) {
    logger.warn("connector webhook: a source no firm has on", { sourceId });
    return answer(200, "OK");
  }
  const { stored } = await deps.receive(source.firmId, {
    sourceId,
    eventId: id,
    type: parsed.data.type,
    ref: parsed.data.ref,
  });
  logger.info("connector webhook: received", { firmId: source.firmId, sourceId, stored });
  return answer(200, "OK");
}
