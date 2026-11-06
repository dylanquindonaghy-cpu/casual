import { eq, sql } from "drizzle-orm";
import { firms, payQueries } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { MAX_PAY_QUERY_DETAILS } from "../portal/pay-query-kinds";
import { cutChars } from "../text/cut";
import { localDateOf } from "../time/zoned";
import { groupFactsFor, payGroupKey } from "./grouping";

// A pay question sent from Messages opened about her pay (Phase 29.1; docs/screens.md "### 29.1";
// Dylan's decision 20): Pay's and the pay query's "Message the office" open /messages?about=pay
// when Pay can't take the question (no way to send her a code, or older than 90 days). What she
// sends there becomes a pay query for payroll's digest (golden rule 9), never an office request and
// never an automatic or AI answer. Called by src/lib/inbound/app.ts inside the transaction that
// stores her message, so the message and its pay query go in together or not at all, and a resend
// with the same id (a repeat: nothing stored) raises nothing.
//
// The query: issue "other" (Something else), no shift, the day she sent it in the firm's time as
// the day worked (the pay query's day can't be ahead of today, and she named none), her words as
// its details (cut to the pay query's 1,000 characters; the whole message stays on her thread),
// status open, grouped by code as any other (src/lib/pay/grouping.ts). Logged as the pay page's
// are, `pay_query.created`, with `via: "messages"`, the message's id and, when the app knows it,
// why Pay couldn't take it (`why: "no_code"`: no way to send her a code). Ids only: her words are
// never in the log. No pay figure is shown, so no pay code is needed to raise it.

export const PAY_FROM_MESSAGES_WHY = ["no_code"] as const;
export type PayFromMessagesWhy = (typeof PAY_FROM_MESSAGES_WHY)[number];

const refOf = (id: string) => id.slice(0, 8).toUpperCase();

export async function payQueryFromMessage(
  tx: FirmTx,
  input: {
    workerId: string;
    messageId: string;
    text: string; // her message, already trimmed and not empty
    now: Date;
    why: PayFromMessagesWhy | null;
  },
): Promise<{ id: string; ref: string }> {
  // One pay query at a time per worker, as the pay page's (src/lib/portal/pay-queries.ts).
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('pay-query:' || app_current_firm_id()::text || ':' || ${input.workerId}, 0))`,
  );
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const workDate = localDateOf(input.now, firm?.timezone ?? "Europe/London");
  const groupKey = payGroupKey(
    await groupFactsFor(tx, {
      workerId: input.workerId,
      shiftId: null,
      workDate,
      issue: "other",
    }),
  );
  const [created] = await tx
    .insert(payQueries)
    .values({
      firmId: sql`app_current_firm_id()`,
      workerId: input.workerId,
      shiftId: null,
      workDate,
      issueType: "other",
      details: cutChars(input.text, MAX_PAY_QUERY_DETAILS),
      groupKey,
    })
    .returning({ id: payQueries.id });
  if (!created) throw new Error("pay query insert returned nothing");
  await recordEvent(tx, {
    actorType: "worker",
    actorId: input.workerId,
    action: "pay_query.created",
    entityType: "pay_query",
    entityId: created.id,
    data: {
      issueType: "other",
      shiftId: null,
      workDate,
      groupKey,
      via: "messages",
      messageId: input.messageId,
      ...(input.why ? { why: input.why } : {}),
    },
  });
  return { id: created.id, ref: refOf(created.id) };
}
