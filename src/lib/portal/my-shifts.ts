import { z } from "zod";
import { and, asc, count, desc, eq, gt, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { DAY, systemClock, type Clock } from "../auth/clock";
import { qualificationsFor } from "../credentials/qualifications";
import { RELIABILITY_DAYS } from "../rules/reliability";
import type { NeedsItem } from "../credentials/status";
import { assignments, firms, shiftEvents, shifts, sites } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
import type { TravelFacts } from "../travel/line-copy";
import { casualEventName } from "../roster/shift-events";
import { travelFor } from "../travel/lines";
import { travelOn } from "../travel/on";
import type { StaffPhoto } from "../uploads/photo";

// What the staff portal's My shifts page shows (docs/screens.md, `/`), for the logged-in worker
// only, inside their firm (RLS scopes every row to it).
//
// - Upcoming: bookings on shifts that haven't ended and aren't cancelled, soonest first. A shift
//   in progress still shows (the worker at the venue needs its instructions), even if the office
//   has already marked it (completed, or no-show for someone running late).
// - Past (Phase 28.13): confirmed, completed or no-show bookings on sessions that started within
//   RELIABILITY_DAYS (90) and have ended, newest first: the same window reliability counts, by
//   starts_at (src/lib/office/reliability.ts), so she can see what it counted. Including a shift
//   the sheet cancelled after it started (its bookings are history). Cancelled bookings show in
//   neither list (her shift record has them: src/lib/portal/my-record.ts).
// - Travel: each upcoming booking carries its travel facts, for the travel line (12G.3; the same
//   words as Open shifts). Past ones don't: the trip is done, and its estimates expire.
// - Needs updating (12F.1): the qualifications the worker's roles need that have expired, are
//   suspended or missing, expire within EXPIRING_SOON_DAYS, or stop a booked shift, in §4.2's
//   order. Not a type they've already replaced (a newer valid one) or are renewing (applied for).

// Past's window: reliability's own (Phase 28.13; it was 30 days).
export const PAST_DAYS = RELIABILITY_DAYS;

const LIVE = ["confirmed", "completed", "no_show"] as const;

export interface PortalContext {
  firm: { id: string };
  run?: WithFirm;
  clock?: Clock;
}

export interface MyShift {
  assignmentId: string;
  shiftId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  status: "confirmed" | "completed" | "no_show";
  instructions: string | null;
  // The session's own facts (12H.1: Home's next shift, in full). The event as the casual app names
  // it: null for an automatic event, whose name only repeats the site and day (12H.2).
  eventName?: string | null;
  post?: string | null;
  payRatePence?: number | null;
  meetingPoint?: string | null;
  uniform?: string | null;
  // When she said "Yes, I'm coming" in the day before (Phase 28.2; 28.14's pass card): null when
  // she hasn't. Upcoming and past bookings from myShifts() carry it.
  stillComingAt?: Date | null;
  site: {
    name: string;
    addressLine1: string | null;
    addressLine2: string | null;
    town: string | null;
    postcode: string | null;
  } | null;
  travel?: TravelFacts; // upcoming bookings only
}

export type ShiftsView = "upcoming" | "past";

// Upcoming: not ended, not cancelled.
const upcomingWhere = (now: Date) =>
  and(inArray(assignments.status, LIVE), gt(shifts.endsAt, now), ne(shifts.status, "cancelled"));

// Past: started within PAST_DAYS (by starts_at, as reliability counts) and ended.
const pastWhere = (now: Date) =>
  and(
    inArray(assignments.status, LIVE),
    lte(shifts.endsAt, now),
    gte(shifts.startsAt, new Date(now.getTime() - PAST_DAYS * DAY)),
  );

export async function myShifts(
  ctx: PortalContext,
  workerId: string,
  view: ShiftsView,
): Promise<MyShift[]> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  const when = view === "upcoming" ? upcomingWhere(now) : pastWhere(now);
  return run(ctx.firm.id, async (tx) => {
    const rows = await tx
      .select({
        assignmentId: assignments.id,
        shiftId: shifts.id,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        status: assignments.status,
        instructions: shifts.instructions,
        eventName: casualEventName,
        post: shifts.post,
        payRatePence: shifts.payRatePence,
        meetingPoint: shifts.meetingPoint,
        uniform: shifts.uniform,
        stillComingAt: assignments.stillComingAt,
        siteName: sites.name,
        addressLine1: sites.addressLine1,
        addressLine2: sites.addressLine2,
        town: sites.town,
        postcode: sites.postcode,
      })
      .from(assignments)
      .innerJoin(
        shifts,
        and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
      )
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .leftJoin(
        shiftEvents,
        and(eq(shiftEvents.firmId, shifts.firmId), eq(shiftEvents.id, shifts.shiftEventId)),
      )
      .where(and(eq(assignments.workerId, workerId), when))
      .orderBy(
        view === "upcoming" ? asc(shifts.startsAt) : desc(shifts.startsAt),
        asc(assignments.id),
      );
    // Travel lines for upcoming shifts, where the firm has travel areas on (13.4).
    const travel =
      view === "upcoming" && (await travelOn(tx))
        ? await travelFor(
            tx,
            workerId,
            rows.map((r) => r.shiftId),
          )
        : null;
    return rows.map(
      ({ siteName, addressLine1, addressLine2, town, postcode, status, ...shift }) => ({
        ...shift,
        status: status as MyShift["status"],
        site:
          siteName === null ? null : { name: siteName, addressLine1, addressLine2, town, postcode },
        ...(travel ? { travel: travel.get(shift.shiftId) ?? { kind: "unknown" as const } } : {}),
      }),
    );
  });
}

// The tabs' counts on Booked (Phase 28.13): how many bookings each view lists, by the same rules
// as myShifts(), her own only.
export async function myShiftCounts(
  ctx: PortalContext,
  workerId: string,
): Promise<{ upcoming: number; past: number }> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [row] = await tx
      .select({
        upcoming: count(sql`case when ${upcomingWhere(now)} then 1 end`),
        past: count(sql`case when ${pastWhere(now)} then 1 end`),
      })
      .from(assignments)
      .innerJoin(
        shifts,
        and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
      )
      .where(and(eq(assignments.workerId, workerId), inArray(assignments.status, LIVE)));
    return { upcoming: row?.upcoming ?? 0, past: row?.past ?? 0 };
  });
}

// A session she can say was marked wrongly ("Tell the office what happened", Phase 28.13): her own
// booking marked worked (completed) or not attended (no_show), on a session that started within
// RELIABILITY_DAYS and has started by now: askAboutMark's own rule (src/lib/portal/requests.ts),
// which checks it again when she sends. Null for anything else (not hers, not marked, too old).
export interface MarkedShift {
  shiftId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  mark: "completed" | "no_show";
  siteName: string | null;
}

export async function myMarkedShift(
  ctx: PortalContext,
  workerId: string,
  shiftId: string,
): Promise<MarkedShift | null> {
  if (!z.uuid().safeParse(shiftId).success || !z.uuid().safeParse(workerId).success) return null;
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [row] = await tx
      .select({
        shiftId: shifts.id,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        mark: assignments.status,
        siteName: sites.name,
      })
      .from(assignments)
      .innerJoin(
        shifts,
        and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
      )
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .where(
        and(
          eq(assignments.shiftId, shiftId),
          eq(assignments.workerId, workerId),
          inArray(assignments.status, ["completed", "no_show"]),
          gte(shifts.startsAt, new Date(now.getTime() - RELIABILITY_DAYS * DAY)),
          lte(shifts.startsAt, now),
        ),
      )
      .limit(1);
    if (!row || (row.mark !== "completed" && row.mark !== "no_show")) return null;
    return { ...row, mark: row.mark };
  });
}

// "Needs updating" (docs/office-v2.md 4.2; 12F.1): what the worker should sort out about their
// qualifications, in its four levels (src/lib/credentials/status.ts).
export async function myNeedsUpdating(ctx: PortalContext, workerId: string): Promise<NeedsItem[]> {
  return (await myNeedsAndPhoto(ctx, workerId)).needs;
}

// The same, with her staff photo (12F.2): Home's card shows the photo too when it's overdue or due
// soon (12H.1), and the tab bar's Profile dot counts both.
export async function myNeedsAndPhoto(
  ctx: PortalContext,
  workerId: string,
): Promise<{ needs: NeedsItem[]; photo: StaffPhoto }> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, ctx.firm.id));
    const held = await qualificationsFor(tx, [workerId], {
      now,
      timeZone: firm?.timezone ?? "Europe/London",
    });
    const mine = held.get(workerId);
    return {
      needs: mine?.needs ?? [],
      photo: mine?.photo ?? { status: "missing", current: null, waiting: null },
    };
  });
}

// Something on Profile needs her: a qualification to sort out, or her photo overdue or due soon.
export const somethingNeedsUpdating = (n: { needs: NeedsItem[]; photo: StaffPhoto }): boolean =>
  n.needs.length > 0 || photoNeedsUpdating(n.photo);

export const photoNeedsUpdating = (photo: StaffPhoto): boolean =>
  photo.status === "overdue" || photo.status === "due_soon";

// How many things on Profile need her (Phase 18: the tab bar's Profile count): each
// qualification to sort out, and her photo when it's overdue or due soon.
export const needsDoingCount = (n: { needs: NeedsItem[]; photo: StaffPhoto }): number =>
  n.needs.length + (photoNeedsUpdating(n.photo) ? 1 : 0);
// (The tab bar's own Profile count reads the casual's tab counts since Phase 28, which leave out
// what the office has in hand: profileNeedsYou and profileNeedsCount, unused, went in 28.16.)
