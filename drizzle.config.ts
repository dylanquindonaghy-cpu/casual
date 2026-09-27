import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env")) process.loadEnvFile(".env");

// Only `drizzle-kit generate` is part of the workflow (it needs no database). Never use
// `drizzle-kit push` or `drizzle-kit migrate`: migrations run through `npm run db:migrate`,
// which also creates roles, forces RLS and applies grants.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_ADMIN_URL ?? "" },
});
