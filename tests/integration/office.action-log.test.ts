import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { loadActionLog, officeActionLog, parseLogQuery } from "@/lib/office/action-log";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office's action log (docs/screens.md `/office/log`): every event, newest first, filtered by
// worker, shift, type and dates. On the real database, as the app role. The log is read as at
// LOG_NOW, Monday 3 November 2025, 09:00 London (GMT), and every date searched for events is in
// 2025: the fixtures log one event at the real time (2026 on), which must never fall in a test's
// dates. Late October 2025 is still British Summer Time (until the 26th).

const LOG_NOW = new Date("2025-11-03T09:00:00Z");
const at = (hours: number) => new Date(LOG_NOW.getTime() + hours * 3_600_000);

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

async function logFirm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  await su.query("update office_users set name = 'Sam Rota' where id = $1", [resourcer]);
  const { rows: site } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text as id",
    [f.firmId],
  );
  const shiftId = await f.shift({ startsAt: new Date("2026-11-07T08:00:00Z") });
  await su.query("update shifts set site_id = $2 where id = $1", [shiftId, site[0]?.id]);
  const otherShift = await f.shift({ startsAt: new Date("2026-11-08T08:00:00Z") });
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const annBooking = await f.booking(ann, shiftId, "confirmed");
  const benBooking = await f.booking(ben, otherShift, "confirmed");
  const { rows: cred } = await su.query<{ id: string }>(
    "select id::text from credentials where worker_id = $1 and type = 'SIA_DS'",
    [ann],
  );
  const { rows: req } = await su.query<{ id: string }>(
    `insert into requests (firm_id, worker_id, shift_id, type, payload)
     values ($1, $2, $3, 'swap', '{}') returning id::text as id`,
    [f.firmId, ann, shiftId],
  );
  const event = async (o: {
    action: string;
    at: Date;
    actorType?: string;
    actorId?: string | null;
    entityType?: string;
    entityId?: string | null;
    data?: Record<string, unknown>;
  }) =>
    Number(
      (
        await su.query<{ id: string }>(
          `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text as id`,
          [
            f.firmId,
            o.actorType ?? "system",
            o.actorId ?? null,
            o.action,
            o.entityType ?? "shift",
            o.entityId ?? null,
            JSON.stringify(o.data ?? {}),
            o.at,
          ],
        )
      ).rows[0]?.id,
    );
  // The fixture's own setup logs one event (the credential pack) at the real time, long after
  // LOG_NOW, so it's outside every range these tests look at.
  const log = (query: Record<string, string> = {}, now = LOG_NOW, before: number | null = null) =>
    withFirm(f.firmId, (tx) => loadActionLog(tx, parseLogQuery(query), now, before));
  return {
    f,
    resourcer,
    shiftId,
    otherShift,
    ann,
    ben,
    annBooking,
    benBooking,
    credentialId: cred[0]?.id ?? "",
    requestId: req[0]?.id ?? "",
    event,
    log,
  };
}

const words = (entries: { words: string }[]) => entries.map((e) => e.words);

describe("the action log", () => {
  it("newest first, the last 7 days by default, in plain words with the shift linked", async () => {
    const t = await logFirm();
    await t.event({ action: "shift.created", at: at(-24 * 8), entityId: t.shiftId });
    await t.event({
      action: "shift.cancelled",
      at: at(-3),
      actorType: "worker",
      actorId: t.ann,
      entityType: "assignment",
      entityId: t.annBooking,
      data: { by: "worker", shiftId: t.shiftId, workerId: t.ann, noticeHours: 116 },
    });
    await t.event({
      action: "auth.login",
      at: at(-1),
      actorType: "office",
      actorId: t.resourcer,
      entityType: "session",
      data: { kind: "office" },
    });
    const log = await t.log();
    expect(log.filters).toMatchObject({ from: "2025-10-28", to: "2025-11-03" });
    expect(log.entries.map((e) => [e.type, e.words, e.shift?.label ?? null])).toEqual([
      ["Logins", "Sam Rota logged in.", null],
      [
        "Cancellations",
        "Ann Booker cancelled, with 4 days' notice.",
        "Door supervisor at Riverside Arena, Sat 7 Nov 2026 08:00",
      ],
    ]);
    expect(log.entries[1]?.shift?.id).toBe(t.shiftId);
    expect(log.older).toBeNull();
  });

  it("by worker: events naming them, done by them, about them, or about their bookings, requests and credentials", async () => {
    const t = await logFirm();
    const when = at(-2);
    const mine = [
      await t.event({
        action: "shift.assigned",
        at: when,
        data: { workerId: t.ann, shiftId: t.shiftId },
      }),
      await t.event({
        action: "auth.login",
        at: when,
        actorType: "worker",
        actorId: t.ann,
        data: {},
      }),
      await t.event({ action: "worker.updated", at: when, entityType: "worker", entityId: t.ann }),
      await t.event({
        action: "shift.reminder_sent",
        at: when,
        entityType: "assignment",
        entityId: t.annBooking,
      }),
      await t.event({
        action: "request.approved",
        at: when,
        actorType: "office",
        actorId: t.resourcer,
        entityType: "request",
        entityId: t.requestId,
        data: { type: "swap", shiftId: t.shiftId, withNote: false },
      }),
      await t.event({
        action: "credential.updated",
        at: when,
        entityType: "credential",
        entityId: t.credentialId,
        data: { type: "SIA_DS" },
      }),
    ];
    await t.event({ action: "shift.assigned", at: when, data: { workerId: t.ben } });
    await t.event({ action: "auth.login", at: when, actorType: "worker", actorId: t.ben });
    await t.event({
      action: "shift.reminder_sent",
      at: when,
      entityType: "assignment",
      entityId: t.benBooking,
    });
    const log = await t.log({ worker: t.ann });
    expect(log.entries.map((e) => e.id)).toEqual([...mine].reverse());
    expect(words(log.entries)).toEqual([
      "Ann Booker's SIA door supervisor licence was updated.",
      "Sam Rota approved Ann Booker's request (swap).",
      "Reminder sent to Ann Booker.",
      "Ann Booker's details were updated.",
      "Ann Booker logged in.",
      "Ann Booker took it.",
    ]);
    expect(log.filters.worker).toBe(t.ann);
  });

  it("by worker, too: a refused move or rota sheet change that names them among its workers", async () => {
    const t = await logFirm();
    const when = at(-2);
    const refused = await t.event({
      action: "shift.move_refused",
      at: when,
      entityId: t.shiftId,
      data: { by: "firm", reason: "rules", workers: [{ workerId: t.ann, codes: ["REST"] }] },
    });
    const sheet = await t.event({
      action: "roster.sheet_change_refused",
      at: when,
      entityId: t.otherShift,
      data: {
        fields: ["startsAt"],
        reason: "rules",
        workers: [
          { workerId: t.ben, codes: ["REST"] },
          { workerId: t.ann, codes: ["HOURS"] },
        ],
      },
    });
    // Ben's alone: not Ann's.
    await t.event({
      action: "shift.move_refused",
      at: when,
      entityId: t.otherShift,
      data: { by: "firm", reason: "rules", workers: [{ workerId: t.ben, codes: ["REST"] }] },
    });
    expect((await t.log({ worker: t.ann })).entries.map((e) => e.id)).toEqual([sheet, refused]);
  });

  it("by worker or shift, on indexes the firm's walls let it use (Phase 25.3)", async () => {
    const t = await logFirm();
    const id = await t.event({
      action: "shift.assigned",
      at: at(-2),
      actorType: "worker",
      actorId: t.ann,
      data: { workerId: t.ann, shiftId: t.shiftId },
    });
    // The worker and session an entry's data names, copied by the database.
    const { rows } = await su.query<{ worker_ref: string; shift_ref: string }>(
      "select worker_ref, shift_ref from events where id = $1",
      [id],
    );
    expect(rows).toEqual([{ worker_ref: t.ann, shift_ref: t.shiftId }]);
    // Under RLS, as the app role: each look-up can use its index (one on `data ->> 'workerId'`
    // couldn't: jsonb's functions aren't leakproof). Sequential scans off, so the plan shows
    // whether the index is usable at all, whatever the table's size.
    const plan = async (where: string, value: string) => {
      const c = await app.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('app.current_firm_id', $1, true)", [t.f.firmId]);
        await c.query("set local enable_seqscan = off");
        const { rows: lines } = await c.query<{ "QUERY PLAN": string }>(
          `explain select id from events where ${where} = $1`,
          [value],
        );
        return lines.map((l) => l["QUERY PLAN"]).join("\n");
      } finally {
        await c.query("rollback");
        c.release();
      }
    };
    expect(await plan("worker_ref", t.ann)).toContain("events_firm_id_worker_ref_idx");
    expect(await plan("shift_ref", t.shiftId)).toContain("events_firm_id_shift_ref_idx");
    expect(await plan("actor_id", t.ann)).toContain("events_firm_id_actor_id_idx");
    // And not on the data itself (why the columns exist).
    expect(await plan("data ->> 'workerId'", t.ann)).not.toMatch(
      /Index (Only )?Scan using events_firm_id_worker_ref_idx/,
    );
  });

  it("by worker, too: their pay records, login links and pay-page codes (the events don't name them)", async () => {
    const t = await logFirm();
    const when = at(-1);
    const { rows: pay } = await su.query<{ id: string }>(
      `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence)
       values ($1, $2, '2025-10-20', '2025-10-26', 16, 1300) returning id::text as id`,
      [t.f.firmId, t.ann],
    );
    const { rows: link } = await su.query<{ id: string; request_id: string }>(
      `insert into magic_links (firm_id, kind, worker_id, token_hash, request_id, expires_at)
       values ($1, 'worker', $2, sha256(gen_random_uuid()::text::bytea), gen_random_uuid(), now())
       returning id::text as id, request_id::text as request_id`,
      [t.f.firmId, t.ann],
    );
    const mine = [
      await t.event({
        action: "pay_record.imported",
        at: when,
        actorType: "office",
        actorId: t.resourcer,
        entityType: "pay_record",
        entityId: pay[0]?.id,
        data: { periodStart: "2025-10-20", periodEnd: "2025-10-26" },
      }),
      await t.event({
        action: "auth.link_requested",
        at: when,
        entityType: "login_request",
        entityId: link[0]?.request_id,
        data: { kind: "worker", matched: true },
      }),
      await t.event({
        action: "auth.link_sent",
        at: when,
        entityType: "magic_link",
        entityId: link[0]?.id,
        data: { purpose: "worker_login", channel: "whatsapp" },
      }),
    ];
    const log = await t.log({ worker: t.ann });
    expect(log.entries.map((e) => e.id)).toEqual([...mine].reverse());
    expect(words(log.entries)).toEqual([
      "Login link sent to Ann Booker.",
      "Ann Booker asked for a login link.",
      "A pay record was added for Ann Booker (Mon 20 Oct to Sun 26 Oct).",
    ]);
    expect((await t.log({ worker: t.ben })).entries).toEqual([]);
    // An upper-case id in the address works the same.
    expect((await t.log({ worker: t.ann.toUpperCase() })).entries).toHaveLength(3);
    expect((await t.log({ type: "pay" })).entries.map((e) => e.type)).toEqual([
      "Pay records and queries",
    ]);
  });

  it("by shift: events about it, naming it, or about its bookings and requests; all of its time with no dates", async () => {
    const t = await logFirm();
    const mine = [
      await t.event({ action: "shift.created", at: at(-24 * 30), entityId: t.shiftId }),
      await t.event({
        action: "offer.sent",
        at: at(-5),
        entityType: "offer",
        data: { shiftId: t.shiftId, workerId: t.ben, wave: 1 },
      }),
      await t.event({
        action: "shift.reminder_sent",
        at: at(-4),
        entityType: "assignment",
        entityId: t.annBooking,
      }),
      await t.event({
        action: "request.created",
        at: at(-3),
        actorType: "worker",
        actorId: t.ann,
        entityType: "request",
        entityId: t.requestId,
        data: { type: "swap", shiftId: t.shiftId },
      }),
    ];
    await t.event({ action: "shift.created", at: at(-2), entityId: t.otherShift });
    await t.event({
      action: "shift.reminder_sent",
      at: at(-2),
      entityType: "assignment",
      entityId: t.benBooking,
    });
    const log = await t.log({ shift: t.shiftId });
    expect(log.entries.map((e) => e.id)).toEqual([...mine].reverse());
    expect(log.filters).toMatchObject({ shift: t.shiftId, from: null, to: null });
    expect(log.shifts.map((s) => s.id)).toEqual([t.shiftId]); // the chosen one, for the form
    // With dates, only those days.
    expect((await t.log({ shift: t.shiftId, from: "2025-11-02" })).entries).toHaveLength(3);
  });

  it("by type, and by dates: whole days in London time (summer time too), at most 92 days", async () => {
    const t = await logFirm();
    await t.event({ action: "shift.cancelled_by_firm", at: at(-2), entityId: t.shiftId });
    await t.event({ action: "offer.waves_stopped", at: at(-2), entityId: t.shiftId });
    expect(words((await t.log({ type: "cancellations" })).entries)).toEqual([
      "The office cancelled the shift.",
    ]);
    // 00:30 on Tuesday 21 October 2025, summer time, is 23:30 on the 20th in UTC.
    const late = await t.event({
      action: "shift.created",
      at: new Date("2025-10-20T23:30:00Z"),
      entityId: t.shiftId,
    });
    const ids = async (q: Record<string, string>) => (await t.log(q)).entries.map((e) => e.id);
    expect(await ids({ from: "2025-10-21", to: "2025-10-21" })).toEqual([late]);
    expect(await ids({ from: "2025-10-20", to: "2025-10-20" })).toEqual([]);
    // Back to front is put right.
    expect(await ids({ from: "2025-10-22", to: "2025-10-19" })).toEqual([late]);
    const long = await t.log({ from: "2025-01-01", to: "2025-11-03" });
    expect(long).toMatchObject({
      clamped: true,
      filters: { from: "2025-08-04", to: "2025-11-03" },
    });
    // The shift picker lists the shifts in the chosen dates.
    expect((await t.log({ from: "2026-11-07", to: "2026-11-08" })).shifts.map((s) => s.id)).toEqual(
      [t.shiftId, t.otherShift],
    );
  });

  it("a limit reached is filed by the limit's name: Take shift under Bookings, phones under Workers, the planner's key under Firm settings, the rest under Logins (14.2)", async () => {
    const t = await logFirm();
    const limit = (name: string | null, hours: number) =>
      t.event({
        action: "auth.rate_limited",
        at: at(hours),
        entityType: "worker",
        data: name === null ? {} : { limit: name },
      });
    // Oldest first, as events arrive (the log lists the newest first).
    const booked = await t.event({ action: "shift.assigned", at: at(-6), entityId: t.shiftId });
    const unnamed = await limit(null, -5);
    const ip = await limit("login:ip", -4);
    const strikes = await limit("strikes_link:firm", -3.5);
    const key = await limit("api:key", -3);
    const phones = await limit("push:worker", -2);
    const take = await limit("take:worker", -1);
    const ids = async (type: string) => (await t.log({ type })).entries.map((e) => e.id);
    expect(await ids("bookings")).toEqual([take, booked]);
    expect(await ids("workers")).toEqual([phones]);
    expect(await ids("firm")).toEqual([key, strikes]);
    expect(await ids("logins")).toEqual([ip, unnamed]);
    // Each line says its group too.
    const all = (await t.log()).entries;
    expect(
      [take, phones, key, ip, unnamed].map((id) => all.find((e) => e.id === id)?.type),
    ).toEqual(["Bookings", "Workers", "Firm settings and office team", "Logins", "Logins"]);
  });

  it("100 at a time; Older carries on from the last one", async () => {
    const t = await logFirm();
    const ids: number[] = [];
    for (let i = 0; i < 105; i++) {
      ids.push(
        await t.event({
          action: "shift.changed",
          at: at(-100 + i / 2),
          entityId: t.shiftId,
        }),
      );
    }
    const first = await t.log();
    expect(first.entries).toHaveLength(100);
    expect(first.entries[0]?.id).toBe(ids[104]);
    expect(first.older).toBe(ids[5]);
    const second = await t.log({}, LOG_NOW, first.older);
    expect(second.entries.map((e) => e.id)).toEqual(ids.slice(0, 5).reverse());
    expect(second.older).toBeNull();
  });

  // Audit L44: event numbers are shared by every firm, so the page's link never shows one.
  it("the Older link carries an opaque cursor, never an event number; another firm's or an altered one is ignored", async () => {
    const page = async (t: Awaited<ReturnType<typeof logFirm>>, before?: string) => {
      const token = (
        await withFirm(t.f.firmId, (tx) =>
          createSession(tx, { kind: "office", subjectId: t.resourcer, now: LOG_NOW }),
        )
      ).token;
      const log = await officeActionLog(
        { firm: { id: t.f.firmId }, run: withFirm, clock: { now: () => LOG_NOW } },
        token,
        parseLogQuery(before === undefined ? {} : { before }),
      );
      if (!log) throw new Error("no log");
      return log;
    };
    // The page gets no event ids, so its lines are told apart by their times (each its own).
    const fill = async (t: Awaited<ReturnType<typeof logFirm>>) => {
      const ids: number[] = [];
      const times: number[] = [];
      for (let i = 0; i < 105; i++) {
        times.push(at(-100 + i / 2).getTime());
        ids.push(
          await t.event({ action: "shift.changed", at: at(-100 + i / 2), entityId: t.shiftId }),
        );
      }
      return { ids, times };
    };
    const t = await logFirm();
    const other = await logFirm();
    const { ids, times } = await fill(t);
    await fill(other);

    const first = await page(t);
    expect(first.older).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(first.older).not.toContain(String(ids[5]));
    // No event number reaches the page at all (a list key would put it in the page's source).
    expect(first.entries[0]).not.toHaveProperty("id");
    expect(Object.keys(first.entries[0] ?? {}).sort()).toEqual(["at", "shift", "type", "words"]);
    const second = await page(t, first.older ?? "");
    expect(second.entries.map((e) => e.at.getTime())).toEqual(times.slice(0, 5).reverse());
    expect(second.older).toBeNull();

    // Another firm's cursor, one altered, or a bare event number: the first page.
    const theirs = (await page(other)).older ?? "";
    const altered = `${(first.older ?? "").slice(0, 20)}${(first.older ?? "").charAt(20) === "A" ? "B" : "A"}${(first.older ?? "").slice(21)}`;
    for (const before of [theirs, altered, String(ids[5])]) {
      expect((await page(t, before)).entries[0]?.at.getTime(), before).toBe(times[104]);
    }
  });

  it("only this firm's events, whatever the filters say; nonsense filters are ignored", async () => {
    const t = await logFirm();
    const other = await logFirm();
    await other.event({ action: "shift.created", at: at(-1), entityId: other.shiftId });
    await other.event({
      action: "auth.login",
      at: at(-1),
      actorType: "worker",
      actorId: other.ann,
    });
    expect((await t.log()).entries).toEqual([]);
    expect((await t.log({ shift: other.shiftId })).entries).toEqual([]);
    expect((await t.log({ worker: other.ann })).entries).toEqual([]);
    expect((await t.log()).workers.map((w) => w.id).sort()).toEqual([t.ann, t.ben].sort());
    expect(
      parseLogQuery({
        worker: "nope",
        shift: "1",
        type: "everything",
        from: "2026-02-30",
        to: "yesterday",
        before: "-4",
      }),
    ).toEqual({ worker: null, shift: null, type: null, from: null, to: null, before: null });
  });

  it("admins and resourcers; not payroll; not logged out", async () => {
    const t = await logFirm();
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock: { now: () => NOW } };
    const sessionFor = async (officeUserId: string) =>
      (
        await withFirm(t.f.firmId, (tx) =>
          createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
        )
      ).token;
    const query = parseLogQuery({});
    expect(await officeActionLog(ctx, await sessionFor(t.resourcer), query)).not.toBeNull();
    expect(
      await officeActionLog(ctx, await sessionFor(await t.f.office("admin")), query),
    ).not.toBeNull();
    expect(
      await officeActionLog(ctx, await sessionFor(await t.f.office("payroll")), query),
    ).toBeNull();
    expect(await officeActionLog(ctx, "", query)).toBeNull();
  });
});
