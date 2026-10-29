import { Client, DatabaseError } from "pg";
import { isLocalHost } from "../src/lib/db/admin/urls";
import { DEFAULT_SHEET_MAPPING, type SheetMapping } from "../src/lib/roster/sheets/mapping";

// A firm's Google Sheet (`npm run firm:sheet`, scripts/firm-sheet.ts): connect it, replace it,
// switch it off, or show where it stands. Only the owner does this (audit L45): every firm shares
// its sheet with the same service account, so the spreadsheet id is all that ties a sheet to a
// firm. The app role can't add a source or change its sheet (src/lib/db/admin/access.ts), and a
// unique index lets one spreadsheet belong to one firm only, whichever firm asks. RLS is forced
// for the owner too, so each change runs with the firm set for its transaction only, like
// scripts/firm-settings-owner.ts. Each change is logged (`roster.source_connected`,
// `roster.source_disabled`), without the spreadsheet id.

// A sheet's id, from its link (https://docs.google.com/spreadsheets/d/<id>/edit…) or the id
// itself. Null when it's neither.
export function spreadsheetIdFrom(input: string): string | null {
  const s = input.trim();
  const fromLink =
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(s);
  const id = fromLink ? (fromLink[1] ?? "") : s;
  return /^[A-Za-z0-9_-]{20,100}$/.test(id) ? id : null;
}

export interface SheetSource {
  spreadsheetId: string;
  enabled: boolean;
  defaultMapping: boolean;
  lastSyncedAt: Date | null;
  lastAttemptedAt: Date | null;
  lastErrorCode: string | null;
}

export type ConnectResult =
  | { status: "connected"; replaced: boolean }
  | { status: "mapping_changed" }
  | { status: "unchanged" }
  | { status: "has_sheet" } // another sheet is connected: needs --replace
  | { status: "has_connector" } // a connector (npm run firm:connector) is on: switch it off first
  | { status: "booked_ahead"; shifts: number } // needs --same-ids
  | { status: "taken" } // another firm has this sheet
  | { status: "agreement_needed" } // Gate B: live database, signing not recorded
  | { status: "no_firm" };

export type DisableResult = { status: "disabled" } | { status: "none" } | { status: "no_firm" };

export type ForgetResult =
  | { status: "forgotten" }
  | { status: "on" } // switch it off first
  | { status: "none" }
  | { status: "no_firm" };

export type ShowResult = { status: "ok"; source: SheetSource | null } | { status: "no_firm" };

const CONNECTED = "roster.source_connected";
const DISABLED = "roster.source_disabled";
const FORGOTTEN = "roster.source_forgotten";
const SHEET_TAKEN = "roster_sources_spreadsheet_id_key";
const ONE_ENABLED = "roster_sources_one_enabled_per_firm";

async function withOwnerFirm<T>(
  adminUrl: string,
  slug: string,
  fn: (owner: Client, firmId: string) => Promise<T>,
): Promise<T | "no_firm"> {
  const owner = new Client({ connectionString: adminUrl });
  await owner.connect();
  try {
    const { rows } = await owner.query<{ id: string }>(
      "select id::text as id from firms where slug = $1",
      [slug],
    );
    const firmId = rows[0]?.id;
    if (!firmId) return "no_firm";
    await owner.query("begin");
    try {
      await owner.query("select set_config('app.current_firm_id', $1, true)", [firmId]);
      const result = await fn(owner, firmId);
      await owner.query("commit");
      return result;
    } catch (err) {
      await owner.query("rollback").catch(() => undefined);
      throw err;
    }
  } finally {
    await owner.end();
  }
}

async function logChange(
  owner: Client,
  firmId: string,
  action: string,
  sourceId: string,
  data: object,
) {
  await owner.query(
    `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
     values ($1, 'system', $2, 'roster_source', $3, $4)`,
    [firmId, action, sourceId, JSON.stringify(data)],
  );
}

// Postgres stores jsonb with its keys reordered, so objects are compared with their keys sorted.
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
const same = (a: unknown, b: unknown) => canon(a) === canon(b);

// Shifts from a rota sheet, still ahead, with people booked on them.
async function bookedSheetShiftsAhead(owner: Client, firmId: string): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(
    `select count(distinct s.id)::int as n
       from shifts s
       join assignments a on a.firm_id = s.firm_id and a.shift_id = s.id
      where s.firm_id = $1 and s.source = 'sheets' and s.status <> 'cancelled'
        and s.ends_at > now() and a.status = 'confirmed'`,
    [firmId],
  );
  return rows[0]?.n ?? 0;
}

// Connects the sheet, with the default column mapping unless one is given (so connecting the same
// sheet again without one puts the default back). A firm has one sheet at a time: a different one
// replaces it only with `replace`, and the old one is kept, switched off. A sheet this firm had
// before is switched back on, its sync state cleared so it's read on the next tick.
//
// Shifts are matched to the sheet's rows by their Shift ID alone, and staff by their Staff ID. So
// while sheet shifts ahead have people booked, a sheet other than the one on now is connected only
// with `sameIds` (it's a copy, with the same Shift IDs and Staff IDs): a new sheet that reused
// "S7" for another shift would have its first sync cancel or move the people booked on our S7,
// logged as the firm's own change. The firm's data is never touched here: the next sync does that.
export async function connectSheet(
  adminUrl: string,
  slug: string,
  opts: {
    spreadsheetId: string;
    mapping?: SheetMapping;
    replace: boolean;
    sameIds?: boolean;
    localDatabase?: boolean; // unset: from the URL; tests pass false to act as on a live one
  },
): Promise<ConnectResult> {
  const local = opts.localDatabase ?? isLocalHost(adminUrl);
  try {
    const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
      // Gate B: a live database reads a firm's sheet (real staff) only once its agreement and DPA
      // are recorded as signed (src/lib/imports/gate-b.ts).
      if (!local) {
        const { rows: firm } = await owner.query<{ signed: string | null }>(
          "select agreement_signed_on::text as signed from firms where id = $1",
          [firmId],
        );
        if (!firm[0]?.signed) return { status: "agreement_needed" } as const;
      }
      // One enabled source per firm: a connector on stays on until it's switched off itself.
      const { rows: connector } = await owner.query(
        `select 1 from roster_sources where firm_id = $1 and kind = 'connector' and enabled`,
        [firmId],
      );
      if (connector.length > 0) return { status: "has_connector" } as const;
      const { rows } = await owner.query<{
        id: string;
        spreadsheet_id: string;
        enabled: boolean;
        mapping: unknown;
      }>(
        `select id::text as id, spreadsheet_id, enabled, mapping from roster_sources
          where firm_id = $1 and kind = 'sheets' and (enabled or spreadsheet_id = $2) for update`,
        [firmId, opts.spreadsheetId],
      );
      const live = rows.find((r) => r.enabled);
      const mapping = opts.mapping ?? DEFAULT_SHEET_MAPPING;
      if (live && live.spreadsheet_id === opts.spreadsheetId) {
        if (same(live.mapping, mapping)) return { status: "unchanged" } as const;
        // A failing sync (a bad mapping, say) is tried again at the next tick.
        await owner.query(
          `update roster_sources set mapping = $2, last_error_code = null, last_attempted_at = null
            where id = $1`,
          [live.id, JSON.stringify(mapping)],
        );
        await logChange(owner, firmId, CONNECTED, live.id, {
          mappingChanged: true,
          defaultMapping: same(mapping, DEFAULT_SHEET_MAPPING),
        });
        return { status: "mapping_changed" } as const;
      }
      if (live && !opts.replace) return { status: "has_sheet" } as const;
      if (!opts.sameIds) {
        const shifts = await bookedSheetShiftsAhead(owner, firmId);
        if (shifts > 0) return { status: "booked_ahead", shifts } as const;
      }
      if (live) {
        // A sync of the old sheet running now loses its lease, so it saves nothing.
        await owner.query(
          "update roster_sources set enabled = false, sync_started_at = null where id = $1",
          [live.id],
        );
        await logChange(owner, firmId, DISABLED, live.id, { replaced: true });
      }
      const before = rows.find((r) => r.spreadsheet_id === opts.spreadsheetId);
      let sourceId: string;
      if (before) {
        await owner.query(
          `update roster_sources
              set enabled = true, mapping = $2, last_synced_at = null, last_attempted_at = null,
                  last_error_code = null, sync_started_at = null
            where id = $1`,
          [before.id, JSON.stringify(mapping)],
        );
        sourceId = before.id;
      } else {
        const inserted = await owner.query<{ id: string }>(
          `insert into roster_sources (firm_id, kind, spreadsheet_id, mapping)
           values ($1, 'sheets', $2, $3) returning id::text as id`,
          [firmId, opts.spreadsheetId, JSON.stringify(mapping)],
        );
        sourceId = inserted.rows[0]?.id ?? "";
      }
      await logChange(owner, firmId, CONNECTED, sourceId, {
        replaced: live !== undefined,
        defaultMapping: same(mapping, DEFAULT_SHEET_MAPPING),
      });
      return { status: "connected", replaced: live !== undefined } as const;
    });
    return result === "no_firm" ? { status: "no_firm" } : result;
  } catch (err) {
    // Another firm's row: RLS hides it, the unique index doesn't (and says nothing about whose).
    if (err instanceof DatabaseError && err.code === "23505" && err.constraint === SHEET_TAKEN) {
      return { status: "taken" };
    }
    // A connector switched on by another owner command a moment ago (one enabled per firm).
    if (err instanceof DatabaseError && err.code === "23505" && err.constraint === ONE_ENABLED) {
      return { status: "has_connector" };
    }
    throw err;
  }
}

// Switched off, not deleted (its history stays); a sync running now loses its lease.
export async function disableSheet(adminUrl: string, slug: string): Promise<DisableResult> {
  const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
    const { rows } = await owner.query<{ id: string }>(
      `update roster_sources set enabled = false, sync_started_at = null
        where firm_id = $1 and kind = 'sheets' and enabled returning id::text as id`,
      [firmId],
    );
    const id = rows[0]?.id;
    if (!id) return { status: "none" } as const;
    await logChange(owner, firmId, DISABLED, id, { replaced: false });
    return { status: "disabled" } as const;
  });
  return result === "no_firm" ? { status: "no_firm" } : result;
}

// Lets a switched-off sheet go, so another firm can connect it (one connected by mistake, say).
// The firm's shifts and history from it stay; the row that bound it is deleted, and that's logged.
export async function forgetSheet(
  adminUrl: string,
  slug: string,
  spreadsheetId: string,
): Promise<ForgetResult> {
  const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
    const { rows } = await owner.query<{ id: string; enabled: boolean }>(
      `select id::text as id, enabled from roster_sources
        where firm_id = $1 and kind = 'sheets' and spreadsheet_id = $2 for update`,
      [firmId, spreadsheetId],
    );
    const row = rows[0];
    if (!row) return { status: "none" } as const;
    if (row.enabled) return { status: "on" } as const;
    await owner.query("delete from roster_sources where id = $1", [row.id]);
    await logChange(owner, firmId, FORGOTTEN, row.id, {});
    return { status: "forgotten" } as const;
  });
  return result === "no_firm" ? { status: "no_firm" } : result;
}

// The firm's connected sheet, or (if none is on) the one most recently added.
export async function showSheet(adminUrl: string, slug: string): Promise<ShowResult> {
  const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
    const { rows } = await owner.query<{
      spreadsheet_id: string;
      enabled: boolean;
      mapping: unknown;
      last_synced_at: Date | null;
      last_attempted_at: Date | null;
      last_error_code: string | null;
    }>(
      `select spreadsheet_id, enabled, mapping, last_synced_at, last_attempted_at, last_error_code
         from roster_sources where firm_id = $1 and kind = 'sheets'
        order by enabled desc, created_at desc limit 1`,
      [firmId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      spreadsheetId: row.spreadsheet_id,
      enabled: row.enabled,
      defaultMapping: same(row.mapping, DEFAULT_SHEET_MAPPING),
      lastSyncedAt: row.last_synced_at,
      lastAttemptedAt: row.last_attempted_at,
      lastErrorCode: row.last_error_code,
    };
  });
  return result === "no_firm" ? { status: "no_firm" } : { status: "ok", source: result };
}
