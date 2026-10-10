import { and, asc, desc, eq, gt, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { DAY, systemClock } from "../auth/clock";
import {
  CANCELLED_ASSIGNMENT_STATUSES,
  firms,
  shiftEvents,
  shifts,
  sites,
  workers,
  workerTravel,
} from "../db/schema";
import { withFirm } from "../db/scoped";
import { loadAllocationGates, parseAllocationSettings } from "../roster/allocation-input";
import { previewBookings, type Verdict } from "../roster/book";
import { pairKey } from "../roster/eligibility-input";
import type { RuleCheck } from "../rules/eligibility";
import { visibleToCasuals } from "../roster/visibility";
import { addDays, localDateOf, zonedToUtc } from "../time/zoned";
import { nearestMinutes, outsideArea } from "../travel/area";
import type { TravelFacts } from "../travel/line-copy";
import { travelFor } from "../travel/lines";
import type { MyShift, PortalContext } from "./my-shifts";

// The staff portal's Open shifts list (docs/screens.md, `/shifts/open`): only shifts this worker
// could take right now. Open shifts starting in the next 28 days, shown to casuals (the session's
// and its event's switches: src/lib/roster/visibility.ts), in one of the worker's roles,
// with a place left and not already theirs, each kept only if the rules say yes on the current
// rows (previewBookings: no locks, no pass, every shift at once; taking one re-checks everything
// in bookShift).
//
// Filters (a day, a site, a role, urgent only) go into the query, so they reach shifts beyond the
// first ones. The urgent board (`/urgent`) is this list with `urgent`: the same checks exactly.
// At most MAX_CANDIDATES matching shifts are checked by the rules; `truncated` says there were
// more, so the page can suggest the filters. The filter choices come from every open shift in the
// worker's roles in the window (without the rules: a choice can still show nothing).
//
// The travel area (12G.3; src/lib/travel/area.ts): shifts it rules out are left out inside the
// query, before the cap, so shifts nearby are never cut off; the choices leave them out too.
// Urgent first, then the nearest (the quickest of her chosen ways), then the date. Each shift
// carries its travel facts (src/lib/travel/lines.ts), and `further` counts the shifts she could
// otherwise take that are further than she travels (the same filters and rules). With no area,
// nothing is left out and `area` is null (the pages ask her to add one).

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
  travel: TravelFacts; // for the travel line (src/lib/travel/line-copy.ts)
  // The session's details the shifts line's personal reply names (12D.2; always set here, optional
  // for the pages' own fixtures).
  eventName?: string | null;
  payRatePence?: number | null;
  post?: string | null;
}

export interface OpenShiftFilters {
  day?: string; // yyyy-mm-dd, the firm's local date
  days?: string[]; // any of these local dates (the shifts line's "this weekend": 12D.2)
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
  // Her travel area's limit, or null: no area set (everything shown, with the prompt).
  area: { maxMinutes: number } | null;
  // Shifts she could take but for her travel area; `atLeast`: more than the rules checked.
  further: { count: number; atLeast: boolean };
  choices: {
    days: string[];
    sites: { id: string; name: string }[];
    roles: string[];
  };
  // With `explain` (the shifts line's personal reply, 12D.2): the rules' checks for each listed
  // shift, and the sessions considered (her roles, the window and filters, not hers) but not
  // listed, each with why (at most NOT_OFFERED_MAX, and how many more).
  explain?: {
    checks: Map<string, RuleCheck[]>;
    notOffered: NotOffered[];
    notOfferedMore: number;
  };
}

// Why a session wasn't offered: hidden (its or its event's switch), outside her travel area, full,
// or a rule (the rules engine's code, with the qualification for a qualification code, the booking's
// times for a clash).
export interface NotOfferedReason {
  code: string;
  type?: string;
  from?: string; // ISO
  to?: string; // ISO
}

export interface NotOffered {
  shiftId: string;
  role: string;
  eventName: string | null;
  siteName: string | null;
  startsAt: Date;
  endsAt: Date;
  reasons: NotOfferedReason[];
}

export const NOT_OFFERED_MAX = 50;
const CONSIDERED_MAX = 80;
const QUALIFICATION_CODES = new Set([
  "no_rule",
  "credential_missing",
  "credential_expired",
  "credential_suspended",
  "applied_over_allowance",
]);

// A verdict's failures as reasons: qualification codes paired, in order, with their failed checks
// (the engine adds both in the same loop, one per type).
export function ruleReasons(v: Verdict): NotOfferedReason[] {
  const failedQualifications = v.checks.filter((c) => c.code === "qualification" && !c.passed);
  const overlap = v.checks.find((c) => c.code === "overlap" && !c.passed);
  let q = 0;
  return v.codes.map((code) => {
    if (QUALIFICATION_CODES.has(code)) {
      const type = failedQualifications[q++]?.detail.type;
      return typeof type === "string" ? { code, type } : { code };
    }
    if (code === "overlap" && overlap) {
      const { withStart, withEnd } = overlap.detail;
      return typeof withStart === "string" && typeof withEnd === "string"
        ? { code, from: withStart, to: withEnd }
        : { code };
    }
    return { code };
  });
}

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));
const EMPTY: OpenShiftsList["choices"] = { days: [], sites: [], roles: [] };
const NONE_FURTHER: OpenShiftsList["further"] = { count: 0, atLeast: false };

export async function openShiftsFor(
  ctx: PortalContext,
  workerId: string,
  filters: OpenShiftFilters = {},
  opts: { explain?: boolean } = {},
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
    const [home] = await tx
      .select({ maxMinutes: workerTravel.maxMinutes })
      .from(workerTravel)
      .where(eq(workerTravel.workerId, workerId));
    const area = home ? { maxMinutes: home.maxMinutes } : null;
    const zone = firm?.timezone ?? "Europe/London";
    const offerAlerts = me?.offerAlerts ?? false;
    if (!me || me.roles.length === 0) {
      return {
        shifts: [],
        truncated: false,
        offerAlerts,
        area,
        further: NONE_FURTHER,
        choices: EMPTY,
      };
    }

    // Her roles, in the window, not hers already (shown to casuals or not: `explain` reads the
    // hidden ones too); the list itself is only those shown.
    const considered = and(
      eq(shifts.status, "open"),
      gt(shifts.startsAt, now),
      lt(shifts.startsAt, new Date(now.getTime() + OPEN_WINDOW_DAYS * DAY)),
      inArray(shifts.role, [...me.roles]),
      sql`not exists (select 1 from assignments mine
        where mine.firm_id = ${shifts.firmId} and mine.shift_id = ${shifts.id}
          and mine.worker_id = ${workerId} and mine.status not in (${CANCELLED}))`,
    );
    const inWindow = and(considered, visibleToCasuals);
    const travel = {
      firmId: sql`${shifts.firmId}`,
      workerId: sql`${workerId}::uuid`,
      siteId: sql`${shifts.siteId}`,
      startsAt: sql`${shifts.startsAt}`,
    };
    const outside = outsideArea(travel);
    const inArea = sql`not ${outside}`;

    // The choices: every open shift in the window and her area, whatever the filters.
    const all = await tx
      .select({
        startsAt: shifts.startsAt,
        role: shifts.role,
        siteId: sites.id,
        siteName: sites.name,
      })
      .from(shifts)
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .where(and(inWindow, inArea))
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
    if (filters.days && filters.days.length > 0) {
      const midnight = (date: string) => {
        const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
        return zonedToUtc({ year, month, day, hour: 0, minute: 0 }, zone);
      };
      const anyDay = filters.days.map(
        (d) =>
          sql`(${shifts.startsAt} >= ${midnight(d)} and ${shifts.startsAt} < ${midnight(addDays(d, 1))})`,
      );
      narrowed.push(sql`(${sql.join(anyDay, sql` or `)})`);
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
        eventName: shiftEvents.name,
        payRatePence: shifts.payRatePence,
        post: shifts.post,
      })
      .from(shifts)
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .leftJoin(
        shiftEvents,
        and(eq(shiftEvents.firmId, shifts.firmId), eq(shiftEvents.id, shifts.shiftEventId)),
      )
      .where(and(inWindow, inArea, ...narrowed))
      .orderBy(
        desc(shifts.isUrgent),
        sql`${nearestMinutes(travel)} asc nulls last`,
        asc(shifts.startsAt),
        asc(shifts.id),
      )
      .limit(MAX_CANDIDATES + 1);
    // Those her area rules out, for the "further than you travel" count (none without an area).
    // Joined to sites like the list's query: in a query with no join, Drizzle writes the selected
    // columns without their table, and `held`'s "id" would then mean the assignment's own.
    const beyond = area
      ? await tx
          .select({ shiftId: shifts.id, headcount: shifts.headcount, held })
          .from(shifts)
          .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
          .where(and(inWindow, outside, ...narrowed))
          .orderBy(asc(shifts.startsAt), asc(shifts.id))
          .limit(MAX_CANDIDATES + 1)
      : [];

    // The rules and (fair rotation) the gate for every shift at once: a bounded number of queries
    // however many shifts there are (tests/integration/eligibility.batch.test.ts).
    const free = candidates.slice(0, MAX_CANDIDATES).filter((c) => c.held < c.headcount);
    const freeBeyond = beyond.slice(0, MAX_CANDIDATES).filter((c) => c.held < c.headcount);
    const shiftIds = free.map((c) => c.shiftId);
    const verdicts = await previewBookings(tx, {
      shiftIds: [...shiftIds, ...freeBeyond.map((c) => c.shiftId)],
      workerIds: [workerId],
      now,
    });
    const ok = (shiftId: string) => !!verdicts.get(pairKey(shiftId, workerId))?.ok;
    const gates = await loadAllocationGates(tx, { shiftIds, workerId, now }, allocation);
    const allowed = free.filter((c) => ok(c.shiftId));
    const travelOf = await travelFor(
      tx,
      workerId,
      allowed.map((c) => c.shiftId),
    );
    const kept: OpenShift[] = [];
    for (const c of allowed) {
      const gate = gates.get(c.shiftId) ?? ({ ok: true } as const);
      kept.push({
        shiftId: c.shiftId,
        role: c.role,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        placesLeft: c.headcount - c.held,
        opensAt: gate.ok ? null : gate.opensAt,
        isUrgent: c.isUrgent,
        travel: travelOf.get(c.shiftId) ?? { kind: "unknown" },
        eventName: c.eventName,
        payRatePence: c.payRatePence,
        post: c.post,
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
    let explain: OpenShiftsList["explain"];
    if (opts.explain) {
      const checks = new Map<string, RuleCheck[]>();
      for (const c of kept) {
        checks.set(c.shiftId, verdicts.get(pairKey(c.shiftId, workerId))?.checks ?? []);
      }
      // Every session she was considered for, listed or not, soonest first.
      const rows = await tx
        .select({
          shiftId: shifts.id,
          role: shifts.role,
          startsAt: shifts.startsAt,
          endsAt: shifts.endsAt,
          headcount: shifts.headcount,
          held,
          visible: sql<boolean>`${visibleToCasuals}`,
          outside: sql<boolean>`${outside}`,
          eventName: shiftEvents.name,
          siteName: sites.name,
        })
        .from(shifts)
        .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
        .leftJoin(
          shiftEvents,
          and(eq(shiftEvents.firmId, shifts.firmId), eq(shiftEvents.id, shifts.shiftEventId)),
        )
        .where(and(considered, ...narrowed))
        .orderBy(asc(shifts.startsAt), asc(shifts.id))
        .limit(CONSIDERED_MAX + 1);
      const [total] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(shifts)
        .where(and(considered, ...narrowed));
      const listed = new Set(kept.map((k) => k.shiftId));
      const others = rows.slice(0, CONSIDERED_MAX).filter((r) => !listed.has(r.shiftId));
      const unchecked = others
        .map((r) => r.shiftId)
        .filter((id) => !verdicts.has(pairKey(id, workerId)));
      const more = await previewBookings(tx, { shiftIds: unchecked, workerIds: [workerId], now });
      const verdictOf = (id: string) =>
        verdicts.get(pairKey(id, workerId)) ?? more.get(pairKey(id, workerId));
      const notOffered: NotOffered[] = [];
      for (const r of others) {
        const reasons: NotOfferedReason[] = [];
        if (!r.visible) reasons.push({ code: "hidden" });
        if (r.outside) reasons.push({ code: "outside_area" });
        if (r.held >= r.headcount) reasons.push({ code: "full" });
        const v = verdictOf(r.shiftId);
        if (v && !v.ok) reasons.push(...ruleReasons(v));
        // None: one the list's cap left out (not "not offered": the list says there are more).
        if (reasons.length === 0) continue;
        notOffered.push({
          shiftId: r.shiftId,
          role: r.role,
          eventName: r.eventName,
          siteName: r.siteName,
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          reasons,
        });
      }
      const shown = notOffered.slice(0, NOT_OFFERED_MAX);
      explain = {
        checks,
        notOffered: shown,
        // The rest: those beyond the list here, and beyond the sessions read at all.
        notOfferedMore:
          notOffered.length -
          shown.length +
          Math.max(0, (total?.n ?? 0) - Math.min(rows.length, CONSIDERED_MAX)),
      };
    }

    return {
      ...(explain ? { explain } : {}),
      shifts: kept,
      truncated: candidates.length > MAX_CANDIDATES,
      offerAlerts,
      area,
      further: {
        count: freeBeyond.filter((c) => ok(c.shiftId)).length,
        atLeast: beyond.length > MAX_CANDIDATES,
      },
      choices,
    };
  });
}
