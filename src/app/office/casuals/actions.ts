"use server";

import { z } from "zod";
import type { FindWorkersResult } from "@/app/office/find-worker-form";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { SITE_BLOCK_REASONS } from "@/lib/db/schema";
import { findWorkers } from "@/lib/gdpr/worker-export";
import type { OfficeContext } from "@/lib/office/office-context";
import {
  blockFromSite,
  changeWorkerStatus,
  signOutWorker,
  unblockFromSite,
  type SignOutResult,
  type SiteBlockResult,
  type WorkerStatusChange,
  type WorkerStatusResult,
} from "@/lib/office/worker-access";
import {
  codesOf,
  DEACTIVATE_REASONS,
  REACTIVATE_REASONS,
  SITE_UNBLOCK_REASONS,
  UNBLOCK_REASONS,
} from "@/lib/office/worker-reasons";
import type { CheckOutcome } from "@/lib/portal/upload-copy";
import { requestLog } from "@/lib/request";
import {
  approveSchema,
  approveUpload,
  csasSchema,
  recordCsas,
  rejectSchema,
  rejectUpload,
} from "@/lib/uploads/check";

// A casual's access (docs/screens.md `/office/casuals`, `/office/casuals/[id]`; Workers until 12F.1). The firm comes
// from the request's host and the office user from their session (an admin or resourcer: checked
// here, and again inside each change). Input is checked with zod first; a reason is always one
// from the fixed list. Results are shown in place.

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

async function asOffice<T>(
  label: string,
  work: (ctx: OfficeContext) => Promise<T>,
): Promise<T | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "casuals")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

// Finding a worker: a server action, so a typed mobile never goes in the address or a log.
export async function findWorkersAction(raw: unknown): Promise<FindWorkersResult> {
  const parsed = z.string().max(1_000).safeParse(raw);
  if (!parsed.success) return { status: "found", matches: [] };
  const result = await asOffice("find workers", (ctx) => findWorkers(ctx, parsed.data, "casuals"));
  if (result === null) return { status: "not_allowed" };
  if ("status" in result) return result;
  return { status: "found", matches: result };
}

const id = z.uuid();
const statusInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("deactivate"), reason: z.enum(codesOf(DEACTIVATE_REASONS)) }),
  z.strictObject({ kind: z.literal("reactivate"), reason: z.enum(codesOf(REACTIVATE_REASONS)) }),
  z.strictObject({ kind: z.literal("unblock"), reason: z.enum(codesOf(UNBLOCK_REASONS)) }),
]);

export async function changeWorkerStatusAction(
  workerId: unknown,
  change: unknown,
): Promise<WorkerStatusResult | Common | { status: "no_reason" }> {
  if (!id.safeParse(workerId).success) return { status: "not_found" };
  const c = statusInput.safeParse(change);
  if (!c.success) return { status: "no_reason" };
  const parsed: WorkerStatusChange = c.data;
  return asOffice("change worker status", (ctx) =>
    changeWorkerStatus(ctx, workerId as string, parsed),
  );
}

export async function signOutWorkerAction(workerId: unknown): Promise<SignOutResult | Common> {
  if (!id.safeParse(workerId).success) return { status: "not_found" };
  return asOffice("sign out worker", (ctx) => signOutWorker(ctx, workerId as string));
}

export async function blockFromSiteAction(
  workerId: unknown,
  siteId: unknown,
  reason: unknown,
): Promise<SiteBlockResult | Common | { status: "no_reason" }> {
  if (!id.safeParse(workerId).success) return { status: "not_found" };
  if (!id.safeParse(siteId).success) return { status: "no_site" };
  const r = z.enum(SITE_BLOCK_REASONS).safeParse(reason);
  if (!r.success) return { status: "no_reason" };
  return asOffice("block from site", (ctx) =>
    blockFromSite(ctx, workerId as string, siteId as string, r.data),
  );
}

export async function unblockFromSiteAction(
  workerId: unknown,
  siteId: unknown,
  reason: unknown,
): Promise<SiteBlockResult | Common | { status: "no_reason" }> {
  if (!id.safeParse(workerId).success) return { status: "not_found" };
  if (!id.safeParse(siteId).success) return { status: "no_site" };
  const r = z.enum(codesOf(SITE_UNBLOCK_REASONS)).safeParse(reason);
  if (!r.success) return { status: "no_reason" };
  return asOffice("unblock from site", (ctx) =>
    unblockFromSite(ctx, workerId as string, siteId as string, r.data),
  );
}

// Checking a casual's photo or certificate (12F.2; src/lib/uploads/check.ts): approve with the
// expiry date and number as read from the card, reject with a reason from the fixed list, or (CSAS
// only) record it after confirming it's under this firm's own scheme.
const uploadId = z.uuid();

export async function approveUploadAction(
  id: unknown,
  expiresOn: unknown,
  noExpiry: unknown,
  number: unknown,
): Promise<CheckOutcome> {
  const parsedId = uploadId.safeParse(id);
  const input = approveSchema.safeParse({ expiresOn, noExpiry, number });
  if (!parsedId.success || !input.success) return { status: "invalid" };
  return asOffice("approve upload", (ctx) => approveUpload(ctx, parsedId.data, input.data));
}

export async function rejectUploadAction(id: unknown, reason: unknown): Promise<CheckOutcome> {
  const parsedId = uploadId.safeParse(id);
  const input = rejectSchema.safeParse({ reason });
  if (!parsedId.success || !input.success) return { status: "invalid" };
  return asOffice("reject upload", (ctx) => rejectUpload(ctx, parsedId.data, input.data.reason));
}

export async function recordCsasAction(
  workerId: unknown,
  expiresOn: unknown,
  noExpiry: unknown,
  number: unknown,
  ownScheme: unknown,
): Promise<CheckOutcome> {
  const parsedId = uploadId.safeParse(workerId);
  const input = csasSchema.safeParse({ expiresOn, noExpiry, number, ownScheme });
  if (!parsedId.success || !input.success) return { status: "invalid" };
  return asOffice("record CSAS", (ctx) => recordCsas(ctx, parsedId.data, input.data));
}
