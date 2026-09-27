import { env } from "../src/lib/env";
import { runMigrations } from "../src/lib/db/migrate";

await runMigrations(env().DATABASE_URL);
console.log("Migrations applied.");
