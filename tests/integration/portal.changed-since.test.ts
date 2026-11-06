import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { sinceBooked } from "@/lib/portal/changed-since";
import { shiftForWorker } from "@/lib/portal/shift-detail";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// "Changed since you booked" and "The times changed" on a booked shift's page (Phase 28.5;
// docs/screens.md "The casual app, Phase 28" 28.5; src/lib/portal/changed-since.ts), on the real
// database as the app role. Only the session's `shift.changed` entries after her booking's
// confirmed_at count, and only their briefing fields (28.2's list); a rota sheet's sync entry that
// names other casuals in `overridden`, a change to the places, the event's name, the times or the
// site add nothing, and no other casual's id reaches the page's data. Moves of her own booking
// after confirmed_at mark the times changed. Another firm's entry about the same id is invisible.
// NOW is Monday 2 November 2026, 09:00 London; the fixture's booking was confirmed 100 hours
// before it.

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

const ctxFor = (f: BookingFirm) => ({
  firm: { id: f.firmId },
  run: withFirm,
  clock: { now: () => NOW },
});

// An action log entry written straight into the table, at `at` (as the superuser: the fixture
// never depends on the code under test).
async function logged(
  f: { firmId: string },
  o: {
    action: string;
    entityType: "shift" | "assignment";
    entityId: string;
    data: Record<string, unknown>;
    at: Date;
  },
) {
  await su.query(
    `insert into events (firm_id, actor_type, action, entity_type, entity_id, data, created_at)
     values ($1, 'system', $2, $3, $4, $5, $6)`,
    [f.firmId, o.action, o.entityType, o.entityId, JSON.stringify(o.data), o.at],
  );
}

async function bookedScene() {
  const f = await bookingFirm(su, withFirm);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const shiftId = await f.shift({ startsAt: hoursFromNow(48), headcount: 2 });
  const annBooking = await f.booking(ann, shiftId, "confirmed", 1);
  const benBooking = await f.booking(ben, shiftId, "confirmed", 2);
  return { f, ann, ben, shiftId, annBooking, benBooking };
}

const booked = async (f: BookingFirm, workerId: string, shiftId: string) => {
  const page = await shiftForWorker(ctxFor(f), workerId, shiftId);
  if (page.state !== "booked") throw new Error(`expected booked, got ${page.state}`);
  return page;
};

describe("Changed since you booked", () => {
  it("lists the briefing's parts changed after she booked, each once, with when the last changed", async () => {
    const { f, ann, ben, shiftId } = await bookedScene();
    const otherShift = await f.shift({ startsAt: hoursFromNow(72) });
    // Before she booked: not a change since.
    await logged(f, {
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: { by: "firm", fields: ["uniform"] },
      at: hoursFromNow(-200),
    });
    // The rota sheet's sync: the instructions, the event's name and the site, with the casuals its
    // overrides let through (other people's ids).
    await logged(f, {
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: {
        fields: ["instructions", "eventName", "siteId"],
        overridden: [{ workerId: ben, codes: ["rest"] }],
      },
      at: hoursFromNow(-60),
    });
    // The office's editor: the meeting point and the instructions again.
    await logged(f, {
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: { by: "firm", fields: ["meetingPoint", "instructions"] },
      at: new Date("2026-10-31T14:05:00Z"),
    });
    // The places and the times afterwards: not the briefing, so they don't move "when".
    await logged(f, {
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: { by: "firm", fields: ["headcount"], from: { headcount: 2 }, to: { headcount: 3 } },
      at: hoursFromNow(-20),
    });
    await logged(f, {
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: { by: "firm", fields: ["startsAt", "endsAt"] },
      at: hoursFromNow(-10),
    });
    // Another session's change.
    await logged(f, {
      action: "shift.changed",
      entityType: "shift",
      entityId: otherShift,
      data: { by: "firm", fields: ["post"] },
      at: hoursFromNow(-5),
    });

    const page = await booked(f, ann, shiftId);
    expect(page.changes).toEqual({
      fields: ["instructions", "meetingPoint"],
      at: new Date("2026-10-31T14:05:00Z"),
    });
    expect(page.timesChanged).toBe(false);
    // Nothing of the sync entry but its briefing field's name reaches the page.
    const data = JSON.stringify(page);
    expect(data).not.toContain(ben);
    expect(data).not.toContain("overridden");
    const changes = JSON.stringify(page.changes);
    for (const word of ["eventName", "siteId", "headcount", "startsAt", "uniform", "post"])
      expect(changes).not.toContain(word);
  });

  it("a sync entry with 'overridden' and a places-only change add nothing", async () => {
    const { f, ann, ben, shiftId } = await bookedScene();
    await logged(f, {
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: { fields: ["headcount"], overridden: [{ workerId: ben, codes: ["weekly_hours"] }] },
      at: hoursFromNow(-30),
    });
    await logged(f, {
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: { by: "firm", fields: ["headcount"], from: { headcount: 2 }, to: { headcount: 1 } },
      at: hoursFromNow(-20),
    });
    // Junk in the log is read as nothing, never trusted.
    await logged(f, {
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: { fields: "instructions" },
      at: hoursFromNow(-15),
    });
    const page = await booked(f, ann, shiftId);
    expect(page.changes).toBeNull();
    expect(JSON.stringify(page)).not.toContain(ben);
  });

  it("an entry in the same moment as her booking is the booking's own, not a change since", async () => {
    const { f, ann, shiftId, annBooking } = await bookedScene();
    const { rows } = await su.query<{ at: Date }>(
      "select confirmed_at as at from assignments where id = $1",
      [annBooking],
    );
    const confirmedAt = rows[0]?.at;
    if (!confirmedAt) throw new Error("no confirmed_at");
    await logged(f, {
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: { by: "firm", fields: ["instructions"] },
      at: confirmedAt,
    });
    expect((await booked(f, ann, shiftId)).changes).toBeNull();
    // With no confirmed_at (never the case for a live booking), nothing is read.
    expect(
      await withFirm(f.firmId, (tx) =>
        sinceBooked(tx, { shiftId, assignmentId: annBooking, confirmedAt: null }),
      ),
    ).toEqual({ changes: null, moves: 0 });
  });

  it("another firm's entry naming the same session is invisible (RLS)", async () => {
    const { f, ann, shiftId } = await bookedScene();
    const other = await bookingFirm(su, withFirm);
    await logged(other, {
      action: "shift.changed",
      entityType: "shift",
      entityId: shiftId,
      data: { by: "firm", fields: ["instructions", "payRatePence"] },
      at: hoursFromNow(-10),
    });
    expect((await booked(f, ann, shiftId)).changes).toBeNull();
  });
});

describe("The times changed", () => {
  it("only the office's moves and shortenings of her own booking after she booked", async () => {
    const { f, ann, ben, shiftId, annBooking, benBooking } = await bookedScene();
    const move = (assignmentId: string, workerId: string, at: Date, action = "shift.moved") =>
      logged(f, {
        action,
        entityType: "assignment",
        entityId: assignmentId,
        data: { by: "firm", shiftId, workerId, noticeHours: 60 },
        at,
      });
    // Ben's booking was moved, and Ann's before she booked: not hers since.
    await move(benBooking, ben, hoursFromNow(-10));
    await move(annBooking, ann, hoursFromNow(-150));
    expect((await booked(f, ann, shiftId)).timesChanged).toBe(false);
    expect((await booked(f, ben, shiftId)).timesChanged).toBe(true);
    await move(annBooking, ann, hoursFromNow(-5), "shift.curtailed");
    const page = await booked(f, ann, shiftId);
    expect(page.timesChanged).toBe(true);
    const counted = await withFirm(f.firmId, (tx) =>
      sinceBooked(tx, {
        shiftId,
        assignmentId: annBooking,
        confirmedAt: new Date(NOW.getTime() - 100 * HOUR),
      }),
    );
    expect(counted.moves).toBe(1);
  });
});

describe("the booked page's other new fields", () => {
  it("carries her Still coming answer (28.2's column, for 28.14)", async () => {
    const { f, ann, shiftId, annBooking } = await bookedScene();
    expect((await booked(f, ann, shiftId)).shift.stillComingAt).toBeNull();
    const said = hoursFromNow(-2);
    await su.query("update assignments set still_coming_at = $2 where id = $1", [annBooking, said]);
    expect((await booked(f, ann, shiftId)).shift.stillComingAt).toEqual(said);
  });

  it("a blocked page carries each reason's rule code, in the same order", async () => {
    const f = await bookingFirm(su, withFirm);
    const nia = await f.worker({ first: "Nia", credentials: [] });
    const shiftId = await f.shift({ startsAt: hoursFromNow(48) });
    const page = await shiftForWorker(ctxFor(f), nia, shiftId);
    expect(page.state).toBe("blocked");
    if (page.state !== "blocked") return;
    expect(page.codes).toEqual(["credential_missing"]);
    expect(page.reasons).toHaveLength(1);
  });
});
