import { officeCanPlace } from "../roster/book";
import { WEB_IMPORT_MAX_BYTES } from "./import-limits";
import { importOfficeFile, type OfficeImportResult } from "./office-import";
import type { OfficeContext } from "./office-context";

// "Import from a file" on the office's shifts screen: a .csv or .xlsx of shifts, checked first and
// then imported (src/lib/office/office-import.ts). Active admins and resourcers only, checked
// inside the transaction.

export { WEB_IMPORT_MAX_BYTES };

export type ShiftImportResult = OfficeImportResult;

export function importShiftsFile(
  ctx: OfficeContext,
  bytes: Uint8Array,
  dryRun: boolean,
): Promise<ShiftImportResult> {
  return importOfficeFile(ctx, {
    kind: "shifts",
    bytes,
    dryRun,
    allowed: officeCanPlace,
    after: async () => ({}),
    afterCheck: {},
  });
}
