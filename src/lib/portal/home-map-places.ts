import { sql } from "drizzle-orm";
import { withFirm } from "../db/scoped";
import type { MapPlace } from "./home-map";
import type { MyShift, PortalContext } from "./my-shifts";
import type { OpenShift } from "./open-shifts";

// The points of Home's map's venues (Phase 32, 32.2; ./home-map.ts): her next shift's venue, read by
// its session, and the venues of the shifts open to her, read by the ids the rules' own list
// carries. Inside her firm only (withFirm, and each query names her firm too), so another firm's
// venue can never be on her map. Server only.

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

// The points of the venues the pins need: her next shift's (by its session) and the open shifts'
// (by the ids the rules' list carries). Read inside her firm only.
export async function loadMapPlaces(
  ctx: PortalContext,
  next: Pick<MyShift, "shiftId"> | null,
  open: readonly OpenShift[],
): Promise<{ nextPlace: MapPlace | null; places: Map<string, MapPlace> }> {
  const ids = [...new Set(open.flatMap((s) => (s.site ? [s.site.id] : [])))];
  if (ids.length === 0 && !next) return { nextPlace: null, places: new Map() };
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    type Row = { site_id: string; name: string; lat: string | null; lng: string | null };
    const toPlace = (r: Row): MapPlace => ({
      siteId: r.site_id,
      name: r.name,
      lat: num(r.lat),
      lng: num(r.lng),
    });
    const places = new Map<string, MapPlace>();
    if (ids.length > 0) {
      const { rows } = await tx.execute<Row>(sql`
        select v.id::text as site_id, v.name, v.lat, v.lng
          from sites v
         where v.firm_id = ${ctx.firm.id}::uuid and v.id in (${sql.join(
           ids.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
      `);
      for (const r of rows) places.set(r.site_id, toPlace(r));
    }
    let nextPlace: MapPlace | null = null;
    if (next) {
      const { rows } = await tx.execute<Row>(sql`
        select v.id::text as site_id, v.name, v.lat, v.lng
          from shifts s
          join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
          join sites v on v.firm_id = s.firm_id and v.id = coalesce(s.site_id, e.site_id)
         where s.firm_id = ${ctx.firm.id}::uuid and s.id = ${next.shiftId}::uuid
      `);
      nextPlace = rows[0] ? toPlace(rows[0]) : null;
    }
    return { nextPlace, places };
  });
}
