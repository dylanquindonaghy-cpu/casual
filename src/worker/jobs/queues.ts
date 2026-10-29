import type { PgBoss, Queue } from "pg-boss";
import { SEND_LOGIN_CODE_QUEUE } from "../../lib/auth/send-login-code";
import { SEND_PORTAL_LINK_QUEUE } from "../../lib/auth/send-portal-link";
import { CREDENTIAL_SCAN_QUEUE, CREDENTIAL_SCAN_TICK_QUEUE } from "../../lib/credentials/scan";
import { FIRM_CHANGE_NOTICE_QUEUE } from "../../lib/notices/firm-change";
import { METRICS_ROLLUP_QUEUE, METRICS_ROLLUP_TICK_QUEUE } from "../../lib/metrics/rollup";
import { INBOUND_MESSAGE_QUEUE, INBOUND_RETRY_LIMIT } from "../../lib/inbound/job";
import { PAY_QUERY_UPDATE_QUEUE } from "../../lib/notices/pay-query-update";
import { ENQUIRY_REPLY_QUEUE } from "../../lib/notices/enquiry-reply";
import { REQUEST_UPDATE_QUEUE } from "../../lib/notices/request-update";
import { SHIFT_CONFIRMED_QUEUE } from "../../lib/notices/shift-confirmed";
import { PAY_DIGEST_QUEUE, PAY_DIGEST_TICK_QUEUE } from "../../lib/pay/digest";
import { OFFICE_OFFER_QUEUE } from "../../lib/offers/office-offer";
import { STRIKES_EMAIL_LINK_QUEUE } from "../../lib/office/strikes-email";
import { STRIKE_EVIDENCE_QUEUE } from "../../lib/strikes/evidence-queue";
import { TRAVEL_ESTIMATES_QUEUE } from "../../lib/travel/estimate-queue";
import { TRAVEL_ESTIMATES_TICK_QUEUE, TRAVEL_JOB_EXPIRE_SECONDS } from "../../lib/travel/estimates";
import { ESCALATE_SHIFT_QUEUE, OFFER_WAVE_QUEUE } from "../../lib/offers/waves";
import { SHIFT_REMINDER_TICK_QUEUE, SHIFT_REMINDERS_QUEUE } from "../../lib/reminders/send";
import {
  SHEETS_SYNC_EXPIRE_SECONDS,
  SHEETS_SYNC_QUEUE,
  SHEETS_TICK_QUEUE,
} from "../../lib/roster/sheets/jobs";
import { RETENTION_PURGE_QUEUE, RETENTION_PURGE_TICK_QUEUE } from "../../lib/gdpr/retention";
import { OPS_ALERT_QUEUE, OPS_ALERTS_TICK_QUEUE } from "../../lib/ops/tick";
import { WEBHOOK_DELIVER_QUEUE } from "../../lib/integrations/outbox";
import { WEBHOOK_RETRY_LIMIT } from "../../lib/integrations/deliver";
import { CONNECTOR_EVENT_QUEUE, CONNECTOR_RETRY_LIMIT } from "../../lib/connector/job";
import {
  CONNECTOR_PULL_EXPIRE_SECONDS,
  CONNECTOR_PULL_QUEUE,
  CONNECTOR_PULL_TICK_QUEUE,
} from "../../lib/connector/pull";
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
  ENQUIRY_REPLY_QUEUE,
  METRICS_ROLLUP_QUEUE,
  PAY_DIGEST_QUEUE,
  PAY_QUERY_UPDATE_QUEUE,
  RETENTION_PURGE_QUEUE,
  STRIKES_EMAIL_LINK_QUEUE,
  STRIKE_EVIDENCE_QUEUE,
];

const sheetsSync = firmQueue(SHEETS_SYNC_QUEUE);
const travelEstimates = firmQueue(TRAVEL_ESTIMATES_QUEUE);
const webhookDeliver = firmQueue(WEBHOOK_DELIVER_QUEUE);
const inboundMessage = firmQueue(INBOUND_MESSAGE_QUEUE);
const connectorEvent = firmQueue(CONNECTOR_EVENT_QUEUE);
const connectorPull = firmQueue(CONNECTOR_PULL_QUEUE);

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
    name: TRAVEL_ESTIMATES_TICK_QUEUE,
    options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 },
  },
  {
    name: OPS_ALERTS_TICK_QUEUE,
    options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 },
  },
  {
    name: CONNECTOR_PULL_TICK_QUEUE,
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
  // The travel job (src/lib/travel/estimates.ts) fails when the provider doesn't answer: tried
  // again 6 times, at least 5 minutes later, then at least 10, 20 and 40, then an hour apart
  // (pg-boss adds a random part: 3 to 4 hours in all), so an outage is waited out without
  // hammering the provider; the nightly run catches up after that. A run stops itself at
  // TRAVEL_JOB_BUDGET_MS (10 minutes), inside its expiry; the worker takes these jobs one at a time
  // (TRAVEL_WORK_OPTIONS, src/worker/jobs/index.ts), since a batch shares one expiry.
  {
    ...travelEstimates,
    options: {
      ...travelEstimates.options,
      expireInSeconds: TRAVEL_JOB_EXPIRE_SECONDS,
      retryLimit: 6,
      retryDelay: 5 * 60,
      retryBackoff: true,
      retryDelayMax: 60 * 60,
    },
  },
  // The shifts line (13.2; src/lib/inbound/reply.ts): a reply that fails is tried again 3 times,
  // 2 seconds apart (no backoff: pg-boss's doubling, with its random part, would make a waiting
  // casual wait 35 to 70 seconds), so with the worker's polling the last try comes after about
  // 15 seconds of waiting, plus each try's own time. The last try passes the message to a person (Need a person on Enquiries), then the
  // job still fails: the failure is ours, and the ops alert for failed jobs reports it.
  {
    ...inboundMessage,
    options: {
      ...inboundMessage.options,
      retryLimit: INBOUND_RETRY_LIMIT,
      retryDelay: 2,
      retryBackoff: false,
    },
  },
  // The planner's webhooks (12J.2; src/lib/integrations/deliver.ts): a failed try is tried again
  // 6 times, from a minute later and doubling (pg-boss adds a random part), at most 30 minutes
  // apart: about an hour in all. The last try logs webhook.failed and completes the job, so a
  // firm's own endpoint is never a failed job (failedJobCounts()).
  {
    ...webhookDeliver,
    options: {
      ...webhookDeliver.options,
      retryLimit: WEBHOOK_RETRY_LIMIT,
      retryDelay: 60,
      retryBackoff: true,
      retryDelayMax: 30 * 60,
    },
  },
  // A connector's reconcile pull (P5.4; src/lib/connector/pull.ts): given up on before its lease
  // runs out. A source that doesn't answer is saved on the source, not thrown: the next tick's
  // pull tries again, backing off while failing.
  {
    ...connectorPull,
    options: { ...connectorPull.options, expireInSeconds: CONNECTOR_PULL_EXPIRE_SECONDS },
  },
  // A connector's events (P5.3; src/lib/connector/apply.ts): a read from the firm's own system
  // that fails is tried again 5 times, from a minute later and doubling, at most 30 minutes apart
  // (about an hour). The last try records the event as failed and completes the job; the
  // reconcile pull (P5.4) catches up.
  {
    ...connectorEvent,
    options: {
      ...connectorEvent.options,
      retryLimit: CONNECTOR_RETRY_LIMIT,
      retryDelay: 60,
      retryBackoff: true,
      retryDelayMax: 30 * 60,
    },
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
