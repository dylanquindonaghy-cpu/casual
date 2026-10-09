import { describe, expect, it } from "vitest";
import { passesLogCheck } from "@/lib/events/record";
import {
  CANCELLATIONS_CSV_HEADER,
  CASUAL_OWN_REASON,
  cancellationsCsv,
  evidenceText,
  exportReason,
  howText,
  OFFICE_OWN_REASON,
  recordFields,
  strikeShort,
  strikeText,
  thenText,
  weekCountsText,
  type CancellationRow,
} from "@/lib/office/cancellations-copy";
import { eventWords } from "@/lib/office/event-words";
import { recordPdf } from "@/lib/pdf/record";
import { embeddedFontSizes, fontFileSizes, pdfText } from "../helpers/pdf-text";

// Cancellation records (12C.3; docs/office-v2.md 3.4): the record's fields, the "Then" line, the
// CSV and the PDF. Pure (the PDF reads the fonts from the repo). Times in London (GMT in November).

const TZ = "Europe/London";
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
  warning: { version: "v1", shownAt: at("2026-11-06T18:00:00Z") },
  then: {
    wholeSessionCancelled: false,
    placeRemoved: false,
    reopened: true,
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
    expect(strikeText({ strike: null, strikeCode: null }, TZ)).toBe(
      "Not recorded (before strikes)",
    );
    expect(strikeShort({ strike: null, strikeCode: "rules_override" })).toBe(
      "exempt: booked by the office over a rest or hours rule",
    );
    expect(strikeShort({ strike: null, strikeCode: "enough_notice" })).toBe("no");
    expect(strikeShort(row())).toBe("yes");
    expect(evidenceText({ strike: null }, TZ)).toBe("No strike: nothing to send");
    expect(weekCountsText({ byCasuals: 9, byOffice: 2, strikes: 3 })).toEqual({
      cancellations: "9 by casuals · 2 by the office",
      strikes: "3 strikes issued",
    });
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
    expect(thenText({ ...base, wholeSessionCancelled: true }, when, TZ)).toBe(
      "The whole session was cancelled",
    );
    expect(thenText({ ...base, placeRemoved: true }, when, TZ)).toBe(
      "The place went: the client needs fewer staff",
    );
    expect(thenText({ ...base, reopened: false }, when, TZ)).toBe(
      "The place wasn't reopened (the session had started)",
    );
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
    expect(lines[2]).toContain("office,By the office (Sam Rota),48.00".replace("48.00", "20.00"));
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
  });
});
