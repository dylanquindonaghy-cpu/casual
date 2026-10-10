import type { StatusTone } from "@/app/ui/status-chip";
import type { CloseReason, Outcome, ReplyPlan } from "./enquiry-rules";

// Enquiries in plain words (docs/office-v2.md 3.6; docs/screens.md `/office/enquiries`; 12D.1).
// No database code: the reply and close forms (client components) use it.

export const OUTCOME_WORDS: Record<Outcome, string> = {
  keyword: "Answered by keyword",
  ai: "Sorted by AI, answered from your data",
  person_waiting: "Passed to a person, waiting",
  person_answered: "Passed to a person, answered",
  not_understood: "Not understood",
  pay: "Pay (always a person)",
  in_app: "Done in the app",
};

export const OUTCOME_TONES: Record<Outcome, StatusTone> = {
  keyword: "done",
  ai: "done",
  person_waiting: "attention",
  person_answered: "done",
  not_understood: "attention",
  pay: "quiet",
  in_app: "done",
};

export const PAY_LOCK = "Pay: never answered by AI (rule)";

export const AI_BANNER =
  "AI sorting isn't connected yet: messages without a keyword go to a person.";

export const VIEW_LABELS = {
  all: "All",
  person: "Need a person",
  app: "Requests from the app",
  pay: "Pay",
} as const;

export const CHANNEL_WORDS: Record<"whatsapp" | "sms" | "voice", string> = {
  whatsapp: "WhatsApp",
  sms: "Text",
  voice: "Voicemail",
};

export const CLOSE_REASON_WORDS: Record<CloseReason, string> = {
  by_phone: "Dealt with by phone",
  not_for_us: "Not for us",
  duplicate: "Duplicate",
  spam: "Spam",
  other: "Other",
};

type WhoLike =
  | { kind: "casual"; name: string; active: boolean }
  | { kind: "unknown"; from: string }
  | { kind: "withheld" };

// The list's name: the casual's, or "Unknown number" / "Withheld".
export function whoName(who: WhoLike): string {
  if (who.kind === "casual") return who.name;
  return who.kind === "unknown" ? "Unknown number" : "Withheld";
}

// "3 h 35 min", "12 min", "under a minute", "2 days".
export function ageWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days`;
}

// "18 enquiries today · 2 need a person, the oldest 3 h 35 min ago"
export function countsLine(
  today: number,
  needPerson: { count: number; oldestAt: Date | null },
  now: Date,
): string {
  const first = `${today} ${today === 1 ? "enquiry" : "enquiries"} today`;
  if (needPerson.count === 0) return `${first} · none need a person`;
  const oldest = needPerson.oldestAt
    ? `, the oldest ${ageWords(now.getTime() - needPerson.oldestAt.getTime())} ago`
    : "";
  return `${first} · ${needPerson.count} need${needPerson.count === 1 ? "s" : ""} a person${oldest}`;
}

// How the office's reply will go, in one line, before it's sent.
export function planLine(plan: ReplyPlan): string {
  if (!plan.ok) {
    return {
      no_line: "Your firm has no shifts line yet, so a reply can't go. Close it with a reason.",
      withheld: "The number was withheld, so a reply can't go. Close it with a reason.",
      unknown_caller:
        "We don't message callers we don't know. Phone them back if you need to, then close it.",
      texts_off: "They replied STOP to texts, so a reply can't go. Phone them, then close it.",
    }[plan.why];
  }
  if (plan.channel === "sms") return "By text: your words go as they are.";
  return plan.form === "free_text"
    ? "Inside WhatsApp's 24-hour window: your words go as they are."
    : 'Outside WhatsApp\'s 24-hour window: it goes as the request update template ("Your request (question, ref …) is answered. The office says: …").';
}

export type ReplyOutcome =
  | { status: "queued"; channel: "whatsapp" | "sms"; form: "free_text" | "template" }
  | {
      status: "empty" | "too_long" | "no_line" | "withheld" | "unknown_caller" | "texts_off";
    }
  | { status: "not_waiting" }
  | { status: "not_found" | "not_allowed" | "logged_out" | "error" };

export function replyResultText(r: ReplyOutcome): string {
  switch (r.status) {
    case "queued":
      return `Your reply is on its way: it goes ${r.channel === "sms" ? "by text" : "on WhatsApp"} in a moment.`;
    case "empty":
      return "Write a reply first.";
    case "too_long":
      return "The reply is too long (500 characters at most).";
    case "no_line":
      return "Your firm has no shifts line yet, so a reply can't go.";
    case "withheld":
      return "The number was withheld, so a reply can't go.";
    case "unknown_caller":
      return "We don't message callers we don't know. Phone them back instead.";
    case "texts_off":
      return "They replied STOP to texts, so a reply can't go.";
    case "not_waiting":
      return "Someone has already answered or closed this.";
    case "not_found":
      return "We can't find that message.";
    case "not_allowed":
      return "You can't answer enquiries.";
    case "logged_out":
      return "Your session has ended. Log in again.";
    default:
      return "Something went wrong. Try again.";
  }
}

export type CloseOutcome =
  | { status: "closed" }
  | { status: "not_waiting" | "not_found" | "not_allowed" | "invalid" | "logged_out" | "error" };

export function closeResultText(r: CloseOutcome): string {
  switch (r.status) {
    case "closed":
      return "Closed. No reply was sent.";
    case "not_waiting":
      return "Someone has already answered or closed this.";
    case "invalid":
      return "Choose a reason.";
    case "not_found":
      return "We can't find that message.";
    case "not_allowed":
      return "You can't answer enquiries.";
    case "logged_out":
      return "Your session has ended. Log in again.";
    default:
      return "Something went wrong. Try again.";
  }
}

// "How it was answered" (docs/office-v2.md 3.6), one sentence per step, from logged facts only.
// The types are the loader's (src/lib/office/enquiries.ts); `at` is shown with the firm's time.
type At = (d: Date) => string;
type WhoFull =
  | { kind: "casual"; name: string; active: boolean }
  | { kind: "unknown"; from: string }
  | { kind: "withheld" };
type Intent = "shifts" | "cancel" | "pay" | "office";

export function receivedStep(
  r: { channel: "whatsapp" | "sms" | "voice"; at: Date; who: WhoFull },
  at: At,
): string {
  const from =
    r.who.kind === "casual"
      ? `from ${r.who.name}'s number${r.who.active ? "" : " (not active)"}`
      : r.who.kind === "unknown"
        ? `from ${r.who.from}, a number that isn't one of your casuals'`
        : "from a withheld number";
  return `${CHANNEL_WORDS[r.channel]} at ${at(r.at)}, ${from}.`;
}

export function sortedStep(
  s:
    | { how: "keyword" | "ai"; intent: Intent }
    | { how: "person"; why: "asked" | "ai_asked" | "voicemail" | "no_text" | "not_sorted" }
    | { how: "unknown"; repeat: boolean }
    | { how: "opt_out" }
    | { how: "not_yet" },
): string {
  switch (s.how) {
    case "keyword":
      return `A keyword matched: "${s.intent}".`;
    case "ai":
      return `AI sorted it as "${s.intent}".`;
    case "unknown":
      return s.repeat
        ? "Not one of your casuals' numbers: passed to a person. It wrote in the last 24 hours too, so it got no second reply."
        : "Not one of your casuals' numbers: passed to a person.";
    case "opt_out":
      return "STOP or START on a text: texts turned off or back on.";
    case "not_yet":
      return "Not sorted yet: the shifts line hasn't answered it.";
    default:
      return {
        asked: "They asked for a person (a keyword): passed to a person.",
        ai_asked: 'AI sorted it as "office": passed to a person.',
        voicemail: "A voicemail: always passed to a person.",
        no_text: "No text (a photo or file): passed to a person.",
        not_sorted: "No keyword matched and AI didn't sort it: passed to a person.",
      }[s.why];
  }
}

export const NO_CHECKS = "No checks recorded.";

export function replyStep(
  r: { how: "automatic"; intent: Intent | "unknown_number" | "voicemail" } | { how: "none" },
): string {
  if (r.how === "none") return "No automatic reply.";
  return {
    shifts: 'The "open shifts" reply, with the link to Open shifts.',
    cancel: "The cancel reply, with the link to My shifts.",
    pay: "The pay reply: the link to their pay page, never an answer about pay.",
    office: 'The "the office will get back to you" reply, with the question\'s reference.',
    voicemail: "The voicemail reply, with the question's reference.",
    unknown_number: "The reply asking a number we don't know for their full name.",
  }[r.intent];
}

export function sentStep(
  s:
    | { how: "sent"; channel: "whatsapp" | "sms"; at: Date; fellBackFrom: string | null }
    | { how: "failed"; channel: string; code: string; at: Date }
    | { how: "none" },
  at: At,
): string {
  if (s.how === "none") return "Nothing sent.";
  if (s.how === "failed") return `Not sent (${s.code}) at ${at(s.at)}.`;
  if (s.fellBackFrom === "whatsapp") {
    return `Sent by text at ${at(s.at)} after WhatsApp didn't take it.`;
  }
  return `Sent ${s.channel === "sms" ? "by text" : "on WhatsApp"} at ${at(s.at)}.`;
}

type ThenLike =
  | {
      kind: "office_reply";
      by: string | null;
      at: Date;
      channel: "whatsapp" | "sms";
      form: "free_text" | "template";
      state: "sending" | "sent" | "failed" | "unconfirmed";
      code: string | null;
      fellBackFrom: string | null;
    }
  | { kind: "closed"; by: string | null; at: Date; reason: CloseReason }
  | {
      kind: "request";
      by: string | null;
      at: Date;
      status: "approved" | "declined" | "auto_resolved";
    }
  | {
      kind: "in_app";
      action: "booked" | "cancelled";
      at: Date;
      shift: { role: string; site: string | null; startsAt: Date } | null;
    };

export function thenStep(
  t: ThenLike,
  at: At,
  ctx: {
    firstName: string | null;
    shiftWords: (s: { role: string; site: string | null; startsAt: Date }) => string;
  },
): string {
  const who = (by: string | null) => by ?? "Someone in the office";
  switch (t.kind) {
    case "office_reply": {
      const how =
        t.form === "template"
          ? "as the request update template"
          : t.channel === "sms"
            ? "by text, in their own words"
            : "on WhatsApp, in their own words";
      const state =
        t.state === "sent"
          ? t.fellBackFrom === "whatsapp"
            ? "sent by text (WhatsApp didn't take it)"
            : "sent"
          : t.state === "sending"
            ? "sending"
            : t.state === "unconfirmed"
              ? "not confirmed: it may not have gone, so check with them"
              : `not sent (${t.code ?? "unknown"}): it's back in Need a person`;
      return `${who(t.by)} replied at ${at(t.at)} (${how}): ${state}.`;
    }
    case "closed":
      return `${who(t.by)} closed it at ${at(t.at)} without a reply: ${CLOSE_REASON_WORDS[t.reason].toLowerCase()}.`;
    case "request":
      return t.status === "auto_resolved"
        ? `Sorted at ${at(t.at)}.`
        : `${t.status === "approved" ? "Answered" : "Declined"} by ${who(t.by)} at ${at(t.at)}.`;
    case "in_app": {
      const name = ctx.firstName ?? "They";
      const shift = t.shift ? `: ${ctx.shiftWords(t.shift)}` : "";
      return t.action === "booked"
        ? `${name} took a shift in the app at ${at(t.at)}${shift}.`
        : `${name} cancelled a shift in the app at ${at(t.at)}${shift}.`;
    }
  }
}
