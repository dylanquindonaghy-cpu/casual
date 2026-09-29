import { and, asc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { uuidArray } from "../db/arrays";
import { retryAborted } from "../db/retry";
import { payQueries } from "../db/schema";
import type { WithFirm } from "../db/scoped";
import { recordEvents } from "../events/record";
import { queuePayQueryUpdate } from "../notices/pay-query-update";
import { officeUserMay } from "../office/office-context";
import { rosterId } from "../roster/book";

// Payroll sorting pay queries (docs/screens.md `/office/pay-queries`; docs/api-and-jobs.md
// `resolvePayQueryGroup`): a group's queries, marked sorted with a note that each worker gets. One
// transaction:
// - an active payroll user or admin (the pay area);
// - the ids payroll saw in the group, so nothing they didn't read is sorted (a query can move group
//   when regrouped); only those still waiting (open or in a digest), locked in id order so two
//   payroll users sorting at once can't deadlock or both sort one;
// - a note, required (a pay question answered with no explanation isn't an answer), at most 500
//   characters: kept on the row and sent to the worker, never in an event. Always typed by a person:
//   no AI answers a pay dispute (golden rule 9);
// - one pay_query.resolved {workerId, previous, withNote} per query, and one pay-query-update job per query
//   to tell its worker.

export const MAX_PAY_NOTE = 500;
// The most a group on payroll's page can hold (the page shows the newest 2,000 queries).
export const MAX_SORT_IDS = 2000;

export const resolvePayQueriesSchema = z.strictObject({
  ids: z.array(rosterId).min(1).max(MAX_SORT_IDS),
  note: z.string(), // at most MAX_PAY_NOTE once trimmed: checked below, with its own answer
  by: z.strictObject({ type: z.literal("office"), id: rosterId }),
});
export type ResolvePayQueriesInput = z.input<typeof resolvePayQueriesSchema>;

export type ResolvePayQueriesResult =
  | { status: "sorted"; count: number; skipped: number } // skipped: already sorted by someone
  | { status: "already" } // none of them is still waiting (sorted by someone else)
  | { status: "note_needed" }
  | { status: "note_too_long" }
  | { status: "not_allowed" };

export async function resolvePayQueries(
  run: WithFirm,
  firmId: string,
  raw: ResolvePayQueriesInput,
  deps: { clock?: Clock } = {},
): Promise<ResolvePayQueriesResult> {
  const input = resolvePayQueriesSchema.parse(raw);
  const now = (deps.clock ?? systemClock).now();
  const note = input.note.trim();
  if (!note) return { status: "note_needed" };
  if (note.length > MAX_PAY_NOTE) return { status: "note_too_long" };
  const ids = [...new Set(input.ids)];
  return retryAborted(() =>
    run(firmId, async (tx): Promise<ResolvePayQueriesResult> => {
      if (!(await officeUserMay(tx, input.by.id, "pay"))) return { status: "not_allowed" };
      const waiting = await tx
        .select({ id: payQueries.id, status: payQueries.status, workerId: payQueries.workerId })
        .from(payQueries)
        .where(
          and(
            sql`${payQueries.id} = any(${uuidArray(ids)})`,
            inArray(payQueries.status, ["open", "in_digest"]),
          ),
        )
        .orderBy(asc(payQueries.id))
        .for("update");
      if (waiting.length === 0) return { status: "already" };
      await tx
        .update(payQueries)
        .set({ status: "resolved", resolvedBy: input.by.id, resolvedAt: now, resolutionNote: note })
        .where(sql`${payQueries.id} = any(${uuidArray(waiting.map((q) => q.id))})`);
      await recordEvents(
        tx,
        waiting.map((q) => ({
          actorType: "office" as const,
          actorId: input.by.id,
          action: "pay_query.resolved",
          entityType: "pay_query",
          entityId: q.id,
          data: { workerId: q.workerId, previous: q.status, withNote: true },
        })),
      );
      for (const q of waiting) await queuePayQueryUpdate(tx, { payQueryId: q.id });
      return { status: "sorted", count: waiting.length, skipped: ids.length - waiting.length };
    }),
  );
}
