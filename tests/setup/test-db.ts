import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

// Refuses anything that isn't clearly a test database, so tests can never touch dev or prod data.
export function testDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL_TEST;
  if (!raw) throw new Error("DATABASE_URL_TEST is not set. Copy .env.example to .env.");
  const name = new URL(raw).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `DATABASE_URL_TEST must point at a database ending in "_test" (got "${name}").`,
    );
  }
  return raw;
}
