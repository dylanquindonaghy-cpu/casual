import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { createRequest, myRequests, requestableShifts } from "@/lib/portal/requests";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { barrier } from "../helpers/race";

// Worker requests on the real database, as the app role: a time change or swap for the worker's
// own upcoming booking, stored for the office with an event (never the typed text), and listed
// back with its status.

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

const ctxFor = (f: BookingFirm, now = NOW) => ({
  firm: { id: f.firmId, timezone: "Europe/London", signOff: "Booking Test Shift Team" },
  run: withFirm,
  clock: { now: () => now },
});
const timeChange = (shiftId: string, note = "Train times changed") => ({
  shiftId,
  kind: "time_change" as const,
  payload: { start: "15:00", end: "23:00", note },
});

describe("createRequest", () => {
  it("stores a time change for the worker's own upcoming shift and logs it without the text", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(29) }); // Tue 3 Nov 14:00
    await f.booking(sam, shiftId);

    const outcome = await createRequest(
      ctxFor(f),
      sam,
      timeChange(shiftId, "My son Tom has a hospital appointment"),
    );
    expect(outcome).toEqual({
      status: "created",
      ref: expect.stringMatching(/^[0-9A-F]{8}$/),
      kind: "time_change",
      when: "Tue 3 Nov, 14:00 to 22:00",
      asked: "15:00 to 23:00",
      sentAt: "09:00 on Mon 2 Nov",
      signOff: "Booking Test Shift Team",
    });
    const { rows } = await su.query(
      "select id::text, type, status, payload, worker_id::text as worker from requests where firm_id = $1",
      [f.firmId],
    );
    expect(rows).toEqual([
      {
        id: expect.any(String),
        type: "time_change",
        status: "open",
        payload: { start: "15:00", end: "23:00", note: "My son Tom has a hospital appointment" },
        worker: sam,
      },
    ]);
    expect(outcome.status === "created" && rows[0]?.id.toUpperCase().startsWith(outcome.ref)).toBe(
      true,
    );
    const { rows: events } = await su.query(
      "select actor_type, actor_id::text, entity_id::text, data from events where firm_id = $1 and action = 'request.created'",
      [f.firmId],
    );
    expect(events).toEqual([
      {
        actor_type: "worker",
        actor_id: sam,
        entity_id: rows[0]?.id,
        data: { type: "time_change", shiftId },
      },
    ]);
  });

  it("keeps one open request per shift and kind: asking again gives the waiting one's reference", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    await f.booking(sam, shiftId);
    const first = await createRequest(ctxFor(f), sam, timeChange(shiftId));
    const again = await createRequest(ctxFor(f), sam, timeChange(shiftId, "Different note"));
    expect(again).toEqual({
      status: "already_open",
      ref: first.status === "created" ? first.ref : "",
      kind: "time_change",
    });
    // A swap for the same shift is a different ask.
    const swap = await createRequest(ctxFor(f), sam, {
      shiftId,
      kind: "swap",
      payload: { swapWith: "Jo", note: "" },
    });
    expect(swap.status).toBe("created");
    // Once the office has answered, a new one can be asked.
    await su.query(
      `update requests set status = 'declined', resolved_at = now(), resolved_by = $2
        where firm_id = $1 and type = 'time_change'`,
      [f.firmId, await f.office("resourcer")],
    );
    expect((await createRequest(ctxFor(f), sam, timeChange(shiftId))).status).toBe("created");
  });

  it("only for the worker's own confirmed booking on a shift that hasn't started", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const jos = await f.shift();
    await f.booking(jo, jos);
    const notBooked = await f.shift();
    const cancelled = await f.shift();
    await f.booking(sam, cancelled, "cancelled_worker");
    const shiftCancelled = await f.shift({ status: "cancelled" });
    await f.booking(sam, shiftCancelled);
    const soon = await f.shift({ startsAt: hoursFromNow(1) });
    await f.booking(sam, soon);
    const kit = await other.worker();
    const theirs = await other.shift();
    await other.booking(kit, theirs);

    for (const shiftId of [jos, notBooked, cancelled, shiftCancelled]) {
      expect(await createRequest(ctxFor(f), sam, timeChange(shiftId))).toEqual({
        status: "not_yours",
      });
    }
    const started = new Date(NOW.getTime() + 2 * HOUR);
    expect(await createRequest(ctxFor(f, started), sam, timeChange(soon))).toEqual({
      status: "not_yours",
    });
    expect(await createRequest(ctxFor(f), kit, timeChange(theirs))).toEqual({
      status: "not_yours",
    });
    const { rows } = await su.query(
      "select count(*)::int as n from requests where firm_id in ($1, $2)",
      [f.firmId, other.firmId],
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("refuses a payload that doesn't pass the check", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    await f.booking(sam, shiftId);
    const bad = [
      { start: "25:00", end: "23:00", note: "" },
      { start: "15:00", end: "15:00", note: "" },
      { start: "15:00", end: "23:00", note: "x".repeat(501) },
      { start: "15:00", end: "23:00", note: "", extra: "field" },
    ];
    for (const payload of bad) {
      expect(
        await createRequest(ctxFor(f), sam, {
          shiftId,
          kind: "time_change",
          payload: payload as never,
        }),
      ).toEqual({ status: "invalid" });
    }
  });
});

describe("createRequest: several taps at once", () => {
  it("five identical requests sent together: one is stored, the rest are told it's waiting", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    await f.booking(sam, shiftId);
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
          createRequest({ ...ctxFor(f), run: gated }, sam, timeChange(shiftId)),
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
    expect(rows[0]?.n).toBe(1);
  });
});

describe("myRequests and requestableShifts", () => {
  it("lists the worker's requests newest first, with the shift and the status", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const a = await f.shift({ startsAt: hoursFromNow(29) });
    const b = await f.shift({ startsAt: hoursFromNow(53) });
    await f.booking(sam, a);
    await f.booking(sam, b);
    await f.booking(jo, await f.shift({ startsAt: hoursFromNow(70) }));
    await createRequest(ctxFor(f), sam, timeChange(a));
    await createRequest(ctxFor(f, new Date(NOW.getTime() + 60_000)), sam, {
      shiftId: b,
      kind: "swap",
      payload: { swapWith: "", note: "" },
    });
    await su.query(
      `update requests set status = 'approved', resolved_at = now(), resolved_by = $2
        where firm_id = $1 and type = 'time_change'`,
      [f.firmId, await f.office("resourcer")],
    );
    // An old one (over 90 days) isn't listed.
    await su.query(
      `insert into requests (firm_id, worker_id, type, payload, created_at)
       values ($1, $2, 'general', '{}', now() - interval '91 days')`,
      [f.firmId, sam],
    );

    const list = await myRequests(ctxFor(f, new Date()), sam);
    expect(list.map((r) => [r.type, r.status])).toEqual([
      ["swap", "open"],
      ["time_change", "approved"],
    ]);
    expect(list[1]?.shift).toEqual({
      when: "Tue 3 Nov, 14:00 to 22:00",
      role: "Door supervisor",
      siteName: null,
    });
    expect(await myRequests(ctxFor(f, new Date()), jo)).toEqual([]);
  });

  it("offers the worker's upcoming bookings to ask about, and nothing else", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const later = await f.shift({ startsAt: hoursFromNow(53) });
    const sooner = await f.shift({ startsAt: hoursFromNow(29) });
    await f.booking(sam, later);
    await f.booking(sam, sooner);
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(-30) }), "completed");
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(40) }), "cancelled_worker");
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(42), status: "cancelled" }));
    await f.shift({ startsAt: hoursFromNow(45) }); // not booked
    expect(await requestableShifts(ctxFor(f), sam)).toEqual([
      { shiftId: sooner, label: "Tue 3 Nov, 14:00 to 22:00, Door supervisor" },
      { shiftId: later, label: "Wed 4 Nov, 14:00 to 22:00, Door supervisor" },
    ]);
  });
});
