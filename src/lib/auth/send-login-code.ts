import { randomInt } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx, WithFirm } from "../db/scoped";
import { events, firms, otpCodes, sessions, workers } from "../db/schema";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { errorCode, firmJobEnvelope, type FirmTask } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import type { OutboundMessage } from "../messaging/transport";
import { loginCodeMessage } from "../messaging/templates";
import { signOffFor } from "../tenancy/sign-off";
import { addMs, MINUTE, systemClock, type Clock } from "./clock";
import { codeHash } from "./codes";

// The send-login-code job: a 6-digit code for the pay pages' step-up (docs/architecture.md,
// Login step 5). Like login links, the code is created here, in the worker, so it never sits in
// the job queue (the payload holds ids only), and only its HMAC is stored.
//
// At most once, like the notices (a firm task, never a transaction held across a message):
// (1) a short transaction claims it: the code row, keyed by the job's idempotency key
// (otp_codes.request_id), committed before anything is sent; (2) the WhatsApp, outside any
// transaction; (3) a second short transaction logs auth.otp_sent, or auth.otp_send_failed. A retried job
// finds its code and sends nothing: the code it may already have sent still works, and a worker who
// got nothing asks for another.

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
  | { sent: true; otpCodeId: string }
  | { sent: false; reason: "no_session" | "already_sent" | "failed" };

// (1) The claim: the code for this job, if the session is still live and its worker active.
// Whether the code's send is logged already (sent, unconfirmed, or failed).
async function codeOutcomeLogged(tx: FirmTx, otpCodeId: string): Promise<boolean> {
  const [logged] = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        inArray(events.action, ["auth.otp_sent", "auth.otp_send_failed"]),
        eq(events.entityId, otpCodeId),
      ),
    )
    .limit(1);
  return logged !== undefined;
}

type CodeClaim =
  { done: "no_session" | "already_sent" } | { otpCodeId: string; message: OutboundMessage };

async function claimCode(
  tx: FirmTx,
  payload: SendLoginCodePayload,
  deps: SendLoginCodeDeps,
  now: Date,
): Promise<CodeClaim> {
  // Two copies of this job (or two requests for the session) take turns, so the check for this
  // job's code below always sees the other's.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('login-code:' || ${payload.sessionId}, 0))`,
  );
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
  if (!target?.mobile) return { done: "no_session" };
  // This job's code already made (a retry, or a second copy): it may have gone, so nothing more.
  // If the run that made it stopped before logging it, it's logged now as sent, unconfirmed.
  const [made] = await tx
    .select({ id: otpCodes.id })
    .from(otpCodes)
    .where(eq(otpCodes.requestId, payload.idempotencyKey))
    .for("update");
  if (made) {
    if (!(await codeOutcomeLogged(tx, made.id))) {
      await recordEvent(tx, {
        actorType: "system",
        action: "auth.otp_sent",
        entityType: "otp_code",
        entityId: made.id,
        data: { channel: "whatsapp", unconfirmed: true },
      });
    }
    return { done: "already_sent" };
  }
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
      requestId: payload.idempotencyKey,
      codeHash: codeHash(deps.secret, payload.sessionId, code),
      expiresAt: addMs(now, CODE_LIFETIME_MS),
    })
    // Two copies at once: the second waits on the unique key, then writes nothing.
    .onConflictDoNothing()
    .returning({ id: otpCodes.id });
  if (!row) return { done: "already_sent" };
  const voice = { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) };
  return {
    otpCodeId: row.id,
    message: {
      channel: "whatsapp",
      to: target.mobile,
      ...(firm.line ? { from: firm.line } : {}),
      body: loginCodeMessage(voice, code),
    },
  };
}

export async function sendLoginCode(
  payload: SendLoginCodePayload,
  run: WithFirm,
  deps: SendLoginCodeDeps,
): Promise<SendCodeResult> {
  const now = deps.clock.now();
  const inFirm = <T>(fn: (tx: FirmTx) => Promise<T>) => run(payload.firmId, fn);
  const claim = await inFirm((tx) => claimCode(tx, payload, deps, now));
  if ("done" in claim) return { sent: false, reason: claim.done };

  // (2) The code, outside any transaction.
  let sent: { providerMessageId: string } | { code: string };
  try {
    sent = await deps.transport.send(claim.message);
  } catch (err) {
    sent = { code: errorCode(err) };
  }

  // (3) The outcome, logged once (a rerun may have caught it up already, as unconfirmed).
  await inFirm(async (tx) => {
    await tx
      .select({ id: otpCodes.id })
      .from(otpCodes)
      .where(eq(otpCodes.id, claim.otpCodeId))
      .for("update");
    if (await codeOutcomeLogged(tx, claim.otpCodeId)) return;
    await recordEvent(tx, {
      actorType: "system",
      action: "providerMessageId" in sent ? "auth.otp_sent" : "auth.otp_send_failed",
      entityType: "otp_code",
      entityId: claim.otpCodeId,
      data:
        "providerMessageId" in sent
          ? { channel: "whatsapp", providerMessageId: sent.providerMessageId }
          : { channel: "whatsapp", code: sent.code },
    });
  });
  return "providerMessageId" in sent
    ? { sent: true, otpCodeId: claim.otpCodeId }
    : { sent: false, reason: "failed" };
}

export function createSendLoginCodeTask(
  deps: () => SendLoginCodeDeps,
): FirmTask<SendLoginCodePayload> {
  return {
    queue: SEND_LOGIN_CODE_QUEUE,
    schema: sendLoginCodePayload,
    task: (payload, run) => sendLoginCode(payload, run, deps()),
  };
}

export const sendLoginCodeTask = createSendLoginCodeTask(() => {
  const env = workerEnv();
  return { transport: getTransport(env), clock: systemClock, secret: env.SESSION_SECRET };
});
