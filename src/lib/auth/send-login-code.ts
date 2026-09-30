import { randomInt } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { firms, otpCodes, sessions, workers } from "../db/schema";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { defineFirmJob, firmJobEnvelope } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import { loginCodeMessage } from "../messaging/templates";
import { signOffFor } from "../tenancy/sign-off";
import { addMs, MINUTE, systemClock, type Clock } from "./clock";
import { codeHash } from "./codes";

// The send-login-code job: a 6-digit code for the pay pages' step-up (docs/architecture.md,
// Login step 5). Like login links, the code is created here, in the worker, so it never sits in
// the job queue (the payload holds ids only), and only its HMAC is stored.

export const SEND_LOGIN_CODE_QUEUE = "send-login-code";
export const CODE_LIFETIME_MS = 10 * MINUTE;

export const sendLoginCodePayload = firmJobEnvelope.extend({
  idempotencyKey: z.uuid(),
  sessionId: z.uuid(),
});
export type SendLoginCodePayload = z.infer<typeof sendLoginCodePayload>;

export interface SendLoginCodeDeps {
  transport: MessagingTransport;
  clock: Clock;
  secret: string;
  newCode?: () => string; // tests may fix it
}

export const newSixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export type SendCodeResult =
  { sent: true; otpCodeId: string } | { sent: false; reason: "no_session" };

export async function sendLoginCode(
  payload: SendLoginCodePayload,
  tx: FirmTx,
  deps: SendLoginCodeDeps,
): Promise<SendCodeResult> {
  const now = deps.clock.now();
  // Only for a live worker session whose worker is still active.
  const [target] = await tx
    .select({ mobile: workers.mobileE164, workerId: workers.id })
    .from(sessions)
    .innerJoin(workers, and(eq(workers.firmId, sessions.firmId), eq(workers.id, sessions.workerId)))
    .where(
      and(
        eq(sessions.id, payload.sessionId),
        eq(sessions.kind, "worker"),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        eq(workers.status, "active"),
      ),
    );
  // An active worker always has a mobile (only an erased one has none, and erasure is inactive).
  if (!target?.mobile) return { sent: false, reason: "no_session" };
  const [firm] = await tx
    .select({
      name: firms.name,
      settings: firms.settings,
      line: firms.shiftsLineE164, // the firm's shifts line: the code goes from it
    })
    .from(firms)
    .where(eq(firms.id, payload.firmId));
  if (!firm) throw new Error("firm not visible inside its own transaction");

  // One live code per session: the new one replaces any earlier one.
  await tx
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(and(eq(otpCodes.sessionId, payload.sessionId), isNull(otpCodes.consumedAt)));
  const code = (deps.newCode ?? newSixDigitCode)();
  const [row] = await tx
    .insert(otpCodes)
    .values({
      firmId: payload.firmId,
      sessionId: payload.sessionId,
      codeHash: codeHash(deps.secret, payload.sessionId, code),
      expiresAt: addMs(now, CODE_LIFETIME_MS),
    })
    .returning({ id: otpCodes.id });
  if (!row) throw new Error("otp insert returned nothing");

  const voice = { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) };
  const result = await deps.transport.send({
    channel: "whatsapp",
    to: target.mobile,
    ...(firm.line ? { from: firm.line } : {}),
    body: loginCodeMessage(voice, code),
  });
  await recordEvent(tx, {
    actorType: "system",
    action: "auth.otp_sent",
    entityType: "otp_code",
    entityId: row.id,
    data: { channel: "whatsapp", providerMessageId: result.providerMessageId },
  });
  return { sent: true, otpCodeId: row.id };
}

export function createSendLoginCodeJob(deps: () => SendLoginCodeDeps) {
  return defineFirmJob({
    queue: SEND_LOGIN_CODE_QUEUE,
    schema: sendLoginCodePayload,
    handler: (payload, tx) => sendLoginCode(payload, tx, deps()),
  });
}

export const sendLoginCodeJob = createSendLoginCodeJob(() => {
  const env = workerEnv();
  return { transport: getTransport(env), clock: systemClock, secret: env.SESSION_SECRET };
});
