import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { ChannelRefusedError, type OutboundMessage } from "@/lib/messaging/transport";
import {
  createOfficeOfferTask,
  OFFICE_OFFER_QUEUE,
  officeOfferCandidates,
} from "@/lib/offers/office-offer";
import { runOfferWave, startOfferWaves, type OfferDeps } from "@/lib/offers/waves";
import { officeOfferPage } from "@/lib/office/offer-page";
import { offerTo } from "@/lib/office/quick-actions";
import type { PushTransport } from "@/lib/push/transport";
import { registerJobs } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// "Offer to someone" (src/lib/offers/office-offer.ts): the office offers a shift to one worker,
// through the same candidate list as every offer. On the real database, as the app role, with a
// capturing transport. NOW is Monday 2 November 2026, 09:00 London (GMT).

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

async function offerFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const resourcer = await f.office("resourcer");
  const shiftId = await f.shift({ startsAt: hoursFromNow(30) }); // Tuesday 15:00, not urgent
  const ann = await f.worker({ first: "Ann" });
  const mobile = async (id: string) =>
    (
      await su.query<{ mobile: string }>(
        "select mobile_e164 as mobile from workers where id = $1",
        [id],
      )
    ).rows[0]?.mobile ?? "";
  const slug = (
    await su.query<{ slug: string }>("select slug from firms where id = $1", [f.firmId])
  ).rows[0]?.slug;
  const sent: OutboundMessage[] = [];
  const pushed: { title: string; body: string; url: string }[] = [];
  const state = { refuseWhatsApp: false, fail: false };
  const deps = (when = NOW): OfferDeps => ({
    transport: {
      name: "capture",
      async send(message) {
        if (state.fail) throw new Error("timed out");
        if (state.refuseWhatsApp && message.channel === "whatsapp") {
          throw new ChannelRefusedError("whatsapp");
        }
        sent.push(message);
        return { providerMessageId: `capture-${sent.length}` };
      },
    },
    push: {
      name: "capture",
      async send(_target, payload) {
        pushed.push(payload);
        return { status: "sent" };
      },
    } satisfies PushTransport,
    baseDomain: "localhost:3000",
    clock: { now: () => when },
  });
  const ctx = (officeUserId = resourcer, when = NOW) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: { now: () => when },
  });
  // The queued office-offer jobs for this firm, oldest first.
  const jobs = async () =>
    (
      await su.query<{ id: string; data: Record<string, unknown>; start_after: Date }>(
        `select id::text as id, data, start_after from pgboss.job
          where name = $1 and data ->> 'firmId' = $2 order by created_on, id`,
        [OFFICE_OFFER_QUEUE, f.firmId],
      )
    ).rows;
  const runJob = (data: Record<string, unknown>, when = NOW) =>
    runFirmTask(
      createOfficeOfferTask(() => deps(when)),
      { id: "job", data },
      withFirm,
    );
  const offersOf = async () =>
    (
      await su.query(
        `select worker_id::text, wave, offered_by::text, channel, response from offers
          where shift_id = $1 order by sent_at, worker_id`,
        [shiftId],
      )
    ).rows;
  return {
    f,
    resourcer,
    shiftId,
    ann,
    mobile,
    slug,
    sent,
    pushed,
    state,
    ctx,
    jobs,
    runJob,
    offersOf,
    deps,
  };
}

describe("queueing the offer", () => {
  it("queues a job (ids only) and logs who asked; the job sends shift_offer and records it", async () => {
    const t = await offerFirm();
    expect(await offerTo(t.ctx(), t.shiftId, t.ann)).toEqual({ status: "queued" });
    const [job] = await t.jobs();
    expect(job?.data).toEqual({
      firmId: t.f.firmId,
      idempotencyKey: `office-offer:${t.shiftId}:${t.ann}`,
      shiftId: t.shiftId,
      workerId: t.ann,
      officeUserId: t.resourcer,
    });
    expect(t.sent).toEqual([]); // nothing goes until the job runs

    expect(await t.runJob(job?.data ?? {})).toMatchObject({
      status: "completed",
      output: { status: "sent", channel: "whatsapp" },
    });
    expect(t.sent).toEqual([
      {
        channel: "whatsapp",
        to: await t.mobile(t.ann),
        body: `Shift available: Tue 3 Nov 15:00–23:00 (door supervisor). Tap to take it: http://${t.slug}.localhost:3000/shifts/${t.shiftId}. First to accept gets it. — Booking Test ${t.slug} Shift Team`,
      },
    ]);
    expect(await t.offersOf()).toEqual([
      {
        worker_id: t.ann,
        wave: null,
        offered_by: t.resourcer,
        channel: "whatsapp",
        response: null,
      },
    ]);
    const { rows } = await su.query<{
      action: string;
      actor_type: string;
      data: Record<string, unknown>;
    }>(
      "select action, actor_type, data from events where firm_id = $1 and action like 'offer.%' order by id",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      {
        action: "offer.office_queued",
        actor_type: "office",
        data: { shiftId: t.shiftId, workerId: t.ann },
      },
      {
        action: "offer.sent",
        actor_type: "system",
        data: {
          shiftId: t.shiftId,
          workerId: t.ann,
          offeredBy: t.resourcer,
          noticeHours: 30, // the shift starts 30 hours after the offer
          channel: "whatsapp",
          providerMessageId: "capture-1",
          pushes: 0,
        },
      },
    ]);
  });

  it("an urgent shift gets the urgent wording; a worker who chose texts gets the short text", async () => {
    const t = await offerFirm();
    await su.query("update shifts set is_urgent = true where id = $1", [t.shiftId]);
    const ben = await t.f.worker({ first: "Ben" });
    await su.query("update workers set notify_channel = 'sms' where id = $1", [ben]);
    await offerTo(t.ctx(), t.shiftId, t.ann);
    await offerTo(t.ctx(), t.shiftId, ben);
    for (const job of await t.jobs()) await t.runJob(job.data);
    const bodies = t.sent.map((m) => (m.channel === "email" ? "" : `${m.channel}:${m.body}`));
    expect(bodies[0]).toMatch(/^whatsapp:URGENT: we need a door supervisor tomorrow 15:00–23:00\./);
    expect(bodies[1]).toMatch(
      new RegExp(`^sms:Booking Test ${t.slug} URGENT: door supervisor needed tomorrow 15:00\\. `),
    );
  });

  it("a text when WhatsApp refuses; the push goes too", async () => {
    const t = await offerFirm();
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/ann', 'k', 'a')`,
      [t.f.firmId, t.ann],
    );
    t.state.refuseWhatsApp = true;
    await offerTo(t.ctx(), t.shiftId, t.ann);
    await t.runJob((await t.jobs())[0]?.data ?? {});
    expect(t.sent.map((m) => m.channel)).toEqual(["sms"]);
    expect(t.sent[0] && "body" in t.sent[0] ? t.sent[0].body : "").toMatch(
      new RegExp(`^Booking Test ${t.slug}: shift Tue 3 Nov 15:00\\. Take it: `),
    );
    expect(t.pushed).toEqual([
      {
        title: "Shift available",
        body: "Tue 3 Nov 15:00. Tap to take it.",
        url: `/shifts/${t.shiftId}`,
      },
    ]);
    expect((await t.offersOf())[0]).toMatchObject({ channel: "sms" });
  });

  it("only workers the candidate list allows: never the ineligible, opted out, or capped (unless urgent)", async () => {
    const t = await offerFirm();
    const nia = await t.f.worker({ first: "Nia", credentials: [] });
    const off = await t.f.worker({ first: "Off" });
    await su.query("update workers set offer_alerts = false where id = $1", [off]);
    const busy = await t.f.worker({ first: "Busy" });
    for (let i = 0; i < 3; i++) {
      const other = await t.f.shift({ startsAt: hoursFromNow(200 + 24 * i) });
      await su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'whatsapp', $4)`,
        [t.f.firmId, other, busy, hoursFromNow(-1)],
      );
    }
    for (const id of [nia, off, busy]) {
      expect(await offerTo(t.ctx(), t.shiftId, id)).toEqual({ status: "not_candidate" });
    }
    expect(await t.jobs()).toEqual([]);
    await su.query("update shifts set is_urgent = true where id = $1", [t.shiftId]);
    expect(await offerTo(t.ctx(), t.shiftId, busy)).toEqual({ status: "queued" });
  });

  it("someone already offered it (by a wave or the office) can't be offered it again", async () => {
    const t = await offerFirm();
    const ben = await t.f.worker({ first: "Ben" });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
       values ($1, $2, $3, 1, 'whatsapp', $4)`,
      [t.f.firmId, t.shiftId, ben, hoursFromNow(-1)],
    );
    expect(await offerTo(t.ctx(), t.shiftId, ben)).toEqual({ status: "already_offered" });
    await offerTo(t.ctx(), t.shiftId, t.ann);
    await t.runJob((await t.jobs())[0]?.data ?? {});
    expect(await offerTo(t.ctx(), t.shiftId, t.ann)).toEqual({ status: "already_offered" });
  });

  it("not payroll or a disabled user; not a closed, started or unknown shift", async () => {
    const t = await offerFirm();
    const payroll = await t.f.office("payroll");
    const disabled = await t.f.office("resourcer", "disabled");
    expect(await offerTo(t.ctx(payroll), t.shiftId, t.ann)).toEqual({ status: "not_allowed" });
    expect(await offerTo(t.ctx(disabled), t.shiftId, t.ann)).toEqual({ status: "not_allowed" });
    const started = await t.f.shift({ startsAt: hoursFromNow(-1) });
    expect(await offerTo(t.ctx(), started, t.ann)).toEqual({ status: "not_open" });
    await su.query("update shifts set status = 'filled' where id = $1", [t.shiftId]);
    expect(await offerTo(t.ctx(), t.shiftId, t.ann)).toEqual({ status: "not_open" });
    const other = await offerFirm();
    expect(await offerTo(t.ctx(), other.shiftId, t.ann)).toEqual({ status: "not_found" });
    expect(await offerTo(t.ctx(), "nope", t.ann)).toEqual({ status: "not_found" });
    expect(await t.jobs()).toEqual([]);
  });
});

describe("the office-offer job", () => {
  it("checks it all again when it runs: filled or closed meanwhile, or no longer allowed, it sends nothing", async () => {
    const t = await offerFirm();
    const ben = await t.f.worker({ first: "Ben" });
    await offerTo(t.ctx(), t.shiftId, t.ann);
    await offerTo(t.ctx(), t.shiftId, ben);
    const [a, b] = await t.jobs();
    // Ann's licence is suspended before her job runs; then the office closes the shift.
    await su.query(
      "update credentials set status = 'suspended' where worker_id = $1 and type = 'SIA_DS'",
      [t.ann],
    );
    expect(await t.runJob(a?.data ?? {})).toMatchObject({
      output: { status: "not_sent", reason: "not_candidate" },
    });
    await su.query("update shifts set status = 'filled' where id = $1", [t.shiftId]);
    expect(await t.runJob(b?.data ?? {})).toMatchObject({
      output: { status: "not_sent", reason: "filled" },
    });
    expect(t.sent).toEqual([]);
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'offer.office_not_sent' order by id",
      [t.f.firmId],
    );
    expect(rows.map((r) => r.data.reason)).toEqual(["not_candidate", "filled"]);
  });

  it("run twice, or two copies at once: one offer, one message", async () => {
    const t = await offerFirm();
    await offerTo(t.ctx(), t.shiftId, t.ann);
    const data = (await t.jobs())[0]?.data ?? {};
    await Promise.all([t.runJob(data), t.runJob(data)]);
    expect(await t.runJob(data)).toMatchObject({ output: { status: "already" } });
    expect(t.sent).toHaveLength(1);
    expect(await t.offersOf()).toHaveLength(1);
  });

  it("quiet hours: an offer that isn't urgent waits until 07:00, then goes", async () => {
    const t = await offerFirm();
    const night = hoursFromNow(14); // Monday 23:00
    await offerTo(t.ctx(t.resourcer, night), t.shiftId, t.ann);
    expect(await t.runJob((await t.jobs())[0]?.data ?? {}, night)).toMatchObject({
      output: { status: "held" },
    });
    expect(t.sent).toEqual([]);
    const later = (await t.jobs())[1];
    expect(later?.start_after).toEqual(hoursFromNow(22)); // Tuesday 07:00
    expect(later?.data.idempotencyKey).toBe(`office-offer:${t.shiftId}:${t.ann}:after-quiet`);
    expect(await t.runJob(later?.data ?? {}, hoursFromNow(22))).toMatchObject({
      output: { status: "sent" },
    });
    expect(t.sent).toHaveLength(1);
  });

  it("an office offer never takes a wave's number: the waves start at 1 and skip the worker already offered", async () => {
    const t = await offerFirm();
    const ben = await t.f.worker({ first: "Ben" });
    await offerTo(t.ctx(), t.shiftId, t.ann);
    await t.runJob((await t.jobs())[0]?.data ?? {});
    await su.query("update shifts set is_urgent = true where id = $1", [t.shiftId]);
    await withFirm(t.f.firmId, (tx) => startOfferWaves(tx, { shiftId: t.shiftId, now: NOW }));
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = 'offer-wave' and data ->> 'shiftId' = $1",
      [t.shiftId],
    );
    expect(rows.map((r) => r.data.wave)).toEqual([1]);
    const wave = await runOfferWave(
      {
        firmId: t.f.firmId,
        idempotencyKey: `offer-wave:${t.shiftId}:1`,
        shiftId: t.shiftId,
        wave: 1,
      },
      withFirm,
      t.deps(),
    );
    expect(wave).toMatchObject({ status: "sent", sent: 1 });
    // Both sent at NOW: compared without order.
    expect(
      (await t.offersOf())
        .map((o) => [o.worker_id, o.wave])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ).toEqual(
      [
        [t.ann, null],
        [ben, 1],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
  });
});

describe("from the guardrails review", () => {
  it("an office offer that failed isn't sent again, and the office is told so honestly", async () => {
    const t = await offerFirm();
    t.state.fail = true;
    await offerTo(t.ctx(), t.shiftId, t.ann);
    const data = (await t.jobs())[0]?.data ?? {};
    expect(await t.runJob(data)).toMatchObject({ output: { status: "failed" } });
    t.state.fail = false;
    expect(await offerTo(t.ctx(), t.shiftId, t.ann)).toEqual({ status: "failed_before" });
    expect(await t.jobs()).toHaveLength(1); // nothing new queued
    const listed = await withFirm(t.f.firmId, (tx) => officeOfferCandidates(tx, t.shiftId, NOW));
    expect(listed.map((c) => c.workerId)).not.toContain(t.ann);
    // The same job again (a retry): nothing sent, and the log says why.
    expect(await t.runJob(data)).toMatchObject({ output: { status: "already" } });
    expect(t.sent).toEqual([]);
    const { rows } = await su.query<{ action: string; data: Record<string, unknown> }>(
      `select action, data from events where firm_id = $1
          and action in ('offer.send_failed', 'offer.office_not_sent') order by id`,
      [t.f.firmId],
    );
    expect(rows).toEqual([
      {
        action: "offer.send_failed",
        data: {
          offerId: expect.any(String),
          workerId: t.ann,
          offeredBy: t.resourcer,
          channel: "whatsapp",
          code: "Error",
        },
      },
      { action: "offer.office_not_sent", data: { workerId: t.ann, reason: "failed_before" } },
    ]);
  });

  async function twoToday(t: Awaited<ReturnType<typeof offerFirm>>, workerId: string) {
    for (let i = 0; i < 2; i++) {
      const other = await t.f.shift({ startsAt: hoursFromNow(200 + 24 * i) });
      await su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'whatsapp', $4)`,
        [t.f.firmId, other, workerId, hoursFromNow(-1)],
      );
    }
  }

  it("the daily cap holds when two offers to one worker run at the same moment", async () => {
    const t = await offerFirm();
    await twoToday(t, t.ann);
    const second = await t.f.shift({ startsAt: hoursFromNow(54) });
    expect(await offerTo(t.ctx(), t.shiftId, t.ann)).toEqual({ status: "queued" });
    expect(await offerTo(t.ctx(), second, t.ann)).toEqual({ status: "queued" }); // both saw 2
    const [a, b] = await t.jobs();
    const results = await Promise.all([t.runJob(a?.data ?? {}), t.runJob(b?.data ?? {})]);
    expect(results.map((r) => (r.output as { status: string }).status).sort()).toEqual([
      "not_sent",
      "sent",
    ]);
    expect(t.sent).toHaveLength(1);
  });

  it("the cap is counted again when the job runs", async () => {
    const t = await offerFirm();
    await twoToday(t, t.ann);
    await offerTo(t.ctx(), t.shiftId, t.ann);
    await twoToday(t, t.ann); // more offers arrive before the job runs
    expect(await t.runJob((await t.jobs())[0]?.data ?? {})).toMatchObject({
      output: { status: "not_sent", reason: "not_candidate" },
    });
  });

  it("an urgent shift at night: goes at once if the firm lets urgent through, else waits", async () => {
    const night = hoursFromNow(14);
    for (const [override, expected] of [
      [true, "sent"],
      [false, "held"],
    ] as const) {
      const t = await offerFirm({
        quiet_hours: { start: "22:00", end: "07:00", urgent_override: override },
      });
      await su.query("update shifts set is_urgent = true where id = $1", [t.shiftId]);
      await offerTo(t.ctx(t.resourcer, night), t.shiftId, t.ann);
      expect(await t.runJob((await t.jobs())[0]?.data ?? {}, night)).toMatchObject({
        output: { status: expected },
      });
    }
  });

  it("a job naming another firm's office user sends nothing", async () => {
    const t = await offerFirm();
    const other = await offerFirm();
    expect(
      await t.runJob({
        firmId: t.f.firmId,
        idempotencyKey: `office-offer:${t.shiftId}:${t.ann}`,
        shiftId: t.shiftId,
        workerId: t.ann,
        officeUserId: other.resourcer,
      }),
    ).toMatchObject({ output: { status: "not_sent", reason: "not_allowed" } });
    expect(t.sent).toEqual([]);
  });
});

describe("the offer page", () => {
  it("lists who could take it (fewest hours first, with names) and who was offered it", async () => {
    const t = await offerFirm();
    const ben = await t.f.worker({ first: "Ben" });
    await t.f.booking(t.ann, await t.f.shift({ startsAt: hoursFromNow(80) }), "confirmed", 1);
    const zoe = await t.f.worker({ first: "Zoe" });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
       values ($1, $2, $3, 1, 'whatsapp', $4)`,
      [t.f.firmId, t.shiftId, zoe, hoursFromNow(-1)],
    );
    const candidates = await withFirm(t.f.firmId, (tx) =>
      officeOfferCandidates(tx, t.shiftId, NOW),
    );
    expect(candidates.map((c) => [c.name, c.hoursThisWeek])).toEqual([
      ["Ben Booker", 0],
      ["Ann Booker", 8],
    ]);
    const token = (
      await withFirm(t.f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: t.resourcer, now: NOW }),
      )
    ).token;
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock: { now: () => NOW } };
    const page = await officeOfferPage(ctx, token, t.shiftId);
    expect(page?.shift).toMatchObject({
      shiftId: t.shiftId,
      placesLeft: 1,
      open: true,
      isUrgent: false,
    });
    expect(page?.candidates.map((c) => c.workerId)).toEqual([ben, t.ann]);
    expect(page?.offered).toEqual([
      { worker: "Zoe Booker", wave: 1, response: null, sentAt: hoursFromNow(-1) },
    ]);
    const payroll = await t.f.office("payroll");
    const payrollToken = (
      await withFirm(t.f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: payroll, now: NOW }),
      )
    ).token;
    expect(await officeOfferPage(ctx, payrollToken, t.shiftId)).toBeNull();
    const draft = await t.f.shift({ status: "draft" });
    expect(await officeOfferPage(ctx, token, draft)).toBeNull();
    expect(await officeOfferPage(ctx, token, "not-a-uuid")).toBeNull();
  });
});

describe("wiring", () => {
  it("db:migrate and the worker create the queue; the worker works it", async () => {
    expect(QUEUES.find((q) => q.name === OFFICE_OFFER_QUEUE)?.options).toMatchObject({
      policy: "standard",
    });
    const worked: string[] = [];
    const boss = {
      createQueue: async () => undefined,
      work: async (name: string) => {
        worked.push(name);
        return "id";
      },
      schedule: async () => undefined,
      unschedule: async () => undefined,
    } as unknown as PgBoss;
    await registerJobs(boss);
    expect(worked).toContain(OFFICE_OFFER_QUEUE);
  });
});
