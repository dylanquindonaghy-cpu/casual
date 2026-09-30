import { z } from "zod";
import { log, type Logger } from "../log";
import { redact } from "../log/mask";

// Alerts to the founder (docs/api-and-jobs.md "Errors and observability"; docs/runbooks.md
// "Alerts from the app"): something is wrong across the platform and someone should look. Built
// from counts, queue names, firm slugs and error codes only: never a name, number, message or
// email (an alert leaves the system, and the founder is the firms' processor, not their office).
// Code decides every alert (fixed thresholds); nothing here uses AI.

export const ALERT_KINDS = [
  "job_failures", // jobs that failed after their last retry
  "sync_failing", // a firm's rota sheet sync failing for over 30 minutes
  "send_failures", // a firm's WhatsApps and texts failing to send
  "health_down", // the web app's health check failing
  "webhook_signatures", // many Twilio webhook requests with a bad signature
  "test", // `npm run ops:test-alert`: checks alerts reach you
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const opsAlertSchema = z.strictObject({
  kind: z.enum(ALERT_KINDS),
  // The same problem has the same key, so it alerts at most once an hour (the ops-alert queue's
  // singleton key).
  key: z.string().regex(/^[a-z0-9:_-]{1,200}$/),
  text: z.string().min(1).max(320),
});
export type OpsAlert = z.infer<typeof opsAlertSchema>;

// Every alert passes the log masker unchanged (no phone number, email or secret-looking field), or
// it isn't sent.
function alert(kind: AlertKind, key: string, text: string): OpsAlert {
  const built = opsAlertSchema.parse({ kind, key, text: `ShiftDesk alert: ${text}` });
  if (JSON.stringify(redact(built)) !== JSON.stringify(built)) {
    throw new Error(`ops alert ${kind} holds personal or secret data`);
  }
  return built;
}

export const THRESHOLDS = {
  // Twilio error spike: more than 5% of a firm's WhatsApps and texts failing to send in the last
  // hour, once there are at least 20 (docs/api-and-jobs.md: "Twilio delivery error rate > 5%").
  sendFailureRate: 0.05,
  sendFailureMinTotal: 20,
  // Bad webhook signatures in the last hour, per web process: one is a scanner; 20 is a wrong auth
  // token or someone probing.
  badSignatures: 20,
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Jobs that failed after their last retry in the last hour, by queue (pg-boss's `failed` state):
// the 5 queues with the most, then how many more, so the words always fit.
const MAX_QUEUES_LISTED = 5;

export function jobFailureAlert(counts: { queue: string; count: number }[]): OpsAlert | null {
  const failing = counts
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.queue.localeCompare(b.queue));
  if (failing.length === 0) return null;
  const total = failing.reduce((sum, c) => sum + c.count, 0);
  const shown = failing.slice(0, MAX_QUEUES_LISTED).map((c) => `${c.queue} ${c.count}`);
  const more = failing.length - shown.length;
  const list =
    more > 0
      ? `${shown.join(", ")} and ${plural(more, "other queue", "other queues")}`
      : shown.join(", ");
  return alert(
    "job_failures",
    "job-failures",
    `${plural(total, "job", "jobs")} failed after the last retry in the last hour (${list}).`,
  );
}

// How an alert names a firm: its slug, or (if the slug would look like a phone number to the log
// masker, which refuses the alert) the start of its id.
export function firmLabel(slug: string, firmId: string): string {
  return JSON.stringify(redact({ slug })) === JSON.stringify({ slug })
    ? slug
    : `firm ${firmId.slice(0, 8)}`;
}

// A firm's enabled rota sheet whose last sync failed (roster_sources.last_error_code).
export function syncAlert(source: { firmId: string; slug: string; code: string }): OpsAlert {
  return alert(
    "sync_failing",
    `sync:${source.firmId}`,
    `${firmLabel(source.slug, source.firmId)}'s rota sheet sync is failing (${source.code}).`,
  );
}

// A firm's WhatsApp and text sends over the last hour: an alert over the threshold.
export function sendFailureAlert(s: {
  firmId: string;
  slug: string;
  sent: number;
  failed: number;
  topCode: string | null;
}): OpsAlert | null {
  const total = s.sent + s.failed;
  if (total < THRESHOLDS.sendFailureMinTotal || s.failed / total <= THRESHOLDS.sendFailureRate) {
    return null;
  }
  const pct = Math.round((s.failed / total) * 100);
  return alert(
    "send_failures",
    `send:${s.firmId}`,
    `${firmLabel(s.slug, s.firmId)}: ${s.failed} of ${total} WhatsApps and texts failed to send in the last hour (${pct}%)${s.topCode ? `, mostly ${s.topCode}` : ""}.`,
  );
}

export type HealthResult = { ok: true } | { ok: false; detail: string };

export function healthAlert(result: HealthResult): OpsAlert | null {
  if (result.ok) return null;
  return alert(
    "health_down",
    "health",
    `the web app's health check is failing (${result.detail}). Check the server.`,
  );
}

export function signatureAlert(count: number): OpsAlert | null {
  if (count < THRESHOLDS.badSignatures) return null;
  return alert(
    "webhook_signatures",
    "webhook-signatures",
    `${count} Twilio webhook requests with a bad signature in the last hour. Check TWILIO_AUTH_TOKEN, or someone is probing.`,
  );
}

export function testAlert(): OpsAlert {
  return alert("test", "test", "a test alert. If you can read this, alerts reach you.");
}

// Where alerts go. "console": one error line in the log (development, and production until the
// phone sender is connected); "none": nowhere (tests).
export interface AlertTransport {
  name: string;
  send(alert: OpsAlert): Promise<void>;
}

export const consoleAlerts = (logger: Logger = log): AlertTransport => ({
  name: "console",
  async send(a) {
    logger.error("ops alert", { alert: a.kind, key: a.key, text: a.text });
  },
});

export const noAlerts: AlertTransport = {
  name: "none",
  async send() {},
};

// ALERTS_TRANSPORT: unset means "console".
export function alertTransport(
  name: "console" | "none" | undefined,
  logger: Logger = log,
): AlertTransport {
  return name === "none" ? noAlerts : consoleAlerts(logger);
}
