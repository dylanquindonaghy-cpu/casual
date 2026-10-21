// What "Withdraw strike…" and "Keep strike" on a cancellation's record say (12C.5). Its own file:
// the buttons are a client component.

export const WITHDRAW_REASON_MAX = 500;

export type WithdrawOutcome =
  | { status: "withdrawn" | "invalid" | "not_live" | "erased" | "not_found" | "not_allowed" }
  | { status: "logged_out" | "error" };
export type KeepOutcome =
  | { status: "kept" | "already_kept" | "not_live" | "not_found" | "not_allowed" }
  | { status: "logged_out" | "error" };

// Which of a strike's buttons its cancellation record shows (19.1): "Withdraw strike…" while it's
// live and the casual's details aren't deleted, "Keep strike" while it's live and nobody has
// reviewed it. The record renders the buttons for whoever may change strikes either way (they show
// nothing without a button or an answer), so an answer outlives the refresh that takes its button
// away.
export function strikeButtons(
  strike: { status: "live" | "withdrawn"; reviewed?: { by: string | null; at: Date } | null },
  erased: boolean,
): { canWithdraw: boolean; canKeep: boolean } {
  const live = strike.status === "live";
  return { canWithdraw: live && !erased, canKeep: live && !strike.reviewed };
}

export function withdrawText(result: WithdrawOutcome): string {
  switch (result.status) {
    case "withdrawn":
      return "Withdrawn. It no longer counts, and the casual sees it as withdrawn.";
    case "invalid":
      return `Write why you're withdrawing it (${WITHDRAW_REASON_MAX} characters at most).`;
    case "not_live":
      return "This strike has already been withdrawn.";
    case "erased":
      return "This casual's details were deleted, so their strikes can't be withdrawn.";
    case "not_found":
      return "That strike wasn't found.";
    case "not_allowed":
      return "Only admins and resourcers can withdraw a strike.";
    case "logged_out":
      return "Log in again, then try once more.";
    case "error":
      return "Something went wrong. Reload the page to see if it was withdrawn.";
  }
}

export function keepText(result: KeepOutcome): string {
  switch (result.status) {
    case "kept":
      return "Kept, and marked as reviewed.";
    case "already_kept":
      return "This strike has already been reviewed.";
    case "not_live":
      return "This strike has been withdrawn.";
    case "not_found":
      return "That strike wasn't found.";
    case "not_allowed":
      return "Only admins and resourcers can keep a strike.";
    case "logged_out":
      return "Log in again, then try once more.";
    case "error":
      return "Something went wrong. Reload the page to see if it was kept.";
  }
}
