import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as templates from "@/lib/messaging/templates";
import {
  CALL_FALLBACK_END,
  callFallbackGreeting,
  callGreeting,
  credentialExpiredMessage,
  credentialExpiringMessage,
  credentialWeeklyListEmail,
  firmChangePush,
  loginCodeMessage,
  loginLinkMessage,
  offerPush,
  officeLoginLinkEmail,
  payDigestEmail,
  payQueryUpdateMessage,
  payQueryUpdatePush,
  reminderPush,
  requestUpdateMessage,
  requestUpdatePush,
  bookedPush,
  shiftCancelledByFirmMessage,
  shiftChangedByFirmMessage,
  shiftConfirmedMessage,
  shiftEscalationEmail,
  strikeEvidenceEmail,
  strikesEmailConfirmEmail,
  shiftOfferMessage,
  shiftOfferSms,
  shiftReminder24hMessage,
  shiftReminder2hMessage,
  shiftsLineReply,
  shiftUrgentMessage,
  shiftUrgentSms,
  unknownNumberAlertEmail,
  smsStartedMessage,
  smsStoppedMessage,
  unknownNumberMessage,
  urgentPush,
  voicemailReceivedMessage,
} from "@/lib/messaging/templates";
import { TEXTS_OFF } from "@/app/profile/profile-view";
import { fillWhatsAppTemplate, WHATSAPP_TEMPLATES } from "@/lib/messaging/whatsapp-templates";

// All copy from docs/messaging-templates.md (Phase 4). Every message the code builds is checked
// against the doc's wording: the WhatsApp templates, the SMS versions, the pushes and the office
// emails. Each template function is rendered with the doc's {placeholders} as its values and must
// give the doc's text. Every function templates.ts exports must be listed here, so a new message
// can't skip the doc. The doc's templates the code doesn't send yet are listed by name.
//
// Then the WhatsApp submission pack (src/lib/messaging/whatsapp-templates.ts): each template
// function, with the pack's sample values, gives exactly the pack's template filled in. What we
// send is what we'd submit to Meta.

const doc = readFileSync("docs/messaging-templates.md", "utf8");
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

// The WhatsApp/email templates table: name -> the body in its first pair of double quotes.
function docTemplates(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of doc.split("\n")) {
    const m = /^\| `([a-z0-9_]+)` \| [^|]+ \| (?:Subject "[^"]*"\. Body: )?"([^"]+)"/.exec(line);
    if (m?.[1] && m[2]) rows.set(m[1], m[2]);
  }
  return rows;
}

// A doc section's text (from its heading to the next), on one line.
function section(heading: string): string {
  const start = doc.indexOf(`## ${heading}`);
  const end = doc.indexOf("\n## ", start + 1);
  return oneLine(doc.slice(start, end === -1 ? undefined : end));
}

// The quoted strings of the bullet starting with `lead` in a section, in order. The bullet ends at
// the next " - " outside quotes (a quote can hold " - ", as the SMS sign-off does).
function quotes(sectionText: string, lead: string): string[] {
  const start = sectionText.indexOf(`- ${lead}`);
  let end = sectionText.length;
  let inQuote = false;
  for (let i = start + 2; i < sectionText.length; i++) {
    if (sectionText[i] === '"') inQuote = !inQuote;
    else if (!inQuote && sectionText.startsWith(" - ", i)) {
      end = i;
      break;
    }
  }
  const bullet = sectionText.slice(start, end);
  return [...bullet.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

// The doc writes the sign-off as "{firm} Shift Team".
const docVoice = { name: "{firm}", signOff: "{firm} Shift Team" };
// Words only, for emails (their line breaks and blank lines aren't in the doc's one-line copy).
const words = (text: string) => text.match(/[\p{L}\p{N}'{}()]+/gu) ?? [];

const TEMPLATES = docTemplates();
const docBody = (name: string) => {
  const body = TEMPLATES.get(name);
  if (!body) throw new Error(`docs/messaging-templates.md has no template ${name}`);
  return body;
};

describe("the doc's templates table", () => {
  it("is read: the templates are all there", () => {
    expect([...TEMPLATES.keys()]).toEqual([
      "login_link",
      "login_code",
      "office_login_link",
      "shift_offer",
      "shift_urgent",
      "shift_filled",
      "shift_confirmed",
      "shift_reminder_24h",
      "shift_reminder_2h",
      "cancellation_ack",
      "shift_changed_by_firm",
      "shift_cancelled_by_firm",
      "request_update",
      "credential_expiring",
      "credential_expired",
      "pay_query_update",
      "voicemail_received",
      "unknown_number",
    ]);
  });

  // Each doc template is built (below) or waiting for its task. A new doc template must be added
  // to one list or the other.
  const BUILT = [
    "login_link",
    "login_code",
    "office_login_link",
    "shift_offer",
    "shift_urgent",
    "shift_reminder_24h",
    "shift_reminder_2h",
    "credential_expiring",
    "credential_expired",
    "shift_changed_by_firm",
    "shift_cancelled_by_firm",
    "shift_confirmed",
    "request_update",
    "pay_query_update",
    "voicemail_received",
    "unknown_number",
  ];
  const NOT_BUILT: Record<string, string> = {
    shift_filled: "a reply to an offer: inbound WhatsApp (Phase 7)",
    cancellation_ack: "cancellation confirmations are on screen; by message with notify (parked)",
  };
  it("every template is built or waiting for a named task", () => {
    expect([...TEMPLATES.keys()].sort()).toEqual([...BUILT, ...Object.keys(NOT_BUILT)].sort());
  });
});

describe("the code says what the doc says", () => {
  it("login_link and login_code", () => {
    expect(loginLinkMessage(docVoice, "{link}")).toBe(docBody("login_link"));
    expect(loginCodeMessage(docVoice, "{code}")).toBe(docBody("login_code"));
  });

  it("shift_offer, with and without a site", () => {
    const shift = {
      role: "{role}",
      site: "{site}",
      date: "{date}",
      start: "{start}",
      end: "{end}",
      link: "{link}",
    };
    expect(shiftOfferMessage(docVoice, shift)).toBe(docBody("shift_offer"));
    expect(shiftOfferMessage(docVoice, { ...shift, site: null })).toBe(
      docBody("shift_offer").replace(" at {site}", ""),
    );
  });

  it("shift_changed_by_firm and shift_cancelled_by_firm, with and without a site", () => {
    const changed = {
      date: "{date}",
      site: "{site}",
      change: "{change}",
      start: "{start}",
      end: "{end}",
      link: "{link}",
    };
    expect(shiftChangedByFirmMessage(docVoice, changed)).toBe(docBody("shift_changed_by_firm"));
    expect(shiftChangedByFirmMessage(docVoice, { ...changed, site: null })).toBe(
      docBody("shift_changed_by_firm").replace(" at {site}", ""),
    );
    const cancelled = {
      date: "{date}",
      site: "{site}",
      start: "{start}",
      end: "{end}",
      link: "{link}",
    };
    expect(shiftCancelledByFirmMessage(docVoice, cancelled)).toBe(
      docBody("shift_cancelled_by_firm"),
    );
    expect(shiftCancelledByFirmMessage(docVoice, { ...cancelled, site: null })).toBe(
      docBody("shift_cancelled_by_firm").replace(" at {site}", ""),
    );
  });

  it("shift_confirmed, with and without a site", () => {
    const shift = {
      role: "{role}",
      site: "{site}",
      date: "{date}",
      start: "{start}",
      end: "{end}",
      link: "{link}",
    };
    expect(shiftConfirmedMessage(docVoice, shift)).toBe(docBody("shift_confirmed"));
    expect(shiftConfirmedMessage(docVoice, { ...shift, site: null })).toBe(
      docBody("shift_confirmed").replace(" at {site}", ""),
    );
  });

  it("request_update, with and without the office's note", () => {
    const request = { type: "{type}", ref: "{ref}", status: "{status}", note: "{note}" };
    expect(requestUpdateMessage(docVoice, request)).toBe(docBody("request_update"));
    expect(requestUpdateMessage(docVoice, { ...request, note: null })).toBe(
      docBody("request_update").replace(" The office says: {note}", ""),
    );
  });

  it("the call-to-text recording, as the doc says it, and its no-link versions", () => {
    const section = doc.slice(
      doc.indexOf("## Call-to-text recording (voice)"),
      doc.indexOf("\n## ", doc.indexOf("## Call-to-text recording (voice)") + 1),
    );
    const [spoken, withheld, notNow, goodbye, notInUse] = [...section.matchAll(/"([^"]+)"/g)].map(
      (m) => oneLine(m[1] ?? ""),
    );
    expect(callGreeting(docVoice, "sent")).toBe(spoken);
    expect(callGreeting(docVoice, "withheld")).toBe(withheld);
    expect(callGreeting(docVoice, "not_now")).toBe(notNow);
    expect([goodbye, notInUse]).toEqual([
      "Thank you. Goodbye.",
      "Sorry, this number isn't in use.",
    ]);
  });

  it("sms_stopped and sms_started (text only: a plain hyphen), and the profile's texts-off note", () => {
    const stop = section("STOP and START by text");
    expect(smsStoppedMessage(docVoice)).toBe(quotes(stop, "`sms_stopped`:")[0]);
    expect(smsStartedMessage(docVoice)).toBe(quotes(stop, "`sms_started`:")[0]);
    expect(stop).toContain(`"${TEXTS_OFF}"`);
  });

  it("the call fallback (Twilio's, when our app doesn't answer), as the doc says it", () => {
    const voice = section("Call-to-text recording (voice)");
    const quoted = [...voice.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(quoted).toContain(callFallbackGreeting(docVoice));
    expect(quoted).toContain(CALL_FALLBACK_END);
  });

  it("voicemail_received", () => {
    expect(voicemailReceivedMessage(docVoice, "{ref}")).toBe(docBody("voicemail_received"));
  });

  it("unknown_number, and the office's alert email (subject, and the body's words)", () => {
    expect(unknownNumberMessage(docVoice)).toBe(docBody("unknown_number"));
    const office = section("Office notifications");
    const [subject, first, asked, notReplied, see, signOff] = quotes(
      office,
      "`unknown_number_alert`",
    );
    // Asked for their name (a WhatsApp from a number nobody has, and it went), or not.
    const email = unknownNumberAlertEmail(docVoice, "{link}", { askedName: true });
    expect(email.subject).toBe(subject);
    expect(words(email.body)).toEqual(words([first, asked, see, signOff].join(" ")));
    expect(words(unknownNumberAlertEmail(docVoice, "{link}", { askedName: false }).body)).toEqual(
      words([first, notReplied, see, signOff].join(" ")),
    );
  });

  it("the shifts line's instant replies: each row's words, signed", () => {
    const table = doc.slice(
      doc.indexOf("## Instant replies on the shifts line"),
      doc.indexOf("\n## ", doc.indexOf("## Instant replies on the shifts line") + 1),
    );
    const replyFor = (keyword: string) => {
      const row = table.split("\n").find((l) => l.startsWith(`| "${keyword}"`)) ?? "";
      return /^\|[^|]*\| "([^"]+)"/.exec(row)?.[1];
    };
    const signed = (text: string | undefined) => `${text} — {firm} Shift Team`;
    for (const intent of ["shifts", "cancel", "pay"] as const) {
      expect(shiftsLineReply(docVoice, { intent, link: "{link}" })).toBe(signed(replyFor(intent)));
    }
    expect(shiftsLineReply(docVoice, { intent: "office", ref: "{ref}" })).toBe(
      signed(replyFor("help")),
    );
  });

  it("pay_query_update: payroll's note in the doc's words", () => {
    expect(
      payQueryUpdateMessage(docVoice, { ref: "{ref}", status: "{status}", note: "{note}" }),
    ).toBe(docBody("pay_query_update"));
  });

  it("shift_urgent, with and without a site", () => {
    const shift = {
      role: "{role}",
      site: "{site}",
      day: "{day}",
      start: "{start}",
      end: "{end}",
      link: "{link}",
    };
    expect(shiftUrgentMessage(docVoice, shift)).toBe(docBody("shift_urgent"));
    expect(shiftUrgentMessage(docVoice, { ...shift, site: null })).toBe(
      docBody("shift_urgent").replace(" at {site}", ""),
    );
  });

  it("shift_reminder_24h and shift_reminder_2h, with and without a site", () => {
    const shift = { site: "{site}", day: "{day}", start: "{start}", end: "{end}", link: "{link}" };
    expect(shiftReminder24hMessage(docVoice, shift)).toBe(docBody("shift_reminder_24h"));
    expect(shiftReminder24hMessage(docVoice, { ...shift, site: null })).toBe(
      docBody("shift_reminder_24h").replace(" at {site}", ""),
    );
    expect(shiftReminder2hMessage(docVoice, shift)).toBe(docBody("shift_reminder_2h"));
    expect(shiftReminder2hMessage(docVoice, { ...shift, site: null })).toBe(
      docBody("shift_reminder_2h").replace(" at {site}", ""),
    );
  });

  it("credential_expiring and credential_expired, with the upload page's link (12F.2)", () => {
    expect(credentialExpiringMessage(docVoice, "{credential}", "{date}", "{link}")).toBe(
      docBody("credential_expiring"),
    );
    expect(credentialExpiredMessage(docVoice, "{credential}", "{date}", "{link}")).toBe(
      docBody("credential_expired"),
    );
    // The screen copy is My shifts' "Needs updating" card (12F.1), not a message: the doc says so
    // and points to its words; its rows lead to the same upload page.
    const screen = doc.split("\n").find((l) => l.startsWith("| (screen only: My shifts"));
    expect(screen).toContain("Needs updating");
    expect(screen).toContain("needsText()");
    expect(screen).toContain("Upload it");
  });

  it("office_login_link (email): the subject, and the body's words", () => {
    const row = doc.split("\n").find((l) => l.startsWith("| `office_login_link`")) ?? "";
    const subject = /Subject "([^"]+)"/.exec(row)?.[1];
    const email = officeLoginLinkEmail(docVoice, "{link}");
    expect(email.subject).toBe(subject);
    expect(words(email.body)).toEqual(words(docBody("office_login_link")));
  });

  it("shift_escalation (email): the subject, and the body's words", () => {
    const office = section("Office notifications");
    const [subject, ...body] = quotes(office, "Escalation");
    const email = shiftEscalationEmail(docVoice, {
      role: "{role}",
      site: "{site}",
      when: "{when}",
      freePlaces: 2,
      offersSent: 3,
      link: "{link}",
    });
    expect(email.subject).toBe(
      (subject ?? "").replace("{Role}", "{role}").replace("{Sat 7 Nov, 08:00 to 16:00}", "{when}"),
    );
    const expected = body
      .join(" ")
      .replace("{n place(s)}", "2 places")
      .replace("{k offer(s)}", "3 offers")
      .replace("place(s)", "places");
    expect(words(email.body)).toEqual(words(expected));
  });

  it("strikes_email_confirm (email): the subject, and the body's words", () => {
    const [subject, ...body] = quotes(section("Office notifications"), "Strikes team confirmation");
    const email = strikesEmailConfirmEmail(docVoice, "{link}");
    expect(email.subject).toBe(subject);
    expect(words(email.body)).toEqual(words(body.join(" ")));
  });

  it("strike_evidence (email): the subject, and the body's words", () => {
    const [subject, ...body] = quotes(section("Office notifications"), "Strike evidence");
    const email = strikeEvidenceEmail(docVoice, {
      casual: "{casual}",
      staffId: "{staff id}",
      role: "{role}",
      site: "{site}",
      notice: "{notice}",
      ref: "{ref}",
      session: "{session}",
      cancelledAt: "{when}",
      beforeStart: "{hours}",
      thresholdHours: "{threshold}",
      strikeNumber: "{n}",
      liveDays: "{days}",
      link: "{link}",
    });
    expect(email.subject).toBe(subject);
    // The bullet's quotes after the subject: " at {site}" (left out without a site), the body's
    // four, " (staff id …)" (left out without one), then the PDF's reason.
    expect(words(email.body)).toEqual(words(body.slice(1, 5).join(" ")));
    expect(body[0]).toBe(" at {site}");
    expect(body.at(-1)).toBe("Casual's own reason (see ShiftDesk)");
  });

  it("credential_weekly_list (email): the subject, and the body's words", () => {
    const office = section("Office notifications");
    const q = quotes(office, "`credential_weekly_list`");
    const entry = { person: "{name}", credential: "{credential}", date: "{date}" };
    const email = credentialWeeklyListEmail(docVoice, [entry], [entry]);
    expect(email.subject).toBe(q[0]);
    // The doc's quotes in order, without "- and {n} more" (only past 40 lines).
    const expected = q.slice(1).filter((t) => !t.startsWith("- and"));
    expect(words(email.body)).toEqual(words(expected.join(" ")));
  });

  it("pay_digest (email): the subject, the body's words, and each headline", () => {
    const office = section("Office notifications");
    const [subject, mixed, allAlike, allDifferent, justOne, grouped, line, more, ai, ...rest] =
      quotes(office, "`pay_digest`");
    const [earlier, later, attached, link, signOff] = rest;
    const content = {
      total: 5,
      biggest: { count: 3, facts: "{facts}" },
      groups: [{ heading: "{k queries}: {facts}.", aiLine: "{line}" }],
      earlier: 2,
      later: 4,
      filename: "{filename}",
      link: "{link}",
    };
    const email = payDigestEmail(docVoice, content);
    expect(email.subject).toBe((subject ?? "").replace("{n}", "5"));
    const n = (text: string | undefined, value: number) => (text ?? "").replace("{n}", `${value}`);
    const expected = [
      n(mixed, 5).replace("{k}", "3"),
      grouped,
      line,
      ai,
      n(earlier, 2),
      n(later, 4),
      attached,
      link,
      signOff,
    ];
    expect(words(email.body)).toEqual(words(expected.join(" ")));
    const headline = (d: Partial<typeof content>) =>
      payDigestEmail(docVoice, { ...content, ...d }).body.split("\n")[0];
    expect(headline({ biggest: { count: 5, facts: "{facts}" } })).toBe(n(allAlike, 5));
    expect(headline({ biggest: { count: 1, facts: "{facts}" } })).toBe(n(allDifferent, 5));
    expect(headline({ total: 1, biggest: { count: 1, facts: "{facts}" } })).toBe(justOne);
    const many = Array.from(
      { length: 32 },
      () => content.groups[0] ?? { heading: "", aiLine: null },
    );
    expect(payDigestEmail(docVoice, { ...content, groups: many }).body).toContain(n(more, 2));
  });
});

describe("the SMS versions", () => {
  const sms = section("SMS (fallback only, keep under 160 characters)");

  it("the urgent offer says what the doc says, with and without a site", () => {
    const [text] = quotes(sms, "Urgent:");
    const shift = {
      role: "{role}",
      site: "{site}",
      day: "{day}",
      start: "{start}",
      link: "{link}",
    };
    expect(shiftUrgentSms(docVoice, shift)).toBe(text);
    expect(shiftUrgentSms(docVoice, { ...shift, site: null })).toBe(
      (text ?? "").replace(" {site}", ""),
    );
  });

  it("the office's offer says what the doc says, with and without a site", () => {
    const [text] = quotes(sms, "Offer:");
    const shift = { site: "{site}", date: "{date}", start: "{start}", link: "{link}" };
    expect(shiftOfferSms(docVoice, shift)).toBe(text);
    expect(shiftOfferSms(docVoice, { ...shift, site: null })).toBe(
      (text ?? "").replace(" at {site}", ""),
    );
    const real = shiftOfferSms(demo, {
      site: "Acme Demo Arena",
      date: "Sat 7 Nov",
      start: "08:00",
      link,
    });
    expect(Number.isFinite(gsmLength(real))).toBe(true);
    expect(parts(real)).toBe(2); // with the sign-off: parked for Dylan (the doc says under 160)
  });

  // GSM 03.38: the characters one standard text message can carry (anything else, like a dash,
  // makes the whole message a smaller, dearer kind). Basic set plus the escaped extension table.
  const GSM =
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
  const EXTENDED = "^{}\\[~]|€";
  const gsmLength = (text: string) =>
    [...text].reduce((n, ch) => {
      if (GSM.includes(ch)) return n + 1;
      if (EXTENDED.includes(ch)) return n + 2;
      return Number.POSITIVE_INFINITY;
    }, 0);

  // Characters in one text: 160 standard, or 153 per part when it takes more than one; with any
  // other character, 70 (67 per part).
  const parts = (text: string) => {
    const gsm = gsmLength(text);
    if (Number.isFinite(gsm)) return gsm <= 160 ? 1 : Math.ceil(gsm / 153);
    const n = [...text].length;
    return n <= 70 ? 1 : Math.ceil(n / 67);
  };
  const demo = { name: "Acme Events", signOff: "Acme Events Shift Team" };
  const link = "https://acme.shiftdesk.example/shifts/3f2a9c1e-5b7d-4e8a-9f0b-1c2d3e4f5a6b";

  it("uses only standard text characters, and costs fewer texts than the WhatsApp wording", () => {
    const shift = { role: "door_supervisor", site: "Acme Demo Arena", day: "on Sat 7 Nov" };
    const text = shiftUrgentSms(demo, { ...shift, start: "08:00", link });
    expect(Number.isFinite(gsmLength(text))).toBe(true);
    expect(parts(text)).toBe(2);
    const whatsapp = shiftUrgentMessage(demo, { ...shift, start: "08:00", end: "16:00", link });
    expect(Number.isFinite(gsmLength(whatsapp))).toBe(false); // its dashes
    expect(parts(whatsapp)).toBe(3);
  });

  it("a firm's own sign-off, after a plain hyphen", () => {
    const text = shiftUrgentSms(
      { name: "Acme Events", signOff: "Acme Rota Desk" },
      { role: "steward", site: null, day: "today", start: "08:00", link },
    );
    expect(text.endsWith(" - Acme Rota Desk")).toBe(true);
  });
});

describe("every message to a worker ends with the firm's sign-off (golden rule 8)", () => {
  const voice = { name: "Acme Events", signOff: "Acme Rota Desk" };
  const shift = { role: "steward", site: "Arena", day: "today", start: "08:00", end: "16:00" };
  it.each([
    ["login_link", loginLinkMessage(voice, "L")],
    ["login_code", loginCodeMessage(voice, "123456")],
    [
      "request_update",
      requestUpdateMessage(voice, { type: "swap", ref: "R", status: "declined", note: "No." }),
    ],
    [
      "request_update (no note)",
      requestUpdateMessage(voice, { type: "swap", ref: "R", status: "approved", note: null }),
    ],
    [
      "pay_query_update",
      payQueryUpdateMessage(voice, { ref: "R", status: "sorted", note: "Paid on Friday." }),
    ],
    [
      "shift_changed_by_firm",
      shiftChangedByFirmMessage(voice, { ...shift, date: "Sat 7 Nov", change: "c", link: "L" }),
    ],
    [
      "shift_cancelled_by_firm",
      shiftCancelledByFirmMessage(voice, { ...shift, date: "Sat 7 Nov", link: "L" }),
    ],
    ["shift_offer", shiftOfferMessage(voice, { ...shift, date: "Sat 7 Nov", link: "L" })],
    ["shift_confirmed", shiftConfirmedMessage(voice, { ...shift, date: "Sat 7 Nov", link: "L" })],
    ["shift_offer (SMS)", shiftOfferSms(voice, { ...shift, date: "Sat 7 Nov", link: "L" })],
    ["shift_urgent", shiftUrgentMessage(voice, { ...shift, link: "L" })],
    ["shift_urgent (SMS)", shiftUrgentSms(voice, { ...shift, link: "L" })],
    ["shift_reminder_24h", shiftReminder24hMessage(voice, { ...shift, link: "L" })],
    ["shift_reminder_2h", shiftReminder2hMessage(voice, { ...shift, link: "L" })],
    ["credential_expiring", credentialExpiringMessage(voice, "PTS card", "3 Oct", "L")],
    ["credential_expired", credentialExpiredMessage(voice, "PTS card", "3 Oct", "L")],
    ["office_login_link", officeLoginLinkEmail(voice, "L").body],
    ["voicemail_received", voicemailReceivedMessage(voice, "R")],
    ["sms_stopped", smsStoppedMessage(voice)],
    ["sms_started", smsStartedMessage(voice)],
  ])("%s", (_name, text) => {
    expect(text).toMatch(/\s[—-] Acme Rota Desk$/);
  });
});

describe("the pushes", () => {
  const push = section("Push (title / body)");

  it("the office's offer", () => {
    const [title, body] = quotes(push, "Offer:");
    expect(offerPush({ site: "{site}", date: "{date}", start: "{start}" })).toEqual({
      title,
      body,
    });
  });

  it("urgent", () => {
    const [title, body] = quotes(push, "Urgent:");
    expect(urgentPush({ role: "{Role}", site: "{site}", day: "{day}", start: "{start}" })).toEqual({
      title,
      body,
    });
  });

  it("the office changed or cancelled a shift", () => {
    const [t1, b1, t2, b2] = quotes(push, "Shift changed:");
    expect(firmChangePush({ kind: "changed", date: "{date}", change: "{change}" })).toEqual({
      title: t1,
      body: b1,
    });
    expect(firmChangePush({ kind: "cancelled", date: "{date}", start: "{start}" })).toEqual({
      title: t2,
      body: b2,
    });
  });

  it("the office booked them", () => {
    const [title, body] = quotes(push, "Booked:");
    expect(bookedPush({ site: "{site}", date: "{date}", start: "{start}" })).toEqual({
      title,
      body,
    });
  });

  it("request update", () => {
    const [title, body] = quotes(push, "Request update:");
    expect(requestUpdatePush({ type: "{type}", status: "{status}" })).toEqual({ title, body });
    const [payTitle, payBody] = quotes(push, "Pay query update:");
    expect(payQueryUpdatePush()).toEqual({ title: payTitle, body: payBody });
  });

  it("reminder, 24 h and 2 h", () => {
    const [title24, body24, title2, body2] = quotes(push, "Reminder:");
    expect(
      reminderPush({
        kind: "24h",
        site: "{site}",
        day: "tomorrow",
        start: "{start}",
        end: "{end}",
      }),
    ).toEqual({ title: title24, body: body24 });
    expect(
      reminderPush({ kind: "2h", site: "{site}", day: "today", start: "{start}", end: "{end}" }),
    ).toEqual({ title: title2, body: body2 });
  });
});

describe("every template function is checked here", () => {
  it("templates.ts exports no message this file doesn't check", () => {
    const functions = Object.entries(templates)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();
    expect(functions).toEqual(
      [
        "callFallbackGreeting",
        "callGreeting",
        "credentialExpiredMessage",
        "credentialExpiringMessage",
        "credentialWeeklyListEmail",
        "bookedPush",
        "changeWords",
        "firmChangePush",
        "loginCodeMessage",
        "loginLinkMessage",
        "offerPush",
        "officeLoginLinkEmail",
        "payDigestEmail",
        "payQueryUpdateMessage",
        "payQueryUpdatePush",
        "reminderPush",
        "requestUpdateMessage",
        "requestUpdatePush",
        "shiftCancelledByFirmMessage",
        "shiftChangedByFirmMessage",
        "shiftConfirmedMessage",
        "shiftEscalationEmail",
        "strikeEvidenceEmail",
        "strikesEmailConfirmEmail",
        "shiftOfferMessage",
        "shiftOfferSms",
        "shiftReminder24hMessage",
        "shiftsLineReply",
        "shiftReminder2hMessage",
        "shiftUrgentMessage",
        "shiftUrgentSms",
        "unknownNumberAlertEmail",
        "unknownNumberMessage",
        "smsStartedMessage",
        "smsStoppedMessage",
        "urgentPush",
        "voicemailReceivedMessage",
      ].sort(),
    );
  });
});

describe("the WhatsApp submission pack", () => {
  const pack = (name: string) => {
    const t = WHATSAPP_TEMPLATES.find((x) => x.name === name);
    if (!t) throw new Error(`no pack template ${name}`);
    return t;
  };
  const ex = (name: string, key: string) => pack(name).example[key] ?? "";
  const voice = (name: string) => ({ name: "Acme Events", signOff: ex(name, "signOff") });
  const roleOf = (withArticle: string) => withArticle.replace(/^an? /, "").replace(/ /g, "_");

  // What the code sends by WhatsApp, given the pack's sample values.
  const SENT: Record<string, () => string> = {
    shift_changed_by_firm: () =>
      shiftChangedByFirmMessage(voice("shift_changed_by_firm"), {
        date: ex("shift_changed_by_firm", "date"),
        site: ex("shift_changed_by_firm", "site"),
        change: ex("shift_changed_by_firm", "change"),
        start: ex("shift_changed_by_firm", "start"),
        end: ex("shift_changed_by_firm", "end"),
        link: ex("shift_changed_by_firm", "link"),
      }),
    shift_changed_by_firm_no_site: () =>
      shiftChangedByFirmMessage(voice("shift_changed_by_firm_no_site"), {
        date: ex("shift_changed_by_firm_no_site", "date"),
        site: null,
        change: ex("shift_changed_by_firm_no_site", "change"),
        start: ex("shift_changed_by_firm_no_site", "start"),
        end: ex("shift_changed_by_firm_no_site", "end"),
        link: ex("shift_changed_by_firm_no_site", "link"),
      }),
    shift_cancelled_by_firm: () =>
      shiftCancelledByFirmMessage(voice("shift_cancelled_by_firm"), {
        date: ex("shift_cancelled_by_firm", "date"),
        site: ex("shift_cancelled_by_firm", "site"),
        start: ex("shift_cancelled_by_firm", "start"),
        end: ex("shift_cancelled_by_firm", "end"),
        link: ex("shift_cancelled_by_firm", "link"),
      }),
    shift_cancelled_by_firm_no_site: () =>
      shiftCancelledByFirmMessage(voice("shift_cancelled_by_firm_no_site"), {
        date: ex("shift_cancelled_by_firm_no_site", "date"),
        site: null,
        start: ex("shift_cancelled_by_firm_no_site", "start"),
        end: ex("shift_cancelled_by_firm_no_site", "end"),
        link: ex("shift_cancelled_by_firm_no_site", "link"),
      }),
    shift_offer: () =>
      shiftOfferMessage(voice("shift_offer"), {
        role: ex("shift_offer", "roleName").replace(/ /g, "_"),
        site: ex("shift_offer", "site"),
        date: ex("shift_offer", "date"),
        start: ex("shift_offer", "start"),
        end: ex("shift_offer", "end"),
        link: ex("shift_offer", "link"),
      }),
    shift_confirmed: () =>
      shiftConfirmedMessage(voice("shift_confirmed"), {
        role: ex("shift_confirmed", "roleName").replace(/ /g, "_"),
        site: ex("shift_confirmed", "site"),
        date: ex("shift_confirmed", "date"),
        start: ex("shift_confirmed", "start"),
        end: ex("shift_confirmed", "end"),
        link: ex("shift_confirmed", "link"),
      }),
    shift_confirmed_no_site: () =>
      shiftConfirmedMessage(voice("shift_confirmed_no_site"), {
        role: ex("shift_confirmed_no_site", "roleName").replace(/ /g, "_"),
        site: null,
        date: ex("shift_confirmed_no_site", "date"),
        start: ex("shift_confirmed_no_site", "start"),
        end: ex("shift_confirmed_no_site", "end"),
        link: ex("shift_confirmed_no_site", "link"),
      }),
    shift_offer_no_site: () =>
      shiftOfferMessage(voice("shift_offer_no_site"), {
        role: ex("shift_offer_no_site", "roleName").replace(/ /g, "_"),
        site: null,
        date: ex("shift_offer_no_site", "date"),
        start: ex("shift_offer_no_site", "start"),
        end: ex("shift_offer_no_site", "end"),
        link: ex("shift_offer_no_site", "link"),
      }),
    login_link: () =>
      loginLinkMessage(
        { name: ex("login_link", "firm"), signOff: ex("login_link", "signOff") },
        ex("login_link", "link"),
      ),
    login_code: () =>
      loginCodeMessage(
        { name: ex("login_code", "firm"), signOff: ex("login_code", "signOff") },
        ex("login_code", "code"),
      ),
    shift_urgent: () =>
      shiftUrgentMessage(voice("shift_urgent"), {
        role: roleOf(ex("shift_urgent", "role")),
        site: ex("shift_urgent", "site"),
        day: ex("shift_urgent", "day"),
        start: ex("shift_urgent", "start"),
        end: ex("shift_urgent", "end"),
        link: ex("shift_urgent", "link"),
      }),
    shift_urgent_no_site: () =>
      shiftUrgentMessage(voice("shift_urgent_no_site"), {
        role: roleOf(ex("shift_urgent_no_site", "role")),
        site: null,
        day: ex("shift_urgent_no_site", "day"),
        start: ex("shift_urgent_no_site", "start"),
        end: ex("shift_urgent_no_site", "end"),
        link: ex("shift_urgent_no_site", "link"),
      }),
    shift_reminder_24h: () =>
      shiftReminder24hMessage(voice("shift_reminder_24h"), {
        site: ex("shift_reminder_24h", "site"),
        day: ex("shift_reminder_24h", "day"),
        start: ex("shift_reminder_24h", "start"),
        end: ex("shift_reminder_24h", "end"),
        link: ex("shift_reminder_24h", "link"),
      }),
    shift_reminder_24h_no_site: () =>
      shiftReminder24hMessage(voice("shift_reminder_24h_no_site"), {
        site: null,
        day: ex("shift_reminder_24h_no_site", "day"),
        start: ex("shift_reminder_24h_no_site", "start"),
        end: ex("shift_reminder_24h_no_site", "end"),
        link: ex("shift_reminder_24h_no_site", "link"),
      }),
    shift_reminder_2h: () =>
      shiftReminder2hMessage(voice("shift_reminder_2h"), {
        site: ex("shift_reminder_2h", "site"),
        start: ex("shift_reminder_2h", "start"),
        link: ex("shift_reminder_2h", "link"),
      }),
    shift_reminder_2h_no_site: () =>
      shiftReminder2hMessage(voice("shift_reminder_2h_no_site"), {
        site: null,
        start: ex("shift_reminder_2h_no_site", "start"),
        link: ex("shift_reminder_2h_no_site", "link"),
      }),
    credential_expiring: () =>
      credentialExpiringMessage(
        voice("credential_expiring"),
        ex("credential_expiring", "credential"),
        ex("credential_expiring", "date"),
        ex("credential_expiring", "link"),
      ),
    credential_expired: () =>
      credentialExpiredMessage(
        voice("credential_expired"),
        ex("credential_expired", "credential"),
        ex("credential_expired", "date"),
        ex("credential_expired", "link"),
      ),
    request_update: () =>
      requestUpdateMessage(voice("request_update"), {
        type: ex("request_update", "type"),
        ref: ex("request_update", "ref"),
        status: ex("request_update", "status"),
        note: ex("request_update", "note"),
      }),
    pay_query_update: () =>
      payQueryUpdateMessage(voice("pay_query_update"), {
        ref: ex("pay_query_update", "ref"),
        status: ex("pay_query_update", "status"),
        note: ex("pay_query_update", "note"),
      }),
    voicemail_received: () =>
      voicemailReceivedMessage(voice("voicemail_received"), ex("voicemail_received", "ref")),
    request_update_no_note: () =>
      requestUpdateMessage(voice("request_update_no_note"), {
        type: ex("request_update_no_note", "type"),
        ref: ex("request_update_no_note", "ref"),
        status: ex("request_update_no_note", "status"),
        note: null,
      }),
  };

  it("has a template for every message the code sends by WhatsApp, and no others", () => {
    expect(WHATSAPP_TEMPLATES.map((t) => t.name).sort()).toEqual(Object.keys(SENT).sort());
  });

  it.each(WHATSAPP_TEMPLATES.map((t) => [t.name]))(
    "%s: the code, with the sample values, sends exactly the template filled in",
    (name) => {
      const t = pack(name);
      expect(SENT[name]?.()).toBe(fillWhatsAppTemplate(t, t.example));
    },
  );

  it.each(WHATSAPP_TEMPLATES.map((t) => [t.name]))(
    "%s: well formed (names, numbering, a sample for every variable, the doc's template)",
    (name) => {
      const t = pack(name);
      expect(t.name).toMatch(/^[a-z0-9_]{1,512}$/);
      const numbers = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(numbers).toEqual(t.variables.map((_, i) => i + 1));
      expect(Object.keys(t.example).sort()).toEqual([...t.variables].sort());
      expect(TEMPLATES.has(t.docName)).toBe(true);
      expect(t.body.length).toBeLessThanOrEqual(1024);
    },
  );

  it("each template is the doc's wording (a no-site variant without 'at {site}', a no-note one without the note)", () => {
    const placeholder: Record<string, string> = {
      firm: "{firm}",
      signOff: "{firm} Shift Team",
      role: "a {role}",
      roleName: "{role}",
    };
    for (const t of WHATSAPP_TEMPLATES) {
      const values = Object.fromEntries(t.variables.map((v) => [v, placeholder[v] ?? `{${v}}`]));
      const expected = t.name.endsWith("_no_site")
        ? docBody(t.docName).replace(" at {site}", "")
        : t.name.endsWith("_no_note")
          ? docBody(t.docName).replace(" The office says: {note}", "")
          : docBody(t.docName);
      expect(fillWhatsAppTemplate(t, values), t.name).toBe(expected);
    }
  });

  it("filling in refuses a template with a value missing", () => {
    expect(() => fillWhatsAppTemplate(pack("login_code"), { firm: "Acme" })).toThrow(
      "login_code: no value for {{2}}",
    );
  });
});
