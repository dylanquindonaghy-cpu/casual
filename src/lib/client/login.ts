import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  authParts,
  consumeLoginLink,
  logout,
  refreshSession,
  type AuthContext,
  type RateLimited,
} from "../auth/link-login";
import { normaliseEmail } from "../auth/office-login";
import { sendPortalLinkTask } from "../auth/send-portal-link";
import { findSession, type ActiveSession } from "../auth/sessions";
import { LIMITS, throttle } from "../auth/throttle";
import { looksLikeToken } from "../auth/tokens";
import { clientContacts } from "../db/schema";
import { recordEvent } from "../events/record";
import { sendFirmJob } from "../jobs/firm-job";

// Client logins (Phase 36.3; docs/architecture.md "Login"): a client contact types their work
// email at /client/login and gets a one-time link by email (/client/l#<token>), which starts a
// 30-day session of its own kind ('client', its own cookie: __Host-sd_client). The office login's
// rules exactly (src/lib/auth/office-login.ts): the same answer whether or not the address is
// known or switched on, links used once, within 15 minutes, stored hashed, rate-limited per
// address and per IP, used by a POST, the session's token renewed every 24 hours; the firm from the
// request's host. A contact switched off is out at their next request (findSession checks).

export type ClientRequestResult = { status: "sent" } | { status: "invalid_email" } | RateLimited;

export async function requestClientLoginLink(
  ctx: AuthContext,
  rawEmail: string,
): Promise<ClientRequestResult> {
  const email = normaliseEmail(rawEmail);
  const { now, run, secret, ip } = authParts(ctx);
  // IP first, stopping at the first refusal, as for the office.
  const limited = await throttle(
    run,
    ctx.firm.id,
    [
      { limit: LIMITS.clientLoginPerIp, value: ip },
      ...(email
        ? [
            { limit: LIMITS.clientLoginPerEmail, value: email },
            { limit: LIMITS.clientLoginPerEmailDaily, value: email },
          ]
        : []),
    ],
    { now, secret, entityType: "login_request" },
  );
  if (limited) return { status: "rate_limited", retryAfterMinutes: limited.retryAfterMinutes };
  if (!email) return { status: "invalid_email" };
  const requestId = randomUUID();
  await run(ctx.firm.id, async (tx) => {
    const [contact] = await tx
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(and(eq(clientContacts.email, email), eq(clientContacts.isOn, true)));
    await recordEvent(tx, {
      actorType: "system",
      action: "auth.link_requested",
      entityType: "login_request",
      entityId: requestId,
      data: { kind: "client", matched: Boolean(contact) },
    });
    // Queued either way (an unknown address's job does nothing): the same writes and the same time.
    await sendFirmJob(tx, sendPortalLinkTask, {
      idempotencyKey: requestId,
      purpose: "client_login",
      address: ctx.address ?? "portal",
      subjectId: contact?.id ?? null,
    });
  });
  return { status: "sent" };
}

export type ClientConsumeResult =
  | { status: "ok"; token: string; expiresAt: Date; clientContactId: string }
  | { status: "rejected" };

// "Log me in" on /client/l: the link spent, the session started (an office or worker link is
// refused here, as a client link is there).
export async function consumeClientLoginLink(
  ctx: AuthContext,
  token: string,
): Promise<ClientConsumeResult | RateLimited> {
  const r = await consumeLoginLink(ctx, "client", token);
  return r.status === "ok"
    ? { status: "ok", token: r.token, expiresAt: r.expiresAt, clientContactId: r.subjectId }
    : r;
}

export interface ClientSession {
  session: ActiveSession;
  contact: { id: string; name: string; contractId: string; contractName: string };
  firmName: string;
}

// The client contact for a session token, with their contract (null: no live session, or they've
// been switched off).
export async function currentClient(
  ctx: AuthContext,
  token: string,
): Promise<ClientSession | null> {
  if (!looksLikeToken(token)) return null;
  const { now, run } = authParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const session = await findSession(tx, { kind: "client", token, now });
    if (!session) return null;
    const { rows } = await tx.execute<{
      id: string;
      name: string;
      contract_id: string;
      contract_name: string;
      firm_name: string;
    }>(sql`
      select c.id::text as id, c.name, k.id::text as contract_id, k.name as contract_name,
             f.name as firm_name
        from client_contacts c
        join clients k on k.firm_id = c.firm_id and k.id = c.contract_id
        join firms f on f.id = c.firm_id
       where c.id = ${session.subjectId}::uuid and c.is_on
    `);
    const r = rows[0];
    if (!r) return null;
    return {
      session,
      contact: { id: r.id, name: r.name, contractId: r.contract_id, contractName: r.contract_name },
      firmName: r.firm_name,
    };
  });
}

export const refreshClientSession = (ctx: AuthContext, token: string) =>
  refreshSession(ctx, "client", token);

export const logoutClient = (ctx: AuthContext, token: string) => logout(ctx, "client", token);
