import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Clock } from "@/lib/auth/clock";
import { noAi } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { INBOUND_MESSAGE_QUEUE, INBOUND_RETRY_LIMIT } from "@/lib/inbound/job";
import { receiveSms, receiveWhatsApp } from "@/lib/inbound/receive";
import { inboundMessageTask, type InboundReplyDeps } from "@/lib/inbound/reply";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { loadEnquiries, loadEnquiry } from "@/lib/office/enquiries";
import { sortedStep } from "@/lib/office/enquiries-copy";
import { createBoss } from "@/worker/boss";
import { failedJobCounts, INBOUND_WORK_OPTIONS, registerInboundTask } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";

// The shifts line's last try (13.2): a message whose answer fails on every try is passed to a
// person (Need a person on Enquiries) with the reason logged, once; nothing is sent; and the job
// still fails, so the ops alert for failed jobs reports it. A STOP still turns texts off. The
// faults stand in for a bug before the claim: a clock that throws, or a database call that fails.
// On the real database as the app role; no Twilio, no AI. Numbers are from Ofcom's drama range
// (07700 900200-900399 for the lines here, freed from any earlier test's firm first).

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
  // A message stored as the webhook would; its job's payload and the message's id.
  const queued = async (messageSid: string) => {
    const { rows: jobs } = await su.query<{ data: Record<string, unknown>; message_id: string }>(
      `select j.data, m.id::text as message_id from pgboss.job j
         join messages m on m.id::text = j.data ->> 'messageId'
        where j.name = $1 and m.firm_id = $2 and m.provider_message_id = $3`,
      [INBOUND_MESSAGE_QUEUE, f.firmId, messageSid],
    );
    const job = jobs[0];
    if (jobs.length !== 1 || !job) throw new Error("expected one job for the message");
    return { data: job.data, messageId: job.message_id };
  };
  const incoming = async (body: string, from = mobile) => {
    const messageSid = sid();
    await receiveWhatsApp(f.firmId, { messageSid, from, to: line, body }, { run: withFirm });
    return queued(messageSid);
  };
  const text = async (body: string) => {
    const messageSid = sid();
    await receiveSms(
      f.firmId,
      { messageSid, from: mobile, to: line, body, twilioOptOut: null },
      { run: withFirm },
    );
    return queued(messageSid);
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
      await su.query<{ reply_to: string | null }>(
        "select reply_to::text as reply_to from messages where firm_id = $1 and direction = 'out'",
        [f.firmId],
      )
    ).rows;
  const person = async () =>
    (await withFirm(f.firmId, (tx) => loadEnquiries(tx, "person", new Date()))).rows.map(
      (r) => r.messageId,
    );
  return { f, line, ann, mobile, incoming, text, message, received, replies, person };
}

// A clock that throws: every try fails before the claim, as a bug there would.
const broken: Clock = {
  now() {
    throw new TypeError("a bug before the claim");
  },
};
// A clock that throws or works call by call, in the order given (then works).
function scripted(...plan: ("throw" | "ok")[]): Clock {
  return {
    now() {
      if (plan.shift() === "throw") throw new TypeError("a bug before the claim");
      return new Date();
    },
  };
}
// The database failing for one try's first call (a lost connection: Postgres's 57P01), then back.
function failingFirstCall(): WithFirm {
  let calls = 0;
  return (firmId, fn) => {
    calls += 1;
    if (calls === 1)
      return Promise.reject(Object.assign(new Error("terminating connection"), { code: "57P01" }));
    return withFirm(firmId, fn);
  };
}

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

// One try of the job as the worker runs it: try `retryCount` of the queue's INBOUND_RETRY_LIMIT
// (the limit left out: a job fetched without its metadata).
const attempt = (
  deps: InboundReplyDeps,
  data: Record<string, unknown>,
  retryCount: number,
  o: { run?: WithFirm; withLimit?: boolean } = {},
) =>
  runFirmTask(
    inboundMessageTask(() => deps),
    {
      id: `job-${retryCount}`,
      data,
      retryCount,
      ...(o.withLimit === false ? {} : { retryLimit: INBOUND_RETRY_LIMIT }),
    },
    o.run ?? withFirm,
  );

describe("the shifts line's last try", () => {
  it("fails for a retry until the last try, which passes it to a person, logged once, sends nothing and still fails the job", async () => {
    const t = await lineFirm();
    const { data, messageId } = await t.incoming("is there anything on saturday");
    const { deps, sent } = depsWith(broken);
    for (let n = 0; n < INBOUND_RETRY_LIMIT; n++) {
      expect((await attempt(deps, data, n)).status, `try ${n}`).toBe("failed");
      expect((await t.message(messageId))?.handled_at, `try ${n}`).toBeNull();
    }
    expect(await t.received(messageId)).toEqual([]);
    expect(await t.person()).not.toContain(messageId);

    // The last try: passed to a person, and the job fails with the failure's code (the ops alert).
    expect(await attempt(deps, data, INBOUND_RETRY_LIMIT)).toMatchObject({
      status: "failed",
      output: { error: "handler_failed", code: "TypeError" },
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
    expect(await t.person()).toContain(messageId);
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

  it("a repeat of the last try, or a later try that works, finds it handled: no second mark, nothing sent", async () => {
    const t = await lineFirm();
    const { data, messageId } = await t.incoming("is there anything on saturday");
    const failing = depsWith(broken);
    expect((await attempt(failing.deps, data, INBOUND_RETRY_LIMIT)).status).toBe("failed");
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
      status: "completed",
      output: { status: "already" },
    });
    expect(await t.message(messageId)).toMatchObject({ handled_as: "keyword", intent: "shifts" });
    expect(await t.received(messageId)).toHaveLength(1);
  });

  it("the mark waits for another job's claim on the message, then leaves it alone", async () => {
    const t = await lineFirm();
    const { data, messageId } = await t.incoming("is there anything on saturday");
    // Another job holds the message's row: its claim, not committed yet.
    const other = await su.connect();
    try {
      await other.query("begin");
      await other.query(
        `update messages set handled_at = now(), handled_as = 'keyword', intent = 'shifts'
          where id = $1`,
        [messageId],
      );
      const { deps, sent } = depsWith(broken);
      let settled = false;
      const last = attempt(deps, data, INBOUND_RETRY_LIMIT).then((r) => {
        settled = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 500));
      // The read saw it unanswered, the try failed, and the mark is waiting for the row.
      expect(settled).toBe(false);
      await other.query("commit");
      expect((await last).status).toBe("failed");
      expect(await t.message(messageId)).toMatchObject({ handled_as: "keyword", intent: "shifts" });
      expect(await t.received(messageId)).toEqual([]);
      expect(sent).toEqual([]);
    } finally {
      await other.query("rollback").catch(() => undefined);
      other.release();
    }
  });

  it("a STOP whose answer fails every try still turns texts off, with no confirmation sent", async () => {
    const t = await lineFirm();
    const { data, messageId } = await t.text("STOP");
    const { deps, sent } = depsWith();
    for (let n = 0; n < INBOUND_RETRY_LIMIT; n++)
      expect((await attempt(deps, data, n, { run: failingFirstCall() })).status).toBe("failed");
    expect(
      await attempt(deps, data, INBOUND_RETRY_LIMIT, { run: failingFirstCall() }),
    ).toMatchObject({ status: "failed", output: { code: "57P01" } });
    expect(await t.message(messageId)).toMatchObject({ handled_as: "opt_out", worker_id: t.ann });
    const { rows } = await su.query<{ off: Date | null }>(
      "select sms_opted_out_at as off from workers where id = $1",
      [t.ann],
    );
    expect(rows[0]?.off).toBeInstanceOf(Date);
    expect(await t.received(messageId)).toEqual([
      expect.objectContaining({
        data: {
          channel: "sms",
          handledAs: "opt_out",
          optOut: "stop",
          changed: true,
          answerFailed: "57P01",
          workerId: t.ann,
        },
      }),
    ]);
    const { rows: optedOut } = await su.query(
      "select 1 from events where firm_id = $1 and entity_id = $2 and action = 'worker.sms_opted_out'",
      [t.f.firmId, t.ann],
    );
    expect(optedOut).toHaveLength(1);
    // On Enquiries it reads as the STOP it was, not as a message waiting for a person.
    const page = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, messageId, new Date()));
    expect(page?.timeline.sorted).toEqual({ how: "opt_out" });
    expect(await t.person()).not.toContain(messageId);
    expect(sent).toEqual([]);
  });

  it("a number that isn't a casual's is passed to a person with nobody named", async () => {
    const t = await lineFirm();
    // Any drama-range number that isn't Ann's (the firm's only casual).
    const stranger = t.mobile === "+447700900198" ? "+447700900197" : "+447700900198";
    const { data, messageId } = await t.incoming("hi is this the security firm", stranger);
    const { deps, sent } = depsWith();
    expect(
      (await attempt(deps, data, INBOUND_RETRY_LIMIT, { run: failingFirstCall() })).status,
    ).toBe("failed");
    expect(await t.message(messageId)).toMatchObject({
      handled_as: "office",
      intent: "office",
      worker_id: null,
    });
    expect(await t.received(messageId)).toEqual([
      {
        actor_type: "system",
        actor_id: null,
        data: { channel: "whatsapp", handledAs: "office", intent: "office", answerFailed: "57P01" },
      },
    ]);
    expect(await t.person()).toContain(messageId);
    expect(sent).toEqual([]);
  });

  it("a former casual's message keeps their name on file", async () => {
    const t = await lineFirm();
    const { data, messageId } = await t.incoming("is there anything on saturday");
    await su.query("update workers set status = 'inactive' where id = $1", [t.ann]);
    const { deps } = depsWith();
    await attempt(deps, data, INBOUND_RETRY_LIMIT, { run: failingFirstCall() });
    expect(await t.message(messageId)).toMatchObject({ handled_as: "office", worker_id: t.ann });
    expect(await t.received(messageId)).toEqual([
      expect.objectContaining({
        actor_type: "system",
        data: expect.objectContaining({
          workerId: t.ann,
          formerWorker: true,
          answerFailed: "57P01",
        }),
      }),
    ]);
    expect(await t.person()).toContain(messageId);
  });

  it("an older message that fails is passed on by its own last try, never by a later message's job", async () => {
    const t = await lineFirm();
    const first = await t.incoming("is there anything on saturday");
    const second = await t.incoming("pay");
    // The second's job answers the first before it (it fails: logged and left), then the second.
    // Then the first's own last try fails again and passes it on.
    const { deps, sent } = depsWith(scripted("throw", "ok", "throw"));
    expect(await attempt(deps, second.data, 0)).toMatchObject({
      status: "completed",
      output: { status: "replied", intent: "pay" },
    });
    expect((await t.message(first.messageId))?.handled_at).toBeNull();
    expect((await attempt(deps, first.data, INBOUND_RETRY_LIMIT)).status).toBe("failed");
    expect(await t.message(first.messageId)).toMatchObject({ handled_as: "office" });
    expect(await t.received(first.messageId)).toHaveLength(1);
    expect(await t.received(second.messageId)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect((await t.replies()).map((r) => r.reply_to)).toEqual([second.messageId]);
  });

  it("an error whose name isn't a plain code is logged and shown as unknown", async () => {
    const t = await lineFirm();
    // A strange name, and one that's a run of digits (it could read as a phone number).
    for (const name of ["Not a <code> at all", "07700900123"]) {
      const { data, messageId } = await t.incoming(
        `is there anything on saturday (${name.length})`,
      );
      const odd: Clock = {
        now() {
          const e = new Error("odd");
          e.name = name;
          throw e;
        },
      };
      await attempt(depsWith(odd).deps, data, INBOUND_RETRY_LIMIT);
      expect((await t.received(messageId))[0]?.data, name).toMatchObject({
        answerFailed: "unknown",
      });
    }
  });

  it("without the limit in the job (fetched without its metadata), the queue's own limit counts", async () => {
    const t = await lineFirm();
    const { data, messageId } = await t.incoming("is there anything on saturday");
    const { deps } = depsWith(broken);
    await attempt(deps, data, INBOUND_RETRY_LIMIT - 1, { withLimit: false });
    expect((await t.message(messageId))?.handled_at).toBeNull();
    await attempt(deps, data, INBOUND_RETRY_LIMIT, { withLimit: false });
    expect(await t.message(messageId)).toMatchObject({ handled_as: "office" });
  });
});

describe("through a real pg-boss worker", () => {
  // A queue of its own with the shifts line's own options, so no other test's jobs are touched.
  const QUEUE = `inbound-last-try-${randomUUID().slice(0, 8)}`;
  let boss: PgBoss;
  beforeAll(async () => {
    boss = createBoss(urls.jobs);
    await boss.start();
    const spec = QUEUES.find((q) => q.name === INBOUND_MESSAGE_QUEUE);
    await boss.createQueue(QUEUE, spec?.options);
  });
  afterAll(async () => {
    await boss.offWork(QUEUE);
    await boss.deleteQueue(QUEUE);
    await boss.stop({ graceful: true, timeout: 10_000 });
  });

  const until = async (check: () => Promise<boolean>, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  it("the queue's own retries, 2 seconds apart, then the last try passes it on and the job fails (the ops alert)", async () => {
    expect(QUEUES.find((q) => q.name === INBOUND_MESSAGE_QUEUE)?.options).toMatchObject({
      retryLimit: INBOUND_RETRY_LIMIT,
      retryDelay: 2,
      retryBackoff: false,
    });
    expect(INBOUND_WORK_OPTIONS).toMatchObject({ includeMetadata: true });
    const t = await lineFirm();
    const { data, messageId } = await t.incoming("is there anything on saturday");
    const { deps, sent } = depsWith(broken);
    // Registered as the worker registers it, on this test's queue.
    await registerInboundTask(boss, { ...inboundMessageTask(() => deps), queue: QUEUE });
    const startedAt = Date.now();
    await boss.send(QUEUE, data);
    expect(await until(async () => (await t.received(messageId)).length > 0, 30_000)).toBe(true);
    // The last try within about 15 seconds of the first.
    expect(Date.now() - startedAt).toBeLessThan(20_000);
    expect(await t.received(messageId)).toHaveLength(1);
    expect(sent).toEqual([]);
    expect(
      await until(async () => {
        const { rows } = await su.query<{ state: string }>(
          "select state from pgboss.job where name = $1",
          [QUEUE],
        );
        return rows[0]?.state === "failed";
      }, 10_000),
    ).toBe(true);
    const { rows } = await su.query<{ state: string; retry_count: number }>(
      "select state, retry_count from pgboss.job where name = $1",
      [QUEUE],
    );
    expect(rows).toEqual([{ state: "failed", retry_count: INBOUND_RETRY_LIMIT }]);
    // What the ops alert counts.
    expect(await failedJobCounts(boss)).toContainEqual({ queue: QUEUE, count: 1 });
  }, 45_000);
});
