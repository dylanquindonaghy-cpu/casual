import { sql, type SQL } from "drizzle-orm";

// True when the worker also holds a valid, checked credential of the same type that lasts longer
// (or never expires) than the credential the alias `c` names: a renewal recorded as a new row (a
// casual's upload only once the office approves it, 12F.2). The expiry scan (scan.ts) gives such an
// old row no warning and no message and leaves it off the office's list (it is still marked expired
// when its date passes, so the record stays true). SQL only, no messaging: kept apart from the
// scan's senders (Phase 23's licences chart read it too, until Phase 24's dashboard).
export function supersededSql(c: string): SQL<boolean> {
  const outer = sql.identifier(c);
  return sql<boolean>`exists (
  select 1 from "credentials" as "newer"
   where "newer"."firm_id" = ${outer}."firm_id" and "newer"."worker_id" = ${outer}."worker_id"
     and "newer"."type" = ${outer}."type" and "newer"."id" <> ${outer}."id"
     and "newer"."status" = 'valid' and "newer"."check_state" = 'verified'
     and ("newer"."expires_on" is null or "newer"."expires_on" > ${outer}."expires_on"))`;
}
