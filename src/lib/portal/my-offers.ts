import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, offers, shiftEvents, shifts, sites } from "../db/schema";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { unansweredFor } from "../offers/close";
import { casualEventName } from "../roster/shift-events";
import { visibleToCasuals } from "../roster/visibility";
import type { PortalContext } from "./my-shifts";

// "Offered to you" on Home (Phase 28.15; docs/screens.md "### 28.15"): her offers still open to
// her, and her "No thanks". Which offers is the offers code's own rule, read here, never made up:
// her answer is still awaited, or her offer was closed only because the shift filled and a place
// is free again (unansweredFor, src/lib/offers/close.ts), on a session that is open, shown to
// casuals (src/lib/roster/visibility.ts), not started, with a place free and no place of hers.
// Offers have no deadline (they stay open until the shift fills, moves or is cancelled), so none is
// shown. Her own offers only: never who else was offered.
//
// "No thanks" is one conditional UPDATE under the same rule: response 'declined' and responded_at
// on her open offers of that shift, and offer.declined {offerId, shiftId, workerId} (ids only) for
// each, in the same transaction. Zero rows changes nothing. Nothing that decides or counts reads a
// decline (tests/unit/offers.decline-boundary.test.ts): the next wave never offers a shift twice
// anyway (src/lib/offers/candidates.ts), and she can still take it from Open shifts.

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));
const MAX_OFFERS = 20;

export interface MyOffer {
  offerId: string;
  shiftId: string;
  role: string;
  eventName: string | null; // as the casual pages name it (null for an automatic event)
  siteName: string | null;
  startsAt: Date;
  endsAt: Date;
  sentAt: Date; // when it was offered to her
}

// Still open to her, over `offers` and `shifts` (no aliases).
function openToHer(workerId: string, now: Date) {
  return and(
    eq(offers.workerId, workerId),
    unansweredFor(),
    eq(shifts.firmId, offers.firmId),
    eq(shifts.id, offers.shiftId),
    eq(shifts.status, "open"),
    gt(shifts.startsAt, now),
    visibleToCasuals,
    sql`(select count(*)::int from assignments a
          where a.firm_id = ${shifts.firmId} and a.shift_id = ${shifts.id}
            and a.worker_id is not null and a.status not in (${CANCELLED})
            and a.slot <= ${shifts.headcount}) < ${shifts.headcount}`,
    sql`not exists (select 1 from assignments a
          where a.firm_id = ${shifts.firmId} and a.shift_id = ${shifts.id}
            and a.worker_id = ${workerId} and a.status not in (${CANCELLED}))`,
  );
}

// Her open offers, one per session (the latest offer of it), soonest session first.
export async function myOffers(ctx: PortalContext, workerId: string): Promise<MyOffer[]> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const rows = await tx
      .select({
        offerId: offers.id,
        shiftId: offers.shiftId,
        sentAt: offers.sentAt,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        siteName: sites.name,
        eventName: casualEventName,
      })
      .from(offers)
      .innerJoin(shifts, and(eq(shifts.firmId, offers.firmId), eq(shifts.id, offers.shiftId)))
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .leftJoin(
        shiftEvents,
        and(eq(shiftEvents.firmId, shifts.firmId), eq(shiftEvents.id, shifts.shiftEventId)),
      )
      .where(openToHer(workerId, now))
      .orderBy(asc(shifts.startsAt), desc(offers.sentAt))
      .limit(MAX_OFFERS * 2);
    const seen = new Set<string>();
    const out: MyOffer[] = [];
    for (const r of rows) {
      if (seen.has(r.shiftId)) continue;
      seen.add(r.shiftId);
      out.push({ ...r, siteName: r.siteName ?? null, eventName: r.eventName ?? null });
    }
    return out.slice(0, MAX_OFFERS);
  });
}

export type DeclineOutcome =
  | { status: "declined" }
  | { status: "already" } // she said no to it before
  | { status: "taken" } // she holds the shift: her offer is accepted
  | { status: "closed" } // filled, moved, cancelled, started or hidden; or not her offer
  | { status: "logged_out" }
  | { status: "error" };

const uuid = z.uuid();

export async function declineOffer(
  ctx: PortalContext,
  workerId: string,
  offerId: string,
): Promise<DeclineOutcome> {
  if (!uuid.safeParse(offerId).success || !uuid.safeParse(workerId).success) {
    return { status: "closed" };
  }
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx): Promise<DeclineOutcome> => {
    // The session of her offer (nothing when the id isn't hers).
    const sessionOfHers = sql`(select o2.shift_id from offers o2
      where o2.id = ${offerId} and o2.worker_id = ${workerId})`;
    const changed = await tx
      .update(offers)
      .set({ response: "declined", respondedAt: now })
      .from(shifts)
      .where(and(sql`${offers.shiftId} = ${sessionOfHers}`, openToHer(workerId, now)))
      .returning({ id: offers.id, shiftId: offers.shiftId });
    for (const c of changed) {
      await recordEvent(tx, {
        actorType: "worker",
        actorId: workerId,
        action: "offer.declined",
        entityType: "offer",
        entityId: c.id,
        data: { offerId: c.id, shiftId: c.shiftId, workerId },
      });
    }
    if (changed.length > 0) return { status: "declined" };
    const answers = await tx
      .select({ response: offers.response })
      .from(offers)
      .where(
        and(
          eq(offers.workerId, workerId),
          sql`${offers.shiftId} = ${sessionOfHers}`,
          inArray(offers.response, ["accepted", "declined"]),
        ),
      );
    if (answers.some((a) => a.response === "accepted")) return { status: "taken" };
    if (answers.some((a) => a.response === "declined")) return { status: "already" };
    return { status: "closed" };
  });
}
