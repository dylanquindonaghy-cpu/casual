import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { noAi, type AiClient } from "../ai/client";
import { factsPhrase } from "../ai/pay-summary";
import { events, firms, officeUsers, payQueries } from "../db/schema";
import { uuidArray } from "../db/arrays";
import { retryAborted } from "../db/retry";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent, recordEvents } from "../events/record";
import { errorCode, firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { officeUserMay } from "../office/office-context";
import { getTransport, type MessagingTransport } from "../messaging";
import { payDigestEmail, type FirmVoice } from "../messaging/templates";
import {
  loadPayQueryGroups,
  summariseGroups,
  type PayQueryGroup,
} from "../office/pay-query-groups";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { addDays, localDateOf } from "../time/zoned";
import { payDigestCsv, payDigestFilename } from "./digest-list";
import { digestDueOn, digestSchedule } from "./digest-schedule";
import { regroupPayQueries } from "./grouping";

// The payroll digest (docs/api-and-jobs.md `pay-digest`; docs/messaging-templates.md
// `pay_digest`): the new pay queries, grouped by likely cause, emailed to payroll at the firm's
// digest time with the list attached.
// - pay-digest-tick: a cron every 5 minutes (no firm). Queues one pay-digest per firm whose digest
//   is due (digest-schedule.ts), keyed by the firm-local date: once a day.
// - pay-digest: one firm's digest (a firm task, also queued by "Send the digest now" with a key of
//   its own). At most once per key:
//   1. transaction 1, under a lock for the firm: nothing if the key already ran; regroup (a pay
//      line imported since moves a query to the right group); the oldest 1,000 open queries, marked
//      in_digest (so a second digest can't send them too), each logged `pay_query.in_digest`, and
//      the digest logged `pay_digest.sending`;
//   2. outside any transaction: the AI's line for the biggest groups (none until Bedrock is
//      connected), then the email to each recipient;
//   3. transaction 2, under the same lock and run again if Postgres aborts it (a deadlock): sent
//      to anyone, `pay_digest.sent`; sent to no one, the queries go back to open for the next
//      digest (each logged `pay_query.back_to_open`) and `pay_digest.failed`. Any failed send
//      counts, even one that might have been delivered (a timeout): a query listed twice is
//      better than one payroll never sees.
//   A crash after transaction 1 leaves the queries in_digest (on payroll's page, not sent again);
//   the page says a digest that never finished may not have gone.
// The email holds counts and the groups' facts; names and what workers wrote go in the attached
// list only. AI never decides anything here: the groups and their headings are code's
// (golden rules 1 and 9).

export const PAY_DIGEST_QUEUE = "pay-digest";
export const PAY_DIGEST_TICK_QUEUE = "pay-digest-tick";
export const PAY_DIGEST_TICK_CRON = "*/5 * * * *";
// Queries in one digest (the oldest first). With details of up to 1,000 characters, 1,000 rows keep
// the attached list well within the attachment's size limit (tests/unit/pay.digest-copy.test.ts).
export const PAY_DIGEST_ROWS = 1000;
export const PAY_DIGEST_AI_GROUPS = 10; // groups given an AI line (each call can take seconds)

const DAY_SECONDS = 24 * 60 * 60;
const KEY_PREFIX = "pay-digest:";
const KEY =
  /^pay-digest:\d{4}-\d{2}-\d{2}(?::now:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/;

export const DIGEST_ACTIONS = {
  sending: "pay_digest.sending",
  sent: "pay_digest.sent",
  failed: "pay_digest.failed",
  skipped: "pay_digest.skipped",
} as const;

// The firm-local date the digest is for rides in the key ("pay-digest:2026-11-02", or with
// ":now:<id>" when payroll asked for it), so a retry after midnight is the same digest. A digest
// payroll asked for carries who asked.
export const payDigestPayload = firmJobEnvelope.extend({
  idempotencyKey: z
    .string()
    .regex(KEY)
    .refine((key) => {
      const date = key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 10);
      return addDays(date, 0) === date;
    }, "a real calendar date"),
  officeUserId: z.uuid().optional(),
});
export type PayDigestPayload = z.infer<typeof payDigestPayload>;

export const payDigestJob = { queue: PAY_DIGEST_QUEUE, schema: payDigestPayload };

export interface PayDigestDeps {
  transport: MessagingTransport;
  ai: AiClient;
  baseDomain: string;
  logger?: Logger;
  aiTimeoutMs?: number; // per group (default AI_SUMMARY_TIMEOUT_MS); tests pass a short one
}

export type PayDigestResult =
  | { status: "sent"; queries: number; groups: number; recipients: number; failed: number }
  | { status: "failed"; queries: number; code: string }
  | { status: "already" }
  | { status: "nothing_new" }
  | { status: "no_recipients"; queries: number };

// Who gets the digest: active payroll users with an address the email can go to; when the firm has
// none, active admins (someone must). Addresses it can't go to are counted, never allowed to stop
// the digest for everyone else.
async function digestRecipients(tx: FirmTx): Promise<{ emails: string[]; skipped: number }> {
  const office = await tx
    .select({ email: officeUsers.email, role: officeUsers.role })
    .from(officeUsers)
    .where(and(eq(officeUsers.status, "active"), inArray(officeUsers.role, ["payroll", "admin"])))
    .orderBy(asc(officeUsers.email));
  const usable = (role: string) =>
    office.filter((o) => o.role === role && z.email().safeParse(o.email).success);
  const payroll = usable("payroll");
  const chosen = payroll.length > 0 ? payroll : usable("admin");
  const considered = office.filter(
    (o) => o.role === "payroll" || (payroll.length === 0 && o.role === "admin"),
  );
  return { emails: chosen.map((o) => o.email), skipped: considered.length - chosen.length };
}

type Claim =
  | { kind: "done"; result: PayDigestResult }
  | {
      kind: "send";
      ids: string[];
      groups: PayQueryGroup[];
      timeZone: string;
      recipients: string[];
      skipped: number;
      earlier: number;
      later: number;
      voice: FirmVoice;
      slug: string;
    };

const countWhere = async (tx: FirmTx, status: "open" | "in_digest") => {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(payQueries)
    .where(eq(payQueries.status, status));
  return row?.n ?? 0;
};

async function lockFirmDigest(tx: FirmTx): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('pay-digest:' || app_current_firm_id()::text, 0))`,
  );
}

async function claimDigest(
  tx: FirmTx,
  payload: PayDigestPayload,
  date: string,
  actor: { actorType: "system" } | { actorType: "office"; actorId: string },
): Promise<Claim> {
  // One digest per firm at a time: the second waits here, then finds its key done or the
  // queries already in a digest.
  await lockFirmDigest(tx);
  const key = payload.idempotencyKey;
  const [ran] = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        inArray(events.action, [DIGEST_ACTIONS.sending, DIGEST_ACTIONS.skipped]),
        // A key's events are written the day it's queued: the window keeps this on the index.
        gte(events.createdAt, sql`now() - interval '3 days'`),
        sql`${events.data} ->> 'key' = ${key}`,
      ),
    )
    .limit(1);
  if (ran) return { kind: "done", result: { status: "already" } };

  await regroupPayQueries(tx);
  const open = await tx
    .select({ id: payQueries.id })
    .from(payQueries)
    .where(eq(payQueries.status, "open"))
    .orderBy(asc(payQueries.createdAt), asc(payQueries.id))
    .limit(PAY_DIGEST_ROWS + 1)
    .for("update");
  const skip = async (reason: "nothing_new" | "no_recipients", queries: number) => {
    await recordEvent(tx, {
      ...actor,
      action: DIGEST_ACTIONS.skipped,
      entityType: "firm",
      data: { key, date, reason, queries },
    });
  };
  if (open.length === 0) {
    await skip("nothing_new", 0);
    return { kind: "done", result: { status: "nothing_new" } };
  }
  const ids = open.slice(0, PAY_DIGEST_ROWS).map((r) => r.id);
  const later = open.length > PAY_DIGEST_ROWS ? (await countWhere(tx, "open")) - ids.length : 0;

  const { emails, skipped } = await digestRecipients(tx);
  if (emails.length === 0) {
    // The queries stay open: the next digest has them once someone can receive it.
    await skip("no_recipients", ids.length + later);
    return { kind: "done", result: { status: "no_recipients", queries: ids.length + later } };
  }

  await tx
    .update(payQueries)
    .set({ status: "in_digest" })
    .where(and(sql`${payQueries.id} = any(${uuidArray(ids)})`, eq(payQueries.status, "open")));
  const { timeZone, groups } = await loadPayQueryGroups(tx, { ids });
  const earlier = (await countWhere(tx, "in_digest")) - ids.length;
  const [firm] = await tx
    .select({ name: firms.name, slug: firms.slug, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  if (!firm) throw new Error("firm not visible inside its own transaction");
  await recordEvent(tx, {
    ...actor,
    action: DIGEST_ACTIONS.sending,
    entityType: "firm",
    data: { key, date, queries: ids.length, groups: groups.length, recipients: emails.length },
  });
  // Each query's change, in the transaction that made it (golden rule 5).
  await recordEvents(
    tx,
    ids.map((id) => ({
      ...actor,
      action: "pay_query.in_digest",
      entityType: "pay_query",
      entityId: id,
      data: { digestKey: key },
    })),
  );
  return {
    kind: "send",
    ids,
    groups,
    timeZone,
    recipients: emails,
    skipped,
    earlier,
    later,
    voice: { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) },
    slug: firm.slug,
  };
}

export async function runPayDigest(
  payload: PayDigestPayload,
  run: WithFirm,
  deps: PayDigestDeps,
): Promise<PayDigestResult> {
  const logger = deps.logger ?? log;
  const key = payload.idempotencyKey;
  const date = key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 10);
  const actor = payload.officeUserId
    ? { actorType: "office" as const, actorId: payload.officeUserId }
    : { actorType: "system" as const };
  const claim = await run(payload.firmId, (tx) => claimDigest(tx, payload, date, actor));
  if (claim.kind === "done") return claim.result;

  // The AI's line for the biggest groups, outside any transaction (none until Bedrock is
  // connected: every heading stays the code's line).
  const top = await summariseGroups(claim.groups.slice(0, PAY_DIGEST_AI_GROUPS), deps.ai, {
    timeoutMs: deps.aiTimeoutMs,
  });
  const groups = [...top, ...claim.groups.slice(PAY_DIGEST_AI_GROUPS)];
  const biggest = groups[0];
  const filename = payDigestFilename(date);
  const email = payDigestEmail(claim.voice, {
    total: claim.ids.length,
    biggest: biggest ? { count: biggest.queries.length, facts: factsPhrase(biggest.facts) } : null,
    groups: groups.map((g) => ({ heading: g.heading, aiLine: g.aiLine })),
    earlier: claim.earlier,
    later: claim.later,
    filename,
    link: `${portalUrl(claim.slug, deps.baseDomain)}/office/pay-queries`,
  });
  const attachment = {
    filename,
    contentType: "text/csv" as const,
    content: payDigestCsv(groups, claim.timeZone),
  };
  let sent = 0;
  const failures: string[] = [];
  for (const to of claim.recipients) {
    try {
      await deps.transport.send({ channel: "email", to, ...email, attachments: [attachment] });
      sent += 1;
    } catch (err) {
      const code = errorCode(err);
      failures.push(code);
      logger.warn("pay digest: an email failed", { firmId: payload.firmId, code });
    }
  }

  // Database work only, so safe to run again if Postgres aborts it; the lock keeps it from
  // crossing a claim's regrouping.
  return retryAborted(() =>
    run(payload.firmId, async (tx): Promise<PayDigestResult> => {
      await lockFirmDigest(tx);
      if (sent === 0) {
        // Nobody got it: the queries go back to open, so the next digest has them.
        const back = await tx
          .update(payQueries)
          .set({ status: "open" })
          .where(
            and(
              sql`${payQueries.id} = any(${uuidArray(claim.ids)})`,
              eq(payQueries.status, "in_digest"),
            ),
          )
          .returning({ id: payQueries.id });
        await recordEvents(
          tx,
          back.map((q) => ({
            ...actor,
            action: "pay_query.back_to_open",
            entityType: "pay_query",
            entityId: q.id,
            data: { digestKey: key, reason: "send_failed" },
          })),
        );
        const code = failures[0] ?? "unknown";
        await recordEvent(tx, {
          ...actor,
          action: DIGEST_ACTIONS.failed,
          entityType: "firm",
          data: {
            key,
            date,
            queries: claim.ids.length,
            recipients: claim.recipients.length,
            code,
          },
        });
        return { status: "failed", queries: claim.ids.length, code };
      }
      await recordEvent(tx, {
        ...actor,
        action: DIGEST_ACTIONS.sent,
        entityType: "firm",
        data: {
          key,
          date,
          queries: claim.ids.length,
          groups: groups.length,
          recipients: sent,
          failed: failures.length,
          skipped: claim.skipped,
        },
      });
      return {
        status: "sent",
        queries: claim.ids.length,
        groups: groups.length,
        recipients: sent,
        failed: failures.length,
      };
    }),
  );
}

export function payDigestTask(deps: () => PayDigestDeps): FirmTask<PayDigestPayload> {
  return { ...payDigestJob, task: (payload, run) => runPayDigest(payload, run, deps()) };
}

// The worker's wiring. Deps are read when the job runs. No AI yet: "Connect Bedrock" (PLAN.md
// Parking lot) replaces `noAi` with the Bedrock client.
export const payDigestFirmTask = payDigestTask(() => {
  const env = workerEnv();
  return { transport: getTransport(env), ai: noAi, baseDomain: env.APP_BASE_DOMAIN };
});

export interface PayDigestTickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  clock?: Clock;
  logger?: Logger;
}

// One scheduled digest per firm per local date: later ticks that day queue nothing new (the
// singleton, and the job's own check). One firm's failure never stops the others'.
export async function runPayDigestTick(deps: PayDigestTickDeps): Promise<{ queued: number }> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  let queued = 0;
  for (const firmId of await deps.listFirmIds()) {
    try {
      const id = await deps.run(firmId, async (tx) => {
        const [firm] = await tx
          .select({ timezone: firms.timezone, settings: firms.settings })
          .from(firms)
          .where(eq(firms.id, firmId));
        if (!firm) return null;
        const date = digestDueOn(now, firm.timezone, digestSchedule(firm.settings));
        if (!date) return null;
        const key = `${KEY_PREFIX}${date}`;
        return sendFirmJob(
          tx,
          payDigestJob,
          { idempotencyKey: key },
          { singletonKey: key, singletonSeconds: DAY_SECONDS },
        );
      });
      if (id !== null) queued += 1;
    } catch (err) {
      logger.error("pay digest tick failed for a firm", { firmId, error: err });
    }
  }
  return { queued };
}

export type SendDigestNowResult =
  | { status: "queued"; queries: number; recipients: number }
  | { status: "just_asked" } // one was asked for less than a minute ago
  | { status: "nothing_new" }
  | { status: "no_recipients" }
  | { status: "not_allowed" };

// "Send the digest now" on payroll's page: an active payroll user or admin (checked here, inside
// the firm's transaction) queues a digest of the new queries at once, as its own job.
export async function queuePayDigestNow(
  run: WithFirm,
  firmId: string,
  by: { type: "office"; id: string },
  deps: { clock?: Clock } = {},
): Promise<SendDigestNowResult> {
  const now = (deps.clock ?? systemClock).now();
  return run(firmId, async (tx): Promise<SendDigestNowResult> => {
    if (!(await officeUserMay(tx, by.id, "pay"))) return { status: "not_allowed" };
    const queries = await countWhere(tx, "open");
    if (queries === 0) return { status: "nothing_new" };
    const { emails } = await digestRecipients(tx);
    if (emails.length === 0) return { status: "no_recipients" };
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    const date = localDateOf(now, firm?.timezone ?? "Europe/London");
    // A double press within the minute queues one digest (the first has every new query anyway).
    const id = await sendFirmJob(
      tx,
      payDigestJob,
      { idempotencyKey: `${KEY_PREFIX}${date}:now:${randomUUID()}`, officeUserId: by.id },
      { singletonKey: "pay-digest-now", singletonSeconds: 60 },
    );
    if (id === null) return { status: "just_asked" };
    return { status: "queued", queries, recipients: emails.length };
  });
}

export interface DigestStatus {
  lastSent: { at: Date; queries: number; recipients: number; failed: number } | null;
  // The latest digest that didn't go, or may not have (it stopped part way), when it's newer than
  // the last one sent.
  problem: { at: Date; reason: "failed" | "no_recipients" | "unfinished" } | null;
  sendingSince: Date | null; // a digest started in the last 30 minutes and not finished yet
}

// A digest still "sending" after this long stopped part way: shown as one that may not have gone.
const SENDING_SHOWN_MS = 30 * 60_000;

// For payroll's page: the last digest sent, and anything since that didn't go. `now` is the real
// time (event times are the database's).
export async function loadDigestStatus(tx: FirmTx, now: Date = new Date()): Promise<DigestStatus> {
  const recent = await tx
    .select({ action: events.action, data: events.data, createdAt: events.createdAt })
    .from(events)
    .where(
      and(
        inArray(events.action, Object.values(DIGEST_ACTIONS)),
        gte(events.createdAt, sql`now() - interval '60 days'`),
      ),
    )
    .orderBy(desc(events.id))
    .limit(200);
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const sent = recent.find((e) => e.action === DIGEST_ACTIONS.sent);
  const lastSent = sent
    ? {
        at: sent.createdAt,
        queries: num(sent.data.queries),
        recipients: num(sent.data.recipients),
        failed: num(sent.data.failed),
      }
    : null;
  const finished = new Set(
    recent
      .filter((e) => e.action === DIGEST_ACTIONS.sent || e.action === DIGEST_ACTIONS.failed)
      .map((e) => e.data.key),
  );
  const unfinished = (e: (typeof recent)[number]) =>
    e.action === DIGEST_ACTIONS.sending && !finished.has(e.data.key);
  const young = (e: (typeof recent)[number]) =>
    now.getTime() - e.createdAt.getTime() < SENDING_SHOWN_MS;
  const newer = (e: (typeof recent)[number]) => !lastSent || e.createdAt > lastSent.at;
  // Newest first, so the first match is the latest.
  const problemEvent = recent.find(
    (e) =>
      newer(e) &&
      (e.action === DIGEST_ACTIONS.failed ||
        (e.action === DIGEST_ACTIONS.skipped && e.data.reason === "no_recipients") ||
        (unfinished(e) && !young(e))),
  );
  const problem: DigestStatus["problem"] = problemEvent
    ? {
        at: problemEvent.createdAt,
        reason:
          problemEvent.action === DIGEST_ACTIONS.failed
            ? "failed"
            : problemEvent.action === DIGEST_ACTIONS.sending
              ? "unfinished"
              : "no_recipients",
      }
    : null;
  const sending = recent.find((e) => unfinished(e) && young(e));
  return { lastSent, problem, sendingSince: sending?.createdAt ?? null };
}
