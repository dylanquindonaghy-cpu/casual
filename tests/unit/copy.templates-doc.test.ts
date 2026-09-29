import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as templates from "@/lib/messaging/templates";
import {
  credentialExpiredMessage,
  credentialExpiringMessage,
  credentialMarkedExpiredMessage,
  credentialWeeklyListEmail,
  loginCodeMessage,
  loginLinkMessage,
  officeLoginLinkEmail,
  reminderPush,
  shiftEscalationEmail,
  shiftReminder24hMessage,
  shiftReminder2hMessage,
  shiftUrgentMessage,
  shiftUrgentSms,
  urgentPush,
} from "@/lib/messaging/templates";
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
      "request_update",
      "credential_expiring",
      "credential_expired",
      "pay_query_update",
      "unknown_number",
    ]);
  });

  // Each doc template is built (below) or waiting for its task. A new doc template must be added
  // to one list or the other.
  const BUILT = [
    "login_link",
    "login_code",
    "office_login_link",
    "shift_urgent",
    "shift_reminder_24h",
    "shift_reminder_2h",
    "credential_expiring",
    "credential_expired",
  ];
  const NOT_BUILT: Record<string, string> = {
    shift_offer: "non-urgent offers (PLAN.md Parking lot, the daily offer cap)",
    shift_filled: "a reply to an offer: inbound WhatsApp (Phase 7)",
    shift_confirmed: "booking confirmations are on screen; by message with notify (parked)",
    cancellation_ack: "cancellation confirmations are on screen; by message with notify (parked)",
    shift_changed_by_firm: "firm-initiated changes (Phase 5)",
    request_update: "the office answering requests (Phase 5)",
    pay_query_update: "pay queries (Phase 6)",
    unknown_number: "a service reply to an inbound message (Phase 7)",
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

  it("credential_expiring, credential_expired and the My shifts banner", () => {
    expect(credentialExpiringMessage(docVoice, "{credential}", "{date}")).toBe(
      docBody("credential_expiring"),
    );
    expect(credentialExpiredMessage(docVoice, "{credential}", "{date}")).toBe(
      docBody("credential_expired"),
    );
    const banner = /^\| \(screen only: My shifts banner\) \| [^|]+ \| "([^"]+)"/m.exec(doc)?.[1];
    expect(credentialMarkedExpiredMessage(docVoice, "{credential}")).toBe(banner);
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
    ["shift_urgent", shiftUrgentMessage(voice, { ...shift, link: "L" })],
    ["shift_urgent (SMS)", shiftUrgentSms(voice, { ...shift, link: "L" })],
    ["shift_reminder_24h", shiftReminder24hMessage(voice, { ...shift, link: "L" })],
    ["shift_reminder_2h", shiftReminder2hMessage(voice, { ...shift, link: "L" })],
    ["credential_expiring", credentialExpiringMessage(voice, "PTS card", "3 Oct")],
    ["credential_expired", credentialExpiredMessage(voice, "PTS card", "3 Oct")],
    ["the My shifts banner", credentialMarkedExpiredMessage(voice, "PTS card")],
    ["office_login_link", officeLoginLinkEmail(voice, "L").body],
  ])("%s", (_name, text) => {
    expect(text).toMatch(/\s[—-] Acme Rota Desk$/);
  });
});

describe("the pushes", () => {
  const push = section("Push (title / body)");

  it("urgent", () => {
    const [title, body] = quotes(push, "Urgent:");
    expect(urgentPush({ role: "{Role}", site: "{site}", day: "{day}", start: "{start}" })).toEqual({
      title,
      body,
    });
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
        "credentialExpiredMessage",
        "credentialExpiringMessage",
        "credentialMarkedExpiredMessage",
        "credentialWeeklyListEmail",
        "loginCodeMessage",
        "loginLinkMessage",
        "officeLoginLinkEmail",
        "reminderPush",
        "shiftEscalationEmail",
        "shiftReminder24hMessage",
        "shiftReminder2hMessage",
        "shiftUrgentMessage",
        "shiftUrgentSms",
        "urgentPush",
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
      ),
    credential_expired: () =>
      credentialExpiredMessage(
        voice("credential_expired"),
        ex("credential_expired", "credential"),
        ex("credential_expired", "date"),
      ),
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

  it("each template is the doc's wording (a no-site variant without 'at {site}')", () => {
    const placeholder: Record<string, string> = {
      firm: "{firm}",
      signOff: "{firm} Shift Team",
      role: "a {role}",
    };
    for (const t of WHATSAPP_TEMPLATES) {
      const values = Object.fromEntries(t.variables.map((v) => [v, placeholder[v] ?? `{${v}}`]));
      const expected = t.name.endsWith("_no_site")
        ? docBody(t.docName).replace(" at {site}", "")
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
