import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { CANCELLED_ASSIGNMENT_STATUSES, firms, offers, shifts, sites, workers } from "../db/schema";
import { officeOfferCandidates, type OfficeCandidate } from "../offers/office-offer";
import { isVisibleToCasuals } from "../roster/visibility";

// "Offer to someone" for one shift (the dashboard's quick action): the shift, who could be offered it now
// (the candidate list: the booking rules, offer messages on, never offered it, the daily cap unless
// urgent) and who has been offered it already; nobody while it's hidden from casuals (the session's
// switch or its event's). Admins and resourcers; reads only.

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

export interface OfferPage {
  timeZone: string;
  shift: {
    shiftId: string;
    role: string;
    site: string | null;
    startsAt: Date;
    endsAt: Date;
    placesLeft: number;
    isUrgent: boolean;
    open: boolean; // open, not started, with a place free
    hidden: boolean; // hidden from casuals: it can't be offered (src/lib/roster/visibility.ts)
  };
  candidates: OfficeCandidate[];
  offered: {
    worker: string;
    wave: number | null; // null: sent by the office
    response: "accepted" | "declined" | "expired" | "filled_elsewhere" | "failed" | null;
    sentAt: Date;
  }[];
}

export async function officeOfferPage(
  ctx: AuthContext,
  token: string,
  shiftId: string,
): Promise<OfferPage | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "today")) return null;
  if (!z.uuid().safeParse(shiftId).success) return null;
  const { run, now } = authParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const [shift] = await tx
      .select({
        id: shifts.id,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        headcount: shifts.headcount,
        status: shifts.status,
        isUrgent: shifts.isUrgent,
        site: sites.name,
        timeZone: firms.timezone,
      })
      .from(shifts)
      .innerJoin(firms, eq(firms.id, shifts.firmId))
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .where(eq(shifts.id, shiftId));
    if (!shift || shift.status === "draft") return null;
    const { rows } = await tx.execute<{ taken: number }>(sql`
      select count(*)::int as taken from assignments
       where shift_id = ${shiftId} and worker_id is not null
         and status not in (${CANCELLED}) and slot <= ${shift.headcount}
    `);
    const placesLeft = Math.max(0, shift.headcount - (rows[0]?.taken ?? 0));
    const open =
      shift.status === "open" && placesLeft > 0 && shift.startsAt.getTime() > now.getTime();
    const hidden = !(await isVisibleToCasuals(tx, shiftId));
    const offered = await tx
      .select({
        first: workers.firstName,
        last: workers.lastName,
        wave: offers.wave,
        response: offers.response,
        sentAt: offers.sentAt,
      })
      .from(offers)
      .innerJoin(workers, and(eq(workers.firmId, offers.firmId), eq(workers.id, offers.workerId)))
      .where(eq(offers.shiftId, shiftId))
      .orderBy(asc(offers.sentAt), asc(workers.lastName));
    return {
      timeZone: shift.timeZone,
      shift: {
        shiftId: shift.id,
        role: shift.role,
        site: shift.site,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        placesLeft,
        isUrgent: shift.isUrgent,
        open,
        hidden,
      },
      candidates: open && !hidden ? await officeOfferCandidates(tx, shiftId, now) : [],
      offered: offered.map((o) => ({
        worker: `${o.first} ${o.last}`,
        wave: o.wave,
        response: o.response,
        sentAt: o.sentAt,
      })),
    };
  });
}
