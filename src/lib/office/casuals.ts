import { asc, eq, isNull, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { qualificationsFor } from "../credentials/qualifications";
import type { NeedsItem, Qualification } from "../credentials/status";
import { firms, workers, type TravelMode } from "../db/schema";
import { officeUserMay, parts, type OfficeContext } from "./office-context";

// The Casuals list (docs/office-v2.md 3.7; docs/screens.md `/office/casuals`; 12F.1), for admins and
// resourcers (checked here as well as on the page). Every casual the firm holds (not erased), by
// name, with their qualifications (worst first: src/lib/credentials/status.ts), travel district
// (never the postcode: it's cut out in the database), live strikes and what needs updating.
//
// Views, each with its count: All, and Need updating (active casuals with something to update,
// the worst first: one stopping a booked shift, then expired, expiring soon, missing). An inactive
// or blocked casual can't work, so isn't "to update". The staff photo column and "Uploads to check"
// join with 12F.2. Reads only; a fixed number of queries however many casuals.

export const CASUAL_VIEWS = ["all", "needs"] as const;
export type CasualView = (typeof CASUAL_VIEWS)[number];
export const CASUALS_PAGE_MAX = 200;

export interface CasualRow {
  id: string;
  name: string;
  roles: string[];
  status: "active" | "inactive" | "blocked";
  qualifications: Qualification[];
  travel: { district: string; maxMinutes: number; modes: TravelMode } | null;
  liveStrikes: number;
  needs: NeedsItem[];
  rolesWithoutRule: string[]; // roles the firm has no rule for (those shifts can't be taken)
}

export interface CasualsList {
  view: CasualView;
  counts: Record<CasualView, number>;
  rows: CasualRow[];
  more: boolean; // more than CASUALS_PAGE_MAX in the view
}

export async function casualsList(
  ctx: OfficeContext,
  view: CasualView,
): Promise<CasualsList | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "casuals"))) return null;
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, ctx.firm.id));
    const people = await tx
      .select({
        id: workers.id,
        firstName: workers.firstName,
        lastName: workers.lastName,
        roles: workers.roles,
        status: workers.status,
      })
      .from(workers)
      .where(isNull(workers.erasedAt))
      .orderBy(asc(workers.lastName), asc(workers.firstName), asc(workers.id));
    const ids = people.map((p) => p.id);
    const held = await qualificationsFor(tx, ids, {
      now,
      timeZone: firm?.timezone ?? "Europe/London",
      people,
    });
    const { rows: travel } = await tx.execute<{
      worker_id: string;
      district: string;
      max_minutes: number;
      modes: TravelMode;
    }>(sql`
      select t.worker_id::text, split_part(t.start_postcode, ' ', 1) as district, t.max_minutes,
             t.modes
        from worker_travel t
    `);
    const travelOf = new Map(travel.map((t) => [t.worker_id, t]));
    const { rows: strikes } = await tx.execute<{ worker_id: string; live: number }>(sql`
      select st.worker_id::text, count(*)::int as live
        from strikes st
       where st.status = 'live' and st.expires_at > ${now}
       group by st.worker_id
    `);
    const liveOf = new Map(strikes.map((s) => [s.worker_id, Number(s.live)]));
    const all: CasualRow[] = people.map((p) => {
      const t = travelOf.get(p.id);
      const q = held.get(p.id);
      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        roles: [...p.roles],
        status: p.status,
        qualifications: q?.qualifications ?? [],
        travel: t
          ? { district: t.district, maxMinutes: Number(t.max_minutes), modes: t.modes }
          : null,
        liveStrikes: liveOf.get(p.id) ?? 0,
        needs: q?.needs ?? [],
        rolesWithoutRule: q?.rolesWithoutRule ?? [],
      };
    });
    // The worst first: by level, then (level 1) the booked shift it stops soonest; then by name.
    const needing = all
      .filter((r) => r.status === "active" && r.needs.length > 0)
      .sort(
        (a, b) =>
          (a.needs[0]?.level ?? 9) - (b.needs[0]?.level ?? 9) ||
          (a.needs[0]?.blocks?.day ?? "").localeCompare(b.needs[0]?.blocks?.day ?? ""),
      );
    const shown = view === "needs" ? needing : all;
    return {
      view,
      counts: { all: all.length, needs: needing.length },
      rows: shown.slice(0, CASUALS_PAGE_MAX),
      more: shown.length > CASUALS_PAGE_MAX,
    };
  });
}
