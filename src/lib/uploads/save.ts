import { and, eq, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { credentialRules, credentials, credentialTypes, uploads, workers } from "../db/schema";
import { withFirm, type FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import type { PortalContext } from "../portal/my-shifts";
import { casualMayUpload } from "../rules/packs";
import { cleanImage } from "./image";

// A casual sends a photo or a certificate image (docs/office-v2.md 3.7, 4.6, 5.5; S6, S7; 12F.2),
// for the logged-in casual only, inside their firm. Server only.
// - The image is checked and re-encoded first (src/lib/uploads/image.ts), outside any transaction.
// - Then, with her row locked (as erasure and the office's status changes lock it), only an active
//   casual's is saved; two sends at once take turns.
// - A certificate must be for a type one of her roles needs (her Profile lists exactly those), and
//   never one the office records itself (CSAS, right to work, health or criminal record details:
//   src/lib/rules/packs.ts).
// - A new one replaces her own still waiting for the office (the same photo, or the same type):
//   deleted, with its waiting record. One already checked is never touched.
// - A certificate also gets a record that is "waiting" (check_state), stored as expired: it counts
//   for nothing until a named office person approves it (src/lib/uploads/check.ts).
// - Logged `upload.received` {workerId, kind, qualificationType, replaced}: ids and codes, never
//   the image or anything read from it.

export type UploadTarget = { kind: "photo" } | { kind: "certificate"; type: string };

export type SaveUploadResult =
  | { status: "sent"; uploadId: string }
  | { status: "empty" | "too_big" | "not_an_image" }
  | { status: "not_needed" } // a type her roles don't need, or one the office records
  | { status: "not_active" };

const TYPE_FORMAT = /^[A-Z][A-Z0-9_]{0,49}$/;

// Whether one of her roles needs this type (the firm's rules), so she may send it.
async function rolesNeed(tx: FirmTx, roles: readonly string[], type: string): Promise<boolean> {
  if (roles.length === 0) return false;
  const [row] = await tx
    .select({ role: credentialRules.role })
    .from(credentialRules)
    .where(
      and(
        sql`${credentialRules.role} = any(${sql.param([...roles])}::text[])`,
        // Its one-of group's types too (P3.3): either licence will do, so she may send either.
        sql`(${type} = any(${credentialRules.requiredTypes}) or ${type} = any(${credentialRules.anyOfTypes}))`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function saveMyUpload(
  ctx: PortalContext,
  workerId: string,
  target: UploadTarget,
  bytes: Uint8Array,
): Promise<SaveUploadResult> {
  if (target.kind === "certificate") {
    if (!TYPE_FORMAT.test(target.type) || !casualMayUpload(target.type)) {
      return { status: "not_needed" };
    }
  }
  const image = await cleanImage(bytes);
  if (image.status !== "ok") return { status: image.status };
  const now = (ctx.clock ?? systemClock).now();
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx): Promise<SaveUploadResult> => {
    const [worker] = await tx
      .select({ status: workers.status, erasedAt: workers.erasedAt, roles: workers.roles })
      .from(workers)
      .where(eq(workers.id, workerId))
      .for("no key update");
    if (!worker || worker.erasedAt !== null || worker.status !== "active") {
      return { status: "not_active" };
    }
    const type = target.kind === "certificate" ? target.type : null;
    if (type !== null) {
      // The firm's own word that only the office records it (the packs' list was checked above).
      const [kind] = await tx
        .select({ officeRecorded: credentialTypes.officeRecorded })
        .from(credentialTypes)
        .where(eq(credentialTypes.code, type));
      if (kind?.officeRecorded || !(await rolesNeed(tx, worker.roles, type))) {
        return { status: "not_needed" };
      }
    }
    // Her own still waiting, replaced: its waiting record first (it points at the upload).
    const sameKind = and(
      eq(uploads.workerId, workerId),
      eq(uploads.kind, target.kind),
      eq(uploads.status, "waiting"),
      type === null ? sql`${uploads.credentialType} is null` : eq(uploads.credentialType, type),
    );
    // Locked, and deleted only while still waiting: the office checks one with her row locked
    // too (src/lib/uploads/check.ts), so one just approved or rejected is never deleted here.
    const [old] = await tx.select({ id: uploads.id }).from(uploads).where(sameKind).for("update");
    if (old) {
      await tx
        .delete(credentials)
        .where(
          and(eq(credentials.evidenceUploadId, old.id), eq(credentials.checkState, "waiting")),
        );
      await tx.delete(uploads).where(and(eq(uploads.id, old.id), eq(uploads.status, "waiting")));
    }
    const [added] = await tx
      .insert(uploads)
      .values({
        firmId: sql`app_current_firm_id()`,
        workerId,
        kind: target.kind,
        credentialType: type,
        contentType: "image/jpeg",
        size: image.size,
        sha256: image.sha256,
        data: image.data,
        createdAt: now,
      })
      .returning({ id: uploads.id });
    if (!added) throw new Error("upload insert returned nothing");
    if (type !== null) {
      await tx.insert(credentials).values({
        firmId: sql`app_current_firm_id()`,
        workerId,
        type,
        status: "expired", // counts for nothing until it's checked (S6)
        checkState: "waiting",
        evidenceUploadId: added.id,
        createdAt: now,
      });
    }
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: "upload.received",
      entityType: "upload",
      entityId: added.id,
      data: {
        workerId,
        kind: target.kind,
        ...(type !== null ? { qualificationType: type } : {}),
        ...(old ? { replaced: true } : {}),
      },
    });
    return { status: "sent", uploadId: added.id };
  });
}
