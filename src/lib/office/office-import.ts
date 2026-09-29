import { eq, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { firms } from "../db/schema";
import { retryAborted } from "../db/retry";
import { withFirm, type FirmTx } from "../db/scoped";
import type { ImportKind } from "../imports/columns";
import { ImportFileError, type ImportFileErrorCode } from "../imports/errors";
import { runImport, type ImportResult } from "../imports/import";
import { readTable } from "../imports/table";
import { WEB_IMPORT_MAX_BYTES } from "./import-limits";
import type { OfficeContext } from "./office-context";

// An office upload of one kind of file (shifts, pay records): the file read and checked first (a
// dry run: the same work, rolled back, so the preview can't differ from the import) and then
// imported for real (src/lib/imports/import.ts). Who may import is checked inside the transaction.
// The web takes files up to 1 MB (Next's server-action limit); the terminal import (`npm run
// import`) takes up to 5 MB.

export type OfficeImportResult<Extra = object> =
  | ({ status: "done"; result: ImportResult } & Extra)
  | { status: "file_error"; code: ImportFileErrorCode }
  | { status: "too_big" }
  | { status: "not_allowed" };

export async function importOfficeFile<Extra extends object>(
  ctx: OfficeContext,
  opts: {
    kind: ImportKind;
    bytes: Uint8Array;
    dryRun: boolean;
    // May this office user import this kind? Checked inside the transaction.
    allowed: (tx: FirmTx, officeUserId: string) => Promise<boolean>;
    // Work after a real import (never a check), in the same transaction; its answer joins the
    // result.
    after: (tx: FirmTx, result: ImportResult) => Promise<Extra>;
    // What a check (or a real import `after` isn't run for) adds to the result instead.
    afterCheck: Extra;
  },
): Promise<OfficeImportResult<Extra>> {
  if (opts.bytes.byteLength > WEB_IMPORT_MAX_BYTES) return { status: "too_big" };
  const now = (ctx.clock ?? systemClock).now();
  try {
    const rows = readTable(opts.bytes);
    // Database work only, so it can simply run again if Postgres aborts it (two files at once
    // deadlocking on the same rows).
    return await retryAborted(() =>
      (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
        if (!(await opts.allowed(tx, ctx.officeUserId))) return { status: "not_allowed" as const };
        const [firm] = await tx
          .select({ timezone: firms.timezone })
          .from(firms)
          .where(eq(firms.id, sql`app_current_firm_id()`));
        const result = await runImport(tx, {
          kind: opts.kind,
          rows,
          dryRun: opts.dryRun,
          actorId: ctx.officeUserId,
          timeZone: firm?.timezone ?? "Europe/London",
          now,
        });
        const extra = opts.dryRun ? opts.afterCheck : await opts.after(tx, result);
        return { ...extra, status: "done" as const, result };
      }),
    );
  } catch (error) {
    if (error instanceof ImportFileError) return { status: "file_error", code: error.code };
    throw error;
  }
}
