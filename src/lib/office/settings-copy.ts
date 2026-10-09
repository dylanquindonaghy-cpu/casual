import { timeOnDay } from "../portal/format";
import type { EditSitePostcodeResult, SettingsPage } from "./settings-page";
import type { ConfirmStrikesEmailResult, SaveStrikesEmailResult } from "./strikes-email";

// Settings in plain words (docs/screens.md `/office/settings` and `/confirm-email`; 12B.7). Pure.

type Common = { status: "logged_out" } | { status: "error" };

const COMMON: Record<Common["status"], string> = {
  logged_out: "Your session has ended. Log in again.",
  error: "Something went wrong. Try again.",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Beside the tag ("Not set", "Not confirmed", "Confirmed"): whether evidence can go there.
export function strikesEmailStatus(s: SettingsPage["strikesEmail"], timeZone: string): string {
  if (!s.address) return "Strike evidence isn't sent anywhere.";
  if (s.confirmedAt) {
    return `Strike evidence goes to this address (confirmed at ${timeOnDay(s.confirmedAt, timeZone)}).`;
  }
  return s.linkSentAt
    ? `We sent a link at ${timeOnDay(s.linkSentAt, timeZone)}. It works for 7 days. Strike evidence only goes there once it's confirmed.`
    : "Strike evidence only goes there once it's confirmed.";
}

export function strikesEmailResultText(result: SaveStrikesEmailResult | Common): string {
  switch (result.status) {
    case "saved":
      return "Saved. We've sent a link to that address to confirm it: it works for 7 days.";
    case "sent_again":
      return "We've sent the link again. It works for 7 days.";
    case "unchanged":
      return "Nothing changed.";
    case "cleared":
      return "Removed. Strike evidence isn't sent anywhere until you add an address.";
    case "invalid":
      return "Enter the team's email address (254 characters at most).";
    case "not_allowed":
      return "Only admins can change settings.";
    default:
      return COMMON[result.status];
  }
}

export function sitePostcodeResultText(
  result: EditSitePostcodeResult | Common | { status: "not_allowed" },
): string {
  switch (result.status) {
    case "saved":
      return "Saved.";
    case "unchanged":
      return "Nothing changed.";
    case "in_use":
      return result.sessions === 1
        ? "1 booked session uses this site: move it first."
        : `${plural(result.sessions, "booked session", "booked sessions")} use this site: move them first.`;
    case "invalid":
      return "Enter a UK postcode, like LS1 4AP, or leave it empty.";
    case "not_found":
      return "We can't find that site.";
    case "not_allowed":
      return "Only admins can change settings.";
    default:
      return COMMON[result.status];
  }
}

// The strikes team's page after "Confirm this address" (`/confirm-email`).
export function confirmResultText(
  result: ConfirmStrikesEmailResult | { status: "error" },
  firmName: string,
): string {
  switch (result.status) {
    case "confirmed":
      return `Confirmed. ${firmName} can now send records of late cancellations to this address.`;
    case "already":
      return "This address is already confirmed.";
    case "expired":
      return `This link has expired. Ask ${firmName} to send a new one.`;
    case "invalid":
      return `This link doesn't work. It may be for an older address. Ask ${firmName} to send a new one.`;
    case "error":
      return COMMON.error;
  }
}
