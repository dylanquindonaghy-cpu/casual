import { eq, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import {
  answerSettings,
  getAnswer,
  listAnswers,
  questionsWithNoAnswer,
  USES_DAYS,
  type OfficeAnswer,
  type UnansweredQuestion,
} from "../answers/office";
import { aboutPayTrouble } from "../answers/match";
import { libraryAllowed } from "../inbound/keywords";
import type { AnswerChannel, AnswerSwitches } from "../answers/switches";
import { firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { isAskOffice } from "../portal/messages-copy";
import { signOffFor } from "../tenancy/sign-off";
import { exampleFromQuestion } from "./answers-copy";
import { officeUserMay, parts, type OfficeContext } from "./office-context";

// Settings → Automatic answers (Phase 35.3; docs/screens.md "## Phase 35", "The office's page"):
// what the page and its Add and Edit forms read, each for an active admin of the firm only (the
// "answers" area, checked inside the transaction; the page checks the session too), else null.
// Reads only. The writes are src/lib/answers/office.ts's, through the page's actions.

export interface AnswersPage {
  timeZone: string;
  firmName: string;
  switches: AnswerSwitches;
  autoReplies: boolean; // the owner's master switch for texts and email (P4.7)
  inbox: boolean; // the firm has a staffing inbox (P7)
  answeredLast7Days: Record<AnswerChannel, number>; // library answers sent, by channel
  builtInLast7Days: Record<"shifts" | "cancel" | "pay", number>;
  answers: OfficeAnswer[];
  unanswered: UnansweredQuestion[];
  now: Date;
}

// Replies sent in the last 7 days: the library's by channel, and the built-in answers by kind.
async function usesThisWeek(tx: FirmTx, now: Date) {
  const since = new Date(now.getTime() - USES_DAYS * 86_400_000);
  const { rows } = await tx.execute<{ kind: string; n: number }>(sql`
    select case
             when e.data ? 'answerId' then
               case when e.action = 'email.replied' then 'email'
                    when e.data ->> 'channel' = 'app' then 'app' else 'texts' end
             else coalesce(e.data ->> 'intent', e.data ->> 'answer')
           end as kind,
           count(*)::int as n
      from events e
     where e.action in ('message.replied', 'email.replied') and e.created_at > ${since}
     group by 1
  `);
  const n = (k: string) => rows.find((r) => r.kind === k)?.n ?? 0;
  return {
    library: { app: n("app"), texts: n("texts"), email: n("email") },
    builtIn: { shifts: n("shifts"), cancel: n("cancel"), pay: n("pay") },
  };
}

export async function officeAnswersPage(ctx: OfficeContext): Promise<AnswersPage | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "answers"))) return null;
    const [firm] = await tx
      .select({ name: firms.name, timezone: firms.timezone, inbox: firms.inboxAddress })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    const { switches, autoReplies } = await answerSettings(tx);
    const uses = await usesThisWeek(tx, now);
    return {
      timeZone: firm?.timezone ?? "Europe/London",
      firmName: firm?.name ?? "",
      switches,
      autoReplies,
      inbox: firm?.inbox != null,
      answeredLast7Days: uses.library,
      builtInLast7Days: uses.builtIn,
      answers: await listAnswers(tx, now),
      // Not a casual's "Ask the office" after an answer (Phase 35.4): a follow-up, not a question.
      unanswered: (await questionsWithNoAnswer(tx, { now, limit: 20 }))
        .filter((q) => !isAskOffice(q.text))
        .slice(0, 10),
      now,
    };
  });
}

export interface AnswerForm {
  timeZone: string;
  firmName: string;
  signOff: string; // "Acme Events Shift Team", for the example of what a casual would get
  answer: OfficeAnswer | null; // Edit's; null on Add
  example: string | null; // Add's "?from=": the casual's question, as the first example
}

// One answer for Edit (null: not an admin, or no such answer of this firm's).
export async function officeAnswer(ctx: OfficeContext, id: string): Promise<AnswerForm | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "answers"))) return null;
    const answer = await getAnswer(tx, id, now);
    if (!answer) return null;
    return { ...(await firmFacts(tx)), answer, example: null };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Add, and Add from a question ("Make this an answer": `from` a message's or an email's id). Only
// the casual's own words of a question that went to a person, as "No answer yet" lists them (a
// casual's message in the app, a WhatsApp or a text, or their email's words; not one about a
// session, a voicemail, nor one about pay going wrong, nor one no answer could take: libraryAllowed()),
// read inside the firm: any other id, or one of another firm's, starts with no example.
export async function officeNewAnswer(
  ctx: OfficeContext,
  from: string | null,
): Promise<AnswerForm | null> {
  const { run } = parts(ctx);
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "answers"))) return null;
    const text = from && UUID.test(from) ? await questionText(tx, from) : null;
    return {
      ...(await firmFacts(tx)),
      answer: null,
      example:
        text && !aboutPayTrouble(text) && libraryAllowed(text)
          ? exampleFromQuestion(text) || null
          : null,
    };
  });
}

async function questionText(tx: FirmTx, id: string): Promise<string | null> {
  const { rows } = await tx.execute<{ text: string }>(sql`
    select m.body as text from messages m
     where m.id = ${id} and m.direction = 'in' and m.intent = 'office' and m.worker_id is not null
       and m.body is not null and m.shift_id is null and m.channel in ('app', 'whatsapp', 'sms')
       and m.handled_as in ('keyword', 'ai', 'office')
    union all
    select e.body from inbound_emails e
     where e.id = ${id} and e.intent = 'office' and e.worker_id is not null and e.body is not null
       and e.handled_as in ('keyword', 'ai', 'office')
  `);
  return rows[0]?.text ?? null;
}

async function firmFacts(tx: FirmTx) {
  const [firm] = await tx
    .select({ name: firms.name, timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const name = firm?.name ?? "";
  return {
    timeZone: firm?.timezone ?? "Europe/London",
    firmName: name,
    signOff: signOffFor(name, firm?.settings.sign_off),
  };
}
