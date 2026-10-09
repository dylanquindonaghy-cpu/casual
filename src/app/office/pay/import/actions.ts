"use server";

import { importPayFile, type PayImportResult } from "@/lib/office/pay-import";
import { asPayroll, type Common } from "../../pay-queries/as-payroll";

// "Import pay records" (docs/screens.md `/office/pay/import`): the file and whether to check it or
// import it. The firm comes from the request's host and the office user from their session (payroll
// or an admin: checked before the file is read, and again inside the import). Shown in place.

export async function importPayAction(form: FormData): Promise<PayImportResult | Common> {
  const file = form.get("file");
  const mode = form.get("mode");
  if (!(file instanceof File) || (mode !== "check" && mode !== "import")) {
    return { status: "file_error", code: "empty" };
  }
  return asPayroll("import pay records", async (ctx) =>
    importPayFile(ctx, new Uint8Array(await file.arrayBuffer()), mode === "check"),
  );
}
