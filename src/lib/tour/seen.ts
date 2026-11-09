import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { DEMO_CASUAL_VIEW_ACTION } from "../demo/staff-login";
import { events, officeUsers, workers } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeUserMay } from "../office/office-context";

// The first-login tours (Phase 33.1; docs/screens.md "## Phase 33"): when each office user and each
// casual has finished or skipped theirs is kept on their own row (`tour_seen_at`), so it opens by
// itself once, on any device. Only the person themselves writes it: the id is always the session's
// own (the actions in src/app/office/tour-actions.ts and src/app/tour-actions.ts), inside withFirm,
// so another firm's person is invisible here. Idempotent: only the first time changes the row and
// logs it; "Take the tour again" and its end change nothing. The log holds ids only.

export const TOUR_OUTCOMES = ["finished", "skipped"] as const;
export type TourOutcome = (typeof TOUR_OUTCOMES)[number];
export const TourOutcomeSchema = z.enum(TOUR_OUTCOMES);

export const TOUR_ACTIONS = {
  finished: "tour.finished",
  skipped: "tour.skipped",
} as const satisfies Record<TourOutcome, string>;

export interface TourContext {
  firm: { id: string };
  run?: WithFirm; // tests pass a withFirm on their own pool
}

// "marked": the row changed and was logged; "already": it was already set (nothing written);
// "not_found": no such person in this firm (another firm's, or gone); "not_allowed": an office user
// the tour isn't offered to (no dashboard: payroll; or switched off), so nothing written;
// "demo_view": the demo's "Casual mobile view" (an office user looking at Zoe's app), so nothing
// written and nothing logged as her.
export type MarkTourResult = "marked" | "already" | "not_found" | "not_allowed" | "demo_view";

export async function markOfficeTourSeen(
  ctx: TourContext,
  officeUserId: string,
  outcome: TourOutcome,
): Promise<MarkTourResult> {
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx): Promise<MarkTourResult> => {
    // Only where the tour is offered: the roles with a dashboard (src/app/office/layout.tsx).
    if (!(await officeUserMay(tx, officeUserId, "today"))) {
      const [there] = await tx
        .select({ id: officeUsers.id })
        .from(officeUsers)
        .where(eq(officeUsers.id, officeUserId));
      return there ? "not_allowed" : "not_found";
    }
    const changed = await tx
      .update(officeUsers)
      .set({ tourSeenAt: new Date() })
      .where(and(eq(officeUsers.id, officeUserId), isNull(officeUsers.tourSeenAt)))
      .returning({ id: officeUsers.id });
    if (changed.length === 0) {
      const [there] = await tx
        .select({ id: officeUsers.id })
        .from(officeUsers)
        .where(eq(officeUsers.id, officeUserId));
      return there ? "already" : "not_found";
    }
    await recordEvent(tx, {
      actorType: "office",
      actorId: officeUserId,
      action: TOUR_ACTIONS[outcome],
      entityType: "office_user",
      entityId: officeUserId,
      data: { kind: "office" },
    });
    return "marked";
  });
}

// `sessionId`: the casual's session the request came with (Phase 33.3). The demo's "Casual mobile
// view" (src/lib/demo/staff-session.ts openCasualView, Phase 31.2) gives an office user a session as
// the demo casual, Zoe; the tour shows there (staff want to see it), but finishing or skipping it
// must not mark Zoe's row or log an entry as her. Such a session is the one named by the
// auth.demo_casual_view entry written with it (DEMO_CASUAL_VIEW_ACTION): no new column.
export async function markCasualTourSeen(
  ctx: TourContext,
  workerId: string,
  outcome: TourOutcome,
  sessionId: string,
): Promise<MarkTourResult> {
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx): Promise<MarkTourResult> => {
    const [view] = await tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.entityId, sessionId),
          eq(events.entityType, "session"),
          eq(events.action, DEMO_CASUAL_VIEW_ACTION),
        ),
      )
      .limit(1);
    if (view) return "demo_view";
    const changed = await tx
      .update(workers)
      .set({ tourSeenAt: new Date() })
      .where(and(eq(workers.id, workerId), isNull(workers.tourSeenAt), isNull(workers.erasedAt)))
      .returning({ id: workers.id });
    if (changed.length === 0) {
      const [there] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(and(eq(workers.id, workerId), isNull(workers.erasedAt)));
      return there ? "already" : "not_found";
    }
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: TOUR_ACTIONS[outcome],
      entityType: "worker",
      entityId: workerId,
      data: { kind: "casual" },
    });
    return "marked";
  });
}
