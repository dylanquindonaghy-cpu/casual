import { sql } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";
import { straightLineMetres } from "./distance";
import { ARRIVE_BEFORE_MINUTES } from "./estimate-queue";
import type { TravelFacts } from "./line-copy";

// A casual's travel to each of some sessions (docs/office-v2.md 4.3, 5.4; 12G.2): what the travel
// job worked out from their postcode, by car and by public transport, or the straight-line
// distance when that isn't there yet (the job hasn't run, or the service is down). Reads only: a
// page never calls the travel service. Inside the firm's transaction. Words: line-copy.ts.

export async function travelFor(
  tx: FirmTx,
  workerId: string,
  shiftIds: readonly string[],
): Promise<Map<string, TravelFacts>> {
  const facts = new Map<string, TravelFacts>();
  if (shiftIds.length === 0) return facts;
  const { rows } = await tx.execute<{
    id: string;
    starts_at: string | Date;
    site_lat: string | null;
    site_lng: string | null;
    home_lat: string | null;
    home_lng: string | null;
    car_known: boolean;
    car_minutes: number | null;
    car_metres: number | null;
    pt_known: boolean;
    pt_minutes: number | null;
  }>(sql`
    select s.id::text, s.starts_at, si.lat::text as site_lat, si.lng::text as site_lng,
           t.lat::text as home_lat, t.lng::text as home_lng,
           car.id is not null as car_known, car.minutes as car_minutes, car.metres as car_metres,
           pt.id is not null as pt_known, pt.minutes as pt_minutes
      from shifts s
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
      left join worker_travel t on t.firm_id = s.firm_id and t.worker_id = ${workerId}
      left join travel_estimates car
        on car.firm_id = s.firm_id and car.site_id = s.site_id and car.mode = 'car'
       and car.origin_postcode = t.start_postcode
       and car.arrive_by = s.starts_at - make_interval(mins => ${ARRIVE_BEFORE_MINUTES})
      left join travel_estimates pt
        on pt.firm_id = s.firm_id and pt.site_id = s.site_id and pt.mode = 'public_transport'
       and pt.origin_postcode = t.start_postcode
       and pt.arrive_by = s.starts_at - make_interval(mins => ${ARRIVE_BEFORE_MINUTES})
     where s.id in (${sql.join(
       shiftIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
  `);
  for (const r of rows) {
    if (r.site_lat === null || r.site_lng === null || r.home_lat === null || r.home_lng === null) {
      facts.set(r.id, { kind: "unknown" });
      continue;
    }
    const straightMetres = straightLineMetres(
      { lat: Number(r.home_lat), lng: Number(r.home_lng) },
      { lat: Number(r.site_lat), lng: Number(r.site_lng) },
    );
    if (!r.car_known || !r.pt_known) {
      facts.set(r.id, { kind: "straight", straightMetres });
      continue;
    }
    facts.set(r.id, {
      kind: "estimated",
      straightMetres,
      arriveBy: new Date(new Date(r.starts_at).getTime() - ARRIVE_BEFORE_MINUTES * 60_000),
      car:
        r.car_minutes === null
          ? null
          : {
              minutes: Number(r.car_minutes),
              metres: r.car_metres === null ? null : Number(r.car_metres),
            },
      publicTransport: r.pt_minutes === null ? null : { minutes: Number(r.pt_minutes) },
    });
  }
  return facts;
}
