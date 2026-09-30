import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { firms, officeUsers, workers } from "../db/schema";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { defineFirmJob, firmJobEnvelope } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import { loginLinkMessage, officeLoginLinkEmail } from "../messaging/templates";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { systemClock, type Clock } from "./clock";
import { issueMagicLink, markLinkSent } from "./magic-links";

// The send-portal-link job (docs/api-and-jobs.md). The web queues it for every login request
// (workers by number, office users by email), known or not, so a request takes the same time
// and makes the same writes either way; for an unknown or inactive number or address
// (subjectId null) the job does nothing. The token is created here, in the worker, so it never
// sits in the job queue: the payload holds ids only.

export const SEND_PORTAL_LINK_QUEUE = "send-portal-link";

export const sendPortalLinkPayload = firmJobEnvelope.extend({
  idempotencyKey: z.uuid(), // the login request id
  purpose: z.enum(["worker_login", "office_login"]),
  subjectId: z.uuid().nullable(),
});
export type SendPortalLinkPayload = z.infer<typeof sendPortalLinkPayload>;

export interface SendPortalLinkDeps {
  transport: MessagingTransport;
  baseDomain: string;
  clock: Clock;
}

export type SendResult =
  | { sent: true; magicLinkId: string }
  | { sent: false; reason: "no_subject" | "inactive" | "already_sent" };

export async function sendPortalLink(
  payload: SendPortalLinkPayload,
  tx: FirmTx,
  deps: SendPortalLinkDeps,
): Promise<SendResult> {
  if (!payload.subjectId) return { sent: false, reason: "no_subject" };
  const now = deps.clock.now();
  const office = payload.purpose === "office_login";
  // Workers get their link by WhatsApp; office users by email. Only while still active.
  const [recipient] = office
    ? await tx
        .select({ to: officeUsers.email })
        .from(officeUsers)
        .where(and(eq(officeUsers.id, payload.subjectId), eq(officeUsers.status, "active")))
    : await tx
        .select({ to: workers.mobileE164 })
        .from(workers)
        .where(and(eq(workers.id, payload.subjectId), eq(workers.status, "active")));
  // An active worker always has a mobile (only an erased one has none, and erasure is inactive).
  if (!recipient?.to) return { sent: false, reason: "inactive" };
  const [firm] = await tx
    .select({
      name: firms.name,
      slug: firms.slug,
      settings: firms.settings,
      line: firms.shiftsLineE164, // the firm's shifts line: the link goes from it
    })
    .from(firms)
    .where(eq(firms.id, payload.firmId));
  if (!firm) throw new Error("firm not visible inside its own transaction");

  const link = await issueMagicLink(tx, {
    kind: office ? "office" : "worker",
    subjectId: payload.subjectId,
    requestId: payload.idempotencyKey,
    now,
  });
  if (!link) return { sent: false, reason: "already_sent" };

  const portal = portalUrl(firm.slug, deps.baseDomain);
  const voice = { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) };
  // Console transport in Phase 1; SMS fallback (Phase 4/7) and SES email (later) come after.
  const message = office
    ? {
        channel: "email" as const,
        to: recipient.to,
        ...officeLoginLinkEmail(voice, `${portal}/office/l#${link.token}`),
      }
    : {
        channel: "whatsapp" as const,
        to: recipient.to,
        ...(firm.line ? { from: firm.line } : {}),
        body: loginLinkMessage(voice, `${portal}/l#${link.token}`),
      };
  const result = await deps.transport.send(message);
  await markLinkSent(tx, link.id, now);
  await recordEvent(tx, {
    actorType: "system",
    action: "auth.link_sent",
    entityType: "magic_link",
    entityId: link.id,
    data: {
      purpose: payload.purpose,
      channel: message.channel,
      providerMessageId: result.providerMessageId,
    },
  });
  return { sent: true, magicLinkId: link.id };
}

export function createSendPortalLinkJob(deps: () => SendPortalLinkDeps) {
  return defineFirmJob({
    queue: SEND_PORTAL_LINK_QUEUE,
    schema: sendPortalLinkPayload,
    handler: (payload, tx) => sendPortalLink(payload, tx, deps()),
  });
}

// The worker's wiring. Deps are read when the job runs, so the web (which only queues the job)
// never needs the worker's configuration.
export const sendPortalLinkJob = createSendPortalLinkJob(() => {
  const env = workerEnv();
  return { transport: getTransport(env), baseDomain: env.APP_BASE_DOMAIN, clock: systemClock };
});
