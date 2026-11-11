import { and, asc, desc, eq, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { answers, firms, officeUsers } from "../db/schema";
import { withFirm, type FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeUserMay, type OfficeContext } from "../office/office-context";
import { libraryAllowed } from "../inbound/keywords";
import { aboutPayTrouble } from "./match";
import {
  ANSWER_SETTING_KEYS,
  answerSwitches,
  type AnswerChannel,
  type AnswerSwitches,
} from "./switches";
import { checkAnswer, examplesFromText, type AnswerCheck } from "./validate";

// The office's side of the answer library (Phase 35; the page is 35.3's: Settings → Automatic
// answers, admins only). Reads for the page, and the writes it makes, each in one transaction that
// first re-checks the office user may use the "answers" area (as saveStrikesEmail checks
// "settings"). Every change is logged, ids only: `answer.created`, `answer.changed` {answerId, keys},
// `answer.switched` {answerId, on}, and `firm.settings_changed` {by: "firm", keys, on} for the three
// switches (written only through app_set_firm_setting(), migration 0073). Answers are never deleted,
// only switched off.

export const USES_DAYS = 7;

export interface OfficeAnswer {
  id: string;
  name: string;
  examples: string[];
  body: string;
  isOn: boolean;
  starterKey: string | null; // which starter it came from (null: the firm's own)
  updatedAt: Date;
  updatedByName: string | null; // null: the system (a starter nobody has changed)
  usesLast7Days: number; // replies that carried it (app, texts, email) in the last 7 days
}

const answerColumns = {
  id: answers.id,
  name: answers.name,
  examples: answers.examples,
  body: answers.body,
  isOn: answers.isOn,
  starterKey: answers.starterKey,
  updatedAt: answers.updatedAt,
  updatedByName: officeUsers.name,
};

// How many replies carried each answer since `since` (message.replied and email.replied name it).
async function usesSince(tx: FirmTx, since: Date): Promise<Map<string, number>> {
  const { rows } = await tx.execute<{ answer_id: string; n: number }>(sql`
    select e.data ->> 'answerId' as answer_id, count(*)::int as n
      from events e
     where e.action in ('message.replied', 'email.replied')
       and e.data ? 'answerId' and e.created_at > ${since}
     group by 1
  `);
  return new Map(rows.map((r) => [r.answer_id, r.n]));
}

// The firm's answers: switched on first, then by name.
export async function listAnswers(tx: FirmTx, now: Date): Promise<OfficeAnswer[]> {
  const rows = await tx
    .select(answerColumns)
    .from(answers)
    .leftJoin(
      officeUsers,
      and(eq(officeUsers.firmId, answers.firmId), eq(officeUsers.id, answers.updatedBy)),
    )
    .orderBy(desc(answers.isOn), asc(answers.name), asc(answers.id));
  const uses = await usesSince(tx, new Date(now.getTime() - USES_DAYS * 86_400_000));
  return rows.map((r) => ({
    ...r,
    examples: examplesFromText(r.examples),
    usesLast7Days: uses.get(r.id) ?? 0,
  }));
}

export async function getAnswer(tx: FirmTx, id: string, now: Date): Promise<OfficeAnswer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await tx
    .select(answerColumns)
    .from(answers)
    .leftJoin(
      officeUsers,
      and(eq(officeUsers.firmId, answers.firmId), eq(officeUsers.id, answers.updatedBy)),
    )
    .where(eq(answers.id, id));
  if (!row) return null;
  const uses = await usesSince(tx, new Date(now.getTime() - USES_DAYS * 86_400_000));
  return { ...row, examples: examplesFromText(row.examples), usesLast7Days: uses.get(row.id) ?? 0 };
}

export type SaveAnswerResult =
  | { status: "saved"; id: string; switchedOn: boolean }
  | { status: "unchanged"; id: string }
  | { status: "invalid"; errors: Extract<AnswerCheck, { ok: false }>["errors"] }
  | { status: "not_allowed" }
  | { status: "not_found" };

// Add and Edit's "Save and switch on" and "Save, keep off" (35.3).
export async function createAnswer(
  ctx: OfficeContext,
  input: unknown,
  opts: { switchOn: boolean },
): Promise<SaveAnswerResult> {
  const checked = checkAnswer(input);
  if (!checked.ok) return { status: "invalid", errors: checked.errors };
  const a = checked.answer;
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx): Promise<SaveAnswerResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "answers"))) return { status: "not_allowed" };
    const [row] = await tx
      .insert(answers)
      .values({
        firmId: sql`app_current_firm_id()`,
        name: a.name,
        examples: a.examples.join("\n"),
        body: a.body,
        isOn: opts.switchOn,
        updatedBy: ctx.officeUserId,
      })
      .returning({ id: answers.id });
    if (!row) throw new Error("answer insert returned nothing");
    const by = { actorType: "office" as const, actorId: ctx.officeUserId };
    await recordEvent(tx, {
      ...by,
      action: "answer.created",
      entityType: "answer",
      entityId: row.id,
      data: { answerId: row.id },
    });
    if (opts.switchOn) {
      await recordEvent(tx, {
        ...by,
        action: "answer.switched",
        entityType: "answer",
        entityId: row.id,
        data: { answerId: row.id, on: true },
      });
    }
    return { status: "saved", id: row.id, switchedOn: opts.switchOn };
  });
}

// Edit: the name, examples and words (logged with which changed), and on or off when asked
// (`switchOn` true: "Save and switch on"; false: "Save, keep off" switches it off; undefined: as is).
export async function updateAnswer(
  ctx: OfficeContext,
  id: string,
  input: unknown,
  opts: { switchOn?: boolean } = {},
): Promise<SaveAnswerResult> {
  const checked = checkAnswer(input);
  if (!checked.ok) return { status: "invalid", errors: checked.errors };
  const a = checked.answer;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: "not_found" };
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx): Promise<SaveAnswerResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "answers"))) return { status: "not_allowed" };
    const [before] = await tx
      .select({
        name: answers.name,
        examples: answers.examples,
        body: answers.body,
        isOn: answers.isOn,
      })
      .from(answers)
      .where(eq(answers.id, id))
      .for("update");
    if (!before) return { status: "not_found" };
    const examples = a.examples.join("\n");
    const keys = [
      ...(before.name !== a.name ? ["name"] : []),
      ...(before.examples !== examples ? ["examples"] : []),
      ...(before.body !== a.body ? ["body"] : []),
    ];
    const isOn = opts.switchOn ?? before.isOn;
    if (keys.length === 0 && isOn === before.isOn) return { status: "unchanged", id };
    await tx
      .update(answers)
      .set({
        name: a.name,
        examples,
        body: a.body,
        isOn,
        updatedBy: ctx.officeUserId,
        updatedAt: sql`now()`,
      })
      .where(eq(answers.id, id));
    const by = { actorType: "office" as const, actorId: ctx.officeUserId };
    if (keys.length > 0) {
      await recordEvent(tx, {
        ...by,
        action: "answer.changed",
        entityType: "answer",
        entityId: id,
        data: { answerId: id, keys },
      });
    }
    if (isOn !== before.isOn) {
      await recordEvent(tx, {
        ...by,
        action: "answer.switched",
        entityType: "answer",
        entityId: id,
        data: { answerId: id, on: isOn },
      });
    }
    return { status: "saved", id, switchedOn: isOn };
  });
}

export type SwitchResult =
  | { status: "switched"; on: boolean }
  | { status: "unchanged"; on: boolean }
  | { status: "not_allowed" }
  | { status: "not_found" };

// An answer's own switch on the list (35.3).
export async function switchAnswer(
  ctx: OfficeContext,
  id: string,
  on: boolean,
): Promise<SwitchResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: "not_found" };
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx): Promise<SwitchResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "answers"))) return { status: "not_allowed" };
    const [before] = await tx
      .select({ isOn: answers.isOn })
      .from(answers)
      .where(eq(answers.id, id))
      .for("update");
    if (!before) return { status: "not_found" };
    if (before.isOn === on) return { status: "unchanged", on };
    await tx
      .update(answers)
      .set({ isOn: on, updatedBy: ctx.officeUserId, updatedAt: sql`now()` })
      .where(eq(answers.id, id));
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "answer.switched",
      entityType: "answer",
      entityId: id,
      data: { answerId: id, on },
    });
    return { status: "switched", on };
  });
}

// The three switches as the firm has them, and the owner's master switch for texts and email.
export async function answerSettings(
  tx: FirmTx,
): Promise<{ switches: AnswerSwitches; autoReplies: boolean }> {
  const [firm] = await tx
    .select({ settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const settings = firm?.settings ?? {};
  return { switches: answerSwitches(settings), autoReplies: settings.auto_replies === true };
}

export type SetSwitchResult =
  | { status: "saved"; on: boolean }
  | { status: "unchanged"; on: boolean }
  | { status: "not_allowed" };

// One of the three switches (app messages, texts, the staffing email), through
// app_set_firm_setting() (the app role can't write firms, nor lock its row: the function takes the
// lock), logged `firm.settings_changed`. Setting it to what it is already changes and logs nothing.
export async function setAnswerSwitch(
  ctx: OfficeContext,
  channel: AnswerChannel,
  on: boolean,
): Promise<SetSwitchResult> {
  const key = ANSWER_SETTING_KEYS[channel];
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx): Promise<SetSwitchResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "answers"))) return { status: "not_allowed" };
    const [firm] = await tx
      .select({ settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    if (answerSwitches(firm?.settings ?? {})[channel] === on) return { status: "unchanged", on };
    await tx.execute(sql`select app_set_firm_setting(${key}, ${on ? "true" : "false"})`);
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "firm.settings_changed",
      entityType: "firm",
      entityId: ctx.firm.id,
      data: { by: "firm", keys: [key], on },
    });
    return { status: "saved", on };
  });
}

export interface UnansweredQuestion {
  id: string; // the message's or the email's id (Enquiries opens it)
  kind: "message" | "email";
  channel: "app" | "whatsapp" | "sms" | "email";
  text: string;
  at: Date;
}

export const UNANSWERED_DAYS = 30;

// "Asked a lot, no answer yet" (35.3): the latest casuals' questions with words that went to a
// person in the last 30 days (sorted as the office's: no answer, a keyword asking for a person, or
// an answer that couldn't be filled in), newest first. Not one about a session or her pay (a
// person's by design), nor one about pay going wrong (never a library answer: golden rule 9), nor a
// voicemail, nor one no answer could ever take (it asks to cancel or for a person, or says they
// can't make it: libraryAllowed(), the guardrails review's H1). For "Make this an answer"; the
// words are the casual's own, shown to admins only.
export async function questionsWithNoAnswer(
  tx: FirmTx,
  opts: { limit?: number; now?: Date } = {},
): Promise<UnansweredQuestion[]> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const now = opts.now ?? systemClock.now();
  const since = new Date(now.getTime() - UNANSWERED_DAYS * 86_400_000);
  const { rows } = await tx.execute<{
    id: string;
    kind: "message" | "email";
    channel: UnansweredQuestion["channel"];
    text: string;
    at: string | Date;
  }>(sql`
    select * from (
      select m.id::text as id, 'message' as kind, m.channel, m.body as text, m.created_at as at
        from messages m
       where m.direction = 'in' and m.intent = 'office' and m.worker_id is not null
         and m.body is not null and m.shift_id is null and m.channel in ('app', 'whatsapp', 'sms')
         and m.handled_as in ('keyword', 'ai', 'office') and m.created_at > ${since}
      union all
      select e.id::text, 'email', 'email', concat_ws(E'\\n', e.subject, e.body), e.created_at
        from inbound_emails e
       where e.intent = 'office' and e.worker_id is not null and e.body is not null
         and e.handled_as in ('keyword', 'ai', 'office') and e.created_at > ${since}
    ) q
    order by q.at desc, q.id
    limit ${limit * 3}
  `);
  return rows
    .filter((r) => !aboutPayTrouble(r.text) && libraryAllowed(r.text))
    .slice(0, limit)
    .map((r) => ({ ...r, at: new Date(r.at) }));
}
