import { appEnv } from "../env";
import { isLocalHost } from "./admin/urls";

// Is the app's database on this machine (development, tests, the e2e run)? Only fake data lives
// there, so Gate B's check (src/lib/imports/gate-b.ts) applies to every other database. Decided by
// pg's own reading of DATABASE_URL, so a ?host= override can't make a live database look local.
export function appDatabaseIsLocal(): boolean {
  return isLocalHost(appEnv().DATABASE_URL);
}
