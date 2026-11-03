import { sql, type SQL } from "drizzle-orm";
import { uuidArray } from "../db/arrays";

// A dashboard narrowed to the contracts a person looks after (Phase 26.3; the spec page's cus-2):
// a session counts when its venue (its own site, else its event's) is one of those contracts'
// sites. A condition over a shift `s` alone (its event read by a subquery), so any of the
// dashboard's queries can add it. `sites` null: every venue (no contracts chosen, or "Show
// everything"); an empty list: none (contracts with no sites yet).
export function sitesSql(sites: string[] | null): SQL {
  if (sites === null) return sql`true`;
  return sql`coalesce(s.site_id, (select se.site_id from shift_events se
                                   where se.firm_id = s.firm_id and se.id = s.event_id))
             = any(${uuidArray(sites)})`;
}
