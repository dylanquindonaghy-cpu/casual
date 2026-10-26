import type { Pool } from "pg";
import { hoursFromNow } from "./booking-fixture";

// Many made-up workers at once for the scale tests (PLAN.md P4): one insert per table, as the
// superuser, like booking-fixture.ts (so the seed never depends on the code under test). Each is a
// door supervisor and steward with the licences in date, like the fixture's worker().
//
// A firm's numbers must be unique, and Ofcom keeps two ranges of a thousand for drama: mobiles
// +44 7700 900000-900999, then the fictional area +44 1632 960000-960999. So at most 2,000 a firm,
// and not in a firm that also has the fixture's workers (theirs come from the first range).
export const BULK_MAX = 2_000;

export async function bulkWorkers(su: Pool, firmId: string, count: number): Promise<string[]> {
  if (count < 1 || count > BULK_MAX) throw new Error(`between 1 and ${BULK_MAX} workers a firm`);
  const { rows } = await su.query<{ id: string }>(
    `insert into workers (firm_id, first_name, last_name, mobile_e164, roles, status)
     select $1, 'Bulk' || i, 'Booker',
            case when i < 1000 then '+447700900' || lpad(i::text, 3, '0')
                 else '+441632960' || lpad((i - 1000)::text, 3, '0') end,
            array['steward', 'door_supervisor'], 'active'
       from generate_series(0, $2::int - 1) as i
      order by i
     returning id::text as id`,
    [firmId, count],
  );
  const ids = rows.map((r) => r.id);
  await su.query(
    `insert into credentials (firm_id, worker_id, type, status, expires_on)
     select $1, w.id, c.type, 'valid', c.expires_on
       from unnest($2::uuid[]) as w(id)
      cross join (values ('STEWARD_L2', null::date), ('SIA_DS', date '2029-01-01')) as c(type, expires_on)`,
    [firmId, ids],
  );
  return ids;
}

// Books these workers on the shift, one slot each (1, 2, ...), confirmed long ago: as the fixture's
// booking() does for one.
export async function bulkBookings(
  su: Pool,
  firmId: string,
  shiftId: string,
  workerIds: string[],
): Promise<void> {
  await su.query(
    `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
     select $1, $2, w.slot, w.id, 'confirmed', $4
       from unnest($3::uuid[]) with ordinality as w(id, slot)`,
    [firmId, shiftId, workerIds, hoursFromNow(-100)],
  );
}
