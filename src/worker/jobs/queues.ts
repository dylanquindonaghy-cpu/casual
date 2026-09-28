import type { Queue } from "pg-boss";
import { SEND_LOGIN_CODE_QUEUE } from "../../lib/auth/send-login-code";
import { SEND_PORTAL_LINK_QUEUE } from "../../lib/auth/send-portal-link";
import {
  SHEETS_SYNC_EXPIRE_SECONDS,
  SHEETS_SYNC_QUEUE,
  SHEETS_TICK_QUEUE,
} from "../../lib/roster/sheets/jobs";
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
const FIRM_QUEUE_NAMES: readonly string[] = [SEND_PORTAL_LINK_QUEUE, SEND_LOGIN_CODE_QUEUE];

const sheetsSync = firmQueue(SHEETS_SYNC_QUEUE);

export const QUEUES: readonly QueueSpec[] = [
  { name: HELLO_QUEUE },
  // A cron with no firm and an empty payload; it only queues firm jobs.
  { name: SHEETS_TICK_QUEUE, options: { policy: "standard", deleteAfterSeconds: 24 * 60 * 60 } },
  ...FIRM_QUEUE_NAMES.map(firmQueue),
  {
    ...sheetsSync,
    options: { ...sheetsSync.options, expireInSeconds: SHEETS_SYNC_EXPIRE_SECONDS },
  },
];
