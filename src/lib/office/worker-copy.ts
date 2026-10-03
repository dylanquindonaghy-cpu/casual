import type { SignOutResult, SiteBlockResult, WorkerStatusResult } from "./worker-access";

// A worker's page in the office, in plain words (docs/screens.md `/office/workers/[id]`).

// Every answer can also be one of these. "unknown": the browser's request failed, and the server
// may have finished the change.
type Common =
  { status: "logged_out" } | { status: "error" } | { status: "unknown" } | { status: "no_reason" };

const COMMON: Record<
  Common["status"] | "not_found" | "not_allowed" | "erased" | "no_site",
  string
> = {
  logged_out: "Your session has ended. Log in again.",
  no_reason: "Choose a reason.",
  error: "Something went wrong. Nothing was changed. Try again.",
  unknown: "Something went wrong. Reload the page to see if it changed.",
  not_found: "That worker isn't on your books.",
  not_allowed: "You can't change workers' access.",
  erased: "This worker's details were deleted: there's nothing to change.",
  no_site: "That site isn't there any more.",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const onToday = (n: number, where = "") =>
  n > 0
    ? ` They're booked${where} on ${plural(n, "shift", "shifts")} ahead: ${n === 1 ? "it's" : "they're"} on Today to cancel or keep.`
    : "";

export const STATUS_WORDS: Record<"active" | "inactive" | "blocked", string> = {
  active: "Active",
  inactive: "Not active",
  blocked: "Blocked",
};

export function statusResultText(result: WorkerStatusResult | Common): string {
  if (result.status === "done") {
    switch (result.change) {
      case "deactivate":
        return `${result.name} is now inactive. They've been logged out, and can't log in or take shifts.${onToday(result.futureBookings)}`;
      case "reactivate":
        return `${result.name} is active again. They log in with a new link. If your rota sheet or a staff file you import says they're inactive, change it there too, or the next sync or import makes them inactive again.`;
      case "unblock":
        return result.now === "inactive"
          ? `${result.name} is unblocked, but still inactive: the office made them inactive. If they're back, use Make active again. If they're blocked in your rota sheet or a staff file you import, change it there too, or the next sync or import blocks them again.`
          : `${result.name} is unblocked and active again. If they're blocked in your rota sheet or a staff file you import, change it there too, or the next sync or import blocks them again.`;
    }
  }
  if (result.status === "unchanged") {
    if (result.current === "blocked") {
      return result.change === "deactivate"
        ? `${result.name} is blocked, so they can't take shifts already.`
        : `${result.name} is blocked: use Unblock instead.`;
    }
    if (result.change === "unblock") return `${result.name} isn't blocked.`;
    return result.current === "active"
      ? `${result.name} is already active.`
      : `${result.name} is already inactive.`;
  }
  return COMMON[result.status];
}

export function signOutResultText(result: SignOutResult | Common): string {
  switch (result.status) {
    case "done":
      return result.loggedIn
        ? `${result.name} has been logged out on every device. Notifications are off on their phones until they turn them on again.`
        : `${result.name} wasn't logged in anywhere. Notifications are off on their phones until they turn them on again.`;
    case "unchanged":
      return `${result.name} wasn't logged in anywhere.`;
    default:
      return COMMON[result.status];
  }
}

export function siteBlockResultText(
  result: SiteBlockResult | Common,
  kind: "block" | "unblock",
): string {
  switch (result.status) {
    case "done":
      return kind === "block"
        ? `${result.name} can't work at ${result.site} now.${onToday(result.futureBookings, " there")}`
        : `${result.name} can work at ${result.site} again.`;
    case "unchanged":
      return kind === "block"
        ? `${result.name} is already blocked from ${result.site}.`
        : `${result.name} wasn't blocked from ${result.site}.`;
    default:
      return COMMON[result.status];
  }
}
