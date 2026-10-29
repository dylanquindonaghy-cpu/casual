import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventWords } from "@/lib/office/event-words";
import {
  ALL_LOGGED_ACTIONS,
  isLogType,
  LIMIT_TYPES,
  limitsFiledUnder,
  LOG_TYPE_KEYS,
  LOG_TYPES,
  logTypeLabel,
} from "@/lib/office/log-types";
import { LIMITS } from "@/lib/auth/throttle";
import { STRIKES_LINK_LIMITS } from "@/lib/office/strikes-email";

// The action log (docs/screens.md `/office/log`) shows every event the app records, each in a plain
// group for the "type" filter (src/lib/office/log-types.ts) and in plain words
// (src/lib/office/event-words.ts). This test reads the code (src/, and the owner's scripts/, which
// log firm-level changes) for every action name it records and fails if one has no group or no
// words, so a new kind of event can't slip past the office.

const ROOT = join(process.cwd(), "src");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

// Every "word.word" string in the code. Today each one is an event kind; a new string of this shape
// that isn't one must be listed in NOT_EVENTS here on purpose.
const ACTION = /"([a-z_]+\.[a-z_]+)"/g;
const NOT_EVENTS = new Set<string>([
  // The domains reserved for examples, demo mode's made-up email addresses
  // (src/lib/demo/made-up.ts, 16.1).
  "example.com",
  "example.org",
  // Column names in the pilot metrics rollup's SQL (src/lib/metrics/rollup.ts).
  "e.created_at",
  "r.created_at",
  "o.responded_at",
  "s.starts_at",
  // Firm setting keys (a path into firms.settings) in src/lib/onboarding/settings.ts.
  "quiet_hours.start",
  "quiet_hours.end",
  "quiet_hours.urgent_override",
  "retention.message_days",
  "retention.request_note_days",
  "retention.hold_until",
  // The strikes team's email keys, changed only through app_set_firm_setting() (12B.7).
  "strikes.email",
  "strikes.email_verified_at",
  // The owner's strike settings (12C.1; the switch, P3.4), in src/lib/onboarding/settings.ts.
  "strikes.enabled",
  "strikes.notice_hours",
  "strikes.live_days",
  "strikes.keep_months",
  // The owner's travel settings (12G.1; 13.4), in src/lib/onboarding/settings.ts.
  "travel.enabled",
  "travel.default_max_minutes",
  // The owner's staff photo renewal (12F.2), in src/lib/onboarding/settings.ts.
  "photo.renewal_months",
  // The owner's pay calendar (P3.1), in src/lib/onboarding/settings.ts.
  "pay_calendar.days",
  "pay_calendar.anchor",
  "pay_calendar.pay_day_after",
  "pay_calendar.label",
  // The one field asked of Google Sheets for a spreadsheet's locale (src/lib/roster/sheets/google.ts).
  "properties.locale",
  // The evidence email's job queue (src/lib/strikes/evidence-queue.ts, 12C.4; the task's own name).
  "strikes.evidence_email",
  // The travel job's queue (src/lib/travel/estimate-queue.ts, 12G.2; the task's own name).
  "travel.estimates",
  // The planner's webhook types (src/lib/integrations/outbox.ts, 12J.2): what a delivery is
  // called, not a log entry ("strike.withdrawn" is both, and is an entry).
  "booking.created",
  "booking.cancelled",
  "test.ping",
  // The webhook's keys, changed only through app_set_firm_setting() (12J.2).
  "webhook.url",
  "webhook.rotate",
  "webhook.signing_version",
]);
const recorded = new Set(
  [...sourceFiles(ROOT), ...sourceFiles(join(process.cwd(), "scripts"))]
    .filter((path) => !path.endsWith("log-types.ts") && !path.endsWith("event-words.ts"))
    .flatMap((path) => [...readFileSync(path, "utf8").matchAll(ACTION)].map((m) => m[1] ?? ""))
    .filter((action) => !NOT_EVENTS.has(action)),
);

const names = {
  worker: () => "Ann Booker",
  office: () => "Sam Rota",
  credential: () => "SIA door supervisor licence",
};

describe("the action log's types and words", () => {
  it("every action the code records is in exactly one group", () => {
    expect(recorded.size).toBeGreaterThan(50);
    const missing = [...recorded].filter((a) => !ALL_LOGGED_ACTIONS.includes(a));
    expect(missing).toEqual([]);
    const all = LOG_TYPE_KEYS.flatMap((key) => [...LOG_TYPES[key].actions]);
    expect(all.length).toBe(new Set(all).size);
  });

  it("no group lists an action the code never records", () => {
    expect(ALL_LOGGED_ACTIONS.filter((a) => !recorded.has(a))).toEqual([]);
  });

  it.each([...ALL_LOGGED_ACTIONS])("%s has plain words", (action) => {
    const text = eventWords({ action, actorType: "office", actorId: "o", data: {} }, names);
    expect(text).not.toMatch(/^Recorded:/);
    expect(text).toMatch(/[.:]$/);
    expect(text).not.toMatch(/undefined|null|\[object/);
  });

  it("some words, as the log shows them", () => {
    const say = (action: string, data: Record<string, unknown> = {}, actorType = "system") =>
      eventWords({ action, actorType, actorId: "a", data }, names);
    // The event and session switches (12B.4), with who switched them.
    expect(say("event.hidden", { by: "firm" }, "office")).toBe(
      "Sam Rota hid the event from casuals. Anyone booked keeps their shift.",
    );
    expect(say("session.hidden", { by: "firm" }, "office")).toBe(
      "Sam Rota hid it from casuals. Anyone booked keeps their shift.",
    );
    expect(say("event.shown", { by: "firm" }, "office")).toBe(
      "Sam Rota showed the event to casuals.",
    );
    expect(say("event.shown", { by: "firm", offersStarted: 2 }, "office")).toBe(
      "Sam Rota showed the event to casuals. Offers went out again for 2 urgent shifts.",
    );
    expect(say("session.shown", { by: "firm", offersStarted: 1 }, "office")).toBe(
      "Sam Rota showed it to casuals. Offers went out again for 1 urgent shift.",
    );
    expect(say("offer.waves_stopped", { reason: "hidden", wave: 1 })).toBe(
      "Offers stopped: it's hidden from casuals.",
    );
    expect(say("offer.waves_stopped", { reason: "filled", wave: 1 })).toBe("Offers stopped.");
    expect(say("offer.office_not_sent", { workerId: "w", reason: "hidden" })).toBe(
      "The offer to Ann Booker wasn't sent: the shift is hidden from casuals.",
    );
    expect(say("auth.login", {}, "worker")).toBe("Ann Booker logged in.");
    expect(say("auth.login", {}, "office")).toBe("Sam Rota logged in.");
    expect(say("auth.link_rejected", { reason: "expired" })).toBe(
      "A login link was refused: it had run out.",
    );
    expect(say("auth.otp_failed", { attemptsLeft: 2 }, "worker")).toBe(
      "Ann Booker typed a wrong code (2 tries left).",
    );
    expect(say("request.approved", { type: "time_change", withNote: true }, "office")).toBe(
      "Sam Rota approved Ann Booker's request (time change), with a note.",
    );
    expect(say("request.created", { type: "swap" }, "worker")).toBe(
      "Ann Booker sent a request (swap).",
    );
    expect(say("credential.expired", { type: "SIA_DS", notified: true })).toBe(
      // The message's outcome is its own line since Phase 10 (credential.expiry_notice_sent/_failed).
      "Ann Booker's SIA door supervisor licence has expired: they're being told.",
    );
    expect(say("credential.expired", { type: "SIA_DS", notified: false })).toBe(
      "Ann Booker's SIA door supervisor licence has expired.",
    );
    expect(say("worker.unavailable_added", { day: "2026-11-04" }, "worker")).toBe(
      "Ann Booker marked a day off (Wed 4 Nov).",
    );
    // No name when the event can't say whose it was (a login link for an unknown number).
    expect(say("auth.link_requested", { kind: "worker", matched: true })).toBe(
      "A worker asked for a login link.",
    );
    expect(say("auth.link_requested", { kind: "worker", matched: true, workerId: "w" })).toBe(
      "Ann Booker asked for a login link.",
    );
    expect(say("auth.link_requested", { kind: "worker", matched: false })).toBe(
      "A login link was asked for (a number we don't know).",
    );
    expect(say("auth.otp_sent")).toBe("A pay-page code was sent.");
    expect(say("roster.sheet_conflict", { holderNotInSheet: true })).toBe(
      "Someone booked on this shift in the app isn't in the rota sheet's staff list.",
    );
    expect(say("roster.sheet_conflict", { notBooked: 1 })).toBe(
      "The rota sheet names someone the app couldn't book on this shift.",
    );
    expect(
      say("pay_record.imported", {
        workerId: "w",
        periodStart: "2026-10-26",
        periodEnd: "2026-11-01",
      }),
    ).toBe("A pay record was added for Ann Booker (Mon 26 Oct to Sun 1 Nov).");
    expect(say("import.completed", { created: 3, updated: 1, skipped: 0 }, "office")).toBe(
      "Sam Rota imported a file: 3 added, 1 changed, 0 skipped.",
    );
    expect(
      say("import.completed", { kind: "pay", created: 2, updated: 0, skipped: 1 }, "office"),
    ).toBe("Sam Rota imported a pay file: 2 added, 0 changed, 1 skipped.");
    expect(say("pay_query.regrouped", { changed: 2 })).toBe(
      "2 waiting pay queries moved to the group that matches the pay records now.",
    );
    expect(say("roster.synced", { shifts: 12 })).toBe("The rota sheet was read (12 shifts).");
    // A failed sync says why, in plain words, with the fix when the firm can make it (audit M17).
    expect(say("roster.sync_failed", { code: "sheet_locale_not_uk" })).toBe(
      "Reading the rota sheet failed: the sheet's locale isn't United Kingdom, so its dates could be read the wrong way round. In Google Sheets: File, Settings, Locale: United Kingdom, then Save settings. Then check the sheet's dates: ones typed before the change may have moved.",
    );
    expect(say("roster.sync_failed", { code: "sheet_not_shared" })).toBe(
      "Reading the rota sheet failed: the sheet isn't shared with our Google account (share it again, as Editor).",
    );
    expect(say("roster.source_connected", { replaced: false })).toBe(
      "The rota sheet was connected.",
    );
    expect(say("roster.source_connected", { replaced: true })).toBe(
      "A new rota sheet was connected in place of the old one.",
    );
    expect(say("roster.source_disabled", { replaced: false })).toBe(
      "The rota sheet was switched off: nothing more is read from it.",
    );
    expect(say("roster.source_disabled", { replaced: true })).toBe(
      "The old rota sheet was switched off (a new one replaces it).",
    );
    expect(say("roster.source_connected", { mappingChanged: true, defaultMapping: true })).toBe(
      "The rota sheet's column settings were changed.",
    );
    expect(say("shift.reopened", { source: "csv" }, "office")).toBe(
      "Sam Rota's import opened it again: it needs more people than it has booked.",
    );
    expect(say("shift.reopened", {}, "office")).toBe("Sam Rota opened it again.");
    expect(say("firm.agreement_recorded", { signedOn: "2026-10-02", was: "2026-10-01" })).toBe(
      "The firm's agreement and data processing agreement were recorded as signed on Fri 2 Oct 2026 (was Thu 1 Oct 2026).",
    );
    expect(say("firm.agreement_recorded", { cleared: true, was: "2026-10-01" })).toBe(
      "The firm's recorded agreement was removed (it said Thu 1 Oct 2026).",
    );
    expect(say("roster.synced", { shifts: 4, staffRefused: 2 })).toBe(
      "The rota sheet was read (4 shifts). 2 staff rows weren't taken: a mobile or Staff ID in it belongs to someone else here with another name. Check the sheet's Staff tab.",
    );
    // The nightly purge, by the firm's own settings; during a hold nothing personal goes (M24).
    expect(
      say("retention.purged", {
        messages: 3,
        requestNotes: 2,
        overrideReasons: 1,
        throttle: 1,
        loginLinks: 1,
        sessions: 0,
        codes: 0,
      }),
    ).toBe(
      "Old data was deleted on schedule, by the firm's retention settings: 3 messages, 2 request notes, 1 reason on a booking and 2 old login records.",
    );
    expect(
      say("retention.purged", {
        messages: 0,
        requestNotes: 0,
        overrideReasons: 0,
        uploads: 2,
        throttle: 1,
      }),
    ).toBe(
      "Old data was deleted on schedule, by the firm's retention settings: 0 messages, 0 request notes, 0 reasons on bookings, 2 turned-down or replaced photos and card images and 1 old login record.",
    );
    expect(say("retention.purged", { throttle: 2, held: true })).toBe(
      "Old login records were tidied up (2). Nothing else was deleted: a hold is on (a dispute).",
    );
    expect(say("roster.source_forgotten")).toBe(
      "An old rota sheet, already switched off, was let go: another firm could connect it.",
    );
    // A Google 400: a renamed tab or an Excel file, which the firm fixes (not "try again").
    expect(say("roster.sync_failed", { code: "sheet_unreadable" })).toBe(
      "Reading the rota sheet failed: Google couldn't read the sheet: check it's a Google Sheet (not an Excel file) and its tabs still have the names agreed (Staff and Shifts, unless you were told others).",
    );
    expect(
      say("pay_query.created", { issueType: "wrong_rate", workDate: "2026-10-31" }, "worker"),
    ).toBe("Ann Booker raised a pay query (wrong rate, Sat 31 Oct).");
    expect(say("shift.status_changed", { from: "open", to: "cancelled" })).toBe(
      "The rota sheet changed it from open to cancelled.",
    );
    expect(say("firm.branding_changed", { fields: ["colour", "signOff"] })).toBe(
      "The firm's colour and sign-off changed.",
    );
    expect(say("firm.branding_changed", { fields: ["name", "colour", "logo"] })).toBe(
      "The firm's name, colour and logo changed.",
    );
    expect(say("firm.domain_changed", { change: "set", verified: false })).toBe(
      "The firm's own web address was set. It works once its DNS points to us.",
    );
    expect(say("firm.domain_changed", { change: "verified", verified: true })).toBe(
      "The firm's own web address was verified: it works now.",
    );
    // The shifts line: a voicemail is never called a WhatsApp.
    const received = (data: Record<string, unknown>, actorType = "worker") =>
      say("message.received", data, actorType);
    expect(received({ channel: "whatsapp", handledAs: "keyword", intent: "pay" })).toBe(
      "Ann Booker sent a WhatsApp to the shifts line (pay).",
    );
    expect(received({ channel: "voice", handledAs: "office", intent: "office" })).toBe(
      "Ann Booker left a voicemail on the shifts line (for the office).",
    );
    expect(
      received({ channel: "voice", handledAs: "unknown", formerWorker: false }, "system"),
    ).toBe("A voicemail was left on the shifts line from a number that isn't one of your staff.");
    expect(
      received({ channel: "whatsapp", handledAs: "unknown", formerWorker: true }, "system"),
    ).toBe("A WhatsApp came to the shifts line from someone who isn't active any more.");
    // The last try failed (13.2): passed to a person, with the code logged.
    expect(
      received({
        channel: "whatsapp",
        handledAs: "office",
        intent: "office",
        answerFailed: "TypeError",
        workerId: "w",
      }),
    ).toBe(
      "A WhatsApp from Ann Booker couldn't be answered automatically (TypeError), so it's waiting for a person.",
    );
    expect(
      received(
        { channel: "voice", handledAs: "office", intent: "office", answerFailed: "57P01" },
        "system",
      ),
    ).toBe(
      "A voicemail from a number that isn't one of your staff's couldn't be answered automatically (57P01), so it's waiting for a person.",
    );
    expect(
      received(
        {
          channel: "sms",
          handledAs: "office",
          intent: "office",
          answerFailed: "TypeError",
          workerId: "w",
          formerWorker: true,
        },
        "system",
      ),
    ).toBe(
      "A text from someone who isn't active any more couldn't be answered automatically (TypeError), so it's waiting for a person.",
    );
    // A STOP on the last try still reads as a STOP (its texts were turned off).
    expect(
      received({
        channel: "sms",
        handledAs: "opt_out",
        optOut: "stop",
        changed: true,
        answerFailed: "57P01",
        workerId: "w",
      }),
    ).toBe("Ann Booker texted STOP to the shifts line.");
    expect(say("call.received", { linkRequested: true, withheld: false })).toBe(
      "Someone rang the shifts line. A login link was asked for (it goes only to your staff's numbers).",
    );
    expect(say("call.received", { linkRequested: false, withheld: true })).toBe(
      "Someone rang the shifts line from a withheld number.",
    );
  });

  it("group labels, and checking a type from the page's query", () => {
    expect(logTypeLabel("shift.cancelled")).toBe("Cancellations");
    expect(logTypeLabel("offer.sent")).toBe("Offers");
    expect(logTypeLabel("something.new")).toBe("Other");
    expect(isLogType("offers")).toBe(true);
    expect(isLogType("toString")).toBe(false);
    expect(isLogType("")).toBe(false);
  });

  it("a limit reached is filed by the limit's name (14.2)", () => {
    const limit = (name: string) => logTypeLabel("auth.rate_limited", { limit: name });
    expect(limit("take:worker")).toBe("Bookings");
    expect(limit("push:worker")).toBe("Workers");
    expect(limit("api:key")).toBe("Firm settings and office team");
    expect(limit("strikes_link:firm")).toBe("Firm settings and office team");
    expect(limit("strikes_link:firm_day")).toBe("Firm settings and office team");
    expect(limit("login:ip")).toBe("Logins");
    expect(limit("otp:worker")).toBe("Logins");
    // An older entry without a name, or one not known here: Logins.
    expect(logTypeLabel("auth.rate_limited")).toBe("Logins");
    expect(limit("toString")).toBe("Logins");
    // Every limit there is: the casuals' own, the planner's and the strikes team's links have their
    // place; the rest are about logging in (links, codes, office links).
    for (const { name } of [...Object.values(LIMITS), ...STRIKES_LINK_LIMITS]) {
      if (Object.hasOwn(LIMIT_TYPES, name)) continue;
      expect(name).toMatch(/^(login|link_fail|office|otp):/);
    }
    expect(limitsFiledUnder("bookings")).toEqual({ names: ["take:worker"], others: false });
    expect(limitsFiledUnder("logins")).toEqual({ names: [], others: true });
    expect(limitsFiledUnder("offers")).toEqual({ names: [], others: false });
  });
});

describe("photos and certificate images in the log (12F.2)", () => {
  const say = (action: string, data: Record<string, unknown>) =>
    eventWords(
      { action, actorType: action === "upload.received" ? "worker" : "office", actorId: "a", data },
      names,
    );
  it("what was sent and the check, in plain words; never the image", () => {
    expect(say("upload.received", { workerId: "w", kind: "photo" })).toBe(
      "Ann Booker sent a new staff photo.",
    );
    expect(
      say("upload.received", {
        workerId: "w",
        kind: "certificate",
        qualificationType: "SIA_DS",
        replaced: true,
      }),
    ).toBe("Ann Booker sent their SIA door supervisor licence, in place of the one waiting.");
    expect(
      say("upload.approved", {
        workerId: "w",
        kind: "certificate",
        qualificationType: "SIA_DS",
        expiresOn: "2027-11-06",
      }),
    ).toBe("Sam Rota approved Ann Booker's SIA door supervisor licence (expires Sat 6 Nov).");
    expect(say("upload.approved", { workerId: "w", kind: "photo" })).toBe(
      "Sam Rota approved Ann Booker's staff photo.",
    );
    expect(say("upload.rejected", { workerId: "w", kind: "photo", reason: "blurry" })).toBe(
      "Sam Rota didn't accept Ann Booker's staff photo: blurry.",
    );
    expect(
      say("credential.added", { workerId: "w", type: "CSAS", via: "office", ownScheme: true }),
    ).toBe(
      "Sam Rota recorded Ann Booker's SIA door supervisor licence, under the firm's own scheme.",
    );
  });
});
