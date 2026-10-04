// The WhatsApp templates to submit to Meta (through Twilio's console), exactly as the code sends
// them (docs/messaging-templates.md, "Submitting to Meta"). WhatsApp only delivers a message a
// business starts if it matches an approved template, with only the {{n}} parts filled in. So:
//
// - Every message the code sends by WhatsApp has an entry here, and a test
//   (tests/unit/copy.templates-doc.test.ts) checks the template functions in templates.ts produce
//   exactly this text with the sample values: what we send is what we submitted.
// - Words that are sometimes left out need their own template: "at {site}" when the shift has no
//   site (the `_no_site` variants), and the office's note (`request_update_no_note`). In
//   shift_urgent, "a" or "an" before the role goes inside the role's variable (`role`); shift_offer
//   names the role alone (`roleName`).
// - The sign-off is a variable, because a firm may set its own (src/lib/tenancy/sign-off.ts).
//
// Not submitted yet: that needs Dylan's WhatsApp Business account (PLAN.md Parking lot,
// "Submit the WhatsApp templates"). Each approved template's content id is recorded then, for the
// Twilio transport.

export interface WhatsAppTemplate {
  name: string; // lower case and underscores, as Meta requires
  // The template in docs/messaging-templates.md this is (a `_no_site` variant shares its doc row).
  docName: string;
  // Our expectation; Meta decides on approval (the doc says the same).
  category: "utility";
  language: "en_GB";
  // What each {{n}} is, in order: {{1}} is variables[0].
  variables: readonly string[];
  body: string;
  // Sample values for the submission (Meta asks for one per variable). Fake: the demo firm.
  example: Readonly<Record<string, string>>;
}

const SIGN_OFF = "Acme Events Shift Team";
const LINK = "https://acme.shiftdesk.example/shifts/3f2a";

export const WHATSAPP_TEMPLATES: readonly WhatsAppTemplate[] = [
  {
    name: "login_link",
    docName: "login_link",
    category: "utility",
    language: "en_GB",
    variables: ["firm", "link", "signOff"],
    body: "Here's your {{1}} shifts link. It works for 15 minutes and only for you: {{2}} — {{3}}",
    example: {
      firm: "Acme Events",
      link: "https://acme.shiftdesk.example/l#Xy12",
      signOff: SIGN_OFF,
    },
  },
  {
    name: "login_code",
    docName: "login_code",
    category: "utility",
    language: "en_GB",
    variables: ["firm", "code", "signOff"],
    body: "Your {{1}} code is {{2}}. It works for 10 minutes. Don't share it with anyone. — {{3}}",
    example: { firm: "Acme Events", code: "482913", signOff: SIGN_OFF },
  },
  {
    name: "shift_offer",
    docName: "shift_offer",
    category: "utility",
    language: "en_GB",
    variables: ["date", "start", "end", "site", "roleName", "link", "signOff"],
    body: "Shift available: {{1}} {{2}}–{{3}} at {{4}} ({{5}}). Tap to take it: {{6}}. First to accept gets it. — {{7}}",
    example: {
      date: "Sat 7 Nov",
      start: "08:00",
      end: "16:00",
      site: "Riverside Arena",
      roleName: "steward",
      link: LINK,
      signOff: SIGN_OFF,
    },
  },
  {
    name: "shift_offer_no_site",
    docName: "shift_offer",
    category: "utility",
    language: "en_GB",
    variables: ["date", "start", "end", "roleName", "link", "signOff"],
    body: "Shift available: {{1}} {{2}}–{{3}} ({{4}}). Tap to take it: {{5}}. First to accept gets it. — {{6}}",
    example: {
      date: "Sat 7 Nov",
      start: "08:00",
      end: "16:00",
      roleName: "door supervisor",
      link: LINK,
      signOff: SIGN_OFF,
    },
  },
  {
    name: "shift_urgent",
    docName: "shift_urgent",
    category: "utility",
    language: "en_GB",
    variables: ["role", "site", "day", "start", "end", "link", "signOff"],
    body: "URGENT: we need {{1}} at {{2}} {{3}} {{4}}–{{5}}. Tap to take it: {{6}}. — {{7}}",
    example: {
      role: "a door supervisor",
      site: "Riverside Arena",
      day: "today",
      start: "19:00",
      end: "03:00",
      link: LINK,
      signOff: SIGN_OFF,
    },
  },
  {
    name: "shift_urgent_no_site",
    docName: "shift_urgent",
    category: "utility",
    language: "en_GB",
    variables: ["role", "day", "start", "end", "link", "signOff"],
    body: "URGENT: we need {{1}} {{2}} {{3}}–{{4}}. Tap to take it: {{5}}. — {{6}}",
    example: {
      role: "an usher",
      day: "tomorrow",
      start: "08:00",
      end: "16:00",
      link: LINK,
      signOff: SIGN_OFF,
    },
  },
  {
    name: "shift_reminder_24h",
    docName: "shift_reminder_24h",
    category: "utility",
    language: "en_GB",
    variables: ["day", "start", "end", "site", "link", "signOff"],
    body: "Reminder: {{1}} {{2}}–{{3}} at {{4}}. Details: {{5}}. Can't make it? Cancel in the app as early as you can. — {{6}}",
    example: {
      day: "tomorrow",
      start: "08:00",
      end: "16:00",
      site: "Riverside Arena",
      link: LINK,
      signOff: SIGN_OFF,
    },
  },
  {
    name: "shift_reminder_24h_no_site",
    docName: "shift_reminder_24h",
    category: "utility",
    language: "en_GB",
    variables: ["day", "start", "end", "link", "signOff"],
    body: "Reminder: {{1}} {{2}}–{{3}}. Details: {{4}}. Can't make it? Cancel in the app as early as you can. — {{5}}",
    example: { day: "tomorrow", start: "08:00", end: "16:00", link: LINK, signOff: SIGN_OFF },
  },
  {
    name: "shift_reminder_2h",
    docName: "shift_reminder_2h",
    category: "utility",
    language: "en_GB",
    variables: ["site", "start", "link", "signOff"],
    body: "Your shift at {{1}} starts at {{2}}. Meeting point and instructions: {{3}}. — {{4}}",
    example: { site: "Riverside Arena", start: "08:00", link: LINK, signOff: SIGN_OFF },
  },
  {
    name: "shift_reminder_2h_no_site",
    docName: "shift_reminder_2h",
    category: "utility",
    language: "en_GB",
    variables: ["start", "link", "signOff"],
    body: "Your shift starts at {{1}}. Meeting point and instructions: {{2}}. — {{3}}",
    example: { start: "08:00", link: LINK, signOff: SIGN_OFF },
  },
  {
    name: "shift_changed_by_firm",
    docName: "shift_changed_by_firm",
    category: "utility",
    language: "en_GB",
    variables: ["date", "site", "change", "start", "end", "link", "signOff"],
    body: "Change to your shift on {{1}} at {{2}}: {{3}}. New time: {{4}}–{{5}}. Details: {{6}}. — {{7}}",
    example: {
      date: "Sat 7 Nov",
      site: "Riverside Arena",
      change: "the times have changed",
      start: "10:00",
      end: "18:00",
      link: LINK,
      signOff: SIGN_OFF,
    },
  },
  {
    name: "shift_changed_by_firm_no_site",
    docName: "shift_changed_by_firm",
    category: "utility",
    language: "en_GB",
    variables: ["date", "change", "start", "end", "link", "signOff"],
    body: "Change to your shift on {{1}}: {{2}}. New time: {{3}}–{{4}}. Details: {{5}}. — {{6}}",
    example: {
      date: "Sat 7 Nov",
      change: "it's now shorter",
      start: "08:00",
      end: "14:00",
      link: LINK,
      signOff: SIGN_OFF,
    },
  },
  {
    name: "shift_cancelled_by_firm",
    docName: "shift_cancelled_by_firm",
    category: "utility",
    language: "en_GB",
    variables: ["date", "start", "end", "site", "link", "signOff"],
    body: "Your shift on {{1}} {{2}}–{{3}} at {{4}} has been cancelled by the office. Open shifts: {{5}}. — {{6}}",
    example: {
      date: "Sat 7 Nov",
      start: "08:00",
      end: "16:00",
      site: "Riverside Arena",
      link: "https://acme.shiftdesk.example/shifts/open",
      signOff: SIGN_OFF,
    },
  },
  {
    name: "shift_cancelled_by_firm_no_site",
    docName: "shift_cancelled_by_firm",
    category: "utility",
    language: "en_GB",
    variables: ["date", "start", "end", "link", "signOff"],
    body: "Your shift on {{1}} {{2}}–{{3}} has been cancelled by the office. Open shifts: {{4}}. — {{5}}",
    example: {
      date: "Sat 7 Nov",
      start: "08:00",
      end: "16:00",
      link: "https://acme.shiftdesk.example/shifts/open",
      signOff: SIGN_OFF,
    },
  },
  {
    name: "shift_confirmed",
    docName: "shift_confirmed",
    category: "utility",
    language: "en_GB",
    variables: ["date", "start", "end", "site", "roleName", "link", "signOff"],
    body: "Confirmed: {{1}} {{2}}–{{3}} at {{4}} ({{5}}). Details and instructions: {{6}}. — {{7}}",
    example: {
      date: "Sat 7 Nov",
      start: "08:00",
      end: "16:00",
      site: "Riverside Arena",
      roleName: "steward",
      link: LINK,
      signOff: SIGN_OFF,
    },
  },
  {
    name: "shift_confirmed_no_site",
    docName: "shift_confirmed",
    category: "utility",
    language: "en_GB",
    variables: ["date", "start", "end", "roleName", "link", "signOff"],
    body: "Confirmed: {{1}} {{2}}–{{3}} ({{4}}). Details and instructions: {{5}}. — {{6}}",
    example: {
      date: "Sat 7 Nov",
      start: "08:00",
      end: "16:00",
      roleName: "door supervisor",
      link: LINK,
      signOff: SIGN_OFF,
    },
  },
  {
    name: "request_update",
    docName: "request_update",
    category: "utility",
    language: "en_GB",
    variables: ["type", "ref", "status", "note", "signOff"],
    body: "Your request ({{1}}, ref {{2}}) is {{3}}. The office says: {{4}} — {{5}}",
    example: {
      type: "time change",
      ref: "3F2A9C1B",
      status: "approved",
      note: "See you at 13:00.",
      signOff: SIGN_OFF,
    },
  },
  {
    name: "request_update_no_note",
    docName: "request_update",
    category: "utility",
    language: "en_GB",
    variables: ["type", "ref", "status", "signOff"],
    body: "Your request ({{1}}, ref {{2}}) is {{3}}. — {{4}}",
    example: { type: "swap", ref: "3F2A9C1B", status: "declined", signOff: SIGN_OFF },
  },
  {
    name: "credential_expiring",
    docName: "credential_expiring",
    category: "utility",
    language: "en_GB",
    variables: ["credential", "date", "signOff"],
    body: "Your {{1}} expires on {{2}}. Renew it and send the new details to the office so you can keep taking shifts. — {{3}}",
    example: { credential: "SIA door supervisor licence", date: "Sat 7 Nov", signOff: SIGN_OFF },
  },
  {
    name: "credential_expired",
    docName: "credential_expired",
    category: "utility",
    language: "en_GB",
    variables: ["credential", "date", "signOff"],
    body: "Your {{1}} expired on {{2}}. You can't take shifts that need it until you renew it and send the new details to the office. — {{3}}",
    example: { credential: "SIA door supervisor licence", date: "Sat 7 Nov", signOff: SIGN_OFF },
  },
  {
    name: "pay_query_update",
    docName: "pay_query_update",
    category: "utility",
    language: "en_GB",
    variables: ["ref", "status", "note", "signOff"],
    body: "Update on your pay query (ref {{1}}): {{2}}. {{3}} — {{4}}",
    example: {
      ref: "3F2A9C1B",
      status: "sorted",
      note: "The new rate is now applied. The difference is paid on Fri 13 Nov.",
      signOff: SIGN_OFF,
    },
  },
  {
    name: "voicemail_received",
    docName: "voicemail_received",
    category: "utility",
    language: "en_GB",
    variables: ["ref", "signOff"],
    body: "Thanks for your voicemail. The office will see it and get back to you. Ref {{1}}. — {{2}}",
    example: { ref: "3F2A9C1B", signOff: SIGN_OFF },
  },
];

// The template's text with its {{n}} parts filled in from `values` (by variable name).
export function fillWhatsAppTemplate(
  template: WhatsAppTemplate,
  values: Readonly<Record<string, string>>,
): string {
  return template.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const name = template.variables[Number(n) - 1];
    const value = name === undefined ? undefined : values[name];
    if (value === undefined) throw new Error(`${template.name}: no value for {{${n}}}`);
    return value;
  });
}
