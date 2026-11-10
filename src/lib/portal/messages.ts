import { and, eq, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { messages, shifts, workers } from "../db/schema";
import { withFirm, type FirmTx } from "../db/scoped";
import { switchedOnAnswers } from "../answers/library";
import { sessionToTag } from "../inbound/app";
import { askOfficeTexts, askOfficeWords } from "./messages-copy";
import type { PortalContext } from "./my-shifts";

// A casual's Messages (P8; Phase 25.6; docs/screens.md "Messages: the in-app chat"): their messages
// to the office in the app and the answers, oldest first, the last THREAD_DAYS days (the 90-day
// purge takes older ones anyway: src/lib/gdpr/retention.ts). An answer with an intent is the
// shifts line's automatic one (src/lib/inbound/reply.ts); one without is the office's
// (src/lib/office/enquiry-actions.ts). Opening the page marks the office's replies it shows as read
// (`workers.messages_read_at`: the newest one's stored time), which clears the tab's count; a reply stored
// while the page was reading, with an earlier time but not yet visible, still counts.

export const THREAD_DAYS = 90;
export const THREAD_MAX = 200; // the newest this many, should anyone write that much

export interface ThreadItem {
  id: string;
  mine: boolean;
  text: string | null;
  at: Date;
  from: "automatic" | "office" | null; // null: theirs
  // Hers, sent about her pay: it went to payroll as a pay query (Phase 29.1; src/lib/inbound/app.ts
  // stores only those as handled_as 'office' with intent 'pay'). Its answer is on her Pay page.
  toPayroll?: boolean;
  // An automatic answer that was one of the firm's own (Phase 35: `messages.answer_id`).
  libraryAnswer?: boolean;
}

// "Not what you needed? Ask the office" (Phase 35.4), under the latest of the firm's own answers in
// her thread (`replyId`), while she hasn't written since: the words it sends (`words`), or, once
// she has sent them, that it went (`asked`). Gone once she writes anything else after it.
export interface AskOffice {
  replyId: string;
  words: string;
  asked: boolean;
}

export interface Thread {
  items: ThreadItem[];
  more: boolean; // older ones within the days weren't shown
  latestMineAt: Date | null; // their newest message
  answered: boolean; // an answer came after their newest message (one to payroll waits for none)
  askOffice?: AskOffice | null; // Phase 35.4 (absent: none)
}

async function readThread(tx: FirmTx, workerId: string, now: Date): Promise<Thread> {
  const since = new Date(now.getTime() - THREAD_DAYS * 86_400_000);
  const { rows } = await tx.execute<{
    id: string;
    direction: "in" | "out";
    body: string | null;
    intent: string | null;
    handled_as: string | null;
    created_at: string | Date;
    answer_name: string | null;
  }>(sql`
    select m.id, m.direction, m.body, m.intent, m.handled_as, m.created_at, a.name as answer_name
      from messages m
      left join answers a
        on m.direction = 'out' and a.firm_id = m.firm_id and a.id = m.answer_id
     where m.channel = 'app' and m.worker_id = ${workerId} and m.created_at > ${since}
     order by m.created_at desc, m.id desc
     limit ${THREAD_MAX + 1}
  `);
  const items = rows
    .slice(0, THREAD_MAX)
    .reverse()
    .map((r): ThreadItem => ({
      id: r.id,
      mine: r.direction === "in",
      text: r.body,
      at: new Date(r.created_at),
      from: r.direction === "in" ? null : r.intent ? "automatic" : "office",
      toPayroll: r.direction === "in" && r.intent === "pay" && r.handled_as === "office",
      libraryAnswer: r.direction === "out" && r.answer_name !== null,
    }));
  const lastMine = items.findLastIndex((i) => i.mine);
  // One to payroll is answered on her Pay page, never here: it waits for no answer in the thread.
  const lastAsked = items.findLastIndex((i) => i.mine && !i.toPayroll);
  // The latest of the firm's own answers, and what she wrote after it.
  let askOffice: AskOffice | null = null;
  const lastAnswer = items.findLastIndex((i) => i.libraryAnswer);
  const names = rows
    .slice(0, THREAD_MAX)
    .reverse()
    .map((r) => (r.direction === "out" ? r.answer_name : null));
  const name = lastAnswer >= 0 ? names[lastAnswer] : null;
  const reply = lastAnswer >= 0 ? items[lastAnswer] : undefined;
  if (reply && name) {
    const after = items.slice(lastAnswer + 1).filter((i) => i.mine);
    const texts = askOfficeTexts(name);
    if (after.length > 0 && after.every((i) => i.text !== null && texts.includes(i.text))) {
      askOffice = { replyId: reply.id, words: "", asked: true };
    } else if (after.length === 0) {
      const words = askOfficeWords(name, await switchedOnAnswers(tx));
      if (words) askOffice = { replyId: reply.id, words, asked: false };
    }
  }
  return {
    items,
    askOffice,
    more: rows.length > THREAD_MAX,
    latestMineAt: lastMine >= 0 ? (items[lastMine]?.at ?? null) : null,
    answered: lastAsked < 0 || items.slice(lastAsked + 1).some((i) => !i.mine),
  };
}

// The page: the thread, and the office's replies it shows marked read, together.
export async function openMessages(ctx: PortalContext, workerId: string): Promise<Thread> {
  const run = ctx.run ?? withFirm;
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    const thread = await readThread(tx, workerId, now);
    const newest = thread.items.findLast((i) => i.from === "office")?.at;
    if (newest) {
      // The mark is the stored time of that reply, read in SQL: `newest` came back through a JS
      // Date, which keeps milliseconds only, while Postgres keeps microseconds. Marking the JS copy
      // left the newest reply a fraction of a millisecond "after" the mark, counted for ever.
      await tx
        .update(workers)
        .set({
          messagesReadAt: sql`greatest(${workers.messagesReadAt}, (
            select max(m.created_at) from ${messages} m
             where m.firm_id = ${workers.firmId} and m.worker_id = ${workers.id}
               and m.channel = 'app' and m.direction = 'out' and m.intent is null
               and m.created_at < ${newest}::timestamptz + interval '1 millisecond'))`,
        })
        .where(eq(workers.id, workerId));
    }
    return thread;
  });
}

// The thread alone, for the page's look after a send (nothing marked).
export async function messagesThread(ctx: PortalContext, workerId: string): Promise<Thread> {
  const run = ctx.run ?? withFirm;
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, (tx) => readThread(tx, workerId, now));
}

// The shift Messages was opened about (Phase 28.6; 28.2's link, src/lib/portal/message-office.ts):
// its role and start, for the About line, only when a message sent now would keep it
// (sessionToTag, the send's own check in src/lib/inbound/app.ts: hers, or shown to casuals; not a
// draft or cancelled; not ended). Null otherwise, and the page works as it did.
export interface MessageAboutShift {
  shiftId: string;
  role: string;
  startsAt: Date;
}

export async function messageAboutShift(
  ctx: PortalContext,
  workerId: string,
  shiftId: string,
): Promise<MessageAboutShift | null> {
  const run = ctx.run ?? withFirm;
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    const kept = await sessionToTag(tx, workerId, shiftId, now);
    if (!kept) return null;
    const [row] = await tx
      .select({ role: shifts.role, startsAt: shifts.startsAt })
      .from(shifts)
      .where(eq(shifts.id, kept));
    return row ? { shiftId: kept, role: row.role, startsAt: row.startsAt } : null;
  });
}

// Whether her message, just sent, kept the shift it was sent about (Phase 28.6): what the send
// stored (messages.shift_id, src/lib/inbound/app.ts), not the shift the page was opened with. A
// shift that ended between opening Messages and tapping Send isn't kept, and that message is sorted
// as any other, so the page says "Sent. The answer comes here.", not "The office will answer here."
// Hers only: another casual's message (or another firm's, under RLS) reads as not kept.
export async function messageKeptShift(
  ctx: PortalContext,
  workerId: string,
  messageId: string,
): Promise<boolean> {
  const run = ctx.run ?? withFirm;
  const [row] = await run(ctx.firm.id, (tx) =>
    tx
      .select({ shiftId: messages.shiftId })
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.workerId, workerId),
          eq(messages.direction, "in"),
          eq(messages.channel, "app"),
        ),
      ),
  );
  return row?.shiftId != null;
}

// The tab's count: the office's replies in the app since they last opened Messages.
export async function unreadReplies(ctx: PortalContext, workerId: string): Promise<number> {
  const run = ctx.run ?? withFirm;
  const { rows } = await run(ctx.firm.id, (tx) =>
    tx.execute<{ n: number }>(sql`
      select count(*)::int as n
        from messages m
        join workers w on w.firm_id = m.firm_id and w.id = m.worker_id
       where m.worker_id = ${workerId} and m.channel = 'app' and m.direction = 'out'
         and m.intent is null
         and m.created_at > coalesce(w.messages_read_at, '-infinity'::timestamptz)
    `),
  );
  return rows[0]?.n ?? 0;
}
