import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx, WithFirm } from "../db/scoped";
import { events, firms, magicLinks, officeUsers, workers } from "../db/schema";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, type FirmTask } from "../jobs/firm-job";
import { emailMessageId, NO_CHANNEL, sendFailureCode } from "../notify/send";
import { getTransport, type MessagingTransport } from "../messaging";
import type { OutboundMessage } from "../messaging/transport";
import {
  loginLinkMessage,
  officeLoginLinkEmail,
  workerLoginLinkEmail,
} from "../messaging/templates";
import { ownDomainUrl, portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { systemClock, type Clock } from "./clock";
import { loginChannel } from "./login-channel";
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
  // Which of the firm's addresses the request came in on: the link goes back to it, if it's still
  // the firm's verified own domain (otherwise the portal). A job queued before this existed: the
  // portal.
  address: z.enum(["portal", "own_domain"]).default("portal"),
  subjectId: z.uuid().nullable(),
});
export type SendPortalLinkPayload = z.infer<typeof sendPortalLinkPayload>;
// As queued, before the defaults (a job queued before `address` existed has none).
type QueuedPayload = z.input<typeof sendPortalLinkPayload>;

export interface SendPortalLinkDeps {
  transport: MessagingTransport;
  baseDomain: string;
  clock: Clock;
}

export type SendResult =
  | { sent: true; magicLinkId: string }
  | {
      sent: false;
      reason: "no_subject" | "inactive" | "already_sent" | "failed" | "no_channel";
    };

type LinkClaim =
  | { done: "inactive" | "already_sent" | "no_channel" }
  | { magicLinkId: string; message: OutboundMessage; ownDomain: boolean };

// (1) The claim: the link for this login request, marked sent and committed before the message goes.
async function claimLink(
  tx: FirmTx,
  payload: QueuedPayload & { subjectId: string },
  deps: SendPortalLinkDeps,
  now: Date,
): Promise<LinkClaim> {
  const office = payload.purpose === "office_login";
  // Workers get their link by WhatsApp (by email, P2.6, when there's no text sender and the firm
  // has it on: login-channel.ts); office users by email. Only while still active. The row is held
  // (FOR SHARE) until the link is stored, so access being turned off or a mobile or email changing
  // at this moment takes turns with it: either this sees the change, or the change sees this link
  // and spends it (src/lib/auth/sessions.ts endEverySession).
  const [recipient] = office
    ? await tx
        .select({ to: officeUsers.email, email: officeUsers.email })
        .from(officeUsers)
        .where(and(eq(officeUsers.id, payload.subjectId), eq(officeUsers.status, "active")))
        .for("share")
    : await tx
        .select({ to: workers.mobileE164, email: workers.email })
        .from(workers)
        .where(and(eq(workers.id, payload.subjectId), eq(workers.status, "active")))
        .for("share");
  // An active worker always has a mobile (only an erased one has none, and erasure is inactive).
  if (!recipient?.to) return { done: "inactive" };
  const [firm] = await tx
    .select({
      name: firms.name,
      slug: firms.slug,
      customDomain: firms.customDomain,
      domainVerified: firms.domainVerified,
      settings: firms.settings,
      line: firms.shiftsLineE164, // the firm's shifts line: the link goes from it
    })
    .from(firms)
    .where(eq(firms.id, payload.firmId));
  if (!firm) throw new Error("firm not visible inside its own transaction");
  // The way it goes, decided before the token is made (P2.6). The channel an earlier run's link is
  // caught up with below is this run's: the same unless the setting or the transport changed.
  const email = recipient.email;
  const channel = office
    ? "email"
    : loginChannel({ transport: deps.transport, settings: firm.settings, email });
  if (channel === null) {
    const [earlier] = await tx
      .select({ id: magicLinks.id })
      .from(magicLinks)
      .where(eq(magicLinks.requestId, payload.idempotencyKey));
    if (!earlier) {
      // Nothing can carry it (no text sender, and no email for them or the firm hasn't switched
      // login by email on): no token is made, and the miss is logged (P2.6).
      await recordEvent(tx, {
        actorType: "system",
        action: "auth.link_send_failed",
        entityType: "worker",
        entityId: payload.subjectId,
        data: { purpose: payload.purpose, channel: null, code: NO_CHANNEL },
      });
      return { done: "no_channel" };
    }
  }

  const link = await issueMagicLink(tx, {
    kind: office ? "office" : "worker",
    subjectId: payload.subjectId,
    requestId: payload.idempotencyKey,
    now,
  });
  if (!link) {
    // Sent by an earlier run of this job. If that run stopped before logging it, it's logged now
    // as sent, unconfirmed (it may have arrived), and never sent again.
    const [earlier] = await tx
      .select({ id: magicLinks.id })
      .from(magicLinks)
      .where(eq(magicLinks.requestId, payload.idempotencyKey))
      .for("update");
    if (earlier && !(await linkOutcomeLogged(tx, earlier.id))) {
      await recordEvent(tx, {
        actorType: "system",
        action: "auth.link_sent",
        entityType: "magic_link",
        entityId: earlier.id,
        data: {
          purpose: payload.purpose,
          ...(channel ? { channel } : {}),
          unconfirmed: true,
        },
      });
    }
    return { done: "already_sent" };
  }
  // Marked sent now, before the message goes: a retry then never replaces this token (it may have
  // arrived) and never sends a second link.
  await markLinkSent(tx, link.id, now);

  // Back to the firm's own domain only if that's where the request came in and it's still the
  // firm's verified one, from the firm's own record (never the request's Host, which a forger
  // controls); otherwise the portal.
  // (The verified mark is only as fresh as the last `npm run firm:domain -- --check`: a periodic
  // re-check must exist before a real firm's domain is verified, docs/testing.md "Pre-pilot
  // checklist".)
  const ownDomain =
    payload.address === "own_domain" && firm.domainVerified ? firm.customDomain : null;
  const portal = ownDomain ? ownDomainUrl(ownDomain) : portalUrl(firm.slug, deps.baseDomain);
  const voice = { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) };
  // The SMS fallback comes with Twilio.
  return {
    magicLinkId: link.id,
    ownDomain: ownDomain !== null,
    message: office
      ? {
          channel: "email",
          to: recipient.to,
          ...officeLoginLinkEmail(voice, `${portal}/office/l#${link.token}`),
        }
      : channel === "email" && email
        ? {
            channel: "email",
            to: email,
            ...workerLoginLinkEmail(voice, `${portal}/l#${link.token}`),
          }
        : {
            channel: "whatsapp",
            to: recipient.to,
            ...(firm.line ? { from: firm.line } : {}),
            body: loginLinkMessage(voice, `${portal}/l#${link.token}`),
          },
  };
}

// Whether the link's send is logged already (sent, unconfirmed, or failed).
async function linkOutcomeLogged(tx: FirmTx, linkId: string): Promise<boolean> {
  const [logged] = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        inArray(events.action, ["auth.link_sent", "auth.link_send_failed"]),
        eq(events.entityId, linkId),
      ),
    )
    .limit(1);
  return logged !== undefined;
}

// At most once, like the notices (a firm task, never a transaction held across a message): (1) the
// claim above; (2) the message, outside any transaction; (3) a second short transaction logs
// auth.link_sent, or auth.link_send_failed. A retried job finds the link already sent and sends nothing:
// the link it may already have sent still works, and someone who got nothing asks for another.
export async function sendPortalLink(
  payload: QueuedPayload,
  run: WithFirm,
  deps: SendPortalLinkDeps,
): Promise<SendResult> {
  const subjectId = payload.subjectId;
  if (!subjectId) return { sent: false, reason: "no_subject" };
  const now = deps.clock.now();
  const inFirm = <T>(fn: (tx: FirmTx) => Promise<T>) => run(payload.firmId, fn);
  const claim = await inFirm((tx) => claimLink(tx, { ...payload, subjectId }, deps, now));
  if ("done" in claim) return { sent: false, reason: claim.done };

  // (2) The link, outside any transaction.
  let sent: { providerMessageId: string } | { code: string };
  try {
    sent = await deps.transport.send(claim.message);
  } catch (err) {
    sent = { code: sendFailureCode(err) };
  }

  // (3) The outcome, logged once (a rerun may have caught it up already, as unconfirmed).
  await inFirm(async (tx) => {
    await tx
      .select({ id: magicLinks.id })
      .from(magicLinks)
      .where(eq(magicLinks.id, claim.magicLinkId))
      .for("update");
    if (await linkOutcomeLogged(tx, claim.magicLinkId)) return;
    await recordEvent(tx, {
      actorType: "system",
      action: "providerMessageId" in sent ? "auth.link_sent" : "auth.link_send_failed",
      entityType: "magic_link",
      entityId: claim.magicLinkId,
      data: {
        purpose: payload.purpose,
        channel: claim.message.channel,
        // A link on the firm's own domain says so (the portal is the default, unmarked). Not
        // "address": the log masker treats any key with that word as personal.
        ...(claim.ownDomain ? { ownDomain: true } : {}),
        // An email's id is kept as the action log takes it (its Message-ID's host refused).
        ...("providerMessageId" in sent
          ? {
              providerMessageId:
                claim.message.channel === "email"
                  ? emailMessageId(sent.providerMessageId)
                  : sent.providerMessageId,
            }
          : { code: sent.code }),
      },
    });
  });
  return "providerMessageId" in sent
    ? { sent: true, magicLinkId: claim.magicLinkId }
    : { sent: false, reason: "failed" };
}

export function createSendPortalLinkTask(
  deps: () => SendPortalLinkDeps,
): FirmTask<SendPortalLinkPayload> {
  return {
    queue: SEND_PORTAL_LINK_QUEUE,
    schema: sendPortalLinkPayload,
    task: (payload, run) => sendPortalLink(payload, run, deps()),
  };
}

// The worker's wiring. Deps are read when the job runs, so the web (which only queues the job)
// never needs the worker's configuration.
export const sendPortalLinkTask = createSendPortalLinkTask(() => {
  const env = workerEnv();
  return { transport: getTransport(env), baseDomain: env.APP_BASE_DOMAIN, clock: systemClock };
});
