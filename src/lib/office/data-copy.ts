import type { EraseWorkerResult } from "../gdpr/worker-erase";

// The office's data requests page (docs/screens.md `/office/data`): what a deletion says it did.
// Plain words, and every action ends with a confirmation (golden rule 11).

export type EraseActionResult =
  EraseWorkerResult | { status: "logged_out" } | { status: "error" } | { status: "unconfirmed" };

// "1 shift that hasn't ended" / "2 shifts that haven't ended".
export const upcomingShifts = (n: number) =>
  n === 1 ? "1 shift that hasn't ended" : `${n} shifts that haven't ended`;

export function eraseResultText(result: EraseActionResult): string {
  switch (result.status) {
    case "erased":
      return `Deleted. ${result.name}'s personal details are gone. Their shift history stays, without a name.`;
    case "booked":
      return `${result.name} is booked on ${upcomingShifts(result.upcoming)}. Cancel those first, then delete.`;
    case "already":
      return "Already deleted. Their shift history stays, without a name.";
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
