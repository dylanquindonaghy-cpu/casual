import { z } from "zod";

// Where the answer library answers (Phase 35): three switches in firms.settings.answers, each off
// unless it's `true` (an admin sets them on Settings → Automatic answers, through
// app_set_firm_setting(); the owner can with `npm run firm:settings`). The owner's `auto_replies`
// stays the master switch for texts and emails (src/lib/inbound/limits.ts): with it off nothing
// goes by text or email, whatever these say. Pure.

export const ANSWER_CHANNELS = ["app", "texts", "email"] as const;
export type AnswerChannel = (typeof ANSWER_CHANNELS)[number];
export type AnswerSwitches = Record<AnswerChannel, boolean>;

// The setting keys, as app_set_firm_setting() and the owner's command take them.
export const ANSWER_SETTING_KEYS = {
  app: "answers.app",
  texts: "answers.texts",
  email: "answers.email",
} as const satisfies Record<AnswerChannel, string>;

const on = z.boolean();

export function answerSwitches(settings: Record<string, unknown>): AnswerSwitches {
  const inner =
    settings.answers && typeof settings.answers === "object" && !Array.isArray(settings.answers)
      ? (settings.answers as Record<string, unknown>)
      : {};
  const read = (key: AnswerChannel) => {
    const parsed = on.safeParse(inner[key]);
    return parsed.success ? parsed.data : false;
  };
  return { app: read("app"), texts: read("texts"), email: read("email") };
}

export const answersOn = (settings: Record<string, unknown>, channel: AnswerChannel): boolean =>
  answerSwitches(settings)[channel];

// Whether any of the three switches is on (Wave 1, w1-06): with all three off, Automatic answers
// shows a banner that the firm's answers don't go out yet.
export const anyAnswerChannelOn = (s: AnswerSwitches): boolean => ANSWER_CHANNELS.some((c) => s[c]);

// Whether an answer that's switched on can go out by any channel (w1-06): App on, or Texts or
// Emails on with the owner's auto_replies on. It mirrors recheckAnswer's rule
// (src/lib/answers/library.ts: `answersOn(channel) && (channel === "app" || autoRepliesOn)`); if
// that rule changes, this must change with it (tests/unit/answers.library.test.ts).
export const answersCanGo = (s: AnswerSwitches, autoReplies: boolean): boolean =>
  s.app || ((s.texts || s.email) && autoReplies);
