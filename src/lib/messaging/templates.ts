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
