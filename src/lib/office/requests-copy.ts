import { KIND_NAMES } from "../portal/request-kinds";
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
  if (r.type === "review") {
    lines.push("Asks the office to look again at a shift the rules refused. The rules said:");
    lines.push(...r.asked.reasons.map((reason) => `• ${reason}`));
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
export function approveHint(type: string): string | null {
  if (type === "time_change" || type === "swap") {
    return "Approving doesn't change the shift. Make the change on the shift's page.";
  }
  if (type === "review") return "Approving doesn't book them. Assign them on the shift's page.";
  return null;
}

export function answerResultText(result: ResolveRequestResult | Common, firstName: string): string {
  switch (result.status) {
    case "resolved":
      return result.decision === "approved"
        ? `Approved. ${firstName} will be told.`
        : `Declined. ${firstName} will be told.`;
    case "already":
      return result.current === "auto_resolved"
        ? "This request was already sorted."
        : "This request was already answered.";
    case "note_needed":
      return "Add a note saying why.";
    case "note_too_long":
      return "The note is too long (500 characters at most).";
    case "not_found":
      return "We can't find that request.";
    default:
      return COMMON[result.status];
  }
}

// "Approved by Sam Rota" / "Declined by Sam Rota" / "Sorted".
export function answeredBy(r: QueueRequest): string {
  if (r.status === "auto_resolved") return "Sorted";
  const verb = r.status === "approved" ? "Approved" : "Declined";
  return r.answer?.by ? `${verb} by ${r.answer.by}` : verb;
}

// Whether the worker has been told of the answer.
export function toldText(r: QueueRequest): string | null {
  if (r.status === "auto_resolved" || !r.answer) return null;
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
