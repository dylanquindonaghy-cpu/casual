import { ROLE_LABELS } from "../auth/roles";
import type { OfficeAccessResult } from "./team";

// The office team page in plain words (docs/screens.md `/office/team`).

// "unknown": the browser's request failed, and the server may have finished the change.
export type TeamActionResult =
  OfficeAccessResult | { status: "logged_out" } | { status: "error" } | { status: "unknown" };

export function teamResultText(result: TeamActionResult): string {
  switch (result.status) {
    case "done":
      switch (result.change) {
        case "disable":
          return `${result.name}'s access is off. They've been logged out everywhere and can't log in until it's turned back on.`;
        case "enable":
          return `${result.name} can log in again. They'll need a new login link.`;
        case "role":
          return `${result.name} is now ${ROLE_LABELS[result.role]}. This applies from their next page.`;
        case "sign_out":
          return `${result.name} has been logged out on every device. They can log in again with a new link.`;
      }
    case "unchanged":
      switch (result.change) {
        case "disable":
          return `${result.name}'s access is already off.`;
        case "enable":
          return `${result.name} can already log in.`;
        case "role":
          return `${result.name} is already ${ROLE_LABELS[result.role]}.`;
        case "sign_out":
          return `${result.name} wasn't logged in anywhere.`;
      }
    case "last_admin":
      return `${result.name} is the only admin. Make someone else an admin first.`;
    case "self":
      return "You can't change your own access. Ask another admin.";
    case "not_found":
      return "That person isn't on your office team.";
    case "not_allowed":
      return "Only admins can change the office team.";
    case "logged_out":
      return "Your session has ended. Log in again.";
    case "error":
      return "Something went wrong. Nothing was changed. Try again.";
    case "unknown":
      return "Something went wrong. Reload the page to see if it changed.";
  }
}
