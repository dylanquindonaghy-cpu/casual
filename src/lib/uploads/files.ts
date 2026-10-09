import { and, eq, isNull } from "drizzle-orm";
import { uploads, workers, type UploadKind } from "../db/schema";
import { withFirm } from "../db/scoped";
import { officeUserMay, parts, type OfficeContext } from "../office/office-context";
import type { PortalContext } from "../portal/my-shifts";

// An upload's image, for `/files/[id]` only (docs/office-v2.md 5.5; 12F.2): the casual's own, or
// any of their firm's to an active admin or resourcer. Anything else (another casual's, another
// firm's: RLS hides those rows, an erased casual's, a payroll user) is "not found", whether or not
// it exists. Reads the bytes of one row; never lists them.

export type FileResult =
  | { status: "ok"; data: Buffer; contentType: string; kind: UploadKind; createdAt: Date }
  | { status: "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const columns = {
  data: uploads.data,
  contentType: uploads.contentType,
  kind: uploads.kind,
  createdAt: uploads.createdAt,
};

export async function casualFile(
  ctx: PortalContext,
  workerId: string,
  uploadId: string,
): Promise<FileResult> {
  if (!UUID.test(uploadId)) return { status: "not_found" };
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx): Promise<FileResult> => {
    const [row] = await tx
      .select(columns)
      .from(uploads)
      .innerJoin(workers, and(eq(workers.firmId, uploads.firmId), eq(workers.id, uploads.workerId)))
      .where(
        and(eq(uploads.id, uploadId), eq(uploads.workerId, workerId), isNull(workers.erasedAt)),
      );
    return row ? { status: "ok", ...row } : { status: "not_found" };
  });
}

export async function officeFile(ctx: OfficeContext, uploadId: string): Promise<FileResult> {
  if (!UUID.test(uploadId)) return { status: "not_found" };
  const { run, by } = parts(ctx);
  return run(ctx.firm.id, async (tx): Promise<FileResult> => {
    if (!(await officeUserMay(tx, by.id, "casuals"))) return { status: "not_found" };
    const [row] = await tx.select(columns).from(uploads).where(eq(uploads.id, uploadId));
    return row ? { status: "ok", ...row } : { status: "not_found" };
  });
}
