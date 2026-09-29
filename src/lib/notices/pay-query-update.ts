import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { firms, payQueries, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport } from "../messaging";
import { payQueryUpdateMessage, payQueryUpdatePush } from "../messaging/templates";
import { pushToWorker, sendToWorker, type NotifyDeps, type WorkerChannel } from "../notify/send";
import { getPushTransport } from "../push/transport";
import { mayMessageNow, quietHours } from "../rules/quiet-hours";
import { signOffFor } from "../tenancy/sign-off";
import { oneLineNote } from "./request-update";

// Telling a worker payroll has sorted their pay query (docs/messaging-templates.md
// `pay_query_update`; docs/api-and-jobs.md): one pay-query-update job per query, queued in the
// transaction that sorted it (src/lib/pay/resolve.ts). The payload is the query's id only.
//
// At most once, like the other notices: (1) a short transaction claims it
// (pay_query.update_notice, under an advisory lock on the query) and commits; (2) the message goes
// outside any transaction, by the worker's channel with the WhatsApp-to-text fallback; (3) a
// second short transaction pushes to their phones and logs pay_query.update_sent or _failed. A job
// that stops part-way leaves the claim: the message may have gone, so it's never sent again.
//
// Quiet hours: a pay answer is never urgent, so it waits for them to end (logged
// pay_query.update_held and queued again, never dropped).
//
// The message is the doc's template with payroll's note on one line: a person's words, never an
// AI's (golden rule 9; tests/unit/ai.boundary.test.ts keeps AI code out of this path). The note
// never goes in an event, and the push says nothing about the pay itself.

export const PAY_QUERY_UPDATE_QUEUE = "pay-query-update";

export const payQueryUpdatePayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^pay-query-update:[0-9a-f-]{36}(:after-quiet)?$/),
  payQueryId: z.uuid(),
});
export type PayQueryUpdatePayload = z.infer<typeof payQueryUpdatePayload>;

const job = { queue: PAY_QUERY_UPDATE_QUEUE, schema: payQueryUpdatePayload };

export async function queuePayQueryUpdate(tx: FirmTx, q: { payQueryId: string }): Promise<void> {
  await sendFirmJob(tx, job, {
    idempotencyKey: `pay-query-update:${q.payQueryId}`,
    payQueryId: q.payQueryId,
  });
}

export interface PayQueryUpdateDeps extends NotifyDeps {
  clock: Clock;
}

export type PayQueryUpdateResult =
  | { status: "sent"; channel: WorkerChannel }
  | { status: "failed" }
  | { status: "held"; until: Date }
  | { status: "already" }
  | { status: "gone" }; // no such sorted query

type Claim =
  | {
      status: "send";
      workerId: string;
      mobile: string;
      channel: WorkerChannel;
      body: string;
    }
  | Exclude<PayQueryUpdateResult, { status: "sent" } | { status: "failed" }>;

async function claim(tx: FirmTx, payload: PayQueryUpdatePayload, now: Date): Promise<Claim> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('pay-query-update:' || app_current_firm_id()::text || ':' || ${payload.payQueryId}, 0))`,
  );
  const { rows: done } = await tx.execute(sql`
    select 1 from events
     where entity_id = ${payload.payQueryId} and action = 'pay_query.update_notice'
     limit 1
  `);
  if (done.length > 0) return { status: "already" };
  const [row] = await tx
    .select({
      status: payQueries.status,
      note: payQueries.resolutionNote,
      workerId: workers.id,
      mobile: workers.mobileE164,
      channel: workers.notifyChannel,
      firmName: firms.name,
      timezone: firms.timezone,
      settings: firms.settings,
    })
    .from(payQueries)
    .innerJoin(
      workers,
      and(eq(workers.firmId, payQueries.firmId), eq(workers.id, payQueries.workerId)),
    )
    .innerJoin(firms, eq(firms.id, payQueries.firmId))
    .where(eq(payQueries.id, payload.payQueryId));
  if (!row || row.status !== "resolved" || !row.note) return { status: "gone" };

  // Never urgent: an answer about pay waits for the morning.
  const timing = mayMessageNow({
    now,
    timeZone: row.timezone,
    quiet: quietHours(row.settings),
    urgent: false,
  });
  if (!timing.ok && timing.until.getTime() - now.getTime() > 60_000) {
    await sendFirmJob(
      tx,
      job,
      {
        ...payload,
        idempotencyKey: payload.idempotencyKey.endsWith(":after-quiet")
          ? payload.idempotencyKey
          : `${payload.idempotencyKey}:after-quiet`,
      },
      { startAfter: timing.until },
    );
    await recordEvent(tx, {
      actorType: "system",
      action: "pay_query.update_held",
      entityType: "pay_query",
      entityId: payload.payQueryId,
      data: { workerId: row.workerId, until: timing.until.toISOString() },
    });
    return { status: "held", until: timing.until };
  }

  const voice = { name: row.firmName, signOff: signOffFor(row.firmName, row.settings.sign_off) };
  const body = payQueryUpdateMessage(voice, {
    ref: payload.payQueryId.slice(0, 8).toUpperCase(),
    status: "sorted",
    note: oneLineNote(row.note),
  });
  await recordEvent(tx, {
    actorType: "system",
    action: "pay_query.update_notice",
    entityType: "pay_query",
    entityId: payload.payQueryId,
    data: { workerId: row.workerId, status: "sending" },
  });
  return {
    status: "send",
    workerId: row.workerId,
    mobile: row.mobile,
    channel: row.channel,
    body,
  };
}

export async function runPayQueryUpdate(
  payload: PayQueryUpdatePayload,
  run: WithFirm,
  deps: PayQueryUpdateDeps,
): Promise<PayQueryUpdateResult> {
  const now = deps.clock.now();
  const c = await run(payload.firmId, (tx) => claim(tx, payload, now));
  if (c.status !== "send") return c;
  const sent = await sendToWorker(deps, {
    mobile: c.mobile,
    channel: c.channel,
    body: { whatsapp: c.body, sms: c.body },
  });
  await run(payload.firmId, async (tx) => {
    if (!sent.ok) {
      await recordEvent(tx, {
        actorType: "system",
        action: "pay_query.update_failed",
        entityType: "pay_query",
        entityId: payload.payQueryId,
        data: { workerId: c.workerId, channel: sent.channel, code: sent.code },
      });
      return;
    }
    const pushes = await pushToWorker(tx, deps, c.workerId, {
      ...payQueryUpdatePush(),
      url: "/pay",
    });
    await recordEvent(tx, {
      actorType: "system",
      action: "pay_query.update_sent",
      entityType: "pay_query",
      entityId: payload.payQueryId,
      data: {
        workerId: c.workerId,
        channel: sent.channel,
        providerMessageId: sent.providerMessageId,
        pushes,
        ...(sent.fellBackFrom ? { fellBackFrom: sent.fellBackFrom } : {}),
      },
    });
  });
  return sent.ok ? { status: "sent", channel: sent.channel } : { status: "failed" };
}

export function createPayQueryUpdateTask(
  deps: () => PayQueryUpdateDeps,
): FirmTask<PayQueryUpdatePayload> {
  return {
    queue: PAY_QUERY_UPDATE_QUEUE,
    schema: payQueryUpdatePayload,
    task: (payload, run) => runPayQueryUpdate(payload, run, deps()),
  };
}

const workerDeps = (): PayQueryUpdateDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    push: getPushTransport(env),
    clock: systemClock,
  };
};
export const payQueryUpdateTask = createPayQueryUpdateTask(workerDeps);
