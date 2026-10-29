import { Client, DatabaseError } from "pg";
import { isLocalHost } from "../src/lib/db/admin/urls";
import { CONNECTOR_BASE_URL, CONNECTOR_BASE_URL_MAX, type Connector } from "../src/lib/db/schema";

// A firm's connector to its own system (P5.3, `npm run firm:connector`, scripts/firm-connector.ts;
// PLAN.md P5): which system and its base address, in roster_sources (kind "connector"). Set only by
// the owner, as a firm's sheet is (scripts/firm-sheet-owner.ts): RLS is forced for the owner too,
// so each change runs with the firm set for its transaction only. One source on per firm, and one
// planner: a connector isn't connected while a sheet is on, or while the firm has a live planner
// API key (both would write the same sessions by the same refs). Gate B: on a live database, only
// once the firm's agreement and DPA are recorded. Each change is logged firm.settings_changed
// {keys: ["roster_source.connector"], change: "connected" | "replaced" | "switched_off"}: the
// office reads it as a change to the firm's settings. The system's API key is set apart, in the
// secret store (npm run firm:secret, the name connector.api_key), never here.

export type ConnectResult =
  | { status: "connected" | "replaced"; sourceId: string }
  | { status: "unchanged"; sourceId: string }
  | { status: "has_connector" } // another one is on: needs --replace
  | { status: "has_sheet" } // a sheet is on (npm run firm:sheet -- --off first)
  | { status: "has_api_key" } // the firm's planner already sends sessions through the API
  | { status: "bad_address" }
  | { status: "agreement_needed" }
  | { status: "no_firm" };

export type SwitchOffResult =
  { status: "switched_off" } | { status: "none" } | { status: "no_firm" };

export interface ConnectorSource {
  sourceId: string;
  connector: Connector;
  baseUrl: string;
  enabled: boolean;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
}

const BASE_URL = new RegExp(CONNECTOR_BASE_URL);
const ONE_ENABLED = "roster_sources_one_enabled_per_firm";

export const isConnectorAddress = (url: string) =>
  url.length <= CONNECTOR_BASE_URL_MAX && BASE_URL.test(url);

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

const log = (owner: Client, firmId: string, change: string) =>
  owner.query(
    `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
     values ($1, 'system', 'firm.settings_changed', 'firm', $1, $2)`,
    [firmId, JSON.stringify({ keys: ["roster_source.connector"], change })],
  );

export async function connectConnector(
  adminUrl: string,
  slug: string,
  opts: {
    connector: Connector;
    baseUrl: string;
    replace: boolean;
    localDatabase?: boolean; // unset: from the URL; tests pass false to act as on a live one
  },
): Promise<ConnectResult> {
  if (!isConnectorAddress(opts.baseUrl)) return { status: "bad_address" };
  const local = opts.localDatabase ?? isLocalHost(adminUrl);
  try {
    const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
      if (!local) {
        const { rows } = await owner.query<{ signed: string | null }>(
          "select agreement_signed_on::text as signed from firms where id = $1",
          [firmId],
        );
        if (!rows[0]?.signed) return { status: "agreement_needed" } as const;
      }
      const { rows: keys } = await owner.query(
        "select 1 from api_keys where firm_id = $1 and revoked_at is null limit 1",
        [firmId],
      );
      if (keys.length > 0) return { status: "has_api_key" } as const;
      const { rows: on } = await owner.query<{
        id: string;
        kind: string;
        connector: string | null;
        base_url: string | null;
      }>(
        `select id::text as id, kind, connector, base_url from roster_sources
          where firm_id = $1 and enabled for update`,
        [firmId],
      );
      const live = on[0];
      if (live?.kind === "sheets") return { status: "has_sheet" } as const;
      if (live && live.connector === opts.connector && live.base_url === opts.baseUrl) {
        return { status: "unchanged", sourceId: live.id } as const;
      }
      if (live && !opts.replace) return { status: "has_connector" } as const;
      if (live) {
        // A change waiting on the old source's row sees it off and changes nothing.
        await owner.query(
          "update roster_sources set enabled = false, sync_started_at = null where id = $1",
          [live.id],
        );
      }
      const { rows: made } = await owner.query<{ id: string }>(
        `insert into roster_sources (firm_id, kind, connector, base_url, mapping)
         values ($1, 'connector', $2, $3, '{}') returning id::text as id`,
        [firmId, opts.connector, opts.baseUrl],
      );
      const sourceId = made[0]?.id ?? "";
      await log(owner, firmId, live ? "replaced" : "connected");
      return { status: live ? ("replaced" as const) : ("connected" as const), sourceId };
    });
    return result === "no_firm" ? { status: "no_firm" } : result;
  } catch (err) {
    // A sheet or connector switched on by another owner command a moment ago.
    if (err instanceof DatabaseError && err.code === "23505" && err.constraint === ONE_ENABLED) {
      return { status: "has_connector" };
    }
    throw err;
  }
}

// Switched off, not deleted (its events stay): a change waiting on its row then changes nothing.
export async function switchOffConnector(adminUrl: string, slug: string): Promise<SwitchOffResult> {
  const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
    const { rows } = await owner.query(
      `update roster_sources set enabled = false, sync_started_at = null
        where firm_id = $1 and kind = 'connector' and enabled returning id`,
      [firmId],
    );
    if (rows.length === 0) return { status: "none" } as const;
    await log(owner, firmId, "switched_off");
    return { status: "switched_off" } as const;
  });
  return result === "no_firm" ? { status: "no_firm" } : result;
}

// The firm's connector on now, or (if none is on) the one most recently connected.
export async function showConnector(
  adminUrl: string,
  slug: string,
): Promise<{ status: "ok"; source: ConnectorSource | null } | { status: "no_firm" }> {
  const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
    const { rows } = await owner.query<{
      id: string;
      connector: Connector;
      base_url: string;
      enabled: boolean;
      last_synced_at: Date | null;
      last_error_code: string | null;
    }>(
      `select id::text as id, connector, base_url, enabled, last_synced_at, last_error_code
         from roster_sources where firm_id = $1 and kind = 'connector'
        order by enabled desc, created_at desc limit 1`,
      [firmId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      sourceId: row.id,
      connector: row.connector,
      baseUrl: row.base_url,
      enabled: row.enabled,
      lastSyncedAt: row.last_synced_at,
      lastErrorCode: row.last_error_code,
    };
  });
  return result === "no_firm" ? { status: "no_firm" } : { status: "ok", source: result };
}
