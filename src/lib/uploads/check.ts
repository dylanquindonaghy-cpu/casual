import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import {
  credentials,
  firms,
  REJECT_REASONS,
  uploads,
  workers,
  type RejectReason,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeUserMay, parts, type OfficeContext } from "../office/office-context";
import { addDays, localDateOf } from "../time/zoned";

// The office checks a casual's upload (docs/office-v2.md 3.7, 6.1; S6, S7, D3; 12F.2): a named
// admin or resourcer, active, of the casual's firm. Server only.
// - approveUpload: a photo becomes her staff photo; a certificate's record becomes the office's own
//   (check_state verified, filling verified_at and verified_by) with the expiry date and number as
//   the person read them from the card (no text is ever read from an image by code). A date already
//   gone is refused (that one is rejected as expired instead), and so is one more than 10 years
//   ahead (a typo). No date at all only when the person ticks that the card has none: a forgotten
//   date must never make a licence valid for ever.
// - rejectUpload: with a reason code (blurry, wrong document, expired, doesn't match, other); the
//   record says why, so her Profile shows "Not accepted: …".
// - recordCsas: CSAS is recorded by the office only (Police Reform Act 2002 s.41), after the person
//   confirms it's under this firm's own scheme.
// Only a waiting upload can be checked, once (the row is locked; a second click finds it checked).
// Logged `upload.approved` {workerId, kind, qualificationType, expiresOn} and `upload.rejected`
// {workerId, kind, qualificationType, reason}; `credential.added` {workerId, type, via, ownScheme}
// for CSAS. The number is never logged.

export type CheckResult =
  | { status: "approved" | "rejected" | "recorded" }
  | { status: "not_waiting" } // already checked, replaced or deleted
  | { status: "invalid" } // a date or number that isn't one
  | { status: "date_passed" } // approving a card whose expiry date has gone
  | { status: "date_needed" } // no date, and not ticked as having none
  | { status: "not_confirmed" } // CSAS without confirming it's under this firm's scheme
  | { status: "not_allowed" };

const isoDate = z.iso.date();
const NUMBER_MAX = 50;
export const approveSchema = z.strictObject({
  expiresOn: z.union([isoDate, z.literal("")]),
  noExpiry: z.boolean(),
  number: z.string().max(NUMBER_MAX),
});
// A date further ahead than this is a typo (no UK licence or card lasts 10 years).
const MAX_AHEAD_DAYS = 3660;
export const rejectSchema = z.strictObject({ reason: z.enum(REJECT_REASONS) });
export const csasSchema = z.strictObject({
  expiresOn: z.union([isoDate, z.literal("")]),
  noExpiry: z.boolean(),
  number: z.string().max(NUMBER_MAX),
  ownScheme: z.boolean(),
});

// What's wrong with an expiry date as typed, if anything, on the firm's today.
function dateProblem(
  expiresOn: string | null,
  noExpiry: boolean,
  today: string,
): CheckResult | null {
  if (expiresOn === null) return noExpiry ? null : { status: "date_needed" };
  if (noExpiry) return { status: "invalid" }; // a date and "no expiry date" both: which is it?
  if (addDays(expiresOn, 0) !== expiresOn) return { status: "invalid" };
  if (expiresOn < today) return { status: "date_passed" };
  if (expiresOn > addDays(today, MAX_AHEAD_DAYS)) return { status: "invalid" };
  return null;
}

const today = async (tx: FirmTx, now: Date) => {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return localDateOf(now, firm?.timezone ?? "Europe/London");
};

// The casual's row first, then the upload: the order saving one, erasure and recording CSAS take,
// so a resend, a check and an erasure take turns. A check never deadlocks with an erasure, and a
// resend never deletes one just checked (src/lib/uploads/save.ts deletes only a waiting one).
async function lockWaiting(tx: FirmTx, uploadId: string) {
  const [found] = await tx
    .select({ workerId: uploads.workerId })
    .from(uploads)
    .where(eq(uploads.id, uploadId));
  if (!found) return null;
  await tx
    .select({ id: workers.id })
    .from(workers)
    .where(eq(workers.id, found.workerId))
    .for("no key update");
  const [upload] = await tx
    .select({
      id: uploads.id,
      workerId: uploads.workerId,
      kind: uploads.kind,
      type: uploads.credentialType,
    })
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.status, "waiting")))
    .for("update");
  return upload ?? null;
}

export async function approveUpload(
  ctx: OfficeContext,
  uploadId: string,
  input: z.infer<typeof approveSchema>,
): Promise<CheckResult> {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const expiresOn = parsed.data.expiresOn || null;
  const number = parsed.data.number.trim() || null;
  const { run, by } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx): Promise<CheckResult> => {
    if (!(await officeUserMay(tx, by.id, "casuals"))) return { status: "not_allowed" };
    const upload = await lockWaiting(tx, uploadId);
    if (!upload) return { status: "not_waiting" };
    if (upload.kind === "certificate") {
      const problem = dateProblem(expiresOn, parsed.data.noExpiry, await today(tx, now));
      if (problem) return problem;
    }
    await tx
      .update(uploads)
      .set({ status: "approved", checkedBy: by.id, checkedAt: now })
      .where(eq(uploads.id, upload.id));
    if (upload.kind === "certificate") {
      const changed = await tx
        .update(credentials)
        .set({
          checkState: "verified",
          status: "valid",
          expiresOn,
          number,
          verifiedAt: now,
          verifiedBy: by.id,
          expiryWarnedFor: null,
          expiryWarnedDays: null,
        })
        .where(
          and(eq(credentials.evidenceUploadId, upload.id), eq(credentials.checkState, "waiting")),
        )
        .returning({ id: credentials.id });
      if (changed.length !== 1) throw new Error("a waiting certificate without its waiting record");
    }
    await recordEvent(tx, {
      actorType: "office",
      actorId: by.id,
      action: "upload.approved",
      entityType: "upload",
      entityId: upload.id,
      data: {
        workerId: upload.workerId,
        kind: upload.kind,
        ...(upload.type ? { qualificationType: upload.type, expiresOn } : {}),
      },
    });
    return { status: "approved" };
  });
}

export async function rejectUpload(
  ctx: OfficeContext,
  uploadId: string,
  reason: RejectReason,
): Promise<CheckResult> {
  const parsed = rejectSchema.safeParse({ reason });
  if (!parsed.success) return { status: "invalid" };
  const { run, by } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx): Promise<CheckResult> => {
    if (!(await officeUserMay(tx, by.id, "casuals"))) return { status: "not_allowed" };
    const upload = await lockWaiting(tx, uploadId);
    if (!upload) return { status: "not_waiting" };
    await tx
      .update(uploads)
      .set({
        status: "rejected",
        rejectReason: parsed.data.reason,
        checkedBy: by.id,
        checkedAt: now,
      })
      .where(eq(uploads.id, upload.id));
    if (upload.kind === "certificate") {
      await tx
        .update(credentials)
        .set({ checkState: "rejected", rejectedReason: parsed.data.reason })
        .where(
          and(eq(credentials.evidenceUploadId, upload.id), eq(credentials.checkState, "waiting")),
        );
    }
    await recordEvent(tx, {
      actorType: "office",
      actorId: by.id,
      action: "upload.rejected",
      entityType: "upload",
      entityId: upload.id,
      data: {
        workerId: upload.workerId,
        kind: upload.kind,
        ...(upload.type ? { qualificationType: upload.type } : {}),
        reason: parsed.data.reason,
      },
    });
    return { status: "rejected" };
  });
}

export const CSAS = "CSAS";

export async function recordCsas(
  ctx: OfficeContext,
  workerId: string,
  input: z.infer<typeof csasSchema>,
): Promise<CheckResult> {
  const parsed = csasSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  if (!parsed.data.ownScheme) return { status: "not_confirmed" };
  const expiresOn = parsed.data.expiresOn || null;
  const number = parsed.data.number.trim() || null;
  const { run, by } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx): Promise<CheckResult> => {
    if (!(await officeUserMay(tx, by.id, "casuals"))) return { status: "not_allowed" };
    const [worker] = await tx
      .select({ status: workers.status, erasedAt: workers.erasedAt })
      .from(workers)
      .where(eq(workers.id, workerId))
      .for("no key update");
    if (!worker || worker.erasedAt !== null) return { status: "not_allowed" };
    const problem = dateProblem(expiresOn, parsed.data.noExpiry, await today(tx, now));
    if (problem) return problem;
    const [added] = await tx
      .insert(credentials)
      .values({
        firmId: sql`app_current_firm_id()`,
        workerId,
        type: CSAS,
        status: "valid",
        expiresOn,
        number,
        verifiedAt: now,
        verifiedBy: by.id,
      })
      .returning({ id: credentials.id });
    if (!added) throw new Error("credential insert returned nothing");
    await recordEvent(tx, {
      actorType: "office",
      actorId: by.id,
      action: "credential.added",
      entityType: "credential",
      entityId: added.id,
      data: { workerId, type: CSAS, via: "office", ownScheme: true },
    });
    return { status: "recorded" };
  });
}
