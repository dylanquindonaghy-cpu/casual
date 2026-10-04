import type { EraseWorkerResult } from "../gdpr/worker-erase";

// The office's data requests page (docs/screens.md `/office/data`): what a deletion says it did.
// Plain words, and every action ends with a confirmation (golden rule 11).

export type EraseActionResult =
  EraseWorkerResult | { status: "logged_out" } | { status: "error" } | { status: "unconfirmed" };

// What a deletion leaves of other people's words (audit L86, L87): only the worker's own records
// are cleared. A colleague's request, pay query, cancellation or message that names them isn't
// changed: some of it goes on the firm's retention schedule, the rest stays as the firm's records.
export const OTHERS_WORDS =
  "Words other people wrote that name them, like a colleague's swap request or pay query, aren't changed.";

// What deleting removes and keeps, before the admin confirms (docs/screens.md
// `/office/data/workers/[id]`): exactly what src/lib/gdpr/worker-erase.ts does.
export function eraseExplainer(name: string, firmName: string): string[] {
  return [
    `This deletes ${name}'s name, mobile number, email, staff ID, licences and cards, days off, sites they're kept off, messages, logins and phone notifications, the notes on their own requests, pay questions and cancellations, and the office's typed reasons on their bookings.`,
    `Their shifts, offers, cancellations and pay lines stay, without a name, as ${firmName}'s records (the notice report needs them).`,
    OTHERS_WORDS,
  ];
}

// "How long we keep things" on the Data requests page, from the firm's own retention settings
// (src/lib/gdpr/retention-settings.ts; set by us, the owner).
export function keepTimeLines(
  r: { messageDays: number; requestNoteDays: number; holdUntil: string | null },
  holdUntilWords: string | null, // the hold's date as the page shows it
): string[] {
  return [
    `Messages to and from your shifts line: ${r.messageDays} days.`,
    `What a worker typed into a request (a note, a colleague's name): ${r.requestNoteDays} days after the request is closed. An open request keeps it.`,
    `The office's typed reason for placing someone despite a rule: ${r.requestNoteDays} days after they were booked.`,
    ...(r.holdUntil && holdUntilWords
      ? [`A hold is on until ${holdUntilWords}: nothing above is deleted until then.`]
      : []),
    "Login links and codes: 7 days after they run out.",
    "Logins: 30 days after they end.",
    "Workers and their licences and cards: until you delete them here.",
    "Shifts, bookings, offers, requests, pay records and the action log: kept as your records (deleted workers' without a name).",
    "To change how long, or to hold everything for a dispute, ask us.",
  ];
}

// "1 shift that hasn't ended" / "2 shifts that haven't ended".
export const upcomingShifts = (n: number) =>
  n === 1 ? "1 shift that hasn't ended" : `${n} shifts that haven't ended`;

export function eraseResultText(result: EraseActionResult): string {
  switch (result.status) {
    case "erased":
      return `Deleted. ${result.name}'s personal details are gone. Their shift history stays, without a name. ${OTHERS_WORDS}`;
    case "booked":
      return `${result.name} is booked on ${upcomingShifts(result.upcoming)}. Cancel those first, then delete.`;
    case "already":
      return `Already deleted. Their shift history stays, without a name. ${OTHERS_WORDS}`;
    case "unconfirmed":
      return "Tick the box to say you understand this can't be undone.";
    case "not_found":
      return "We couldn't find that worker. Search again.";
    case "not_allowed":
      return "Only an admin can delete a worker's details.";
    case "logged_out":
      return "Log in again, then try again.";
    case "error":
      // The browser's request may have failed after the server finished, so it doesn't say which.
      return "Something went wrong. Reload the page to see if it was deleted.";
  }
}
