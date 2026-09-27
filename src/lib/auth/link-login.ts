import { withFirm, type FirmTx, type WithFirm } from "../db/scoped";
import { appEnv } from "../env";
import { recordEvent } from "../events/record";
import { systemClock, type Clock } from "./clock";
import { retireOtherLinks, spendMagicLink, whyRejected } from "./magic-links";
import {
  createSession,
  endSession,
  findSession,
  rotateSession,
  type ActiveSession,
  type SubjectKind,
} from "./sessions";
import { hitLimit, LIMITS, logLimitReached, peekLimit, toMinutes } from "./throttle";
import { looksLikeToken } from "./tokens";

// The parts of link login that workers and office users share (docs/architecture.md, Login):
// spending a one-time link, starting a session, looking it up, rotating it, ending it. Each
// kind's own module (worker-login.ts, office-login.ts) adds how links are asked for. The firm
// always comes from the request's host.

export interface AuthContext {
  firm: { id: string };
  clientIp?: string; // from X-Real-IP (set by Caddy); "unknown" when missing
  clock?: Clock;
  run?: WithFirm; // tests pass a withFirm on their own pool
  secret?: string; // defaults to SESSION_SECRET
}

export const authParts = (ctx: AuthContext) => ({
  now: (ctx.clock ?? systemClock).now(),
  run: ctx.run ?? withFirm,
  secret: ctx.secret ?? appEnv().SESSION_SECRET,
  ip: ctx.clientIp ?? "unknown",
});

export type RateLimited = { status: "rate_limited"; retryAfterMinutes: number };

export type LinkLoginResult =
  { status: "ok"; token: string; expiresAt: Date; subjectId: string } | { status: "rejected" };

// The login itself, inside the firm's transaction: spend the link (first tap wins), retire the
// person's other links, start a session, log it. A link of the other kind is refused.
export async function loginWithLinkOf(
  tx: FirmTx,
  opts: { kind: SubjectKind; token: string; now: Date },
): Promise<LinkLoginResult> {
  const { kind, token, now } = opts;
  const used = looksLikeToken(token) ? await spendMagicLink(tx, { kind, token, now }) : null;
  if (!used) {
    const why = looksLikeToken(token)
      ? await whyRejected(tx, { kind, token, now })
      : { id: null, reason: "unknown" as const };
    await recordEvent(tx, {
      actorType: "system",
      action: "auth.link_rejected",
      entityType: "magic_link",
      entityId: why.id,
      data: { kind, reason: why.reason },
    });
    return { status: "rejected" };
  }
  await retireOtherLinks(tx, { kind, subjectId: used.subjectId, now });
  const session = await createSession(tx, { kind, subjectId: used.subjectId, now });
  await recordEvent(tx, {
    actorType: kind,
    actorId: used.subjectId,
    action: "auth.login",
    entityType: "session",
    entityId: session.id,
    data: { kind, magicLinkId: used.id },
  });
  return {
    status: "ok",
    token: session.token,
    expiresAt: session.expiresAt,
    subjectId: used.subjectId,
  };
}

// Using a link from the /l page. Only failed attempts count against the IP (a whole crew logging
// in on one venue Wi-Fi mustn't lock itself out), counted with the rejection. The check and the
// count aren't one statement, so a burst can let a few extra failures in: this limit exists to
// stop guessing and log flooding, not to be exact.
export async function consumeLoginLink(
  ctx: AuthContext,
  kind: SubjectKind,
  token: string,
): Promise<LinkLoginResult | RateLimited> {
  const { now, run, secret, ip } = authParts(ctx);
  const limit = LIMITS.linkFailuresPerIp;
  return run(ctx.firm.id, async (tx) => {
    const before = await peekLimit(tx, { limit, value: ip, now, secret });
    if (!before.allowed) {
      return { status: "rate_limited", retryAfterMinutes: toMinutes(before.retryAfterMs) };
    }
    const result = await loginWithLinkOf(tx, { kind, token, now });
    if (result.status === "rejected") {
      const hit = await hitLimit(tx, { limit, value: ip, now, secret });
      if (hit.hits === limit.max) await logLimitReached(tx, limit, "magic_link");
    }
    return result;
  });
}

export async function sessionFor(
  ctx: AuthContext,
  kind: SubjectKind,
  token: string,
): Promise<ActiveSession | null> {
  if (!looksLikeToken(token)) return null;
  const { now, run } = authParts(ctx);
  return run(ctx.firm.id, (tx) => findSession(tx, { kind, token, now }));
}

// Called from server actions (only they can set cookies): a new token when the current one is
// 24 hours old, otherwise null.
export async function refreshSession(
  ctx: AuthContext,
  kind: SubjectKind,
  token: string,
): Promise<{ token: string; expiresAt: Date } | null> {
  if (!looksLikeToken(token)) return null;
  const { now, run } = authParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const session = await findSession(tx, { kind, token, now });
    if (!session?.rotationDue) return null;
    return rotateSession(tx, { session, now });
  });
}

export async function logout(ctx: AuthContext, kind: SubjectKind, token: string): Promise<boolean> {
  if (!looksLikeToken(token)) return false;
  const { now, run } = authParts(ctx);
  return run(ctx.firm.id, (tx) => endSession(tx, { kind, token, now }));
}
