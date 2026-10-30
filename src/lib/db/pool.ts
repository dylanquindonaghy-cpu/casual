import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { APP_DB_ROLE, appEnv } from "../env";
import { log } from "../log";
import * as schema from "./schema";

// The app role's connection pool. Private to src/lib/db (ESLint blocks imports from elsewhere):
// app code reaches the database only through withFirm() and resolveFirmBySlug().

export type Db = NodePgDatabase<typeof schema>;

// Each process's share of the database and how long its work may take (P4.2; ADR-027). The web
// app answers people, so it waits briefly for a connection and a page fails rather than hangs; the
// worker's jobs may wait longer, and pg-boss retries them. The statement and idle limits are set
// per transaction by withFirm (scoped.ts), so they end with it. 0 means no limit.
export interface DbLimits {
  statementMs: number; // statement_timeout
  idleInTransactionMs: number; // idle_in_transaction_session_timeout
}
export interface DbProfile {
  poolMax: number;
  connectWaitMs: number; // the longest wait for a free connection (pg's connectionTimeoutMillis)
  limits: DbLimits;
}
export type DbProfileName = "web" | "worker";
export const DB_PROFILES: Readonly<Record<DbProfileName, DbProfile>> = {
  web: {
    poolMax: 10,
    connectWaitMs: 5_000,
    limits: { statementMs: 15_000, idleInTransactionMs: 30_000 },
  },
  worker: {
    poolMax: 15,
    connectWaitMs: 30_000,
    limits: { statementMs: 60_000, idleInTransactionMs: 60_000 },
  },
};

let profileName: DbProfileName = "web";
let pool: Pool | undefined;

// The worker picks its profile before its first query (src/worker/index.ts); the web app and the
// scripts are "web". Too late once the pool exists: it was made with the other one's sizes.
export function chooseDbProfile(name: DbProfileName): void {
  if (pool && name !== profileName) {
    throw new Error(`The database pool already runs with the ${profileName} profile`);
  }
  profileName = name;
}

export function dbProfile(): DbProfile {
  return DB_PROFILES[profileName];
}

export function appPool(): Pool {
  if (!pool) {
    const profile = dbProfile();
    pool = new Pool({
      connectionString: appEnv().DATABASE_URL,
      max: profile.poolMax,
      connectionTimeoutMillis: profile.connectWaitMs,
    });
    // An idle connection dropping (e.g. the database restarting) must not crash the process.
    pool.on("error", (err) => log.error("database pool error", { error: err }));
    // Nor one that's checked out but between queries (a transaction waiting on other work, like
    // the credential scan's lock holder): the pool takes its own listener off while a connection
    // is lent out. The transaction's next query, or its commit, fails as usual.
    pool.on("connect", (client) =>
      client.on("error", (err) => log.error("database connection error", { error: err })),
    );
  }
  return pool;
}

export function drizzleFor(p: Pool): Db {
  return drizzle(p, { schema });
}

// Refuses to run on a connection that RLS would not restrict: a superuser, a BYPASSRLS role,
// a table owner (the owner of public tables) or a role with memberships. Also refuses any
// database not ending in _test while Vitest is running, so tests can never touch dev data.
export async function assertSafeAppConnection(p: Pool): Promise<void> {
  const { rows } = await p.query<{
    user: string;
    db: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    owns_public: boolean;
    memberships: boolean;
  }>(
    `select current_user as user, current_database() as db, r.rolsuper, r.rolbypassrls,
            exists (select 1 from pg_class c
                     where c.relowner = r.oid and c.relnamespace = 'public'::regnamespace) as owns_public,
            exists (select 1 from pg_auth_members m where m.member = r.oid) as memberships
       from pg_roles r where r.rolname = current_user`,
  );
  const r = rows[0];
  if (!r) throw new Error("Could not read the current database role");
  const problems = [
    r.user !== APP_DB_ROLE && `connected as ${r.user}, expected ${APP_DB_ROLE}`,
    r.rolsuper && "the role is a superuser",
    r.rolbypassrls && "the role has BYPASSRLS",
    r.owns_public && "the role owns tables in public",
    r.memberships && "the role is a member of another role",
    process.env.VITEST &&
      !r.db.endsWith("_test") &&
      `tests must use a *_test database, not ${r.db}`,
  ].filter(Boolean);
  if (problems.length > 0) {
    throw new Error(`Unsafe app database connection: ${problems.join("; ")}`);
  }
}
