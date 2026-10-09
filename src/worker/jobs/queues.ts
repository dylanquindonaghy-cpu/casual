import type { PgBoss, Queue } from "pg-boss";
import { SEND_LOGIN_CODE_QUEUE } from "../../lib/auth/send-login-code";
import { SEND_PORTAL_LINK_QUEUE } from "../../lib/auth/send-portal-link";
import { CREDENTIAL_SCAN_QUEUE, CREDENTIAL_SCAN_TICK_QUEUE } from "../../lib/credentials/scan";
import { FIRM_CHANGE_NOTICE_QUEUE } from "../../lib/notices/firm-change";
import { METRICS_ROLLUP_QUEUE, METRICS_ROLLUP_TICK_QUEUE } from "../../lib/metrics/rollup";
import { INBOUND_MESSAGE_QUEUE } from "../../lib/inbound/job";
import { PAY_QUERY_UPDATE_QUEUE } from "../../lib/notices/pay-query-update";
import { REQUEST_UPDATE_QUEUE } from "../../lib/notices/request-update";
import { SHIFT_CONFIRMED_QUEUE } from "../../lib/notices/shift-confirmed";
import { PAY_DIGEST_QUEUE, PAY_DIGEST_TICK_QUEUE } from "../../lib/pay/digest";
import { OFFICE_OFFER_QUEUE } from "../../lib/offers/office-offer";
import { STRIKES_EMAIL_LINK_QUEUE } from "../../lib/office/strikes-email";
import { STRIKE_EVIDENCE_QUEUE } from "../../lib/strikes/evidence-queue";
import { ESCALATE_SHIFT_QUEUE, OFFER_WAVE_QUEUE } from "../../lib/offers/waves";
import { SHIFT_REMINDER_TICK_QUEUE, SHIFT_REMINDERS_QUEUE } from "../../lib/reminders/send";
import {
  SHEETS_SYNC_EXPIRE_SECONDS,
  SHEETS_SYNC_QUEUE,
  SHEETS_TICK_QUEUE,
} from "../../lib/roster/sheets/jobs";
import { RETENTION_PURGE_QUEUE, RETENTION_PURGE_TICK_QUEUE } from "../../lib/gdpr/retention";
import { OPS_ALERT_QUEUE, OPS_ALERTS_TICK_QUEUE } from "../../lib/ops/tick";
import { HELLO_QUEUE } from "./hello";

// Every queue the app uses. db:migrate creates them (so the web can enqueue before the worker
// has ever started) and the worker does again on boot (ensureQueues: created when missing, and
// brought up to these options when they exist, so a setting added later reaches every database).

export interface QueueSpec {
  name: string;
  options?: Omit<Queue, "name">;
}

// Firm queues must use the standard policy: the other policies dedupe across the whole queue,
// so one firm's job could silently stop another firm's. They must not be partitioned either (the
// web's enqueue policy lives on pgboss.job_common). Payloads and outputs are ids only, but pgboss
// has no RLS, so finished jobs are kept for a day, not pg-boss's default week.
//
// Heartbeats: the worker fetches up to 5 jobs at a time (src/worker/jobs/index.ts) and marks them
// all active. If the process is killed mid-batch (out of memory, a host reboot), the ones it hadn't
// started would wait for pg-boss's 15-minute expiry before anyone retried them: a worker's
// "instant" WhatsApp answered 15 minutes late. With a heartbeat the worker refreshes every job it
// holds every 15 seconds, and pg-boss's supervisor (every SUPERVISE_SECONDS, src/worker/boss.ts)
// retries any whose heartbeat stops for 30: back within about a minute of the crash
// (tests/integration/jobs.crash.test.ts). Every firm job is safe to run again (claim → send →
// record), so a retry sends nothing twice.
export const FIRM_HEARTBEAT_SECONDS = 30;

export function firmQueue(name: string): QueueSpec {
  return {
    name,
    options: {
      policy: "standard",
      deleteAfterSeconds: 24 * 60 * 60,
      heartbeatSeconds: FIRM_HEARTBEAT_SECONDS,
    },
  };
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
  SHIFT_CONFIRMED_QUEUE,
  REQUEST_UPDATE_QUEUE,
  METRICS_ROLLUP_QUEUE,
  PAY_DIGEST_QUEUE,
  PAY_QUERY_UPDATE_QUEUE,
  INBOUND_MESSAGE_QUEUE,
  RETENTION_PURGE_QUEUE,
  STRIKES_EMAIL_LINK_QUEUE,
  STRIKE_EVIDENCE_QUEUE,
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
  {
    name: OPS_ALERTS_TICK_QUEUE,
    options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 },
  },
  // Alerts to the founder (no firm): each alert's key is a singleton for the hour, so an ongoing
  // problem is sent at most once an hour. The payload is counts, slugs and codes only.
  {
    name: OPS_ALERT_QUEUE,
    options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 },
  },
  ...FIRM_QUEUE_NAMES.map(firmQueue),
  {
    ...sheetsSync,
    options: { ...sheetsSync.options, expireInSeconds: SHEETS_SYNC_EXPIRE_SECONDS },
  },
];

// Creates every queue, and updates any that exist to the options above (createQueue alone leaves an
// existing queue as it was). A queue's policy can't change once made, so it isn't passed again.
export async function ensureQueues(
  boss: Pick<PgBoss, "createQueue" | "updateQueue">,
  queues: readonly QueueSpec[] = QUEUES,
): Promise<void> {
  for (const queue of queues) {
    await boss.createQueue(queue.name, queue.options);
    if (queue.options) {
      const { policy, ...rest } = queue.options;
      void policy; // fixed at creation
      if (Object.keys(rest).length > 0) await boss.updateQueue(queue.name, rest);
    }
  }
}
