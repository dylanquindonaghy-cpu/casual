import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Clock } from "@/lib/auth/clock";
import { noAi } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { INBOUND_MESSAGE_QUEUE, INBOUND_RETRY_LIMIT } from "@/lib/inbound/job";
import { receiveWhatsApp } from "@/lib/inbound/receive";
import { inboundMessageTask, type InboundReplyDeps } from "@/lib/inbound/reply";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { loadEnquiries, loadEnquiry } from "@/lib/office/enquiries";
import { sortedStep } from "@/lib/office/enquiries-copy";
import { createBoss } from "@/worker/boss";
import { INBOUND_WORK_OPTIONS, registerInboundTask } from "@/worker/jobs";
import { ensureQueues, QUEUES } from "@/worker/jobs/queues";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";

// The shifts line's last try (13.2): a message whose answer fails on every try is passed to a
// person (Need a person on Enquiries) with the reason logged, once, and nothing is sent. The fault
// is a clock that throws, standing in for a bug before the claim; on the real database as the app
// role, no Twilio and no AI. Numbers are from Ofcom's drama range (07700 900200-900399 for the
// lines here, freed from any earlier test's firm first).

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const sid = () => `SM${randomBytes(16).toString("hex")}`;
let nextLine = Math.floor(Math.random() * 200);
async function freshLine(): Promise<string> {
  nextLine = (nextLine + 1) % 200;
  const line = `+447700900${200 + nextLine}`;
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [line]);
  return line;
}

async function lineFirm() {
  const f = await bookingFirm(su, withFirm);
  const line = await freshLine();
  await su.query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line]);
  const ann = await f.worker({ first: "Ann" });
  const { rows } = await su.query<{ mobile: string }>(
    "select mobile_e164 as mobile from workers where id = $1",
    [ann],
  );
  const mobile = rows[0]?.mobile ?? "";
  // A WhatsApp stored as the webhook would; its job's payload.
  const incoming = async (body: string) => {
    const messageSid = sid();
    await receiveWhatsApp(
      f.firmId,
      { messageSid, from: mobile, to: line, body },
      { run: withFirm },
    );
    const { rows: queued } = await su.query<{ data: Record<string, unknown>; message_id: string }>(
      `select j.data, m.id::text as message_id from pgboss.job j
         join messages m on m.id::text = j.data ->> 'messageId'
        where j.name = $1 and m.firm_id = $2 and m.provider_message_id = $3`,
      [INBOUND_MESSAGE_QUEUE, f.firmId, messageSid],
    );
    const job = queued[0];
    if (queued.length !== 1 || !job) throw new Error("expected one job for the message");
    return { data: job.data, messageId: job.message_id };
  };
  const message = async (id: string) =>
    (
      await su.query<{
        handled_at: Date | null;
        handled_as: string | null;
        intent: string | null;
        worker_id: string | null;
      }>(
        "select handled_at, handled_as, intent, worker_id::text as worker_id from messages where id = $1",
        [id],
      )
    ).rows[0];
  const received = async (id: string) =>
    (
      await su.query<{
        actor_type: string;
        actor_id: string | null;
        data: Record<string, unknown>;
      }>(
        `select actor_type, actor_id::text as actor_id, data from events
          where firm_id = $1 and entity_id = $2 and action = 'message.received' order by id`,
        [f.firmId, id],
      )
    ).rows;
  const replies = async () =>
    (
      await su.query<{ id: string }>(
        "select id::text as id from messages where firm_id = $1 and direction = 'out'",
        [f.firmId],
      )
    ).rows;
  return { f, line, ann, mobile, incoming, message, received, replies };
}

// A clock that throws: every try fails before the claim, as a bug there would.
const broken: Clock = {
  now() {
    throw new TypeError("a bug before the claim");
  },
};
function depsWith(clock?: Clock) {
  const capture = captureTransport();
  const deps: InboundReplyDeps = {
    transport: capture.transport,
    ai: noAi,
    baseDomain: "shiftdesk.test",
    ...(clock ? { clock } : {}),
  };
  return { deps, sent: capture.sent };
}

// One try of the job, as the worker runs it (try `retryCount` of the queue's INBOUND_RETRY_LIMIT).
const attempt = (
  deps: InboundReplyDeps,
  data: Record<string, unknown>,
  retryCount: number,
  run: WithFirm = withFirm,
) =>
  runFirmTask(
    inboundMessageTask(() => deps),
    { id: `job-${retryCount}`, data, retryCount, retryLimit: INBOUND_RETRY_LIMIT },
    run,
  );

describe("the shifts line's last try", () => {
  it("fails for a retry until the last try, which passes the message to a person, logged once, sending nothing", async () => {
    const t = await lineFirm();
    const { data, messageId } = await t.incoming("is there anything on saturday");
    const { deps, sent } = depsWith(broken);
    for (let n = 0; n < INBOUND_RETRY_LIMIT; n++) {
      const r = await attempt(deps, data, n);
      expect(r.status, `try ${n}`).toBe("failed");
      expect((await t.message(messageId))?.handled_at, `try ${n}`).toBeNull();
    }
    expect(await t.received(messageId)).toEqual([]);

    const last = await attempt(deps, data, INBOUND_RETRY_LIMIT);
    expect(last).toMatchObject({
      status: "completed",
      output: { status: "for_a_person", code: "TypeError" },
    });
    expect(await t.message(messageId)).toMatchObject({
      handled_as: "office",
      intent: "office",
      worker_id: t.ann,
    });
    expect(await t.received(messageId)).toEqual([
      {
        actor_type: "worker",
        actor_id: t.ann,
        data: {
          channel: "whatsapp",
          handledAs: "office",
          intent: "office",
          answerFailed: "TypeError",
          workerId: t.ann,
        },
      },
    ]);
    expect(sent).toEqual([]);
    expect(await t.replies()).toEqual([]);

    // The office sees it in Need a person, and why.
    const list = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(list.rows.map((r) => r.messageId)).toContain(messageId);
    const page = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, messageId, new Date()));
    expect(page?.waiting).toBe(true);
    expect(page?.timeline.sorted).toEqual({
      how: "person",
      why: "answer_failed",
      code: "TypeError",
    });
    expect(page && sortedStep(page.timeline.sorted)).toBe(
      "The automatic answer failed on every try (TypeError): passed to a person.",
    );
  });

  it("a repeat of the last try, or a later try that works, doesn't mark or answer it again", async () => {
    const t = await lineFirm();
    const { data, messageId } = await t.incoming("is there anything on saturday");
    const failing = depsWith(broken);
    await attempt(failing.deps, data, INBOUND_RETRY_LIMIT);
    // pg-boss runs a job at least once: the last try again.
    expect(await attempt(failing.deps, data, INBOUND_RETRY_LIMIT)).toMatchObject({
      status: "completed",
      output: { status: "already" },
    });
    // And a working try after it (another job for the same message, say).
    const working = depsWith();
    expect(await attempt(working.deps, data, 0)).toMatchObject({
      status: "completed",
      output: { status: "already" },
    });
    expect(await t.received(messageId)).toHaveLength(1);
    expect([...failing.sent, ...working.sent]).toEqual([]);
    expect(await t.replies()).toEqual([]);
  });

  it("a message answered before the last try is left as it was", async () => {
    const t = await lineFirm();
    const { data, messageId } = await t.incoming("shifts");
    const failing = depsWith(broken);
    expect((await attempt(failing.deps, data, 0)).status).toBe("failed");
    // The second try works and answers it.
    const working = depsWith();
    expect(await attempt(working.deps, data, 1)).toMatchObject({
      output: { status: "replied", intent: "shifts" },
    });
    expect(await attempt(failing.deps, data, INBOUND_RETRY_LIMIT)).toMatchObject({
      output: { status: "already" },
    });
    expect(await t.message(messageId)).toMatchObject({ handled_as: "keyword", intent: "shifts" });
    expect(await t.received(messageId)).toHaveLength(1);
  });

  it("if another job answers it while the last try fails, the mark leaves it alone", async () => {
    const t = await lineFirm();
    const { data, messageId } = await t.incoming("is there anything on saturday");
    // Between the failure and the mark, another job's claim commits (the superuser's update here).
    let claimFirst = false;
    const racing: Clock = {
      now() {
        claimFirst = true;
        throw new TypeError("a bug before the claim");
      },
    };
    const run: WithFirm = async (firmId, fn) => {
      if (claimFirst) {
        claimFirst = false;
        await su.query(
          `update messages set handled_at = now(), handled_as = 'keyword', intent = 'shifts'
            where id = $1 and handled_at is null`,
          [messageId],
        );
      }
      return withFirm(firmId, fn);
    };
    const { deps, sent } = depsWith(racing);
    expect(await attempt(deps, data, INBOUND_RETRY_LIMIT, run)).toMatchObject({
      output: { status: "already" },
    });
    expect(await t.message(messageId)).toMatchObject({ handled_as: "keyword", intent: "shifts" });
    expect(await t.received(messageId)).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("through a real pg-boss worker", () => {
  let boss: PgBoss;
  beforeAll(async () => {
    boss = createBoss(urls.jobs);
    await boss.start();
    await ensureQueues(
      boss,
      QUEUES.filter((q) => q.name === INBOUND_MESSAGE_QUEUE),
    );
  });
  afterAll(async () => {
    await boss.stop({ graceful: false });
  });

  const until = async (check: () => Promise<boolean>, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  it("the queue's own retries, then the last try marks it once and leaves no failed job", async () => {
    expect(QUEUES.find((q) => q.name === INBOUND_MESSAGE_QUEUE)?.options).toMatchObject({
      retryLimit: INBOUND_RETRY_LIMIT,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 60,
    });
    expect(INBOUND_WORK_OPTIONS).toMatchObject({ includeMetadata: true });
    const t = await lineFirm();
    const { messageId } = await t.incoming("is there anything on saturday");
    // No waiting between tries in a test: the queue's own waits are in queues.ts.
    await su.query(
      `update pgboss.job set retry_delay = 0, retry_backoff = false, retry_delay_max = null
        where name = $1 and data ->> 'firmId' = $2`,
      [INBOUND_MESSAGE_QUEUE, t.f.firmId],
    );
    const { deps } = depsWith(broken);
    // Registered as the worker registers it (its own options), tried by pg-boss itself.
    await registerInboundTask(
      boss,
      inboundMessageTask(() => deps),
    );
    try {
      expect(await until(async () => (await t.received(messageId)).length > 0, 30_000)).toBe(true);
    } finally {
      await boss.offWork(INBOUND_MESSAGE_QUEUE);
    }
    expect(await t.received(messageId)).toHaveLength(1);
    // This message's job (the worker also takes what earlier test files left queued): tried
    // 1 + INBOUND_RETRY_LIMIT times by pg-boss, then completed, not failed.
    const { rows } = await su.query<{ state: string; retry_count: number }>(
      "select state, retry_count from pgboss.job where name = $1 and data ->> 'messageId' = $2",
      [INBOUND_MESSAGE_QUEUE, messageId],
    );
    expect(rows).toEqual([{ state: "completed", retry_count: INBOUND_RETRY_LIMIT }]);
  }, 45_000);
});
