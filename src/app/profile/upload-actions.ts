"use server";

import { getWorkerSession } from "@/lib/auth/current-worker";
import type { SendUploadOutcome } from "@/lib/portal/upload-copy";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { UPLOAD_MAX_BYTES } from "@/lib/uploads/image";
import { saveMyUpload, type UploadTarget } from "@/lib/uploads/save";

// A casual sends a photo or certificate image (docs/office-v2.md 4.6, 5.5; 12F.2). The firm comes
// from the request's host and the casual from their session; the form sends the file and what it's
// for ("photo", or "certificate" and a type code). Everything is checked again on the server
// (src/lib/uploads/save.ts). Errors are logged without the file.

export async function sendUploadAction(form: FormData): Promise<SendUploadOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "empty" };
  if (file.size > UPLOAD_MAX_BYTES) return { status: "too_big" };
  const kind = form.get("kind");
  const type = form.get("type");
  const target: UploadTarget | null =
    kind === "photo"
      ? { kind: "photo" }
      : kind === "certificate" && typeof type === "string"
        ? { kind: "certificate", type }
        : null;
  if (!target) return { status: "not_needed" };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await saveMyUpload({ firm }, session.worker.id, target, bytes);
    return result.status === "sent" ? { status: "sent", kind: target.kind } : result;
  } catch (error) {
    (await requestLog()).error("send upload failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
