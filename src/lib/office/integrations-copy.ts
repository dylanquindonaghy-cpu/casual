import { soonLabel, timeOnDay } from "../portal/format";
import type { AddressProblem } from "../integrations/send";
import type {
  ApiKeyRow,
  CreateApiKeyResult,
  PlannerLink,
  RevokeApiKeyResult,
} from "./integrations";
import type {
  AddWebhookResult,
  RemoveWebhookResult,
  RenewSecretResult,
  TestWebhookResult,
  WebhookStatus,
} from "./webhook-settings";

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

// ---- The webhook (12J.2; docs/office-v2.md 5.3.4) ----

export const WEBHOOK_INTRO =
  "Your planner hears about each booking, cancellation and withdrawn strike the moment it happens, with the full record. Give it an https address your planner gives you.";

export const NO_WEBHOOK = "No webhook yet.";

// "Working · last delivered 09:42" / "Failing since 03:10" / "Added · nothing sent yet".
export function webhookStatusText(status: WebhookStatus, now: Date, timeZone: string): string {
  switch (status.kind) {
    case "none":
      return NO_WEBHOOK;
    case "new":
      return "Added · nothing sent yet";
    case "working":
      return `Working · last delivered ${soonLabel(status.lastDeliveredAt, now, timeZone)}`;
    case "failing":
      return `Failing since ${soonLabel(status.since, now, timeZone)}`;
  }
}

export const SECRET_SHOWN_ONCE = "Copy it into your planner now. You won't see it again.";

export const removeWebhookQuestion =
  "Remove the webhook? Your planner stops hearing about bookings and cancellations at once.";

export const renewSecretQuestion =
  "Make a new signing secret? The old one stops working at once: paste the new one into your planner straight away.";

const ADDRESS_PROBLEMS: Record<AddressProblem | "firm_domain", string> = {
  not_an_address: "That isn't a web address. Paste the https address your planner gives you.",
  not_https: "The address must start with https://.",
  port: "The address can't name a port. Use your planner's usual https address.",
  credentials: "The address can't hold a user name or password.",
  ip_address: "The address must be a name, like hooks.example.com, not a number.",
  too_long: "That address is too long (500 characters at most).",
  ours: "That's a ShiftDesk address. Use your planner's address.",
  firm_domain: "That's a ShiftDesk address. Use your planner's address.",
};

export function addWebhookResultText(result: AddWebhookResult | Common): string {
  switch (result.status) {
    case "added":
      return SECRET_SHOWN_ONCE;
    case "unchanged":
      return "That address is already set. Nothing changed.";
    case "invalid":
      return ADDRESS_PROBLEMS[result.problem];
    case "agreement_needed":
      return "No webhook was added. Your planner can connect once your firm's agreement and data processing agreement with us are signed and recorded. Ask us to record them.";
    case "not_configured":
      return "Webhooks aren't switched on for ShiftDesk yet. Nothing was changed. Ask us to switch them on.";
    case "not_allowed":
      return "Only admins can add a webhook.";
    case "unknown":
      return "Something went wrong. Reload the page to see if the webhook was added. If it was, make a new signing secret.";
    default:
      return COMMON[result.status];
  }
}

export function renewSecretResultText(result: RenewSecretResult | Common): string {
  switch (result.status) {
    case "renewed":
      return SECRET_SHOWN_ONCE;
    case "no_webhook":
      return "There's no webhook to make a secret for.";
    case "not_configured":
      return "Webhooks aren't switched on for ShiftDesk yet. Nothing was changed.";
    case "not_allowed":
      return "Only admins can make a new signing secret.";
    case "unknown":
      return "Something went wrong. Make a new signing secret again: only the newest one works.";
    default:
      return COMMON[result.status];
  }
}

export function removeWebhookResultText(result: RemoveWebhookResult | Common): string {
  switch (result.status) {
    case "removed":
      return "Removed. Nothing more goes to your planner by webhook.";
    case "no_webhook":
      return "There was no webhook to remove.";
    case "not_allowed":
      return "Only admins can remove the webhook.";
    case "unknown":
      return "Something went wrong. Reload the page to see if the webhook was removed.";
    default:
      return COMMON[result.status];
  }
}

export function testWebhookResultText(result: TestWebhookResult | Common): string {
  switch (result.status) {
    case "queued":
      return "Test event on its way. Reload in a minute to see if it was delivered.";
    case "too_soon":
      return "A test event was sent less than 30 seconds ago. Wait a moment, then try again.";
    case "no_webhook":
      return "Add a webhook first.";
    case "not_allowed":
      return "Only admins can send a test event.";
    case "unknown":
      return "Something went wrong. Try again.";
    default:
      return COMMON[result.status];
  }
}
