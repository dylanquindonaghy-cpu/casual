import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuserPool } from "../helpers/db";

// The indexes a big firm's lists need (PLAN.md P4.1): about 2,000 casuals and 110 events a
// fortnight. Each one starts with firm_id, like every other, so a firm's rows are read on their own.

let su: Pool;

beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

const BIG_FIRM_INDEXES = {
  shifts_firm_id_event_id_idx: "shifts (firm_id, event_id)",
  shifts_firm_id_ends_at_idx: "shifts (firm_id, ends_at)",
  assignments_firm_id_cancelled_at_idx: "assignments (firm_id, cancelled_at)",
  offers_firm_id_sent_at_idx: "offers (firm_id, sent_at)",
  events_firm_id_action_created_at_idx: "events (firm_id, action, created_at)",
};

describe("a big firm's indexes (P4.1)", () => {
  it("each is there, on its table and columns, in that order", async () => {
    const { rows } = await su.query<{ indexname: string; tablename: string; indexdef: string }>(
      `select indexname, tablename, indexdef from pg_indexes
        where schemaname = 'public' and indexname = any($1)
        order by indexname`,
      [Object.keys(BIG_FIRM_INDEXES)],
    );
    const found = Object.fromEntries(
      rows.map((r) => [
        r.indexname,
        `${r.tablename} ${r.indexdef.replace(/^.* USING btree /, "")}`,
      ]),
    );
    expect(found).toEqual(BIG_FIRM_INDEXES);
  });

  it("none is unique: they only speed up reads, never refuse a row", async () => {
    const { rows } = await su.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname = any($1)`,
      [Object.keys(BIG_FIRM_INDEXES)],
    );
    expect(rows).toHaveLength(Object.keys(BIG_FIRM_INDEXES).length);
    for (const r of rows) expect(r.indexdef).not.toMatch(/UNIQUE/);
  });
});
