import { sql } from "drizzle-orm";
import { DAY, systemClock } from "../auth/clock";
import { withFirm, type FirmTx } from "../db/scoped";
import type { PortalContext } from "./my-shifts";
import { PAY_QUERY_DAYS_BACK } from "./pay-query-kinds";
import { REQUESTS_SHOWN_DAYS } from "./requests";

// Answers she hasn't seen yet (Phase 28.2; the tab bar's counts, 28.7; marked seen by 28.9 and
// 28.10 once the answer is on her screen, through an action, never while a page renders):
// - the office's answers to her requests: approved or declined after workers.requests_read_at, on
//   requests from the last REQUESTS_SHOWN_DAYS (the ones My requests lists);
// - payroll's answers to her pay queries: resolved after workers.pay_answers_read_at, on queries
//   from the last PAY_QUERY_DAYS_BACK (the ones Pay lists, behind her code). Only that there is an
//   answer: never what it says.
// Her own rows only (worker_id), inside her firm's transaction. Marking moves the marker to the
// newest answer up to `upTo` (default now), never back: an answer stored after she looked still
// counts. The markers start when her row is made (docs/data-model.md), so older answers never
// count.

const ANSWERED = sql.raw(`'approved', 'declined'`);

async function countUnseen(
  tx: FirmTx,
  workerId: string,
  now: Date,
): Promise<{ answers: number; payAnswers: number }> {
  const requestsFrom = new Date(now.getTime() - REQUESTS_SHOWN_DAYS * DAY);
  const queriesFrom = new Date(now.getTime() - PAY_QUERY_DAYS_BACK * DAY);
  const { rows } = await tx.execute<{ answers: number; pay_answers: number }>(sql`
    select
      (select count(*)::int from requests r
        where r.firm_id = w.firm_id and r.worker_id = w.id
          and r.status in (${ANSWERED}) and r.created_at > ${requestsFrom}
          and r.resolved_at > coalesce(w.requests_read_at, '-infinity'::timestamptz)) as answers,
      (select count(*)::int from pay_queries q
        where q.firm_id = w.firm_id and q.worker_id = w.id
          and q.status = 'resolved' and q.created_at > ${queriesFrom}
          and q.resolved_at > coalesce(w.pay_answers_read_at, '-infinity'::timestamptz))
        as pay_answers
      from workers w
     where w.id = ${workerId}
  `);
  const row = rows[0];
  return { answers: row?.answers ?? 0, payAnswers: row?.pay_answers ?? 0 };
}

// Both counts in one read, for tabCounts().
export async function unseenAnswerCounts(
  ctx: PortalContext,
  workerId: string,
): Promise<{ answers: number; payAnswers: number }> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, (tx) => countUnseen(tx, workerId, now));
}

export async function unseenAnswers(ctx: PortalContext, workerId: string): Promise<number> {
  return (await unseenAnswerCounts(ctx, workerId)).answers;
}

export async function unseenPayAnswers(ctx: PortalContext, workerId: string): Promise<number> {
  return (await unseenAnswerCounts(ctx, workerId)).payAnswers;
}

// The office's answers she has now seen: requests_read_at moves to the newest answer to her
// requests resolved by `upTo` (and never back). Returns whether it moved.
export async function markAnswersSeen(
  ctx: PortalContext,
  workerId: string,
  upTo?: Date,
): Promise<boolean> {
  const now = (ctx.clock ?? systemClock).now();
  const until = upTo && upTo.getTime() < now.getTime() ? upTo : now;
  const run = ctx.run ?? withFirm;
  const { rowCount } = await run(ctx.firm.id, (tx) =>
    tx.execute(sql`
      update workers w
         set requests_read_at = x.newest
        from (select max(r.resolved_at) as newest from requests r
               where r.worker_id = ${workerId} and r.status in (${ANSWERED})
                 and r.resolved_at <= ${until}) x
       where w.id = ${workerId} and x.newest is not null
         and x.newest > coalesce(w.requests_read_at, '-infinity'::timestamptz)
    `),
  );
  return (rowCount ?? 0) > 0;
}

// Payroll's answers she has now seen (behind her pay code: 28.10 calls it only there):
// pay_answers_read_at moves to the newest resolved pay query of hers by `upTo` (never back).
export async function markPayAnswersSeen(
  ctx: PortalContext,
  workerId: string,
  upTo?: Date,
): Promise<boolean> {
  const now = (ctx.clock ?? systemClock).now();
  const until = upTo && upTo.getTime() < now.getTime() ? upTo : now;
  const run = ctx.run ?? withFirm;
  const { rowCount } = await run(ctx.firm.id, (tx) =>
    tx.execute(sql`
      update workers w
         set pay_answers_read_at = x.newest
        from (select max(q.resolved_at) as newest from pay_queries q
               where q.worker_id = ${workerId} and q.status = 'resolved'
                 and q.resolved_at <= ${until}) x
       where w.id = ${workerId} and x.newest is not null
         and x.newest > coalesce(w.pay_answers_read_at, '-infinity'::timestamptz)
    `),
  );
  return (rowCount ?? 0) > 0;
}
