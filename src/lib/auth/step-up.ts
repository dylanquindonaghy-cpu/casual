import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { OTP_MAX_ATTEMPTS, otpCodes, sessions } from "../db/schema";
import { withFirm, type FirmTx, type WithFirm } from "../db/scoped";
import { appEnv } from "../env";
import { recordEvent } from "../events/record";
import { sendFirmJob } from "../jobs/firm-job";
import { addMs, MINUTE, systemClock, type Clock } from "./clock";
import { codeHash, sameHash } from "./codes";
import { sendLoginCodeTask } from "./send-login-code";
import { findSession, type ActiveSession } from "./sessions";
import { LIMITS, throttle } from "./throttle";
import { looksLikeToken } from "./tokens";

// Step-up for the pay pages (docs/architecture.md, Login step 5): a logged-in worker asks for a
// 6-digit code, gets it by WhatsApp, and types it in. A correct code opens the pay pages for 30
// minutes. Each code lasts 10 minutes and allows 5 tries; asking for a new one replaces it.

export const STEP_UP_MS = 30 * MINUTE;

export interface StepUpContext {
  firm: { id: string };
  clock?: Clock;
  run?: WithFirm;
  secret?: string;
}

const parts = (ctx: StepUpContext) => ({
  now: (ctx.clock ?? systemClock).now(),
  run: ctx.run ?? withFirm,
  secret: ctx.secret ?? appEnv().SESSION_SECRET,
});

export const isSteppedUp = (session: ActiveSession, now: Date) =>
  session.steppedUpUntil !== null && session.steppedUpUntil > now;

// Whether the session has a code that can still be typed in (so the page can offer the code
// field straight away after a reload, instead of making the worker ask again and retire it).
export async function hasLiveCode(ctx: StepUpContext, session: ActiveSession): Promise<boolean> {
  const { now, run } = parts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const { rows } = await tx.execute(sql`
      select 1 from otp_codes
       where session_id = ${session.id} and consumed_at is null
         and expires_at > ${now} and attempts < ${OTP_MAX_ATTEMPTS}
    `);
    return rows.length > 0;
  });
}

async function workerSession(run: WithFirm, firmId: string, token: string, now: Date) {
  if (!looksLikeToken(token)) return null;
  return run(firmId, (tx) => findSession(tx, { kind: "worker", token, now }));
}

export type RequestCodeResult =
  | { status: "sent" }
  | { status: "rate_limited"; retryAfterMinutes: number }
  | { status: "logged_out" };

export async function requestStepUpCode(
  ctx: StepUpContext,
  sessionToken: string,
): Promise<RequestCodeResult> {
  const { now, run, secret } = parts(ctx);
  const session = await workerSession(run, ctx.firm.id, sessionToken, now);
  if (!session) return { status: "logged_out" };
  const limited = await throttle(
    run,
    ctx.firm.id,
    [
      { limit: LIMITS.codePerWorker, value: session.subjectId },
      { limit: LIMITS.codePerWorkerDaily, value: session.subjectId },
    ],
    { now, secret, entityType: "session" },
  );
  if (limited) return { status: "rate_limited", retryAfterMinutes: limited.retryAfterMinutes };
  await run(ctx.firm.id, async (tx) => {
    await recordEvent(tx, {
      actorType: "worker",
      actorId: session.subjectId,
      action: "auth.otp_requested",
      entityType: "session",
      entityId: session.id,
    });
    await sendFirmJob(tx, sendLoginCodeTask, {
      idempotencyKey: randomUUID(),
      sessionId: session.id,
    });
  });
  return { status: "sent" };
}

export type CheckCodeResult =
  | { status: "ok"; steppedUpUntil: Date }
  | { status: "wrong"; attemptsLeft: number }
  | { status: "expired" }; // no live code: expired, used, locked, or never sent

export type VerifyCodeResult =
  CheckCodeResult | { status: "invalid_code" } | { status: "logged_out" };

export async function verifyStepUpCode(
  ctx: StepUpContext,
  sessionToken: string,
  typed: string,
): Promise<VerifyCodeResult> {
  const code = typed.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { status: "invalid_code" }; // no try used up
  const { now, run, secret } = parts(ctx);
  if (!looksLikeToken(sessionToken)) return { status: "logged_out" };
  return run(ctx.firm.id, async (tx) => {
    const session = await findSession(tx, { kind: "worker", token: sessionToken, now });
    if (!session) return { status: "logged_out" };
    return checkCode(tx, { session, code, now, secret });
  });
}

// One conditional UPDATE takes a try (only while fewer than 5 are used), so parallel guesses
// can't get more than 5 comparisons between them. Then the typed code is compared with the
// stored HMAC in constant time.
export async function checkCode(
  tx: FirmTx,
  opts: { session: ActiveSession; code: string; now: Date; secret: string },
): Promise<CheckCodeResult> {
  const { session, now } = opts;
  const { rows } = await tx.execute<{ id: string; code_hash: Buffer; attempts: number }>(sql`
    update otp_codes set attempts = attempts + 1
     where session_id = ${session.id} and consumed_at is null
       and expires_at > ${now} and attempts < ${OTP_MAX_ATTEMPTS}
    returning id, code_hash, attempts
  `);
  const live = rows[0];
  const actor = { actorType: "worker" as const, actorId: session.subjectId };
  // No live code (expired, used, locked or never sent): nothing changed, so nothing to log.
  if (!live) return { status: "expired" };
  if (!sameHash(Buffer.from(live.code_hash), codeHash(opts.secret, session.id, opts.code))) {
    const attemptsLeft = OTP_MAX_ATTEMPTS - live.attempts;
    await recordEvent(tx, {
      ...actor,
      action: attemptsLeft === 0 ? "auth.otp_locked" : "auth.otp_failed",
      entityType: "otp_code",
      entityId: live.id,
      data: { attemptsLeft },
    });
    return attemptsLeft === 0 ? { status: "expired" } : { status: "wrong", attemptsLeft };
  }
  const used = await tx
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(sql`${otpCodes.id} = ${live.id} and ${otpCodes.consumedAt} is null`)
    .returning({ id: otpCodes.id });
  if (used.length === 0) return { status: "expired" };
  const steppedUpUntil = addMs(now, STEP_UP_MS);
  await tx.update(sessions).set({ steppedUpUntil }).where(eq(sessions.id, session.id));
  await recordEvent(tx, {
    ...actor,
    action: "auth.otp_verified",
    entityType: "otp_code",
    entityId: live.id,
  });
  return { status: "ok", steppedUpUntil };
}
