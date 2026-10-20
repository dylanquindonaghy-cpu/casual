import { writeFile } from "node:fs/promises";
import { Client } from "pg";
import { isDemoFirm } from "../../demo/firms";
import { NotADemoServer } from "../../demo/guard";
import { APP_DB_ROLE, JOBS_DB_ROLE } from "../../env";
import { ensureOwnerRole, recreateDatabase, syncRolePassword } from "./bootstrap";
import { runMigrations } from "./migrate";
import { seed, type SeedSummary } from "./seed";
import {
  bootstrapUrl,
  credentials,
  databaseName,
  isLocalHost,
  ownerRoleFromAdminUrl,
  withDatabase,
} from "./urls";

// The demo server's reset (16.2; docs/runbooks.md "A demo server"; ADR-025): the made-up demo
// loaded afresh, by hand the first time and then every night (deploy/demo-reset.sh), so its dates
// stay current and what visitors did is cleared. It drops the whole database, so it refuses unless
// everything says this is a demo server: demo mode on, every database address on this server, and
// no firm in the database that isn't a made-up demo firm (checked before anything is dropped).
// Then, as `npm run db:reset` does locally: the owner role, the database recreated as the owner's,
// every migration, the demo's own rule that refuses real people (below), the seed; and the outbox
// emptied, so the Demo phone starts empty too.

export interface DemoResetOptions {
  demoMode: string | undefined;
  nodeEnv: string;
  adminUrl: string;
  appUrl: string;
  jobsUrl: string;
  // The outbox the Demo phone reads (CONSOLE_OUTBOX_FILE): emptied.
  outboxFile?: string;
  today?: Date;
}

// Why it won't run here, or null. Checked before any connection is made.
export function demoResetRefusal(o: DemoResetOptions): string | null {
  if (o.demoMode !== "on") return "the demo reset only runs on a demo server (DEMO_MODE=on)";
  if (![o.adminUrl, o.appUrl, o.jobsUrl].every(isLocalHost)) {
    return "the demo reset only runs on a database on this server (a socket or localhost)";
  }
  if (!ownerRoleFromAdminUrl(o.adminUrl)) {
    return "DATABASE_ADMIN_URL needs ?options=-c role=<owner> (deploy/env.demo.example)";
  }
  return null;
}

export async function demoReset(o: DemoResetOptions): Promise<SeedSummary> {
  const refusal = demoResetRefusal(o);
  if (refusal) throw new Error(refusal);
  const owner = ownerRoleFromAdminUrl(o.adminUrl) as string;
  const superuser = bootstrapUrl(o.adminUrl);
  const name = databaseName(o.adminUrl);

  const others = await firmsNotInTheDemo(superuser, name);
  if (others > 0) {
    throw new NotADemoServer(
      `${others} firm${others === 1 ? " isn't" : "s aren't"} one of the made-up demo firms, so the database is left as it is`,
    );
  }

  await ensureOwnerRole(superuser, owner);
  await syncRolePassword(superuser, APP_DB_ROLE, credentials(o.appUrl).password);
  await syncRolePassword(superuser, JOBS_DB_ROLE, credentials(o.jobsUrl).password);
  await recreateDatabase(superuser, name, owner);
  await runMigrations({ adminUrl: o.adminUrl, appUrl: o.appUrl, jobsUrl: o.jobsUrl });
  await refuseRealPeople(o.adminUrl);
  const summary = await seed({
    adminUrl: o.adminUrl,
    appUrl: o.appUrl,
    nodeEnv: o.nodeEnv,
    demoMode: "on",
    ...(o.today ? { today: o.today } : {}),
  });
  if (o.outboxFile) await writeFile(o.outboxFile, "");
  return summary;
}

// How many firms in the database aren't demo firms: none when there's no database or no firms
// table yet (a new server). As the superuser, which row security doesn't hide rows from.
async function firmsNotInTheDemo(superuserUrl: string, name: string): Promise<number> {
  const maintenance = new Client({ connectionString: withDatabase(superuserUrl, "postgres") });
  await maintenance.connect();
  try {
    const found = await maintenance.query("select 1 from pg_database where datname = $1", [name]);
    if (found.rowCount === 0) return 0;
  } finally {
    await maintenance.end();
  }
  const db = new Client({ connectionString: superuserUrl });
  await db.connect();
  try {
    const table = await db.query<{ ok: boolean }>(
      "select to_regclass('public.firms') is not null as ok",
    );
    if (!table.rows[0]?.ok) return 0;
    const firms = await db.query<{ id: string }>("select id::text as id from firms");
    return firms.rows.filter((f) => !isDemoFirm(f.id)).length;
  } finally {
    await db.end();
  }
}

// The demo database refuses real people itself (golden rule 7; ADR-025): a casual's mobile outside
// Ofcom's drama range, or an email (a casual's or the office's) on a domain that isn't reserved for
// examples, is refused when it's written, from any page, import or API alike, so a visitor can't
// bring real staff onto the demo. The same rule as src/lib/demo/made-up.ts (checked against it by
// tests/integration/demo.reset.test.ts). Only on a demo database: added here, after the migrations,
// as the owner (the tables' owner); the app's own roles can't change it.
export const MADE_UP_PEOPLE_SQL = `
create or replace function demo_made_up_email(address text) returns boolean
language sql immutable as $$
  select address ~ '^.+@[^@]+$'
     and regexp_replace(regexp_replace(lower(btrim(address)), '^.*@', ''), '\\.$', '')
         ~ '^(.*\\.)?(example\\.com|example\\.org|example|test|invalid|localhost)$'
$$;

create or replace function demo_only_made_up_people() returns trigger
language plpgsql as $$
begin
  -- (Nested: office_users has no mobile number to read.)
  if tg_table_name = 'workers' then
    if new.mobile_e164 is not null and new.mobile_e164 !~ '^\\+447700900[0-9]{3}$' then
      raise exception 'demo: only made-up mobile numbers (07700 900000 to 07700 900999)'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.email is not null and not demo_made_up_email(new.email) then
    raise exception 'demo: only made-up email addresses (example.com and the like)'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger demo_only_made_up_people before insert or update on workers
  for each row execute function demo_only_made_up_people();
create trigger demo_only_made_up_people before insert or update on office_users
  for each row execute function demo_only_made_up_people();
`;

async function refuseRealPeople(adminUrl: string): Promise<void> {
  const owner = new Client({ connectionString: adminUrl });
  await owner.connect();
  try {
    await owner.query(MADE_UP_PEOPLE_SQL);
  } finally {
    await owner.end();
  }
}
