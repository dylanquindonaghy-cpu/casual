import { asc, getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable, type SelectedFields } from "drizzle-orm/pg-core";
import { systemClock } from "../auth/clock";
import { retryAborted } from "../db/retry";
import * as schema from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeUserMay, parts, type OfficeContext } from "../office/office-context";
import { renumberEvents } from "./event-numbers";

// A firm's own data, all of it, as one JSON file (docs/compliance.md "Firms can export their data
// any time"; docs/runbooks.md "Offboarding a firm"). Every firm table, every column as stored
// (less firm_id, the same on every row), oldest first. Left out, because they are login machinery
// and not the firm's records: login links, sessions and one-time codes (token and code hashes),
// the login rate-limit counters (hashed numbers and addresses), phones' push addresses (each one
// lets anyone holding it send that phone a notification), and travel estimates (keyed by casuals'
// full postcodes, which the office never sees). A casual's travel area goes out as its
// district only, never the postcode or its point (FIRM_EXPORT_CUT): the office never sees more
// (docs/dpia-travel.md); the casual's own export has it in full. Admins only, checked inside the
// firm's transaction (RLS scopes every row to the firm), and logged: firm.data_exported
// {tables, rows}.
//
// Built in memory: fine at pilot size (a firm's year is tens of megabytes). Stream it table by
// table before a firm has millions of rows (parked).

export const FIRM_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  magic_links: "login link hashes",
  sessions: "session token hashes",
  otp_codes: "one-time code hashes",
  auth_throttle: "login rate-limit counters (hashed numbers and addresses)",
  push_subscriptions: "phones' push addresses and keys",
  // Worked out from casuals' start postcodes (12G.2): the full postcodes the office never sees
  // (docs/dpia-travel.md), and the job works them out again from the firm's own data.
  travel_estimates: "travel estimates, worked out from casuals' full postcodes",
};

// Tables exported with some columns cut, and why (the rest of each row as stored).
const travel = schema.workerTravel;
export const FIRM_EXPORT_CUT: Readonly<
  Record<string, { why: string; columns: () => SelectedFields }>
> = {
  worker_travel: {
    why: "a casual's start postcode and its point: the district only (docs/dpia-travel.md)",
    columns: () => ({
      id: travel.id,
      workerId: travel.workerId,
      district: sql<string>`split_part(${travel.startPostcode}, ' ', 1)`,
      modes: travel.modes,
      maxMinutes: travel.maxMinutes,
      privacyNoticeVersion: travel.privacyNoticeVersion,
      updatedAt: travel.updatedAt,
      createdAt: travel.createdAt,
    }),
  },
};

// Every table with a firm_id (the firm's own row is read on its own), less the ones left out.
export function firmExportTables(): PgTable[] {
  return Object.values(schema as Record<string, unknown>)
    .filter((value): value is PgTable => is(value, PgTable))
    .filter((table) => "firmId" in getTableColumns(table))
    .filter((table) => !(getTableName(table) in FIRM_EXPORT_EXCLUDED))
    .sort((a, b) => getTableName(a).localeCompare(getTableName(b)));
}

export interface FirmExport {
  exportedAt: Date;
  firm: Record<string, unknown>;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function collectFirmData(tx: FirmTx, now: Date): Promise<FirmExport> {
  const [firm] = await tx.select().from(schema.firms);
  const tables: FirmExport["tables"] = {};
  for (const table of firmExportTables()) {
    const all = getTableColumns(table);
    const order = [all.createdAt, all.id].filter((c) => c !== undefined).map((c) => asc(c));
    const cut = FIRM_EXPORT_CUT[getTableName(table)];
    const columns: SelectedFields = cut
      ? cut.columns()
      : Object.fromEntries(Object.entries(all).filter(([key]) => key !== "firmId"));
    const rows: Record<string, unknown>[] = await tx
      .select(columns)
      .from(table)
      .orderBy(...order);
    // The action log's own numbers stay out of the file (src/lib/gdpr/event-numbers.ts).
    tables[getTableName(table)] = table === schema.events ? renumberEvents(rows) : rows;
  }
  return { exportedAt: now, firm: firm ?? {}, tables };
}

export function firmExportFileName(slug: string, now: Date): string {
  return `${slug}-data-${now.toISOString().slice(0, 10)}.json`;
}

export type FirmExportResult =
  { status: "ok"; body: string; fileName: string; rows: number } | { status: "not_allowed" };

export async function exportFirmData(
  ctx: OfficeContext & { firm: { id: string; slug: string } },
): Promise<FirmExportResult> {
  const { run, by } = parts(ctx);
  const firm = ctx.firm;
  const now = (ctx.clock ?? systemClock).now();
  return retryAborted(() =>
    run(firm.id, async (tx): Promise<FirmExportResult> => {
      if (!(await officeUserMay(tx, by.id, "data"))) return { status: "not_allowed" };
      const data = await collectFirmData(tx, now);
      const rows = Object.values(data.tables).reduce((sum, t) => sum + t.length, 0);
      await recordEvent(tx, {
        actorType: "office",
        actorId: by.id,
        action: "firm.data_exported",
        entityType: "firm",
        entityId: firm.id,
        data: { tables: Object.keys(data.tables).length, rows },
      });
      return {
        status: "ok",
        body: `${JSON.stringify(data, null, 2)}\n`,
        fileName: firmExportFileName(firm.slug, now),
        rows,
      };
    }),
  );
}
