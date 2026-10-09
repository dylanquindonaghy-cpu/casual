import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAY, HOUR } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { purgeExpired } from "@/lib/gdpr/retention";
import { collectWorkerData } from "@/lib/gdpr/worker-export";
import {
  assignWorker,
  cancelBookingByOffice,
  cancelShift,
  moveShift,
} from "@/lib/office/quick-actions";
import { editShiftDetails } from "@/lib/office/shift-editor";
import { cancelMyShift } from "@/lib/portal/cancel-shift";
import { cancelWarning } from "@/lib/portal/cancel-warning";
import { takeShift } from "@/lib/portal/take-shift";
import { tellWhatHappened } from "@/lib/portal/what-happened";
import { cancelBooking } from "@/lib/roster/cancel";
import { STRIKE_WARNING_VERSION, type WarningKind } from "@/lib/strikes/words";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Strikes on cancel (12C.1; docs/office-v2.md 3.5, 4.5) on the real database as the app role,
// through the real paths: a casual takes a shift in the app and cancels it; the office assigns,
// moves, changes or cancels. NOW is Monday 2 November 2026, 09:00 London (GMT).

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

const at = (d: Date) => ({ now: () => d });
const later = (h: number) => new Date(NOW.getTime() + h * HOUR);
const saw = (kind: WarningKind) => ({ kind, version: STRIKE_WARNING_VERSION });

async function strikeFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const resourcer = await f.office("resourcer");
  const portal = (now = NOW) => ({
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Booking Test Shift Team" },
    run: withFirm,
    clock: at(now),
  });
  const office = (now = NOW) => ({
    firm: { id: f.firmId },
    officeUserId: resourcer,
    run: withFirm,
    clock: at(now),
  });
  // The casual takes it in the app (logged shift.assigned by the worker).
  const take = async (worker: string, shiftId: string, now = NOW) =>
    expect(await takeShift(portal(now), worker, shiftId)).toMatchObject({ status: "booked" });
  const cancel = (
    worker: string,
    shiftId: string,
    now: Date,
    kind: WarningKind,
    reason = "Travel problem",
  ) => cancelMyShift(portal(now), worker, shiftId, reason, saw(kind));
  const strikeRows = async () =>
    (
      await su.query(
        `select worker_id::text as "workerId", assignment_id::text as "assignmentId",
                shift_id::text as "shiftId", notice_hours::float as "noticeHours",
                threshold_hours as "thresholdHours", issued_at as "issuedAt",
                expires_at as "expiresAt", status, review_needed as "reviewNeeded",
                review_reasons as "reviewReasons"
           from strikes where firm_id = $1 order by issued_at, id`,
        [f.firmId],
      )
    ).rows;
  const logged = async (action: string) =>
    (
      await su.query<{
        actor_type: string;
        entity_id: string | null;
        data: Record<string, unknown>;
      }>(
        `select actor_type, entity_id::text, data from events
          where firm_id = $1 and action = $2 order by id`,
        [f.firmId, action],
      )
    ).rows;
  const booking = async (worker: string, shiftId: string) =>
    (
      await su.query<{
        id: string;
        status: string;
        cancel_via: string | null;
        strike_warning_version: string | null;
        strike_warning_shown_at: Date | null;
      }>(
        `select id::text, status, cancel_via, strike_warning_version, strike_warning_shown_at
           from assignments where shift_id = $1 and worker_id = $2
          order by created_at desc limit 1`,
        [shiftId, worker],
      )
    ).rows[0];
  return { f, resourcer, portal, office, take, cancel, strikeRows, logged, booking };
}

describe("a casual's own cancellation", () => {
  it("inside 48 hours of a shift they took: a strike, logged with ids, codes and hours only", async () => {
    const t = await strikeFirm();
    const sam = await t.f.worker();
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(20) });
    await t.take(sam, shiftId);
    // Before: the warning they see on the cancel step.
    expect(await cancelWarning(t.portal(later(1)), sam, shiftId)).toEqual({
      status: "ok",
      warning: {
        kind: "strike",
        version: STRIKE_WARNING_VERSION,
        text: expect.stringMatching(
          /^This shift starts in 19 hours\. Cancelling with less than 48 hours' notice gives you a strike\. Booking Test .+'s? strikes team gets a record of it\. You have 0 strikes in the last 90 days\.$/,
        ),
      },
    });
    const outcome = await t.cancel(sam, shiftId, later(1), "strike");
    // Mon 2 Nov 10:00 + 90 days is Sun 31 Jan, 10:00 London.
    expect(outcome).toMatchObject({
      status: "cancelled",
      noticeHours: 19,
      strike: { until: "Sun 31 Jan" },
    });
    const row = await t.booking(sam, shiftId);
    expect(row).toMatchObject({
      status: "cancelled_worker",
      cancel_via: "app",
      strike_warning_version: STRIKE_WARNING_VERSION,
      strike_warning_shown_at: later(1),
    });
    expect(await t.strikeRows()).toEqual([
      {
        workerId: sam,
        assignmentId: row?.id,
        shiftId,
        noticeHours: 19,
        thresholdHours: 48,
        issuedAt: later(1),
        expiresAt: new Date(later(1).getTime() + 90 * DAY),
        status: "live",
        // Taken inside 48 hours: not flagged (that flag was cut; the office withdraws a mis-tap).
        reviewNeeded: false,
        reviewReasons: [],
      },
    ]);
    expect((await t.logged("shift.cancelled")).map((e) => e.data.strike)).toEqual(["issued"]);
    const [issued] = await t.logged("strike.issued");
    expect(issued).toMatchObject({ actor_type: "system" });
    expect(issued?.data).toEqual({
      assignmentId: row?.id,
      shiftId,
      workerId: sam,
      noticeHours: 19,
      thresholdHours: 48,
      review: false,
    });
    // It counts: their next warning says so.
    const next = await t.f.shift({ startsAt: hoursFromNow(30) });
    await t.take(sam, next, later(2));
    expect(await cancelWarning(t.portal(later(2)), sam, next)).toMatchObject({
      warning: { text: expect.stringContaining("You have 1 strike in the last 90 days.") },
    });
  });

  it("I'm unwell and Family or caring are flagged for a person to review; the log never says which", async () => {
    const t = await strikeFirm();
    const reasons = ["I'm unwell", "Family or caring", "Travel problem", "Something else: Car"];
    for (const [i, reason] of reasons.entries()) {
      const casual = await t.f.worker({ first: reason.slice(0, 3) });
      const shiftId = await t.f.shift({ startsAt: hoursFromNow(30) });
      await t.take(casual, shiftId);
      expect(await t.cancel(casual, shiftId, later(2 + i), "strike", reason)).toMatchObject({
        status: "cancelled",
      });
    }
    expect((await t.strikeRows()).map((s) => [s.reviewNeeded, s.reviewReasons])).toEqual([
      [true, ["unwell"]],
      [true, ["family_or_caring"]],
      [false, []],
      [false, []],
    ]);
    const log = await t.logged("strike.issued");
    expect(log.map((e) => e.data.review)).toEqual([true, true, false, false]);
    const all = JSON.stringify(
      (await su.query("select data from events where firm_id = $1", [t.f.firmId])).rows,
    ).toLowerCase();
    expect(all).not.toContain("unwell");
    expect(all).not.toContain("family");
  });

  it("exactly 48 hours' notice: no strike; 47.99: a strike", async () => {
    const t = await strikeFirm();
    const ann = await t.f.worker({ first: "Ann" });
    const ben = await t.f.worker({ first: "Ben" });
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(72), headcount: 2 });
    await t.take(ann, shiftId);
    await t.take(ben, shiftId);
    expect(await t.cancel(ann, shiftId, later(24), "notice")).toMatchObject({
      status: "cancelled",
      noticeHours: 48,
      strike: null,
    });
    expect(
      await t.cancel(ben, shiftId, new Date(later(24).getTime() + 36_000), "strike"),
    ).toMatchObject({
      status: "cancelled",
      noticeHours: 47.99,
      strike: { until: expect.any(String) },
    });
    expect((await t.strikeRows()).map((s) => s.workerId)).toEqual([ben]);
    expect((await t.logged("shift.cancelled")).map((e) => e.data.strike)).toEqual([
      "enough_notice",
      "issued",
    ]);
  });

  it("follows the firm's own threshold and how long a strike counts", async () => {
    const t = await strikeFirm({ strikes: { notice_hours: 24, live_days: 30 } });
    const sam = await t.f.worker();
    const jo = await t.f.worker({ first: "Jo" });
    const a = await t.f.shift({ startsAt: hoursFromNow(30) });
    const b = await t.f.shift({ startsAt: hoursFromNow(20) });
    await t.take(sam, a);
    await t.take(jo, b);
    expect(await t.cancel(sam, a, NOW, "notice")).toMatchObject({ strike: null });
    expect(await cancelWarning(t.portal(), jo, b)).toMatchObject({
      warning: {
        text: expect.stringContaining("less than 24 hours' notice gives you a strike."),
      },
    });
    await t.cancel(jo, b, NOW, "strike");
    expect(await t.strikeRows()).toMatchObject([
      { thresholdHours: 24, expiresAt: new Date(NOW.getTime() + 30 * DAY) },
    ]);
  });
});

describe("no strike", () => {
  it("when the office cancels: one booking, or the whole session", async () => {
    const t = await strikeFirm();
    const sam = await t.f.worker();
    const jo = await t.f.worker({ first: "Jo" });
    const one = await t.f.shift({ startsAt: hoursFromNow(5) });
    const whole = await t.f.shift({ startsAt: hoursFromNow(6) });
    await t.take(sam, one);
    await t.take(jo, whole);
    expect(await cancelBookingByOffice(t.office(), one, sam, "weather")).toMatchObject({
      status: "cancelled",
      strike: null,
    });
    expect(await cancelShift(t.office(), whole, "event_cancelled")).toMatchObject({
      status: "cancelled",
    });
    expect(await t.strikeRows()).toEqual([]);
    expect((await t.booking(sam, one))?.cancel_via).toBe("office");
    expect((await t.booking(jo, whole))?.cancel_via).toBe("office");
    expect((await t.logged("shift.cancelled"))[0]?.data.strike).toBe("by_firm");
  });

  it("on a booking the office made: Assign, or Assign over a rules check", async () => {
    const t = await strikeFirm();
    const sam = await t.f.worker();
    const jo = await t.f.worker({ first: "Jo" });
    const placed = await t.f.shift({ startsAt: hoursFromNow(20) });
    const overridden = await t.f.shift({ startsAt: hoursFromNow(22) });
    expect(await assignWorker(t.office(), placed, sam, null)).toMatchObject({ status: "booked" });
    // Jo said she can't work that day; the office places her anyway, with a reason.
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-03')",
      [t.f.firmId, jo],
    );
    expect(
      await assignWorker(t.office(), overridden, jo, {
        codes: ["unavailable"],
        reason: "Rang in: can do it after all",
      }),
    ).toMatchObject({ status: "booked" });
    for (const [who, shiftId] of [
      [sam, placed],
      [jo, overridden],
    ] as const) {
      expect(await cancelWarning(t.portal(later(1)), who, shiftId)).toMatchObject({
        warning: {
          kind: "exempt",
          text: "The office booked or changed this shift, so cancelling doesn't give you a strike.",
        },
      });
      expect(await t.cancel(who, shiftId, later(1), "exempt")).toMatchObject({ strike: null });
    }
    expect(await t.strikeRows()).toEqual([]);
    expect((await t.logged("shift.cancelled")).map((e) => e.data.strike)).toEqual([
      "booked_by_office",
      "rules_override",
    ]);
  });

  it("after the office moved it or changed its pay; a change to the post alone doesn't count", async () => {
    const t = await strikeFirm();
    const [ann, ben, cal] = [
      await t.f.worker({ first: "Ann" }),
      await t.f.worker({ first: "Ben" }),
      await t.f.worker({ first: "Cal" }),
    ];
    const moved = await t.f.shift({ startsAt: hoursFromNow(30) }); // Tue 3 Nov 15:00
    const repaid = await t.f.shift({ startsAt: hoursFromNow(31) });
    const reposted = await t.f.shift({ startsAt: hoursFromNow(32) });
    await t.take(ann, moved);
    await t.take(ben, repaid);
    await t.take(cal, reposted);
    expect(
      await moveShift(t.office(later(1)), moved, {
        date: "2026-11-03",
        start: "16:00",
        end: "23:00",
        siteId: "",
        reason: "event_changed",
      }),
    ).toMatchObject({ status: expect.stringMatching(/^(moved|curtailed)$/) });
    const details = { payRate: "", post: "", meetingPoint: "", uniform: "", requirements: [] };
    expect(
      await editShiftDetails(t.office(later(1)), repaid, { ...details, payRate: "15.50" }),
    ).toMatchObject({ status: "saved" });
    expect(
      await editShiftDetails(t.office(later(1)), reposted, { ...details, post: "Gate B" }),
    ).toMatchObject({ status: "saved" });
    expect(await t.cancel(ann, moved, later(2), "exempt")).toMatchObject({ strike: null });
    expect(await t.cancel(ben, repaid, later(2), "exempt")).toMatchObject({ strike: null });
    expect(await t.cancel(cal, reposted, later(2), "strike")).toMatchObject({
      strike: { until: expect.any(String) },
    });
    expect((await t.logged("shift.cancelled")).map((e) => e.data.strike)).toEqual([
      "changed_after_booking",
      "changed_after_booking",
      "issued",
    ]);
  });
});

describe("the warning they confirmed against", () => {
  it("if what would happen changed while they read it, nothing is cancelled and they get the new one", async () => {
    const t = await strikeFirm();
    const sam = await t.f.worker();
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(50) });
    await t.take(sam, shiftId);
    // At 08:00 the step said "doesn't give you a strike"; they confirm at 11:00 (47 hours before).
    expect(await cancelWarning(t.portal(), sam, shiftId)).toMatchObject({
      warning: { kind: "notice" },
    });
    expect(await t.cancel(sam, shiftId, later(3), "notice")).toEqual({
      status: "warning_changed",
      warning: {
        kind: "strike",
        version: STRIKE_WARNING_VERSION,
        text: expect.stringContaining("This shift starts in 47 hours."),
      },
    });
    expect((await t.booking(sam, shiftId))?.status).toBe("confirmed");
    expect(await t.strikeRows()).toEqual([]);
    expect(await t.logged("shift.cancelled")).toEqual([]);
    // Confirmed again against the new warning: done.
    expect(await t.cancel(sam, shiftId, later(3), "strike")).toMatchObject({ status: "cancelled" });
    expect(await t.strikeRows()).toHaveLength(1);
  });

  it("a cancellation that rolls back leaves no strike", async () => {
    const t = await strikeFirm();
    const sam = await t.f.worker();
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(10) });
    await t.take(sam, shiftId);
    const failing: WithFirm = (firmId, fn) =>
      withFirm(firmId, async (tx) => {
        await fn(tx);
        throw new Error("the connection dropped before commit");
      });
    await expect(
      cancelBooking(
        failing,
        t.f.firmId,
        {
          shiftId,
          workerId: sam,
          reason: "Travel problem",
          by: { type: "worker", id: sam, warning: saw("strike") },
        },
        { clock: at(NOW) },
      ),
    ).rejects.toThrow(/connection dropped/);
    expect(await t.strikeRows()).toEqual([]);
    expect((await t.booking(sam, shiftId))?.status).toBe("confirmed");
  });
});

describe("the strikes table", () => {
  it("one strike per booking; the app can't delete a strike or rewrite its facts", async () => {
    const t = await strikeFirm();
    const sam = await t.f.worker();
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(10) });
    await t.take(sam, shiftId);
    await t.cancel(sam, shiftId, NOW, "strike");
    const [strike] = (
      await su.query<{ id: string; assignment_id: string }>(
        "select id::text, assignment_id::text from strikes where firm_id = $1",
        [t.f.firmId],
      )
    ).rows;
    const asApp = (q: ReturnType<typeof sql>) => withFirm(t.f.firmId, (tx) => tx.execute(q));
    await expect(
      asApp(sql`insert into strikes (firm_id, worker_id, assignment_id, shift_id, notice_hours,
                                     threshold_hours, issued_at, expires_at)
                values (app_current_firm_id(), ${sam}, ${strike?.assignment_id}, ${shiftId}, 1, 48,
                        now(), now() + interval '1 day')`),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    await expect(asApp(sql`delete from strikes where id = ${strike?.id}`)).rejects.toMatchObject({
      cause: { code: "42501" },
    });
    await expect(
      asApp(sql`update strikes set notice_hours = 50 where id = ${strike?.id}`),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    // The review flag is one of the columns it may change (Keep strike, 12C.5).
    await asApp(sql`update strikes set review_needed = false where id = ${strike?.id}`);
    expect(await t.strikeRows()).toHaveLength(1);
  });

  it("deleted 12 months after it was issued (the firm's keep_months), never during a hold, only the firm's own", async () => {
    const t = await strikeFirm();
    const other = await strikeFirm();
    const sam = await t.f.worker();
    // Strikes issued 13 and 11 months ago (by the database's clock, which the purge reads).
    const old = async (firm: { f: BookingFirm }, worker: string, monthsAgo: number) => {
      const shiftId = await firm.f.shift({ startsAt: hoursFromNow(-24 * 30 * monthsAgo) });
      const { rows } = await su.query<{ id: string }>(
        `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at,
                                  cancelled_at, cancel_reason, notice_hours, cancel_via)
         values ($1, $2, 1, $3, 'cancelled_worker', now() - make_interval(months => $4),
                 now() - make_interval(months => $4), 'Travel problem', 10, 'app')
         returning id::text as id`,
        [firm.f.firmId, shiftId, worker, monthsAgo],
      );
      await su.query(
        `insert into strikes (firm_id, worker_id, assignment_id, shift_id, notice_hours,
                              threshold_hours, issued_at, expires_at)
         values ($1, $2, $3, $4, 10, 48, now() - make_interval(months => $5),
                 now() - make_interval(months => $5) + interval '90 days')`,
        [firm.f.firmId, worker, rows[0]?.id, shiftId, monthsAgo],
      );
    };
    await old(t, sam, 13);
    await old(t, sam, 11);
    await old(other, await other.f.worker(), 13);
    const purge = (firmId: string) =>
      withFirm(firmId, async (tx) => {
        const { rows } = await tx.execute<{ n: number }>(sql`select app_purge_old_strikes() as n`);
        return Number(rows[0]?.n);
      });
    const count = async (firmId: string) =>
      (await su.query("select count(*)::int as n from strikes where firm_id = $1", [firmId]))
        .rows[0]?.n;

    // A hold for a dispute: nothing goes.
    await su.query(
      `update firms set settings = jsonb_set(settings, '{retention}', '{"hold_until": "2099-12-31"}')
        where id = $1`,
      [t.f.firmId],
    );
    expect(await purge(t.f.firmId)).toBe(0);
    // A firm keeping strikes 18 months: the 13-month one stays too.
    await su.query(`update firms set settings = '{"strikes": {"keep_months": 18}}' where id = $1`, [
      t.f.firmId,
    ]);
    expect(await purge(t.f.firmId)).toBe(0);
    // The default, through the nightly purge: the 13-month one goes, the 11-month one stays.
    await su.query(`update firms set settings = '{}' where id = $1`, [t.f.firmId]);
    expect(await withFirm(t.f.firmId, (tx) => purgeExpired(tx, new Date()))).toMatchObject({
      strikes: 1,
    });
    expect(await count(t.f.firmId)).toBe(1);
    // Another firm's old strike is still there; its own purge takes it.
    expect(await count(other.f.firmId)).toBe(1);
    expect(await purge(other.f.firmId)).toBe(1);
    // Its log entry stays (the action log isn't purged): only the row goes.
    const anyStrikeEntry = await su.query(
      "select 1 from events where firm_id = $1 and action = 'retention.purged' and (data->>'strikes')::int = 1",
      [t.f.firmId],
    );
    expect(anyStrikeEntry.rows).toHaveLength(1);
  });
});

describe("the casual's data export", () => {
  it("includes their strikes, every column but the firm and worker ids", async () => {
    const t = await strikeFirm();
    const sam = await t.f.worker();
    const jo = await t.f.worker({ first: "Jo" });
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(10), headcount: 2 });
    await t.take(sam, shiftId);
    await t.take(jo, shiftId);
    await t.cancel(sam, shiftId, NOW, "strike", "I'm unwell");
    await t.cancel(jo, shiftId, NOW, "strike");
    const data = await withFirm(t.f.firmId, (tx) => collectWorkerData(tx, sam, NOW));
    expect(data?.sections.strikes).toEqual([
      expect.objectContaining({
        shiftId,
        thresholdHours: 48,
        status: "live",
        reviewNeeded: true,
        reviewReasons: ["unwell"],
      }),
    ]);
    expect(data?.sections.strikes?.[0]).not.toHaveProperty("firmId");
    expect(data?.sections.strikes?.[0]).not.toHaveProperty("workerId");
  });
});

describe("Tell us what happened", () => {
  it("goes to the office as a review request with the booking's reference; once per booking", async () => {
    const t = await strikeFirm();
    const sam = await t.f.worker();
    const jo = await t.f.worker({ first: "Jo" });
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(10) });
    await t.take(sam, shiftId);
    const outcome = await t.cancel(sam, shiftId, NOW, "strike");
    if (outcome.status !== "cancelled") throw new Error("not cancelled");
    expect(await tellWhatHappened(t.portal(), sam, shiftId, "  ")).toEqual({ status: "invalid" });
    const sent = await tellWhatHappened(t.portal(), sam, shiftId, "The train was cancelled.");
    expect(sent).toMatchObject({ status: "sent", ref: expect.stringMatching(/^[0-9A-F]{8}$/) });
    const { rows } = await su.query(
      "select type, status, payload from requests where firm_id = $1 and worker_id = $2",
      [t.f.firmId, sam],
    );
    expect(rows).toEqual([
      {
        type: "review",
        status: "open",
        payload: {
          codes: [],
          reasons: [],
          note: "The train was cancelled.",
          cancellation: outcome.ref,
        },
      },
    ]);
    // Logged without their words.
    const [created] = await t.logged("request.created");
    expect(created?.data).toEqual({
      type: "review",
      shiftId,
      assignmentId: (await t.booking(sam, shiftId))?.id,
    });
    expect(await tellWhatHappened(t.portal(), sam, shiftId, "Again.")).toEqual({
      status: "already_sent",
      ref: sent.status === "sent" ? sent.ref : "",
    });
    // Jo didn't cancel it; nor did anyone on another firm's shift.
    expect(await tellWhatHappened(t.portal(), jo, shiftId, "Hello.")).toEqual({
      status: "not_cancelled",
    });
  });
});
