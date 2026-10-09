import { and, count, eq, inArray, lte, or, sql, gt } from "drizzle-orm";
import { DAY, HOUR, MINUTE, systemClock, type Clock } from "../auth/clock";
import { events, firms, strikes } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { errorCode, type FirmTask } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import { outboundMessageSchema, type OutboundMessage } from "../messaging/transport";
import { EmailNotSentError } from "../messaging/smtp";
import { strikeEvidenceEmail } from "../messaging/templates";
import { loadCancellationRecord, type CancellationRecord } from "../office/cancellations";
import { AS_IT_IS_NOW, evidenceSessionText, recordFields } from "../office/cancellations-copy";
import { recordPdf } from "../pdf/record";
import { noticeText } from "../portal/cancel-reasons";
import { roleLabel, timeOnDay } from "../portal/format";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import {
  EVIDENCE_MAX_ATTEMPTS,
  queueStrikeEvidence,
  SERIES_ACTIONS,
  STRIKE_EVIDENCE_QUEUE,
  strikeEvidencePayload,
  type StrikeEvidencePayload,
} from "./evidence-queue";
import { confirmedStrikesEmail, lockStrikesEmail } from "./team-email";
import { startsInText } from "./words";

// The evidence email to the strikes team (docs/office-v2.md 5.6; 12C.4): the strikes.evidence_email
// job, queued with the strike (src/lib/strikes/evidence-queue.ts). It goes only to the firm's
// confirmed strikes-team address (12B.7), with §5.6's subject and body and the cancellation record
// as a PDF (12C.3's, with a casual's reason as "Casual's own reason (see ShiftDesk)": no health
// details leave ShiftDesk). Over the SMTP transport (12X.2); console in development and tests.
//
// At most once, like the other notices (claim → send → record):
// 1. A short transaction takes the firm's strikes-email lock (as saving and confirming the address
//    do), finds this attempt's claim if there is one, reads the confirmed address (none: the
//    evidence is `not_set_up`, logged strike.evidence_failed {code: "not_set_up"}, nothing sent,
//    and confirming the address later sends it) and records the claim, strike.evidence_sending.
// 2. The email goes with no transaction open.
// 3. A short transaction records the outcome: `sent`, with the address and time on the strike
//    (strike.evidence_sent, without the address: the log refuses addresses), or the failure
//    (strike.evidence_failed {code, retry}). Only EmailNotSentError, which proves nothing reached
//    the server, queues the next attempt (at most EVIDENCE_MAX_ATTEMPTS, after
//    EVIDENCE_RETRY_AFTER_MS). Anything else, or the last attempt, sets `failed`: the email may
//    have arrived, so only a person sends it again ("Resend evidence" on the record), and the
//    Needs attention item shows it.
// A job stopped between its claim and its outcome is never sent again: rerun, it records `failed`.
// Only the strike's latest series sends (a resend starts a new one); an older series' late failure
// only logs, while a late success still records `sent`, which is what happened.

// Waits before attempts 2, 3 and 4.
export const EVIDENCE_RETRY_AFTER_MS = [5 * MINUTE, 30 * MINUTE, 2 * HOUR] as const;

export interface StrikeEvidenceDeps {
  transport: MessagingTransport;
  baseDomain: string;
  clock: Clock;
}

export type StrikeEvidenceResult =
  | { status: "sent" }
  | { status: "retrying"; attempt: number } // nothing reached the server: the next attempt queued
  | { status: "failed" }
  | { status: "not_set_up" } // no confirmed strikes-team address
  | { status: "already" } // this attempt ran before, or the evidence isn't waiting to be sent
  | { status: "gone" }; // no such strike in this firm, or withdrawn

type Claim =
  | {
      status: "send";
      strikeId: string;
      to: string;
      record: CancellationRecord;
      firm: { name: string; slug: string; signOff: string };
      thresholdHours: number;
      liveDays: number;
      strikeNumber: number;
    }
  | Exclude<StrikeEvidenceResult, { status: "sent" } | { status: "retrying" }>;

const ATTEMPT_ACTIONS = [
  "strike.evidence_sending",
  "strike.evidence_sent",
  "strike.evidence_failed",
];

// The strike's latest series: the id of its latest entry that started one (evidence-queue.ts).
async function currentSeries(tx: FirmTx, strikeId: string): Promise<number> {
  const [row] = await tx
    .select({ id: sql<string | null>`max(${events.id})` })
    .from(events)
    .where(and(eq(events.entityId, strikeId), inArray(events.action, [...SERIES_ACTIONS])));
  return Number(row?.id ?? 0);
}

async function claim(tx: FirmTx, p: StrikeEvidencePayload, now: Date): Promise<Claim> {
  await lockStrikesEmail(tx);
  const [strike] = await tx
    .select({
      id: strikes.id,
      workerId: strikes.workerId,
      assignmentId: strikes.assignmentId,
      status: strikes.status,
      evidence: strikes.evidenceEmailStatus,
      thresholdHours: strikes.thresholdHours,
      issuedAt: strikes.issuedAt,
      expiresAt: strikes.expiresAt,
    })
    .from(strikes)
    .where(eq(strikes.id, p.strikeId));
  if (!strike) return { status: "gone" };
  const ran = await tx
    .select({ action: events.action })
    .from(events)
    .where(
      and(
        eq(events.entityId, strike.id),
        inArray(events.action, ATTEMPT_ACTIONS),
        sql`${events.data} ->> 'request' = ${p.idempotencyKey}`,
      ),
    );
  if (ran.some((e) => e.action !== "strike.evidence_sending")) return { status: "already" };
  // A newer series (a resend, or the address confirmed since) has taken over.
  if ((await currentSeries(tx, strike.id)) !== p.series) return { status: "already" };
  if (ran.length > 0) {
    // Claimed, then stopped before its outcome: the email may have gone, so never again.
    await recordFailure(tx, {
      strikeId: strike.id,
      payload: p,
      code: "stopped",
      retry: false,
      current: true,
    });
    return { status: "failed" };
  }
  if (strike.evidence !== "pending") return { status: "already" };
  // A withdrawn strike (12C.5) has nothing to tell the team: logged, nothing sent.
  if (strike.status !== "live") {
    await recordEvent(tx, {
      actorType: "system",
      action: "strike.evidence_failed",
      entityType: "strike",
      entityId: strike.id,
      data: { request: p.idempotencyKey, attempt: p.attempt, code: "withdrawn", retry: false },
    });
    return { status: "gone" };
  }

  const [firm] = await tx
    .select({ name: firms.name, slug: firms.slug, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, p.firmId));
  const to = firm ? confirmedStrikesEmail(firm.settings) : null;
  if (!firm || !to) {
    await tx
      .update(strikes)
      .set({ evidenceEmailStatus: "not_set_up" })
      .where(eq(strikes.id, strike.id));
    await recordEvent(tx, {
      actorType: "system",
      action: "strike.evidence_failed",
      entityType: "strike",
      entityId: strike.id,
      data: { request: p.idempotencyKey, attempt: p.attempt, code: "not_set_up", retry: false },
    });
    return { status: "not_set_up" };
  }
  const found = await loadCancellationRecord(tx, strike.assignmentId, now);
  // A strike's booking is always a cancelled one: without it, fail loudly (the job's failure alert;
  // the evidence shows as held up on Today after EVIDENCE_STUCK_HOURS).
  if (found?.status !== "found") throw new Error("the strike's cancellation record wasn't found");
  // Which of their strikes this is: those counting when it was recorded (its own window), it too.
  const window = strike.expiresAt.getTime() - strike.issuedAt.getTime();
  const [counted] = await tx
    .select({ n: count() })
    .from(strikes)
    .where(
      and(
        eq(strikes.workerId, strike.workerId),
        eq(strikes.status, "live"),
        gt(strikes.issuedAt, new Date(strike.issuedAt.getTime() - window)),
        or(
          sql`${strikes.issuedAt} < ${strike.issuedAt}`,
          and(eq(strikes.issuedAt, strike.issuedAt), lte(strikes.id, strike.id)),
        ),
      ),
    );
  await recordEvent(tx, {
    actorType: "system",
    action: "strike.evidence_sending",
    entityType: "strike",
    entityId: strike.id,
    data: { request: p.idempotencyKey, attempt: p.attempt },
  });
  return {
    status: "send",
    strikeId: strike.id,
    to,
    record: found.record,
    firm: {
      name: firm.name,
      slug: firm.slug,
      signOff: signOffFor(firm.name, firm.settings.sign_off),
    },
    thresholdHours: strike.thresholdHours,
    liveDays: Math.round(window / DAY),
    strikeNumber: Number(counted?.n ?? 1),
  };
}

// A failed attempt, logged. `current`: still the strike's latest series, so it settles the status
// (an older series only logs what happened to it).
async function recordFailure(
  tx: FirmTx,
  f: {
    strikeId: string;
    payload: StrikeEvidencePayload;
    code: string;
    retry: boolean;
    current: boolean;
  },
) {
  if (!f.retry && f.current) {
    await tx
      .update(strikes)
      .set({ evidenceEmailStatus: "failed" })
      .where(and(eq(strikes.id, f.strikeId), eq(strikes.evidenceEmailStatus, "pending")));
  }
  await recordEvent(tx, {
    actorType: "system",
    action: "strike.evidence_failed",
    entityType: "strike",
    entityId: f.strikeId,
    data: {
      request: f.payload.idempotencyKey,
      attempt: f.payload.attempt,
      code: f.code,
      retry: f.retry,
    },
  });
}

// The email and its PDF, built from the record (times in the firm's zone).
async function evidenceMessage(
  c: Extract<Claim, { status: "send" }>,
  now: Date,
  baseDomain: string,
) {
  const { record } = c;
  const row = record.row;
  const tz = record.timeZone;
  // The attached record says it went with this email.
  const sending = row.strike
    ? {
        ...row,
        strike: { ...row.strike, evidence: { status: "sent" as const, to: c.to, sentAt: now } },
      }
    : row;
  const pdf = await recordPdf({
    title: `Cancellation record ${row.ref}`,
    firmName: record.firmName,
    // The strike's own threshold (as the body says), and no other casual's name: the replacement
    // reads "filled again at 22:02".
    fields: recordFields(sending, {
      tz,
      threshold: c.thresholdHours,
      liveStrikes: record.liveStrikes,
      forExport: true,
      replacementName: false,
    }),
    generatedAt: timeOnDay(now, tz),
    note: AS_IT_IS_NOW,
  });
  const email = strikeEvidenceEmail(
    { name: c.firm.name, signOff: c.firm.signOff },
    {
      casual: row.casual,
      staffId: row.staffId,
      role: roleLabel(row.role),
      site: row.siteName,
      notice: noticeText(row.noticeHours),
      ref: row.ref,
      session: evidenceSessionText(row, tz),
      cancelledAt: timeOnDay(row.cancelledAt, tz),
      beforeStart: startsInText(row.noticeHours),
      thresholdHours: String(c.thresholdHours),
      strikeNumber: String(c.strikeNumber),
      liveDays: String(c.liveDays),
      link: `${portalUrl(c.firm.slug, baseDomain)}/office/cancellations/${row.assignmentId}`,
    },
  );
  return {
    channel: "email" as const,
    to: c.to,
    ...email,
    attachments: [
      {
        filename: `cancellation-${row.ref}.pdf`,
        contentType: "application/pdf" as const,
        content: new Uint8Array(pdf),
      },
    ],
  };
}

export async function runStrikeEvidence(
  payload: StrikeEvidencePayload,
  run: WithFirm,
  deps: StrikeEvidenceDeps,
): Promise<StrikeEvidenceResult> {
  const now = deps.clock.now();
  const claimed = await run(payload.firmId, (tx) => claim(tx, payload, now));
  if (claimed.status !== "send") return { status: claimed.status };

  // Built and checked first: a failure here is before anything was sent, and not worth retrying.
  let code: string | null = null;
  let notSent = false;
  let message: OutboundMessage | null = null;
  try {
    message = outboundMessageSchema.parse(await evidenceMessage(claimed, now, deps.baseDomain));
  } catch {
    code = "not_built";
  }
  if (message) {
    try {
      await deps.transport.send(message);
    } catch (err) {
      code = errorCode(err);
      notSent = err instanceof EmailNotSentError;
    }
  }

  const canRetry = code !== null && notSent && payload.attempt < EVIDENCE_MAX_ATTEMPTS;
  const retried = await run(payload.firmId, async (tx) => {
    if (code === null) {
      await tx
        .update(strikes)
        .set({ evidenceEmailStatus: "sent", evidenceEmailTo: claimed.to, evidenceEmailSentAt: now })
        .where(eq(strikes.id, claimed.strikeId));
      await recordEvent(tx, {
        actorType: "system",
        action: "strike.evidence_sent",
        entityType: "strike",
        entityId: claimed.strikeId,
        data: { request: payload.idempotencyKey, attempt: payload.attempt },
      });
      return false;
    }
    // A newer series started while this one was sending: it only logs what happened here.
    const current = (await currentSeries(tx, claimed.strikeId)) === payload.series;
    const retry = canRetry && current;
    await recordFailure(tx, { strikeId: claimed.strikeId, payload, code, retry, current });
    if (retry) {
      const wait = EVIDENCE_RETRY_AFTER_MS[payload.attempt - 1] ?? 2 * HOUR;
      await queueStrikeEvidence(
        tx,
        { strikeId: claimed.strikeId, series: payload.series, attempt: payload.attempt + 1 },
        { startAfter: new Date(now.getTime() + wait) },
      );
    }
    return retry;
  });
  if (code === null) return { status: "sent" };
  return retried ? { status: "retrying", attempt: payload.attempt + 1 } : { status: "failed" };
}

export function createStrikeEvidenceTask(
  deps: () => StrikeEvidenceDeps,
): FirmTask<StrikeEvidencePayload> {
  return {
    queue: STRIKE_EVIDENCE_QUEUE,
    schema: strikeEvidencePayload,
    task: (payload, run) => runStrikeEvidence(payload, run, deps()),
  };
}

const workerDeps = (): StrikeEvidenceDeps => {
  const env = workerEnv();
  return { transport: getTransport(env), baseDomain: env.APP_BASE_DOMAIN, clock: systemClock };
};
export const strikeEvidenceTask = createStrikeEvidenceTask(workerDeps);
