import { eq, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { firms } from "../db/schema";
import { withFirm } from "../db/scoped";
import { ImportFileError, type ImportFileErrorCode } from "../imports/errors";
import { runImport, type ImportResult } from "../imports/import";
import { readTable } from "../imports/table";
import { officeCanPlace } from "../roster/book";
import { WEB_IMPORT_MAX_BYTES } from "./import-limits";
import type { OfficeContext } from "./quick-actions";

// "Import from a file" on the office's shifts screen: a .csv or .xlsx of shifts, checked first
// (a dry run: the same work, rolled back, so the preview can't differ from the import) and then
// imported for real (src/lib/imports/import.ts). Active admins and resourcers only, checked inside
// the transaction. The web import takes files up to 1 MB (Next's server-action limit); the terminal
// import (`npm run import`) takes up to 5 MB.

export { WEB_IMPORT_MAX_BYTES };

export type ShiftImportResult =
  | { status: "done"; result: ImportResult }
  | { status: "file_error"; code: ImportFileErrorCode }
  | { status: "too_big" }
  | { status: "not_allowed" };

export async function importShiftsFile(
  ctx: OfficeContext,
  bytes: Uint8Array,
  dryRun: boolean,
): Promise<ShiftImportResult> {
  if (bytes.byteLength > WEB_IMPORT_MAX_BYTES) return { status: "too_big" };
  const now = (ctx.clock ?? systemClock).now();
  try {
    const rows = readTable(bytes);
    return await (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
      if (!(await officeCanPlace(tx, ctx.officeUserId))) return { status: "not_allowed" as const };
      const [firm] = await tx
        .select({ timezone: firms.timezone })
        .from(firms)
        .where(eq(firms.id, sql`app_current_firm_id()`));
      const result = await runImport(tx, {
        kind: "shifts",
        rows,
        dryRun,
        actorId: ctx.officeUserId,
        timeZone: firm?.timezone ?? "Europe/London",
        now,
      });
      return { status: "done" as const, result };
    });
  } catch (error) {
    if (error instanceof ImportFileError) return { status: "file_error", code: error.code };
    throw error;
  }
}
