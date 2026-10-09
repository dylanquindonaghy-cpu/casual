import { roleLabel } from "../portal/format";
// Message copy from docs/messaging-templates.md. Every message ends with the firm's sign-off.

export interface FirmVoice {
  name: string;
  signOff: string;
}

// login_link (WhatsApp, utility). The link comes last, with a space after it, never a full stop: a
// full stop straight after the link can end up in the link a phone opens (audit L10).
export function loginLinkMessage(firm: FirmVoice, link: string): string {
  return `Here's your ${firm.name} shifts link. It works for 15 minutes and only for you: ${link} — ${firm.signOff}`;
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

// strikes_email_confirm (email, 12B.7): sent to the strikes team's address when an admin saves it
// on Settings. The link confirms that address only, for 7 days (src/lib/office/strikes-email.ts).
export function strikesEmailConfirmEmail(
  firm: FirmVoice,
  link: string,
): { subject: string; body: string } {
  return {
    subject: `Confirm ${firm.name}'s strikes team email`,
    body: [
      `${firm.name} uses ShiftDesk to record late cancellations, and asked to send these records to this address.`,
      "",
      "If that's right, open this link within 7 days and select Confirm this address:",
      "",
      link,
      "",
      "If you weren't expecting this, you can ignore this email: nothing is sent here until the address is confirmed.",
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

export interface WeeklyListEntry {
  person: string;
  credential: string;
  date: string; // "3 Oct"
}

export function credentialWeeklyListEmail(
  firm: FirmVoice,
  expiring: WeeklyListEntry[],
  expired: WeeklyListEntry[],
): { subject: string; body: string } {
  const section = (title: string, entries: WeeklyListEntry[], verb: string) => {
    if (entries.length === 0) return [];
    const shown = entries
      .slice(0, WEEKLY_LIST_MAX_LINES)
      .map((e) => `- ${e.person}: ${e.credential}, ${verb} ${e.date}`);
    const more = entries.length - WEEKLY_LIST_MAX_LINES;
    return [title, ...shown, ...(more > 0 ? [`- and ${more} more`] : []), ""];
  };
  return {
    subject: `${firm.name}: credentials expiring soon`,
    body: [
      ...section("Expiring in the next 30 days:", expiring, "expires"),
      ...section(
        "Expired in the last week (these people can't take shifts that need them):",
        expired,
        "expired",
      ),
      "When someone sends you their new details, record the new expiry date so they can take shifts again.",
      "",
      `— ${firm.signOff}`,
    ].join("\n"),
  };
}

// shift_offer (WhatsApp, utility): the office offering a shift that isn't urgent to one worker
// (src/lib/offers/office-offer.ts; by text: shiftOfferSms). {date} is "Sat 7 Nov".
export function shiftOfferMessage(
  firm: FirmVoice,
  shift: {
    role: string;
    site: string | null;
    date: string;
    start: string;
    end: string;
    link: string;
  },
): string {
  const at = shift.site ? ` at ${shift.site}` : "";
  return `Shift available: ${shift.date} ${shift.start}–${shift.end}${at} (${shift.role.replace(/_/g, " ")}). Tap to take it: ${shift.link}. First to accept gets it. — ${firm.signOff}`;
}

// The office's offer as a text message (docs/messaging-templates.md, "SMS"): standard text
// characters only, the sign-off after a plain hyphen.
export function shiftOfferSms(
  firm: FirmVoice,
  shift: { site: string | null; date: string; start: string; link: string },
): string {
  const at = shift.site ? ` at ${shift.site}` : "";
  return `${firm.name}: shift ${shift.date} ${shift.start}${at}. Take it: ${shift.link} - ${firm.signOff}`;
}

// shift_urgent (WhatsApp, utility): an offer in an urgent wave (by text: shiftUrgentSms). {day} is "today",
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

// The urgent offer as a text message (docs/messaging-templates.md, "SMS"): short, and only
// standard text characters (the sign-off after a plain hyphen, not a dash), so it costs as few
// texts as possible. Used when the offer goes by text.
export function shiftUrgentSms(
  firm: FirmVoice,
  shift: { role: string; site: string | null; day: string; start: string; link: string },
): string {
  const role = shift.role.replace(/_/g, " ");
  const site = shift.site ? ` ${shift.site}` : "";
  return `${firm.name} URGENT: ${role} needed${site} ${shift.day} ${shift.start}. ${shift.link} - ${firm.signOff}`;
}

// shift_changed_by_firm (WhatsApp, utility): the office moved or shortened a booked shift. {date}
// and {site} are the shift as it was; {change} says what changed (changeWords); {start}–{end} are
// the new times ({start} names the day too when it moved to another day).
export function shiftChangedByFirmMessage(
  firm: FirmVoice,
  shift: {
    date: string;
    site: string | null;
    change: string;
    start: string;
    end: string;
    link: string;
  },
): string {
  const at = shift.site ? ` at ${shift.site}` : "";
  return `Change to your shift on ${shift.date}${at}: ${shift.change}. New time: ${shift.start}–${shift.end}. Details: ${shift.link}. — ${firm.signOff}`;
}

// What changed, for shift_changed_by_firm's {change}.
export function changeWords(change: {
  curtailed: boolean;
  timesChanged: boolean;
  newSite: string | null; // the new site's name when the site changed
  siteChanged: boolean;
}): string {
  if (change.curtailed) return "it's now shorter";
  const place = change.newSite ? `it's now at ${change.newSite}` : "the place has changed";
  if (change.siteChanged && change.timesChanged) return `new times, and ${place}`;
  if (change.siteChanged) return place;
  return "the times have changed";
}

// shift_cancelled_by_firm (WhatsApp, utility): the office cancelled a booked shift, or the booking.
export function shiftCancelledByFirmMessage(
  firm: FirmVoice,
  shift: { date: string; site: string | null; start: string; end: string; link: string },
): string {
  const at = shift.site ? ` at ${shift.site}` : "";
  return `Your shift on ${shift.date} ${shift.start}–${shift.end}${at} has been cancelled by the office. Open shifts: ${shift.link}. — ${firm.signOff}`;
}

// shift_confirmed (WhatsApp or SMS, utility): the office booked the worker onto a shift ("Assign",
// src/lib/notices/shift-confirmed.ts). A worker who takes a shift themselves sees it on screen.
export function shiftConfirmedMessage(
  firm: FirmVoice,
  shift: {
    role: string;
    site: string | null;
    date: string;
    start: string;
    end: string;
    link: string;
  },
): string {
  const at = shift.site ? ` at ${shift.site}` : "";
  return `Confirmed: ${shift.date} ${shift.start}–${shift.end}${at} (${shift.role.replace(/_/g, " ")}). Details and instructions: ${shift.link}. — ${firm.signOff}`;
}

// request_update (WhatsApp or SMS, utility): the office answered a worker's request. {type} is the
// kind in words ("time change"), {status} "approved" or "declined", {note} the office's note on
// one line. With no note, "The office says: {note}" is left out (request_update_no_note: WhatsApp
// won't send an empty variable).
export function requestUpdateMessage(
  firm: FirmVoice,
  request: { type: string; ref: string; status: string; note: string | null },
): string {
  const note = request.note ? ` The office says: ${request.note}` : "";
  return `Your request (${request.type}, ref ${request.ref}) is ${request.status}.${note} — ${firm.signOff}`;
}

// pay_query_update (WhatsApp or SMS, utility): payroll has sorted a worker's pay query
// (src/lib/notices/pay-query-update.ts). {status} is "sorted"; {note} is payroll's note on one line
// (always written by a person: pay disputes never get an AI answer, golden rule 9).
export function payQueryUpdateMessage(
  firm: FirmVoice,
  query: { ref: string; status: string; note: string },
): string {
  return `Update on your pay query (ref ${query.ref}): ${query.status}. ${query.note} — ${firm.signOff}`;
}

// Instant replies on the shifts line (docs/messaging-templates.md "Instant replies on the shifts
// line"): the answer to a worker's own WhatsApp, sent at once (free text: within 24 hours of their
// message WhatsApp needs no template). The app's fixed words only: a keyword or the AI picks which
// (src/lib/inbound/reply.ts), never what it says.
export type ShiftsLineReply =
  { intent: "shifts" | "cancel" | "pay"; link: string } | { intent: "office"; ref: string };

export function shiftsLineReply(firm: FirmVoice, reply: ShiftsLineReply): string {
  const text = (() => {
    switch (reply.intent) {
      case "shifts":
        return `Open shifts you're eligible for: ${reply.link}`;
      case "cancel":
        return `To cancel a shift, tap here and choose the shift: ${reply.link}. It's recorded instantly.`;
      case "pay":
        return `Your hours, rates and pay dates: ${reply.link} (you'll get a code to log in).`;
      case "office":
        return `The office will see this and get back to you. Ref ${reply.ref}.`;
    }
  })();
  return `${text} — ${firm.signOff}`;
}

// unknown_number (WhatsApp, a service reply within 24 hours of their message): someone messaged the
// shifts line from a number that isn't any worker's here (src/lib/inbound/reply.ts). At most once
// per number per 24 hours.
export function unknownNumberMessage(firm: FirmVoice): string {
  return `Thanks for your message. We don't recognise this number. If you work with ${firm.name}, reply with your full name and the office will get back to you. — ${firm.signOff}`;
}

// unknown_number_alert (email to the office's active admins and resourcers): a message on the
// shifts line from a number that isn't one of the firm's active staff. Neither the number nor the
// message is in the email (previews, forwards): they're on the office dashboard.
export function unknownNumberAlertEmail(
  firm: FirmVoice,
  link: string, // the office dashboard
  opts: { askedName: boolean }, // they were sent unknown_number (a WhatsApp only, and it went)
): { subject: string; body: string } {
  return {
    subject: `${firm.name}: a message from a number we don't know`,
    body: [
      "Someone messaged the shifts line from a number that isn't one of your active staff.",
      opts.askedName ? "We asked them for their full name." : "We haven't replied to them.",
      `See the message on the office dashboard: ${link}`,
      `— ${firm.signOff}`,
    ].join("\n\n"),
  };
}

// Call-to-text (docs/messaging-templates.md "Call-to-text recording (voice)"): what a caller hears
// when they ring the shifts line (src/lib/inbound/voice.ts), then the tone for a voicemail. A
// withheld number can't be sent a link, so it isn't promised one; nor is a number the login
// throttle has stopped for now (or when asking failed). Any number can be stopped, a worker's or
// not, so that version says nothing about whose number it is.
export type CallLink = "sent" | "withheld" | "not_now";

export function callGreeting(firm: FirmVoice, link: CallLink): string {
  const middle =
    link === "withheld"
      ? "We can't see your number, so we can't send you a link."
      : link === "not_now"
        ? "We can't send you a link just now."
        : "We've just sent a link to your phone where you can see your shifts, take open shifts or cancel straight away.";
  return `Thanks for calling ${firm.name}. ${middle} To leave a message for the office, speak after the tone.`;
}

// voicemail_received (WhatsApp utility template, or SMS): a worker's voicemail on the shifts line
// became a request for the office (src/lib/inbound/reply.ts). A phone call doesn't open WhatsApp's
// 24-hour window for free text, so this is a template, sent by the channel the worker chose.
export function voicemailReceivedMessage(firm: FirmVoice, ref: string): string {
  return `Thanks for your voicemail. The office will see it and get back to you. Ref ${ref}. — ${firm.signOff}`;
}

// sms_stopped / sms_started (text only, the answer to their own text): a worker replied STOP or
// START to a text (src/lib/inbound/opt-out.ts). A plain hyphen before the sign-off: a text-only
// message, kept to standard text characters.
export function smsStoppedMessage(firm: FirmVoice): string {
  return `You won't get texts from ${firm.name} now. Reply START to turn them back on. - ${firm.signOff}`;
}

export function smsStartedMessage(firm: FirmVoice): string {
  return `Texts from ${firm.name} are back on. Reply STOP to turn them off. - ${firm.signOff}`;
}

// After a voicemail, and when the number called isn't any firm's.
export const CALL_GOODBYE = "Thank you. Goodbye.";
export const CALL_NOT_IN_USE = "Sorry, this number isn't in use.";

// Twilio's fallback when our app doesn't answer a call (Phase 8; docs/messaging-templates.md
// "Call-to-text recording (voice)"): served by Twilio itself (a TwiML Bin), so the caller still
// reaches a person. Why, then the manager's phone. The closing line plays whenever that call ends
// (answered, voicemail or no answer: a TwiML Bin can't tell which), so it has to be true for all of
// them; and it doesn't suggest messaging, which is down too while the app isn't answering.
export function callFallbackGreeting(firm: { name: string }): string {
  return `Sorry, our system isn't answering right now. Putting you through to ${firm.name}.`;
}
export const CALL_FALLBACK_END = "If nobody answered, please call again in a few minutes. Goodbye.";

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

// pay_digest (email to payroll, at the firm's digest time): the new pay queries grouped by likely
// cause, biggest first, with the list attached. The body holds counts and the groups' facts only;
// names and what workers wrote are in the attachment. At most PAY_DIGEST_MAX_GROUPS group lines
// (then "- and {n} more groups"), so the email stays within its limit.
export const PAY_DIGEST_MAX_GROUPS = 30;

export interface PayDigestContent {
  total: number; // new queries in this digest
  biggest: { count: number; facts: string } | null; // the biggest group: "wrong rate, the week of …"
  groups: { heading: string; aiLine: string | null }[]; // biggest first
  earlier: number; // queries from earlier digests still waiting
  later: number; // new queries that didn't fit in this one
  filename: string;
  link: string; // payroll's pay queries page
}

const queriesWord = (n: number) => (n === 1 ? "1 new pay query" : `${n} new pay queries`);

export function payDigestEmail(
  firm: FirmVoice,
  d: PayDigestContent,
): { subject: string; body: string } {
  const since = `${queriesWord(d.total)} since the last digest`;
  const headline =
    d.total === 1 && d.biggest
      ? `${since}: ${d.biggest.facts}.`
      : d.biggest && d.biggest.count === d.total
        ? `${since}, all about the same thing: ${d.biggest.facts}.`
        : d.biggest && d.biggest.count >= 2
          ? `${since}. ${d.biggest.count} are about the same thing: ${d.biggest.facts}.`
          : `${since}, each about something different.`;
  const lines = d.groups
    .slice(0, PAY_DIGEST_MAX_GROUPS)
    .flatMap((g) => [
      `- ${g.heading}`,
      ...(g.aiLine ? [`  AI summary: ${g.aiLine} (written by AI)`] : []),
    ]);
  const moreGroups = d.groups.length - PAY_DIGEST_MAX_GROUPS;
  const waiting = [
    ...(d.earlier > 0
      ? [
          d.earlier === 1
            ? "1 query from an earlier digest is still waiting."
            : `${d.earlier} queries from earlier digests are still waiting.`,
        ]
      : []),
    ...(d.later > 0
      ? [
          `${d.later === 1 ? "1 more new query" : `${d.later} more new queries`} didn't fit in this digest. They're on the pay queries page and will be in the next one.`,
        ]
      : []),
  ];
  return {
    subject: `${firm.name}: ${queriesWord(d.total)}`,
    body: [
      headline,
      "",
      "Grouped by likely cause, biggest first:",
      ...lines,
      ...(moreGroups > 0
        ? [moreGroups === 1 ? "- and 1 more group" : `- and ${moreGroups} more groups`]
        : []),
      "",
      ...(waiting.length > 0 ? [...waiting, ""] : []),
      `The list is attached (${d.filename}): each query with the worker, the day, the shift, the issue and what they wrote.`,
      "",
      `Answer them on the pay queries page: ${d.link}`,
      "",
      `— ${firm.signOff}`,
    ].join("\n"),
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

// Push (title / body), docs/messaging-templates.md "Push": the office's offer.
export function offerPush(shift: { site: string | null; date: string; start: string }): {
  title: string;
  body: string;
} {
  const at = shift.site ? ` at ${shift.site}` : "";
  return { title: "Shift available", body: `${shift.date} ${shift.start}${at}. Tap to take it.` };
}

// Push (title / body), docs/messaging-templates.md "Push": the office changed or cancelled a booked
// shift.
export function firmChangePush(
  change:
    | { kind: "changed"; date: string; change: string }
    | { kind: "cancelled"; date: string; start: string },
): { title: string; body: string } {
  return change.kind === "changed"
    ? { title: "Shift changed", body: `${change.date}: ${change.change}. Tap to see it.` }
    : {
        title: "Shift cancelled",
        body: `${change.date} ${change.start} was cancelled by the office.`,
      };
}

// Push (title / body), docs/messaging-templates.md "Push": the office booked the worker onto a shift.
export function bookedPush(shift: { site: string | null; date: string; start: string }): {
  title: string;
  body: string;
} {
  const at = shift.site ? ` at ${shift.site}` : "";
  return { title: "Shift booked", body: `${shift.date} ${shift.start}${at}. Tap for details.` };
}

// Push (title / body): the office answered a request. {Type} is the kind as the list names it
// ("Time change").
export function requestUpdatePush(request: { type: string; status: string }): {
  title: string;
  body: string;
} {
  return { title: `Request ${request.status}`, body: `${request.type} — tap to view.` };
}

// Push: a pay query sorted. Nothing about the pay itself (a lock screen shows it): tapping opens the
// pay page, behind the pay code.
export function payQueryUpdatePush(): { title: string; body: string } {
  return { title: "Pay query sorted", body: "Payroll has answered. Open your pay page to see it." };
}
