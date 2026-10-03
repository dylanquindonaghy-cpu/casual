"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import type { OfficeContext } from "@/lib/office/quick-actions";
import {
  assignWorker,
  cancelBookingByOffice,
  cancelShift,
  markAttended,
  markTheRestWorked,
  moveShift,
} from "@/lib/office/quick-actions";
import {
  createShifts,
  createShiftsSchema,
  editShift,
  editShiftSchema,
  type CreateShiftsResult,
  type EditShiftResult,
} from "@/lib/office/shift-editor";
import { importShiftsFile, type ShiftImportResult } from "@/lib/office/shift-import";
import {
  ATTENDANCE_OUTCOMES,
  type MarkAttendanceResult,
  type MarkRestWorkedResult,
} from "@/lib/roster/attendance";
import type { BookingResult } from "@/lib/roster/book";
import type { CancelBookingResult, CancelShiftResult } from "@/lib/roster/cancel";
import type { MoveShiftResult } from "@/lib/roster/firm-change";
import { FIRM_CHANGE_REASON_CODES, SHIFT_CHANGE_REASON_CODES } from "@/lib/roster/firm-reasons";
import { OVERRIDABLE_CODES } from "@/lib/rules/eligibility";
import { requestLog } from "@/lib/request";

// The office's shift screens. The firm comes from the request's host and the office user from
// their session (an admin or resourcer: checked here, and again inside each change). Input is
// checked with zod before anything else. Results are shown in place (no redirect()).

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

async function asOffice<T>(
  label: string,
  work: (ctx: OfficeContext) => Promise<T>,
): Promise<T | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "shifts")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

export async function createShiftsAction(raw: unknown): Promise<CreateShiftsResult | Common> {
  const input = createShiftsSchema.safeParse(raw);
  if (!input.success) return { status: "invalid", problems: [{ line: null, problem: "bad_form" }] };
  return asOffice("create shifts", (ctx) => createShifts(ctx, input.data));
}

export async function editShiftAction(
  shiftId: string,
  raw: unknown,
): Promise<EditShiftResult | Common> {
  const input = editShiftSchema.safeParse(raw);
  if (!z.uuid().safeParse(shiftId).success) return { status: "not_found" };
  if (!input.success) return { status: "invalid", problems: ["bad_form"] };
  return asOffice("edit shift", (ctx) => editShift(ctx, shiftId, input.data));
}

// The file, and "check" (a dry run) or "import".
export async function importShiftsAction(form: FormData): Promise<ShiftImportResult | Common> {
  const file = form.get("file");
  const mode = form.get("mode");
  if (!(file instanceof File) || (mode !== "check" && mode !== "import")) {
    return { status: "file_error", code: "empty" };
  }
  // The session is checked before the file is read.
  return asOffice("import shifts", async (ctx) =>
    importShiftsFile(ctx, new Uint8Array(await file.arrayBuffer()), mode === "check"),
  );
}

const assignSchema = z.strictObject({
  shiftId: z.uuid(),
  workerId: z.uuid(),
  override: z
    .strictObject({
      codes: z.array(z.enum(OVERRIDABLE_CODES)).min(1).max(OVERRIDABLE_CODES.length),
      reason: z.string().max(500),
    })
    .nullable(),
});

export async function assignAction(raw: unknown): Promise<BookingResult | Common> {
  const input = assignSchema.safeParse(raw);
  if (!input.success) return { status: "not_found" };
  const { shiftId, workerId, override } = input.data;
  return asOffice("assign", (ctx) => assignWorker(ctx, shiftId, workerId, override));
}

// A whole shift's reasons (cancel, move); one booking's own list is wider.
const reasonSchema = z.enum(SHIFT_CHANGE_REASON_CODES);
const bookingReasonSchema = z.enum(FIRM_CHANGE_REASON_CODES);

const moveSchema = z.strictObject({
  date: z.string().max(20),
  start: z.string().max(10),
  end: z.string().max(10),
  siteId: z.string().max(100),
  reason: reasonSchema,
});

// Move or shorten a booked shift: a reason from the list is required.
export async function moveShiftAction(
  shiftId: string,
  raw: unknown,
): Promise<MoveShiftResult | Common | { status: "no_reason" }> {
  if (!z.uuid().safeParse(shiftId).success) return { status: "not_found" };
  const input = moveSchema.safeParse(raw);
  if (!input.success) return { status: "no_reason" };
  return asOffice("move shift", (ctx) => moveShift(ctx, shiftId, input.data));
}

export async function cancelShiftAction(
  shiftId: string,
  reason: unknown,
): Promise<CancelShiftResult | Common | { status: "no_reason" }> {
  if (!z.uuid().safeParse(shiftId).success) return { status: "not_found" };
  const r = reasonSchema.safeParse(reason);
  if (!r.success) return { status: "no_reason" };
  return asOffice("cancel shift", (ctx) => cancelShift(ctx, shiftId, r.data));
}

export async function cancelBookingAction(
  shiftId: string,
  workerId: string,
  reason: unknown,
): Promise<CancelBookingResult | Common | { status: "no_reason" }> {
  if (!z.uuid().safeParse(shiftId).success || !z.uuid().safeParse(workerId).success) {
    return { status: "not_found" };
  }
  const r = bookingReasonSchema.safeParse(reason);
  if (!r.success) return { status: "no_reason" };
  return asOffice("cancel booking", (ctx) => cancelBookingByOffice(ctx, shiftId, workerId, r.data));
}

// Who worked it and who didn't attend (once it has started).
export async function markAttendanceAction(
  shiftId: string,
  workerId: string,
  outcome: unknown,
): Promise<MarkAttendanceResult | Common> {
  const o = z.enum(ATTENDANCE_OUTCOMES).safeParse(outcome);
  if (!z.uuid().safeParse(shiftId).success || !z.uuid().safeParse(workerId).success || !o.success) {
    return { status: "not_found" };
  }
  return asOffice("mark attendance", (ctx) => markAttended(ctx, shiftId, workerId, o.data));
}

export async function markRestWorkedAction(
  shiftId: string,
): Promise<MarkRestWorkedResult | Common> {
  if (!z.uuid().safeParse(shiftId).success) return { status: "not_found" };
  return asOffice("mark the rest worked", (ctx) => markTheRestWorked(ctx, shiftId));
}
