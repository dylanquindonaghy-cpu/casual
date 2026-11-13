import { describe, expect, it } from "vitest";
import { passesLogCheck } from "@/lib/events/record";
import {
  AS_IT_IS_NOW,
  CANCELLATIONS_CSV_HEADER,
  CASUAL_OWN_REASON,
  cancellationsCsv,
  cancelledLine,
  countTiles,
  evidenceText,
  exportReason,
  howText,
  isThenPlace,
  noticeShort,
  OFFICE_OWN_REASON,
  RED_ROWS,
  recordFields,
  sessionLine,
  strikeBadge,
  strikeShort,
  strikeText,
  thenText,
  weekCountsText,
  type CancellationRow,
} from "@/lib/office/cancellations-copy";
import { eventWords } from "@/lib/office/event-words";
import type { StrikeCode } from "@/lib/strikes/decide";
import { recordPdf } from "@/lib/pdf/record";
import { embeddedFontSizes, fontFileSizes, pdfText } from "../helpers/pdf-text";

// Cancellation records (12C.3; docs/office-v2.md 3.4): the record's fields, the "Then" line, the
// CSV and the PDF. Pure (the PDF reads the fonts from the repo). Times in London (GMT in November).

const TZ = "Europe/London";
// Every strike code the rules give (a Record, so a new code fails typecheck until it's listed).
const EVERY_CODE: Record<StrikeCode, true> = {
  issued: true,
  by_firm: true,
  strikes_off: true,
  enough_notice: true,
  booked_by_office: true,
  rules_override: true,
  changed_after_booking: true,
};
const STRIKE_CODES = Object.keys(EVERY_CODE) as StrikeCode[];
const at = (iso: string) => new Date(iso);

const row = (o: Partial<CancellationRow> = {}): CancellationRow => ({
  assignmentId: "4f2a9c1b-0000-4000-8000-000000000001",
  ref: "4F2A9C1B",
  workerId: "w1",
  casual: "Ann Booker",
  staffId: "N001",
  eventName: "Raceday",
  role: "door_supervisor",
  startsAt: at("2026-11-07T14:00:00Z"),
  endsAt: at("2026-11-07T22:00:00Z"),
  siteName: "Riverside Arena",
  sitePostcode: "ZZ1 1AA",
  post: "Gate B",
  payRatePence: 1550,
  meetingPoint: "Car park C",
  uniform: "Black, hi-vis",
  requirements: [
    { code: "SIA_DS", name: "SIA door supervisor licence" },
    { code: "FIRST_AID", name: "First aid certificate" },
  ],
  bookedAt: at("2026-11-02T08:00:00Z"),
  cancelledAt: at("2026-11-06T18:00:00Z"),
  by: "casual",
  via: "app",
  officeName: null,
  reason: "I'm unwell",
  noticeHours: 20,
  strikeCode: "issued",
  strike: {
    status: "live",
    expiresAt: at("2027-02-04T18:00:00Z"),
    reviewNeeded: true,
    evidence: { status: null, to: null, sentAt: null },
  },
  planner: { status: "none" },
  warning: { version: "v1", shownAt: at("2026-11-06T18:00:00Z") },
  then: {
    place: "reopened",
    markedUrgent: true,
    offeredTo: 5,
    replacement: { name: "Ben Fraser", at: at("2026-11-06T22:02:00Z") },
  },
  ...o,
});
const fieldsOf = (r: CancellationRow, forExport: boolean) =>
  Object.fromEntries(
    recordFields(r, { tz: TZ, threshold: 48, liveStrikes: 2, forExport }).map((f) => [
      f.label,
      f.value,
    ]),
  );

describe("the record's fields", () => {
  it("every field in 3.4's table, the session's own details included", () => {
    expect(fieldsOf(row(), false)).toEqual({
      Reference: "4F2A9C1B",
      Casual: "Ann Booker",
      "Staff id": "N001",
      Event: "Raceday",
      Session: "Door supervisor · Sat 7 Nov, 14:00 to 22:00",
      Site: "Riverside Arena, ZZ1 1AA",
      Post: "Gate B",
      "Pay rate": "£15.50/h",
      Requirements: "SIA door supervisor licence, First aid certificate",
      "Meeting point": "Car park C",
      Uniform: "Black, hi-vis",
      "Booked at": "08:00 on Mon 2 Nov",
      "Cancelled at": "18:00 on Fri 6 Nov",
      How: "In the app",
      Notice: "20 hours' notice (20.00 hours)",
      "Under 48 hours": "Yes",
      Reason: "I'm unwell",
      Strike: "Issued (counts until Thu 4 Feb)",
      "Live strikes now": "2",
      "Evidence email": "Not sent",
      "Your planner": "No webhook set up",
      Then: "Place reopened and marked urgent · offered to 5 casuals · filled again by Ben Fraser at 22:02",
      "Warning on the cancel screen":
        "Version v1, on screen when they confirmed at 18:00 on Fri 6 Nov",
    });
  });

  it("what leaves ShiftDesk never carries a casual's reason; the office's fixed words stay", () => {
    for (const reason of [
      "I'm unwell",
      "Family or caring",
      "Travel problem",
      "Something else: flu",
    ]) {
      expect(fieldsOf(row({ reason }), true).Reason).toBe(CASUAL_OWN_REASON);
    }
    const office = { by: "office" as const, via: "office" as const, officeName: "Sam Rota" };
    expect(exportReason({ ...office, reason: "Weather or safety" })).toBe("Weather or safety");
    expect(exportReason({ by: "sheet", reason: "Removed on the rota sheet" })).toBe(
      "Removed on the rota sheet",
    );
    // Anything else the office typed (a booking from before the fixed list) stays inside.
    expect(exportReason({ ...office, reason: "Ann rang: her mum is in hospital" })).toBe(
      OFFICE_OWN_REASON,
    );
  });

  it("how it was cancelled, and the strike in words", () => {
    expect(howText({ by: "office", via: "office", officeName: "Sam Rota", reason: "x" })).toBe(
      "By the office (Sam Rota)",
    );
    expect(
      howText({
        by: "sheet",
        via: "sheet",
        officeName: null,
        reason: "Shift cancelled on the rota sheet",
      }),
    ).toBe("Cancelled on the rota sheet");
    expect(
      howText({ by: "sheet", via: "sheet", officeName: null, reason: "Removed on the rota sheet" }),
    ).toBe("Removed on the rota sheet");
    expect(howText({ by: "office", via: null, officeName: null, reason: "x" })).toBe(
      "By the office",
    );
    expect(strikeText({ strike: null, strikeCode: "booked_by_office" }, TZ)).toBe(
      "Exempt: booked by the office",
    );
    // Phase 37.2: no code says only that nothing was recorded (it used to guess "before strikes").
    expect(strikeText({ strike: null, strikeCode: null }, TZ)).toBe("Not recorded");
    // Issued, its strike row deleted after the firm's keep time: say so.
    expect(strikeText({ strike: null, strikeCode: "issued" }, TZ)).toBe(
      "Issued (its record was deleted)",
    );
    expect(strikeShort({ strike: null, strikeCode: "issued" })).toBe("yes");
    expect(strikeShort({ strike: null, strikeCode: "rules_override" })).toBe(
      "exempt: booked by the office over a rest or hours rule",
    );
    expect(strikeShort({ strike: null, strikeCode: "enough_notice" })).toBe("no");
    // Strikes switched off (P3.4): no strike, and no exemption.
    expect(strikeShort({ strike: null, strikeCode: "strikes_off" })).toBe("no");
    expect(strikeText({ strike: null, strikeCode: "strikes_off" }, TZ)).toBe(
      "None: strikes are off",
    );
    expect(strikeShort(row())).toBe("yes");
    expect(evidenceText({ strike: null }, TZ)).toBe("No strike: nothing to send");
    expect(weekCountsText({ byCasuals: 9, byOffice: 2, strikes: 3 })).toEqual({
      cancellations: "9 by casuals · 2 by the office",
      strikes: "3 strikes issued",
    });
  });
});

// Round 8 (Phase 26.8; docs/screens.md "Cancellations, round 8"): the four counts, the notice chip,
// the strike badge and the list's lines.
describe("the list, round 8", () => {
  it("the four counts (can-3): this week, under the threshold, strikes, the last 8 weeks", () => {
    const tiles = countTiles(
      {
        week: { byCasuals: 2, byOffice: 0, strikes: 0, under: 0 },
        overall: { under: 5, liveStrikes: 3, last8: 17, last8Under: 9 },
      },
      48,
    );
    expect(tiles.map((t) => [t.label, t.value, t.line, t.urgent])).toEqual([
      ["This week", 2, "2 by casuals · 0 by the office", false],
      ["Under 48 hours' notice", 0, "This week · 9 in the last 8 weeks", false],
      ["Strikes issued", 0, "This week · 3 live strikes now", false],
      ["Last 8 weeks", 17, "Cancellations, 9 under 48 hours", false],
    ]);
    // Under the threshold this week: red. The firm's own threshold names it.
    const hot = countTiles(
      {
        week: { byCasuals: 1, byOffice: 1, strikes: 1, under: 1 },
        overall: { under: 1, liveStrikes: 1, last8: 2, last8Under: 1 },
      },
      24,
    );
    expect(hot[1]).toEqual({
      label: "Under 24 hours' notice",
      value: 1,
      line: "This week · 1 in the last 8 weeks",
      urgent: true,
    });
    expect(hot[0]?.line).toBe("1 by a casual · 1 by the office");
    expect(RED_ROWS(48)).toBe("Red rows had under 48 hours' notice.");
  });

  it("the notice chip (can-2): hours or days, without 'notice'", () => {
    expect(noticeShort(0.5)).toBe("less than an hour");
    expect(noticeShort(1.2)).toBe("1 hour");
    expect(noticeShort(6)).toBe("6 hours");
    expect(noticeShort(30.9)).toBe("30 hours");
    expect(noticeShort(48)).toBe("2 days");
    expect(noticeShort(98)).toBe("4 days");
  });

  it("the strike badge (can-2): issued with its number and date, review, withdrawn, or why none", () => {
    const live = row().strike;
    if (!live) throw new Error("no strike");
    expect(
      strikeBadge(row({ strike: { ...live, number: 2, counting: true, reviewNeeded: false } }), TZ),
    ).toEqual({
      kind: "issued",
      text: "Strike 2 issued",
      line: "Counts until Thu 4 Feb",
      review: false,
    });
    expect(
      strikeBadge(row({ strike: { ...live, number: 1, counting: false, reviewNeeded: true } }), TZ),
    ).toEqual({
      kind: "issued",
      text: "Strike 1 issued",
      line: "Stopped counting Thu 4 Feb",
      review: true,
    });
    expect(strikeBadge(row({ strike: { ...live, status: "withdrawn" } }), TZ)).toEqual({
      kind: "withdrawn",
      text: "Strike withdrawn",
    });
    const none = (o: Partial<CancellationRow>) => strikeBadge(row({ strike: null, ...o }), TZ).text;
    expect(none({ strikeCode: "enough_notice" })).toBe("No strike · enough notice");
    expect(none({ strikeCode: "strikes_off" })).toBe("No strike · strikes are off");
    expect(none({ strikeCode: "booked_by_office" })).toBe("No strike · booked by the office");
    expect(none({ strikeCode: "rules_override" })).toBe(
      "No strike · booked over a rest or hours rule",
    );
    expect(none({ strikeCode: "changed_after_booking" })).toBe(
      "No strike · the office changed it after booking",
    );
    // Phase 37.2: what is known, never a guess.
    expect(none({ strikeCode: null })).toBe("No strike recorded");
    expect(strikeBadge(row({ strike: null, strikeCode: "issued" }), TZ)).toEqual({
      kind: "none",
      text: "Strike issued · its record was deleted",
    });
    // No code and no row, whatever the code: never "before strikes".
    for (const code of [...STRIKE_CODES, null]) {
      const r = { strike: null, strikeCode: code };
      expect(strikeBadge(row(r), TZ).text).not.toMatch(/before strikes/);
      expect(strikeText(r, TZ)).not.toMatch(/before strikes/);
    }
    // The firm cancelled: who, whatever the code says.
    expect(none({ by: "office", strikeCode: "by_firm" })).toBe("No strike · the office cancelled");
    expect(none({ by: "planner", via: "api", strikeCode: "by_firm" })).toBe(
      "No strike · your planner cancelled",
    );
    expect(none({ by: "sheet", via: "sheet", strikeCode: null })).toBe(
      "No strike · cancelled on the rota sheet",
    );
  });

  it("the Cancelled and session lines: the office's fixed reason, never a casual's", () => {
    // 18:00 GMT on Fri 6 Nov.
    expect(cancelledLine(row(), TZ)).toBe("18:00 Fri 6 Nov · in the app");
    expect(
      cancelledLine(
        row({ by: "office", via: "office", officeName: "Sam Rota", reason: "Weather or safety" }),
        TZ,
      ),
    ).toBe("18:00 Fri 6 Nov · by the office (Sam Rota) · weather or safety");
    // Typed words and "Another reason" stay off the list.
    expect(
      cancelledLine(row({ by: "office", via: "office", officeName: null, reason: "Typed" }), TZ),
    ).toBe("18:00 Fri 6 Nov · by the office");
    expect(
      cancelledLine(
        row({ by: "office", via: "office", officeName: null, reason: "Another reason" }),
        TZ,
      ),
    ).toBe("18:00 Fri 6 Nov · by the office");
    expect(cancelledLine(row({ by: "planner", via: "api", reason: "Weather or safety" }), TZ)).toBe(
      "18:00 Fri 6 Nov · by your planner · weather or safety",
    );
    expect(sessionLine(row(), TZ)).toBe("Door supervisor · Riverside Arena · Sat 7 Nov 14:00");
    expect(sessionLine(row({ siteName: null }), TZ)).toBe("Door supervisor · Sat 7 Nov 14:00");
  });
});

describe("Then", () => {
  const base = row().then;
  const when = at("2026-11-06T18:00:00Z");
  it("says what happened next", () => {
    expect(thenText(base, when, TZ)).toBe(
      "Place reopened and marked urgent · offered to 5 casuals · filled again by Ben Fraser at 22:02",
    );
    expect(
      thenText({ ...base, markedUrgent: false, offeredTo: 1, replacement: null }, when, TZ),
    ).toBe("Place reopened · offered to 1 casual · not filled again yet");
    // Filled on another day: the day too.
    expect(
      thenText(
        { ...base, replacement: { name: "Cal Jones", at: at("2026-11-07T09:10:00Z") } },
        when,
        TZ,
      ),
    ).toBe(
      "Place reopened and marked urgent · offered to 5 casuals · filled again by Cal Jones at 09:10 on Sat 7 Nov",
    );
    // What the cancellation recorded about its place.
    expect(thenText({ ...base, place: "session_cancelled" }, when, TZ)).toBe(
      "The whole session was cancelled",
    );
    expect(thenText({ ...base, place: "removed" }, when, TZ)).toBe(
      "The place went: the client needs fewer staff",
    );
    expect(thenText({ ...base, place: "started" }, when, TZ)).toBe(
      "The place wasn't reopened: the session had started",
    );
    expect(thenText({ ...base, place: "above_places" }, when, TZ)).toBe(
      "The place wasn't reopened: the session had fewer places by then",
    );
    // Logged before cancellations recorded it: nothing guessed.
    expect(thenText({ ...base, place: null }, when, TZ)).toBe("Not recorded");
    // What the loader accepts from the log as a place.
    for (const p of ["reopened", "above_places", "started", "removed", "session_cancelled"]) {
      expect(isThenPlace(p), p).toBe(true);
    }
    for (const p of [null, "", "Reopened", "toString", "constructor", 1]) {
      expect(isThenPlace(p), String(p)).toBe(false);
    }
  });
});

describe("the CSV", () => {
  it("has 3.4's columns, escapes cells, and never a casual's reason or a health word", () => {
    const csv = cancellationsCsv(
      [
        row({ reason: "I'm unwell", casual: '=HYPERLINK("x")', post: 'Gate "B", north' }),
        row({
          ref: "AAAA0002",
          by: "office",
          via: "office",
          officeName: "Sam Rota",
          reason: "Weather or safety",
          strike: null,
          strikeCode: "by_firm",
          warning: null,
        }),
      ],
      { tz: TZ, threshold: 48 },
    );
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(CANCELLATIONS_CSV_HEADER.join(","));
    expect(CANCELLATIONS_CSV_HEADER).toHaveLength(22);
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain('"Gate ""B"", north"');
    expect(lines[1]).toContain(`${CASUAL_OWN_REASON},yes`);
    expect(lines[1]).toContain("2026-11-07,14:00,22:00");
    expect(lines[2]).toContain("office,By the office (Sam Rota),20.00");
    expect(lines[2]).toContain("Weather or safety,no");
    expect(csv.toLowerCase()).not.toMatch(/unwell|health/);
  });
});

describe("the PDF", () => {
  it("prints names such as Łukasz Ştefan, the ✓, the session's details and the footer; no reason", async () => {
    const r = row({ casual: "Łukasz Ştefan", reason: "I'm unwell: my health" });
    const bytes = await recordPdf({
      title: "Cancellation record 4F2A9C1B",
      firmName: "Acme Events",
      fields: recordFields(r, { tz: TZ, threshold: 48, liveStrikes: 1, forExport: true }),
      generatedAt: "09:14 on Mon 9 Nov",
      note: AS_IT_IS_NOW,
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const text = await pdfText(bytes);
    for (const shown of [
      "Cancellation record 4F2A9C1B",
      "Łukasz Ştefan",
      "✓ Yes",
      "Door supervisor · Sat 7 Nov, 14:00 to 22:00",
      "Riverside Arena, ZZ1 1AA",
      "Gate B",
      "£15.50/h",
      "SIA door supervisor licence, First aid certificate",
      "Car park C",
      "Black, hi-vis",
      CASUAL_OWN_REASON,
      AS_IT_IS_NOW,
      "Produced by ShiftDesk from Acme Events's data on 09:14 on Mon 9 Nov.",
    ]) {
      expect(text).toContain(shown);
    }
    expect(text.toLowerCase()).not.toMatch(/unwell|health/);
    // The fonts go in whole: fontkit's own subsetting drops letters of these fonts when drawn.
    expect(await embeddedFontSizes(bytes)).toEqual(fontFileSizes());
  });

  it("Greek and Cyrillic names print too", async () => {
    const bytes = await recordPdf({
      title: "Cancellation record 4F2A9C1B",
      firmName: "Acme Events",
      fields: [{ label: "Casual", value: "Олена Коваленко · Δήμητρα" }],
      generatedAt: "09:14 on Mon 9 Nov",
    });
    expect(await pdfText(bytes)).toContain("Олена Коваленко · Δήμητρα");
  });
});

describe("the log entry", () => {
  it("export.downloaded: ids and counts only, in plain words", () => {
    const names = { worker: () => "Ann Booker", office: () => "Sam Rota" };
    const pdf = { kind: "cancellation_pdf", assignmentId: "4f2a9c1b-0000-4000-8000-000000000001" };
    const csv = { kind: "cancellations_csv", view: "under", rows: 12 };
    expect(passesLogCheck(pdf)).toBe(true);
    expect(passesLogCheck(csv)).toBe(true);
    const say = (data: Record<string, unknown>) =>
      eventWords({ action: "export.downloaded", actorType: "office", actorId: "o", data }, names);
    expect(say(pdf)).toBe("Sam Rota downloaded a cancellation record (PDF).");
    expect(say(csv)).toBe(
      "Sam Rota downloaded the cancellations (short notice, 12 rows) as a CSV.",
    );
    // Today's only (the dashboard's "Cancellations today" list).
    const today = {
      kind: "cancellations_csv",
      view: "all",
      day: "today",
      date: "2026-11-09",
      rows: 1,
    };
    expect(passesLogCheck(today)).toBe(true);
    expect(say(today)).toBe(
      "Sam Rota downloaded the cancellations (all, today's only, 1 row) as a CSV.",
    );
  });
});
