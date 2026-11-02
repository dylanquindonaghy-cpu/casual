import type { Pool } from "pg";
import type { JobResult } from "pg-boss";

// Plays the job worker on a fake clock, for one firm: takes that firm's jobs from the real pg-boss
// queue (pgboss.job) in start_after order, runs each through the given handler at the job's time,
// and marks it done, so a chain of jobs (waves queuing waves, holds, escalations) plays out as the
// worker would run it. Handlers should call the real wrappers (runFirmJob / runFirmTask), so
// payload validation and the firm scoping run too. Test databases only (writes pgboss.job as the
// superuser).

export type Handler = (job: { id: string; data: unknown }, now: Date) => Promise<JobResult>;

export interface Ran {
  at: Date;
  name: string;
  data: Record<string, unknown>;
  status: JobResult["status"];
  output: unknown;
}

export function fakeWorker(su: Pool, firmId: string, handlers: Record<string, Handler>) {
  const names = Object.keys(handlers);
  const ran: Ran[] = [];

  // The earliest waiting job of this firm on the handled queues. A job queued to run at once (no
  // startAfter) carries the database's real time, not the test's: pg-boss stamps its start_after and
  // created_on with the same job_now() in one statement. So it's due now on the fake clock, ahead of
  // any job queued for a set time, whatever the real date. (Ordering by its real stamp alone only
  // worked while the real date was before the tests' fixed NOW: from 09:00 on 2 Nov 2026 the at-once
  // waves jumped to the real time of the run.)
  async function nextJob() {
    const { rows } = await su.query<{
      id: string;
      name: string;
      data: Record<string, unknown>;
      start_after: Date;
      at_once: boolean;
    }>(
      `select id::text as id, name, data, start_after, start_after = created_on as at_once
         from pgboss.job
        where name = any($1) and data ->> 'firmId' = $2 and state = 'created'
        order by start_after = created_on desc, start_after, created_on, id
        limit 1`,
      [names, firmId],
    );
    return rows[0] ?? null;
  }

  return {
    ran,
    // Runs every job due by `until`, in order, each at max(its time, `from`), a job queued at once
    // at the clock: the clock only moves forward. A job queued by a job (for later) runs in its turn
    // if it's due by `until`.
    async runUntil(until: Date, from: Date): Promise<Ran[]> {
      const start = ran.length;
      let clock = from;
      for (let guard = 0; guard < 500; guard++) {
        const job = await nextJob();
        const due = job && (job.at_once ? clock : job.start_after);
        if (!job || !due || due.getTime() > until.getTime()) break;
        if (due.getTime() > clock.getTime()) clock = due;
        const handler = handlers[job.name];
        if (!handler) throw new Error(`no handler for ${job.name}`);
        const result = await handler({ id: job.id, data: job.data }, clock);
        await su.query(
          "update pgboss.job set state = $2, completed_on = now(), output = $3 where id = $1",
          [job.id, result.status === "completed" ? "completed" : "failed", result.output ?? null],
        );
        ran.push({
          at: clock,
          name: job.name,
          data: job.data,
          status: result.status,
          output: result.output,
        });
      }
      return ran.slice(start);
    },
    // The firm's jobs still waiting on the handled queues.
    async waiting() {
      const { rows } = await su.query<{
        name: string;
        data: Record<string, unknown>;
        start_after: Date;
      }>(
        `select name, data, start_after from pgboss.job
          where name = any($1) and data ->> 'firmId' = $2 and state = 'created'
          order by start_after, created_on`,
        [names, firmId],
      );
      return rows;
    },
  };
}
