import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MyRecord, MyRecordRow } from "@/lib/portal/my-record";
import { OFFLINE_PAGES } from "@/lib/portal/offline";
import {
  casualFirmReason,
  FIRM_REASON_FOR_CASUAL,
  NOTICE_NOT_RECORDED,
  RECORD_EMPTY,
  RECORD_FOOT,
  RECORD_INTRO,
  RECORD_PATH,
  RECORD_TITLE,
  recordAskedText,
  recordDayHeading,
  recordDays,
  recordMoreText,
  recordMoveLines,
  recordNoticeText,
  recordTitle,
  STRIKE_WORDS,
} from "@/lib/portal/record-copy";
import { FIRM_CHANGE_REASON_CODES, FIRM_CHANGE_REASONS } from "@/lib/roster/firm-reasons";
import {
  ADDED_ON_SHEET,
  CANCELLED_ON_SHEET,
  CHANGED_ON_SHEET,
  REMOVED_ON_SHEET,
  SITE_CHANGED_ON_SHEET,
} from "@/lib/roster/sheets/sync";

// Your shift record in words (docs/screens.md "The casual app, Phase 28", 28.4): every kind of row
// in plain words, "the office" for everyone in it, the notice only as logged, and nothing about
// pay, money owed or short notice; never in the copy kept for no signal. Pure: rows are made here.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/shifts/record",
}));
const { RecordView } = await import("@/app/shifts/record/record-view");
const { firmReasonForCasual, ownReasonForCasual } = await import("@/lib/portal/my-record");

const TZ = "Europe/London";
const NOW = new Date("2026-11-02T09:00:00Z"); // Monday 2 November, 09:00 (GMT)
const shift = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "door_supervisor",
  site: "Riverside Arena",
  startsAt: new Date("2026-11-07T08:00:00Z"),
  canOpen: true,
};
const moved = {
  fromStart: new Date("2026-11-07T06:00:00Z"),
  fromEnd: new Date("2026-11-07T14:00:00Z"),
  toStart: new Date("2026-11-07T08:00:00Z"),
  toEnd: new Date("2026-11-07T16:00:00Z"),
  siteChanged: true,
};
const row = (o: Partial<MyRecordRow>): MyRecordRow => ({
  at: new Date("2026-11-02T08:15:00Z"),
  kind: "offered",
  by: "office",
  shift,
  moved: null,
  noticeHours: 125,
  reason: null,
  askedBy: null,
  ref: null,
  strike: null,
  ...o,
});
// One of every kind of row, each way it can be told.
const EVERY_ROW: MyRecordRow[] = [
  row({ kind: "offered" }),
  row({ kind: "offered", noticeHours: null, shift: { ...shift, canOpen: false } }),
  row({ kind: "booked", by: "you", noticeHours: 129 }),
  // A firm's reason as the loader gives it: in her words (firmReasonForCasual).
  row({ kind: "booked", by: "office", reason: firmReasonForCasual(ADDED_ON_SHEET) }),
  row({
    kind: "moved",
    moved,
    reason: firmReasonForCasual(FIRM_CHANGE_REASONS.weather),
    noticeHours: 21,
  }),
  row({ kind: "shortened", moved: { ...moved, siteChanged: false }, noticeHours: 32.5 }),
  row({
    kind: "cancelled",
    by: "office",
    reason: firmReasonForCasual(FIRM_CHANGE_REASONS.event_cancelled),
    askedBy: "client",
    noticeHours: -2,
    shift: { ...shift, canOpen: false },
  }),
  row({ kind: "cancelled", by: "office", askedBy: "casual", noticeHours: 60 }),
  row({
    kind: "cancelled",
    by: "office",
    reason: firmReasonForCasual(FIRM_CHANGE_REASONS.not_available),
    noticeHours: 30,
  }),
  row({
    kind: "cancelled",
    by: "you",
    ref: "0695DD8C",
    reason: "I'm unwell",
    noticeHours: 20,
    strike: "strike",
  }),
  row({
    kind: "cancelled",
    by: "you",
    ref: "1A2B3C4D",
    reason: "Something else",
    strike: "withdrawn",
  }),
  row({ kind: "cancelled", by: "you", ref: "5E6F7A8B", noticeHours: 100, strike: "none" }),
  row({ kind: "booked", by: "you", shift: null, at: new Date("2026-10-30T23:30:00Z") }),
];
const record = (rows: MyRecordRow[], more = false): MyRecord => ({
  timeZone: TZ,
  days: 90,
  rows,
  more,
});
const render = (r: MyRecord) =>
  renderToStaticMarkup(createElement(RecordView, { record: r, now: NOW }));
const text = (html: string) =>
  html
    .replace(/<\/(p|h1|h2|h3|li|a|span|div|time)>/g, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("Your shift record: the words", () => {
  it("the page's own words, as docs/screens.md has them", () => {
    expect(RECORD_PATH).toBe("/shifts/record");
    expect(RECORD_TITLE).toBe("Your shift record");
    expect(RECORD_INTRO).toBe(
      "Every offer, booking, change and cancellation for you in the last 90 days, with the notice you had.",
    );
    expect(RECORD_EMPTY).toBe("Nothing in the last 90 days.");
    expect(RECORD_FOOT).toBe("Older records: ask the office for a copy.");
    expect(NOTICE_NOT_RECORDED).toBe("Notice not recorded");
    expect(recordMoreText(300)).toBe("Showing the newest 300.");
    expect(STRIKE_WORDS).toEqual({
      strike: "Strike",
      withdrawn: "Strike (withdrawn by the office)",
      none: "No strike",
    });
  });

  it("each title: what happened and who did it, always 'the office' for the firm", () => {
    expect(
      [
        ["offered", "office"],
        ["booked", "you"],
        ["booked", "office"],
        ["moved", "office"],
        ["shortened", "office"],
        ["cancelled", "office"],
        ["cancelled", "you"],
      ].map(([kind, by]) => recordTitle({ kind, by } as Pick<MyRecordRow, "kind" | "by">)),
    ).toEqual([
      "Offered to you",
      "Booked by you",
      "Booked by the office",
      "Moved by the office",
      "Shortened by the office",
      "Cancelled by the office",
      "You cancelled",
    ]);
  });

  it("the notice only as logged: had or gave, whole hours or days, after the start, or not recorded", () => {
    expect(recordNoticeText({ kind: "moved", by: "office", noticeHours: 21 })).toBe(
      "You had 21 hours' notice.",
    );
    expect(recordNoticeText({ kind: "offered", by: "office", noticeHours: 125 })).toBe(
      "You had 5 days' notice.",
    );
    expect(recordNoticeText({ kind: "cancelled", by: "you", noticeHours: 20.9 })).toBe(
      "You gave 20 hours' notice.",
    );
    expect(recordNoticeText({ kind: "cancelled", by: "office", noticeHours: -2 })).toBe(
      "After the shift started.",
    );
    expect(recordNoticeText({ kind: "offered", by: "office", noticeHours: null })).toBe(
      "Notice not recorded",
    );
    expect(recordAskedText("client")).toBe("The client asked.");
    expect(recordAskedText("casual")).toBe("You asked.");
    expect(recordAskedText(null)).toBeNull();
    expect(recordMoveLines(moved, TZ)).toEqual([
      "From Sat 7 Nov, 06:00 to 14:00",
      "To Sat 7 Nov, 08:00 to 16:00",
    ]);
  });

  it("reasons: only the fixed words, the office's told in her words; her own note under 'Something else' stays off the page", () => {
    // Every one of the office's fixed reasons has words for her, as docs/screens.md 28.4 has them.
    expect(
      Object.fromEntries(
        FIRM_CHANGE_REASON_CODES.map((code) => [
          code,
          firmReasonForCasual(FIRM_CHANGE_REASONS[code]),
        ]),
      ),
    ).toEqual({
      event_changed: "The event's times or place changed.",
      event_cancelled: "The event was cancelled.",
      fewer_staff: "The client needed fewer staff.",
      weather: "Because of weather or safety.",
      not_available: "You could no longer work this shift.",
      other: "For another reason.",
    });
    // And every one of the rota sheet's, as the sync logs them.
    expect(
      [
        ADDED_ON_SHEET,
        CANCELLED_ON_SHEET,
        REMOVED_ON_SHEET,
        CHANGED_ON_SHEET,
        SITE_CHANGED_ON_SHEET,
      ].map((logged) => firmReasonForCasual(logged)),
    ).toEqual([
      "The office put you on the rota sheet.",
      "The shift was cancelled on the rota sheet.",
      "The office took you off the rota sheet.",
      "The times were changed on the rota sheet.",
      "The site was changed on the rota sheet.",
    ]);
    // The words for her cover exactly those fixed words, no others.
    expect(Object.keys(FIRM_REASON_FOR_CASUAL).sort()).toEqual(
      [
        ...Object.values(FIRM_CHANGE_REASONS),
        ADDED_ON_SHEET,
        CANCELLED_ON_SHEET,
        CHANGED_ON_SHEET,
        REMOVED_ON_SHEET,
        SITE_CHANGED_ON_SHEET,
      ].sort(),
    );
    // She is reading about her own booking: each is one short sentence, and never "they".
    for (const words of Object.values(FIRM_REASON_FOR_CASUAL)) {
      expect(words, words).toMatch(/^[A-Z][^.]*\.$/);
      expect(words, words).not.toMatch(/\b(they|they've|they're|them|their|she|her|he|his)\b/i);
    }
    // Anything else still shows nothing: typed words, or a name every object has.
    for (const never of [
      "Their manager said it's fine",
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(firmReasonForCasual(never), never).toBeNull();
      expect(casualFirmReason(never), never).toBeNull();
    }
    expect(firmReasonForCasual(null)).toBeNull();
    for (const quick of ["I'm unwell", "Travel problem", "Family or caring"]) {
      expect(ownReasonForCasual(quick)).toBe(quick);
    }
    expect(ownReasonForCasual("Something else: my car broke down near Leeds")).toBe(
      "Something else",
    );
    expect(ownReasonForCasual("Unwell")).toBeNull();
    expect(ownReasonForCasual(null)).toBeNull();
  });

  it("days in the firm's time, newest first: Today, Yesterday, then the date (summer time too)", () => {
    expect(recordDayHeading("2026-11-02", NOW, TZ)).toBe("Today");
    expect(recordDayHeading("2026-11-01", NOW, TZ)).toBe("Yesterday");
    expect(recordDayHeading("2026-10-30", NOW, TZ)).toBe("Fri 30 Oct");
    // Before the clocks went back (01:00 UTC on Sun 25 Oct), London was an hour ahead: 23:30 UTC on
    // Sat 24 Oct is 00:30 on Sun 25 Oct there.
    const days = recordDays(
      [
        row({ at: new Date("2026-11-02T08:15:00Z") }),
        row({ at: new Date("2026-11-02T00:05:00Z") }),
        row({ at: new Date("2026-10-24T23:30:00Z") }), // 00:30 on Sun 25 Oct, BST
      ],
      TZ,
    );
    expect(days.map((d) => [d.day, d.rows.length])).toEqual([
      ["2026-11-02", 2],
      ["2026-10-25", 1],
    ]);
  });
});

describe("Your shift record: the page", () => {
  it("every row in plain words: no jargon or codes, short sentences, every action findable", () => {
    const html = render(record(EVERY_ROW, true));
    const words = text(html);
    for (const jargon of [
      "error",
      "invalid",
      "null",
      "undefined",
      "NaN",
      "assignment",
      "roster",
      "initiator",
      "[object",
    ]) {
      expect(words.toLowerCase(), jargon).not.toContain(jargon.toLowerCase());
    }
    expect(words).not.toMatch(/\b[a-z]+_[a-z_]+\b/); // no raw codes
    for (const sentence of words.split(/(?<=[.!?:])\s+/)) {
      expect(sentence.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length).toBeLessThanOrEqual(
        25,
      );
    }
    for (const want of [
      "Your shift record",
      "Today",
      "Fri 30 Oct",
      "Offered to you",
      "Booked by you",
      "Booked by the office",
      "The office put you on the rota sheet.",
      "Moved by the office",
      "From Sat 7 Nov, 06:00 to 14:00",
      "To Sat 7 Nov, 08:00 to 16:00",
      "The site changed too.",
      "Because of weather or safety.",
      "Shortened by the office",
      "Cancelled by the office",
      "The event was cancelled.",
      "You could no longer work this shift.",
      "The client asked.",
      "You asked.",
      "After the shift started.",
      "You cancelled",
      "Your reason: I'm unwell",
      "Your reason: Something else",
      "You gave 20 hours' notice.",
      "You had 21 hours' notice.",
      "Notice not recorded",
      "Strike (withdrawn by the office)",
      "No strike",
      "A shift no longer listed",
      "Door supervisor at Riverside Arena",
      "Sat 7 Nov, 08:00",
      "Showing the newest 13.",
      "Older records: ask the office for a copy.",
    ]) {
      expect(words, want).toContain(want);
    }
    expect(html).toContain('Reference <span class="font-mono">0695DD8C</span>');
    expect(html).toContain('<time dateTime="2026-11-02T08:15:00.000Z"');
  });

  it("never an office user's name, pay, 'owed' or short-notice wording; only the office", () => {
    const words = text(render(record(EVERY_ROW)));
    expect(words).not.toContain("£");
    // Never the office's own words about her ("They've left, or can't work here").
    expect(words).not.toMatch(/\bthey('ve|'re)?\b/i);
    expect(words).not.toContain(FIRM_CHANGE_REASONS.not_available);
    for (const never of [
      "owed",
      "owe ",
      "compensation",
      "entitled",
      "short notice",
      "pay",
      "Office Person",
    ]) {
      expect(words.toLowerCase(), never).not.toContain(never.toLowerCase());
    }
    // A row's words come only from its own fields, none of which is a person in the office.
    const fields = Object.keys(EVERY_ROW[0]!).sort();
    expect(fields).toEqual(
      [
        "askedBy",
        "at",
        "by",
        "kind",
        "moved",
        "noticeHours",
        "reason",
        "ref",
        "shift",
        "strike",
      ].sort(),
    );
    // The loader reads no office user, no actor, no names and none of the office's own words.
    const loader = readFileSync("src/lib/portal/my-record.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const never of [
      "office_users",
      "actor_id",
      "first_name",
      "last_name",
      "override_reason",
      "withdrawn_reason",
      "review_needed",
      "review_reasons",
      "evidence_email",
      "pay_rate",
      "notes",
    ]) {
      expect(loader, never).not.toContain(never);
    }
  });

  it("links only to a shift she can open, 44px tall; a cancelled session's row has none", () => {
    const html = render(
      record([
        row({
          kind: "cancelled",
          by: "office",
          shift: { ...shift, id: "a-cancelled", canOpen: false },
        }),
        row({ kind: "booked", by: "you", shift: { ...shift, id: "b-open", canOpen: true } }),
      ]),
    );
    expect(html).not.toContain('href="/shifts/a-cancelled"');
    // A link's classes, whichever order its attributes come in.
    const classesOf = (href: string) => {
      const tag = [...html.matchAll(/<a\b[^>]*>/g)]
        .map((m) => m[0])
        .find((t) => t.includes(`href="${href}"`));
      return /class="([^"]*)"/.exec(tag ?? "")?.[1]?.split(" ") ?? [];
    };
    expect(classesOf("/shifts/b-open")).toContain("min-h-11");
    expect(classesOf("/messages")).toContain("min-h-11");
  });

  it("empty: says so in the empty box; no day headings; the foot still offers a way to ask", () => {
    const html = render(record([]));
    expect(text(html)).toContain(RECORD_EMPTY);
    expect(html).not.toContain("<h2");
    expect(html).toContain('href="/messages"');
  });

  it("strike words only where a strike decision applies; none at all with strikes off", () => {
    const off = EVERY_ROW.map((r) => ({ ...r, strike: null }));
    expect(text(render(record(off)))).not.toMatch(/strike/i);
  });
});

describe("Your shift record is never kept on the phone", () => {
  it("OFFLINE_PAGES and the service worker's PAGES are Home and Booked only", () => {
    expect(OFFLINE_PAGES).not.toContain(RECORD_PATH);
    expect([...OFFLINE_PAGES]).toEqual(["/", "/shifts"]);
    const sw = readFileSync("public/sw.js", "utf8");
    const sandbox: { PAGES?: string[] } = {};
    const match = /const PAGE = "([^"]+)";[\s\S]*?const PAGES = (\[[^\]]*\]);/.exec(sw);
    expect(match).not.toBeNull();
    vm.runInNewContext(
      `PAGES = (function(PAGE){ return ${match![2]}; })(${JSON.stringify(match![1])});`,
      sandbox,
    );
    expect(sandbox.PAGES).toEqual(["/", "/shifts"]);
    expect(sandbox.PAGES).not.toContain(RECORD_PATH);
  });

  it("the page asks for no copy to be kept (no OfflineCopy)", () => {
    const page = readFileSync("src/app/shifts/record/page.tsx", "utf8").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(page).not.toMatch(/OfflineCopy|keepOfflineCopy/);
  });
});
