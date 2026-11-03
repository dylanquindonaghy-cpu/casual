import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { firmJobEnvelope, sendFirmJob } from "../jobs/firm-job";
import { CANCEL_PUSH_HOURS } from "./tell-me-copy";

// The office alerts' queues and payloads (Phase 26.4; the senders: src/lib/office/alerts.ts), here
// apart so the cancellation (src/lib/roster/cancel.ts, in the web app too) queues its alert without
// loading the senders. Payloads carry ids only.

export const OFFICE_CANCEL_ALERT_QUEUE = "office-cancel-alert";
export const OFFICE_OPEN_ALERT_QUEUE = "office-open-alert";
export const OFFICE_SUMMARY_QUEUE = "office-summary";
export const OFFICE_ALERTS_TICK_QUEUE = "office-alerts-tick";
export const OFFICE_ALERTS_TICK_CRON = "*/5 * * * *";

export const officeCancelAlertPayload = firmJobEnvelope.extend({ assignmentId: z.uuid() });
export type OfficeCancelAlertPayload = z.infer<typeof officeCancelAlertPayload>;
export const officeOpenAlertPayload = firmJobEnvelope;
export type OfficeOpenAlertPayload = z.infer<typeof officeOpenAlertPayload>;
export const officeSummaryPayload = firmJobEnvelope.extend({ date: z.iso.date() });
export type OfficeSummaryPayload = z.infer<typeof officeSummaryPayload>;

// In a casual's cancellation's own transaction: only under CANCEL_PUSH_HOURS' notice; keyed by the
// booking, so it's queued once.
export async function queueOfficeCancelAlert(
  tx: FirmTx,
  input: { assignmentId: string; noticeHours: number },
): Promise<void> {
  if (input.noticeHours >= CANCEL_PUSH_HOURS) return;
  const key = `office-cancel-alert:${input.assignmentId}`;
  await sendFirmJob(
    tx,
    { queue: OFFICE_CANCEL_ALERT_QUEUE, schema: officeCancelAlertPayload },
    { idempotencyKey: key, assignmentId: input.assignmentId },
    { singletonKey: key },
  );
}
