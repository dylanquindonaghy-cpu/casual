import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, findSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { waveCandidates } from "@/lib/offers/candidates";
import { eraseWorker } from "@/lib/gdpr/worker-erase";
import {
  assignWorker,
  cancelBookingByOffice,
  cancelShift,
  moveShift,
} from "@/lib/office/quick-actions";
import { loadBookingsToCheck } from "@/lib/office/today";
import {
  blockFromSite,
  changeWorkerStatus,
  keepFlaggedBooking,
  signOutWorker,
  unblockFromSite,
  workerAccessView,
} from "@/lib/office/worker-access";
import type { PushTransport } from "@/lib/push/transport";
import { runShiftReminders } from "@/lib/reminders/send";
import { previewBooking } from "@/lib/roster/book";
import { upsertWorker, WorkerEmailInvalid } from "@/lib/roster/workers";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Worker leavers and blocks (audit M22, M23, L24, L81): the office's controls on a worker's page
// (src/lib/office/worker-access.ts), what follows from a status change by any path (reminders
// stop, bookings flagged on the dashboard to cancel or keep), the office's decision sticking against a
// rota sheet or file, rules check 9 (a blocked site) made live, and a mobile change ending links
// and forgetting phones. Real database, app role, fixed clock, nothing sent anywhere.

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

const clock = { now: () => NOW };
const noPush: PushTransport = {
  name: "none",
  async send() {
    return { status: "skipped" };
  },
};

async function firm() {
  const f = await bookingFirm(su, withFirm, {});
  const officeUserId = await f.office("resourcer");
  const ctx = { firm: { id: f.firmId }, officeUserId, run: withFirm, clock };
  return { f, ctx };
}

const mobileOf = async (workerId: string) =>
  (await su.query<{ m: string }>("select mobile_e164 as m from workers where id = $1", [workerId]))
    .rows[0]?.m ?? "";

const statusOf = async (workerId: string) =>
  (
    await su.query<{ status: string; by_office: boolean }>(
      "select status, office_deactivated_at is not null as by_office from workers where id = $1",
      [workerId],
    )
  ).rows[0];

// A worker's way in: a session (its token), an unused login link and a phone's notifications.
async function waysIn(firmId: string, workerId: string) {
  const token = (
    await withFirm(firmId, (tx) =>
      createSession(tx, { kind: "worker", subjectId: workerId, now: NOW }),
    )
  ).token;
  await su.query(
    `insert into magic_links (firm_id, kind, worker_id, token_hash, request_id, expires_at)
     values ($1, 'worker', $2, $3, $4, $5)`,
    [firmId, workerId, randomBytes(32), randomUUID(), new Date(NOW.getTime() + 900_000)],
  );
  await su.query(
    `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
     values ($1, $2, $3, 'k', 'a')`,
    [firmId, workerId, `https://push.example.test/${randomUUID()}`],
  );
  return token;
}

async function waysLeft(workerId: string) {
  const { rows } = await su.query<{ sessions: number; links: number; phones: number }>(
    `select (select count(*)::int from sessions where worker_id = $1 and revoked_at is null) as sessions,
            (select count(*)::int from magic_links where worker_id = $1 and used_at is null) as links,
            (select count(*)::int from push_subscriptions where worker_id = $1) as phones`,
    [workerId],
  );
  return rows[0];
}

const events = async (firmId: string, action: string) =>
  (
    await su.query<{ actor_type: string; data: Record<string, unknown> }>(
      "select actor_type, data from events where firm_id = $1 and action = $2 order by id",
      [firmId, action],
    )
  ).rows;

const toCheck = (firmId: string) =>
  withFirm(firmId, async (tx) => (await loadBookingsToCheck(tx, NOW)).items);

// The 24-hour reminders due now: who they went to.
async function reminded(firmId: string): Promise<string[]> {
  const { transport, sent } = captureTransport();
  await runShiftReminders(
    { firmId, idempotencyKey: `shift-reminders:${Math.floor(NOW.getTime() / 300_000)}` },
    withFirm,
    { transport, push: noPush, baseDomain: "localhost:3000", clock },
  );
  return sent.map((m) => ("to" in m ? m.to : ""));
}

const source = { source: "sheets" as const, actor: { type: "system" as const }, now: NOW };
// The worker's row as a rota sheet or file sends it, matched by their staff id (as a sheet does:
// a new mobile is the same person).
const fromSheet = async (
  firmId: string,
  workerId: string,
  change: {
    status?: "active" | "inactive" | "blocked";
    mobileE164?: string;
    email?: string | null;
  },
) => {
  const mobile = await mobileOf(workerId);
  const ref = `S-${workerId.slice(0, 8)}`;
  const { rows } = await su.query<{ first_name: string; last_name: string }>(
    "update workers set external_ref = $2 where id = $1 returning first_name, last_name",
    [workerId, ref],
  );
  return withFirm(firmId, (tx) =>
    upsertWorker(
      tx,
      {
        ref,
        firstName: rows[0]?.first_name ?? "",
        lastName: rows[0]?.last_name ?? "",
        mobileE164: change.mobileE164 ?? mobile,
        ...(change.status ? { status: change.status } : {}),
        ...(change.email !== undefined ? { email: change.email } : {}),
      },
      change.mobileE164 || change.email !== undefined ? { ...source, source: "csv" } : source,
    ),
  );
};

// A site of the firm's own, and a shift there `h` hours from NOW.
async function siteOf(firmId: string) {
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, $2) returning id::text",
    [firmId, `Site ${randomUUID().slice(0, 6)}`],
  );
  return rows[0]?.id ?? "";
}
async function shiftAt(f: Awaited<ReturnType<typeof firm>>["f"], siteId: string, h: number) {
  const id = await f.shift({ startsAt: hoursFromNow(h) });
  await su.query("update shifts set site_id = $2 where id = $1", [id, siteId]);
  return id;
}

describe("making a worker inactive (they've left)", () => {
  it("logged out everywhere, no reminders, their bookings ahead flagged on the dashboard; logged with the reason", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const bob = await f.worker({ first: "Bob" });
    const token = await waysIn(f.firmId, ann);
    // Both booked on a shift tomorrow (its 24-hour reminder is due), Ann on one before too.
    const tomorrow = await f.shift({ startsAt: hoursFromNow(23), headcount: 2 });
    await f.booking(ann, tomorrow, "confirmed", 1);
    await f.booking(bob, tomorrow, "confirmed", 2);
    await f.booking(ann, await f.shift({ startsAt: hoursFromNow(-30) }), "completed");

    expect(await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "left" })).toEqual({
      status: "done",
      change: "deactivate",
      name: "Ann Booker",
      futureBookings: 1,
      now: "inactive",
    });
    expect(await statusOf(ann)).toEqual({ status: "inactive", by_office: true });
    expect(await waysLeft(ann)).toEqual({ sessions: 0, links: 0, phones: 0 });
    expect(
      await withFirm(f.firmId, (tx) => findSession(tx, { kind: "worker", token, now: NOW })),
    ).toBeNull();
    // No reminder for Ann; Bob still gets his.
    expect(await reminded(f.firmId)).toEqual([await mobileOf(bob)]);
    // On the dashboard, to cancel or keep.
    expect(await toCheck(f.firmId)).toEqual([
      expect.objectContaining({ shiftId: tomorrow, workerId: ann, cause: "inactive" }),
    ]);
    expect(await events(f.firmId, "worker.deactivated")).toEqual([
      {
        actor_type: "office",
        data: {
          workerId: ann,
          reason: "left",
          sessionsEnded: 1,
          linksSpent: 1,
          futureBookings: 1,
          devicesForgotten: 1,
        },
      },
    ]);
  });

  it("a rota sheet or file can't make them active again; only the office can", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "paused" });
    // A sheet row with a blank status reads as active; a file saying active.
    await fromSheet(f.firmId, ann, { status: "active" });
    await fromSheet(f.firmId, ann, {});
    expect(await statusOf(ann)).toEqual({ status: "inactive", by_office: true });

    expect(await changeWorkerStatus(ctx, ann, { kind: "reactivate", reason: "back" })).toEqual({
      status: "done",
      change: "reactivate",
      name: "Ann Booker",
      futureBookings: 0,
      now: "active",
    });
    expect(await statusOf(ann)).toEqual({ status: "active", by_office: false });
    // The sheet governs again: it can make them inactive (and then active).
    await fromSheet(f.firmId, ann, { status: "inactive" });
    expect(await statusOf(ann)).toEqual({ status: "inactive", by_office: false });
    await fromSheet(f.firmId, ann, { status: "active" });
    expect(await statusOf(ann)).toEqual({ status: "active", by_office: false });
    expect((await events(f.firmId, "worker.reactivated")).map((e) => e.data)).toEqual([
      { workerId: ann, reason: "back", sessionsEnded: 0, linksSpent: 0 },
    ]);
  });

  it("a sheet can still block a worker the office made inactive; unblocking leaves them inactive", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "other" });
    await fromSheet(f.firmId, ann, { status: "blocked" });
    expect((await statusOf(ann))?.status).toBe("blocked");
    // The office's own decision stands: unblocking doesn't make them active.
    expect(
      await changeWorkerStatus(ctx, ann, { kind: "unblock", reason: "mistake" }),
    ).toMatchObject({ status: "done", change: "unblock", now: "inactive" });
    expect(await statusOf(ann)).toEqual({ status: "inactive", by_office: true });
    expect((await events(f.firmId, "worker.unblocked"))[0]?.data).toMatchObject({
      stillInactive: true,
    });
  });
});

describe("unblocking, and changes that don't apply", () => {
  it("the office unblocks a worker a sheet blocked; a sheet still saying blocked blocks them again", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await fromSheet(f.firmId, ann, { status: "blocked" });
    expect(
      await changeWorkerStatus(ctx, ann, { kind: "unblock", reason: "mistake" }),
    ).toMatchObject({
      status: "done",
      change: "unblock",
    });
    expect(await statusOf(ann)).toEqual({ status: "active", by_office: false });
    await fromSheet(f.firmId, ann, { status: "blocked" });
    expect((await statusOf(ann))?.status).toBe("blocked");
  });

  it("each change only from its own status, saying what the status is, and logging nothing", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const blocked = await f.worker({ first: "Bea", status: "blocked" });
    expect(await changeWorkerStatus(ctx, ann, { kind: "reactivate", reason: "back" })).toEqual({
      status: "unchanged",
      change: "reactivate",
      name: "Ann Booker",
      current: "active",
    });
    expect(await changeWorkerStatus(ctx, ann, { kind: "unblock", reason: "sorted" })).toMatchObject(
      {
        status: "unchanged",
        current: "active",
      },
    );
    expect(
      await changeWorkerStatus(ctx, blocked, { kind: "deactivate", reason: "left" }),
    ).toMatchObject({ status: "unchanged", current: "blocked" });
    expect(
      await changeWorkerStatus(ctx, blocked, { kind: "reactivate", reason: "back" }),
    ).toMatchObject({ status: "unchanged", current: "blocked" });
    await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "left" });
    expect(
      await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "left" }),
    ).toMatchObject({ status: "unchanged", current: "inactive" });
    const { rows } = await su.query(
      "select action from events where firm_id = $1 and action like 'worker.%' and action <> 'worker.added'",
      [f.firmId],
    );
    expect(rows.map((r) => r.action)).toEqual(["worker.deactivated"]);
  });
});

describe("made inactive or blocked by any path: reminders stop, bookings flagged", () => {
  it("by the rota sheet: no reminder, and the booking on the dashboard", async () => {
    const { f } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const tomorrow = await f.shift({ startsAt: hoursFromNow(23) });
    await f.booking(ann, tomorrow);
    await fromSheet(f.firmId, ann, { status: "blocked" });
    expect(await reminded(f.firmId)).toEqual([]);
    expect(await toCheck(f.firmId)).toEqual([
      expect.objectContaining({ shiftId: tomorrow, workerId: ann, cause: "blocked" }),
    ]);
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'worker.updated'",
      [f.firmId],
    );
    expect(rows[0]?.data).toMatchObject({ fields: ["status"], futureBookings: 1 });
  });

  it("a worker made inactive between the list and the send gets no reminder", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await f.booking(ann, await f.shift({ startsAt: hoursFromNow(23) }));
    // The job reads the due list, then (before claiming) Ann is made inactive.
    let calls = 0;
    const between: WithFirm = async (firmId, fn) => {
      calls += 1;
      if (calls === 2) await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "left" });
      return withFirm(firmId, fn);
    };
    const { transport, sent } = captureTransport();
    await runShiftReminders(
      {
        firmId: f.firmId,
        idempotencyKey: `shift-reminders:${Math.floor(NOW.getTime() / 300_000)}`,
      },
      between,
      { transport, push: noPush, baseDomain: "localhost:3000", clock },
    );
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(sent).toEqual([]);
  });
});

describe("the dashboard's bookings to check: cancel or keep", () => {
  it("kept: off the list until the worker's status changes again", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const later = await f.shift({ startsAt: hoursFromNow(50) });
    await f.booking(ann, later);
    expect(await keepFlaggedBooking(ctx, later, ann)).toEqual({
      status: "not_flagged",
      name: "Ann Booker",
    });
    await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "paused" });
    expect(await keepFlaggedBooking(ctx, later, ann)).toEqual({
      status: "kept",
      name: "Ann Booker",
      cause: "inactive",
    });
    expect(await toCheck(f.firmId)).toEqual([]);
    expect(await keepFlaggedBooking(ctx, later, ann)).toEqual({
      status: "already",
      name: "Ann Booker",
    });
    expect((await events(f.firmId, "booking.kept")).map((e) => e.data)).toEqual([
      { shiftId: later, workerId: ann, cause: "inactive" },
    ]);
    // Active again, then inactive again: flagged again.
    await changeWorkerStatus(ctx, ann, { kind: "reactivate", reason: "back" });
    await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "left" });
    expect(await toCheck(f.firmId)).toEqual([
      expect.objectContaining({ shiftId: later, workerId: ann }),
    ]);
  });

  it("kept, then blocked by the rota sheet: flagged again", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const later = await f.shift({ startsAt: hoursFromNow(50) });
    await f.booking(ann, later);
    await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "paused" });
    await keepFlaggedBooking(ctx, later, ann);
    expect(await toCheck(f.firmId)).toEqual([]);
    await fromSheet(f.firmId, ann, { status: "blocked" });
    expect(await toCheck(f.firmId)).toEqual([
      expect.objectContaining({ shiftId: later, workerId: ann, cause: "blocked" }),
    ]);
  });

  it("cancelled by the office: the firm's cancellation, with its reason and notice hours", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const later = await f.shift({ startsAt: hoursFromNow(50) });
    await f.booking(ann, later);
    await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "left" });
    expect(await cancelBookingByOffice(ctx, later, ann, "not_available")).toMatchObject({
      status: "cancelled",
    });
    const { rows } = await su.query<{ status: string; reason: string; notice: string }>(
      `select status, cancel_reason as reason, notice_hours::text as notice from assignments
        where shift_id = $1 and worker_id = $2`,
      [later, ann],
    );
    expect(rows[0]).toEqual({
      status: "cancelled_firm",
      reason: "They've left, or can't work here",
      notice: "50.00",
    });
    expect(await toCheck(f.firmId)).toEqual([]);
  });
});

describe("kept bookings are looked at again when something changes", () => {
  it("kept while inactive at a blocked site: made active again, it's back on the dashboard for the block", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const site = await siteOf(f.firmId);
    const there = await shiftAt(f, site, 50);
    await f.booking(ann, there);
    await blockFromSite(ctx, ann, site, "incident");
    await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "paused" });
    expect(await toCheck(f.firmId)).toEqual([expect.objectContaining({ cause: "inactive" })]);
    await keepFlaggedBooking(ctx, there, ann);
    expect(await toCheck(f.firmId)).toEqual([]);
    await changeWorkerStatus(ctx, ann, { kind: "reactivate", reason: "back" });
    expect(await toCheck(f.firmId)).toEqual([
      expect.objectContaining({ shiftId: there, cause: "site_blocked" }),
    ]);
  });

  it("kept, unblocked, then blocked from the site again: flagged again", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const site = await siteOf(f.firmId);
    const there = await shiftAt(f, site, 50);
    await f.booking(ann, there);
    await blockFromSite(ctx, ann, site, "client_asked");
    expect(await keepFlaggedBooking(ctx, there, ann)).toMatchObject({
      status: "kept",
      cause: "site_blocked",
    });
    expect((await events(f.firmId, "booking.kept"))[0]?.data).toEqual({
      shiftId: there,
      workerId: ann,
      cause: "site_blocked",
    });
    await unblockFromSite(ctx, ann, site, "mistake");
    await blockFromSite(ctx, ann, site, "incident");
    expect(await toCheck(f.firmId)).toEqual([expect.objectContaining({ shiftId: there })]);
  });

  it("a kept inactive worker's booking doesn't stop a change of time; a change of site asks again", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const later = await f.shift({ startsAt: hoursFromNow(50) }); // Wed 4 Nov 11:00
    await f.booking(ann, later);
    await changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "paused" });
    // Not kept: the office must decide first.
    const move = (start: string, siteId = "") =>
      moveShift(ctx, later, {
        date: "2026-11-04",
        start,
        end: "20:00",
        siteId,
        reason: "event_changed",
      });
    expect(await move("12:00")).toMatchObject({ status: "blocked" });
    await keepFlaggedBooking(ctx, later, ann);
    expect(await move("12:00")).toMatchObject({ status: "moved" });
    const site = await siteOf(f.firmId);
    expect(await move("12:00", site)).toMatchObject({ status: "blocked" });
  });
});

describe("rules check 9 wherever someone is booked", () => {
  it("the office can't place a worker at a site they're blocked from, even with overrides", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const site = await siteOf(f.firmId);
    const there = await shiftAt(f, site, 50);
    await blockFromSite(ctx, ann, site, "client_asked");
    expect(await assignWorker(ctx, there, ann, null)).toMatchObject({
      status: "not_eligible",
      codes: ["blocked_site"],
    });
    await expect(
      assignWorker(ctx, there, ann, { codes: ["unavailable"], reason: "The client said yes" }),
    ).resolves.toMatchObject({ status: "not_eligible", codes: ["blocked_site"] });
  });

  it("no reminder for a booking at a site they're blocked from, until the office keeps it", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const site = await siteOf(f.firmId);
    const tomorrow = await shiftAt(f, site, 23);
    await f.booking(ann, tomorrow);
    await blockFromSite(ctx, ann, site, "client_asked");
    expect(await reminded(f.firmId)).toEqual([]);
    await keepFlaggedBooking(ctx, tomorrow, ann);
    expect(await reminded(f.firmId)).toEqual([await mobileOf(ann)]);
  });

  it("a whole shift can't be cancelled with the one-booking reason", async () => {
    const { f, ctx } = await firm();
    const later = await f.shift({ startsAt: hoursFromNow(50) });
    await cancelShift(ctx, later, "not_available").catch(() => null);
    const { rows } = await su.query<{ status: string }>("select status from shifts where id = $1", [
      later,
    ]);
    expect(rows[0]?.status).toBe("open");
  });
});

describe("the rota sheet and the office at the same moment", () => {
  it("the office's 'make inactive' isn't written over by a sync of the same worker", async () => {
    const { f } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await fromSheet(f.firmId, ann, {}); // gives Ann a staff id
    // The office's change, holding Ann's row (as changeWorkerStatus does) ...
    const office = await su.connect();
    try {
      await office.query("begin");
      await office.query(
        "update workers set status = 'inactive', office_deactivated_at = $2 where id = $1",
        [ann, NOW],
      );
      // ... while the sync sends Ann's row with a new role and (blank) status "active".
      const syncing = (async () => {
        const mobile = await mobileOf(ann);
        return withFirm(f.firmId, (tx) =>
          upsertWorker(
            tx,
            {
              ref: `S-${ann.slice(0, 8)}`,
              firstName: "Ann",
              lastName: "Booker",
              mobileE164: mobile,
              roles: ["steward"],
              status: "active",
            },
            source,
          ),
        );
      })();
      for (let i = 0; ; i += 1) {
        const { rows } = await su.query(
          `select 1 from pg_stat_activity
            where wait_event_type = 'Lock' and query like '%workers%' and pid <> pg_backend_pid()`,
        );
        if (rows.length > 0) break;
        if (i > 100) throw new Error("the sync never reached Ann's row");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await office.query("commit");
      await syncing;
    } finally {
      await office.query("rollback").catch(() => undefined);
      office.release();
    }
    // The sync waited, then saw the office's change: Ann stays inactive.
    expect(await statusOf(ann)).toEqual({ status: "inactive", by_office: true });
  });
});

describe("blocked from a site (rules check 9)", () => {
  it("can't book or be offered shifts there, can elsewhere; bookings there flagged; unblocking lifts it", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    const bob = await f.worker({ first: "Bob" });
    const { rows: s } = await su.query<{ id: string }>(
      "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text",
      [f.firmId],
    );
    const site = s[0]?.id ?? "";
    const atSite = async (h: number) => {
      const id = await f.shift({ startsAt: hoursFromNow(h) });
      await su.query("update shifts set site_id = $2 where id = $1", [id, site]);
      return id;
    };
    const booked = await atSite(40);
    await f.booking(ann, booked);
    const open = await atSite(60);
    const elsewhere = await f.shift({ startsAt: hoursFromNow(80) });

    expect(await blockFromSite(ctx, ann, site, "client_asked")).toEqual({
      status: "done",
      name: "Ann Booker",
      site: "Riverside Arena",
      futureBookings: 1,
    });
    const preview = (shiftId: string) =>
      withFirm(f.firmId, (tx) => previewBooking(tx, { shiftId, workerId: ann, now: NOW }));
    expect((await preview(open))?.codes).toEqual(["blocked_site"]);
    expect((await preview(elsewhere))?.ok).toBe(true);
    const candidates = await withFirm(f.firmId, (tx) => waveCandidates(tx, open, NOW));
    expect(candidates.map((c) => c.workerId)).toEqual([bob]);
    expect(await toCheck(f.firmId)).toEqual([
      expect.objectContaining({ shiftId: booked, workerId: ann, cause: "site_blocked" }),
    ]);
    expect(await blockFromSite(ctx, ann, site, "incident")).toMatchObject({ status: "unchanged" });

    expect(await unblockFromSite(ctx, ann, site, "client_ok")).toMatchObject({
      status: "done",
      site: "Riverside Arena",
    });
    expect((await preview(open))?.ok).toBe(true);
    expect(await toCheck(f.firmId)).toEqual([]);
    expect(await unblockFromSite(ctx, ann, site, "client_ok")).toMatchObject({
      status: "unchanged",
    });
    expect(await blockFromSite(ctx, ann, randomUUID(), "other")).toEqual({ status: "no_site" });
    expect([
      ...(await events(f.firmId, "worker.site_blocked")),
      ...(await events(f.firmId, "worker.site_unblocked")),
    ]).toEqual([
      {
        actor_type: "office",
        data: { workerId: ann, siteId: site, reason: "client_asked", futureBookings: 1 },
      },
      { actor_type: "office", data: { workerId: ann, siteId: site, reason: "client_ok" } },
    ]);
    // The page shows it while it lasts.
    await blockFromSite(ctx, ann, site, "incident");
    expect(await workerAccessView(ctx, ann)).toMatchObject({
      status: "active",
      siteBlocks: [{ siteId: site, site: "Riverside Arena", reason: "incident" }],
      otherSites: [],
      ahead: [expect.objectContaining({ shiftId: booked })],
    });
  });
});

describe("a login finishing at the moment the office makes the worker inactive", () => {
  it("no deadlock, and the session that login makes is ended too", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await waysIn(f.firmId, ann);
    const { rows: links } = await su.query<{ id: string }>(
      "select id::text from magic_links where worker_id = $1 and used_at is null",
      [ann],
    );
    // The login, as loginWithLinkOf runs it: the link spent (its row locked) ...
    const login = await su.connect();
    let changing: ReturnType<typeof changeWorkerStatus> | null = null;
    try {
      await login.query("begin");
      await login.query("update magic_links set used_at = $2 where id = $1", [links[0]?.id, NOW]);
      // ... while the office makes them inactive: that reaches the same link and waits.
      changing = changeWorkerStatus(ctx, ann, { kind: "deactivate", reason: "left" });
      for (let i = 0; ; i += 1) {
        const { rows } = await su.query(
          `select 1 from pg_stat_activity
            where wait_event_type = 'Lock' and query like '%magic_links%' and pid <> pg_backend_pid()`,
        );
        if (rows.length > 0) break;
        if (i > 100) throw new Error("the change never reached the link");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // ... then the login makes its session (its key check on the worker mustn't wait).
      await login.query(
        `insert into sessions (firm_id, kind, worker_id, token_hash, expires_at, rotated_at)
         values ($1, 'worker', $2, $3, $4, $5)`,
        [f.firmId, ann, randomBytes(32), new Date(NOW.getTime() + 86_400_000), NOW],
      );
      await login.query("commit");
    } finally {
      await login.query("rollback").catch(() => undefined);
      login.release();
    }
    expect(await changing).toMatchObject({ status: "done" });
    expect((await waysLeft(ann))?.sessions).toBe(0);
  });
});

describe("log out on every device (a lost phone)", () => {
  it("sessions, unused links and phone notifications ended; nothing left: says so", async () => {
    const { f, ctx } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await waysIn(f.firmId, ann);
    expect(await signOutWorker(ctx, ann)).toEqual({
      status: "done",
      name: "Ann Booker",
      sessionsEnded: 1,
      loggedIn: true,
    });
    expect(await waysLeft(ann)).toEqual({ sessions: 0, links: 0, phones: 0 });
    expect((await statusOf(ann))?.status).toBe("active");
    expect(await signOutWorker(ctx, ann)).toMatchObject({ status: "unchanged" });
    expect((await events(f.firmId, "worker.signed_out")).map((e) => e.data)).toEqual([
      { workerId: ann, sessionsEnded: 1, linksSpent: 1, devicesForgotten: 1 },
    ]);
  });
});

describe("a mobile change from the sheet or a file (audit L81)", () => {
  it("ends their sessions and unused links, and forgets their phones", async () => {
    const { f } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await waysIn(f.firmId, ann);
    await fromSheet(f.firmId, ann, { mobileE164: "+447700900991" });
    expect(await waysLeft(ann)).toEqual({ sessions: 0, links: 0, phones: 0 });
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'worker.updated'",
      [f.firmId],
    );
    expect(rows[0]?.data).toEqual({
      source: "csv",
      fields: ["mobileE164"],
      sessionsRevoked: 1,
      linksSpent: 1,
      devicesForgotten: 1,
    });
  });
});

describe("an email from a file (P2.6: login links and pay codes can go to it)", () => {
  const emailOf = async (workerId: string) =>
    (
      await su.query<{ email: string | null }>("select email from workers where id = $1", [
        workerId,
      ])
    ).rows[0]?.email;

  it("kept lowercased; a first address signs nobody out (nothing could have gone to it before)", async () => {
    const { f } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await waysIn(f.firmId, ann);
    await fromSheet(f.firmId, ann, { email: "  Ann.Booker@Example.TEST " });
    expect(await emailOf(ann)).toBe("ann.booker@example.test");
    expect(await waysLeft(ann)).toEqual({ sessions: 1, links: 1, phones: 1 });
    expect((await events(f.firmId, "worker.updated")).map((e) => e.data)).toEqual([
      { source: "csv", fields: ["email"] },
    ]);
  });

  it("a changed or removed address ends their sessions and unused links, and forgets their phones", async () => {
    const { f } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await fromSheet(f.firmId, ann, { email: "ann.booker@example.test" });
    await waysIn(f.firmId, ann);
    await fromSheet(f.firmId, ann, { email: "ann.new@example.test" });
    expect(await waysLeft(ann)).toEqual({ sessions: 0, links: 0, phones: 0 });
    expect((await events(f.firmId, "worker.updated")).at(-1)?.data).toEqual({
      source: "csv",
      fields: ["email"],
      sessionsRevoked: 1,
      linksSpent: 1,
      devicesForgotten: 1,
    });
    await waysIn(f.firmId, ann);
    await fromSheet(f.firmId, ann, { email: null });
    expect(await emailOf(ann)).toBeNull();
    expect((await waysLeft(ann))?.sessions).toBe(0);
    // The same address in other capitals is no change.
    await fromSheet(f.firmId, ann, { email: "ann.new@example.test" });
    await waysIn(f.firmId, ann);
    expect(await fromSheet(f.firmId, ann, { email: "ANN.NEW@example.test" })).toMatchObject({
      outcome: "unchanged",
    });
    expect((await waysLeft(ann))?.sessions).toBe(1);
  });

  it("one that isn't an address is refused, and nothing changes", async () => {
    const { f } = await firm();
    const ann = await f.worker({ first: "Ann" });
    await expect(fromSheet(f.firmId, ann, { email: "not an address" })).rejects.toThrow(
      WorkerEmailInvalid,
    );
    expect(await emailOf(ann)).toBeNull();
    expect(await events(f.firmId, "worker.updated")).toEqual([]);
  });
});

describe("who may change a worker's access", () => {
  it("an active admin or resourcer of this firm; not payroll; another firm's worker isn't found; an erased one can't change", async () => {
    const { f, ctx } = await firm();
    const other = await firm();
    const ann = await f.worker({ first: "Ann" });
    const admin = { ...ctx, officeUserId: await f.office("admin") };
    const payroll = { ...ctx, officeUserId: await f.office("payroll") };
    const disabled = { ...ctx, officeUserId: await f.office("resourcer", "disabled") };
    expect(await changeWorkerStatus(payroll, ann, { kind: "deactivate", reason: "left" })).toEqual({
      status: "not_allowed",
    });
    expect(await signOutWorker(disabled, ann)).toEqual({ status: "not_allowed" });
    expect(await workerAccessView(payroll, ann)).toBeNull();
    // Another firm's resourcer with this firm's worker: not found, and nothing changed.
    expect(
      await changeWorkerStatus(other.ctx, ann, { kind: "deactivate", reason: "left" }),
    ).toEqual({ status: "not_found" });
    expect(await workerAccessView(other.ctx, ann)).toBeNull();
    expect((await statusOf(ann))?.status).toBe("active");
    expect(
      await changeWorkerStatus(admin, ann, { kind: "deactivate", reason: "left" }),
    ).toMatchObject({ status: "done" });
    // An erased worker (the real GDPR deletion, by an admin).
    const gone = await f.worker({ first: "Gus" });
    expect(await eraseWorker(admin, gone)).toMatchObject({ status: "erased" });
    expect(await changeWorkerStatus(ctx, gone, { kind: "reactivate", reason: "back" })).toEqual({
      status: "erased",
    });
    // Every other change, from another firm: not found, with the other firm's own site too.
    const { rows: s1 } = await su.query<{ id: string }>(
      "insert into sites (firm_id, name) values ($1, 'Here Hall') returning id::text",
      [f.firmId],
    );
    const { rows: s2 } = await su.query<{ id: string }>(
      "insert into sites (firm_id, name) values ($1, 'There Hall') returning id::text",
      [other.f.firmId],
    );
    const here = s1[0]?.id ?? "";
    const there = s2[0]?.id ?? "";
    expect(await blockFromSite(other.ctx, ann, here, "other")).toEqual({ status: "not_found" });
    expect(await unblockFromSite(other.ctx, ann, here, "other")).toEqual({ status: "not_found" });
    expect(await signOutWorker(other.ctx, ann)).toEqual({ status: "not_found" });
    expect(await blockFromSite(ctx, ann, there, "other")).toEqual({ status: "no_site" });
    expect(await blockFromSite(ctx, gone, here, "other")).toEqual({ status: "erased" });
    const later = await f.shift({ startsAt: hoursFromNow(50) });
    await f.booking(ann, later);
    expect(await keepFlaggedBooking(other.ctx, later, ann)).toEqual({ status: "not_found" });
    expect(await keepFlaggedBooking(payroll, later, ann)).toEqual({ status: "not_allowed" });
    // A made-up page address: not found.
    expect(await workerAccessView(ctx, "not-a-worker")).toBeNull();
  });
});
