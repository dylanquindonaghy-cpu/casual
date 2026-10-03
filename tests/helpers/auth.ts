import type { Pool } from "pg";
import type { Clock } from "@/lib/auth/clock";
import { createSendPortalLinkTask } from "@/lib/auth/send-portal-link";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { createLogger } from "@/lib/log";
import type { MessagingTransport, OutboundMessage } from "@/lib/messaging";

// Test doubles for the login flow: a transport that records what would have been sent, and a
// clock tests can move. Everything else (database, RLS, jobs) is real.

export function captureTransport() {
  const sent: OutboundMessage[] = [];
  const transport: MessagingTransport = {
    name: "capture",
    async send(message) {
      sent.push(message);
      return { providerMessageId: `capture-${sent.length}` };
    },
  };
  return { transport, sent };
}

export function movableClock(start = new Date()) {
  let now = start;
  const clock: Clock = { now: () => now };
  return {
    clock,
    set: (d: Date) => {
      now = d;
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

export const quietLogger = createLogger({ write: () => undefined });

// The newest queued send-portal-link job for a firm, as the worker would fetch it.
export async function latestLinkJob(su: Pool, firmId: string) {
  const { rows } = await su.query<{ id: string; data: Record<string, unknown> }>(
    `select id::text, data from pgboss.job
      where name = 'send-portal-link' and data ->> 'firmId' = $1
      order by created_on desc limit 1`,
    [firmId],
  );
  return rows[0];
}

// Runs a queued job exactly as the worker does (runFirmTask -> withFirm -> handler).
export async function runLinkJob(
  job: { id: string; data: unknown },
  deps: { transport: MessagingTransport; clock: Clock; baseDomain?: string },
) {
  const def = createSendPortalLinkTask(() => ({
    transport: deps.transport,
    clock: deps.clock,
    baseDomain: deps.baseDomain ?? "localhost:3000",
  }));
  return runFirmTask(def, job, undefined, quietLogger);
}

// The token from a login message: http://<slug>.localhost:3000/l#<token>
export function tokenFrom(message: OutboundMessage | undefined): string {
  const match = /\/l#([A-Za-z0-9_-]{43})\b/.exec(message?.body ?? "");
  if (!match?.[1]) throw new Error(`no login link in: ${message?.body}`);
  return match[1];
}

export async function mobileOf(su: Pool, workerId: string): Promise<string> {
  const { rows } = await su.query<{ m: string }>(
    "select mobile_e164 as m from workers where id = $1",
    [workerId],
  );
  return rows[0]?.m ?? "";
}

// The newest event id right now. Tests take a mark before acting and read events after it, so
// no clock (the test host's or the database's) decides which events belong to the test.
export async function eventMark(su: Pool): Promise<number> {
  const { rows } = await su.query<{ id: string | null }>("select max(id)::text as id from events");
  return Number(rows[0]?.id ?? 0);
}

export async function eventsFor(su: Pool, firmId: string, mark: number) {
  const { rows } = await su.query<{
    action: string;
    actor_type: string;
    actor_id: string | null;
    entity_type: string;
    entity_id: string | null;
    data: Record<string, unknown>;
  }>(
    `select action, actor_type, actor_id::text, entity_type, entity_id::text, data from events
      where firm_id = $1 and id > $2 and action like 'auth.%' order by id`,
    [firmId, mark],
  );
  return rows;
}
