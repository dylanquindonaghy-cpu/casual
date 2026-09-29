import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { retryAborted } from "../db/retry";
import { assignments, firms, offers, shifts, sites, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { queueFirmChangeNotice } from "../notices/firm-change";
import { OVERRIDABLE_CODES, type RuleCode } from "../rules/eligibility";
import { officeCanPlace, previewBooking, rosterId } from "./book";
import { FIRM_CHANGE_REASON_CODES, FIRM_CHANGE_REASONS } from "./firm-reasons";
import { noticeHours } from "./notice";
import { isoDate, timesOn } from "./shift-times";

// The office moving or shortening a shift people are booked on (docs/api-and-jobs.md,
// "Firm-initiated changes"; golden rule 12). One transaction: an active admin or resourcer; the
// shift locked (shift first, as every booking); not a Google Sheet's, not started, not cancelled;
// the new start still ahead. A reason from the fixed list is required.
//
// - Curtailed when the new times sit inside the old ones at the same site (a shorter shift);
//   otherwise moved (the Sheets sync's rule).
// - Each confirmed worker: shift.curtailed / shift.moved {by: "firm", shiftId, workerId, reason,
//   old and new times, old and new site, noticeHours counted from the old start}, and a
//   firm-change-notice job to tell them. The shift itself: shift.changed {by: "firm", fields,
//   from/to}. Offers still out describe the old shift, so they expire.
// - Before anything is logged, the rules are run for each booked worker at the new time (the
//   shift itself is left out of their other bookings). If anyone fails a check the office can't
//   override (a credential not in date through the new day, their role, …), the move is refused
//   and nothing changes: the office cancels those bookings first, with notice (golden rule 6).
//   The refusal is logged (shift.move_refused {by, reason, workers: [{workerId, codes}]}). No
//   answer for someone (their record missing) counts as such a no.
//   Anyone failing only checks the office may override (rest, weekly hours, a day off) stays
//   booked and is listed for the office. Every worker's event records the rules' answer
//   (rulesOk, codes).

export const moveShiftRequestSchema = z.strictObject({
  shiftId: rosterId,
  date: z.string().max(20),
  start: z.string().max(10),
  end: z.string().max(10),
  siteId: z.string().max(100), // "" for no site
  reason: z.enum(FIRM_CHANGE_REASON_CODES),
  by: z.strictObject({ type: z.literal("office"), id: rosterId }),
});
export type MoveShiftRequest = z.input<typeof moveShiftRequestSchema>;

export type MoveShiftResult =
  | {
      status: "moved" | "curtailed";
      told: number; // booked workers, each told
      noticeHours: number;
      warnings: { workerId: string; name: string; reasons: string[] }[];
    }
  | { status: "unchanged" }
  // Someone booked couldn't work it at the new time for a reason the office can't override (a
  // credential, their role): nothing changed. Cancel those bookings first (with notice).
  | { status: "blocked"; workers: { workerId: string; name: string; reasons: string[] }[] }
  | { status: "invalid"; problem: "bad_date" | "bad_time" | "in_past" | "bad_site" }
  | { status: "not_open" } // started or cancelled
  | { status: "sheet" }
  | { status: "not_found" }
  | { status: "not_allowed" };

async function siteExists(tx: FirmTx, siteId: string): Promise<boolean> {
  if (!z.uuid().safeParse(siteId).success) return false;
  const [site] = await tx.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId));
  return site !== undefined;
}

export async function moveShiftByFirm(
  run: WithFirm,
  firmId: string,
  raw: MoveShiftRequest,
  deps: { clock?: Clock } = {},
): Promise<MoveShiftResult> {
  const request = moveShiftRequestSchema.parse(raw);
  const now = (deps.clock ?? systemClock).now();
  const reason = FIRM_CHANGE_REASONS[request.reason];
  try {
    return await retryAborted(() =>
      run(firmId, async (tx): Promise<MoveShiftResult> => {
        if (!(await officeCanPlace(tx, request.by.id))) return { status: "not_allowed" };
        const [shift] = await tx
          .select({
            source: shifts.source,
            status: shifts.status,
            startsAt: shifts.startsAt,
            endsAt: shifts.endsAt,
            siteId: shifts.siteId,
          })
          .from(shifts)
          .where(eq(shifts.id, request.shiftId))
          .for("no key update");
        if (!shift) return { status: "not_found" };
        if (shift.source === "sheets") return { status: "sheet" };
        if (shift.status === "cancelled" || shift.startsAt.getTime() <= now.getTime()) {
          return { status: "not_open" };
        }
        const [firm] = await tx
          .select({ timezone: firms.timezone })
          .from(firms)
          .where(eq(firms.id, sql`app_current_firm_id()`));
        const date = isoDate(request.date);
        if (!date) return { status: "invalid", problem: "bad_date" };
        const times = timesOn(date, request.start, request.end, firm?.timezone ?? "Europe/London");
        if (!times) return { status: "invalid", problem: "bad_time" };
        if (times.startsAt.getTime() <= now.getTime())
          return { status: "invalid", problem: "in_past" };
        const siteId = request.siteId.trim() || null;
        if (siteId && siteId !== shift.siteId && !(await siteExists(tx, siteId))) {
          return { status: "invalid", problem: "bad_site" };
        }
        const timesChanged =
          times.startsAt.getTime() !== shift.startsAt.getTime() ||
          times.endsAt.getTime() !== shift.endsAt.getTime();
        const siteChanged = siteId !== shift.siteId;
        if (!timesChanged && !siteChanged) return { status: "unchanged" };
        const curtailed =
          !siteChanged &&
          times.startsAt.getTime() >= shift.startsAt.getTime() &&
          times.endsAt.getTime() <= shift.endsAt.getTime();
        const notice = noticeHours(shift.startsAt, now);

        await tx
          .update(shifts)
          .set({ ...times, siteId })
          .where(eq(shifts.id, request.shiftId));

        const holders = await tx
          .select({
            assignmentId: assignments.id,
            workerId: assignments.workerId,
            first: workers.firstName,
            last: workers.lastName,
          })
          .from(assignments)
          .innerJoin(
            workers,
            and(eq(workers.firmId, assignments.firmId), eq(workers.id, assignments.workerId)),
          )
          .where(
            and(
              eq(assignments.shiftId, request.shiftId),
              eq(assignments.status, "confirmed"),
              isNotNull(assignments.workerId),
            ),
          )
          .orderBy(asc(assignments.slot));
        // Can each of them still work it? The rules at the new time, before anything is logged.
        const checks = new Map<string, { ok: boolean; codes: RuleCode[]; reasons: string[] }>();
        for (const h of holders) {
          if (!h.workerId) continue;
          const verdict = await previewBooking(tx, {
            shiftId: request.shiftId,
            workerId: h.workerId,
            now,
          });
          // No answer (their record is missing) counts as a no the office can't override.
          checks.set(
            h.workerId,
            verdict ?? { ok: false, codes: [], reasons: ["Their record couldn't be checked."] },
          );
        }
        const overridable = (codes: RuleCode[]) =>
          codes.length > 0 &&
          codes.every((c) => (OVERRIDABLE_CODES as readonly string[]).includes(c));
        const blocked = holders.filter((h) => {
          const c = h.workerId ? checks.get(h.workerId) : undefined;
          return c && !c.ok && !overridable(c.codes);
        });
        if (blocked.length > 0) {
          throw new MoveBlocked(
            blocked.map((h) => ({
              workerId: h.workerId ?? "",
              name: `${h.first} ${h.last}`,
              reasons: (h.workerId && checks.get(h.workerId)?.reasons) || [],
              codes: (h.workerId && checks.get(h.workerId)?.codes) || [],
            })),
          );
        }
        await tx
          .update(offers)
          .set({ response: "expired", respondedAt: now })
          .where(and(eq(offers.shiftId, request.shiftId), isNull(offers.response)));

        const moved = {
          oldStartsAt: shift.startsAt.toISOString(),
          oldEndsAt: shift.endsAt.toISOString(),
          newStartsAt: times.startsAt.toISOString(),
          newEndsAt: times.endsAt.toISOString(),
          oldSiteId: shift.siteId,
          newSiteId: siteId,
        };
        for (const h of holders) {
          const eventId = await recordEvent(tx, {
            actorType: "office",
            actorId: request.by.id,
            action: curtailed ? "shift.curtailed" : "shift.moved",
            entityType: "assignment",
            entityId: h.assignmentId,
            data: {
              by: "firm",
              shiftId: request.shiftId,
              workerId: h.workerId,
              reason,
              ...moved,
              noticeHours: notice,
              // The rules' answer at the new time (codes only): what the office was shown.
              rulesOk: h.workerId ? (checks.get(h.workerId)?.ok ?? false) : false,
              ...(h.workerId && !checks.get(h.workerId)?.ok
                ? { codes: checks.get(h.workerId)?.codes ?? [] }
                : {}),
            },
          });
          await queueFirmChangeNotice(tx, { eventId, assignmentId: h.assignmentId });
        }
        await recordEvent(tx, {
          actorType: "office",
          actorId: request.by.id,
          action: "shift.changed",
          entityType: "shift",
          entityId: request.shiftId,
          data: {
            by: "firm",
            fields: [
              ...(siteChanged ? ["siteId"] : []),
              ...(times.startsAt.getTime() !== shift.startsAt.getTime() ? ["startsAt"] : []),
              ...(times.endsAt.getTime() !== shift.endsAt.getTime() ? ["endsAt"] : []),
            ],
            reason,
            from: { startsAt: moved.oldStartsAt, endsAt: moved.oldEndsAt, siteId: moved.oldSiteId },
            to: { startsAt: moved.newStartsAt, endsAt: moved.newEndsAt, siteId: moved.newSiteId },
          },
        });

        const warnings = holders
          .filter((h) => h.workerId && !checks.get(h.workerId)?.ok)
          .map((h) => ({
            workerId: h.workerId ?? "",
            name: `${h.first} ${h.last}`,
            reasons: (h.workerId && checks.get(h.workerId)?.reasons) || [],
          }));
        return {
          status: curtailed ? "curtailed" : "moved",
          told: holders.length,
          noticeHours: notice,
          warnings,
        };
      }),
    );
  } catch (error) {
    if (!(error instanceof MoveBlocked)) throw error;
    // The whole transaction rolled back: nothing moved, nothing queued. The refusal itself is
    // logged in a short transaction of its own (ids and rule codes only), so the office's attempt
    // and the rules' answer are on the record.
    await run(firmId, (tx) =>
      recordEvent(tx, {
        actorType: "office",
        actorId: request.by.id,
        action: "shift.move_refused",
        entityType: "shift",
        entityId: request.shiftId,
        data: {
          by: "firm",
          reason,
          workers: error.workers.map((w) => ({ workerId: w.workerId, codes: w.codes })),
        },
      }),
    );
    return {
      status: "blocked",
      workers: error.workers.map(({ workerId, name, reasons }) => ({ workerId, name, reasons })),
    };
  }
}

class MoveBlocked extends Error {
  constructor(
    readonly workers: { workerId: string; name: string; reasons: string[]; codes: RuleCode[] }[],
  ) {
    super("move blocked by the rules");
  }
}
