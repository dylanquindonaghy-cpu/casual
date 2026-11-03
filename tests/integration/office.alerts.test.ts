import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Clock } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import type { MessagingTransport, OutboundMessage } from "@/lib/messaging/transport";
import { saveContract, saveMyDashboard } from "@/lib/office/contracts";
import {
  OPEN_ALERT_SESSIONS,
  runOfficeAlertsTick,
  runOfficeCancelAlert,
  runOfficeOpenAlert,
  runOfficeSummary,
  type OfficeAlertDeps,
} from "@/lib/office/alerts";
import { loadTellMe, saveTellMe } from "@/lib/office/tell-me";
import { loadUpdatesBell } from "@/lib/office/updates";
import type { PushPayload, PushSendResult, PushTransport } from "@/lib/push/transport";
import { cancelBooking } from "@/lib/roster/cancel";
import { STRIKE_WARNING_VERSION } from "@/lib/strikes/words";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Office alerts (Phase 26.4; the spec page's upd-4 and upd-5, decision 5) on the real database, as
// the app role: each person's "Tell me about" switches (saved, logged, the defaults); a casual's
// cancellation under 48 hours' notice queued by the cancellation and pushed once to each person who
// asked, looks after the venue and has a browser on (never payroll, never another firm); places
// still open 6 hours before the start; a browser the push service says is gone forgotten; the 08:00
// summary email (narrowed to the person's contracts, sent once, with no casual's name); and the
// tick that queues them. NOW is Monday 2 November 2026, 09:00 London.

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

const clockAt = (d: Date): Clock => ({ now: () => d });

function fakes(gone: string[] = []) {
  const pushes: { endpoint: string; payload: PushPayload }[] = [];
  const mail: OutboundMessage[] = [];
  const push: PushTransport = {
    name: "test",
    send: async (target, payload): Promise<PushSendResult> => {
      if (gone.includes(target.endpoint)) return { status: "gone" };
      pushes.push({ endpoint: target.endpoint, payload });
      return { status: "sent" };
    },
  };
  let failMail = false;
  const transport: MessagingTransport = {
    name: "test",
    send: async (m) => {
      if (failMail) throw new Error("smtp down");
      mail.push(m);
      return { providerMessageId: `m${mail.length}` };
    },
  };
  return {
    pushes,
    mail,
    failMail: () => {
      failMail = true;
    },
    deps: (at = NOW): OfficeAlertDeps => ({
      push,
      transport,
      baseDomain: "shiftdesk.test",
      clock: clockAt(at),
    }),
  };
}

async function site(f: BookingFirm, name: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, $2) returning id::text as id",
    [f.firmId, name],
  );
  return rows[0]?.id ?? "";
}
async function shiftAt(f: BookingFirm, siteId: string, startsAt: Date, headcount = 1) {
  const id = await f.shift({ startsAt, headcount });
  await su.query("update shifts set site_id = $2 where id = $1", [id, siteId]);
  return id;
}
let browsers = 0;
async function browser(f: BookingFirm, officeUserId: string): Promise<string> {
  browsers += 1;
  const endpoint = `https://fcm.googleapis.com/fcm/send/office-${browsers}-${Date.now()}`;
  await su.query(
    `insert into office_push_subscriptions (firm_id, office_user_id, endpoint, p256dh, auth)
     values ($1, $2, $3, 'k', 'a')`,
    [f.firmId, officeUserId, endpoint],
  );
  return endpoint;
}
const eventsOf = async (f: BookingFirm, action: string) =>
  (
    await su.query<{ entity_id: string; data: Record<string, unknown> }>(
      "select entity_id::text, data from events where firm_id = $1 and action = $2 order by id",
      [f.firmId, action],
    )
  ).rows;
const jobsOf = async (f: BookingFirm, name: string) =>
  (
    await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2 order by created_on",
      [name, f.firmId],
    )
  ).rows.map((r) => r.data);

// A casual's own cancellation, as the app makes it (the warning they were shown as the rules say).
async function casualCancels(f: BookingFirm, workerId: string, shiftId: string, at = NOW) {
  await f.booking(workerId, shiftId, "confirmed");
  const cancel = (kind: "notice" | "strike" | "exempt") =>
    cancelBooking(
      withFirm,
      f.firmId,
      {
        shiftId,
        workerId,
        reason: "Unwell",
        by: { type: "worker", id: workerId, warning: { kind, version: STRIKE_WARNING_VERSION } },
      },
      { clock: clockAt(at) },
    );
  let r = await cancel("strike");
  if (r.status === "warning_changed") r = await cancel(r.kind);
  if (r.status !== "cancelled") throw new Error(`not cancelled: ${r.status}`);
  return r.assignmentId;
}

// One firm's office: Anna (every venue, the defaults, a browser); Ben (the depot's contract only, a
// browser); Cara (an admin who switched both notifications off, a browser); Dev (every venue, no
// browser); Pat (payroll, a browser: Updates isn't theirs).
async function office() {
  const f = await bookingFirm(su, withFirm);
  const [anna, ben, cara, dev, pat] = [
    await f.office("resourcer"),
    await f.office("resourcer"),
    await f.office("admin"),
    await f.office("resourcer"),
    await f.office("payroll"),
  ];
  const arena = await site(f, "Arena");
  const depot = await site(f, "Depot");
  const ctx = (officeUserId: string) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: clockAt(NOW),
  });
  const added = await saveContract(ctx(cara), {
    clientId: null,
    name: "Depot Council",
    siteIds: [depot],
    before: [],
  });
  if (added.status !== "saved") throw new Error(added.status);
  expect((await saveMyDashboard(ctx(ben), { clientIds: [added.clientId], cards: [] })).status).toBe(
    "saved",
  );
  for (const kind of ["cancel_push", "open_push"] as const) {
    expect(await saveTellMe(ctx(cara), { kind, on: false })).toEqual({
      status: "saved",
      kind,
      on: false,
    });
  }
  // Gil: an admin whose access is off, with a browser and the defaults: never told anything.
  const gil = await f.office("admin", "disabled");
  const ends = {
    anna: await browser(f, anna),
    ben: await browser(f, ben),
    cara: await browser(f, cara),
    pat: await browser(f, pat),
    gil: await browser(f, gil),
  };
  const worker = await f.worker({ first: "Mo" });
  return { f, anna, ben, cara, dev, pat, arena, depot, ctx, ends, worker };
}

describe("Tell me about", () => {
  it("the defaults until someone changes one; each change saved and logged; a repeat writes nothing", async () => {
    const t = await office();
    const read = (who: string) => withFirm(t.f.firmId, (tx) => loadTellMe(tx, who));
    expect(await read(t.anna)).toEqual(["popup", "cancel_push", "open_push", "summary"]);
    expect(await read(t.cara)).toEqual(["popup", "summary"]);
    // Cara's two changes, each logged with what she's now told about.
    expect((await eventsOf(t.f, "office_user.tell_me_saved")).map((e) => e.data)).toEqual([
      { kind: "cancel_push", on: false, tellMe: ["popup", "open_push", "summary"] },
      { kind: "open_push", on: false, tellMe: ["popup", "summary"] },
    ]);
    // Already off: nothing written or logged.
    await saveTellMe(t.ctx(t.cara), { kind: "open_push", on: false });
    expect(await eventsOf(t.f, "office_user.tell_me_saved")).toHaveLength(2);
    // Uploads on for Anna; a kind that doesn't exist, and payroll, refused.
    await saveTellMe(t.ctx(t.anna), { kind: "uploads", on: true });
    expect(await read(t.anna)).toEqual(["popup", "cancel_push", "open_push", "uploads", "summary"]);
    expect(await saveTellMe(t.ctx(t.anna), { kind: "everything", on: true })).toEqual({
      status: "invalid",
    });
    expect(await saveTellMe(t.ctx(t.pat), { kind: "popup", on: false })).toEqual({
      status: "not_allowed",
    });
  });

  it("the pop-up and uploads follow the switches", async () => {
    const t = await office();
    const shift = await shiftAt(t.f, t.arena, hoursFromNow(10));
    await casualCancels(t.f, t.worker, shift, new Date(NOW.getTime() - 5 * 60_000));
    await su.query(
      `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data, created_at)
       values ($1, $2, 'photo', 'image/jpeg', 3, encode(sha256('\\xffd8ff'::bytea), 'hex'),
               '\\xffd8ff'::bytea, $3)`,
      [t.f.firmId, t.worker, hoursFromNow(-1)],
    );
    const bell = (who: string) => withFirm(t.f.firmId, (tx) => loadUpdatesBell(tx, NOW, who));
    // Anna: the pop-up, and the cancellation new (uploads off by default).
    expect((await bell(t.anna)).cancellations).toHaveLength(1);
    expect((await bell(t.anna)).newCount).toBe(1);
    await saveTellMe(t.ctx(t.anna), { kind: "uploads", on: true });
    expect((await bell(t.anna)).newCount).toBe(2);
    await saveTellMe(t.ctx(t.anna), { kind: "popup", on: false });
    expect((await bell(t.anna)).cancellations).toEqual([]);
  });
});

describe("a casual's cancellation under 48 hours' notice", () => {
  it("is queued by the cancellation and pushed once to each person who asked and looks after the venue", async () => {
    const t = await office();
    const x = fakes();
    const shift = await shiftAt(t.f, t.arena, hoursFromNow(10));
    const assignmentId = await casualCancels(t.f, t.worker, shift);
    const queued = await jobsOf(t.f, "office-cancel-alert");
    expect(queued).toEqual([
      {
        firmId: t.f.firmId,
        idempotencyKey: `office-cancel-alert:${assignmentId}`,
        assignmentId,
      },
    ]);
    const payload = { firmId: t.f.firmId, idempotencyKey: "k", assignmentId };
    expect(await runOfficeCancelAlert(payload, withFirm, x.deps())).toEqual({
      status: "sent",
      people: 1,
      pushes: 1,
    });
    // Only Anna: Ben looks after the depot, Cara switched it off, Dev has no browser, Pat is payroll.
    expect(x.pushes).toEqual([
      {
        endpoint: t.ends.anna,
        payload: {
          title: "Cancellation · 10 hours' notice",
          body: "Door supervisor, Arena, Mon 2 Nov 19:00. The place is open again.",
          url: "/office/updates",
          urgent: true,
          until: hoursFromNow(10),
        },
      },
    ]);
    // No casual's name goes anywhere in it (Mo Booker).
    expect(JSON.stringify(x.pushes)).not.toMatch(/Booker|Mo /);
    expect((await eventsOf(t.f, "office.alerted")).map((e) => [e.entity_id, e.data])).toEqual([
      [assignmentId, { officeUserId: t.anna, kind: "cancel_push" }],
    ]);
    // Run again (a retry): nobody's told twice.
    expect(await runOfficeCancelAlert(payload, withFirm, x.deps())).toEqual({
      status: "not_needed",
    });
    expect(x.pushes).toHaveLength(1);
  });

  it("at the depot Ben is told too; with 3 days' notice, or by the office, nothing is queued", async () => {
    const t = await office();
    const x = fakes();
    const depotShift = await shiftAt(t.f, t.depot, hoursFromNow(20));
    const assignmentId = await casualCancels(t.f, t.worker, depotShift);
    await runOfficeCancelAlert(
      { firmId: t.f.firmId, idempotencyKey: "k", assignmentId },
      withFirm,
      x.deps(),
    );
    expect(x.pushes.map((p) => p.endpoint).sort()).toEqual([t.ends.anna, t.ends.ben].sort());
    // Three days' notice: no alert queued (the pop-up and Updates still show it).
    const later = await shiftAt(t.f, t.arena, hoursFromNow(72));
    const other = await t.f.worker({ first: "Zoe" });
    await casualCancels(t.f, other, later);
    expect(await jobsOf(t.f, "office-cancel-alert")).toHaveLength(1);
  });

  it("two copies of the job at once: each person still told once", async () => {
    const t = await office();
    const x = fakes();
    const shift = await shiftAt(t.f, t.depot, hoursFromNow(10));
    const assignmentId = await casualCancels(t.f, t.worker, shift);
    const payload = { firmId: t.f.firmId, idempotencyKey: "k", assignmentId };
    await Promise.all([
      runOfficeCancelAlert(payload, withFirm, x.deps()),
      runOfficeCancelAlert(payload, withFirm, x.deps()),
    ]);
    expect(x.pushes.map((p) => p.endpoint).sort()).toEqual([t.ends.anna, t.ends.ben].sort());
    expect(await eventsOf(t.f, "office.alerted")).toHaveLength(2);
  });

  it("another firm's office is never told", async () => {
    const a = await office();
    const b = await office();
    const x = fakes();
    const shift = await shiftAt(a.f, a.arena, hoursFromNow(10));
    const assignmentId = await casualCancels(a.f, a.worker, shift);
    await runOfficeCancelAlert(
      { firmId: a.f.firmId, idempotencyKey: "k", assignmentId },
      withFirm,
      x.deps(),
    );
    const theirs = Object.values(b.ends);
    expect(x.pushes.filter((p) => theirs.includes(p.endpoint))).toEqual([]);
    expect(await eventsOf(b.f, "office.alerted")).toEqual([]);
  });
});

describe("places still open 6 hours before the start", () => {
  it("each person who asked and looks after the venue, once per session; a gone browser forgotten", async () => {
    const t = await office();
    const x = fakes();
    const soon = await shiftAt(t.f, t.depot, hoursFromNow(5), 2);
    await shiftAt(t.f, t.depot, hoursFromNow(7)); // not yet within 6 hours
    await t.f.booking(await t.f.worker(), soon, "confirmed");
    const payload = { firmId: t.f.firmId, idempotencyKey: "k" };
    expect(await runOfficeOpenAlert(payload, withFirm, x.deps())).toEqual({
      status: "sent",
      people: 2,
      pushes: 2,
    });
    expect(x.pushes.map((p) => p.endpoint).sort()).toEqual([t.ends.anna, t.ends.ben].sort());
    expect(x.pushes[0]?.payload).toMatchObject({
      title: "1 place still to fill, starts in 5 h",
      body: "Door supervisor, Depot, Mon 2 Nov 14:00. Offered to nobody yet.",
      url: `/office/offer/${soon}`,
    });
    // The next tick: nobody twice.
    expect(await runOfficeOpenAlert(payload, withFirm, x.deps())).toEqual({ status: "not_needed" });
    // An hour on, the 7-hour one is within 6 hours: Anna's browser is gone (forgotten), Ben's isn't.
    const y = fakes([t.ends.anna]);
    expect(
      await runOfficeOpenAlert(payload, withFirm, y.deps(new Date(NOW.getTime() + 3_600_000))),
    ).toEqual({ status: "sent", people: 2, pushes: 1 });
    expect(y.pushes.map((p) => p.endpoint)).toEqual([t.ends.ben]);
    const { rows } = await su.query("select 1 from office_push_subscriptions where endpoint = $1", [
      t.ends.anna,
    ]);
    expect(rows).toEqual([]);
    expect(await eventsOf(t.f, "office_push.forgotten")).toHaveLength(1);
  });
});

describe("places still open: more sessions than one batch", () => {
  it(`every one is looked at (${OPEN_ALERT_SESSIONS} at a time), each person told once per session`, async () => {
    const t = await office();
    const x = fakes();
    const n = OPEN_ALERT_SESSIONS + 3;
    for (let i = 0; i < n; i++) await shiftAt(t.f, t.arena, hoursFromNow(1 + i / 60));
    const payload = { firmId: t.f.firmId, idempotencyKey: "k" };
    // Anna only (Ben looks after the depot; Cara's off; Gil's access is off).
    expect(await runOfficeOpenAlert(payload, withFirm, x.deps())).toEqual({
      status: "sent",
      people: n,
      pushes: n,
    });
    expect(new Set(x.pushes.map((p) => p.payload.url)).size).toBe(n);
    expect(x.pushes.every((p) => p.endpoint === t.ends.anna)).toBe(true);
    expect(await runOfficeOpenAlert(payload, withFirm, x.deps())).toEqual({ status: "not_needed" });
  });
});

describe("the 08:00 summary", () => {
  it("each person who asked, narrowed to their contracts, once a day, with no casual's name", async () => {
    const t = await office();
    const x = fakes();
    // An arena cancellation 2 hours ago (its place open again, starting in 10 hours).
    const shift = await shiftAt(t.f, t.arena, hoursFromNow(10));
    await casualCancels(t.f, t.worker, shift, hoursFromNow(-2));
    const payload = { firmId: t.f.firmId, idempotencyKey: "k", date: "2026-11-02" };
    expect(await runOfficeSummary(payload, withFirm, x.deps())).toEqual({
      status: "sent",
      emailed: 3,
      failed: 0,
      empty: 1,
    });
    // Anna, Cara and Dev (every venue); Ben's depot had nothing (no email); Pat is payroll; Gil's
    // access is off.
    expect(x.mail.map((m) => m.channel === "email" && m.to).length).toBe(3);
    const first = x.mail[0];
    if (first?.channel !== "email") throw new Error("not an email");
    expect(first.subject).toBe("Updates for Mon 2 Nov: 2 need action");
    expect(first.body).toContain("Here's what's happened at every venue since 08:00 yesterday.");
    expect(first.body).toContain(
      "- A cancellation · 12 hours' notice: Door supervisor, Arena, Mon 2 Nov 19:00 (the place is open again)",
    );
    expect(first.body).toContain(
      "- 1 place still to fill, starts in 10 h: Door supervisor, Arena, Mon 2 Nov 19:00",
    );
    expect(first.body).toContain(
      "Since 08:00 yesterday: 0 places taken, 1 cancellation (1 under 48 hours' notice), 0 uploads to check.",
    );
    expect(first.body).toContain("/office/updates");
    expect(first.body).not.toMatch(/Booker|Mo /);
    expect(await eventsOf(t.f, "office.summary_emailed")).toHaveLength(3);
    // The same day again: nobody's emailed twice.
    expect(await runOfficeSummary(payload, withFirm, x.deps())).toMatchObject({ emailed: 0 });
    expect(x.mail).toHaveLength(3);
  });

  it("counts from 08:00 yesterday, the firm's time, whenever today's goes", async () => {
    const t = await office();
    const x = fakes();
    // Cancelled at 07:30 yesterday (before the window) and 08:30 yesterday (in it), each session
    // filled since (so neither needs action), at the arena.
    for (const at of ["2026-11-01T07:30:00Z", "2026-11-01T08:30:00Z"]) {
      const shift = await shiftAt(t.f, t.arena, hoursFromNow(100));
      await casualCancels(t.f, await t.f.worker(), shift, new Date(at));
      await su.query("update shifts set status = 'filled' where id = $1", [shift]);
    }
    // Sent at 10:30 (the worker was down at 08:00): still from 08:00 yesterday, not 24 hours.
    const late = new Date("2026-11-02T10:30:00Z");
    await runOfficeSummary(
      { firmId: t.f.firmId, idempotencyKey: "k", date: "2026-11-02" },
      withFirm,
      x.deps(late),
    );
    const first = x.mail[0];
    if (first?.channel !== "email") throw new Error("not an email");
    expect(first.subject).toBe("Updates for Mon 2 Nov: nothing needs action");
    expect(first.body).toContain(
      "Since 08:00 yesterday: 0 places taken, 1 cancellation (0 under 48 hours' notice), 0 uploads to check.",
    );
  });

  it("an email that can't be sent is logged, and not tried again that day", async () => {
    const t = await office();
    const x = fakes();
    x.failMail();
    const shift = await shiftAt(t.f, t.arena, hoursFromNow(10));
    await casualCancels(t.f, t.worker, shift, hoursFromNow(-2));
    const payload = { firmId: t.f.firmId, idempotencyKey: "k", date: "2026-11-02" };
    expect(await runOfficeSummary(payload, withFirm, x.deps())).toMatchObject({ failed: 3 });
    expect(await eventsOf(t.f, "office.summary_failed")).toHaveLength(3);
    expect(await runOfficeSummary(payload, withFirm, x.deps())).toMatchObject({
      emailed: 0,
      failed: 0,
    });
  });
});

describe("the tick", () => {
  it("queues each firm's open-places job every 5 minutes, and its summary once from 08:00 to 11:00", async () => {
    const t = await office();
    const tick = (at: Date) =>
      runOfficeAlertsTick({
        listFirmIds: async () => [t.f.firmId],
        run: withFirm,
        clock: clockAt(at),
      });
    // 07:55 London: the open places only.
    expect(await tick(new Date("2026-11-02T07:55:00Z"))).toEqual({ open: 1, summaries: 0 });
    // 08:00: the summary too; 08:05: the next slot's open places, the same day's summary not again.
    expect(await tick(new Date("2026-11-02T08:00:00Z"))).toEqual({ open: 1, summaries: 1 });
    expect(await tick(new Date("2026-11-02T08:05:00Z"))).toEqual({ open: 1, summaries: 0 });
    // The same slot twice: once.
    expect(await tick(new Date("2026-11-02T08:06:00Z"))).toEqual({ open: 0, summaries: 0 });
    // 11:00 the next day: too late for that day's summary.
    expect(await tick(new Date("2026-11-03T11:00:00Z"))).toEqual({ open: 1, summaries: 0 });
    expect(await jobsOf(t.f, "office-summary")).toEqual([
      { firmId: t.f.firmId, idempotencyKey: "office-summary:2026-11-02", date: "2026-11-02" },
    ]);
  });
});
