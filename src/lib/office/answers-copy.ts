import { FILL_INS, isFillInKey, tokensIn } from "../answers/fill-ins";
import { ANSWER_EXAMPLE_MAX } from "../answers/limits";
import type { AnswerChannel } from "../answers/switches";
import { timeOnDay } from "../portal/format";
import { cutChars } from "../text/cut";

// Settings → Automatic answers in plain words (Phase 35.3; docs/screens.md "## Phase 35", "The
// office's page"): the page, its switches, Add and Edit, and the answers' lines on Enquiries. Pure
// and browser-safe (the switches and the form use it).

export const ANSWERS_TITLE = "Automatic answers";
export const ANSWERS_INTRO =
  "What the shifts line may answer by itself. The AI only picks one of these, or none; it never writes its own words.";

// Settings' link to the page.
export const ANSWERS_SETTINGS_LINE =
  "Your own answers to the questions casuals ask most, sent straight away by app, text or email. Anything else goes to a person.";

// The three switches (the mock-up's words).
export const CHANNELS_TITLE = "Answer casuals automatically";
export const CHANNELS_INTRO =
  "Only with the answers below that are switched on. Anything else goes to Enquiries for a person.";
export const CHANNEL_LABELS: Record<AnswerChannel, string> = {
  app: "App messages",
  texts: "Texts to the shifts line",
  email: "Emails to the staffing inbox",
};
// The owner's `auto_replies` is off: nothing goes by text or email, whatever these say (P4.7).
export const MASTER_OFF =
  "Nothing goes by text or email until the shifts line's automatic replies are on. That's set on the server.";

// "41 answered in the last 7 days" beside a switch (answers from the library only).
export function channelUsesText(on: boolean, n: number): string {
  if (!on) return "Off";
  return n === 0 ? "None answered in the last 7 days" : `${n} answered in the last 7 days`;
}

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };
const COMMON: Record<Common["status"], string> = {
  logged_out: "Your session has ended. Log in again.",
  not_allowed: "Only admins can change automatic answers.",
  error: "Something went wrong. Nothing changed. Try again.",
};

export type ChannelSwitchResult =
  | { status: "saved"; on: boolean }
  | { status: "unchanged"; on: boolean }
  | { status: "invalid" }
  | Common;

// The answer under a channel's switch.
export function channelSwitchResultText(channel: AnswerChannel, r: ChannelSwitchResult): string {
  switch (r.status) {
    case "saved":
    case "unchanged":
      return r.on
        ? `${CHANNEL_LABELS[channel]}: answered automatically now, with the answers that are on.`
        : `${CHANNEL_LABELS[channel]}: switched off. They go to a person.`;
    case "invalid":
      return COMMON.error;
    default:
      return COMMON[r.status];
  }
}

export type AnswerSwitchResult =
  | { status: "switched"; on: boolean }
  | { status: "unchanged"; on: boolean }
  | { status: "not_found" }
  | Common;

// The answer under an answer's own switch.
export function answerSwitchResultText(name: string, r: AnswerSwitchResult): string {
  switch (r.status) {
    case "switched":
    case "unchanged":
      return r.on
        ? `“${name}” is on: it answers casuals now.`
        : `“${name}” is off: those questions go to a person.`;
    case "not_found":
      return "That answer isn't there any more. Reload the page.";
    default:
      return COMMON[r.status];
  }
}

// "Used 23 times in the last 7 days"
export function usesText(n: number): string {
  if (n === 0) return "Not used in the last 7 days";
  return n === 1 ? "Used once in the last 7 days" : `Used ${n} times in the last 7 days`;
}

// "Edited by Sam Rota, 09:41 on Mon 2 Nov"; a starter nobody has changed: said so.
export function lastEditedText(
  a: { updatedByName: string | null; updatedAt: Date; starterKey: string | null },
  timeZone: string,
): string {
  if (a.updatedByName === null) {
    return a.starterKey ? "One of the starter answers, not changed yet" : "Not changed yet";
  }
  return `Edited by ${a.updatedByName}, ${timeOnDay(a.updatedAt, timeZone)}`;
}

// The built-in answers (src/lib/inbound/keywords.ts; docs/messaging-templates.md "Instant replies
// on the shifts line"): fixed words, no switch.
export const BUILT_IN = [
  {
    key: "shifts",
    name: "Their shifts",
    asks: "shifts, work, available",
    does: "The shifts open to them that they can do, with a link to book.",
  },
  {
    key: "cancel",
    name: "Cancel a shift",
    asks: "cancel, cancelling",
    does: "The link to their shifts, where they cancel and see the notice it gives.",
  },
  {
    key: "pay",
    name: "Pay",
    asks: "pay, paid, wages, payslip",
    does: "Their pay page, and how to raise a pay query to payroll. Never an answer about pay going wrong.",
  },
] as const;
export const BUILT_IN_SIDE = "Always the same words";

export const YOURS_EMPTY = "No answers yet. Add one, then switch it on.";

// "No answer yet" (the latest questions that went to a person).
export const UNANSWERED_TITLE = "No answer yet";
export const UNANSWERED_INTRO =
  "The latest questions from casuals that went to a person in the last 30 days. Make one an answer, so the next is answered straight away.";
export const UNANSWERED_EMPTY = "No questions went to a person in the last 30 days.";

// The answer's words, split for showing fill-ins as chips: plain text and fill-ins in order (a
// {word} that isn't a fill-in stays as text).
export type WordPart = { text: string } | { fillIn: string };
export function wordParts(body: string): WordPart[] {
  const parts: WordPart[] = [];
  let rest = body;
  for (const token of tokensIn(body)) {
    const at = rest.indexOf(`{${token}}`);
    if (at < 0) continue;
    if (at > 0) parts.push({ text: rest.slice(0, at) });
    const known = isFillInKey(token) ? FILL_INS.find((f) => f.key === token) : undefined;
    parts.push(known ? { fillIn: known.label } : { text: `{${token}}` });
    rest = rest.slice(at + token.length + 2);
  }
  if (rest) parts.push({ text: rest });
  return parts;
}

// The fill-ins' labels for keys (an unknown one: said so).
export const fillInLabels = (keys: readonly string[]): string[] =>
  keys.map((k) =>
    isFillInKey(k) ? (FILL_INS.find((f) => f.key === k)?.label ?? k) : "a fill-in not on the list",
  );

// "Make this an answer": the casual's question as the first example (one line, cut at a word
// before ANSWER_EXAMPLE_MAX characters). Their words otherwise as they wrote them.
export function exampleFromQuestion(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if ([...line].length <= ANSWER_EXAMPLE_MAX) return line;
  const cut = cutChars(line, ANSWER_EXAMPLE_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut).trim();
}

// Add and Edit (the mock-up's words).
export const FORM = {
  name: "Name",
  nameHint: "A short name, for you and the office.",
  examples: "Ways casuals ask it",
  examplesHint:
    "One per line. When a message has one of these in it, this answer goes. A few help the match.",
  body: "The answer",
  bodyHint:
    "Exactly what goes to the casual, marked as an automatic reply and signed by your team.",
  fillIns: "Add a fill-in (from your data):",
  preview: "A casual would get (example):",
  previewEmpty: "Write the answer to see it here.",
  saveOn: "Save and switch on",
  saveOff: "Save, keep off",
  saveKeepOn: "Save, keep on",
  saveSwitchOff: "Save and switch off",
} as const;

export type SaveResult =
  | { status: "saved"; id: string; switchedOn: boolean }
  | { status: "unchanged"; id: string }
  | { status: "invalid"; errors: Partial<Record<"name" | "examples" | "body", string>> }
  | { status: "not_found" }
  | Common;

// What the form says when it stays on the page (a save goes on to the list, which confirms it).
export function saveResultText(r: Exclude<SaveResult, { status: "saved" }>): string {
  switch (r.status) {
    case "unchanged":
      return "Nothing changed.";
    case "invalid":
      return "Check the answer: see the notes above.";
    case "not_found":
      return "That answer isn't there any more.";
    default:
      return COMMON[r.status];
  }
}

// On the list after a save ("?saved={id}").
export function savedText(name: string, on: boolean): string {
  return on
    ? `Saved “${name}”. It's on: it answers casuals now.`
    : `Saved “${name}”. It's off: nothing goes until you switch it on.`;
}
