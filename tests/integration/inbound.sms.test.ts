import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noAi } from "@/lib/ai/client";
import { createLineDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { INBOUND_MESSAGE_QUEUE } from "@/lib/inbound/job";
import { receiveSms } from "@/lib/inbound/receive";
import { runInboundMessage } from "@/lib/inbound/reply";
import { twilioSignature } from "@/lib/inbound/twilio-signature";
import { handleTwilioSms } from "@/lib/inbound/webhook";
import type { MessagingTransport } from "@/lib/messaging/transport";
import { loadToday } from "@/lib/office/today";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Texts to the shifts line (Phase 7): Twilio's SMS webhook (src/lib/inbound/webhook.ts) and STOP
// and START in the reply job (src/lib/inbound/opt-out.ts), on the real database as the app role.
// No Twilio: signed requests are built with a test key and replies go to a capturing transport.
// Numbers are from Ofcom's drama range (07700 900600-900999 for the firms' lines here, freed
// before use).

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

const TOKEN = "test-twilio-auth-token-0123456789";
const WEBHOOK = "https://shiftdesk.test/api/webhooks/twilio/sms";
const sid = () => `SM${randomBytes(16).toString("hex")}`;
const STRANGER = "+447700900994";

let nextLine = Math.floor(Math.random() * 400);
async function freshLine(): Promise<string> {
  nextLine = (nextLine + 1) % 400;
  const line = `+447700900${600 + nextLine}`;
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [line]);
  return line;
}

async function lineFirm() {
  const f = await bookingFirm(su, withFirm);
  const line = await freshLine();
  await su.query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line]);
  const ann = await f.worker({ first: "Ann" });
  const { rows } = await su.query<{ mobile: string; slug: string; name: string }>(
    `select w.mobile_e164 as mobile, f.slug, f.name from workers w join firms f on f.id = w.firm_id
      where w.id = $1`,
    [ann],
  );
  const { mobile = "", slug = "", name = "" } = rows[0] ?? {};
  const messageRows = async () =>
    (
      await su.query<{
        direction: string;
        channel: string;
        from_e164: string | null;
        to_e164: string;
        body: string | null;
        handled_as: string | null;
        twilio_opt_out: string | null;
        worker_id: string | null;
        replies_to_in: boolean;
      }>(
        `select m.direction, m.channel, m.from_e164, m.to_e164, m.body, m.handled_as,
                m.twilio_opt_out, m.worker_id::text as worker_id,
                exists (select 1 from messages r where r.id = m.reply_to and r.direction = 'in')
                  as replies_to_in
           from messages m where m.firm_id = $1 order by m.created_at, m.direction`,
        [f.firmId],
      )
    ).rows;
  const jobs = async () =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
        [INBOUND_MESSAGE_QUEUE, f.firmId],
      )
    ).rows.map((r) => r.data);
  const eventsOf = async (like: string) =>
    (
      await su.query<{ action: string; actor_type: string; data: Record<string, unknown> }>(
        "select action, actor_type, data from events where firm_id = $1 and action like $2 order by id",
        [f.firmId, like],
      )
    ).rows;
  const optedOut = async (workerId = ann) =>
    (
      await su.query<{ off: boolean }>(
        "select sms_opted_out_at is not null as off from workers where id = $1",
        [workerId],
      )
    ).rows[0]?.off;
  // A text stored as the webhook would, and the job queued for that very text.
  const text = async (
    body: string | null,
    o: { from?: string; twilioOptOut?: "stop" | "start" | null } = {},
  ) => {
    const messageSid = sid();
    await receiveSms(
      f.firmId,
      { messageSid, from: o.from ?? mobile, to: line, body, twilioOptOut: o.twilioOptOut ?? null },
      { run: withFirm },
    );
    const { rows: queued } = await su.query<{ data: Record<string, unknown> }>(
      `select j.data from pgboss.job j
         join messages m on m.id::text = j.data ->> 'messageId'
        where j.name = $1 and m.firm_id = $2 and m.provider_message_id = $3`,
      [INBOUND_MESSAGE_QUEUE, f.firmId, messageSid],
    );
    if (queued.length !== 1) throw new Error("expected one job for the text");
    return queued[0]?.data ?? {};
  };
  return { f, line, ann, mobile, slug, name, messageRows, jobs, eventsOf, optedOut, text };
}

function signed(
  fields: Record<string, string>,
  opts: { token?: string; signature?: string | null } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  const signature =
    opts.signature === undefined
      ? twilioSignature(opts.token ?? TOKEN, WEBHOOK, fields)
      : opts.signature;
  if (signature !== null) headers["x-twilio-signature"] = signature;
  return new Request(WEBHOOK, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields).toString(),
  });
}

describe("the SMS webhook", () => {
  const deps = () => ({
    authToken: TOKEN as string | undefined,
    webhookUrl: WEBHOOK,
    resolveFirmByLine: createLineDirectory(app),
    receive: (firmId: string, m: Parameters<typeof receiveSms>[1]) =>
      receiveSms(firmId, m, { run: withFirm }),
  });

  it("a signed text to a firm's line: one message stored, one job, an empty TwiML 200; a repeat stores nothing", async () => {
    const t = await lineFirm();
    const fields = {
      MessageSid: sid(),
      AccountSid: `AC${randomBytes(16).toString("hex")}`,
      From: t.mobile,
      To: t.line,
      Body: "Any shifts?",
      NumMedia: "0",
    };
    for (let i = 0; i < 2; i += 1) {
      const res = await handleTwilioSms(signed(fields), deps());
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    expect(await t.messageRows()).toEqual([
      {
        direction: "in",
        channel: "sms",
        from_e164: t.mobile,
        to_e164: t.line,
        body: "Any shifts?",
        handled_as: null,
        twilio_opt_out: null,
        worker_id: null,
        replies_to_in: false,
      },
    ]);
    expect(await t.jobs()).toHaveLength(1);
  });

  it("keeps Twilio's own STOP or START (any case); HELP or anything else is an ordinary text", async () => {
    const t = await lineFirm();
    for (const [type, body] of [
      ["STOP", "Stop"],
      ["start", "Start"],
      ["HELP", "Help"],
      ["SOMETHING", "Hello"],
    ] as const) {
      await handleTwilioSms(
        signed({ MessageSid: sid(), From: t.mobile, To: t.line, Body: body, OptOutType: type }),
        deps(),
      );
    }
    expect((await t.messageRows()).map((r) => [r.body, r.twilio_opt_out])).toEqual([
      ["Stop", "stop"],
      ["Start", "start"],
      ["Help", null],
      ["Hello", null],
    ]);
  });

  it("refuses what isn't from Twilio or isn't a text; a number no firm has is 200 with nothing stored", async () => {
    const t = await lineFirm();
    const fields = { MessageSid: sid(), From: t.mobile, To: t.line, Body: "hi" };
    expect((await handleTwilioSms(signed(fields, { signature: null }), deps())).status).toBe(403);
    expect(
      (await handleTwilioSms(signed(fields, { token: "another-token-0123456789" }), deps())).status,
    ).toBe(403);
    expect(
      (await handleTwilioSms(signed(fields), { ...deps(), authToken: undefined })).status,
    ).toBe(503);
    // A WhatsApp's "whatsapp:" numbers aren't a text's.
    expect(
      (await handleTwilioSms(signed({ ...fields, From: `whatsapp:${t.mobile}` }), deps())).status,
    ).toBe(400);
    expect((await handleTwilioSms(signed({ ...fields, MessageSid: "SM1" }), deps())).status).toBe(
      400,
    );
    const nobody = await handleTwilioSms(signed({ ...fields, To: "+447700900499" }), deps());
    expect(nobody.status).toBe(200);
    expect(await t.messageRows()).toEqual([]);
    expect(await t.jobs()).toEqual([]);
  });
});

describe("STOP and START (the inbound-message job)", () => {
  const run = (job: Record<string, unknown>, transport: MessagingTransport) =>
    runInboundMessage(job as Parameters<typeof runInboundMessage>[0], withFirm, {
      transport,
      ai: noAi,
      baseDomain: "shiftdesk.test",
      aiTimeoutMs: 30,
    });

  it("STOP turns a worker's texts off, confirmed once by text from the line; logged without the text", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    const job = await t.text("STOP");
    expect(await run(job, transport)).toEqual({
      status: "opt_out",
      optOut: "stop",
      changed: true,
      confirmation: "sent",
    });
    expect(await t.optedOut()).toBe(true);
    expect(sent).toEqual([
      {
        channel: "sms",
        to: t.mobile,
        from: t.line,
        body: `You won't get texts from ${t.name} now. Reply START to turn them back on. - ${t.name} Shift Team`,
      },
    ]);
    expect(
      (await t.messageRows()).map((r) => [r.direction, r.channel, r.handled_as, r.worker_id]),
    ).toEqual([
      ["in", "sms", "opt_out", t.ann],
      ["out", "sms", null, t.ann],
    ]);
    expect((await t.messageRows())[1]?.replies_to_in).toBe(true);
    const logged = [...(await t.eventsOf("worker.sms%")), ...(await t.eventsOf("message.%"))];
    expect(logged.map((e) => [e.action, e.actor_type, e.data])).toEqual([
      ["worker.sms_opted_out", "worker", { via: "sms", byTwilio: false }],
      [
        "message.received",
        "worker",
        { channel: "sms", handledAs: "opt_out", optOut: "stop", changed: true, workerId: t.ann },
      ],
      [
        "message.replied",
        "system",
        { channel: "sms", reply: "sms_stopped", workerId: t.ann, replyId: expect.any(String) },
      ],
    ]);
    expect(JSON.stringify(logged)).not.toContain(t.mobile);
    // The job again does nothing.
    expect(await run(job, transport)).toEqual({ status: "already" });
    expect(sent).toHaveLength(1);
  });

  it("the whole text only, any case, spaces around: Twilio's words (CANCEL too); not inside a sentence", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    for (const body of [
      " stop ",
      "Stop.",
      "STOP!",
      "UNSUBSCRIBE",
      "stopall",
      "End",
      "quit",
      "cancel",
      "optout",
    ]) {
      await su.query("update workers set sms_opted_out_at = null where id = $1", [t.ann]);
      expect(await run(await t.text(body), transport), body).toMatchObject({
        status: "opt_out",
        optOut: "stop",
        changed: true,
      });
    }
    await su.query("update workers set sms_opted_out_at = null where id = $1", [t.ann]);
    const before = sent.length;
    // Inside a sentence: an ordinary text (a keyword reply, by text).
    expect(await run(await t.text("Please stop, I cancel my shift"), transport)).toMatchObject({
      status: "replied",
      intent: "cancel",
    });
    expect(await t.optedOut()).toBe(false);
    expect(sent.slice(before)).toEqual([
      expect.objectContaining({ channel: "sms", to: t.mobile, from: t.line }),
    ]);
  });

  it("a second STOP changes nothing and isn't confirmed again; START turns texts back on, confirmed", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    await run(await t.text("STOP"), transport);
    expect(await run(await t.text("stop"), transport)).toEqual({
      status: "opt_out",
      optOut: "stop",
      changed: false,
      confirmation: "none",
    });
    expect(sent).toHaveLength(1);
    expect(await run(await t.text("Start"), transport)).toEqual({
      status: "opt_out",
      optOut: "start",
      changed: true,
      confirmation: "sent",
    });
    expect(await t.optedOut()).toBe(false);
    expect(sent.at(-1)).toEqual({
      channel: "sms",
      to: t.mobile,
      from: t.line,
      body: `Texts from ${t.name} are back on. Reply STOP to turn them off. - ${t.name} Shift Team`,
    });
    // START again, or UNSTOP, with texts on: nothing to change, nothing sent.
    expect(await run(await t.text("UNSTOP"), transport)).toMatchObject({
      changed: false,
      confirmation: "none",
    });
    expect(sent).toHaveLength(2);
    expect((await t.eventsOf("worker.sms%")).map((e) => e.action)).toEqual([
      "worker.sms_opted_out",
      "worker.sms_opted_in",
    ]);
  });

  it("YES turns texts back on only when they're off; otherwise it's an ordinary text", async () => {
    const t = await lineFirm();
    const { transport } = captureTransport();
    expect(await run(await t.text("Yes"), transport)).toMatchObject({
      status: "replied",
      intent: "office",
    });
    await run(await t.text("STOP"), transport);
    expect(await run(await t.text("YES"), transport)).toMatchObject({
      status: "opt_out",
      optOut: "start",
      changed: true,
    });
    expect(await t.optedOut()).toBe(false);
  });

  it("Twilio's START on a plain 'Yes' from a number with texts on is an ordinary text, not swallowed", async () => {
    const t = await lineFirm();
    const { transport } = captureTransport();
    expect(await run(await t.text("Yes", { twilioOptOut: "start" }), transport)).toMatchObject({
      status: "replied",
      intent: "office",
    });
    expect(
      (await t.messageRows()).filter((r) => r.direction === "in").map((r) => r.handled_as),
    ).toEqual(["office"]);
  });

  it("the latest word counts: a STOP whose job runs before an earlier START's answers the START first", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    const start = await t.text("START");
    // The STOP arrives after it, and its job runs first: it answers the earlier START first (one
    // sender's messages in the order they came: src/lib/inbound/reply.ts), then itself.
    await su.query(
      "update messages set created_at = created_at - interval '1 minute' where id = $1",
      [start.messageId],
    );
    await run(await t.text("STOP"), transport);
    expect(await t.optedOut()).toBe(true);
    // The START's own job finds it answered.
    expect(await run(start, transport)).toEqual({ status: "already" });
    expect(await t.optedOut()).toBe(true);
    expect(sent).toHaveLength(1); // the STOP's confirmation only (texts weren't off at the START)
    expect((await t.eventsOf("message.received")).map((e) => e.data)).toEqual([
      expect.objectContaining({ optOut: "start", changed: false }),
      expect.objectContaining({ optOut: "stop", changed: true }),
    ]);
  });

  it("an earlier START that fails doesn't hold up the later STOP; its retry then changes nothing", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    const start = await t.text("START");
    await su.query(
      "update messages set created_at = created_at - interval '1 minute' where id = $1",
      [start.messageId],
    );
    const stop = await t.text("STOP");
    // The STOP's job: (1) finds the older START, (2) reads it, which fails this once (a dropped
    // connection). The STOP is still answered.
    let calls = 0;
    const flaky: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error("connection terminated"));
      return withFirm(firmId, fn);
    };
    expect(
      await runInboundMessage(stop as Parameters<typeof runInboundMessage>[0], flaky, {
        transport,
        ai: noAi,
        baseDomain: "shiftdesk.test",
        aiTimeoutMs: 30,
      }),
    ).toEqual({ status: "opt_out", optOut: "stop", changed: true, confirmation: "sent" });
    expect(await t.optedOut()).toBe(true);
    // The START's own job, retried: a later STOP is handled, so the latest word counts.
    expect(await run(start, transport)).toEqual({
      status: "opt_out",
      optOut: "start",
      changed: false,
      confirmation: "none",
    });
    expect(await t.optedOut()).toBe(true);
    expect(sent).toHaveLength(1); // the STOP's confirmation only
    expect((await t.eventsOf("message.received")).at(-1)?.data).toMatchObject({
      optOut: "start",
      changed: false,
      superseded: true,
    });
  });

  it("when Twilio's own opt-out handling acted, the setting follows it and we send no second confirmation", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    // Twilio's word list may differ from ours (Dylan can change it): its say-so counts.
    expect(await run(await t.text("Stop please", { twilioOptOut: "stop" }), transport)).toEqual({
      status: "opt_out",
      optOut: "stop",
      changed: true,
      confirmation: "none",
    });
    expect(await t.optedOut()).toBe(true);
    expect(await run(await t.text("Start", { twilioOptOut: "start" }), transport)).toMatchObject({
      changed: true,
      confirmation: "none",
    });
    expect(await t.optedOut()).toBe(false);
    expect(sent).toEqual([]);
    expect((await t.eventsOf("worker.sms%")).map((e) => e.data)).toEqual([
      { via: "sms", byTwilio: true },
      { via: "sms", byTwilio: true },
    ]);
  });

  it("a former worker's number is marked too; a stranger's STOP marks nobody, gets nothing, and isn't on Today", async () => {
    const t = await lineFirm();
    await t.f.office("admin");
    const former = await t.f.worker({ first: "Old", status: "inactive" });
    const { rows } = await su.query<{ mobile: string }>(
      "select mobile_e164 as mobile from workers where id = $1",
      [former],
    );
    const { transport, sent } = captureTransport();
    expect(
      await run(await t.text("STOP", { from: rows[0]?.mobile ?? "" }), transport),
    ).toMatchObject({ changed: true, confirmation: "sent" });
    expect(await t.optedOut(former)).toBe(true);
    expect(await run(await t.text("STOP", { from: STRANGER }), transport)).toEqual({
      status: "opt_out",
      optOut: "stop",
      changed: false,
      confirmation: "none",
    });
    expect(sent.map((m) => m.to)).toEqual([rows[0]?.mobile]); // no email, nothing to the stranger
    expect((await t.eventsOf("message.received")).at(-1)?.data).toEqual({
      channel: "sms",
      handledAs: "opt_out",
      optOut: "stop",
      changed: false,
      workerId: null,
    });
    const today = await withFirm(t.f.firmId, (tx) => loadToday(tx, new Date()));
    expect(today.unknownMessages).toEqual([]);
  });

  it("after STOP, the shifts line answers them by WhatsApp, never by text", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    await run(await t.text("STOP"), transport);
    expect(await run(await t.text("Any shifts this weekend?"), transport)).toMatchObject({
      status: "replied",
      intent: "shifts",
    });
    expect(sent.at(-1)).toMatchObject({ channel: "whatsapp", to: t.mobile, from: t.line });
    const replied = (await t.eventsOf("message.replied")).at(-1)?.data;
    expect(replied).toMatchObject({ channel: "whatsapp", fellBackFrom: "sms" });
  });

  it("other firms: a STOP at one firm doesn't touch the same number at another", async () => {
    const t = await lineFirm();
    const other = await lineFirm();
    await su.query("update workers set mobile_e164 = $2 where id = $1", [other.ann, t.mobile]);
    const { transport } = captureTransport();
    await run(await t.text("STOP"), transport);
    expect(await t.optedOut()).toBe(true);
    expect(await other.optedOut()).toBe(false);
    // And the job only sees its own firm's message.
    const job = await t.text("STOP");
    expect(
      await runInboundMessage(
        { ...(job as Parameters<typeof runInboundMessage>[0]), firmId: other.f.firmId },
        withFirm,
        { transport, ai: noAi, baseDomain: "shiftdesk.test" },
      ),
    ).toEqual({ status: "gone" });
  });

  it("a failed confirmation is logged, never retried; the setting still changes", async () => {
    const t = await lineFirm();
    const failing: MessagingTransport = {
      name: "failing",
      async send() {
        throw new TypeError("network down");
      },
    };
    const job = await t.text("STOP");
    expect(await run(job, failing)).toEqual({
      status: "opt_out",
      optOut: "stop",
      changed: true,
      confirmation: "failed",
    });
    expect(await t.optedOut()).toBe(true);
    expect((await t.eventsOf("message.reply_failed")).map((e) => e.data)).toEqual([
      { channel: "sms", reply: "sms_stopped", workerId: t.ann, code: "TypeError" },
    ]);
    expect(await run(job, failing)).toEqual({ status: "already" });
  });
});
