import { and, asc, desc, eq, gt, inArray, lte, ne } from "drizzle-orm";
import { DAY, systemClock, type Clock } from "../auth/clock";
import {
  assignments,
  credentialRules,
  credentials,
  credentialTypes,
  firms,
  shifts,
  sites,
  workers,
} from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
import { addDays, localDateOf } from "../time/zoned";

// What the staff portal's My shifts page shows (docs/screens.md, `/`), for the logged-in worker
// only, inside their firm (RLS scopes every row to it).
//
// - Upcoming: bookings on shifts that haven't ended and aren't cancelled, soonest first. A shift
//   in progress still shows (the worker at the venue needs its instructions), even if the office
//   has already marked it (completed, or no-show for someone running late).
// - Past: confirmed, completed or no-show bookings on shifts that ended in the last 30 days,
//   newest first, including a shift the sheet cancelled after it started (its bookings are
//   history). Cancelled bookings show in neither list.
// - Notices: credentials the worker's roles need that expire within 30 days, or have expired, for
//   the banner. Not for a type the worker has already replaced (a newer valid one) or is renewing
//   (an application in progress).

export const PAST_DAYS = 30;
export const NOTICE_DAYS = 30;

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
  site: {
    name: string;
    addressLine1: string | null;
    addressLine2: string | null;
    town: string | null;
    postcode: string | null;
  } | null;
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
  const rows = await run(ctx.firm.id, (tx) =>
    tx
      .select({
        assignmentId: assignments.id,
        shiftId: shifts.id,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        status: assignments.status,
        instructions: shifts.instructions,
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
      .where(and(eq(assignments.workerId, workerId), when))
      .orderBy(
        view === "upcoming" ? asc(shifts.startsAt) : desc(shifts.startsAt),
        asc(assignments.id),
      ),
  );
  return rows.map(({ siteName, addressLine1, addressLine2, town, postcode, status, ...shift }) => ({
    ...shift,
    status: status as MyShift["status"],
    site: siteName === null ? null : { name: siteName, addressLine1, addressLine2, town, postcode },
  }));
}

export interface CredentialNotice {
  type: string;
  name: string;
  expiresOn: string | null; // null: marked expired with no date
  expired: boolean;
}

export async function credentialNotices(
  ctx: PortalContext,
  workerId: string,
): Promise<CredentialNotice[]> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, ctx.firm.id));
    const today = localDateOf(now, firm?.timezone ?? "Europe/London");
    const horizon = addDays(today, NOTICE_DAYS);
    // Only credentials the worker's roles need (by the firm's rules): an old card for work they
    // no longer do isn't worth a red banner on every visit.
    const [me] = await tx
      .select({ roles: workers.roles })
      .from(workers)
      .where(eq(workers.id, workerId));
    const rules = me?.roles.length
      ? await tx
          .select({ requiredTypes: credentialRules.requiredTypes })
          .from(credentialRules)
          .where(inArray(credentialRules.role, [...me.roles]))
      : [];
    const needed = new Set(rules.flatMap((r) => r.requiredTypes));
    const held = await tx
      .select({
        id: credentials.id,
        type: credentials.type,
        status: credentials.status,
        expiresOn: credentials.expiresOn,
        name: credentialTypes.name,
      })
      .from(credentials)
      .leftJoin(
        credentialTypes,
        and(
          eq(credentialTypes.firmId, credentials.firmId),
          eq(credentialTypes.code, credentials.type),
        ),
      )
      .where(eq(credentials.workerId, workerId));
    // A valid credential of the type lasting past the horizon (or with no expiry) means the
    // worker has already replaced any older one; an application in progress means they're
    // renewing it. Either way, nothing to tell them for that type.
    const covered = new Set(
      held
        .filter(
          (c) =>
            (c.status === "valid" && (c.expiresOn === null || c.expiresOn > horizon)) ||
            c.status === "applied",
        )
        .map((c) => c.type),
    );
    const notices = new Map<string, CredentialNotice>();
    for (const c of held) {
      if (!needed.has(c.type) || covered.has(c.type) || c.status === "suspended") continue;
      const expired = c.status === "expired" || (c.expiresOn !== null && c.expiresOn < today);
      const soon = c.status === "valid" && c.expiresOn !== null && c.expiresOn <= horizon;
      if (!expired && !soon) continue;
      const notice = {
        type: c.type,
        name: c.name ?? c.type.replace(/_/g, " "),
        expiresOn: c.expiresOn,
        expired,
      };
      // One notice per type: the one lasting longest.
      const seen = notices.get(c.type);
      if (!seen || (notice.expiresOn ?? "") > (seen.expiresOn ?? "")) notices.set(c.type, notice);
    }
    return [...notices.values()].sort((a, b) =>
      (a.expiresOn ?? "").localeCompare(b.expiresOn ?? ""),
    );
  });
}
