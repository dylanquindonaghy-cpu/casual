import type { Queue } from "pg-boss";
import { SEND_LOGIN_CODE_QUEUE } from "../../lib/auth/send-login-code";
import { SEND_PORTAL_LINK_QUEUE } from "../../lib/auth/send-portal-link";
import { CREDENTIAL_SCAN_QUEUE, CREDENTIAL_SCAN_TICK_QUEUE } from "../../lib/credentials/scan";
import { FIRM_CHANGE_NOTICE_QUEUE } from "../../lib/notices/firm-change";
import { METRICS_ROLLUP_QUEUE, METRICS_ROLLUP_TICK_QUEUE } from "../../lib/metrics/rollup";
import { INBOUND_MESSAGE_QUEUE } from "../../lib/inbound/job";
import { PAY_QUERY_UPDATE_QUEUE } from "../../lib/notices/pay-query-update";
import { REQUEST_UPDATE_QUEUE } from "../../lib/notices/request-update";
import { PAY_DIGEST_QUEUE, PAY_DIGEST_TICK_QUEUE } from "../../lib/pay/digest";
import { OFFICE_OFFER_QUEUE } from "../../lib/offers/office-offer";
import { ESCALATE_SHIFT_QUEUE, OFFER_WAVE_QUEUE } from "../../lib/offers/waves";
import { SHIFT_REMINDER_TICK_QUEUE, SHIFT_REMINDERS_QUEUE } from "../../lib/reminders/send";
import {
  SHEETS_SYNC_EXPIRE_SECONDS,
  SHEETS_SYNC_QUEUE,
  SHEETS_TICK_QUEUE,
} from "../../lib/roster/sheets/jobs";
import { RETENTION_PURGE_QUEUE, RETENTION_PURGE_TICK_QUEUE } from "../../lib/gdpr/retention";
import { HELLO_QUEUE } from "./hello";

// Every queue the app uses. db:migrate creates them (so the web can enqueue before the worker
// has ever started) and the worker re-creates them on boot (a no-op when they exist).

export interface QueueSpec {
  name: string;
  options?: Omit<Queue, "name">;
}

// Firm queues must use the standard policy: the other policies dedupe across the whole queue,
// so one firm's job could silently stop another firm's. They must not be partitioned either (the
// web's enqueue policy lives on pgboss.job_common). Payloads and outputs are ids only, but pgboss
// has no RLS, so finished jobs are kept for a day, not pg-boss's default week.
export function firmQueue(name: string): QueueSpec {
  return { name, options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 } };
}

// Firm job queues are added here as their jobs are built.
const FIRM_QUEUE_NAMES: readonly string[] = [
  SEND_PORTAL_LINK_QUEUE,
  SEND_LOGIN_CODE_QUEUE,
  CREDENTIAL_SCAN_QUEUE,
  OFFER_WAVE_QUEUE,
  ESCALATE_SHIFT_QUEUE,
  SHIFT_REMINDERS_QUEUE,
  OFFICE_OFFER_QUEUE,
  FIRM_CHANGE_NOTICE_QUEUE,
  REQUEST_UPDATE_QUEUE,
  METRICS_ROLLUP_QUEUE,
  PAY_DIGEST_QUEUE,
  PAY_QUERY_UPDATE_QUEUE,
  INBOUND_MESSAGE_QUEUE,
  RETENTION_PURGE_QUEUE,
];

const sheetsSync = firmQueue(SHEETS_SYNC_QUEUE);

export const QUEUES: readonly QueueSpec[] = [
  { name: HELLO_QUEUE },
  // Crons with no firm and an empty payload; they only queue firm jobs.
  { name: SHEETS_TICK_QUEUE, options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 } },
  {
    name: CREDENTIAL_SCAN_TICK_QUEUE,
    options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 },
  },
  {
    name: SHIFT_REMINDER_TICK_QUEUE,
    options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 },
  },
  {
    name: METRICS_ROLLUP_TICK_QUEUE,
    options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 },
  },
  {
    name: PAY_DIGEST_TICK_QUEUE,
    options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 },
  },
  {
    name: RETENTION_PURGE_TICK_QUEUE,
    options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 },
  },
  ...FIRM_QUEUE_NAMES.map(firmQueue),
  {
    ...sheetsSync,
    options: { ...sheetsSync.options, expireInSeconds: SHEETS_SYNC_EXPIRE_SECONDS },
  },
];
