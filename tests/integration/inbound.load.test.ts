import { randomBytes, randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noAi } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { inboundJobOptions, inboundMessagePayload } from "@/lib/inbound/job";
import { inboundMessageTask, runInboundMessage } from "@/lib/inbound/reply";
import { sendFirmJob } from "@/lib/jobs/firm-job";
import type { MessagingTransport, OutboundMessage } from "@/lib/messaging/transport";
import { createBoss } from "@/worker/boss";
import { INBOUND_DRAIN_BOUND_MS, registerInboundTask } from "@/worker/jobs";
import { firmQueue } from "@/worker/jobs/queues";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { testUrls } from "../setup/test-db";

// The shifts line at pilot size (audit finding M14): each answer waits on the provider, so with
// one job at a time 200 WhatsApps took a minute or more to answer once a real send took ~300 ms.
// Here the real inbound task, registered exactly as the worker does (registerInboundTask), answers
// through a fake provider that takes 300 ms a message: 200 workers' messages are all answered
// within INBOUND_DRAIN_BOUND_MS of the last one arriving, and one worker's messages are still
// answered in the order they came (a STOP before the text after it). A queue of its own, so other
// test files' jobs are never touched. Real database, a real pg-boss worker, nothing sent anywhere.

const urls = testUrls();
const QUEUE = `inbound-load-${randomUUID().slice(0, 8)}`;
const SEND_MS = 300;
let su: Pool;
let app: Pool;
let withFirm: WithFirm;
let boss: PgBoss;
const sent: { startedAt: number; at: number; message: OutboundMessage }[] = [];

beforeAll(async () => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
  const slow: MessagingTransport = {
    name: "slow",
    async send(message) {
      const startedAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, SEND_MS));
      sent.push({ startedAt, at: Date.now(), message });
      return { providerMessageId: `SM${randomBytes(16).toString("hex")}` };
    },
  };
  boss = createBoss(urls.jobs);
  await boss.start();
  await boss.createQueue(QUEUE, firmQueue(QUEUE).options);
  await registerInboundTask(boss, {
    ...inboundMessageTask(() => ({ transport: slow, ai: noAi, baseDomain: "localhost:3000" })),
    queue: QUEUE,
  });
});
afterAll(async () => {
  await boss.offWork(QUEUE);
  await boss.deleteQueue(QUEUE);
  await boss.stop({ graceful: true, timeout: 30_000 });
  await Promise.all([su.end(), app.end()]);
});

// 07700 900450-900498: never NO_FIRM_LINE (900499), and this file's firms keep their line after
// it ends.
async function freshLine(): Promise<string> {
  const line = `+447700900${450 + Math.floor(Math.random() * 49)}`;
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [line]);
  return line;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the shifts line at pilot size, with a real send's delay", () => {
  it("200 workers' messages answered within the bound; one worker's answered in order", async () => {
    // Automatic replies on: what these tests are about (off by default since P4.7).
    const f = await bookingFirm(su, withFirm, { settings: { auto_replies: true } });
    const line = await freshLine();
    await su.query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line]);
    const workers: { id: string; mobile: string }[] = [];
    for (let i = 0; i < 202; i += 1) {
      const id = await f.worker({ first: `W${i}` });
      const { rows } = await su.query<{ mobile: string }>(
        "select mobile_e164 as mobile from workers where id = $1",
        [id],
      );
      workers.push({ id, mobile: rows[0]?.mobile ?? "" });
    }
    const [burst, stopper, ...rest] = workers as [
      { id: string; mobile: string },
      { id: string; mobile: string },
      ...{ id: string; mobile: string }[],
    ];
    // The STOP sender has chosen texts: after STOP, an answer must never go by text.
    await su.query("update workers set notify_channel = 'sms' where id = $1", [stopper.id]);

    // Each message stored and queued as the webhook does: one transaction each, in order.
    const store = async (from: string, body: string, channel: "whatsapp" | "sms") => {
      const { rows } = await su.query<{ id: string }>(
        `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164, body)
         values ($1, 'in', $2, $3, $4, $5, $6) returning id::text as id`,
        [f.firmId, channel, `SM${randomBytes(16).toString("hex")}`, from, line, body],
      );
      const messageId = rows[0]?.id ?? "";
      await withFirm(f.firmId, async (tx) =>
        sendFirmJob(
          tx,
          { queue: QUEUE, schema: inboundMessagePayload },
          { idempotencyKey: `inbound-message:${messageId}`, messageId },
          await inboundJobOptions(tx, messageId),
        ),
      );
      return messageId;
    };
    const burstIds: string[] = [];
    burstIds.push(await store(burst.mobile, "Any shifts?", "whatsapp"));
    await store(stopper.mobile, "STOP", "sms");
    for (const w of rest.slice(0, 100)) await store(w.mobile, "Any shifts?", "whatsapp");
    for (let i = 0; i < 4; i += 1)
      burstIds.push(await store(burst.mobile, "Any shifts?", "whatsapp"));
    await store(stopper.mobile, "shifts", "sms");
    for (const w of rest.slice(100)) await store(w.mobile, "Any shifts?", "whatsapp");
    const lastArrived = Date.now();
    const total = 200 + 5 + 2;

    // Every message answered: its reply sent and stored (a message is marked handled when it's
    // claimed, just before its reply goes), within the bound.
    for (;;) {
      const { rows } = await su.query<{ n: number }>(
        "select count(*)::int as n from messages where firm_id = $1 and direction = 'out'",
        [f.firmId],
      );
      if ((rows[0]?.n ?? 0) >= total) break;
      if (Date.now() - lastArrived > INBOUND_DRAIN_BOUND_MS) {
        throw new Error(`${rows[0]?.n} of ${total} answered after ${INBOUND_DRAIN_BOUND_MS} ms`);
      }
      await sleep(200);
    }
    const drained = Date.now() - lastArrived;
    expect(drained).toBeLessThan(INBOUND_DRAIN_BOUND_MS);

    // One answer each (the STOP's confirmation included), each to the right number.
    const mine = sent.filter(
      (s) => "to" in s.message && workers.some((w) => w.mobile === s.message.to),
    );
    expect(mine).toHaveLength(total);
    for (const w of rest) {
      expect(mine.filter((s) => s.message.to === w.mobile)).toHaveLength(1);
    }

    // The burst: its replies stored in the order the messages came.
    const { rows: replies } = await su.query<{ reply_to: string }>(
      `select reply_to::text from messages
        where firm_id = $1 and direction = 'out' and reply_to = any($2::uuid[])
        order by created_at`,
      [f.firmId, burstIds],
    );
    expect(replies.map((r) => r.reply_to)).toEqual(burstIds);

    // The STOP came first: texts off, then the next answer by WhatsApp, never by text.
    const toStopper = mine
      .filter((s) => s.message.to === stopper.mobile)
      .sort((a, b) => a.at - b.at);
    expect(toStopper.map((s) => s.message.channel)).toEqual(["sms", "whatsapp"]);

    // Never two sends to one number at once: each starts after the one before it finished.
    for (const w of [burst, stopper]) {
      const to = mine
        .filter((s) => s.message.to === w.mobile)
        .sort((a, b) => a.startedAt - b.startedAt);
      for (let i = 1; i < to.length; i += 1) {
        expect(to[i]?.startedAt).toBeGreaterThanOrEqual(to[i - 1]?.at ?? Infinity);
      }
    }

    // Every job's group is the firm and the worker's id: never a phone number (golden rule: ids only).
    const { rows: groups } = await su.query<{ group_id: string | null }>(
      "select group_id from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [QUEUE, f.firmId],
    );
    expect(groups).toHaveLength(total);
    const ids = new Set(workers.map((w) => w.id));
    for (const { group_id } of groups) {
      const m = /^([0-9a-f-]{36}):w:([0-9a-f-]{36})$/.exec(group_id ?? "");
      expect(m?.[1]).toBe(f.firmId);
      expect(ids.has(m?.[2] ?? "")).toBe(true);
    }
  }, 120_000);

  it("a sender's older message is answered first, even when the newer one's job runs first", async () => {
    // Automatic replies on: what these tests are about (off by default since P4.7).
    const f = await bookingFirm(su, withFirm, { settings: { auto_replies: true } });
    const line = await freshLine();
    await su.query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line]);
    const id = await f.worker({ first: "Sid" });
    await su.query("update workers set notify_channel = 'sms' where id = $1", [id]);
    const { rows } = await su.query<{ mobile: string }>(
      "select mobile_e164 as mobile from workers where id = $1",
      [id],
    );
    const mobile = rows[0]?.mobile ?? "";
    const store = async (body: string) =>
      (
        await su.query<{ id: string }>(
          `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164, body)
           values ($1, 'in', 'sms', $2, $3, $4, $5) returning id::text as id`,
          [f.firmId, `SM${randomBytes(16).toString("hex")}`, mobile, line, body],
        )
      ).rows[0]?.id ?? "";
    await store("STOP");
    const later = await store("shifts");
    const out: OutboundMessage[] = [];
    const transport: MessagingTransport = {
      name: "capture",
      async send(message) {
        out.push(message);
        return { providerMessageId: `SM${randomBytes(16).toString("hex")}` };
      },
    };
    // Only the later message's job runs: it answers the STOP first, then itself.
    expect(
      await runInboundMessage(
        { firmId: f.firmId, idempotencyKey: `inbound-message:${later}`, messageId: later },
        withFirm,
        { transport, ai: noAi, baseDomain: "localhost:3000" },
      ),
    ).toMatchObject({ status: "replied", intent: "shifts" });
    expect(out.map((m) => m.channel)).toEqual(["sms", "whatsapp"]);
    const { rows: handled } = await su.query<{ n: number }>(
      "select count(*)::int as n from messages where firm_id = $1 and direction = 'in' and handled_at is not null",
      [f.firmId],
    );
    expect(handled[0]?.n).toBe(2);
  });
});
