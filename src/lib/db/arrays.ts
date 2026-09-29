import { sql, type SQL } from "drizzle-orm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A list of uuids as one Postgres array parameter (`= any(...)`), instead of one bound parameter
// per id. Refuses anything that isn't a uuid, so a careless caller can't slip other text into the
// array literal.
export function uuidArray(ids: string[]): SQL {
  const bad = ids.find((id) => !UUID.test(id));
  if (bad !== undefined) throw new Error("uuidArray: not a uuid");
  return sql`${`{${ids.join(",")}}`}::uuid[]`;
}
