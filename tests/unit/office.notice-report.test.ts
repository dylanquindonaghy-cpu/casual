import { describe, expect, it } from "vitest";
import {
  csvCell,
  INITIATOR_WORDS,
  KIND_WORDS,
  shortNoticeThreshold,
} from "@/lib/office/notice-report";

// The notice report's pieces that need no database (src/lib/office/notice-report.ts).

describe("the notice report", () => {
  it("CSV cells: quoted when needed, and never run as a spreadsheet formula", () => {
    expect(csvCell("Ann Booker")).toBe("Ann Booker");
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell('Say "hi", then go')).toBe('"Say ""hi"", then go"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    for (const risky of ["=1+1", "+44", "-x", "-2+3", "@SUM(A1)", "\tTAB", "\rCR"]) {
      expect(csvCell(risky).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    // A plain number can't be a formula: a negative notice stays a number.
    expect(csvCell("-2.50")).toBe("-2.50");
    expect(csvCell(-2)).toBe("-2");
  });

  it("the firm's threshold: a number of hours from 1 to 720, or the 48-hour placeholder", () => {
    expect(shortNoticeThreshold({})).toEqual({ hours: 48, source: "default" });
    expect(shortNoticeThreshold({ short_notice_threshold_hours: 24 })).toEqual({
      hours: 24,
      source: "setting",
    });
    expect(shortNoticeThreshold({ short_notice_threshold_hours: 720 })).toMatchObject({
      source: "setting",
    });
    for (const bad of [0, 721, -5, "48", null]) {
      expect(shortNoticeThreshold({ short_notice_threshold_hours: bad })).toEqual({
        hours: 48,
        source: "invalid",
      });
    }
  });

  it("plain words for what happened and who started it", () => {
    expect(Object.values(KIND_WORDS)).toEqual([
      "Offered",
      "Booked",
      "Moved",
      "Shortened",
      "Cancelled",
    ]);
    expect(INITIATOR_WORDS).toEqual({
      worker: "The worker",
      office: "The firm (office)",
      rota_sheet: "The rota sheet",
      offer_wave: "An offer wave",
      firm: "The firm (planner or system)",
    });
  });
});

// The notice on the report's rows (Phase 26.10, fix-6): in days or hours, never the exact hours in
// brackets (the cancellation record, its PDF and the CSVs keep them).
describe("the report's notice words", () => {
  it("hours, days, and after the start; no hours in brackets", async () => {
    const { noticeWords } = await import("@/lib/office/notice-report");
    expect(noticeWords(22.89)).toBe("22 hours' notice");
    expect(noticeWords(48)).toBe("2 days' notice");
    expect(noticeWords(96)).toBe("4 days' notice");
    expect(noticeWords(-1.5)).toBe("After the start");
    for (const h of [0.5, 1, 22.89, 47.99, 48, 96, 300]) {
      expect(noticeWords(h)).not.toMatch(/\(|\d+\.\d+/);
    }
  });
});

// The office's rows, whole (Phase 28.4): the casual's shift record shares the report's row builder
// (src/lib/notices/record-rows.ts), and the office's rows must stay exactly as they were, key for
// key and in the same order. Each query row below is shaped as Postgres returns it (numerics as
// strings), one for every branch of the builder. Written against the builder before it was shared.
describe("the office's rows stay as they were (28.4's shared builder)", () => {
  const KEYS = [
    "eventId",
    "at",
    "kind",
    "initiator",
    "worker",
    "shift",
    "moved",
    "noticeHours",
    "noticeFromCurrentStart",
    "shortNotice",
    "reason",
    "askedBy",
  ];
  const at = "2026-11-02T08:00:00.000Z";
  const shift = {
    shift_id: "11111111-1111-4111-8111-111111111111",
    role: "door_supervisor",
    starts_at: new Date("2026-11-07T08:00:00Z"),
    site_name: "Riverside Arena",
  };
  const base = {
    actor_type: "system",
    created_at: at,
    notice: null,
    from_current: false,
    ...shift,
    first_name: "Ann",
    last_name: "Booker",
    override_reason: null,
    asked_by: null,
  };
  const theShift = {
    id: shift.shift_id,
    role: "door_supervisor",
    site: "Riverside Arena",
    startsAt: new Date("2026-11-07T08:00:00Z"),
  };
  const times = {
    oldStartsAt: "2026-11-07T06:00:00.000Z",
    oldEndsAt: "2026-11-07T14:00:00.000Z",
    newStartsAt: "2026-11-07T08:00:00.000Z",
    newEndsAt: "2026-11-07T16:00:00.000Z",
  };

  it("every kind, who started it, the notice, the flag, the reason and who asked: key for key", async () => {
    const { noticeRowOf } = await import("@/lib/office/notice-report");
    const cases: [Parameters<typeof noticeRowOf>[0], Record<string, unknown>][] = [
      [
        {
          ...base,
          id: "1",
          action: "offer.sent",
          data: { wave: 1, noticeHours: 125 },
          notice: "125",
        },
        { kind: "offered", initiator: "offer_wave", noticeHours: 125, shortNotice: false },
      ],
      [
        {
          ...base,
          id: "2",
          action: "offer.sent",
          data: { offeredBy: "22222222-2222-4222-8222-222222222222" },
          notice: "120.00",
          from_current: true,
        },
        { kind: "offered", initiator: "office", noticeHours: 120, noticeFromCurrentStart: true },
      ],
      [
        {
          ...base,
          id: "3",
          action: "shift.assigned",
          actor_type: "worker",
          data: { by: "worker", reason: "not logged for a worker" },
          notice: "124",
          override_reason: "never a worker's",
        },
        { kind: "booked", initiator: "worker", noticeHours: 124, reason: null },
      ],
      [
        {
          ...base,
          id: "4",
          action: "shift.assigned",
          actor_type: "office",
          data: { by: "firm", overridden: ["rest_too_short"], reasonGiven: true },
          notice: "30.5",
          override_reason: "Their manager said it's fine",
        },
        {
          kind: "booked",
          initiator: "office",
          noticeHours: 30.5,
          shortNotice: true,
          reason: "Their manager said it's fine",
        },
      ],
      [
        {
          ...base,
          id: "5",
          action: "shift.assigned",
          data: { by: "firm", source: "sheets", reason: "Put on the rota sheet by the office" },
          notice: "200",
          override_reason: "not this one: the log has a reason",
        },
        {
          kind: "booked",
          initiator: "rota_sheet",
          noticeHours: 200,
          reason: "Put on the rota sheet by the office",
        },
      ],
      [
        {
          ...base,
          id: "6",
          action: "shift.moved",
          actor_type: "office",
          data: {
            by: "firm",
            reason: "Weather or safety",
            ...times,
            oldSiteId: null,
            newSiteId: "33333333-3333-4333-8333-333333333333",
          },
          notice: "118",
        },
        {
          kind: "moved",
          initiator: "office",
          noticeHours: 118,
          reason: "Weather or safety",
          moved: {
            fromStart: new Date(times.oldStartsAt),
            fromEnd: new Date(times.oldEndsAt),
            toStart: new Date(times.newStartsAt),
            toEnd: new Date(times.newEndsAt),
            siteChanged: true,
          },
        },
      ],
      [
        {
          ...base,
          id: "7",
          action: "shift.curtailed",
          data: { by: "firm", ...times, newEndsAt: "not a time", reason: 7 },
          notice: "32.5",
        },
        { kind: "shortened", initiator: "firm", noticeHours: 32.5, shortNotice: true, moved: null },
      ],
      [
        {
          ...base,
          id: "8",
          action: "shift.cancelled",
          actor_type: "worker",
          data: { by: "worker", reason: "never logged" },
          notice: "20",
          asked_by: "casual",
        },
        {
          kind: "cancelled",
          initiator: "worker",
          noticeHours: 20,
          shortNotice: true,
          askedBy: "casual",
        },
      ],
      [
        {
          ...base,
          id: "9",
          action: "shift.cancelled",
          data: { reason: "The event was cancelled", askedBy: "unknown" },
          notice: "-2.00",
          asked_by: "unknown",
        },
        {
          kind: "cancelled",
          initiator: "firm",
          noticeHours: -2,
          shortNotice: true,
          reason: "The event was cancelled",
          askedBy: "unknown",
        },
      ],
      [
        {
          ...base,
          id: "10",
          action: "shift.weird",
          data: {},
          shift_id: null,
          role: null,
          starts_at: null,
          site_name: null,
          first_name: null,
          last_name: null,
        },
        { kind: "booked", initiator: "firm", worker: "Someone", shift: null },
      ],
    ];
    for (const [row, differs] of cases) {
      const got = noticeRowOf(row, 48);
      expect(Object.keys(got), row.action).toEqual(KEYS);
      expect(got, String(row.id)).toEqual({
        eventId: Number(row.id),
        at: new Date(at),
        kind: "booked",
        initiator: "firm",
        worker: "Ann Booker",
        shift: theShift,
        moved: null,
        noticeHours: null,
        noticeFromCurrentStart: false,
        shortNotice: false,
        reason: null,
        askedBy: null,
        ...differs,
      });
    }
  });
});
