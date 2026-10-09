import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { strikes } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmSendOptions } from "../jobs/firm-job";
import { lockStrikesEmail } from "./team-email";

// Queueing the evidence email to the strikes team (docs/office-v2.md 5.6; 12C.4); the job itself is
// in src/lib/strikes/evidence.ts. Kept apart so issueStrike() and Settings can queue it without
// importing the record and PDF code.
//
// A strike's evidence is sent in a series of at most EVIDENCE_MAX_ATTEMPTS attempts, each its own
// job and its own claim. Every series starts with an entry on the strike (its id is the series):
// the strike being recorded (strike.issued), the strikes team's address being confirmed while it
// waited (strike.evidence_queued) or the office's "Resend evidence" (strike.evidence_resend). Only
// the strike's latest series may send: an older one's job, retry or late result changes nothing
// (evidence.ts). Only a failure that proves nothing reached the server (EmailNotSentError) starts
// the next attempt. The payload is ids and numbers only; the key gives the series in base 36, so
// the log never holds a run of digits it would take for a phone number.

export const STRIKE_EVIDENCE_QUEUE = "strikes.evidence_email";
export const EVIDENCE_MAX_ATTEMPTS = 4;
export const SERIES_ACTIONS = [
  "strike.issued",
  "strike.evidence_queued",
  "strike.evidence_resend",
] as const;
// Evidence still `pending` with nothing logged about the strike for this long is held up (its job
// stopped for good): longer than every wait between attempts (5 + 30 + 120 minutes).
export const EVIDENCE_STUCK_HOURS = 4;

const keyOf = (p: { strikeId: string; series: number; attempt: number }) =>
  `strike-evidence:${p.strikeId}:${p.series.toString(36)}:${p.attempt}`;

export const strikeEvidencePayload = firmJobEnvelope
  .extend({
    idempotencyKey: z.string().regex(/^strike-evidence:[0-9a-f-]{36}:[0-9a-z]{1,13}:[1-9]$/),
    strikeId: z.uuid(),
    series: z.number().int().positive(), // the id of the entry that started this series
    attempt: z.number().int().min(1).max(EVIDENCE_MAX_ATTEMPTS),
  })
  .refine((p) => p.idempotencyKey === keyOf(p), "the key must name the strike, series and attempt");
export type StrikeEvidencePayload = z.infer<typeof strikeEvidencePayload>;

const job = { queue: STRIKE_EVIDENCE_QUEUE, schema: strikeEvidencePayload };

export async function queueStrikeEvidence(
  tx: FirmTx,
  p: { strikeId: string; series: number; attempt?: number },
  options?: FirmSendOptions,
): Promise<void> {
  const next = { strikeId: p.strikeId, series: p.series, attempt: p.attempt ?? 1 };
  await sendFirmJob(tx, job, { idempotencyKey: keyOf(next), ...next }, options);
}

// Held up: `pending`, with nothing logged about the strike for EVIDENCE_STUCK_HOURS, by the
// database's own clock (the entries' times are its). For the strike row under `alias`.
export const evidenceStuckSql = (alias: string) => {
  const s = sql.raw(alias);
  return sql`(${s}.evidence_email_status = 'pending'
    and (select max(sev.created_at) from events sev
          where sev.firm_id = ${s}.firm_id and sev.entity_id = ${s}.id
            and sev.action like 'strike.%')
        < now() - make_interval(hours => ${EVIDENCE_STUCK_HOURS}))`;
};

// Failure codes (strike.evidence_failed) that prove nothing was sent: the message couldn't be
// built, or never reached the server. Any other may have arrived.
export const NOTHING_SENT_CODES: readonly string[] = ["EmailNotSentError", "not_built"];
// The code of a strike's latest failure, for the strike row under `alias`.
export const lastEvidenceCodeSql = (alias: string) => {
  const s = sql.raw(alias);
  return sql`(select fev.data ->> 'code' from events fev
     where fev.firm_id = ${s}.firm_id and fev.entity_id = ${s}.id
       and fev.action = 'strike.evidence_failed'
     order by fev.id desc limit 1)`;
};

export type ResendEvidenceResult =
  | { status: "queued" }
  | { status: "not_failed" } // sent, on its way, waiting for the address, or the strike withdrawn
  | { status: "not_found" }; // no strike on this booking

// "Resend evidence" on a cancellation's record: after the email failed (it may have arrived, so
// it's never sent again on its own), or when it's held up. Sends once more, as a new series, so
// anything left of an earlier one sends nothing; logged strike.evidence_resend by the office user.
// Under the strikes-email lock, so two taps queue one. Not for a withdrawn strike.
export async function resendEvidence(
  tx: FirmTx,
  r: { assignmentId: string; officeUserId: string },
): Promise<ResendEvidenceResult> {
  await lockStrikesEmail(tx);
  const { rows } = await tx.execute<{
    id: string;
    evidence: string | null;
    live: boolean;
    stuck: boolean;
  }>(sql`
    select s.id::text, s.evidence_email_status as evidence, s.status = 'live' as live,
           ${evidenceStuckSql("s")} as stuck
      from strikes s where s.assignment_id = ${r.assignmentId}
  `);
  const strike = rows[0];
  if (!strike) return { status: "not_found" };
  if (!strike.live || !(strike.evidence === "failed" || strike.stuck)) {
    return { status: "not_failed" };
  }
  await tx.update(strikes).set({ evidenceEmailStatus: "pending" }).where(eq(strikes.id, strike.id));
  const series = await recordEvent(tx, {
    actorType: "office",
    actorId: r.officeUserId,
    action: "strike.evidence_resend",
    entityType: "strike",
    entityId: strike.id,
    data: {},
  });
  await queueStrikeEvidence(tx, { strikeId: strike.id, series });
  return { status: "queued" };
}

// Once the strikes team's address is confirmed (src/lib/office/strikes-email.ts, in the same
// transaction, under its lock): the strikes left waiting for it that still count are sent, each
// logged strike.evidence_queued (its series). One that has stopped counting, or was withdrawn,
// stays as it is. Returns how many were queued.
export async function queueWaitingEvidence(tx: FirmTx, r: { now: Date }): Promise<number> {
  const waiting = await tx
    .update(strikes)
    .set({ evidenceEmailStatus: "pending" })
    .where(
      and(
        eq(strikes.evidenceEmailStatus, "not_set_up"),
        eq(strikes.status, "live"),
        gt(strikes.expiresAt, r.now),
      ),
    )
    .returning({ id: strikes.id });
  for (const w of waiting) {
    const series = await recordEvent(tx, {
      actorType: "system",
      action: "strike.evidence_queued",
      entityType: "strike",
      entityId: w.id,
      data: {},
    });
    await queueStrikeEvidence(tx, { strikeId: w.id, series });
  }
  return waiting.length;
}
