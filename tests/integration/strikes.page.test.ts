import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { canAccess } from "@/lib/auth/roles";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { eraseWorker } from "@/lib/gdpr/worker-erase";
import { officeCancellationRecord } from "@/lib/office/cancellations";
import { loadStrikes, officeStrikes } from "@/lib/office/strikes";
import { cancelMyShift } from "@/lib/portal/cancel-shift";
import { myStrikes } from "@/lib/portal/my-strikes";
import { takeShift } from "@/lib/portal/take-shift";
import { liveStrikeCount } from "@/lib/strikes/issue";
import { keepStrike, withdrawStrike } from "@/lib/strikes/manage";
import { STRIKE_WARNING_VERSION } from "@/lib/strikes/words";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The Strikes page, withdrawing and keeping a strike, and the casual's Strikes on Profile (12C.5;
// docs/office-v2.md 3.5, 4.6) on the real database, as the app role, through the real paths: a
// casual takes a shift and cancels it 19 hours before the start (a strike). NOW is Monday 2
// November 2026, 09:00 London (GMT).

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

async function strikesFirm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const portal = (now = NOW) => ({
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Booking Test Shift Team" },
    run: withFirm,
    clock: at(now),
  });
  // A casual takes a session (20 hours away, or `startsIn`) and cancels it at `cancelAt` hours
  // from now: a strike. Returns its booking.
  const strike = async (
    worker: string,
    o: { reason?: string; startsIn?: number; cancelAt?: number } = {},
  ) => {
    const shiftId = await f.shift({ startsAt: hoursFromNow(o.startsIn ?? 20) });
    expect(await takeShift(portal(), worker, shiftId)).toMatchObject({ status: "booked" });
    expect(
      await cancelMyShift(
        portal(later(o.cancelAt ?? 1)),
        worker,
        shiftId,
        o.reason ?? "Travel problem",
        { kind: "strike", version: STRIKE_WARNING_VERSION },
      ),
    ).toMatchObject({ status: "cancelled" });
    const { rows } = await su.query<{ assignment_id: string }>(
      "select assignment_id::text from strikes where shift_id = $1",
      [shiftId],
    );
    return { assignmentId: rows[0]?.assignment_id ?? "", shiftId };
  };
  const office = (officeUserId: string, now = later(3)) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: at(now),
  });
  const list = (view: "live" | "review" | "all", now = later(3)) =>
    withFirm(f.firmId, (tx) => loadStrikes(tx, { view, now }));
  const tokenFor = async (id: string) =>
    (
      await withFirm(f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: id, now: NOW }),
      )
    ).token;
  const row = async (assignmentId: string) =>
    (
      await su.query<{
        status: string;
        withdrawn_by: string | null;
        withdrawn_at: Date | null;
        withdrawn_reason: string | null;
        review_needed: boolean;
        reviewed_by: string | null;
        reviewed_at: Date | null;
      }>(
        `select status, withdrawn_by::text, withdrawn_at, withdrawn_reason, review_needed,
                reviewed_by::text, reviewed_at
           from strikes where assignment_id = $1`,
        [assignmentId],
      )
    ).rows[0];
  const logged = async (action: string) =>
    (
      await su.query<{ actor_id: string; data: Record<string, unknown> }>(
        "select actor_id::text, data from events where firm_id = $1 and action = $2 order by id",
        [f.firmId, action],
      )
    ).rows;
  return { f, admin, resourcer, strike, office, list, tokenFor, row, logged };
}

describe("the list", () => {
  it("one row per casual, sorted by live strikes; Live, Needs review and All", async () => {
    const t = await strikesFirm();
    const [ann, ben, cal] = [
      await t.f.worker({ first: "Ann" }),
      await t.f.worker({ first: "Ben" }),
      await t.f.worker({ first: "Cal" }),
    ];
    // Ann: two strikes (the second 40 hours away, past the rest rule, cancelled an hour later).
    await t.strike(ann);
    const annLatest = await t.strike(ann, { startsIn: 40, cancelAt: 2 });
    // Ben: one, for "I'm unwell": flagged for a review.
    await t.strike(ben, { reason: "I'm unwell" });
    // Cal: one, withdrawn.
    const calStrike = await t.strike(cal);
    expect(
      await withdrawStrike(t.office(t.admin), calStrike.assignmentId, "Booked by mistake"),
    ).toEqual({ status: "withdrawn" });

    const live = await t.list("live");
    expect(live.rows.map((r) => [r.casual, r.live, r.review])).toEqual([
      ["Ann Booker", 2, false],
      ["Ben Booker", 1, true],
    ]);
    expect(live.total).toBe(2);
    expect(live.liveDays).toBe(90);
    // Ann's latest first, with its session, notice and evidence.
    const [first] = live.rows;
    expect(first?.strikes.map((s) => s.assignmentId)[0]).toBe(annLatest.assignmentId);
    expect(first?.strikes).toHaveLength(2);
    expect(first?.strikes[0]).toMatchObject({
      role: "door_supervisor",
      noticeHours: 38,
      status: "live",
      counting: true,
      reviewNeeded: false,
      evidence: { status: "pending" },
    });
    expect((await t.list("review")).rows.map((r) => r.casual)).toEqual(["Ben Booker"]);
    expect((await t.list("all")).rows.map((r) => [r.casual, r.live])).toEqual([
      ["Ann Booker", 2],
      ["Ben Booker", 1],
      ["Cal Booker", 0],
    ]);
    // 90 days on (Sun 31 Jan), nothing counts: Live is empty, All still lists them.
    const past = later(24 * 91);
    expect((await t.list("live", past)).rows).toEqual([]);
    expect((await t.list("all", past)).rows.map((r) => r.live)).toEqual([0, 0, 0]);
  });
});

describe("withdrawing a strike", () => {
  it("needs a reason, kept on the row and never in the log; it stops counting", async () => {
    const t = await strikesFirm();
    const ann = await t.f.worker({ first: "Ann" });
    const s = await t.strike(ann, { reason: "I'm unwell" });
    const count = () => withFirm(t.f.firmId, (tx) => liveStrikeCount(tx, ann, later(3)));
    expect(await count()).toBe(1);
    for (const reason of ["", "   ", "x".repeat(501), 42]) {
      expect(await withdrawStrike(t.office(t.resourcer), s.assignmentId, reason)).toEqual({
        status: "invalid",
      });
    }
    expect((await t.row(s.assignmentId))?.status).toBe("live");

    const reason = "  She rang the office before; we told her it was fine  ";
    expect(await withdrawStrike(t.office(t.resourcer), s.assignmentId, reason)).toEqual({
      status: "withdrawn",
    });
    expect(await t.row(s.assignmentId)).toMatchObject({
      status: "withdrawn",
      withdrawn_by: t.resourcer,
      withdrawn_at: later(3),
      withdrawn_reason: reason.trim(),
      // A withdrawn strike needs no review.
      review_needed: false,
    });
    expect(await count()).toBe(0);
    const entries = await t.logged("strike.withdrawn");
    expect(entries).toEqual([
      {
        actor_id: t.resourcer,
        data: { assignmentId: s.assignmentId, shiftId: s.shiftId, workerId: ann },
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain("rang");
    // Once only.
    expect(await withdrawStrike(t.office(t.admin), s.assignmentId, "Again")).toEqual({
      status: "not_live",
    });
    // The record shows who, when and why (admins and resourcers only).
    const record = await officeCancellationRecord(
      { firm: { id: t.f.firmId }, run: withFirm, clock: at(later(3)) },
      await t.tokenFor(t.admin),
      s.assignmentId,
    );
    expect(record?.status === "found" && record.record.row.strike?.withdrawn).toMatchObject({
      reason: reason.trim(),
      at: later(3),
    });
  });
});

describe("keeping a strike after a review", () => {
  it("clears the flag, with who and when; logged; only a flagged live strike", async () => {
    const t = await strikesFirm();
    const [ann, ben] = [await t.f.worker({ first: "Ann" }), await t.f.worker({ first: "Ben" })];
    const flagged = await t.strike(ann, { reason: "Family or caring" });
    const plain = await t.strike(ben);
    expect(await keepStrike(t.office(t.admin), flagged.assignmentId)).toEqual({ status: "kept" });
    expect(await t.row(flagged.assignmentId)).toMatchObject({
      status: "live",
      review_needed: false,
      reviewed_by: t.admin,
      reviewed_at: later(3),
    });
    expect(await t.logged("strike.reviewed")).toEqual([
      {
        actor_id: t.admin,
        data: {
          assignmentId: flagged.assignmentId,
          shiftId: flagged.shiftId,
          workerId: ann,
          outcome: "kept",
        },
      },
    ]);
    expect(await keepStrike(t.office(t.admin), flagged.assignmentId)).toEqual({
      status: "not_flagged",
    });
    expect(await keepStrike(t.office(t.admin), plain.assignmentId)).toEqual({
      status: "not_flagged",
    });
    expect((await t.list("review")).rows).toEqual([]);
  });
});

describe("erasing a casual", () => {
  it("clears a strike's withdrawal reason; it stays withdrawn, with who and when", async () => {
    const t = await strikesFirm();
    const ann = await t.f.worker({ first: "Ann" });
    const s = await t.strike(ann);
    await withdrawStrike(t.office(t.admin), s.assignmentId, "Ann rang: her mum was in hospital");
    const erased = await eraseWorker(t.office(t.admin, later(4)), ann);
    expect(erased).toMatchObject({ status: "erased", counts: { withdrawalReasons: 1 } });
    expect(await t.row(s.assignmentId)).toMatchObject({
      status: "withdrawn",
      withdrawn_by: t.admin,
      withdrawn_reason: null,
    });
  });
});

describe("who can see strikes", () => {
  it("admins and resourcers only; payroll and a disabled user see none, anywhere", async () => {
    const t = await strikesFirm();
    const ann = await t.f.worker({ first: "Ann" });
    const s = await t.strike(ann);
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock: at(later(3)) };
    for (const id of [t.admin, t.resourcer]) {
      expect((await officeStrikes(ctx, await t.tokenFor(id), "live"))?.rows).toHaveLength(1);
    }
    const payroll = await t.f.office("payroll");
    for (const id of [payroll, await t.f.office("resourcer", "disabled")]) {
      const token = await t.tokenFor(id);
      expect(await officeStrikes(ctx, token, "all")).toBeNull();
      expect(await officeCancellationRecord(ctx, token, s.assignmentId)).toBeNull();
      expect(await withdrawStrike(t.office(id), s.assignmentId, "No")).toEqual({
        status: "not_allowed",
      });
      expect(await keepStrike(t.office(id), s.assignmentId)).toEqual({ status: "not_allowed" });
    }
    // Payroll's areas hold no strike: none of the areas that do are theirs.
    for (const area of ["strikes", "cancellations", "log", "workers", "today"] as const) {
      expect(canAccess("payroll", area), area).toBe(false);
    }
    expect((await t.row(s.assignmentId))?.status).toBe("live");
  });

  it("each firm sees and changes only its own", async () => {
    const a = await strikesFirm();
    const b = await strikesFirm();
    const ann = await a.f.worker({ first: "Ann" });
    const s = await a.strike(ann, { reason: "I'm unwell" });
    expect((await b.list("all")).rows).toEqual([]);
    expect(await withdrawStrike(b.office(b.admin), s.assignmentId, "Not ours")).toEqual({
      status: "not_found",
    });
    expect(await keepStrike(b.office(b.admin), s.assignmentId)).toEqual({ status: "not_found" });
    expect((await a.row(s.assignmentId))?.status).toBe("live");
  });
});

describe("the casual's Strikes on Profile", () => {
  it("their own only: the count still counting, each strike's status, never the reason", async () => {
    const t = await strikesFirm();
    const [ann, ben] = [await t.f.worker({ first: "Ann" }), await t.f.worker({ first: "Ben" })];
    const first = await t.strike(ann);
    await t.strike(ann, { startsIn: 40, cancelAt: 2 });
    await t.strike(ben);
    await withdrawStrike(t.office(t.admin), first.assignmentId, "Booked by mistake");
    const mine = await myStrikes(
      { firm: { id: t.f.firmId }, run: withFirm, clock: at(later(3)) },
      ann,
    );
    expect(mine.counting).toBe(1);
    expect(mine).toMatchObject({ liveDays: 90, noticeHours: 48, timeZone: "Europe/London" });
    expect(mine.strikes.map((s) => [s.noticeHours, s.status, s.counting])).toEqual([
      [38, "live", true],
      [19, "withdrawn", false],
    ]);
    expect(JSON.stringify(mine)).not.toContain("mistake");
    // After 90 days: nothing counts, both still listed.
    const later90 = await myStrikes(
      { firm: { id: t.f.firmId }, run: withFirm, clock: at(later(24 * 91)) },
      ann,
    );
    expect(later90.counting).toBe(0);
    expect(later90.strikes.map((s) => s.counting)).toEqual([false, false]);
  });
});
