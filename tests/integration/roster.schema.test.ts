import type { ClientBase, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRolePool, superuserPool } from "../helpers/db";
import { inFirm, pgError } from "../helpers/rls-probe";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// The rota tables' own rules (Phase 2 schema): what the database refuses even if app code gets it
// wrong. Isolation between firms is covered table by table in tenancy.isolation. Everything runs
// as shiftdesk_app inside the firm's transaction, exactly as withFirm does, and is rolled back.
// Each refusal sits next to a control that the same row, fixed, is accepted.

let su: Pool;
let app: Pool;
let T: Tenant;
let U: Tenant; // a second firm, for "unique per firm" checks

beforeAll(async () => {
  su = superuserPool();
  app = appRolePool();
  T = await createTenant(su);
  U = await createTenant(su);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

type PgFailure = { code: string; message: string };

// Runs one statement that must fail, inside a savepoint so the transaction carries on.
async function refused(c: ClientBase, text: string, values: unknown[] = []): Promise<PgFailure> {
  await c.query("savepoint probe");
  const err = await pgError(c.query(text, values));
  await c.query("rollback to savepoint probe");
  return err;
}

async function rowCount(c: ClientBase, text: string, values: unknown[] = []): Promise<number> {
  const result = await c.query(text, values);
  return result.rowCount ?? -1;
}

async function insertId(c: ClientBase, text: string, values: unknown[] = []): Promise<string> {
  const result = await c.query<{ id: string }>(`${text} returning id::text as id`, values);
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`insert returned no id: ${text}`);
  return id;
}

const check = (constraint: string) => ({
  code: "23514",
  message: expect.stringContaining(`"${constraint}"`),
});
const duplicate = (constraint: string) => ({
  code: "23505",
  message: expect.stringContaining(`"${constraint}"`),
});
const foreignKey = (constraint: string) => ({
  code: "23503",
  message: expect.stringContaining(`"${constraint}"`),
});

const inT = <R>(fn: (c: ClientBase) => Promise<R>) => inFirm(app, T.firmId, fn);

const START = "2026-11-07T09:00:00Z";
const END = "2026-11-07T17:00:00Z";

describe("shifts", () => {
  const insertShift =
    "insert into shifts (firm_id, event_id, role, starts_at, ends_at, headcount, status, source, external_ref) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)";
  const shift = (overrides: Partial<Record<string, unknown>> = {}) => {
    const v = {
      role: "steward",
      startsAt: START,
      endsAt: END,
      headcount: 1,
      status: "open",
      source: "native",
      externalRef: null,
      ...overrides,
    };
    return [
      T.firmId,
      T.rows.shift_events,
      v.role,
      v.startsAt,
      v.endsAt,
      v.headcount,
      v.status,
      v.source,
      v.externalRef,
    ];
  };

  it("accepts a valid shift (control)", async () => {
    expect(await inT((c) => rowCount(c, insertShift, shift()))).toBe(1);
  });

  it("must end after it starts", async () => {
    await inT(async (c) => {
      expect(await refused(c, insertShift, shift({ endsAt: START }))).toMatchObject(
        check("shifts_ends_after_start"),
      );
      expect(
        await refused(c, insertShift, shift({ endsAt: "2026-11-07T08:59:00Z" })),
      ).toMatchObject(check("shifts_ends_after_start"));
    });
  });

  it("needs a headcount from 1 to 1000", async () => {
    await inT(async (c) => {
      for (const headcount of [0, -1, 1001]) {
        expect(await refused(c, insertShift, shift({ headcount }))).toMatchObject(
          check("shifts_headcount_range"),
        );
      }
      expect(await rowCount(c, insertShift, shift({ headcount: 1000 }))).toBe(1);
    });
  });

  it("spells roles in snake_case, so they match credential_rules and workers.roles", async () => {
    await inT(async (c) => {
      for (const role of ["Door Supervisor", "door-supervisor", "Steward", "1st_aider", ""]) {
        expect(await refused(c, insertShift, shift({ role }))).toMatchObject(
          check("shifts_role_format"),
        );
      }
      expect(await rowCount(c, insertShift, shift({ role: "door_supervisor" }))).toBe(1);
    });
  });

  it("only accepts the known statuses and sources", async () => {
    await inT(async (c) => {
      expect(await refused(c, insertShift, shift({ status: "closed" }))).toMatchObject(
        check("shifts_status_check"),
      );
      expect(await refused(c, insertShift, shift({ source: "deputy" }))).toMatchObject(
        check("shifts_source_check"),
      );
    });
  });

  it("has one shift per sheet or import row in a firm; other sources and firms are separate", async () => {
    const ref = `row-${Date.now()}`;
    await su.query(
      "insert into shifts (firm_id, event_id, role, starts_at, ends_at, source, external_ref) values ($1, $2, 'steward', $3, $4, 'sheets', $5)",
      [T.firmId, T.rows.shift_events, START, END, ref],
    );
    await inT(async (c) => {
      expect(
        await refused(c, insertShift, shift({ source: "sheets", externalRef: ref })),
      ).toMatchObject(duplicate("shifts_firm_id_source_external_ref_key"));
      expect(await rowCount(c, insertShift, shift({ source: "csv", externalRef: ref }))).toBe(1);
      // Native shifts have no external ref; any number of them may exist.
      expect(await rowCount(c, insertShift, shift())).toBe(1);
      expect(await rowCount(c, insertShift, shift())).toBe(1);
    });
    const inU = await inFirm(app, U.firmId, (c) =>
      rowCount(
        c,
        "insert into shifts (firm_id, event_id, role, starts_at, ends_at, source, external_ref) values ($1, $2, 'steward', $3, $4, 'sheets', $5)",
        [U.firmId, U.rows.shift_events, START, END, ref],
      ),
    );
    expect(inU).toBe(1);
  });
});

describe("events and a session's own details (12B.1)", () => {
  const detail = (columns: string, values: unknown[]): [string, unknown[]] => [
    `insert into shifts (firm_id, event_id, role, starts_at, ends_at, ${columns})
     values ($1, $2, 'steward', $3, $4, ${values.map((_, i) => `$${i + 5}`).join(", ")})`,
    [T.firmId, T.rows.shift_events, START, END, ...values],
  ];

  it("refuses a shift with no event", async () => {
    await inT(async (c) => {
      expect(
        await refused(
          c,
          "insert into shifts (firm_id, role, starts_at, ends_at) values ($1, 'steward', $2, $3)",
          [T.firmId, START, END],
        ),
      ).toMatchObject({ code: "23502", message: expect.stringContaining('"event_id"') });
    });
  });

  it("keeps one automatic event per firm, site and day; named events may share a name", async () => {
    const key = `auto:none:2026-11-${String(10 + (Date.now() % 10)).padStart(2, "0")}`;
    const event = "insert into shift_events (firm_id, name, planner_ref) values ($1, $2, $3)";
    await inT(async (c) => {
      expect(await rowCount(c, event, [T.firmId, "Sat 14 Nov", key])).toBe(1);
      expect(await refused(c, event, [T.firmId, "Sat 14 Nov", key])).toMatchObject(
        duplicate("shift_events_auto_key"),
      );
      expect(await rowCount(c, event, [T.firmId, "The final", null])).toBe(1);
      expect(await rowCount(c, event, [T.firmId, "The final", null])).toBe(1);
    });
    // Another firm's automatic event with the same key is its own.
    expect(
      await inFirm(app, U.firmId, (c) => rowCount(c, event, [U.firmId, "Sat 14 Nov", key])),
    ).toBe(1);
  });

  it("names an event with 1 to 200 characters", async () => {
    const event = "insert into shift_events (firm_id, name) values ($1, $2)";
    await inT(async (c) => {
      for (const name of ["", "x".repeat(201)]) {
        expect(await refused(c, event, [T.firmId, name])).toMatchObject(
          check("shift_events_name_length"),
        );
      }
      expect(await rowCount(c, event, [T.firmId, "x".repeat(200)])).toBe(1);
    });
  });

  it("holds pay in whole pence, never below 0", async () => {
    await inT(async (c) => {
      expect(await refused(c, ...detail("pay_rate_pence", [-1]))).toMatchObject(
        check("shifts_pay_rate_range"),
      );
      expect(await refused(c, ...detail("pay_rate_pence", [12.5]))).toMatchObject({
        code: "22P02",
      });
      expect(await rowCount(c, ...detail("pay_rate_pence", [1250]))).toBe(1);
      expect(await rowCount(c, ...detail("pay_rate_pence", [0]))).toBe(1);
    });
  });

  it("limits the post to 200 characters, the meeting point and uniform to 300", async () => {
    await inT(async (c) => {
      const cases: [string, number, string][] = [
        ["post", 200, "shifts_post_length"],
        ["meeting_point", 300, "shifts_meeting_point_length"],
        ["uniform", 300, "shifts_uniform_length"],
      ];
      for (const [column, max, constraint] of cases) {
        for (const value of ["", "x".repeat(max + 1)]) {
          expect(await refused(c, ...detail(column, [value]))).toMatchObject(check(constraint));
        }
        expect(await rowCount(c, ...detail(column, ["x".repeat(max)]))).toBe(1);
      }
    });
  });

  it("holds requirements as at most 20 qualification codes", async () => {
    await inT(async (c) => {
      const bad = [
        ["first_aid"],
        [""],
        ["FIRST_AID", null],
        ["A,B"],
        Array.from({ length: 21 }, (_, i) => `CODE_${i}`),
      ];
      for (const codes of bad) {
        expect(await refused(c, ...detail("required_credentials", [codes]))).toMatchObject(
          check("shifts_required_credentials_format"),
        );
      }
      expect(await rowCount(c, ...detail("required_credentials", [["FIRST_AID", "SIA_DS"]]))).toBe(
        1,
      );
      const twenty = Array.from({ length: 20 }, (_, i) => `CODE_${i}`);
      expect(await rowCount(c, ...detail("required_credentials", [twenty]))).toBe(1);
    });
  });

  it("shows events and sessions to casuals by default; no requirements by default", async () => {
    await inT(async (c) => {
      const id = await insertId(c, ...detail("post", ["Gate A"]));
      const { rows } = await c.query(
        `select s.showing_to_casuals as session, e.showing_to_casuals as event,
                s.required_credentials as requirements
           from shifts s join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
          where s.id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ session: true, event: true, requirements: [] });
    });
  });
});

describe("assignments", () => {
  const insertSlot = `insert into assignments
    (firm_id, shift_id, slot, worker_id, status, offered_at, confirmed_at, cancelled_at, cancel_reason, notice_hours)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
  const slot = (overrides: Partial<Record<string, unknown>> = {}) => {
    const v = {
      slot: 2,
      workerId: null,
      status: "open",
      offeredAt: null,
      confirmedAt: null,
      cancelledAt: null,
      cancelReason: null,
      noticeHours: null,
      ...overrides,
    };
    return [
      T.firmId,
      T.rows.shifts,
      v.slot,
      v.workerId,
      v.status,
      v.offeredAt,
      v.confirmedAt,
      v.cancelledAt,
      v.cancelReason,
      v.noticeHours,
    ];
  };
  const now = new Date().toISOString();
  const cancelFixture = (c: ClientBase) =>
    rowCount(
      c,
      `update assignments set status = 'cancelled_worker', cancelled_at = now(),
         cancel_reason = 'Unwell', notice_hours = 20.5 where id = $1`,
      [T.rows.assignments],
    );

  it("an open slot has no worker, and every other state has one", async () => {
    await inT(async (c) => {
      expect(await refused(c, insertSlot, slot({ workerId: T.workerId }))).toMatchObject(
        check("assignments_worker_matches_status"),
      );
      expect(
        await refused(c, insertSlot, slot({ status: "confirmed", confirmedAt: now })),
      ).toMatchObject(check("assignments_worker_matches_status"));
      expect(await rowCount(c, insertSlot, slot())).toBe(1);
    });
  });

  it("slots count from 1", async () => {
    await inT(async (c) => {
      expect(await refused(c, insertSlot, slot({ slot: 0 }))).toMatchObject(
        check("assignments_slot_positive"),
      );
    });
  });

  it("an offer to one worker records when; a confirmed, no-show or completed slot records when it was confirmed", async () => {
    await inT(async (c) => {
      expect(
        await refused(c, insertSlot, slot({ status: "offered", workerId: T.workerId })),
      ).toMatchObject(check("assignments_offered_at_set"));
      for (const status of ["confirmed", "no_show", "completed"]) {
        expect(await refused(c, insertSlot, slot({ status, workerId: T.workerId }))).toMatchObject(
          check("assignments_confirmed_at_set"),
        );
      }
      expect(
        await rowCount(
          c,
          insertSlot,
          slot({ status: "offered", workerId: T.workerId, offeredAt: now }),
        ),
      ).toBe(1);
    });
  });

  it("a cancellation by the worker or the firm records when, a reason and the notice hours (golden rule 12)", async () => {
    const cancelled = (status: string, o: Partial<Record<string, unknown>>) =>
      slot({
        status,
        workerId: T.workerId,
        confirmedAt: now,
        cancelledAt: now,
        cancelReason: "Venue closed",
        noticeHours: 36,
        ...o,
      });
    await inT(async (c) => {
      for (const status of ["cancelled_worker", "cancelled_firm"]) {
        for (const missing of [
          { cancelledAt: null },
          { cancelReason: null },
          { cancelReason: "   " },
          { noticeHours: null },
        ]) {
          expect(await refused(c, insertSlot, cancelled(status, missing))).toMatchObject(
            check("assignments_cancel_evidence"),
          );
        }
      }
      // Complete evidence is accepted, including negative notice (cancelled after the start).
      expect(await rowCount(c, insertSlot, cancelled("cancelled_firm", {}))).toBe(1);
      expect(
        await rowCount(c, insertSlot, cancelled("cancelled_worker", { noticeHours: -1.25 })),
      ).toBe(1);
      const stored = await c.query<{ notice_hours: string }>(
        // This test's own rows (the fixture's cancelled booking, with a strike, has another reason).
        `select notice_hours::text from assignments
          where shift_id = $1 and status = 'cancelled_worker' and cancel_reason = 'Venue closed'`,
        [T.rows.shifts],
      );
      expect(stored.rows.map((r) => r.notice_hours)).toEqual(["-1.25"]);
    });
  });

  it("only one live holder per slot; a cancelled row stays and a new open row reopens the slot", async () => {
    await inT(async (c) => {
      // The fixture's slot 1 is confirmed for the rota worker.
      expect(await refused(c, insertSlot, slot({ slot: 1 }))).toMatchObject(
        duplicate("assignments_one_live_per_slot"),
      );
      expect(await cancelFixture(c)).toBe(1);
      expect(await rowCount(c, insertSlot, slot({ slot: 1 }))).toBe(1);
      const rows = await c.query<{ status: string; worker: boolean }>(
        `select status, worker_id is not null as worker from assignments
          where shift_id = $1 and slot = 1 order by created_at, status`,
        [T.rows.shifts],
      );
      expect(rows.rows).toEqual(
        expect.arrayContaining([
          { status: "cancelled_worker", worker: true },
          { status: "open", worker: false },
        ]),
      );
      expect(rows.rows).toHaveLength(2);
      // A second live row for the reopened slot is refused again.
      expect(await refused(c, insertSlot, slot({ slot: 1 }))).toMatchObject(
        duplicate("assignments_one_live_per_slot"),
      );
    });
  });

  it("one worker can't hold two live slots on the same shift, but can come back after cancelling", async () => {
    const second = slot({ status: "confirmed", workerId: T.rosterWorkerId, confirmedAt: now });
    await inT(async (c) => {
      expect(await refused(c, insertSlot, second)).toMatchObject(
        duplicate("assignments_one_live_per_worker"),
      );
      expect(await cancelFixture(c)).toBe(1);
      expect(await rowCount(c, insertSlot, second)).toBe(1);
    });
  });

  // The statement documented in roster.ts and docs/data-model.md.
  const take = (c: ClientBase, workerId: string, slotId: string) =>
    rowCount(
      c,
      `update assignments a set worker_id = $1, status = 'confirmed', confirmed_at = now()
         from shifts s
        where a.id = $2 and a.worker_id is null
          and s.firm_id = a.firm_id and s.id = a.shift_id and s.status = 'open'`,
      [workerId, slotId],
    );

  it("first yes wins: the conditional update fills an open slot once, and a second taker changes nothing", async () => {
    await inT(async (c) => {
      const openId = await insertId(c, insertSlot, slot());
      expect(await take(c, T.workerId, openId)).toBe(1);
      expect(await take(c, T.rosterWorkerId, openId)).toBe(0);
      const holder = await c.query<{ worker_id: string }>(
        "select worker_id::text from assignments where id = $1",
        [openId],
      );
      expect(holder.rows[0]?.worker_id).toBe(T.workerId);
    });
  });

  it("first yes wins only while the shift is open: a draft, filled or cancelled shift's open slot can't be taken", async () => {
    await inT(async (c) => {
      const openId = await insertId(c, insertSlot, slot());
      for (const status of ["draft", "filled", "cancelled"]) {
        await c.query("update shifts set status = $1 where id = $2", [status, T.rows.shifts]);
        expect(await take(c, T.workerId, openId)).toBe(0);
      }
      await c.query("update shifts set status = 'open' where id = $1", [T.rows.shifts]);
      expect(await take(c, T.workerId, openId)).toBe(1);
    });
  });
});

describe("requests", () => {
  const insertRequest = `insert into requests
    (firm_id, worker_id, shift_id, type, payload, status, resolved_by, resolved_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8)`;
  const request = (overrides: Partial<Record<string, unknown>> = {}) => {
    const v = {
      shiftId: null,
      type: "general",
      payload: "{}",
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      ...overrides,
    };
    return [
      T.firmId,
      T.rosterWorkerId,
      v.shiftId,
      v.type,
      v.payload,
      v.status,
      v.resolvedBy,
      v.resolvedAt,
    ];
  };
  const now = new Date().toISOString();

  it("a time change, swap or review names its shift; availability and general asks needn't", async () => {
    await inT(async (c) => {
      for (const type of ["time_change", "swap", "review"]) {
        expect(await refused(c, insertRequest, request({ type }))).toMatchObject(
          check("requests_shift_required"),
        );
        expect(await rowCount(c, insertRequest, request({ type, shiftId: T.rows.shifts }))).toBe(1);
      }
      for (const type of ["availability", "general"]) {
        expect(await rowCount(c, insertRequest, request({ type }))).toBe(1);
      }
      expect(await refused(c, insertRequest, request({ type: "complaint" }))).toMatchObject(
        check("requests_type_check"),
      );
    });
  });

  it("an office decision records who and when; an unresolved request records neither", async () => {
    await inT(async (c) => {
      for (const status of ["approved", "declined"]) {
        expect(await refused(c, insertRequest, request({ status, resolvedAt: now }))).toMatchObject(
          check("requests_resolution"),
        );
        expect(
          await refused(c, insertRequest, request({ status, resolvedBy: T.officeUserId })),
        ).toMatchObject(check("requests_resolution"));
        expect(
          await rowCount(
            c,
            insertRequest,
            request({ status, resolvedBy: T.officeUserId, resolvedAt: now }),
          ),
        ).toBe(1);
      }
      for (const status of ["open", "escalated"]) {
        expect(await refused(c, insertRequest, request({ status, resolvedAt: now }))).toMatchObject(
          check("requests_resolution"),
        );
        expect(
          await refused(c, insertRequest, request({ status, resolvedBy: T.officeUserId })),
        ).toMatchObject(check("requests_resolution"));
      }
      // Resolved by the system: a time, no office user.
      expect(await refused(c, insertRequest, request({ status: "auto_resolved" }))).toMatchObject(
        check("requests_resolution"),
      );
      expect(
        await rowCount(c, insertRequest, request({ status: "auto_resolved", resolvedAt: now })),
      ).toBe(1);
      // An unknown status breaks two rules; Postgres names the first check by name.
      expect(await refused(c, insertRequest, request({ status: "closed" }))).toMatchObject({
        code: "23514",
        message: expect.stringMatching(/"requests_(resolution|status_check)"/),
      });
      const def = await c.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'requests_status_check'",
      );
      expect(def.rows[0]?.def).toContain(
        "ARRAY['open'::text, 'approved'::text, 'declined'::text, 'auto_resolved'::text, 'escalated'::text]",
      );
    });
  });

  it("the payload is a JSON object", async () => {
    await inT(async (c) => {
      for (const payload of ["[]", '"text"', "3", "null"]) {
        expect(await refused(c, insertRequest, request({ payload }))).toMatchObject(
          check("requests_payload_object"),
        );
      }
      expect(
        await rowCount(c, insertRequest, request({ payload: '{"note":"Can I start at 10?"}' })),
      ).toBe(1);
    });
  });
});

describe("offers", () => {
  const insertOffer = `insert into offers (firm_id, shift_id, worker_id, wave, channel, responded_at, response)
    values ($1, $2, $3, $4, $5, $6, $7)`;
  const offer = (overrides: Partial<Record<string, unknown>> = {}) => {
    const v = {
      workerId: T.workerId,
      wave: 1,
      channel: "push",
      respondedAt: null,
      response: null,
      ...overrides,
    };
    return [T.firmId, T.rows.shifts, v.workerId, v.wave, v.channel, v.respondedAt, v.response];
  };
  const now = new Date().toISOString();

  it("one offer per worker per wave, so a retried wave job can't send twice; a later wave can", async () => {
    await inT(async (c) => {
      // The fixture offered the shift to the rota worker in wave 1.
      expect(await refused(c, insertOffer, offer({ workerId: T.rosterWorkerId }))).toMatchObject(
        duplicate("offers_firm_id_shift_id_worker_id_wave_key"),
      );
      expect(
        await refused(c, insertOffer, offer({ workerId: T.rosterWorkerId, channel: "sms" })),
      ).toMatchObject(duplicate("offers_firm_id_shift_id_worker_id_wave_key"));
      expect(await rowCount(c, insertOffer, offer({ workerId: T.rosterWorkerId, wave: 2 }))).toBe(
        1,
      );
    });
  });

  it("a response always comes with the time it was given", async () => {
    await inT(async (c) => {
      expect(await refused(c, insertOffer, offer({ response: "accepted" }))).toMatchObject(
        check("offers_response_has_time"),
      );
      expect(await refused(c, insertOffer, offer({ respondedAt: now }))).toMatchObject(
        check("offers_response_has_time"),
      );
      expect(
        await refused(c, insertOffer, offer({ respondedAt: now, response: "maybe" })),
      ).toMatchObject(check("offers_response_check"));
      expect(
        await rowCount(c, insertOffer, offer({ respondedAt: now, response: "declined" })),
      ).toBe(1);
    });
  });

  it("waves count from 1 and channels are push, whatsapp or sms", async () => {
    await inT(async (c) => {
      expect(await refused(c, insertOffer, offer({ wave: 0 }))).toMatchObject(
        check("offers_wave_positive"),
      );
      expect(await refused(c, insertOffer, offer({ channel: "email" }))).toMatchObject(
        check("offers_channel_check"),
      );
    });
  });
});

describe("credential_rules", () => {
  const insertRule =
    "insert into credential_rules (firm_id, sector, role, required_types) values ($1, $2, $3, $4)";

  it("required types are credential type codes, with no blanks", async () => {
    await inT(async (c) => {
      for (const types of [
        "{sia_ds}",
        "{NULL}",
        "{SIA_DS,NULL}",
        "{SIA-DS}",
        '{""}',
        '{SIA_DS,""}',
        "{SIA_DS,cscs}",
        '{"SIA_DS,SIA_SG"}',
        "{{SIA_DS},{PTS}}",
      ]) {
        expect(
          await refused(c, insertRule, [T.firmId, "security", "steward", types]),
        ).toMatchObject(check("credential_rules_required_types_format"));
      }
      expect(
        await rowCount(c, insertRule, [
          T.firmId,
          "rail",
          "track_operative",
          "{PTS,SENTINEL,RAIL_DA}",
        ]),
      ).toBe(1);
      // A role that explicitly needs no credential.
      expect(await rowCount(c, insertRule, [T.firmId, "cleaning", "cleaner", "{}"])).toBe(1);
    });
  });

  it("belongs to one of the four sector packs and spells its role in snake_case", async () => {
    await inT(async (c) => {
      expect(
        await refused(c, insertRule, [T.firmId, "retail", "steward", "{STEWARD_L2}"]),
      ).toMatchObject(check("credential_rules_sector_check"));
      expect(
        await refused(c, insertRule, [T.firmId, "security", "Steward", "{STEWARD_L2}"]),
      ).toMatchObject(check("credential_rules_role_format"));
    });
  });

  it("one rule per role in a firm; another firm has its own", async () => {
    // Every tenant fixture has a door_supervisor rule.
    await inT(async (c) => {
      expect(
        await refused(c, insertRule, [
          T.firmId,
          "security",
          "door_supervisor",
          "{SIA_DS,FIRST_AID}",
        ]),
      ).toMatchObject(duplicate("credential_rules_firm_id_role_key"));
    });
    const counts = await su.query<{ n: number }>(
      "select count(*)::int as n from credential_rules where role = 'door_supervisor' and firm_id = any($1::uuid[])",
      [[T.firmId, U.firmId]],
    );
    expect(counts.rows[0]?.n).toBe(2);
  });
});

// Postgres checks unique indexes before foreign keys. If a unique key didn't start with firm_id,
// Firm A could point a row at Firm B's shift and learn from a duplicate-key error (instead of a
// foreign-key error) that Firm B's slot is filled or its worker already offered. Each probe runs
// in Firm U against Firm T's live rows, next to a control in T that hits the unique key.
describe("unique keys never reveal another firm's rows", () => {
  const probes: [string, string, string, (f: Tenant) => unknown[]][] = [
    [
      "a filled slot",
      "assignments_one_live_per_slot",
      "insert into assignments (firm_id, shift_id, slot) values ($1, $2, 1)",
      (f) => [f.firmId, T.rows.shifts],
    ],
    [
      "a worker already on the shift",
      "assignments_one_live_per_worker",
      `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
       values ($1, $2, 99, $3, 'confirmed', now())`,
      (f) => [f.firmId, T.rows.shifts, T.rosterWorkerId],
    ],
    [
      "an offer already sent in wave 1",
      "offers_firm_id_shift_id_worker_id_wave_key",
      "insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, 1, 'push')",
      (f) => [f.firmId, T.rows.shifts, T.rosterWorkerId],
    ],
  ];

  it.each(probes)(
    "%s: Firm T itself gets the duplicate-key error (control)",
    async (_l, key, text, values) => {
      await inT(async (c) => {
        expect(await refused(c, text, values(T))).toMatchObject(duplicate(key));
      });
    },
  );

  it.each(probes)(
    "%s: another firm gets only a foreign-key error",
    async (_l, _key, text, values) => {
      const err = await inFirm(app, U.firmId, (c) => refused(c, text, values(U)));
      expect(err).toMatchObject({
        code: "23503",
        message: expect.stringMatching(/"(assignments|offers)_(shift|worker)_fk"/),
      });
    },
  );
});

// Foreign keys from the rota have no ON DELETE action: removing what history points at fails.
describe("deletes that would erase or orphan rota history", () => {
  // The first number in Ofcom's drama range (+447700900000-999) this firm isn't using yet.
  const newWorker = (c: ClientBase) =>
    insertId(
      c,
      `insert into workers (firm_id, first_name, last_name, mobile_e164)
       select $1, 'Del', 'Probe', m from generate_series(0, 999) n,
              lateral (select '+447700900' || lpad(n::text, 3, '0') as m) x
        where not exists (select 1 from workers w where w.mobile_e164 = x.m)
        order by n limit 1`,
      [T.firmId],
    );
  const deleteWorker = (c: ClientBase, id: string) =>
    rowCount(c, "delete from workers where id = $1", [id]);

  it("a worker with no rota rows can be deleted (control)", async () => {
    await inT(async (c) => {
      expect(await deleteWorker(c, await newWorker(c))).toBe(1);
    });
  });

  it.each([
    [
      "an assignment",
      "assignments_worker_fk",
      `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
       values ($1, $2, 9, $3, 'confirmed', now())`,
    ],
    [
      "a request",
      "requests_worker_fk",
      "insert into requests (firm_id, shift_id, worker_id, type) values ($1, $2, $3, 'swap')",
    ],
    [
      "an offer",
      "offers_worker_fk",
      "insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, 1, 'push')",
    ],
    [
      "a pay record",
      "pay_records_worker_fk",
      `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence)
       select $1, $3, '2026-10-26', '2026-11-01', 8, 1250 where $2::uuid is not null`,
    ],
  ])("a worker with %s can't be deleted", async (_label, fk, attach) => {
    await inT(async (c) => {
      const workerId = await newWorker(c);
      await c.query(attach, [T.firmId, T.rows.shifts, workerId]);
      expect(await refused(c, "delete from workers where id = $1", [workerId])).toMatchObject(
        foreignKey(fk),
      );
    });
  });

  it("a site with shifts can't be deleted (control: an unused site can)", async () => {
    await inT(async (c) => {
      expect(await refused(c, "delete from sites where id = $1", [T.rosterSiteId])).toMatchObject(
        foreignKey("shifts_site_fk"),
      );
      expect(await rowCount(c, "delete from sites where id = $1", [T.rows.sites])).toBe(1);
    });
  });

  it("an office user who decided a request can't be deleted", async () => {
    await inT(async (c) => {
      await c.query(
        `update requests set status = 'approved', resolved_by = $1, resolved_at = now()
          where id = $2`,
        [T.officeUserId, T.rows.requests],
      );
      expect(
        await refused(c, "delete from office_users where id = $1", [T.officeUserId]),
      ).toMatchObject(foreignKey("requests_resolved_by_fk"));
    });
  });

  it.each(["shifts", "assignments", "requests", "offers"] as const)(
    "the app can't delete %s rows at all, even its own firm's",
    async (table) => {
      await inT(async (c) => {
        const err = await refused(c, `delete from ${table} where id = $1`, [T.rows[table]]);
        expect(err).toMatchObject({
          code: "42501",
          message: expect.stringMatching(/permission denied/),
        });
      });
    },
  );
});
