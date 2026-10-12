import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { myRequests } from "@/lib/portal/requests";
import { askForReview } from "@/lib/portal/review";
import { shiftForWorker } from "@/lib/portal/shift-detail";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { barrier } from "../helpers/race";

// One shift's page and "Ask the office to review", on the real database as the app role.
// NOW is Monday 2 November 2026, 09:00 London.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const ctxFor = (f: BookingFirm, when = NOW) => ({
  firm: { id: f.firmId, timezone: "Europe/London", signOff: "Test Shift Team" },
  run: withFirm,
  clock: { now: () => when },
});
const page = (f: BookingFirm, workerId: string, shiftId: string, when = NOW) =>
  shiftForWorker(ctxFor(f, when), workerId, shiftId);
const review = (f: BookingFirm, workerId: string, shiftId: string, note = "", when = NOW) =>
  askForReview(ctxFor(f, when), workerId, shiftId, note);
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

// A door supervisor shift on Wednesday with instructions, and a worker without an SIA licence.
async function blockedFirm() {
  const f = await bookingFirm(su, withFirm);
  const noLicence = await f.worker({ first: "Nia", credentials: [] });
  const shiftId = await f.shift({ startsAt: hoursFromNow(48), headcount: 2 });
  await su.query(
    "update shifts set instructions = 'Meet at gate C. Door code 4471.' where id = $1",
    [shiftId],
  );
  return { f, noLicence, shiftId };
}

describe("shiftForWorker", () => {
  it("blocked: the rules' reasons in plain English, never the instructions", async () => {
    const { f, noLicence, shiftId } = await blockedFirm();
    const shown = await page(f, noLicence, shiftId);
    expect(shown).toMatchObject({
      state: "blocked",
      shift: { shiftId, role: "door_supervisor", placesLeft: 2, startsAt: hoursFromNow(48) },
      review: null,
    });
    expect(shown.state === "blocked" && shown.reasons).toEqual([
      expect.stringContaining("SIA door supervisor licence"),
    ]);
    expect(JSON.stringify(shown)).not.toContain("gate C");
  });

  it("open, then booked (with the instructions) once the worker takes it", async () => {
    const { f, shiftId } = await blockedFirm();
    const sam = await f.worker();
    expect(await page(f, sam, shiftId)).toMatchObject({ state: "open", shift: { placesLeft: 2 } });
    expect(JSON.stringify(await page(f, sam, shiftId))).not.toContain("gate C");
    const assignmentId = await f.booking(sam, shiftId);
    expect(await page(f, sam, shiftId)).toMatchObject({
      state: "booked",
      shift: {
        assignmentId,
        shiftId,
        status: "confirmed",
        instructions: "Meet at gate C. Door code 4471.",
      },
    });
  });

  it("the page in full (12H.2): the session's facts, what it needs with her status, the firm's notice", async () => {
    const f = await bookingFirm(su, withFirm, { settings: { strikes: { notice_hours: 24 } } });
    // Her SIA licence runs well past the shift; her first aid ends the day before it; no CSAS.
    const zoe = await f.worker({
      first: "Zoe",
      credentials: [
        { type: "STEWARD_L2", expiresOn: null },
        { type: "SIA_DS", expiresOn: "2029-01-01" },
        { type: "FIRST_AID", expiresOn: "2026-11-03" },
      ],
    });
    const shiftId = await f.shift({ startsAt: hoursFromNow(48), headcount: 4 });
    await su.query(
      `update shifts set required_credentials = '{CSAS,FIRST_AID,SIA_DS,RTW}', pay_rate_pence = 1550,
              post = 'Gate A', meeting_point = 'Staff entrance', uniform = 'Black trousers',
              is_urgent = true
        where id = $1`,
      [shiftId],
    );
    const shown = await page(f, zoe, shiftId);
    // The rules still decide: no CSAS, so she can't take it.
    expect(shown.state).toBe("blocked");
    if (shown.state !== "blocked") return;
    expect(shown.facts).toMatchObject({
      eventName: "Fixture event",
      payRatePence: 1550,
      post: "Gate A",
      meetingPoint: "Staff entrance",
      uniform: "Black trousers",
      isUrgent: true,
      headcount: 4,
      travel: { kind: "unknown" }, // no travel area
      noticeHours: 24,
      lastDay: "2026-11-04",
    });
    // The role's first (door supervisor: SIA), then the session's extras, each once, right to work
    // included (the rules engine checks it). "upload it" only where her roles need the type (the
    // upload page takes only those) and the office doesn't record it.
    expect(shown.facts.requirements).toEqual([
      {
        code: "SIA_DS",
        name: "SIA door supervisor licence",
        chip: "SIA DS",
        status: { status: "valid", expiresOn: "2029-01-01", renewing: false },
        uploadable: true,
      },
      {
        code: "CSAS",
        name: expect.any(String),
        chip: "CSAS",
        status: { status: "missing", expiresOn: null, renewing: false },
        uploadable: false, // the office records CSAS itself
      },
      {
        code: "FIRST_AID",
        name: "first aid at work certificate",
        chip: "First aid",
        status: { status: "expiring_soon", expiresOn: "2026-11-03", renewing: false },
        uploadable: false, // neither of her roles needs it: she couldn't send it
      },
      {
        code: "RTW",
        name: "right to work check",
        chip: "Right to work check",
        status: { status: "missing", expiresOn: null, renewing: false },
        uploadable: false,
      },
    ]);
  });

  it("What it needs reads her own records only: not another casual's, nor another firm's", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const zoe = await f.worker({ first: "Zoe" });
    // A colleague in her firm, and a casual in another firm, both hold CSAS.
    await f.worker({ first: "Cal", credentials: [{ type: "CSAS", expiresOn: "2029-01-01" }] });
    await other.worker({ first: "Oli", credentials: [{ type: "CSAS", expiresOn: "2029-01-01" }] });
    const shiftId = await f.shift({ startsAt: hoursFromNow(48) });
    await su.query("update shifts set required_credentials = '{CSAS}' where id = $1", [shiftId]);
    const shown = await page(f, zoe, shiftId);
    expect(shown.state).toBe("blocked");
    if (shown.state !== "blocked") return;
    expect(shown.facts.requirements.find((r) => r.code === "CSAS")?.status).toEqual({
      status: "missing",
      expiresOn: null,
      renewing: false,
    });
  });

  it("a type her roles need, with her new one waiting: renewing, and hers to upload", async () => {
    const f = await bookingFirm(su, withFirm);
    const zoe = await f.worker({
      first: "Zoe",
      credentials: [
        { type: "STEWARD_L2", expiresOn: null },
        { type: "SIA_DS", expiresOn: "2026-11-03" },
      ],
    });
    // Her new licence, sent and waiting for the office.
    const upload = await su.query<{ id: string }>(
      `insert into uploads (firm_id, worker_id, kind, credential_type, content_type, size, sha256, data)
       values ($1, $2, 'certificate', 'SIA_DS', 'image/jpeg', 3, $3, '\\xffd8ff'::bytea)
       returning id::text as id`,
      [f.firmId, zoe, "0".repeat(64)],
    );
    await su.query(
      `insert into credentials (firm_id, worker_id, type, status, expires_on, check_state, evidence_upload_id)
       values ($1, $2, 'SIA_DS', 'expired', null, 'waiting', $3)`,
      [f.firmId, zoe, upload.rows[0]?.id],
    );
    const shiftId = await f.shift({ startsAt: hoursFromNow(48) });
    const shown = await page(f, zoe, shiftId);
    expect(shown.state).toBe("blocked");
    if (shown.state !== "blocked") return;
    expect(shown.facts.requirements).toEqual([
      expect.objectContaining({
        code: "SIA_DS",
        status: { status: "expiring_soon", expiresOn: "2026-11-03", renewing: true },
        uploadable: true,
      }),
    ]);
  });

  it("an automatic event isn't named (it only repeats the site and day); a booking gets the page in full too", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const auto = await su.query<{ id: string }>(
      `insert into shift_events (firm_id, name, planner_ref) values ($1, 'Arena · Wed 4 Nov', $2)
       returning id::text as id`,
      [f.firmId, `auto:none:2026-11-04:${Math.random().toString(36).slice(2, 8)}`],
    );
    const shiftId = await f.shift({ eventId: auto.rows[0]?.id, headcount: 2 });
    const open = await page(f, sam, shiftId);
    expect(open).toMatchObject({ state: "open", facts: { eventName: null, headcount: 2 } });
    await f.booking(sam, shiftId);
    const booked = await page(f, sam, shiftId);
    expect(booked).toMatchObject({
      state: "booked",
      shift: { eventName: null },
      facts: { eventName: null, requirements: [expect.objectContaining({ code: "SIA_DS" })] },
    });
  });

  it("filled, started and cancelled: nothing to take", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const full = await f.shift({ headcount: 1 });
    await f.booking(jo, full);
    expect(await page(f, sam, full)).toMatchObject({ state: "filled", shift: { placesLeft: 0 } });
    const closed = await f.shift({ status: "filled", headcount: 3 });
    expect((await page(f, sam, closed)).state).toBe("filled");
    const started = await f.shift({ startsAt: hoursFromNow(-1) });
    expect((await page(f, sam, started)).state).toBe("started");
    const cancelled = await f.shift({ status: "cancelled" });
    expect((await page(f, sam, cancelled)).state).toBe("cancelled");
    // Booked on a shift the office then cancelled: cancelled, not booked.
    const dropped = await f.shift();
    await f.booking(sam, dropped);
    await su.query("update shifts set status = 'cancelled' where id = $1", [dropped]);
    expect((await page(f, sam, dropped)).state).toBe("cancelled");
  });

  it("held under fair rotation, with when it opens", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { allocation_mode: "fair_rotation", wave_size: 1, wave_minutes: 15 },
    });
    const busy = await f.worker({ first: "Bea" });
    await f.worker({ first: "Nil" }); // 0 hours: the group of one
    await f.booking(busy, await f.shift({ startsAt: hoursFromNow(96), hours: 2 }));
    const shiftId = await f.shift({ startsAt: hoursFromNow(48) });
    await su.query("update shifts set created_at = $1 where id = $2", [later(-1), shiftId]);
    expect(await page(f, busy, shiftId)).toMatchObject({ state: "held", opensAt: later(14) });
  });

  it("missing: a draft, another firm's shift, or not a shift id", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    expect((await page(f, sam, await f.shift({ status: "draft" }))).state).toBe("missing");
    expect((await page(f, sam, await other.shift())).state).toBe("missing");
    expect((await page(f, sam, "not-a-shift")).state).toBe("missing");
  });
});

describe("askForReview", () => {
  it("adds one review request with the reasons and note, logged with ids only", async () => {
    const { f, noLicence, shiftId } = await blockedFirm();
    const result = await review(f, noLicence, shiftId, "  I renewed it last week.  ");
    expect(result).toEqual({
      status: "created",
      ref: expect.stringMatching(/^[0-9A-F]{8}$/),
      sentAt: "09:00 on Mon 2 Nov",
      signOff: "Test Shift Team",
    });
    const { rows } = await su.query(
      `select id::text, worker_id::text, shift_id::text, type, status, payload from requests
        where firm_id = $1`,
      [f.firmId],
    );
    expect(rows).toEqual([
      {
        id: expect.any(String),
        worker_id: noLicence,
        shift_id: shiftId,
        type: "review",
        status: "open",
        payload: {
          codes: ["credential_missing"],
          reasons: [expect.stringContaining("SIA door supervisor licence")],
          note: "I renewed it last week.",
        },
      },
    ]);
    const requestId = rows[0]?.id as string;
    expect(result.status === "created" && result.ref).toBe(requestId.slice(0, 8).toUpperCase());
    const { rows: events } = await su.query(
      "select actor_type, actor_id::text, action, entity_id::text, data from events where firm_id = $1 and action = 'request.created'",
      [f.firmId],
    );
    expect(events).toEqual([
      {
        actor_type: "worker",
        actor_id: noLicence,
        action: "request.created",
        entity_id: requestId,
        data: { type: "review", shiftId, codes: ["credential_missing"] },
      },
    ]);

    // Asking again gives the waiting one's reference; the page shows it's been asked.
    expect(await review(f, noLicence, shiftId)).toEqual({
      status: "already_open",
      ref: requestId.slice(0, 8).toUpperCase(),
    });
    expect(await page(f, noLicence, shiftId)).toMatchObject({
      state: "blocked",
      review: { ref: requestId.slice(0, 8).toUpperCase(), askedAt: expect.any(Date) },
    });
    // It's in the worker's requests, with its shift.
    const listed = await myRequests(ctxFor(f), noLicence);
    expect(listed).toMatchObject([
      { type: "review", status: "open", shift: { role: "Door supervisor" } },
    ]);
  });

  it("adds nothing when there's nothing to review", async () => {
    const { f, noLicence, shiftId } = await blockedFirm();
    const other = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    // The rules say yes: nothing to review.
    expect(await review(f, sam, shiftId)).toEqual({ status: "eligible_now" });
    // Already booked on it.
    await f.booking(sam, shiftId);
    expect(await review(f, sam, shiftId)).toEqual({ status: "already_booked" });
    // Started, filled, cancelled, a draft, another firm's shift, not a shift id.
    expect(await review(f, noLicence, shiftId, "", hoursFromNow(49))).toEqual({
      status: "not_open",
    });
    const full = await f.shift({ headcount: 1 });
    await f.booking(sam, full);
    for (const id of [
      full,
      await f.shift({ status: "cancelled" }),
      await f.shift({ status: "draft" }),
      await other.shift(),
      "not-a-shift",
    ]) {
      expect(await review(f, noLicence, id)).toEqual({ status: "not_open" });
    }
    // A note over 500 characters.
    expect(await review(f, noLicence, shiftId, "x".repeat(501))).toEqual({ status: "invalid" });
    const { rows } = await su.query("select count(*)::int as n from requests where firm_id = $1", [
      f.firmId,
    ]);
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("cuts over-long reasons to size rather than failing", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const longRole = `role_${"x".repeat(400)}`; // no worker has it, and it has no credential rule
    const shiftId = await f.shift({ role: longRole });
    const result = await review(f, sam, shiftId);
    expect(result.status).toBe("created");
    const { rows } = await su.query("select payload from requests where shift_id = $1", [shiftId]);
    const reasons = (rows[0]?.payload as { reasons: string[] }).reasons;
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) expect(reason.length).toBeLessThanOrEqual(300);
  });

  it("five taps at once add one review", async () => {
    const { f, noLicence, shiftId } = await blockedFirm();
    const pool = new Pool({ connectionString: urls.app, max: 5 });
    try {
      const run = createWithFirm(pool);
      const together = barrier(5);
      const gated: WithFirm = (id, fn) =>
        run(id, async (tx) => {
          await tx.execute(sql`select 1`);
          await together();
          return fn(tx);
        });
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          askForReview({ ...ctxFor(f), run: gated }, noLicence, shiftId, ""),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([
        "already_open",
        "already_open",
        "already_open",
        "already_open",
        "created",
      ]);
    } finally {
      await pool.end();
    }
    const { rows } = await su.query("select count(*)::int as n from requests where firm_id = $1", [
      f.firmId,
    ]);
    expect(rows).toEqual([{ n: 1 }]);
  });
});
