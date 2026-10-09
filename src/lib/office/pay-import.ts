import { regroupPayQueries } from "../pay/grouping";
import { importOfficeFile, type OfficeImportResult } from "./office-import";
import { officeUserMay, type OfficeContext } from "./office-context";

// "Import pay records" (docs/screens.md `/office/pay/import`): payroll's file of pay lines (period,
// hours, rate, gross, pay date: the `pay` kind of src/lib/imports/import.ts), checked first and then
// imported. Active payroll users and admins (the pay area), checked inside the transaction. The
// figures are the payroll's, stored as given; the log records what changed, never the amounts.
//
// A wrong-rate pay query's group depends on the rate of the worker's pay line for that day
// (src/lib/pay/grouping.ts), so after a real import that added or changed lines, the waiting
// queries are regrouped in the same transaction, and the result says how many moved.

export type PayImportResult = OfficeImportResult<{ regrouped: number }>;

export function importPayFile(
  ctx: OfficeContext,
  bytes: Uint8Array,
  dryRun: boolean,
): Promise<PayImportResult> {
  return importOfficeFile(ctx, {
    kind: "pay",
    bytes,
    dryRun,
    allowed: (tx, officeUserId) => officeUserMay(tx, officeUserId, "pay"),
    after: async (tx, result) =>
      result.created + result.updated > 0
        ? { regrouped: (await regroupPayQueries(tx)).changed }
        : { regrouped: 0 },
    afterCheck: { regrouped: 0 },
  });
}
