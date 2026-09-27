import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, createPool } from "./client";

export const MIGRATIONS_FOLDER = "./drizzle";

// One migration path for the CLI (npm run db:migrate) and the test setup.
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = createPool(connectionString);
  try {
    await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
