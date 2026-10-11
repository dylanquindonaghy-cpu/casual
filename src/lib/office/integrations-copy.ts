import { soonLabel, timeOnDay } from "../portal/format";
import type {
  ApiKeyRow,
  CreateApiKeyResult,
  PlannerLink,
  RevokeApiKeyResult,
} from "./integrations";

// Integrations in plain words (docs/office-v2.md 5.3.4; docs/screens.md
// `/office/settings/integrations`; 12J.1). Pure, and safe in the browser: the limits are written
// out (src/lib/integrations/keys.ts reaches Node's crypto), and tests/unit/integrations.page.test.ts
// holds them to KEY_LABEL_MAX and MAX_LIVE_KEYS.

// "logged_out" / "error": from the action; "unknown": the browser's request failed, and the server
// may have finished the change.
type Common = { status: "logged_out" } | { status: "error" } | { status: "unknown" };

const COMMON: Record<"logged_out" | "error", string> = {
  logged_out: "Your session has ended. Log in again.",
  error: "Something went wrong. Nothing was changed. Try again.",
};

// Where the page links when nothing is connected: the guide's part for admins.
export const PLANNER_GUIDE_HREF = "/office/guide#connect-your-planner";

export const NOT_CONNECTED =
  "Not connected. Your planner can send sessions with an API key and hear about bookings and cancellations by webhook.";

// The page's one line under "Your planner" ("Not connected." is followed by the guide's link).
export function plannerLine(planner: PlannerLink, now: Date, timeZone: string): string {
  switch (planner.kind) {
    case "api":
      return `Connected by API · last change from your planner ${soonLabel(planner.lastChangeAt, now, timeZone)}`;
    case "sheet":
      return planner.syncedAt
        ? `Google Sheet · synced ${soonLabel(planner.syncedAt, now, timeZone)}`
        : "Google Sheet · not synced yet";
    case "none":
      return NOT_CONNECTED;
  }
}

// A key as the list shows it: its last 4 characters, never more ("…k3F9").
export const keyHintText = (hint: string): string => `…${hint}`;

export const keyCreatedText = (key: ApiKeyRow, timeZone: string): string =>
  `${key.createdBy}, ${timeOnDay(key.createdAt, timeZone)}`;

export const keyLastUsedText = (key: ApiKeyRow, now: Date, timeZone: string): string =>
  key.lastUsedAt ? soonLabel(key.lastUsedAt, now, timeZone) : "Never";

export const KEY_SHOWN_ONCE = "Copy this key now. You won't see it again.";

export const revokeQuestion = (name: string): string =>
  `Revoke ${name}? Your planner stops reaching ShiftDesk at once.`;

export function createKeyResultText(result: CreateApiKeyResult | Common): string {
  switch (result.status) {
    case "created":
      return KEY_SHOWN_ONCE;
    case "invalid":
      return "Give the key a name (60 characters at most).";
    case "too_many":
      return "You have 10 keys, the most a firm can have. Revoke one you don't use, then create a new one.";
    case "agreement_needed":
      return "No key was made. Your planner can connect once your firm's agreement and data processing agreement with us are signed and recorded. Ask us to record them.";
    case "not_allowed":
      return "Only admins can create API keys.";
    case "unknown":
      return "Something went wrong. Reload the page: if a new key is in the list, revoke it and create another.";
    default:
      return COMMON[result.status];
  }
}

export function revokeKeyResultText(result: RevokeApiKeyResult | Common): string {
  switch (result.status) {
    case "revoked":
      return "Revoked. That key stopped working at once.";
    case "already_revoked":
      return "That key was already revoked.";
    case "not_found":
      return "We can't find that key.";
    case "not_allowed":
      return "Only admins can revoke API keys.";
    case "unknown":
      return "Something went wrong. Reload the page to see if the key was revoked.";
    default:
      return COMMON[result.status];
  }
}
