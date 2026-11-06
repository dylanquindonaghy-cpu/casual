import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import {
  CANCELLED_ASSIGNMENT_STATUSES,
  firms,
  offers,
  shiftEvents,
  shifts,
  sites,
} from "../db/schema";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { unansweredFor } from "../offers/close";
import { loadAllocationGates, parseAllocationSettings } from "../roster/allocation-input";
import { officeChooses } from "../roster/asks";
import { previewBookings } from "../roster/book";
import { pairKey } from "../roster/eligibility-input";
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
// anyway (src/lib/offers/candidates.ts), and she can still take it from the shift's page (or, on an
// event where the office chooses, ask for it there: `afterNo`).
//
// Each row says what the shift's page would let her do now (`take`), by the same checks in the
// same order as that page: the rules (previewBookings), then whether the office chooses
// (officeChooses, bookShift's own rule), then fair rotation's hold (loadAllocationGates). A row the
// rules now refuse is left out: it would open to "You can't take this shift".

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
  // What the shift's page would let her do now, by the same checks in the same order
  // (src/lib/portal/shift-detail.ts; bookShift re-checks them all): take it, only ask for it (the
  // office chooses for its event and she holds no offer still waiting: officeChooses), or take it
  // from opensAt (fair rotation holds it). An offer the rules now refuse her isn't listed.
  take: OfferTake;
  // After "No thanks" she holds no waiting offer of it, so on an event where the office chooses
  // she can only ask for it (officeChooses, src/lib/roster/asks.ts).
  afterNo: "take" | "ask";
}

export type OfferTake = { kind: "now" } | { kind: "ask" } | { kind: "held"; opensAt: Date };

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
        casualsAsk: shiftEvents.casualsAsk,
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
    const latest: typeof rows = [];
    for (const r of rows) {
      if (seen.has(r.shiftId)) continue;
      seen.add(r.shiftId);
      latest.push(r);
    }
    if (latest.length === 0) return [];
    // The rules now (her credentials may have lapsed since the offer went): the shift's page would
    // say "You can't take this shift", so it isn't listed as one she can take.
    const verdicts = await previewBookings(tx, {
      shiftIds: latest.map((r) => r.shiftId),
      workerIds: [workerId],
      now,
    });
    const allowed = latest
      .filter((r) => verdicts.get(pairKey(r.shiftId, workerId))?.ok === true)
      .slice(0, MAX_OFFERS);
    const asks = new Set<string>();
    for (const r of allowed) {
      if (await officeChooses(tx, r.shiftId, workerId)) asks.add(r.shiftId);
    }
    const [firm] = await tx
      .select({ settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, ctx.firm.id));
    const gates = await loadAllocationGates(
      tx,
      {
        shiftIds: allowed.filter((r) => !asks.has(r.shiftId)).map((r) => r.shiftId),
        workerId,
        now,
      },
      parseAllocationSettings(firm?.settings ?? {}),
    );
    return allowed.map(({ casualsAsk, ...r }): MyOffer => {
      const gate = gates.get(r.shiftId);
      const take: OfferTake = asks.has(r.shiftId)
        ? { kind: "ask" }
        : gate && !gate.ok
          ? { kind: "held", opensAt: gate.opensAt }
          : { kind: "now" };
      return {
        ...r,
        siteName: r.siteName ?? null,
        eventName: r.eventName ?? null,
        take,
        afterNo: casualsAsk === true ? "ask" : "take",
      };
    });
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
