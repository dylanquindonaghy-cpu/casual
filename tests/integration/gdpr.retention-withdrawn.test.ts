import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { CLOSED_REQUEST_STATUSES, purgeExpired } from "@/lib/gdpr/retention";
import { appRolePool, superuserPool } from "../helpers/db";
import { createTenant } from "../helpers/tenant-rows";

// The retention purge (src/lib/gdpr/retention.ts) and a request the worker took back (Phase 28.2:
// status withdrawn): closed like an answered one, so its typed words go
// retention.request_note_days after it closed (resolved_at), and the request itself stays.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool();
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([app.end(), su.end()]);
});

const DAY = 24 * 60 * 60 * 1000;

describe("a withdrawn request's words", () => {
  it("withdrawn is one of the closed statuses", () => {
    expect(CLOSED_REQUEST_STATUSES).toContain("withdrawn");
  });

  it("go retention.request_note_days after it was taken back; a newer one keeps them", async () => {
    const t = await createTenant(su);
    await su.query(
      "update firms set settings = jsonb_build_object('retention', $2::jsonb) where id = $1",
      [t.firmId, JSON.stringify({ request_note_days: 30 })],
    );
    const now = new Date();
    const withdrawn = async (closedDaysAgo: number, type = "general") => {
      const { rows } = await su.query<{ id: string }>(
        `insert into requests (firm_id, worker_id, shift_id, type, status, resolved_at, payload)
         values ($1, $2, $3, $4, 'withdrawn', $5, $6) returning id::text as id`,
        [
          t.firmId,
          t.rosterWorkerId,
          t.rows.shifts,
          type,
          new Date(now.getTime() - closedDaysAgo * DAY),
          JSON.stringify(
            type === "attendance"
              ? { said: "worked", note: "I was on the north gate." }
              : { note: "Can I park on site?" },
          ),
        ],
      );
      return rows[0]?.id ?? "";
    };
    const goes = await withdrawn(31);
    const attendanceGoes = await withdrawn(31, "attendance");
    const stays = await withdrawn(29);

    const counts = await withFirm(t.firmId, (tx) => purgeExpired(tx, now));
    expect(counts.requestNotes).toBe(2);
    const { rows } = await su.query<{ id: string; status: string; payload: unknown }>(
      "select id::text as id, status, payload from requests where id = any($1::uuid[])",
      [[goes, attendanceGoes, stays]],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(goes)).toMatchObject({ status: "withdrawn", payload: {} });
    // What she said (a code) stays with the request; her note goes.
    expect(byId.get(attendanceGoes)).toMatchObject({
      status: "withdrawn",
      payload: { said: "worked" },
    });
    expect(byId.get(stays)).toMatchObject({ payload: { note: "Can I park on site?" } });

    // Running it again takes nothing more.
    expect((await withFirm(t.firmId, (tx) => purgeExpired(tx, now))).requestNotes).toBe(0);
  });
});
