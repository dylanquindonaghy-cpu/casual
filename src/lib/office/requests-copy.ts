import { KIND_NAMES, statusWord } from "../portal/request-kinds";
import type { ResolveRequestResult } from "../requests/resolve";
import type { QueueRequest } from "./request-queue";

// The office's requests page in plain words (docs/screens.md `/office/requests`).

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };
const COMMON: Record<Common["status"], string> = {
  logged_out: "Your session has ended. Log in again.",
  not_allowed: "You can't answer requests.",
  error: "Something went wrong. Try again.",
};

export const kindName = (type: string) => KIND_NAMES[type] ?? "Request";

// What they asked, beyond the kind: "Asks for 13:00 to 18:30." / "Could swap with: Sam Jones."
export function askedLines(r: QueueRequest): string[] {
  const lines: string[] = [];
  if (r.type === "time_change" && r.asked.start && r.asked.end) {
    lines.push(`Asks for ${r.asked.start} to ${r.asked.end}.`);
  }
  if (r.type === "swap") {
    lines.push(
      r.asked.swapWith ? `Could swap with: ${r.asked.swapWith}.` : "Asks to swap (no one named).",
    );
  }
  if (r.type === "review" && r.asked.cancellation) {
    lines.push(
      `Tells the office what happened when they cancelled (reference ${r.asked.cancellation}).`,
    );
  } else if (r.type === "review") {
    lines.push("Asks the office to look again at a shift the rules refused. The rules said:");
    lines.push(...r.asked.reasons.map((reason) => `• ${reason}`));
  }
  // "Think this mark is wrong?" (Phase 28.9): the mark she disputes, then what she says.
  if (r.type === "attendance" && r.asked.said === "worked") {
    lines.push("Says the mark is wrong: marked not attended (they say they worked).");
  } else if (r.type === "attendance" && r.asked.said === "not_worked") {
    lines.push("Says the mark is wrong: marked worked (they say they didn't work).");
  }
  if (r.asked.note) lines.push(`Their note: ${r.asked.note}`);
  // A caller's number can be faked (a WhatsApp's can't, easily): the office should know.
  if (r.asked.voicemail) {
    lines.push(
      "From a voicemail on the shifts line. A caller's number can be faked: check anything unusual with them.",
    );
  }
  return lines;
}

// What approving does (and doesn't) do.
export function approveHint(type: string, cancellation: string | null = null): string | null {
  if (type === "time_change" || type === "swap") {
    return "Approving doesn't change the shift. Make the change on the shift's page.";
  }
  if (type === "review" && cancellation) return "Answering doesn't change a strike.";
  if (type === "review") return "Approving doesn't book them. Assign them on the shift's page.";
  if (type === "attendance")
    return "Answering doesn't change the mark. If it's wrong, mark again first.";
  return null;
}

// A question's "approve" is answering it (PLAN.md Messages 13), and so is an attendance question's
// (Phase 28.9: "Answered", never "Approved" beside a mark); every other kind's is approving.
export const approveWord = (type: string) =>
  type === "general" || type === "attendance" ? "Answer" : "Approve";

// Whether the office's page offers "Decline" (Phase 28.9): an attendance question is only answered,
// with an optional note, so she never sees "Declined" beside a mark.
export const canDecline = (type: string) => type !== "attendance";

// An attendance question's session as it's marked now (Phase 28.9): "Marked now: Worked." It may
// have been marked again since she asked. Null for any other kind.
export function markedNowText(r: QueueRequest): string | null {
  if (r.type !== "attendance") return null;
  if (r.mark === "completed") return "Marked now: Worked.";
  if (r.mark === "no_show") return "Marked now: Didn't attend.";
  return "Not marked now.";
}

// "Mark again" (Phase 28.9): the session's Booked tab, where who worked is marked (as the event
// page's sessions and Updates' "Mark who worked" link there). Null without a session.
export function markAgainHref(r: QueueRequest): string | null {
  return r.type === "attendance" && r.shift
    ? `/office/shifts/${r.shift.shiftId}?show=booked#places`
    : null;
}

export function answerResultText(
  result: ResolveRequestResult | Common,
  firstName: string,
  type = "",
): string {
  switch (result.status) {
    case "resolved":
      return result.decision === "approved"
        ? `${statusWord(type, "approved")}. ${firstName} will be told.`
        : `Declined. ${firstName} will be told.`;
    case "already":
      return result.current === "auto_resolved"
        ? "This request was already sorted."
        : result.current === "withdrawn"
          ? "They took this request back."
          : "This request was already answered.";
    case "note_needed":
      return "Add a note saying why.";
    case "answer_only":
      return "This question can only be answered, not declined.";
    case "note_too_long":
      return "The note is too long (500 characters at most).";
    case "not_found":
      return "We can't find that request.";
    case "on_enquiries":
      return "Answer this question on Enquiries, with the message it came from.";
    default:
      return COMMON[result.status];
  }
}

// The answer's word, for its chip: "Approved", "Answered" (a question or an attendance question),
// "Declined", "Sorted", or "Taken back" (Phase 28.9: she took it back).
export function outcomeWord(r: QueueRequest): string {
  return r.status === "auto_resolved" ? "Sorted" : statusWord(r.type, r.status);
}

// "Approved by Sam Rota" / "Answered by Sam Rota" (a question) / "Declined by Sam Rota" / "Sorted" /
// "Taken back by Ann" (Phase 28.9: the casual herself). Starts with outcomeWord().
export function answeredBy(r: QueueRequest): string {
  const word = outcomeWord(r);
  if (r.status === "auto_resolved") return word;
  if (r.status === "withdrawn") return `${word} by ${r.worker.firstName}`;
  return r.answer?.by ? `${word} by ${r.answer.by}` : word;
}

// Whether the worker has been told of the answer (nothing to tell for one she took back).
export function toldText(r: QueueRequest): string | null {
  if (r.status === "auto_resolved" || r.status === "withdrawn" || !r.answer) return null;
  const name = r.worker.firstName;
  switch (r.answer.told) {
    case "sent":
      return `${name} was told.`;
    case "held":
      return `Telling ${name} waits for quiet hours to end.`;
    case "failed":
      return `Telling ${name} failed. Phone them.`;
    case "sending":
      return `Telling ${name}.`;
    default:
      return `${name} will be told.`;
  }
}
