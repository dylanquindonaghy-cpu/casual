import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { passesLogCheck } from "@/lib/events/record";
import { FIRM_CHANGE_NOTICE_QUEUE } from "@/lib/notices/firm-change";
import { loadCancellations } from "@/lib/office/cancellations";
import { howText } from "@/lib/office/cancellations-copy";
import { loadEventCards } from "@/lib/office/events";
import {
  assignWorker,
  cancelBookingByOffice,
  cancelShift,
  markFilled,
  moveShift,
  openAgain,
} from "@/lib/office/quick-actions";
import { editShift, editShiftDetails } from "@/lib/office/shift-editor";
import { officeShiftDetail, officeShiftList } from "@/lib/office/shift-pages";
import { changeWorkerStatus, keepFlaggedBooking } from "@/lib/office/worker-access";
import { cancelShiftByFirm, cancelShiftInTx } from "@/lib/roster/cancel";
import {
  MoveBlocked,
  moveShiftByFirm,
  moveShiftInTx,
  recordMoveRefused,
} from "@/lib/roster/firm-change";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The firm's planner as a second, narrower caller of the whole-session move and cancel (S11 (d),
// docs/office-v2.md 5.3.2; 12J.1), and the office's "planner" refusal for the sessions it sends.
// On the real database, as the app role; keys are added as the superuser (the office's key page
// is tested on its own). NOW is Monday 2 November 2026, 09:00 London (GMT, so London is UTC).

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

const at = (when: Date) => ({ clock: { now: () => when } });
const utc = (s: string) => new Date(`${s}Z`);
const REASON = "The event's times or place changed";

async function addKey(firmId: string, createdBy: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `insert into api_keys (firm_id, label, token_hash, hint, created_by)
     values ($1, 'Planner', $2, 'abcd', $3) returning id::text as id`,
    [firmId, randomBytes(32), createdBy],
  );
  return rows[0]?.id ?? "";
}

// A firm whose planner sent Saturday 7 November, 08:00 to 16:00 at the arena: two places, Ann and
// Ben booked (`source` "native" makes the same session the office's own).
async function plannerFirm(source: "api" | "native" = "api") {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena'), ($1, 'Other Stadium') returning id::text as id",
    [f.firmId],
  );
  const [arena = "", stadium = ""] = rows.map((r) => r.id);
  const shiftId = await f.shift({ startsAt: utc("2026-11-07T08:00:00"), headcount: 2 });
  await su.query("update shifts set site_id = $2, source = $3, external_ref = $4 where id = $1", [
    shiftId,
    arena,
    source,
    source === "api" ? `SESSION-${shiftId.slice(0, 8)}` : null,
  ]);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const annBooking = await f.booking(ann, shiftId, "confirmed", 1);
  const benBooking = await f.booking(ben, shiftId, "confirmed", 2);
  await su.query("update shifts set status = 'filled' where id = $1", [shiftId]);
  await addKey(f.firmId, admin);
  return { f, admin, resourcer, arena, stadium, shiftId, ann, ben, annBooking, benBooking };
}

// The planner's move to new instants (whole minutes), as its PUT sends them.
const apiMove = (
  t: { shiftId: string; arena: string },
  keyId: string,
  o: { startsAt?: string; endsAt?: string; siteId?: string | null } = {},
) => ({
  shiftId: t.shiftId,
  startsAt: utc(o.startsAt ?? "2026-11-07T10:00:00"),
  endsAt: utc(o.endsAt ?? "2026-11-07T18:00:00"),
  siteId: o.siteId === undefined ? t.arena : o.siteId,
  reason: "event_changed" as const,
  by: { type: "api" as const, keyId },
});

const keyOf = async (firmId: string) =>
  (
    await su.query<{ id: string }>(
      "select id::text as id from api_keys where firm_id = $1 order by created_at limit 1",
      [firmId],
    )
  ).rows[0]?.id ?? "";

const officeCtx = (firmId: string, officeUserId: string, when = NOW) => ({
  firm: { id: firmId },
  officeUserId,
  run: withFirm,
  clock: { now: () => when },
});

// Ordered by the number (events.id).
const eventsOf = async (firmId: string, like: string) =>
  (
    await su.query<{
      action: string;
      actor_type: string;
      actor_id: string | null;
      entity_id: string;
      data: Record<string, unknown>;
    }>(
      `select action, actor_type, actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action like $2 order by events.id`,
      [firmId, like],
    )
  ).rows;
const noticeJobs = async (firmId: string) =>
  (
    await su.query<{ data: { assignmentId: string } }>(
      `select data from pgboss.job where name = $1 and data ->> 'firmId' = $2
        order by (data ->> 'eventId')::bigint`,
      [FIRM_CHANGE_NOTICE_QUEUE, firmId],
    )
  ).rows.map((r) => r.data.assignmentId);
// Everything about the session and its bookings that a refused change must leave alone.
const snapshot = async (shiftId: string) => ({
  shift: (
    await su.query(
      `select starts_at, ends_at, site_id, status, headcount, role, pay_rate_pence, post
         from shifts where id = $1`,
      [shiftId],
    )
  ).rows[0],
  bookings: (
    await su.query(
      `select id, slot, worker_id, status, cancel_via from assignments
        where shift_id = $1 order by slot, id`,
      [shiftId],
    )
  ).rows,
  events: (await su.query("select 1 from events where entity_id = $1", [shiftId])).rows.length,
});

describe("the planner moving a booked session", () => {
  it("works with no office user: each casual's notice hours logged and their notice queued, under the system actor with the key's id", async () => {
    const t = await plannerFirm();
    const keyId = await keyOf(t.f.firmId);
    // Nobody in the office can act: the key alone is enough.
    await su.query("update office_users set status = 'disabled' where firm_id = $1", [t.f.firmId]);
    expect(await moveShiftByFirm(withFirm, t.f.firmId, apiMove(t, keyId), at(NOW))).toEqual({
      status: "moved",
      told: 2,
      noticeHours: 119,
      warnings: [],
    });
    const { rows } = await su.query("select starts_at, ends_at from shifts where id = $1", [
      t.shiftId,
    ]);
    expect(rows).toEqual([
      { starts_at: utc("2026-11-07T10:00:00"), ends_at: utc("2026-11-07T18:00:00") },
    ]);
    const moved = await eventsOf(t.f.firmId, "shift.moved");
    expect(moved.map((e) => [e.actor_type, e.actor_id, e.entity_id, e.data])).toEqual(
      [
        [t.annBooking, t.ann],
        [t.benBooking, t.ben],
      ].map(([booking, worker]) => [
        "system",
        null,
        booking,
        {
          by: "firm",
          via: "api",
          keyId,
          shiftId: t.shiftId,
          workerId: worker,
          reason: REASON,
          oldStartsAt: "2026-11-07T08:00:00.000Z",
          oldEndsAt: "2026-11-07T16:00:00.000Z",
          newStartsAt: "2026-11-07T10:00:00.000Z",
          newEndsAt: "2026-11-07T18:00:00.000Z",
          oldSiteId: t.arena,
          newSiteId: t.arena,
          noticeHours: 119,
          rulesOk: true,
        },
      ]),
    );
    const changed = await eventsOf(t.f.firmId, "shift.changed");
    expect(changed.map((e) => [e.actor_type, e.actor_id, e.entity_id, e.data])).toEqual([
      [
        "system",
        null,
        t.shiftId,
        {
          by: "firm",
          via: "api",
          keyId,
          fields: ["startsAt", "endsAt"],
          reason: REASON,
          from: {
            startsAt: "2026-11-07T08:00:00.000Z",
            endsAt: "2026-11-07T16:00:00.000Z",
            siteId: t.arena,
          },
          to: {
            startsAt: "2026-11-07T10:00:00.000Z",
            endsAt: "2026-11-07T18:00:00.000Z",
            siteId: t.arena,
          },
        },
      ],
    ]);
    // Each casual is told (golden rule 12).
    expect(await noticeJobs(t.f.firmId)).toEqual([t.annBooking, t.benBooking]);
    for (const e of [...moved, ...changed]) expect(passesLogCheck(e.data)).toBe(true);
    // Still booked.
    const booked = await su.query("select status from assignments where id = any($1)", [
      [t.annBooking, t.benBooking],
    ]);
    expect(booked.rows).toEqual([{ status: "confirmed" }, { status: "confirmed" }]);
  });

  it("inside the PUT's own transaction: shortened, another site, and only whole minutes, a real window, still ahead", async () => {
    const t = await plannerFirm();
    const by = { type: "api" as const, keyId: await keyOf(t.f.firmId) };
    const inTx = (o: { startsAt: string; endsAt: string; siteId?: string }) =>
      withFirm(t.f.firmId, (tx) =>
        moveShiftInTx(tx, {
          shiftId: t.shiftId,
          startsAt: utc(o.startsAt),
          endsAt: utc(o.endsAt),
          siteId: o.siteId ?? t.arena,
          reason: "fewer_staff",
          by,
          now: NOW,
          timeZone: "Europe/London",
        }),
      );
    for (const [startsAt, endsAt] of [
      ["2026-11-07T10:00:30", "2026-11-07T18:00:00"], // not a whole minute
      ["2026-11-07T18:00:00", "2026-11-07T10:00:00"], // finishes before it starts
      ["2026-11-07T10:00:00", "2026-11-08T10:00:00"], // a whole day
    ] as const) {
      expect(await inTx({ startsAt, endsAt })).toEqual({ status: "invalid", problem: "bad_time" });
    }
    expect(await inTx({ startsAt: "2026-11-01T10:00:00", endsAt: "2026-11-01T18:00:00" })).toEqual({
      status: "invalid",
      problem: "in_past",
    });
    expect(await inTx({ startsAt: "2026-11-07T08:00:00", endsAt: "2026-11-07T16:00:00" })).toEqual({
      status: "unchanged",
    });
    expect(await inTx({ startsAt: "2026-11-07T08:00:00", endsAt: "2026-11-07T12:00:00" })).toEqual({
      status: "curtailed",
      told: 2,
      noticeHours: 119,
      warnings: [],
    });
    expect(
      await inTx({
        startsAt: "2026-11-07T08:00:00",
        endsAt: "2026-11-07T12:00:00",
        siteId: t.stadium,
      }),
    ).toMatchObject({ status: "moved", told: 2 });
    expect((await eventsOf(t.f.firmId, "shift.curtailed")).map((e) => e.data.via)).toEqual([
      "api",
      "api",
    ]);
    expect((await eventsOf(t.f.firmId, "shift.moved")).map((e) => e.data.newSiteId)).toEqual([
      t.stadium,
      t.stadium,
    ]);
    expect(await noticeJobs(t.f.firmId)).toHaveLength(4);
  });

  it("a move that breaks a casual's rest gap is refused (the office could have overridden it): nothing changes, and the refusal is logged for the planner", async () => {
    // The same move by the office on its own session: rest is a warning it may override.
    const own = await plannerFirm("native");
    const ownLater = await own.f.shift({ startsAt: utc("2026-11-07T20:00:00") });
    await own.f.booking(own.ann, ownLater, "confirmed", 1);
    const officeMove = await moveShift(officeCtx(own.f.firmId, own.resourcer), own.shiftId, {
      date: "2026-11-07",
      start: "10:00",
      end: "18:00",
      siteId: own.arena,
      reason: "event_changed",
    });
    expect(officeMove).toMatchObject({ status: "moved", warnings: [{ workerId: own.ann }] });

    // Through the API nobody is there to see a warning: Ann's 2 hours' rest before her 20:00 shift
    // refuses the whole move.
    const t = await plannerFirm();
    const keyId = await keyOf(t.f.firmId);
    const later = await t.f.shift({ startsAt: utc("2026-11-07T20:00:00") });
    await t.f.booking(t.ann, later, "confirmed", 1);
    const before = await snapshot(t.shiftId);
    const result = await moveShiftByFirm(withFirm, t.f.firmId, apiMove(t, keyId), at(NOW));
    expect(result).toMatchObject({
      status: "blocked",
      workers: [{ workerId: t.ann, name: "Ann Booker" }],
    });
    expect(await snapshot(t.shiftId)).toEqual({ ...before, events: 1 }); // the refusal only
    expect(await eventsOf(t.f.firmId, "shift.moved")).toEqual([]);
    expect(await eventsOf(t.f.firmId, "shift.changed")).toEqual([]);
    expect(await noticeJobs(t.f.firmId)).toEqual([]);
    const refused = await eventsOf(t.f.firmId, "shift.move_refused");
    expect(refused.map((e) => [e.actor_type, e.actor_id, e.entity_id, e.data])).toEqual([
      [
        "system",
        null,
        t.shiftId,
        {
          by: "firm",
          via: "api",
          keyId,
          reason: REASON,
          workers: [{ workerId: t.ann, codes: ["rest"] }],
        },
      ],
    ]);
    expect(passesLogCheck(refused[0]?.data ?? {})).toBe(true);
  });

  it("a day off refuses it too; inside the PUT's transaction it throws MoveBlocked, and recordMoveRefused logs it after the rollback", async () => {
    const t = await plannerFirm();
    const keyId = await keyOf(t.f.firmId);
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-08')",
      [t.f.firmId, t.ben],
    );
    const before = await snapshot(t.shiftId);
    const sunday = apiMove(t, keyId, {
      startsAt: "2026-11-08T08:00:00",
      endsAt: "2026-11-08T16:00:00",
    });
    const thrown = await withFirm(t.f.firmId, (tx) =>
      moveShiftInTx(tx, { ...sunday, now: NOW }),
    ).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(MoveBlocked);
    const workers = thrown instanceof MoveBlocked ? thrown.workers : [];
    expect(workers).toMatchObject([
      { workerId: t.ben, name: "Ben Booker", codes: ["unavailable"] },
    ]);
    expect(await snapshot(t.shiftId)).toEqual(before);
    await recordMoveRefused(withFirm, t.f.firmId, {
      shiftId: t.shiftId,
      reason: "event_changed",
      by: sunday.by,
      workers,
    });
    expect((await eventsOf(t.f.firmId, "shift.move_refused")).map((e) => e.data)).toEqual([
      {
        by: "firm",
        via: "api",
        keyId,
        reason: REASON,
        workers: [{ workerId: t.ben, codes: ["unavailable"] }],
      },
    ]);
  });

  it("a booking the office chose to keep stops the planner's move all the same (the keep is the office's, for its own moves)", async () => {
    // The office's own session: Ann made inactive, her booking kept, and a new time at the same
    // site goes through (tests/integration/office.workers.test.ts has the rest of that).
    const own = await plannerFirm("native");
    const ownCtx = officeCtx(own.f.firmId, own.resourcer);
    await changeWorkerStatus(ownCtx, own.ann, { kind: "deactivate", reason: "paused" });
    await keepFlaggedBooking(ownCtx, own.shiftId, own.ann);
    expect(
      await moveShift(ownCtx, own.shiftId, {
        date: "2026-11-07",
        start: "10:00",
        end: "18:00",
        siteId: own.arena,
        reason: "event_changed",
      }),
    ).toMatchObject({ status: "moved" });

    // The same keep on the planner's session: its move to a new time at the same site is refused
    // for Ann's "not active", and nothing changes.
    const t = await plannerFirm();
    const keyId = await keyOf(t.f.firmId);
    const ctx = officeCtx(t.f.firmId, t.resourcer);
    await changeWorkerStatus(ctx, t.ann, { kind: "deactivate", reason: "paused" });
    expect(await keepFlaggedBooking(ctx, t.shiftId, t.ann)).toMatchObject({ status: "kept" });
    const before = await snapshot(t.shiftId);
    expect(await moveShiftByFirm(withFirm, t.f.firmId, apiMove(t, keyId), at(NOW))).toMatchObject({
      status: "blocked",
      workers: [{ workerId: t.ann, name: "Ann Booker" }],
    });
    expect(await snapshot(t.shiftId)).toEqual({ ...before, events: before.events + 1 });
    expect(await eventsOf(t.f.firmId, "shift.moved")).toEqual([]);
    expect(await noticeJobs(t.f.firmId)).toEqual([]);
    expect((await eventsOf(t.f.firmId, "shift.move_refused")).map((e) => e.data)).toEqual([
      expect.objectContaining({ workers: [{ workerId: t.ann, codes: ["not_active"] }] }),
    ]);
  });
});

describe("the planner cancelling a booked session", () => {
  it("each booking is the firm's (cancel_via api, never a strike), each casual told, logged under the system actor", async () => {
    const t = await plannerFirm();
    const keyId = await keyOf(t.f.firmId);
    await su.query("update office_users set status = 'disabled' where firm_id = $1", [t.f.firmId]);
    expect(
      await cancelShiftByFirm(
        withFirm,
        t.f.firmId,
        // An asker passed with the planner's own call is not used (Phase 25.2): only the office's
        // form says who asked; the planner's data doesn't.
        {
          shiftId: t.shiftId,
          reason: "event_cancelled",
          askedBy: "client",
          by: { type: "api", keyId },
        },
        at(NOW),
      ),
    ).toEqual({ status: "cancelled", bookings: 2 });
    const { rows } = await su.query(
      `select status, cancel_via, cancel_asked_by, cancel_reason, notice_hours::float as notice_hours
         from assignments where id = any($1) order by slot`,
      [[t.annBooking, t.benBooking]],
    );
    expect(rows).toEqual(
      [1, 2].map(() => ({
        status: "cancelled_firm",
        cancel_via: "api",
        // Who asked: not known, as the planner doesn't say (P3.4).
        cancel_asked_by: "unknown",
        cancel_reason: "The event was cancelled",
        notice_hours: 119,
      })),
    );
    const events = await eventsOf(t.f.firmId, "shift.cancelled%");
    expect(events.map((e) => [e.action, e.actor_type, e.actor_id, e.entity_id, e.data])).toEqual([
      ...[
        [t.annBooking, t.ann],
        [t.benBooking, t.ben],
      ].map(([booking, worker]) => [
        "shift.cancelled",
        "system",
        null,
        booking,
        {
          by: "firm",
          askedBy: "unknown", // the planner doesn't say who asked (P3.4)
          via: "api",
          keyId,
          shiftId: t.shiftId,
          workerId: worker,
          reason: "The event was cancelled",
          noticeHours: 119,
          strike: "by_firm",
          place: "session_cancelled",
        },
      ]),
      [
        "shift.cancelled_by_firm",
        "system",
        null,
        t.shiftId,
        { by: "firm", via: "api", keyId, reason: "The event was cancelled", bookings: 2 },
      ],
    ]);
    for (const e of events) expect(passesLogCheck(e.data)).toBe(true);
    const strikes = await su.query("select 1 from strikes where firm_id = $1", [t.f.firmId]);
    expect(strikes.rows).toEqual([]);
    expect(await noticeJobs(t.f.firmId)).toEqual([t.annBooking, t.benBooking]);
    // The cancellation records say the planner did it (no office user).
    const list = await withFirm(t.f.firmId, (tx) =>
      loadCancellations(tx, { view: "all", now: NOW, limit: 100 }),
    );
    expect(list.rows.map((r) => [r.by, r.via, r.officeName, r.strikeCode, howText(r)])).toEqual([
      ["planner", "api", null, "by_firm", "By your planner"],
      ["planner", "api", null, "by_firm", "By your planner"],
    ]);
  });

  it("inside the PUT's own transaction; a started session and a cancelled one are left alone", async () => {
    const t = await plannerFirm();
    const by = { type: "api" as const, keyId: await keyOf(t.f.firmId) };
    const cancel = (shiftId: string, now = NOW) =>
      withFirm(t.f.firmId, (tx) => cancelShiftInTx(tx, { shiftId, reason: "weather", by, now }));
    expect(await cancel(t.shiftId, utc("2026-11-07T08:00:00"))).toEqual({ status: "started" });
    expect(await cancel(t.shiftId)).toEqual({ status: "cancelled", bookings: 2 });
    expect(await cancel(t.shiftId)).toEqual({ status: "unchanged" });
  });
});

describe("only a live key, and only the planner's own sessions", () => {
  it("a key revoked a moment before is refused, and nothing changes", async () => {
    const t = await plannerFirm();
    const keyId = await keyOf(t.f.firmId);
    await su.query("update api_keys set revoked_at = now(), revoked_by = $2 where id = $1", [
      keyId,
      t.admin,
    ]);
    const before = await snapshot(t.shiftId);
    expect(await moveShiftByFirm(withFirm, t.f.firmId, apiMove(t, keyId), at(NOW))).toEqual({
      status: "not_allowed",
    });
    expect(
      await cancelShiftByFirm(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, reason: "weather", by: { type: "api", keyId } },
        at(NOW),
      ),
    ).toEqual({ status: "not_allowed" });
    expect(await snapshot(t.shiftId)).toEqual(before);
  });

  it("a revocation committed while the change waits on the key is seen inside the change's transaction", async () => {
    const t = await plannerFirm();
    const keyId = await keyOf(t.f.firmId);
    const before = await snapshot(t.shiftId);
    const revoker = await su.connect();
    try {
      await revoker.query("begin");
      await revoker.query("update api_keys set revoked_at = now(), revoked_by = $2 where id = $1", [
        keyId,
        t.admin,
      ]);
      const pid = (await revoker.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]
        ?.pid;
      const move = moveShiftByFirm(withFirm, t.f.firmId, apiMove(t, keyId), at(NOW));
      // The move holds the key's row for share, so it waits for the revocation to finish.
      for (let i = 0; i < 100; i += 1) {
        const { rows } = await su.query<{ n: number }>(
          "select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
          [pid],
        );
        if (rows[0]?.n === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const { rows: waiting } = await su.query<{ n: number }>(
        "select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
        [pid],
      );
      expect(waiting).toEqual([{ n: 1 }]);
      await revoker.query("commit");
      expect(await move).toEqual({ status: "not_allowed" });
    } finally {
      revoker.release();
    }
    expect(await snapshot(t.shiftId)).toEqual(before);
  });

  it("another firm's key, and sessions the planner didn't send, look unknown", async () => {
    const t = await plannerFirm();
    const keyId = await keyOf(t.f.firmId);
    const other = await plannerFirm();
    const theirKey = await keyOf(other.f.firmId);
    expect(await moveShiftByFirm(withFirm, t.f.firmId, apiMove(t, theirKey), at(NOW))).toEqual({
      status: "not_allowed",
    });
    expect(await moveShiftByFirm(withFirm, t.f.firmId, apiMove(other, keyId), at(NOW))).toEqual({
      status: "not_found",
    });
    for (const source of ["native", "sheets", "csv"] as const) {
      const shiftId = await t.f.shift({ source });
      expect(
        await moveShiftByFirm(withFirm, t.f.firmId, { ...apiMove(t, keyId), shiftId }, at(NOW)),
      ).toEqual({ status: "not_found" });
      expect(
        await cancelShiftByFirm(
          withFirm,
          t.f.firmId,
          { shiftId, reason: "weather", by: { type: "api", keyId } },
          at(NOW),
        ),
      ).toEqual({ status: "not_found" });
    }
  });
});

describe("the office and a session from the planner", () => {
  it("its move, cancel, edit, details, mark as filled and open again are refused as the planner's, and nothing changes", async () => {
    const t = await plannerFirm();
    const ctx = officeCtx(t.f.firmId, t.resourcer);
    const before = await snapshot(t.shiftId);
    expect(
      await moveShift(ctx, t.shiftId, {
        date: "2026-11-07",
        start: "10:00",
        end: "18:00",
        siteId: t.arena,
        reason: "event_changed",
      }),
    ).toEqual({ status: "planner" });
    expect(await cancelShift(ctx, t.shiftId, "weather")).toEqual({ status: "planner" });
    expect(
      await editShift(ctx, t.shiftId, {
        date: "2026-11-07",
        start: "08:00",
        end: "16:00",
        role: "door supervisor",
        siteId: t.arena,
        headcount: "3",
        instructions: "",
      }),
    ).toEqual({ status: "planner" });
    expect(
      await editShiftDetails(ctx, t.shiftId, {
        payRate: "15.50",
        post: "Gate A",
        meetingPoint: "",
        uniform: "",
        requirements: [],
      }),
    ).toEqual({ status: "planner" });
    expect(await markFilled(ctx, t.shiftId)).toEqual({ status: "planner" });
    expect(await openAgain(ctx, t.shiftId)).toEqual({ status: "planner" });
    expect(await snapshot(t.shiftId)).toEqual(before);
    expect(await noticeJobs(t.f.firmId)).toEqual([]);
  });

  it("one booking cancelled because the client needs fewer staff keeps its place (the planner sets the places); other reasons cancel it", async () => {
    const t = await plannerFirm();
    const ctx = officeCtx(t.f.firmId, t.resourcer);
    const before = await snapshot(t.shiftId);
    expect(await cancelBookingByOffice(ctx, t.shiftId, t.ann, "fewer_staff")).toEqual({
      status: "keeps_place",
      why: "planner",
    });
    expect(await snapshot(t.shiftId)).toEqual(before);
    expect(await noticeJobs(t.f.firmId)).toEqual([]);
    // The office can still cancel one booking (the planner hears of it by webhook, 12J.2).
    expect(await cancelBookingByOffice(ctx, t.shiftId, t.ann, "weather")).toMatchObject({
      status: "cancelled",
    });
    const { rows } = await su.query("select status, cancel_via from assignments where id = $1", [
      t.annBooking,
    ]);
    expect(rows).toEqual([{ status: "cancelled_firm", cancel_via: "office" }]);
    const headcount = await su.query("select headcount from shifts where id = $1", [t.shiftId]);
    expect(headcount.rows).toEqual([{ headcount: 2 }]);
    // … and assign someone to the place that reopened.
    const cal = await t.f.worker({ first: "Cal" });
    expect(await assignWorker(ctx, t.shiftId, cal, null)).toMatchObject({ status: "booked" });
  });

  it("the office's pages: 'from your planner', no whole-session edit, details, move or cancel, but Assign and one booking's cancel stay", async () => {
    const t = await plannerFirm();
    const token = (
      await withFirm(t.f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: t.resourcer, now: NOW }),
      )
    ).token;
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock: { now: () => NOW } };
    const page = await officeShiftDetail(ctx, token, t.shiftId);
    expect(page?.shift).toMatchObject({ fromPlanner: true, fromSheet: false });
    expect(page?.edit.editable).toBe(false);
    expect(page?.details.editable).toBe(false);
    expect(page?.canPlace).toBe(true);
    const list = await officeShiftList(ctx, token, NOW);
    expect(list?.shifts.find((s) => s.shiftId === t.shiftId)).toMatchObject({
      fromPlanner: true,
      fromSheet: false,
    });
    const { events } = await withFirm(t.f.firmId, (tx) => loadEventCards(tx, NOW, "all"));
    expect(events.flatMap((e) => e.sessions).find((s) => s.shiftId === t.shiftId)).toMatchObject({
      fromPlanner: true,
      fromSheet: false,
    });
    // The office's own session keeps every control.
    const own = await t.f.shift({ startsAt: hoursFromNow(48) });
    const ownPage = await officeShiftDetail(ctx, token, own);
    expect(ownPage?.shift).toMatchObject({ fromPlanner: false });
    expect([ownPage?.edit.editable, ownPage?.details.editable, ownPage?.canPlace]).toEqual([
      true,
      true,
      true,
    ]);
  });
});
