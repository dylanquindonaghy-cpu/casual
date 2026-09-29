import { roleLabel } from "../portal/format";
// Message copy from docs/messaging-templates.md. Every message ends with the firm's sign-off.

export interface FirmVoice {
  name: string;
  signOff: string;
}

// login_link (WhatsApp, utility)
export function loginLinkMessage(firm: FirmVoice, link: string): string {
  return `Here's your ${firm.name} shifts link: ${link}. It works for 15 minutes and only for you. — ${firm.signOff}`;
}

// login_code (WhatsApp, utility): the pay pages' 6-digit step-up code.
export function loginCodeMessage(firm: FirmVoice, code: string): string {
  return `Your ${firm.name} code is ${code}. It works for 10 minutes. Don't share it with anyone. — ${firm.signOff}`;
}

// office_login_link (email): office users log in by a one-time link to their work email.
export function officeLoginLinkEmail(
  firm: FirmVoice,
  link: string,
): { subject: string; body: string } {
  return {
    subject: `Your ${firm.name} office login link`,
    body: [
      `Here's your link to the ${firm.name} office dashboard:`,
      "",
      link,
      "",
      "It works for 15 minutes, once, and only for you. If you didn't ask for it, you can ignore this email.",
      "",
      `— ${firm.signOff}`,
    ].join("\n"),
  };
}

// credential_expiring (WhatsApp, utility): sent 30, 14 and 7 days before a credential expires.
export function credentialExpiringMessage(
  firm: FirmVoice,
  credential: string,
  date: string,
): string {
  return `Your ${credential} expires on ${date}. Renew it and send the new details to the office so you can keep taking shifts. — ${firm.signOff}`;
}

// credential_expired (WhatsApp, utility): the day after a credential's expiry date.
export function credentialExpiredMessage(
  firm: FirmVoice,
  credential: string,
  date: string,
): string {
  return `Your ${credential} expired on ${date}. You can't take shifts that need it until you renew it and send the new details to the office. — ${firm.signOff}`;
}

// On screen only (the My shifts banner): a credential the office marked expired with no date.
export function credentialMarkedExpiredMessage(firm: FirmVoice, credential: string): string {
  return `Your ${credential} is marked as expired. You can't take shifts that need it until you renew it and send the new details to the office. — ${firm.signOff}`;
}

// credential_weekly_list (email to admins and resourcers, Mondays): what expires in the next 30
// days and what expired in the last week, one line per credential, at most
// WEEKLY_LIST_MAX_LINES per section (then "- and {n} more"), so the email stays within its limit.
export const WEEKLY_LIST_MAX_LINES = 40;

export function credentialWeeklyListEmail(
  firm: FirmVoice,
  expiring: string[],
  expired: string[],
): { subject: string; body: string } {
  const section = (title: string, lines: string[]) => {
    if (lines.length === 0) return [];
    const shown = lines.slice(0, WEEKLY_LIST_MAX_LINES).map((l) => `- ${l}`);
    const more = lines.length - WEEKLY_LIST_MAX_LINES;
    return [title, ...shown, ...(more > 0 ? [`- and ${more} more`] : []), ""];
  };
  return {
    subject: `${firm.name}: credentials expiring soon`,
    body: [
      ...section("Expiring in the next 30 days:", expiring),
      ...section(
        "Expired in the last week (these people can't take shifts that need them):",
        expired,
      ),
      "When someone sends you their new details, record the new expiry date so they can take shifts again.",
      "",
      `— ${firm.signOff}`,
    ].join("\n"),
  };
}

// shift_urgent (WhatsApp or SMS, utility): an offer in an urgent wave. {day} is "today",
// "tomorrow" or "on Sat 7 Nov" (the approved template's "today" can't be right for tomorrow).
export function shiftUrgentMessage(
  firm: FirmVoice,
  shift: {
    role: string;
    site: string | null;
    day: string;
    start: string;
    end: string;
    link: string;
  },
): string {
  const role = shift.role.replace(/_/g, " ");
  const article = /^[aeiou]/i.test(role) ? "an" : "a";
  const at = shift.site ? ` at ${shift.site}` : "";
  return `URGENT: we need ${article} ${role}${at} ${shift.day} ${shift.start}–${shift.end}. Tap to take it: ${shift.link}. — ${firm.signOff}`;
}

// shift_reminder_24h (WhatsApp or SMS, utility): the day before a booked shift. {day} is "tomorrow"
// or "today" (the approved template's "tomorrow" can't be right for a reminder that went late).
export function shiftReminder24hMessage(
  firm: FirmVoice,
  shift: { site: string | null; day: string; start: string; end: string; link: string },
): string {
  const at = shift.site ? ` at ${shift.site}` : "";
  return `Reminder: ${shift.day} ${shift.start}–${shift.end}${at}. Details: ${shift.link}. Can't make it? Cancel in the app as early as you can. — ${firm.signOff}`;
}

// shift_reminder_2h (WhatsApp or SMS, utility): 2 hours before a booked shift.
export function shiftReminder2hMessage(
  firm: FirmVoice,
  shift: { site: string | null; start: string; link: string },
): string {
  const at = shift.site ? ` at ${shift.site}` : "";
  return `Your shift${at} starts at ${shift.start}. Meeting point and instructions: ${shift.link}. — ${firm.signOff}`;
}

// shift_escalation (email to the office's admins and resourcers): an urgent shift still unfilled
// at the firm's escalation time.
export function shiftEscalationEmail(
  firm: FirmVoice,
  shift: {
    role: string;
    site: string | null;
    when: string; // "Sat 7 Nov, 08:00 to 16:00"
    freePlaces: number;
    offersSent: number;
    link: string; // the office dashboard
  },
): { subject: string; body: string } {
  const role = shift.role.replace(/_/g, " ");
  const Role = role.charAt(0).toUpperCase() + role.slice(1);
  const at = shift.site ? ` at ${shift.site}` : "";
  const places = shift.freePlaces === 1 ? "1 place" : `${shift.freePlaces} places`;
  const free = shift.freePlaces === 1 ? "place" : "places";
  const offers =
    shift.offersSent === 0
      ? "Nobody else could be offered it (no one eligible and available)."
      : `${shift.offersSent === 1 ? "1 offer" : `${shift.offersSent} offers`} sent, none accepted for the free ${free}.`;
  return {
    subject: `Unfilled: ${Role}${at}, ${shift.when}`,
    body: [
      `The ${role} shift${at}, ${shift.when}, still has ${places} free.`,
      offers,
      `Open the office dashboard: ${shift.link}`,
      `— ${firm.signOff}`,
    ].join("\n\n"),
  };
}

// Push (title / body), docs/messaging-templates.md "Push": an urgent offer.
export function urgentPush(shift: {
  role: string;
  site: string | null;
  day: string; // "today", "tomorrow", "on Sat 7 Nov"
  start: string;
}): { title: string; body: string } {
  const at = shift.site ? ` at ${shift.site}` : "";
  return {
    title: "Urgent shift",
    body: `${roleLabel(shift.role)} needed${at} ${shift.day} ${shift.start}.`,
  };
}

// Push (title / body), docs/messaging-templates.md "Push": a shift reminder. {day} is "tomorrow"
// or "today".
export function reminderPush(shift: {
  kind: "24h" | "2h";
  site: string | null;
  day: string;
  start: string;
  end: string;
}): { title: string; body: string } {
  const Day = shift.day.charAt(0).toUpperCase() + shift.day.slice(1);
  return {
    title: `${Day}: ${shift.site ?? "your shift"}`,
    body:
      shift.kind === "24h"
        ? `${shift.start}–${shift.end}. Tap for instructions.`
        : `Starts at ${shift.start}. Tap for instructions.`,
  };
}
