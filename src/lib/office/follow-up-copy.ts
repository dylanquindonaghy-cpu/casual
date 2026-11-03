// Casuals' follow-up words (Phase 26.7, cas-4): Remind, notes and "Mark as sorted". Pure, with no
// imports, so the page's buttons (client components) can use them.

// "Remind all 5 with a licence to renew" (the launch review's O6: Remind is for licences, so "all"
// isn't everyone on Need updating).
export const remindAllButton = (n: number) => `Remind all ${n} with a licence to renew`;
export const REMIND = "Remind";
export const REMINDED = "Reminded";
export const REMIND_LINE =
  "Remind is for licences. It sends the licence message again with its upload link: by text, or by email if they chose it or texts can't reach them. Each one is logged. They can't take shifts that need it until the new one is checked. Staff photos are asked for in the app.";

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };
const COMMON: Record<Common["status"], string> = {
  logged_out: "You've been logged out. Log in again.",
  not_allowed: "Only an admin or resourcer can do this.",
  error: "That didn't work. Try again.",
};

export function remindResultText(
  r:
    | { status: "done"; reminded: number; recent: number; nothing: number; sorted: number }
    | Common
    | { status: "invalid" },
): string {
  if (r.status === "invalid") return "Choose someone to remind.";
  if (r.status !== "done") return COMMON[r.status];
  const parts: string[] = [];
  if (r.reminded > 0) {
    // On its way (at night, it waits for the morning).
    parts.push(
      r.reminded === 1
        ? "Reminder on its way. It's in the log."
        : `${r.reminded} reminders on their way.`,
    );
  }
  if (r.sorted > 0) {
    parts.push(
      r.sorted === 1
        ? "One is marked as sorted, so left alone."
        : `${r.sorted} are marked as sorted, so left alone.`,
    );
  }
  if (r.recent > 0) {
    parts.push(
      r.recent === 1
        ? "One was reminded in the last 24 hours, so not again."
        : `${r.recent} were reminded in the last 24 hours, so not again.`,
    );
  }
  if (r.nothing > 0 && r.reminded === 0 && r.recent === 0 && r.sorted === 0) {
    parts.push("Nothing to remind them about: a licence out of date or expiring.");
  }
  return parts.join(" ") || "Nothing to send.";
}

export const ADD_NOTE = "Add a note";
export const MARK_SORTED = "Mark as sorted";
export const CALL = "Call";
// Under both note boxes: what a note is for, and what never goes in one (UK GDPR Article 9).
export const NOTE_HINT =
  "For the office only. Don't write health or other personal details, phone numbers or email addresses.";
export function noteResultText(r: { status: "added" | "invalid" | "not_found" } | Common): string {
  switch (r.status) {
    case "added":
      return "Note added.";
    case "invalid":
      return "Write a note of up to 500 characters, without phone numbers or email addresses.";
    case "not_found":
      return "We can't find that casual.";
    default:
      return COMMON[r.status];
  }
}
export function sortedResultText(
  r: { status: "sorted" | "nothing" | "not_found" } | Common,
): string {
  switch (r.status) {
    case "sorted":
      return "Marked as sorted. They move to the end of the list until something else changes.";
    case "nothing":
      return "Nothing needs updating now.";
    case "not_found":
      return "We can't find that casual.";
    default:
      return COMMON[r.status];
  }
}
