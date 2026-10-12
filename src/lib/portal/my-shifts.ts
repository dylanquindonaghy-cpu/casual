import { and, asc, desc, eq, gt, inArray, lte, ne } from "drizzle-orm";
import { DAY, systemClock, type Clock } from "../auth/clock";
import { qualificationsFor } from "../credentials/qualifications";
import type { NeedsItem } from "../credentials/status";
import { assignments, firms, shiftEvents, shifts, sites } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
import type { TravelFacts } from "../travel/line-copy";
import { travelFor } from "../travel/lines";
import type { StaffPhoto } from "../uploads/photo";

// What the staff portal's My shifts page shows (docs/screens.md, `/`), for the logged-in worker
// only, inside their firm (RLS scopes every row to it).
//
// - Upcoming: bookings on shifts that haven't ended and aren't cancelled, soonest first. A shift
//   in progress still shows (the worker at the venue needs its instructions), even if the office
//   has already marked it (completed, or no-show for someone running late).
// - Past: confirmed, completed or no-show bookings on shifts that ended in the last 30 days,
//   newest first, including a shift the sheet cancelled after it started (its bookings are
//   history). Cancelled bookings show in neither list.
// - Travel: each upcoming booking carries its travel facts, for the travel line (12G.3; the same
//   words as Open shifts). Past ones don't: the trip is done, and its estimates expire.
// - Needs updating (12F.1): the qualifications the worker's roles need that have expired, are
//   suspended or missing, expire within EXPIRING_SOON_DAYS, or stop a booked shift, in §4.2's
//   order. Not a type they've already replaced (a newer valid one) or are renewing (applied for).

export const PAST_DAYS = 30;

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
  // The session's own facts (12H.1: Home's next shift, in full).
  eventName?: string | null;
  post?: string | null;
  payRatePence?: number | null;
  meetingPoint?: string | null;
  uniform?: string | null;
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

export async function myShifts(
  ctx: PortalContext,
  workerId: string,
  view: ShiftsView,
): Promise<MyShift[]> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  const when =
    view === "upcoming"
      ? and(
          inArray(assignments.status, ["confirmed", "completed", "no_show"]),
          gt(shifts.endsAt, now),
          ne(shifts.status, "cancelled"),
        )
      : and(
          inArray(assignments.status, ["confirmed", "completed", "no_show"]),
          lte(shifts.endsAt, now),
          gt(shifts.endsAt, new Date(now.getTime() - PAST_DAYS * DAY)),
        );
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
        eventName: shiftEvents.name,
        post: shifts.post,
        payRatePence: shifts.payRatePence,
        meetingPoint: shifts.meetingPoint,
        uniform: shifts.uniform,
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
    const travel =
      view === "upcoming"
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

// The tab bar's Profile dot (12H.1), for the pages that don't load Needs updating themselves.
export async function profileNeedsYou(ctx: PortalContext, workerId: string): Promise<boolean> {
  return somethingNeedsUpdating(await myNeedsAndPhoto(ctx, workerId));
}
