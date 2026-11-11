"use server";

import { z } from "zod";
import { createAnswer, setAnswerSwitch, switchAnswer, updateAnswer } from "@/lib/answers/office";
import { ANSWER_CHANNELS } from "@/lib/answers/switches";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import type {
  AnswerSwitchResult,
  ChannelSwitchResult,
  SaveResult,
} from "@/lib/office/answers-copy";
import type { OfficeContext } from "@/lib/office/office-context";
import { requestLog } from "@/lib/request";

// Settings → Automatic answers (Phase 35.3; docs/screens.md "## Phase 35", "The office's page").
// The firm comes from the request's host and the office user from their session: admins only (the
// "answers" area), checked here and again inside each change (src/lib/answers/office.ts), which
// logs it, ids only. The browser sends only what each change needs, checked here with zod.

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

async function asAdmin<T>(
  label: string,
  work: (ctx: OfficeContext) => Promise<T>,
): Promise<T | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "answers")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

const channelSchema = z.enum(ANSWER_CHANNELS);
const onSchema = z.boolean();
const idSchema = z.uuid();

// One of the three switches (app messages, texts, email).
export async function setChannelSwitchAction(
  channel: unknown,
  on: unknown,
): Promise<ChannelSwitchResult> {
  const c = channelSchema.safeParse(channel);
  const o = onSchema.safeParse(on);
  if (!c.success || !o.success) return { status: "invalid" };
  return asAdmin("answers channel switch", (ctx) => setAnswerSwitch(ctx, c.data, o.data));
}

// An answer's own switch on the list.
export async function switchAnswerAction(id: unknown, on: unknown): Promise<AnswerSwitchResult> {
  const i = idSchema.safeParse(id);
  const o = onSchema.safeParse(on);
  if (!i.success || !o.success) return { status: "not_found" };
  return asAdmin("answer switch", (ctx) => switchAnswer(ctx, i.data, o.data));
}

// Add or Edit: the name, examples and words as typed (bounded here; checked properly by
// checkAnswer() in the change), and what to do with its switch: "on" (Save and switch on), "off"
// (Save, keep off; on Edit, Save and switch off) or "keep" (Edit's Save, keep on).
const saveSchema = z.object({
  id: idSchema.optional(),
  name: z.string().max(1_000),
  examples: z.string().max(5_000),
  body: z.string().max(5_000),
  switch: z.enum(["on", "off", "keep"]),
});

export async function saveAnswerAction(input: unknown): Promise<SaveResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { status: "error" };
  const { id, switch: sw, ...answer } = parsed.data;
  const result = await asAdmin("save answer", (ctx) =>
    id
      ? updateAnswer(ctx, id, answer, sw === "keep" ? {} : { switchOn: sw === "on" })
      : createAnswer(ctx, answer, { switchOn: sw === "on" }),
  );
  return result;
}
