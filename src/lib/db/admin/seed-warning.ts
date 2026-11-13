import { STRIKE_WARNING_VERSION } from "../../strikes/words";

// The strike warning a seeded cancellation records (Phase 37.8, L8): as the app records it
// (src/lib/roster/cancel.ts), only on a casual's own cancellation in the app, past the cancel
// screen's warning (by.type "worker" with the warning she saw). One taken by the office for her (a
// phone call: cancel_via "office"), the firm's own and a planner's never showed her one.
export function seedStrikeWarning(b: {
  status: string;
  cancelVia: "app" | "office" | "api" | null;
  cancelledAt: Date | null;
}): { strikeWarningVersion: string; strikeWarningShownAt: Date } | Record<string, never> {
  return b.status === "cancelled_worker" && b.cancelVia === "app" && b.cancelledAt
    ? { strikeWarningVersion: STRIKE_WARNING_VERSION, strikeWarningShownAt: b.cancelledAt }
    : {};
}
