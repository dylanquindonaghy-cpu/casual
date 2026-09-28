import { z } from "zod";
import { WORKER_STATUSES } from "../db/schema/people";
import { ROLE_PATTERN, SHIFT_SOURCES, SHIFT_STATUSES } from "../db/schema/roster";
import type { EligibilityPass } from "../rules/eligibility";

// The rota can live in different places (docs/architecture.md, Roster plugs): our own tables
// (native), a firm's Google Sheet, or CSV files. The app talks to all of them through one
// RosterPlug, bound to one firm. Every adapter must pass the shared contract suite in
// tests/helpers/roster-contract.ts.
//
// Reads return records keyed by `ref`, the source's own key: our worker or shift id for native,
// the sheet's or file's row key otherwise (stored as shifts.external_ref). Writes take our ids,
// because that is what the portal and office know; each adapter maps them to its source.
//
// A plug records; it doesn't decide. Eligibility (worker status, credentials, rest, hours, a
// shift already started) is the rules engine's job, checked by the caller before assign (golden
// rule 1): assign takes the EligibilityPass checkEligibility() issued for that worker and shift,
// and uses it up (consumeEligibilityPass), so nothing can book around the rules. The booking
// path is src/lib/roster/book.ts (bookShift for people, checkBooking for the Sheets sync).
//
// Transactions and the action log: adapters that write our tables (native) are built on the
// caller's withFirm transaction, so the caller's eligibility check, the assign or cancel, and the
// caller's events row (golden rule 5, written from the result: assignmentId, slot, noticeHours)
// commit or roll back together. A plug never opens its own transaction.
//
// needs_approval (a read-only source) means nothing was recorded: the caller must keep the
// pending change, with its cancel.at, for the office to apply (the approve queue comes later).

export type RosterSource = (typeof SHIFT_SOURCES)[number];

const role = z
  .string()
  .regex(new RegExp(ROLE_PATTERN), "roles are snake_case, e.g. door_supervisor");
const ref = z.string().trim().min(1).max(200);

// Adapters normalise what their source holds (e.g. "07700 900123") before parsing.
export const rosterStaffSchema = z.object({
  ref,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  mobileE164: z.string().regex(/^\+[1-9]\d{6,14}$/, "mobile numbers are E.164"),
  roles: z.array(role).max(50),
  status: z.enum(WORKER_STATUSES),
});
export type RosterStaff = z.infer<typeof rosterStaffSchema>;

export const rosterShiftSchema = z
  .object({
    ref,
    siteName: z.string().trim().min(1).max(200).nullable(),
    role,
    startsAt: z.date(),
    endsAt: z.date(),
    headcount: z.number().int().min(1).max(1000),
    status: z.enum(SHIFT_STATUSES),
    instructions: z.string().max(2000).nullable(),
    // Who holds each filled slot, by staff ref. Open slots are simply absent.
    assigned: z.array(z.object({ slot: z.number().int().min(1), staffRef: ref })),
  })
  .refine((s) => s.endsAt.getTime() > s.startsAt.getTime(), {
    message: "a shift must end after it starts",
    path: ["endsAt"],
  })
  .refine((s) => s.assigned.every((a) => a.slot <= s.headcount), {
    message: "slot numbers run from 1 to the headcount",
    path: ["assigned"],
  })
  .refine((s) => new Set(s.assigned.map((a) => a.slot)).size === s.assigned.length, {
    message: "each slot has one holder",
    path: ["assigned"],
  })
  .refine((s) => new Set(s.assigned.map((a) => a.staffRef)).size === s.assigned.length, {
    message: "one person holds at most one slot on a shift",
    path: ["assigned"],
  });
export type RosterShift = z.infer<typeof rosterShiftSchema>;

// getShifts(from, to): shifts starting at or after `from` and before `to`.
export const shiftWindowSchema = z
  .object({ from: z.date(), to: z.date() })
  .refine((w) => w.to.getTime() > w.from.getTime(), {
    message: "the window must end after it starts",
    path: ["to"],
  });

// Golden rule 12: a cancellation by the office is recorded like one by the worker, with a reason.
// `at` is when the person asked to cancel. Notice hours count from it, not from when the call
// runs, so a retried job or a delay never shrinks the notice a worker gave.
export const cancelInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  by: z.enum(["worker", "firm"]),
  at: z.date(),
});
export type CancelInput = z.infer<typeof cancelInputSchema>;

export type AssignResult =
  | { status: "assigned"; assignmentId: string; slot: number }
  // Every slot is taken: someone else said yes first (golden rule 4).
  | { status: "filled" }
  // This person already holds a slot on this shift.
  | { status: "already_assigned" }
  // A draft or cancelled shift can't be taken.
  | { status: "not_open" }
  // No such shift or person in this firm's rota.
  | { status: "not_found" }
  // A read-only source: nothing changed; the office applies it by hand.
  | { status: "needs_approval" };

export type CancelResult =
  // noticeHours: shift start minus cancel.at (src/lib/roster/notice.ts).
  | { status: "cancelled"; assignmentId: string; noticeHours: number }
  // The person holds no slot on this shift.
  | { status: "not_assigned" }
  | { status: "not_found" }
  | { status: "needs_approval" };

export interface RosterPlug {
  readonly source: RosterSource;
  // false: the source can be read but not written. assign and markCancelled then change nothing
  // and return needs_approval, so the office can apply the change with one tap.
  readonly canWrite: boolean;
  listStaff(): Promise<RosterStaff[]>;
  // Shifts starting in [from, to), every status (staff views must leave out drafts), each with
  // who holds which slot. Throws on a window that doesn't end after it starts.
  getShifts(from: Date, to: Date): Promise<RosterShift[]>;
  // First yes wins: fills the lowest free slot, or reports why not. Never double-assigns.
  // Throws unless `pass` is an unused EligibilityPass for exactly this worker and shift (checked
  // before anything else, and used up whatever the result).
  assign(shiftId: string, workerId: string, pass: EligibilityPass): Promise<AssignResult>;
  // Frees the person's slot (it can be taken again; the native plug doesn't reopen a place on a
  // shift that has started, since nobody can take it) and records the reason, who cancelled and
  // the notice hours counted from cancel.at. Throws on a blank reason, or a cancel.at later than
  // the plug's clock (notice can't be claimed for a request not made yet).
  markCancelled(shiftId: string, workerId: string, cancel: CancelInput): Promise<CancelResult>;
}
