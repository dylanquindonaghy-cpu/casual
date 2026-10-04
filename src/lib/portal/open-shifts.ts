import { and, asc, eq, gt, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { DAY, systemClock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, firms, shifts, sites, workers } from "../db/schema";
import { withFirm } from "../db/scoped";
import { loadAllocationGates, parseAllocationSettings } from "../roster/allocation-input";
import { previewBookings } from "../roster/book";
import { pairKey } from "../roster/eligibility-input";
import { addDays, localDateOf, zonedToUtc } from "../time/zoned";
import type { MyShift, PortalContext } from "./my-shifts";

// The staff portal's Open shifts list (docs/screens.md, `/shifts/open`): only shifts this worker
// could take right now. Open shifts starting in the next 28 days, in one of the worker's roles,
// with a place left and not already theirs, each kept only if the rules say yes on the current
// rows (previewBookings: no locks, no pass, every shift at once; taking one re-checks everything
// in bookShift).
//
// Filters (a day, a site, a role, urgent only) go into the query, so they reach shifts beyond the
// first ones. The urgent board (`/urgent`) is this list with `urgent`: the same checks exactly.
// At most MAX_CANDIDATES matching shifts are checked by the rules, soonest first; `truncated` says
// there were more, so the page can suggest the filters. The filter choices come from every open
// shift in the worker's roles in the window (without the rules: a choice can still show nothing).

export const OPEN_WINDOW_DAYS = 28;
export const MAX_CANDIDATES = 50;

export interface OpenShift {
  shiftId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  placesLeft: number;
  site: (NonNullable<MyShift["site"]> & { id: string }) | null;
  // Fair rotation: held for workers with fewer hours that week (the shift's own Monday-to-Sunday week) until then (null: takeable now).
  opensAt: Date | null;
  isUrgent: boolean; // marked urgent (src/lib/roster/urgent.ts)
}

export interface OpenShiftFilters {
  day?: string; // yyyy-mm-dd, the firm's local date
  siteId?: string;
  role?: string;
  urgent?: boolean; // only shifts marked urgent (the urgent board, `/urgent`)
}

export interface OpenShiftsList {
  shifts: OpenShift[];
  truncated: boolean;
  // The worker wants to hear about open shifts (their profile setting): the empty list says
  // "We'll message you" only then.
  offerAlerts: boolean;
  choices: {
    days: string[];
    sites: { id: string; name: string }[];
    roles: string[];
  };
}

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));
const EMPTY: OpenShiftsList["choices"] = { days: [], sites: [], roles: [] };

export async function openShiftsFor(
  ctx: PortalContext,
  workerId: string,
  filters: OpenShiftFilters = {},
): Promise<OpenShiftsList> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [firm] = await tx
      .select({ timezone: firms.timezone, settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, ctx.firm.id));
    // Read once for the page; first come, first served never holds, so no gate is asked.
    const allocation = parseAllocationSettings(firm?.settings ?? {});
    const [me] = await tx
      .select({ roles: workers.roles, offerAlerts: workers.offerAlerts })
      .from(workers)
      .where(eq(workers.id, workerId));
    const zone = firm?.timezone ?? "Europe/London";
    const offerAlerts = me?.offerAlerts ?? false;
    if (!me || me.roles.length === 0) {
      return { shifts: [], truncated: false, offerAlerts, choices: EMPTY };
    }

    const inWindow = and(
      eq(shifts.status, "open"),
      gt(shifts.startsAt, now),
      lt(shifts.startsAt, new Date(now.getTime() + OPEN_WINDOW_DAYS * DAY)),
      inArray(shifts.role, [...me.roles]),
      sql`not exists (select 1 from assignments mine
        where mine.firm_id = ${shifts.firmId} and mine.shift_id = ${shifts.id}
          and mine.worker_id = ${workerId} and mine.status not in (${CANCELLED}))`,
    );

    // The choices: every open shift in the window, whatever the filters.
    const all = await tx
      .select({
        startsAt: shifts.startsAt,
        role: shifts.role,
        siteId: sites.id,
        siteName: sites.name,
      })
      .from(shifts)
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .where(inWindow)
      .orderBy(asc(shifts.startsAt));
    const siteNames = new Map<string, string>();
    for (const s of all) if (s.siteId && s.siteName) siteNames.set(s.siteId, s.siteName);
    const choices = {
      days: [...new Set(all.map((s) => localDateOf(s.startsAt, zone)))],
      sites: [...siteNames]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      roles: [...new Set(all.map((s) => s.role))].sort(),
    };

    const narrowed: SQL[] = [];
    if (filters.day) {
      const midnight = (date: string) => {
        const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
        return zonedToUtc({ year, month, day, hour: 0, minute: 0 }, zone);
      };
      narrowed.push(gte(shifts.startsAt, midnight(filters.day)));
      narrowed.push(lt(shifts.startsAt, midnight(addDays(filters.day, 1))));
    }
    if (filters.siteId) narrowed.push(eq(shifts.siteId, filters.siteId));
    if (filters.role) narrowed.push(eq(shifts.role, filters.role));
    if (filters.urgent) narrowed.push(eq(shifts.isUrgent, true));

    const held = sql<number>`(select count(*)::int from assignments a
      where a.firm_id = ${shifts.firmId} and a.shift_id = ${shifts.id}
        and a.worker_id is not null and a.status not in (${CANCELLED})
        and a.slot <= ${shifts.headcount})`;
    const candidates = await tx
      .select({
        shiftId: shifts.id,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        headcount: shifts.headcount,
        isUrgent: shifts.isUrgent,
        held,
        siteId: sites.id,
        siteName: sites.name,
        addressLine1: sites.addressLine1,
        addressLine2: sites.addressLine2,
        town: sites.town,
        postcode: sites.postcode,
      })
      .from(shifts)
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .where(and(inWindow, ...narrowed))
      .orderBy(asc(shifts.startsAt), asc(shifts.id))
      .limit(MAX_CANDIDATES + 1);

    // The rules and (fair rotation) the gate for every shift at once: a bounded number of queries
    // however many shifts there are (tests/integration/eligibility.batch.test.ts).
    const free = candidates.slice(0, MAX_CANDIDATES).filter((c) => c.held < c.headcount);
    const shiftIds = free.map((c) => c.shiftId);
    const verdicts = await previewBookings(tx, { shiftIds, workerIds: [workerId], now });
    const gates = await loadAllocationGates(tx, { shiftIds, workerId, now }, allocation);
    const kept: OpenShift[] = [];
    for (const c of free) {
      if (!verdicts.get(pairKey(c.shiftId, workerId))?.ok) continue;
      const gate = gates.get(c.shiftId) ?? ({ ok: true } as const);
      kept.push({
        shiftId: c.shiftId,
        role: c.role,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        placesLeft: c.headcount - c.held,
        opensAt: gate.ok ? null : gate.opensAt,
        isUrgent: c.isUrgent,
        site:
          c.siteId && c.siteName
            ? {
                id: c.siteId,
                name: c.siteName,
                addressLine1: c.addressLine1,
                addressLine2: c.addressLine2,
                town: c.town,
                postcode: c.postcode,
              }
            : null,
      });
    }
    return { shifts: kept, truncated: candidates.length > MAX_CANDIDATES, offerAlerts, choices };
  });
}
