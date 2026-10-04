import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import {
  connectSheet,
  disableSheet,
  forgetSheet,
  showSheet,
  spreadsheetIdFrom,
} from "../../scripts/firm-sheet-owner";
import { appRolePool, superuserPool, uniqueSlug, urls } from "../helpers/db";
import { inFirm, pgError } from "../helpers/rls-probe";

// A firm's Google Sheet is bound to that firm (audit L45). Every firm shares its sheet with the
// same service account, so the spreadsheet id is all that ties a sheet to a firm: only the owner
// connects one (`npm run firm:sheet`), one spreadsheet belongs to one firm only, and the app role
// can change nothing but the sync's status columns.

let su: Pool;
let app: Pool;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool();
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const newSheetId = () => `test_${randomBytes(30).toString("base64url")}`.slice(0, 44);

async function newFirm(): Promise<{ slug: string; firmId: string }> {
  const slug = uniqueSlug("sh");
  const { rows } = await su.query<{ id: string }>(
    "insert into firms (name, slug, sector) values ($1, $2, 'security') returning id::text as id",
    [`Sheet Test ${slug}`, slug],
  );
  return { slug, firmId: rows[0]?.id ?? "" };
}

const sourcesOf = async (firmId: string) =>
  (
    await su.query<{ spreadsheet_id: string; enabled: boolean }>(
      "select spreadsheet_id, enabled from roster_sources where firm_id = $1 order by created_at, id",
      [firmId],
    )
  ).rows;

const eventsOf = async (firmId: string) =>
  (
    await su.query<{ action: string; data: Record<string, unknown> }>(
      "select action, data from events where firm_id = $1 and action like 'roster.source_%' order by id",
      [firmId],
    )
  ).rows;

describe("spreadsheetIdFrom", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEF";
  it.each([
    [`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`, id],
    [`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`, id],
    [`https://docs.google.com/spreadsheets/d/${id}`, id],
    [`  ${id}  `, id],
    ["https://example.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit", null],
    ["not an id", null],
    ["short_id", null],
  ])("%s", (input, expected) => {
    expect(spreadsheetIdFrom(input)).toBe(expected);
  });
});

describe("npm run firm:sheet (as the owner)", () => {
  it("connects a firm's sheet with the default columns, logged without the sheet's id", async () => {
    const f = await newFirm();
    const sheet = newSheetId();
    expect(
      await connectSheet(urls.admin, f.slug, { spreadsheetId: sheet, replace: false }),
    ).toEqual({ status: "connected", replaced: false });
    expect(await sourcesOf(f.firmId)).toEqual([{ spreadsheet_id: sheet, enabled: true }]);
    const { rows } = await su.query<{ mapping: unknown }>(
      "select mapping from roster_sources where firm_id = $1",
      [f.firmId],
    );
    expect(rows[0]?.mapping).toEqual(DEFAULT_SHEET_MAPPING);
    const events = await eventsOf(f.firmId);
    expect(events).toEqual([
      { action: "roster.source_connected", data: { replaced: false, defaultMapping: true } },
    ]);
    expect(JSON.stringify(events)).not.toContain(sheet);
    // Again, the same: nothing changes, nothing logged.
    expect(
      await connectSheet(urls.admin, f.slug, { spreadsheetId: sheet, replace: false }),
    ).toEqual({ status: "unchanged" });
    expect(await eventsOf(f.firmId)).toHaveLength(1);
    const shown = await showSheet(urls.admin, f.slug);
    expect(shown).toMatchObject({
      status: "ok",
      source: { spreadsheetId: sheet, enabled: true, defaultMapping: true, lastErrorCode: null },
    });
  });

  it("a sheet another firm has can't be connected, whoever asks; nothing is changed", async () => {
    const a = await newFirm();
    const b = await newFirm();
    const sheet = newSheetId();
    await connectSheet(urls.admin, a.slug, { spreadsheetId: sheet, replace: false });
    const bOwn = newSheetId();
    await connectSheet(urls.admin, b.slug, { spreadsheetId: bOwn, replace: false });
    // Even with --replace: B keeps its own sheet, on.
    expect(await connectSheet(urls.admin, b.slug, { spreadsheetId: sheet, replace: true })).toEqual(
      {
        status: "taken",
      },
    );
    expect(await sourcesOf(b.firmId)).toEqual([{ spreadsheet_id: bOwn, enabled: true }]);
    expect(await eventsOf(b.firmId)).toHaveLength(1);
    // Switched off at A, it's still A's.
    await disableSheet(urls.admin, a.slug);
    expect(await connectSheet(urls.admin, b.slug, { spreadsheetId: sheet, replace: true })).toEqual(
      {
        status: "taken",
      },
    );
    // The index holds for any connection, not just this script.
    const err = await pgError(
      su.query(
        "insert into roster_sources (firm_id, kind, enabled, spreadsheet_id, mapping) values ($1, 'sheets', false, $2, '{}')",
        [b.firmId, sheet],
      ),
    );
    expect(err).toMatchObject({
      code: "23505",
      message: expect.stringContaining("roster_sources_spreadsheet_id_key"),
    });
  });

  it("a second sheet needs --replace; the old one is switched off, and can come back", async () => {
    const f = await newFirm();
    const first = newSheetId();
    const second = newSheetId();
    await connectSheet(urls.admin, f.slug, { spreadsheetId: first, replace: false });
    await su.query(
      "update roster_sources set last_synced_at = now(), last_error_code = 'sheet_not_shared' where firm_id = $1",
      [f.firmId],
    );
    expect(
      await connectSheet(urls.admin, f.slug, { spreadsheetId: second, replace: false }),
    ).toEqual({ status: "has_sheet" });
    expect(
      await connectSheet(urls.admin, f.slug, { spreadsheetId: second, replace: true }),
    ).toEqual({ status: "connected", replaced: true });
    expect(await sourcesOf(f.firmId)).toEqual([
      { spreadsheet_id: first, enabled: false },
      { spreadsheet_id: second, enabled: true },
    ]);
    // The first back again: switched on, its old sync state cleared so it's read afresh.
    expect(await connectSheet(urls.admin, f.slug, { spreadsheetId: first, replace: true })).toEqual(
      {
        status: "connected",
        replaced: true,
      },
    );
    const { rows } = await su.query(
      `select spreadsheet_id, enabled, last_synced_at, last_error_code from roster_sources
        where firm_id = $1 order by created_at, id`,
      [f.firmId],
    );
    expect(rows).toEqual([
      { spreadsheet_id: first, enabled: true, last_synced_at: null, last_error_code: null },
      { spreadsheet_id: second, enabled: false, last_synced_at: null, last_error_code: null },
    ]);
    expect((await eventsOf(f.firmId)).map((e) => [e.action, e.data])).toEqual([
      ["roster.source_connected", { replaced: false, defaultMapping: true }],
      ["roster.source_disabled", { replaced: true }],
      ["roster.source_connected", { replaced: true, defaultMapping: true }],
      ["roster.source_disabled", { replaced: true }],
      ["roster.source_connected", { replaced: true, defaultMapping: true }],
    ]);
  });

  it("a mapping of the firm's own; switching off; an unknown firm", async () => {
    const f = await newFirm();
    const sheet = newSheetId();
    await connectSheet(urls.admin, f.slug, { spreadsheetId: sheet, replace: false });
    const mapping = {
      ...DEFAULT_SHEET_MAPPING,
      shifts: { ...DEFAULT_SHEET_MAPPING.shifts, tab: "Rota" },
    };
    expect(
      await connectSheet(urls.admin, f.slug, { spreadsheetId: sheet, mapping, replace: false }),
    ).toEqual({ status: "mapping_changed" });
    expect(await showSheet(urls.admin, f.slug)).toMatchObject({
      source: { defaultMapping: false, enabled: true },
    });
    expect(await disableSheet(urls.admin, f.slug)).toEqual({ status: "disabled" });
    expect(await disableSheet(urls.admin, f.slug)).toEqual({ status: "none" });
    expect(await showSheet(urls.admin, f.slug)).toMatchObject({ source: { enabled: false } });
    expect((await eventsOf(f.firmId)).map((e) => [e.action, e.data])).toEqual([
      ["roster.source_connected", { replaced: false, defaultMapping: true }],
      ["roster.source_connected", { mappingChanged: true, defaultMapping: false }],
      ["roster.source_disabled", { replaced: false }],
    ]);
    const missing = uniqueSlug("none");
    expect(await showSheet(urls.admin, missing)).toEqual({ status: "no_firm" });
    expect(
      await connectSheet(urls.admin, missing, { spreadsheetId: newSheetId(), replace: false }),
    ).toEqual({ status: "no_firm" });
    expect(await disableSheet(urls.admin, missing)).toEqual({ status: "no_firm" });
    const empty = await newFirm();
    expect(await showSheet(urls.admin, empty.slug)).toEqual({ status: "ok", source: null });
  });
});

describe("npm run firm:sheet: guards", () => {
  // A sheet shift ahead with someone booked on it, as the sync would have made it.
  async function bookedSheetShift(firmId: string, ref: string, startsInHours: number) {
    const startsAt = new Date(Date.now() + startsInHours * 3_600_000);
    const { rows: w } = await su.query<{ id: string }>(
      `insert into workers (firm_id, first_name, last_name, mobile_e164)
       values ($1, 'Sheet', 'Worker', $2) returning id::text as id`,
      [firmId, `+447700${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`],
    );
    const { rows: s } = await su.query<{ id: string }>(
      `insert into shifts (firm_id, role, starts_at, ends_at, source, external_ref)
       values ($1, 'steward', $2, $3, 'sheets', $4) returning id::text as id`,
      [firmId, startsAt, new Date(startsAt.getTime() + 8 * 3_600_000), ref],
    );
    await su.query(
      `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
       values ($1, $2, 1, $3, 'confirmed', now())`,
      [firmId, s[0]?.id, w[0]?.id],
    );
  }

  it("while sheet shifts ahead have people booked, another sheet needs --same-ids", async () => {
    const f = await newFirm();
    const first = newSheetId();
    const second = newSheetId();
    await connectSheet(urls.admin, f.slug, { spreadsheetId: first, replace: false });
    await bookedSheetShift(f.firmId, "S7", 30);
    await bookedSheetShift(f.firmId, "S8", 54);
    // A booked shift that's over doesn't count.
    await bookedSheetShift(f.firmId, "S1", -30);
    expect(
      await connectSheet(urls.admin, f.slug, { spreadsheetId: second, replace: true }),
    ).toEqual({ status: "booked_ahead", shifts: 2 });
    // Switched off first, it's the same: the new sheet's first sync would still meet S7 and S8.
    await disableSheet(urls.admin, f.slug);
    expect(
      await connectSheet(urls.admin, f.slug, { spreadsheetId: second, replace: false }),
    ).toEqual({ status: "booked_ahead", shifts: 2 });
    expect(await sourcesOf(f.firmId)).toEqual([{ spreadsheet_id: first, enabled: false }]);
    // Said to be a copy with the same ids: connected.
    expect(
      await connectSheet(urls.admin, f.slug, {
        spreadsheetId: second,
        replace: true,
        sameIds: true,
      }),
    ).toEqual({ status: "connected", replaced: false });
    // The sheet on now, connected again: no question asked.
    expect(
      await connectSheet(urls.admin, f.slug, { spreadsheetId: second, replace: false }),
    ).toEqual({ status: "unchanged" });
  });

  it("connecting the same sheet without a mapping puts the default headings back, and retries a failing sync", async () => {
    const f = await newFirm();
    const sheet = newSheetId();
    const mapping = {
      ...DEFAULT_SHEET_MAPPING,
      staff: { ...DEFAULT_SHEET_MAPPING.staff, tab: "People" },
    };
    await connectSheet(urls.admin, f.slug, { spreadsheetId: sheet, mapping, replace: false });
    await su.query(
      "update roster_sources set mapping = '{\"broken\": true}', last_error_code = 'bad_mapping', last_attempted_at = now() where firm_id = $1",
      [f.firmId],
    );
    expect(
      await connectSheet(urls.admin, f.slug, { spreadsheetId: sheet, replace: false }),
    ).toEqual({ status: "mapping_changed" });
    const { rows } = await su.query(
      "select mapping, last_error_code, last_attempted_at from roster_sources where firm_id = $1",
      [f.firmId],
    );
    expect(rows[0]).toEqual({
      mapping: DEFAULT_SHEET_MAPPING,
      last_error_code: null,
      last_attempted_at: null,
    });
  });

  it("--forget lets a switched-off sheet go, so another firm can connect it; never one that's on", async () => {
    const a = await newFirm();
    const b = await newFirm();
    const sheet = newSheetId();
    await connectSheet(urls.admin, a.slug, { spreadsheetId: sheet, replace: false });
    expect(await forgetSheet(urls.admin, a.slug, sheet)).toEqual({ status: "on" });
    await disableSheet(urls.admin, a.slug);
    expect(await forgetSheet(urls.admin, b.slug, sheet)).toEqual({ status: "none" });
    expect(await forgetSheet(urls.admin, a.slug, sheet)).toEqual({ status: "forgotten" });
    expect(await sourcesOf(a.firmId)).toEqual([]);
    expect((await eventsOf(a.firmId)).map((e) => [e.action, e.data])).toEqual([
      ["roster.source_connected", { replaced: false, defaultMapping: true }],
      ["roster.source_disabled", { replaced: false }],
      ["roster.source_forgotten", {}],
    ]);
    expect(
      await connectSheet(urls.admin, b.slug, { spreadsheetId: sheet, replace: false }),
    ).toEqual({ status: "connected", replaced: false });
    expect(await forgetSheet(urls.admin, uniqueSlug("none"), sheet)).toEqual({ status: "no_firm" });
  });
});

describe("the app role (web and worker) and a firm's sheet", () => {
  it("can't add, remove or re-point a sheet, even its own firm's; can update the sync's status", async () => {
    const f = await newFirm();
    const sheet = newSheetId();
    await connectSheet(urls.admin, f.slug, { spreadsheetId: sheet, replace: false });
    const denied = (text: string, values: unknown[]) =>
      pgError(inFirm(app, f.firmId, (c) => c.query(text, values)));
    const noRight = { code: "42501", message: expect.stringMatching(/permission denied/) };

    expect(
      await denied(
        "insert into roster_sources (firm_id, kind, spreadsheet_id, mapping) values ($1, 'sheets', $2, '{}')",
        [f.firmId, newSheetId()],
      ),
    ).toMatchObject(noRight);
    for (const [column, value] of [
      ["spreadsheet_id", newSheetId()],
      ["mapping", "{}"],
      ["enabled", "false"],
      ["kind", "sheets"],
      ["firm_id", f.firmId],
    ] as const) {
      expect(
        await denied(`update roster_sources set ${column} = $2 where firm_id = $1`, [
          f.firmId,
          value,
        ]),
      ).toMatchObject(noRight);
    }
    expect(await denied("delete from roster_sources where firm_id = $1", [f.firmId])).toMatchObject(
      noRight,
    );

    // What the sync does: its lease and its status.
    const updated = await inFirm(
      app,
      f.firmId,
      (c) =>
        c.query(
          `update roster_sources
              set sync_started_at = now(), last_attempted_at = now(), last_synced_at = now(),
                  last_error_code = 'sheets_unavailable'
            where firm_id = $1 returning spreadsheet_id`,
          [f.firmId],
        ),
      { commit: true },
    );
    expect(updated.rows).toEqual([{ spreadsheet_id: sheet }]);
    expect(await sourcesOf(f.firmId)).toEqual([{ spreadsheet_id: sheet, enabled: true }]);
  });
});
