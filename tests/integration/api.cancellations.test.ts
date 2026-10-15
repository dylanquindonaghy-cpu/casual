import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createKeyDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import type { ApiDeps } from "@/lib/integrations/api";
import { getCancellationsRequest } from "@/lib/integrations/cancellations";
import {
  bookingWithSession,
  type BookingRecord,
  type CancellationRecord,
} from "@/lib/integrations/records";
import { putSessionRequest } from "@/lib/integrations/sessions";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { answer, apiDeps, apiRequest, plannerKey } from "../helpers/planner-api";

// GET /api/v1/cancellations (docs/office-v2.md 5.3.2 and 5.3.3; 12J.1) on the real database, as
// the app role: keyset pages oldest first, 100 at most, and each record the webhooks' `data`, with
// nothing a casual typed and nothing about their health.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
let resolveKey: ReturnType<typeof createKeyDirectory>;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
  resolveKey = createKeyDirectory(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

type Page = {
  records: CancellationRecord[];
  next_cursor: string | null;
  error?: { code: string };
};

async function plannerFirm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const key = await plannerKey(su, f.firmId, admin);
  const deps: ApiDeps = apiDeps({ run: withFirm, resolveKey, now: () => NOW });
  const page = async (query: string, k = key.key) =>
    answer<Page>(
      await getCancellationsRequest(
        apiRequest("GET", `/api/v1/cancellations${query}`, { key: k }),
        deps,
      ),
    );
  const put = async (ref: string, body: unknown) =>
    answer<{ result: string; session: { id: string } }>(
      await putSessionRequest(
        apiRequest("PUT", `/api/v1/sessions/${ref}`, { key: key.key, body }),
        ref,
        deps,
      ),
    );
  return { f, admin, key, page, put };
}

const SESSION = {
  site: { name: "Riverside Arena", postcode: "ZZ8 8HH" },
  role: "steward",
  starts_at: "2026-11-07T08:00:00Z",
  ends_at: "2026-11-07T16:00:00Z",
};

// `n` made-up casuals booked on a session, straight into the tables.
async function bookMany(firmId: string, shiftId: string, n: number): Promise<string[]> {
  const { rows } = await su.query<{ id: string }>(
    `with w as (
       insert into workers (firm_id, first_name, last_name, mobile_e164, roles, status)
       select $1, 'Casual' || g, 'Booker', '+4477009' || lpad(g::text, 5, '0'), array['steward'], 'active'
         from generate_series(1, $3::int) g
       returning id
     ), numbered as (select id, row_number() over (order by id) as slot from w)
     insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
     select $1, $2, slot, id, 'confirmed', $4 from numbered
     returning id::text as id`,
    [firmId, shiftId, n, new Date(NOW.getTime() - 100 * HOUR)],
  );
  return rows.map((r) => r.id);
}

describe("paging", () => {
  it("250 cancellations at one time come back exactly once across 3 pages, oldest first, 100 a page", async () => {
    const t = await plannerFirm();
    const created = await t.put("BIG-1", { ...SESSION, places: 250 });
    const bookings = await bookMany(t.f.firmId, created.body.session.id, 250);
    await su.query("update shifts set status = 'filled' where id = $1", [created.body.session.id]);
    const cancelled = await t.put("BIG-1", {
      status: "cancelled",
      change_reason: "event_cancelled",
    });
    expect(cancelled.body.result).toBe("cancelled");

    const first = await t.page("?since=2026-11-01T00:00:00Z");
    expect(first.status).toBe(200);
    expect(first.body.records).toHaveLength(100);
    expect(first.body.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const second = await t.page(`?cursor=${first.body.next_cursor}`);
    expect(second.body.records).toHaveLength(100);
    const third = await t.page(`?cursor=${second.body.next_cursor}`);
    expect(third.body.records).toHaveLength(50);
    expect(third.body.next_cursor).toBeNull();

    const seen = [...first.body.records, ...second.body.records, ...third.body.records].map(
      (r) => r.booking.id,
    );
    expect(new Set(seen).size).toBe(250);
    expect([...seen].sort()).toEqual([...bookings].sort());
    // One time for all of them: the booking id keeps the order.
    expect(seen).toEqual([...seen].sort());
    const times = new Set(
      [...first.body.records, ...third.body.records].map((r) => r.booking.cancellation?.at),
    );
    expect(times.size).toBe(1);
    // Starting again from since= gives the same records again (repeats are safe).
    expect(
      (await t.page("?since=2026-11-01T00:00:00Z")).body.records.map((r) => r.booking.id),
    ).toEqual(seen.slice(0, 100));
  });

  it("orders by cancellation time; since= includes that time; caught up is an empty page", async () => {
    const t = await plannerFirm();
    const created = await t.put("S-1", { ...SESSION, places: 3 });
    const [a = "", b = "", c = ""] = await bookMany(t.f.firmId, created.body.session.id, 3);
    const cancel = (id: string, hoursAgo: number) =>
      su.query(
        `update assignments set status = 'cancelled_firm', cancelled_at = $2, notice_hours = 50,
                cancel_reason = 'Weather or safety', cancel_via = 'office' where id = $1`,
        [id, new Date(NOW.getTime() - hoursAgo * HOUR)],
      );
    await cancel(a, 1);
    await cancel(b, 3);
    await cancel(c, 2);
    const all = await t.page("?since=2026-11-01T00:00:00Z");
    expect(all.body.records.map((r) => r.booking.id)).toEqual([b, c, a]);
    expect(all.body.next_cursor).toBeNull();
    const from = await t.page("?since=2026-11-02T07:00:00Z");
    expect(from.body.records.map((r) => r.booking.id)).toEqual([c, a]);
    expect((await t.page("?since=2026-11-02T09:00:00Z")).body).toEqual({
      records: [],
      next_cursor: null,
    });
  });

  it("since= or cursor=, else 400 bad_since or bad_cursor", async () => {
    const t = await plannerFirm();
    for (const [query, code] of [
      ["", "bad_since"],
      ["?since=last%20week", "bad_since"],
      ["?since=2026-11-01", "bad_since"],
      ["?cursor=not-a-cursor", "bad_cursor"],
    ] as const) {
      const r = await t.page(query);
      expect([r.status, r.body.error?.code]).toEqual([400, code]);
    }
  });

  it("a key reads its own firm's cancellations only", async () => {
    const a = await plannerFirm();
    const b = await plannerFirm();
    for (const t of [a, b]) {
      const created = await t.put("S-1", { ...SESSION, places: 2 });
      await bookMany(t.f.firmId, created.body.session.id, 2);
      await t.put("S-1", { status: "cancelled", change_reason: "weather" });
    }
    const pageA = await a.page("?since=2026-11-01T00:00:00Z");
    const pageB = await b.page("?since=2026-11-01T00:00:00Z");
    expect(pageA.body.records).toHaveLength(2);
    expect(pageB.body.records).toHaveLength(2);
    const idsB = new Set(pageB.body.records.map((r) => r.booking.id));
    expect(pageA.body.records.some((r) => idsB.has(r.booking.id))).toBe(false);
    // B's cursor with A's key: A's own records after that place, never B's.
    const fromB = await a.page(
      `?cursor=${Buffer.from(JSON.stringify({ t: "2026-11-01T00:00:00.000000Z", b: [...idsB][0] })).toString("base64url")}`,
    );
    expect(fromB.body.records.every((r) => !idsB.has(r.booking.id))).toBe(true);
  });
});

describe("each record", () => {
  it("is the webhook's data: who cancelled and how, the reason's code and the strike result, never typed words", async () => {
    const t = await plannerFirm();
    const created = await t.put("RACEDAY-STW-0710", {
      ...SESSION,
      event: { ref: "RACEDAY-2026", name: "Raceday" },
      places: 12,
      pay_rate_pence: 1260,
      post: "Gate B",
      requirements: ["STEWARD_L2"],
      instructions: "Ask for the steward lead.",
    });
    const shiftId = created.body.session.id;
    const ids = await bookMany(t.f.firmId, shiftId, 12);
    const at = new Date(NOW.getTime() - HOUR);
    const office = t.admin;
    // Each booking's story: who booked it (its shift.assigned entry), how it was cancelled, and
    // the strike result recorded with the cancellation (and a strike row when one was issued).
    const story = [
      {
        booked: "worker",
        status: "cancelled_worker",
        via: "app",
        reason: "I'm unwell",
        strike: "issued",
        row: "live",
      },
      {
        booked: null,
        status: "cancelled_worker",
        via: "app",
        reason: "Travel problem",
        strike: "booked_by_office",
      },
      {
        booked: "worker",
        status: "cancelled_worker",
        via: "app",
        reason: "Family or caring",
        strike: "rules_override",
      },
      {
        booked: "worker",
        status: "cancelled_worker",
        via: "app",
        reason: "Something else: my nan is ill",
        strike: "changed_after_booking",
      },
      {
        booked: "worker",
        status: "cancelled_worker",
        via: "app",
        reason: "I'm unwell",
        strike: "issued",
        row: "withdrawn",
      },
      {
        booked: "worker",
        status: "cancelled_worker",
        via: "app",
        reason: "Travel problem",
        strike: "enough_notice",
      },
      {
        booked: "firm",
        status: "cancelled_firm",
        via: "office",
        reason: "The client needs fewer staff",
        strike: "by_firm",
      },
      {
        booked: "sheet",
        status: "cancelled_firm",
        via: "sheet",
        reason: "Taken off the rota sheet",
        strike: "by_firm",
      },
      {
        booked: "firm",
        status: "cancelled_firm",
        via: "office",
        reason: "Called in, said he is ill",
        strike: "by_firm",
      },
      {
        booked: "worker",
        status: "cancelled_firm",
        via: "api",
        reason: "The event's times or place changed",
        strike: "by_firm",
      },
      {
        booked: "worker",
        status: "cancelled_worker",
        via: null,
        reason: "I'm unwell",
        strike: null,
      },
      {
        booked: "worker",
        status: "cancelled_worker",
        via: "app",
        reason: "Travel problem",
        strike: "issued",
        row: "live",
        erased: true,
      },
    ] as const;
    for (const [i, s] of story.entries()) {
      const id = ids[i] ?? "";
      const { rows } = await su.query<{ worker_id: string }>(
        `update assignments set status = $2, cancelled_at = $3, cancel_reason = $4,
                notice_hours = $5, cancel_via = $6
          where id = $1 returning worker_id::text`,
        [id, s.status, new Date(at.getTime() + i * 1000), s.reason, 10 + i, s.via],
      );
      const worker = rows[0]?.worker_id ?? "";
      if (s.booked) {
        await su.query(
          `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
           values ($1, 'system', 'shift.assigned', 'assignment', $2, $3)`,
          [
            t.f.firmId,
            id,
            JSON.stringify(
              s.booked === "sheet"
                ? { by: "firm", source: "sheets", shiftId, workerId: worker }
                : { by: s.booked, shiftId, workerId: worker },
            ),
          ],
        );
      }
      if (s.strike) {
        await su.query(
          `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
           values ($1, 'system', 'shift.cancelled', 'assignment', $2, $3)`,
          [
            t.f.firmId,
            id,
            JSON.stringify({ by: "worker", shiftId, workerId: worker, strike: s.strike }),
          ],
        );
      }
      if ("row" in s) {
        const withdrawn = s.row === "withdrawn";
        await su.query(
          `insert into strikes (firm_id, worker_id, assignment_id, shift_id, notice_hours,
                                threshold_hours, issued_at, expires_at, status, review_needed,
                                review_reasons, withdrawn_by, withdrawn_at, withdrawn_reason)
           values ($1, $2, $3, $4, 10, 48, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            t.f.firmId,
            worker,
            id,
            shiftId,
            at,
            new Date(NOW.getTime() + 90 * 24 * HOUR),
            s.row,
            s.reason === "I'm unwell",
            s.reason === "I'm unwell" ? ["unwell"] : [],
            withdrawn ? office : null,
            withdrawn ? at : null,
            withdrawn ? "Doctor's note: unwell" : null,
          ],
        );
      }
      if ("erased" in s) {
        await su.query(
          `update workers set erased_at = $2, mobile_e164 = null, email = null, external_ref = null,
                  first_name = 'Deleted', last_name = 'worker', status = 'inactive', roles = '{}'
            where id = $1`,
          [worker, at],
        );
      }
    }
    const page = await t.page("?since=2026-11-01T00:00:00Z");
    expect(page.status).toBe(200);
    const records = page.body.records;
    expect(records).toHaveLength(12);
    expect(records[0]?.session).toEqual({
      id: shiftId,
      ref: "RACEDAY-STW-0710",
      source: "api",
      event: { id: expect.any(String), ref: "RACEDAY-2026", name: "Raceday" },
      site: { name: "Riverside Arena", postcode: "ZZ8 8HH" },
      role: "steward",
      starts_at: "2026-11-07T08:00:00Z",
      ends_at: "2026-11-07T16:00:00Z",
      status: "open",
      places: 12,
      booked: 0,
      pay_rate_pence: 1260,
      post: "Gate B",
      meeting_point: null,
      uniform: null,
      requirements: ["STEWARD_L2"],
    });
    const shape = (b: BookingRecord) => ({
      booked_by: b.booked_by,
      status: b.status,
      erased: b.erased,
      casual: b.casual === null ? null : "named",
      ...b.cancellation,
      at: undefined,
    });
    expect(records.map((r) => shape(r.booking))).toEqual(
      [
        ["casual", "casual", "app", "casual_own_reason", { status: "issued", live_strikes: 1 }],
        [
          "office",
          "casual",
          "app",
          "casual_own_reason",
          { status: "exempt", exempt_reason: "booked_by_office", live_strikes: 0 },
        ],
        [
          "casual",
          "casual",
          "app",
          "casual_own_reason",
          { status: "exempt", exempt_reason: "rules_override", live_strikes: 0 },
        ],
        [
          "casual",
          "casual",
          "app",
          "casual_own_reason",
          { status: "exempt", exempt_reason: "office_changed_it", live_strikes: 0 },
        ],
        ["casual", "casual", "app", "casual_own_reason", { status: "withdrawn", live_strikes: 0 }],
        ["casual", "casual", "app", "casual_own_reason", { status: "none", live_strikes: 0 }],
        ["office", "office", "office", "fewer_staff", { status: "none", live_strikes: 0 }],
        ["sheet", "sheet", "sheet", "sheet_change", { status: "none", live_strikes: 0 }],
        ["office", "office", "office", "other", { status: "none", live_strikes: 0 }],
        ["casual", "planner", "api", "event_changed", { status: "none", live_strikes: 0 }],
        ["casual", "casual", null, "casual_own_reason", { status: "none", live_strikes: 0 }],
        ["casual", "casual", "app", "casual_own_reason", { status: "issued", live_strikes: 1 }],
      ].map(([bookedBy, by, via, reason, strike], i) => ({
        booked_by: bookedBy,
        status: "cancelled",
        erased: i === 11 ? true : undefined,
        casual: i === 11 ? null : "named",
        by,
        via,
        notice_hours: 10 + i,
        reason_code: reason,
        strike,
        at: undefined,
      })),
    );
    expect(records[0]?.booking.casual).toEqual({
      id: expect.any(String),
      staff_ref: null,
      first_name: expect.stringMatching(/^Casual\d+$/),
      last_name: "Booker",
    });
    expect(records[0]?.booking.cancellation?.at).toBe("2026-11-02T08:00:00Z");
    // One booking by its id, as a webhook's body is built: the same record.
    expect(
      await withFirm(t.f.firmId, (tx) => bookingWithSession(tx, records[6]?.booking.id ?? "", NOW)),
    ).toEqual(records[6]);
    // Nothing anyone typed, nothing about health, no phone number or address.
    const text = JSON.stringify(page.body);
    expect(text).not.toMatch(/unwell|health|ill\b|nan|Called in|Travel problem|Doctor|caring/i);
    expect(text).not.toMatch(/\+4477|@|instructions|Ask for/i);
  });
});
