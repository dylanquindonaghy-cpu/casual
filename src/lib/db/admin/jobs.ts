import { Client } from "pg";
import { PgBoss } from "pg-boss";
import { APP_DB_ROLE } from "../../env";
import { ensureQueues } from "../../../worker/jobs/queues";

// Installs or upgrades pg-boss as the jobs role (which owns the pgboss tables), creates every
// queue, then limits the app role (the web) to enqueueing jobs for its own firm.
//
// Why: if the web role owned pgboss, it could queue a job, or a schedule, for any firm, and the
// worker would run it inside that firm. Here the app role can only INSERT into job_common, and
// the policy below rejects any job whose firmId isn't the transaction's firm. pgboss is a
// library-owned schema, so it is the documented exception to "every table has firm_id".
export async function installJobs(jobsUrl: string): Promise<void> {
  const boss = new PgBoss({
    connectionString: jobsUrl,
    createSchema: false, // the owner creates the schema (0001_rls_setup.sql)
    migrate: true,
    supervise: false,
    schedule: false,
    max: 2,
  });
  await boss.start();
  try {
    await ensureQueues(boss);
  } finally {
    await boss.stop({ graceful: false });
  }

  const client = new Client({ connectionString: jobsUrl });
  await client.connect();
  try {
    const app = client.escapeIdentifier(APP_DB_ROLE);
    await client.query("begin");
    // Not FORCE: the jobs role (the table owner, i.e. the worker) is unaffected.
    await client.query("alter table pgboss.job_common enable row level security");
    await client.query("drop policy if exists app_enqueue on pgboss.job_common");
    await client.query(
      `create policy app_enqueue on pgboss.job_common for insert to ${app}
         with check (name !~ '^__pgboss'
           and (data ->> 'firmId')::uuid = (select public.app_current_firm_id()))`,
    );
    // pg-boss's send() uses RETURNING id, which needs a matching select policy.
    await client.query("drop policy if exists app_returning on pgboss.job_common");
    await client.query(
      `create policy app_returning on pgboss.job_common for select to ${app}
         using ((data ->> 'firmId')::uuid = (select public.app_current_firm_id()))`,
    );
    await client.query(`revoke all on all tables in schema pgboss from ${app}`);
    // pg-boss functions default to EXECUTE for PUBLIC; the app only needs job_now() to enqueue.
    await client.query("revoke execute on all functions in schema pgboss from public");
    await client.query(`grant select on pgboss.queue to ${app}`);
    await client.query(`grant insert, select (id) on pgboss.job_common to ${app}`);
    await client.query(`grant execute on function pgboss.job_now() to ${app}`);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    await client.end();
  }
}
