import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { assignments, requests, shifts } from "../db/schema";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { previewBooking } from "../roster/book";
import { isVisibleToCasuals } from "../roster/visibility";
import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import type { PortalContext } from "./my-shifts";
import {
  MAX_REASON,
  MAX_REQUEST_NOTE,
  MAX_REVIEW_ITEMS,
  reviewPayloadSchema,
  type ReviewOutcome,
} from "./request-kinds";
import { refOf, takenPlaces, waitingReview } from "./shift-detail";
import { cutUnits } from "../text/cut";

// "Ask the office to review" on the blocked-shift screen (docs/screens.md, `/shifts/[id]`): the
// worker asks the office to look again at a shift the rules won't let them take. Server only.
//
// Code decides whether there is anything to review (golden rule 1): under a lock on the shift row,
// the shift must be open, not started, shown to casuals (src/lib/roster/visibility.ts), with a
// place left and not already theirs, and the rules
// must still say no on the current rows (if they now say yes, it may still be held by fair
// rotation: the answer only says it isn't blocked). Then one `review` request is added (one
// waiting per worker and shift: asking again gives the waiting one's reference) with the rules'
// codes, the reasons the worker saw and their optional note, and a request.created event holding
// ids, the type and the rules' codes (the note and reasons stay on the row). The review never books anyone and never
// loosens a rule: the office decides (Phase 5).

type Ctx = PortalContext & { firm: { id: string; timezone: string; signOff: string } };

const uuid = z.uuid();
const noteSchema = z.string().trim().max(MAX_REQUEST_NOTE);

export async function askForReview(
  ctx: Ctx,
  workerId: string,
  shiftId: string,
  rawNote: string,
): Promise<ReviewOutcome> {
  const note = noteSchema.safeParse(rawNote);
  if (!note.success) return { status: "invalid" };
  if (!uuid.safeParse(shiftId).success || !uuid.safeParse(workerId).success) {
    return { status: "not_open" };
  }
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    // The shift row, locked: two taps can't both find no waiting review and both add one.
    const [shift] = await tx
      .select({ status: shifts.status, startsAt: shifts.startsAt, headcount: shifts.headcount })
      .from(shifts)
      .where(eq(shifts.id, shiftId))
      .for("no key update");
    if (!shift || shift.status !== "open" || shift.startsAt.getTime() <= now.getTime()) {
      return { status: "not_open" };
    }
    // Hidden from casuals (the session's switch or its event's, after the page was opened): as if it
    // weren't there. The event is share-locked, as a booking does.
    if (!(await isVisibleToCasuals(tx, shiftId, { lock: true }))) return { status: "not_open" };
    const [mine] = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.shiftId, shiftId),
          eq(assignments.workerId, workerId),
          inArray(assignments.status, ["confirmed", "completed", "no_show"]),
        ),
      );
    if (mine) return { status: "already_booked" };
    const { rows: counted } = await takenPlaces(tx, shiftId);
    if ((counted[0]?.taken ?? 0) >= shift.headcount) return { status: "not_open" };

    const verdict = await previewBooking(tx, { shiftId, workerId, now });
    if (!verdict) return { status: "not_open" };
    if (verdict.ok) return { status: "eligible_now" };

    const waiting = await waitingReview(tx, workerId, shiftId);
    if (waiting) return { status: "already_open", ref: refOf(waiting.id) };

    // Cut to size rather than refuse: an unusually long role name must not stop a review.
    const payload = reviewPayloadSchema.parse({
      codes: verdict.codes.slice(0, MAX_REVIEW_ITEMS),
      // Cut between characters, within the schema's UTF-16 count (13.5). Defensive: with today's
      // sentences a name (at most 100 characters) ends long before unit 300.
      reasons: verdict.reasons.slice(0, MAX_REVIEW_ITEMS).map((r) => cutUnits(r, MAX_REASON)),
      note: note.data,
    });
    const [created] = await tx
      .insert(requests)
      .values({ firmId: ctx.firm.id, workerId, shiftId, type: "review", payload })
      .returning({ id: requests.id });
    if (!created) throw new Error("review insert returned nothing");
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: "request.created",
      entityType: "request",
      entityId: created.id,
      data: { type: "review", shiftId, codes: payload.codes },
    });
    const w = wallTimeOf(now, ctx.firm.timezone);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      status: "created",
      ref: refOf(created.id),
      sentAt: `${pad(w.hour)}:${pad(w.minute)} on ${dayLabel(localDateOf(now, ctx.firm.timezone))}`,
      signOff: ctx.firm.signOff,
    };
  });
}
