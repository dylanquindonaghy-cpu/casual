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
  "send_failures", // a firm's WhatsApps and texts, or (P2.5) its emails, failing to send
  "health_down", // the web app's health check failing
  "webhook_signatures", // many Twilio webhook requests with a bad signature
  "login_links", // a firm sending far more login links than usual (14.2)
  "job_backlog", // jobs waiting too long to start (P4.8)
  "job_running_long", // jobs running past 80% of their time limit (P4.8)
  "connection_waits", // the worker waiting for database connections (P4.8)
  "ai_fallbacks", // many of a firm's messages the AI couldn't sort (P4.8)
  "inbound_volume", // a firm's shifts line getting far more messages than usual (P4.8)
  "offer_volume", // a firm sending far more offers than usual (P4.8)
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
  // Login links a firm sent its casuals (by WhatsApp and text; by email too since P2.6) in the
  // last hour (14.2): the backstop for the
  // per-address limit (60 every 15 minutes since 13.5, so one address alone can ask for 240 an
  // hour). A briefing of about 50 on one venue's Wi-Fi is the busiest real case; each link is a
  // paid message. An alert, not a ceiling: a ceiling would lock a whole firm's casuals out. A
  // starting number: revisit it with a pilot firm's real mornings.
  loginLinksPerHour: 100,
  // And over 24 hours, for a slow drip that stays under the hourly one (14.2 guardrails review):
  // each number gets at most 10 links a day, so links to a crew's numbers spread through the day
  // could run to hundreds. A casual stays logged in for 30 days, so even a firm of 300 needs far
  // fewer in a day. Also a starting number.
  loginLinksPerDay: 300,
  // Seeing a backlog (P4.8). How long a job may wait to start (pg-boss `created` or `retry`, and
  // due): a casual's message (they're waiting for the answer), an offer wave (a place is unfilled),
  // anything else.
  backlogSeconds: { inbound: 60, waves: 2 * 60, other: 15 * 60 },
  // A job still running past this share of its time limit (pg-boss's expiry, `expire_seconds`):
  // pg-boss will stop it and run it again.
  runningLongShare: 0.8,
  // The worker's waits for a database connection since the last tick (5 minutes; scoped.ts
  // takeConnectionWaits): any that ran out (that job failed, and is retried), or this many of a
  // second or more. A starting number.
  slowConnectionWaits: 5,
  // A firm's messages in the last hour the AI was asked to sort but couldn't (no answer in time, or
  // not a label), once there are at least 20: each went to the office instead. The AI not connected
  // isn't counted (nothing was asked).
  aiFallbackRate: 0.2,
  aiFallbackMinTotal: 20,
  // A firm's messages in, and offers out, in the last hour: far more than the busiest firm P4 is
  // built for (1,000 messages in 10 minutes as a burst; a wave is at most 50 offers). Alerts, not
  // ceilings. Starting numbers: revisit them with a pilot firm's real weeks.
  inboundPerHour: 1_500,
  offersPerHour: 500,
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

// Seconds as an alert says them: "45 s" under 2 minutes, then "3 min".
const waited = (seconds: number) =>
  seconds < 120 ? `${Math.max(0, Math.round(seconds))} s` : `${Math.round(seconds / 60)} min`;

// The queues an alert names: the first 3, then how many more, so the words always fit.
const MAX_QUEUES_NAMED = 3;
function queueList(parts: string[]): string {
  const shown = parts.slice(0, MAX_QUEUES_NAMED);
  const more = parts.length - shown.length;
  return more > 0
    ? `${shown.join("; ")}; and ${plural(more, "other queue", "other queues")}`
    : shown.join("; ");
}

// A queue's jobs waiting to start (pg-boss `created` or `retry`, due now): how many, the oldest's
// wait, and the queue's limit (backlogLimitSeconds in tick.ts).
export interface QueueWait {
  queue: string;
  waiting: number;
  oldestSeconds: number;
  limitSeconds: number;
}

// Queues whose oldest waiting job is past its limit, the furthest past first.
export function backlogAlert(waits: QueueWait[]): OpsAlert | null {
  const late = waits
    .filter((w) => w.waiting > 0 && w.oldestSeconds > w.limitSeconds)
    .sort(
      (a, b) =>
        b.oldestSeconds / b.limitSeconds - a.oldestSeconds / a.limitSeconds ||
        a.queue.localeCompare(b.queue),
    );
  if (late.length === 0) return null;
  const parts = late.map(
    (w) =>
      `${w.queue} ${w.waiting} waiting, the oldest ${waited(w.oldestSeconds)} (limit ${waited(w.limitSeconds)})`,
  );
  return alert(
    "job_backlog",
    "job-backlog",
    `jobs are waiting too long to start: ${queueList(parts)}. Check the worker is running and keeping up.`,
  );
}

// A queue's running jobs past THRESHOLDS.runningLongShare of their time limit: how many, and the
// furthest along (its share of the limit, 0.8 and up).
export interface QueueRunningLong {
  queue: string;
  count: number;
  longestShare: number;
}

export function runningLongAlert(rows: QueueRunningLong[]): OpsAlert | null {
  const long = rows
    .filter((r) => r.count > 0)
    .sort((a, b) => b.longestShare - a.longestShare || a.queue.localeCompare(b.queue));
  if (long.length === 0) return null;
  const parts = long.map(
    (r) => `${r.queue} ${r.count}, the longest at ${Math.round(r.longestShare * 100)}%`,
  );
  return alert(
    "job_running_long",
    "job-running-long",
    `jobs are running past ${Math.round(THRESHOLDS.runningLongShare * 100)}% of their time limit: ${queueList(parts)}. pg-boss stops and reruns a job at its limit.`,
  );
}

// The worker's waits for a database connection since the last tick, and its pool's size.
export function connectionWaitAlert(w: {
  slow: number;
  timedOut: number;
  poolMax: number;
}): OpsAlert | null {
  if (w.timedOut === 0 && w.slow < THRESHOLDS.slowConnectionWaits) return null;
  const ranOut =
    w.timedOut > 0
      ? `, and ${plural(w.timedOut, "wait", "waits")} ran out (those jobs failed, and will run again)`
      : "";
  return alert(
    "connection_waits",
    "connection-waits",
    `the worker waited a second or more for a database connection ${plural(w.slow, "time", "times")} in the last 5 minutes${ranOut}. Its ${w.poolMax} connections are all busy: look for slow queries, or give it more.`,
  );
}

// How an alert names a firm: its slug, or (if the slug would look like a phone number to the log
// masker, which refuses the alert) the start of its id.
export function firmLabel(slug: string, firmId: string): string {
  return JSON.stringify(redact({ slug })) === JSON.stringify({ slug })
    ? slug
    : `firm ${firmId.slice(0, 8)}`;
}

// A firm's enabled rota sheet whose last sync failed, or connector whose last pull did
// (roster_sources.last_error_code).
export function syncAlert(source: {
  firmId: string;
  slug: string;
  code: string;
  kind?: "sheets" | "connector"; // a connector's reconcile pull (P5.4) says so
}): OpsAlert {
  const what = source.kind === "connector" ? "connector's reconcile pull" : "rota sheet sync";
  return alert(
    "sync_failing",
    `sync:${source.firmId}`,
    `${firmLabel(source.slug, source.firmId)}'s ${what} is failing (${source.code}).`,
  );
}

// A firm's WhatsApp and text sends over the last hour: an alert over the threshold.
// Texts (WhatsApp and text messages) and, since P2.5, emails, each counted apart with the same
// thresholds and their own key: with no text sender, a casual's messages go by push or email, and
// an email provider that stops sending must be noticed as a text provider would be.
export function sendFailureAlert(s: {
  firmId: string;
  slug: string;
  sent: number;
  failed: number;
  topCode: string | null;
  by?: "texts" | "email";
}): OpsAlert | null {
  const total = s.sent + s.failed;
  if (total < THRESHOLDS.sendFailureMinTotal || s.failed / total <= THRESHOLDS.sendFailureRate) {
    return null;
  }
  const pct = Math.round((s.failed / total) * 100);
  const email = s.by === "email";
  return alert(
    "send_failures",
    email ? `send-email:${s.firmId}` : `send:${s.firmId}`,
    `${firmLabel(s.slug, s.firmId)}: ${s.failed} of ${total} ${email ? "emails" : "WhatsApps and texts"} failed to send in the last hour (${pct}%)${s.topCode ? `, mostly ${s.topCode}` : ""}.`,
  );
}

// A firm's login links to its casuals (sent or tried; by WhatsApp and text, and by email since
// P2.6) over the last hour, and over the last
// 24 hours: an alert for each over its threshold (each its own key, so one never hides the other).
export function loginLinkAlerts(s: {
  firmId: string;
  slug: string;
  lastHour: number;
  lastDay: number;
}): OpsAlert[] {
  const label = firmLabel(s.slug, s.firmId);
  const alerts: OpsAlert[] = [];
  if (s.lastHour > THRESHOLDS.loginLinksPerHour) {
    alerts.push(
      alert(
        "login_links",
        `logins:${s.firmId}`,
        `${label}: ${s.lastHour} login links to casuals in the last hour. A big briefing can do that; if not, someone may be running up the firm's messages. Check the action log's Logins.`,
      ),
    );
  }
  if (s.lastDay > THRESHOLDS.loginLinksPerDay) {
    alerts.push(
      alert(
        "login_links",
        `logins-day:${s.firmId}`,
        `${label}: ${s.lastDay} login links to casuals in the last 24 hours, far more than a firm needs. Someone may be running up the firm's messages. Check the action log's Logins.`,
      ),
    );
  }
  return alerts;
}

// A firm's messages the AI was asked to sort in the last hour, and how many it couldn't.
export function aiFallbackAlert(s: {
  firmId: string;
  slug: string;
  asked: number;
  fellBack: number;
}): OpsAlert | null {
  if (
    s.asked < THRESHOLDS.aiFallbackMinTotal ||
    s.fellBack / s.asked <= THRESHOLDS.aiFallbackRate
  ) {
    return null;
  }
  const pct = Math.round((s.fellBack / s.asked) * 100);
  return alert(
    "ai_fallbacks",
    `ai:${s.firmId}`,
    `${firmLabel(s.slug, s.firmId)}: the AI couldn't sort ${s.fellBack} of ${s.asked} messages in the last hour (${pct}%), so they went to the office. Check the AI's key and Anthropic's status.`,
  );
}

// A firm's messages in, and offers out, over the last hour: an alert for each over its threshold
// (each its own key).
export function volumeAlerts(s: {
  firmId: string;
  slug: string;
  inbound: number;
  offers: number;
}): OpsAlert[] {
  const label = firmLabel(s.slug, s.firmId);
  const alerts: OpsAlert[] = [];
  if (s.inbound > THRESHOLDS.inboundPerHour) {
    alerts.push(
      alert(
        "inbound_volume",
        `inbound:${s.firmId}`,
        `${label}: ${s.inbound} messages came in to the shifts line in the last hour, far more than a firm's busiest. A big event can do that; if not, something may be flooding the line.`,
      ),
    );
  }
  if (s.offers > THRESHOLDS.offersPerHour) {
    alerts.push(
      alert(
        "offer_volume",
        `offers:${s.firmId}`,
        `${label}: ${s.offers} offers went out in the last hour, far more than usual. Check the firm's wave settings, and for a shift reopening again and again.`,
      ),
    );
  }
  return alerts;
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
