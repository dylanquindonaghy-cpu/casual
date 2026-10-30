import { roleLabel } from "../portal/format";
import { cutChars } from "../text/cut";
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

// A casual's login link and pay-page code by email (P2.6; docs/messaging-templates.md "Email to
// casuals", approved by Dylan on 2026-10-28, the link last on 2026-10-29): only where the firm has
// switched login by email on (`login_by_email`) and there's no text sender.
export function workerLoginLinkEmail(
  firm: FirmVoice,
  link: string,
): { subject: string; body: string } {
  return {
    subject: `Your ${firm.name} shifts link`,
    body: `Here's your ${firm.name} shifts link. It works for 15 minutes and only for you. If you didn't ask for it, you can ignore this email: ${link} — ${firm.signOff}`,
  };
}

export function loginCodeEmail(firm: FirmVoice, code: string): { subject: string; body: string } {
  return {
    subject: `Your ${firm.name} code`,
    body: `Your ${firm.name} code is ${code}. It works for 10 minutes. Don't share it with anyone. If you didn't ask for it, you can ignore this email. — ${firm.signOff}`,
  };
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

// strike_evidence (email, 12C.4; docs/office-v2.md 5.6): to the strikes team's confirmed address
// when a strike is recorded, with the cancellation record's PDF (src/lib/strikes/evidence.ts). The
// facts come formatted (times in the firm's zone). Never a reason: the PDF's reason for a casual is
// "Casual's own reason (see ShiftDesk)". No full stop after the link (audit L10). The subject keeps
// to 200 characters, shortening the casual's name and the site (never the reference).
export interface StrikeEvidenceFacts {
  casual: string; // "Kieran Doyle"
  staffId: string | null; // the firm's staff id, when it has one
  role: string; // "Steward"
  site: string | null; // "Acme Demo Racecourse"
  notice: string; // "15 hours' notice"
  ref: string; // "B71E0C42"
  session: string; // "Steward · Raceday · Wed 7 Oct 10:30–18:30"
  cancelledAt: string; // "19:05 on Tue 6 Oct"
  beforeStart: string; // "15 hours"
  thresholdHours: string; // "48"
  strikeNumber: string; // "2": this strike's place among their strikes counting then
  liveDays: string; // "90"
  link: string; // the record in the office
}

export const EVIDENCE_SUBJECT_MAX = 200;
// At most `max` UTF-16 units (what the message's limit counts), cut between whole characters.
const clip = (text: string, max: number) => {
  if (text.length <= max) return text;
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
};

export function strikeEvidenceEmail(
  firm: FirmVoice,
  f: StrikeEvidenceFacts,
): { subject: string; body: string } {
  const subjectOf = (casual: string, site: string | null) =>
    `Strike: ${casual} cancelled ${f.role}${site ? ` at ${site}` : ""} with ${f.notice} (ref ${f.ref})`;
  let subject = subjectOf(f.casual, f.site);
  if (subject.length > EVIDENCE_SUBJECT_MAX) {
    // What isn't the name or the site, then the room left shared between them.
    const fixed = subject.length - f.casual.length - (f.site?.length ?? 0);
    const each = Math.max(1, Math.floor((EVIDENCE_SUBJECT_MAX - fixed) / (f.site ? 2 : 1)));
    subject = subjectOf(clip(f.casual, each), f.site ? clip(f.site, each) : null);
  }
  // Anything else too long (a role, the notice): cut before the reference, which always stays.
  const ref = ` (ref ${f.ref})`;
  if (subject.length > EVIDENCE_SUBJECT_MAX) {
    subject = `${clip(subject.slice(0, -ref.length), EVIDENCE_SUBJECT_MAX - ref.length)}${ref}`;
  }
  return {
    subject,
    body: [
      `${f.casual}${f.staffId ? ` (staff id ${f.staffId})` : ""} cancelled ${f.session} at ${f.cancelledAt}, ${f.beforeStart} before the start. That is under your ${f.thresholdHours}-hour rule, so a strike was recorded automatically. It is their strike ${f.strikeNumber} in the last ${f.liveDays} days.`,
      "",
      "The record is attached (PDF) and is also here:",
      "",
      f.link,
      "",
      `— ${firm.signOff}`,
    ].join("\n"),
  };
}

// credential_expiring (WhatsApp or SMS, utility): sent 30, 14 and 7 days before a credential
// expires, by the worker's channel (13.5; the same words by text). The link is the casual's upload
// page for it (12F.2; docs/office-v2.md 5.7 item 5). One she can't upload (the office records it,
// or none of her roles needs it: no link, null) is credential_expiring_to_office, the words before
// 12F.2.
export function credentialExpiringMessage(
  firm: FirmVoice,
  credential: string,
  date: string,
  link: string | null,
): string {
  return link
    ? `Your ${credential} expires on ${date}. Upload your renewed card so you can keep taking shifts that need it: ${link} — ${firm.signOff}`
    : `Your ${credential} expires on ${date}. Renew it and send the new details to the office so you can keep taking shifts. — ${firm.signOff}`;
}

// credential_expired (WhatsApp or SMS, utility): the day after a credential's expiry date, by the
// worker's channel (13.5), with the same upload link (credential_expired_to_office, no link, for
// one she can't upload).
export function credentialExpiredMessage(
  firm: FirmVoice,
  credential: string,
  date: string,
  link: string | null,
): string {
  return link
    ? `Your ${credential} expired on ${date}. You can't take shifts that need it until you upload your renewed card and the office checks it: ${link} — ${firm.signOff}`
    : `Your ${credential} expired on ${date}. You can't take shifts that need it until you renew it and send the new details to the office. — ${firm.signOff}`;
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

// The office's own reply on Enquiries (docs/messaging-templates.md "The office's reply on Enquiries";
// 12D.1): their words on one line, signed. Free text only inside WhatsApp's 24-hour window or by
// text; outside the window it goes as `request_update` instead (src/lib/office/enquiry-rules.ts).
export function officeReplyMessage(
  firm: FirmVoice,
  text: string,
  channel: "whatsapp" | "sms",
): string {
  return channel === "sms" ? `${text} - ${firm.signOff}` : `${text} — ${firm.signOff}`;
}

// pay_query_update (WhatsApp or SMS, utility): payroll has sorted a worker's pay query
// (src/lib/notices/pay-query-update.ts). Payroll's answer itself stays behind the pay code: the
// message only says there is one and links to the pay page (13.4; Messages 17).
export function payQueryUpdateMessage(
  firm: FirmVoice,
  query: { ref: string; link: string },
): string {
  return `Payroll has answered your pay query (ref ${query.ref}). See their answer on your pay page: ${query.link} — ${firm.signOff}`;
}

// The subject of each message to a casual that can go by email (docs/messaging-templates.md "Email
// to casuals", approved by Dylan on 2026-10-28; P2.4): when no phone takes a push and no text can go,
// it goes by email, its body the message's own words (its WhatsApp text above).
export function shiftOfferEmailSubject(shift: {
  date: string;
  start: string;
  end: string;
}): string {
  return `Shift available: ${shift.date} ${shift.start}–${shift.end}`;
}

export function shiftUrgentEmailSubject(shift: { role: string; day: string }): string {
  const role = shift.role.replace(/_/g, " ");
  const article = /^[aeiou]/i.test(role) ? "an" : "a";
  return `URGENT: ${article} ${role} needed ${shift.day}`;
}

export function shiftConfirmedEmailSubject(shift: { date: string }): string {
  return `Confirmed: your shift on ${shift.date}`;
}

export function shiftReminder24hEmailSubject(shift: { day: string }): string {
  return `Reminder: your shift ${shift.day}`;
}

export function shiftReminder2hEmailSubject(shift: { start: string }): string {
  return `Your shift starts at ${shift.start}`;
}

export function shiftChangedByFirmEmailSubject(shift: { date: string }): string {
  return `Change to your shift on ${shift.date}`;
}

export function shiftCancelledByFirmEmailSubject(shift: { date: string }): string {
  return `Your shift on ${shift.date} is cancelled`;
}

export function requestUpdateEmailSubject(request: { ref: string; status: string }): string {
  return `Your request (ref ${request.ref}) is ${request.status}`;
}

export function payQueryUpdateEmailSubject(): string {
  return "Payroll has answered your pay query";
}

export function credentialExpiringEmailSubject(credential: string, date: string): string {
  return `Your ${credential} expires on ${date}`;
}

export function credentialExpiredEmailSubject(credential: string): string {
  return `Your ${credential} has expired`;
}

// Instant replies on the shifts line (docs/messaging-templates.md "Instant replies on the shifts
// line"): the answer to a worker's own WhatsApp, sent at once (free text: within 24 hours of their
// message WhatsApp needs no template). The app's fixed words only: a keyword or the AI picks which
// (src/lib/inbound/reply.ts), never what it says.
// "shifts" and "cancel" get the personal reply instead (src/lib/inbound/personal-reply.ts, 12D.2).
// The pay reply is automatic, so it says how to reach a person (WhatsApp's escalation rule); the
// office's reply already goes to one.
export type ShiftsLineReply = { intent: "pay"; link: string } | { intent: "office"; ref: string };

// Before the sign-off of every automatic reply on the shifts line (docs/office-v2.md 5.7 item 3:
// WhatsApp's rule that people can reach a person; "office" is a keyword).
export const AUTOMATIC_REPLY = "Automatic reply. Send OFFICE to reach a person.";

export function shiftsLineReply(firm: FirmVoice, reply: ShiftsLineReply): string {
  const text =
    reply.intent === "pay"
      ? `Your hours, rates and pay dates: ${reply.link} (you'll get a code to log in).`
      : `The office will see this and get back to you. Ref ${reply.ref}.`;
  return `${text} ${AUTOMATIC_REPLY} — ${firm.signOff}`;
}

// unknown_number (WhatsApp, a service reply within 24 hours of their message): someone messaged the
// shifts line from a number that isn't any worker's here (src/lib/inbound/reply.ts). At most once
// per number per 24 hours.
export function unknownNumberMessage(firm: FirmVoice): string {
  return `Thanks for your message. We don't recognise this number. If you work with ${firm.name}, reply with your full name and the office will get back to you. ${AUTOMATIC_REPLY} — ${firm.signOff}`;
}

// unknown_number_alert (email to the office's active admins and resourcers): a message on the
// shifts line from a number that isn't one of the firm's active staff. Neither the number nor the
// message is in the email (previews, forwards): they're on Enquiries, under Need a person, which
// the link opens (the dashboard's latest four could have moved on by then).
export function unknownNumberAlertEmail(
  firm: FirmVoice,
  link: string, // Enquiries' Need a person (/office/enquiries?view=person)
  opts: { askedName: boolean }, // they were sent unknown_number (a WhatsApp only, and it went)
): { subject: string; body: string } {
  return {
    subject: `${firm.name}: a message from a number we don't know`,
    body: [
      "Someone messaged the shifts line from a number that isn't one of your active staff.",
      opts.askedName ? "We asked them for their full name." : "We haven't replied to them.",
      `See it in Enquiries, under Need a person: ${link}`,
      `— ${firm.signOff}`,
    ].join("\n\n"),
  };
}

// unknown_numbers_combined (Phase 25.3; email to the same people): once, at the end of a clock hour in
// which the firm's 5 unknown_number_alert emails were used up, for the messages that hour that got
// no email. Like the alert, no number and no message. `from` and `to`: the hour in the firm's time
// ("18:00", "19:00").
export function unknownNumbersCombinedEmail(
  firm: FirmVoice,
  link: string, // Enquiries' Need a person (/office/enquiries?view=person)
  hour: { messages: number; from: string; to: string },
): { subject: string; body: string } {
  const many = hour.messages === 1 ? "1 more message" : `${hour.messages} more messages`;
  return {
    subject: `${firm.name}: ${many} from numbers we don't know`,
    body: [
      `${many} came to the shifts line between ${hour.from} and ${hour.to} from numbers that aren't your active staff.`,
      "We send at most 5 of these emails an hour, so this one covers the rest.",
      `See ${hour.messages === 1 ? "it" : "them"} in Enquiries, under Need a person: ${link}`,
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
  return `Thanks for your voicemail. The office will see it and get back to you. Ref ${ref}. ${AUTOMATIC_REPLY} — ${firm.signOff}`;
}

// sms_stopped / sms_started (text only, the answer to their own text): a worker replied STOP or
// START to a text (src/lib/inbound/opt-out.ts). A plain hyphen before the sign-off: a text-only
// message, kept to standard text characters.
export function smsStoppedMessage(firm: FirmVoice): string {
  return `You won't get texts from ${firm.name} now. Reply START to turn them back on. ${AUTOMATIC_REPLY} - ${firm.signOff}`;
}

export function smsStartedMessage(firm: FirmVoice): string {
  return `Texts from ${firm.name} are back on. Reply STOP to turn them off. ${AUTOMATIC_REPLY} - ${firm.signOff}`;
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
  return `Reminder: ${shift.day} ${shift.start}–${shift.end}${at}. Details: ${shift.link}. Can't make it? Cancel with the link as early as you can. — ${firm.signOff}`;
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

// --- The staffing inbox's emails (P7.5; Phase 25.5; docs/messaging-templates.md "The staffing
// inbox's emails") ---------------------------------------------------------------------------

// "Re: {their subject}" (one "Re:" only), or "Your email to {firm}" when it had none: at most the
// 200 characters an email's subject may hold (src/lib/messaging/transport.ts).
export function inboxReplySubject(firm: FirmVoice, subject: string | null): string {
  const theirs = subject?.replace(/\s+/g, " ").trim() ?? "";
  if (!theirs) return cutChars(`Your email to ${firm.name}`, 200);
  return cutChars(/^re:/i.test(theirs) ? theirs : `Re: ${theirs}`, 200);
}

export const INBOX_AUTOMATIC_LINE =
  "This is an automatic reply. To reach a person, reply to this email.";

export type InboxAnswer = "shifts" | "cancel" | "pay";

// email_answer_shifts / _cancel / _pay: a casual's email sorted as one of these, with the firm's
// automatic replies on. Its link only, never an answer in words; each link last on its line.
export function inboxAnswerEmail(
  firm: FirmVoice,
  answer: InboxAnswer,
  e: { firstName: string; subject: string | null; link: string },
): { subject: string; body: string } {
  const lines = {
    shifts: ["The shifts you can take are here:", e.link, "You'll get a code to log in."],
    cancel: [
      "To cancel a shift, open it here:",
      e.link,
      "You'll see what cancelling means for you before you confirm, and it's recorded the moment you do.",
    ],
    pay: [
      "Your hours, rates and pay dates are here:",
      e.link,
      'You\'ll get a code to log in. If something looks wrong, tap "Raise a pay query" there, so payroll sees it.',
    ],
  }[answer];
  return {
    subject: inboxReplySubject(firm, e.subject),
    body: [
      `Hi ${e.firstName},`,
      lines.slice(0, 2).join("\n"),
      lines[2],
      INBOX_AUTOMATIC_LINE,
      `— ${firm.signOff}`,
    ].join("\n\n"),
  };
}

// The office's reply to a casual's email (Enquiries): their own words, checked and sent by a person
// (it may have begun as the AI's draft, which they changed as they liked).
export function inboxOfficeReplyEmail(
  firm: FirmVoice,
  e: { firstName: string; subject: string | null; words: string },
): { subject: string; body: string } {
  return {
    subject: inboxReplySubject(firm, e.subject),
    body: [`Hi ${e.firstName},`, e.words.trim(), `— ${firm.signOff}`].join("\n\n"),
  };
}

// inbox_summary (email, to active admins and resourcers): a 3-hour slot's emails to the staffing
// inbox, by what came of them. Counts only: no names, addresses or words. `from` and `to`: the
// slot in the firm's time ("09:00", "12:00").
export function inboxSummaryEmail(
  firm: FirmVoice,
  link: string, // Enquiries (/office/enquiries)
  s: {
    from: string;
    to: string;
    emails: number;
    linked: number;
    waiting: number;
    office: number;
    pay: number;
    notCasuals: number;
  },
): { subject: string; body: string } {
  const emails = `${s.emails} ${s.emails === 1 ? "email" : "emails"}`;
  const lines = [
    s.linked > 0 ? `${s.linked} answered with a link` : null,
    s.waiting > 0 ? `${s.waiting} waiting for a person` : null,
    s.office > 0 ? `${s.office} already answered by your office` : null,
    s.pay > 0 ? `${s.pay} ${s.pay === 1 ? "pay question" : "pay questions"}` : null,
    s.notCasuals > 0 ? `${s.notCasuals} not from your casuals (in your own inbox)` : null,
  ].filter((l): l is string => l !== null);
  return {
    subject: `${firm.name}: ${emails} to the staffing inbox`,
    body: [
      `Between ${s.from} and ${s.to}, the staffing inbox got ${emails}:`,
      lines.join("\n"),
      `See them in Enquiries: ${link}`,
      `— ${firm.signOff}`,
    ].join("\n\n"),
  };
}
