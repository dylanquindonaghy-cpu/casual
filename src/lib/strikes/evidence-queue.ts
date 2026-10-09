import { and, eq, gt } from "drizzle-orm";
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
// job and its own claim, started by an event: the strike being recorded (strike.issued), the
// office's "Resend evidence" (strike.evidence_resend) or the address being confirmed
// (firm.settings_changed). Only a failure that proves nothing reached the server
// (EmailNotSentError) starts the next attempt. The payload is ids and numbers only.

export const STRIKE_EVIDENCE_QUEUE = "strikes.evidence_email";
export const EVIDENCE_MAX_ATTEMPTS = 4;

const keyOf = (p: { strikeId: string; series: number; attempt: number }) =>
  `strike-evidence:${p.strikeId}:${p.series}:${p.attempt}`;

export const strikeEvidencePayload = firmJobEnvelope
  .extend({
    idempotencyKey: z.string().regex(/^strike-evidence:[0-9a-f-]{36}:[1-9]\d{0,18}:[1-9]$/),
    strikeId: z.uuid(),
    series: z.number().int().positive(), // the id of the event that started this series
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

export type ResendEvidenceResult =
  | { status: "queued" }
  | { status: "not_failed" } // sent, being sent, or waiting for the address: nothing to resend
  | { status: "not_found" }; // no strike on this booking

// "Resend evidence" on a cancellation's record: only after the email failed (it may have arrived,
// so it's never sent again on its own). Sends once more, as a new series; logged
// strike.evidence_resend by the office user. Under the strikes-email lock, so two taps queue one.
export async function resendEvidence(
  tx: FirmTx,
  r: { assignmentId: string; officeUserId: string },
): Promise<ResendEvidenceResult> {
  await lockStrikesEmail(tx);
  const [strike] = await tx
    .select({ id: strikes.id, evidence: strikes.evidenceEmailStatus })
    .from(strikes)
    .where(eq(strikes.assignmentId, r.assignmentId));
  if (!strike) return { status: "not_found" };
  if (strike.evidence !== "failed") return { status: "not_failed" };
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
// transaction, under its lock): the strikes left waiting for it that still count are sent. One
// that has stopped counting, or was withdrawn, stays as it is. Returns how many were queued.
export async function queueWaitingEvidence(
  tx: FirmTx,
  r: { series: number; now: Date },
): Promise<number> {
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
  for (const w of waiting) await queueStrikeEvidence(tx, { strikeId: w.id, series: r.series });
  return waiting.length;
}
