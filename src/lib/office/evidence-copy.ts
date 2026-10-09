// What "Resend evidence" on a cancellation's record says (12C.4). Its own file: the button is a
// client component, and the record's other words import server code.
export type ResendEvidenceOutcome =
  | { status: "queued" | "not_failed" | "not_found" | "not_allowed" }
  | { status: "logged_out" | "error" };
export function resendEvidenceText(result: ResendEvidenceOutcome): string {
  switch (result.status) {
    case "queued":
      return "Sending it again. This record shows when it has gone.";
    case "not_failed":
      return "Nothing to resend: it has been sent, is being sent, or is waiting for a confirmed strikes team email.";
    case "not_found":
      return "That strike wasn't found.";
    case "not_allowed":
      return "Only admins and resourcers can resend evidence.";
    case "logged_out":
      return "Log in again, then try once more.";
    case "error":
      return "Something went wrong. Try again.";
  }
}
