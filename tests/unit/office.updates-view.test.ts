import { describe, expect, it } from "vitest";
import type { PageUpdate } from "@/lib/office/updates";
import {
  coverPercent,
  KIND_WORDS,
  lowCoverLine,
  lowCoverWhen,
  nothingText,
  PERIOD_HEADINGS,
  PERIOD_WORDS,
  summaryLine,
  updateRow,
} from "@/lib/office/updates-copy";
import {
  dayLabel,
  DEFAULT_VIEW,
  eventChoices,
  groupByDay,
  inKind,
  kindsFor,
  orderLowCover,
  parseUpdatesView,
  periodStart,
  UPDATE_KINDS,
  UPDATE_PERIODS,
  updatesViewHref,
  type LowCover,
} from "@/lib/office/updates-view";

// Updates you can filter (Phase 36.2; docs/screens.md "## Phase 36", 36.2): the view in the
// address (how far back, which event, what kind), where each period starts, which update is which
// kind and who sees which chip, the list grouped by day, the new kinds' lines and "Low on cover"'s
// order and words. NOW is Monday 2 November 2026, 09:00 London (GMT).

const TZ = "Europe/London";
const NOW = new Date("2026-11-02T09:00:00Z");
const at = (iso: string) => new Date(iso);
const EVENT = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

const openSoon: PageUpdate = {
  kind: "open-soon",
  at: at("2026-11-02T14:00:00Z"),
  shiftId: "s1",
  role: "steward",
  site: "Arena",
  startsAt: at("2026-11-02T14:00:00Z"),
  placesFree: 2,
  urgent: true,
  offers: 0,
  eventId: EVENT,
  event: "Rovers v Visitors",
};
const cancelled = (reopened: boolean, when = "2026-11-02T08:10:00Z"): PageUpdate => ({
  kind: "cancelled",
  at: at(when),
  shiftId: "s2",
  ref: "a2",
  worker: "Mo Rahman",
  role: "door_supervisor",
  site: "Arena",
  startsAt: at("2026-11-04T18:00:00Z"),
  noticeHours: 58,
  strike: null,
  reopened,
  eventId: OTHER,
  event: "Arena Night",
});
const took: PageUpdate = {
  kind: "took",
  at: at("2026-11-01T22:00:00Z"),
  shiftId: "s3",
  worker: "Ben Fraser",
  role: "steward",
  site: null,
  startsAt: at("2026-11-07T10:00:00Z"),
  placesFree: 0,
  eventId: EVENT,
  event: "Rovers v Visitors",
};
const upload: PageUpdate = {
  kind: "upload",
  at: at("2026-10-30T19:03:00Z"),
  workerId: "w1",
  worker: "Zoe Adeyemi",
  what: "photo",
};
const toMark: PageUpdate = {
  kind: "to-mark",
  at: at("2026-10-28T16:00:00Z"),
  shiftId: "s4",
  role: "steward",
  site: "Arena",
  startsAt: at("2026-10-28T08:00:00Z"),
  unmarked: 3,
};
const noReply: PageUpdate = {
  kind: "no-reply",
  at: at("2026-10-31T10:00:00Z"),
  oldest: at("2026-10-31T09:00:00Z"),
  offers: 4,
  sessions: 2,
};
const pay: PageUpdate = {
  kind: "pay-query",
  at: at("2026-11-01T16:10:00Z"),
  id: "q1",
  worker: "Ana Pay",
  issue: "missing_hours",
  workDate: "2026-10-31",
};
const enquiry: PageUpdate = {
  kind: "enquiry",
  at: at("2026-11-02T07:30:00Z"),
  messageId: "m1",
  who: "Unknown number",
  channel: "whatsapp",
};
const request: PageUpdate = {
  kind: "app-request",
  at: at("2026-11-02T06:00:00Z"),
  requestId: "r1",
  worker: "Kim Ask",
  type: "time_change",
  eventId: EVENT,
  event: "Rovers v Visitors",
};
const ALL = [openSoon, toMark, noReply, cancelled(true), enquiry, request, took, pay, upload];

describe("the view in the address", () => {
  it("defaults: the last 7 days, every event, Needs action", () => {
    expect(parseUpdatesView({})).toEqual({ period: "7", eventId: null, kind: "action" });
    expect(DEFAULT_VIEW).toEqual({ period: "7", eventId: null, kind: "action" });
    expect(updatesViewHref(DEFAULT_VIEW)).toBe("/office/updates");
  });

  it("reads each choice, and anything it doesn't know falls back to its default", () => {
    expect(parseUpdatesView({ days: "30", event: EVENT, kind: "cancellations" })).toEqual({
      period: "30",
      eventId: EVENT,
      kind: "cancellations",
    });
    expect(parseUpdatesView({ days: "today", kind: "pay" })).toEqual({
      period: "today",
      eventId: null,
      kind: "pay",
    });
    // Not a period, not an event's id, not a kind.
    expect(parseUpdatesView({ days: "14", event: "'; drop table", kind: "secrets" })).toEqual(
      DEFAULT_VIEW,
    );
    // An id in capitals is the same event.
    expect(parseUpdatesView({ event: EVENT.toUpperCase() }).eventId).toBe(EVENT);
    // Repeated: the first.
    expect(parseUpdatesView({ days: ["3", "30"] }).period).toBe("3");
    // The old link to Everything still opens it.
    expect(parseUpdatesView({ view: "everything" }).kind).toBe("everything");
    expect(parseUpdatesView({ view: "everything", kind: "uploads" }).kind).toBe("uploads");
  });

  it("writes only what isn't the default, so a link opens the same view", () => {
    expect(updatesViewHref({ period: "3", eventId: null, kind: "action" })).toBe(
      "/office/updates?days=3",
    );
    const href = updatesViewHref({ period: "today", eventId: EVENT, kind: "to-fill" });
    expect(href).toBe(`/office/updates?days=today&event=${EVENT}&kind=to-fill`);
    const back = parseUpdatesView(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(back).toEqual({ period: "today", eventId: EVENT, kind: "to-fill" });
  });

  it("where each period starts: today at the firm's midnight; else that many 24 hours back", () => {
    expect(periodStart("today", NOW, TZ)).toEqual(at("2026-11-02T00:00:00Z"));
    expect(periodStart("3", NOW, TZ)).toEqual(at("2026-10-30T09:00:00Z"));
    expect(periodStart("7", NOW, TZ)).toEqual(at("2026-10-26T09:00:00Z"));
    expect(periodStart("30", NOW, TZ)).toEqual(at("2026-10-03T09:00:00Z"));
    // In summer time, the firm's midnight is 23:00 the day before (UTC).
    expect(periodStart("today", at("2026-07-01T09:00:00Z"), TZ)).toEqual(
      at("2026-06-30T23:00:00Z"),
    );
  });
});

describe("the kinds", () => {
  it("the chips in order (client requests after Needs action: Phase 36.4), each with its words", () => {
    expect(UPDATE_KINDS).toEqual([
      "action",
      "client-requests",
      "to-fill",
      "cancellations",
      "pay",
      "uploads",
      "enquiries",
      "everything",
    ]);
    expect(UPDATE_KINDS.map((k) => KIND_WORDS[k])).toEqual([
      "Needs action",
      "Client requests",
      "Still to fill",
      "Cancellations",
      "Pay queries",
      "Uploads",
      "Enquiries",
      "Everything",
    ]);
    expect(UPDATE_PERIODS.map((p) => PERIOD_WORDS[p])).toEqual([
      "Today",
      "3 days",
      "7 days",
      "30 days",
    ]);
    expect(UPDATE_PERIODS.map((p) => PERIOD_HEADINGS[p])).toEqual([
      "Today",
      "Last 3 days",
      "Last 7 days",
      "Last 30 days",
    ]);
  });

  it("which update is which kind", () => {
    const of = (k: (typeof UPDATE_KINDS)[number]) =>
      ALL.filter((u) => inKind(u, k)).map((u) => u.kind);
    // Needs action as always (the 08:00 summary lists the same): pay queries are payroll's, and
    // enquiries have their own chip and the menu's count.
    expect(of("action")).toEqual(["open-soon", "to-mark", "cancelled", "upload"]);
    expect(inKind(cancelled(false), "action")).toBe(false);
    expect(of("to-fill")).toEqual(["open-soon"]);
    expect(of("cancellations")).toEqual(["cancelled"]);
    expect(inKind(cancelled(false), "cancellations")).toBe(true);
    expect(of("pay")).toEqual(["pay-query"]);
    expect(of("uploads")).toEqual(["upload"]);
    expect(of("enquiries")).toEqual(["enquiry", "app-request"]);
    expect(of("everything")).toHaveLength(ALL.length);
  });

  it("who sees which chip: pay queries for those who may see them, enquiries for those who answer them", () => {
    expect(kindsFor({ pay: true, enquiries: true })).toEqual([...UPDATE_KINDS]);
    // A resourcer: no pay queries.
    expect(kindsFor({ pay: false, enquiries: true })).not.toContain("pay");
    // Client requests: everyone who sees Updates may answer them (admins and resourcers).
    expect(kindsFor({ pay: false, enquiries: false })).toEqual([
      "action",
      "client-requests",
      "to-fill",
      "cancellations",
      "uploads",
      "everything",
    ]);
  });

  it("the event filter's choices: the events with something in the period, by name, once each", () => {
    expect(eventChoices(ALL)).toEqual([
      { id: OTHER, name: "Arena Night" },
      { id: EVENT, name: "Rovers v Visitors" },
    ]);
    expect(eventChoices([upload, pay, enquiry])).toEqual([]);
  });
});

describe("grouped by day", () => {
  it("Today (with what stands now), Yesterday, then each day before, newest first", () => {
    const groups = groupByDay(ALL, NOW, TZ);
    expect(groups.map((g) => [g.label, g.items.map((u) => u.kind)])).toEqual([
      // Still to fill, to mark and no reply are how things stand: under Today, in the order given.
      ["Today", ["open-soon", "to-mark", "no-reply", "cancelled", "enquiry", "app-request"]],
      ["Yesterday", ["took", "pay-query"]],
      ["Fri 30 Oct", ["upload"]],
    ]);
    expect(groupByDay([], NOW, TZ)).toEqual([]);
  });

  it("a day's words", () => {
    expect(dayLabel("2026-11-02", "2026-11-02")).toBe("Today");
    expect(dayLabel("2026-11-01", "2026-11-02")).toBe("Yesterday");
    expect(dayLabel("2026-10-31", "2026-11-02")).toBe("Sat 31 Oct");
    expect(dayLabel("2026-10-04", "2026-11-02")).toBe("Sun 4 Oct");
    // Across a month's end, yesterday is still yesterday.
    expect(dayLabel("2026-10-31", "2026-11-01")).toBe("Yesterday");
  });
});

describe("the new kinds' lines and buttons", () => {
  it("a pay query, an enquiry for a person and a request in the app", () => {
    expect(updateRow(pay, NOW, TZ)).toEqual({
      title: "Ana Pay asked about pay: hours missing",
      line: "For Sat 31 Oct · with payroll",
      tone: "wait",
      href: "/office/pay-queries",
      action: { label: "Open pay queries", href: "/office/pay-queries" },
    });
    expect(updateRow(enquiry, NOW, TZ)).toEqual({
      title: "Unknown number needs an answer",
      line: "WhatsApp · waiting for a person",
      tone: "attention",
      href: "/office/enquiries/m1",
      action: { label: "Reply", href: "/office/enquiries/m1" },
    });
    expect(updateRow(request, NOW, TZ)).toEqual({
      title: "Kim Ask asked: time change",
      line: "In the app · waiting for an answer · Rovers v Visitors",
      tone: "attention",
      href: "/office/enquiries?view=app",
      action: { label: "Answer", href: "/office/enquiries?view=app" },
    });
    // The 08:00 summary never names a casual.
    for (const u of [pay, enquiry, request])
      expect(summaryLine(u, NOW, TZ)).not.toMatch(/Ana|Kim|Unknown/);
  });

  it("what an empty list says, for each kind and period", () => {
    expect(nothingText("action", "7", false)).toBe(
      "Nothing needs action. Cancellations with a place open again, places still open near their start and uploads to check show here.",
    );
    expect(nothingText("action", "7", true)).toBe("Nothing needs action for this event.");
    expect(nothingText("to-fill", "today", false)).toBe(
      "No places still to fill in the next 48 hours.",
    );
    expect(nothingText("cancellations", "3", true)).toBe(
      "No cancellations in the last 3 days for this event.",
    );
    expect(nothingText("pay", "30", false)).toBe(
      "No pay queries waiting, sent in the last 30 days.",
    );
    expect(nothingText("uploads", "today", false)).toBe("No uploads to check today.");
    expect(nothingText("enquiries", "7", false)).toBe(
      "No enquiries waiting for a person in the last 7 days.",
    );
    expect(nothingText("everything", "today", false)).toBe("Nothing today.");
  });
});

describe("Low on cover", () => {
  const row = (o: Partial<LowCover> & { eventId: string }): LowCover => ({
    name: o.eventId,
    firstStart: at("2026-11-05T12:00:00Z"),
    needed: 10,
    booked: 5,
    toFill: 5,
    ...o,
  });

  it("least covered first, then the soonest, then by name; covered events left out", () => {
    const ordered = orderLowCover([
      row({ eventId: "half-later", firstStart: at("2026-11-07T12:00:00Z") }),
      row({ eventId: "covered", booked: 10, toFill: 0 }),
      row({ eventId: "nearly", needed: 86, booked: 71, toFill: 15 }),
      row({ eventId: "empty", needed: 6, booked: 0, toFill: 6 }),
      row({ eventId: "half-soon", firstStart: at("2026-11-03T12:00:00Z") }),
      row({ eventId: "b-half", name: "B", firstStart: at("2026-11-07T12:00:00Z") }),
    ]);
    expect(ordered.map((r) => r.eventId)).toEqual([
      "empty",
      "half-soon",
      "b-half",
      "half-later",
      "nearly",
    ]);
  });

  it("its words: booked of needed and to fill; when, soon within 2 days; its bar", () => {
    expect(lowCoverLine({ booked: 71, needed: 86, toFill: 15 })).toBe(
      "71 of 86 places booked · 15 to fill",
    );
    expect(lowCoverLine({ booked: 0, needed: 1, toFill: 1 })).toBe(
      "0 of 1 place booked · 1 to fill",
    );
    expect(lowCoverWhen(at("2026-11-03T02:00:00Z"), NOW, TZ)).toEqual({
      words: "Tue 3 Nov · in 17 h",
      soon: true,
    });
    expect(lowCoverWhen(at("2026-11-07T12:00:00Z"), NOW, TZ)).toEqual({
      words: "Sat 7 Nov",
      soon: false,
    });
    expect(coverPercent({ booked: 71, needed: 86 })).toBe(82);
    expect(coverPercent({ booked: 0, needed: 0 })).toBe(100);
  });
});
