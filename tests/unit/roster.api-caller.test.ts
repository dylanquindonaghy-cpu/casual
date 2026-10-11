import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { passesLogCheck } from "@/lib/events/record";
import { eventWords, type Names } from "@/lib/office/event-words";
import { howText, WHO_WORDS } from "@/lib/office/cancellations-copy";
import type { SessionRow } from "@/lib/office/events";
import { PLANNER_SESSION_WORDS, SHEET_SESSION_WORDS } from "@/lib/office/events-copy";
import {
  cancelBookingResultText,
  cancelShiftResultText,
  detailsResultText,
  editResultText,
  FROM_PLANNER_WORDS,
  moveResultLines,
} from "@/lib/office/shifts-copy";
import { closeResultText } from "@/lib/office/today-copy";
import {
  callerActor,
  callerMarks,
  firmCallerSchema,
  sourceRefusal,
} from "@/lib/roster/firm-caller";
import { moveShiftRequestSchema } from "@/lib/roster/firm-change";
import { cancelShiftRequestSchema } from "@/lib/roster/cancel";

// The firm's planner as a caller of the whole-session move and cancel (S11 (d); docs/office-v2.md
// 5.3.2; 12J.1): who may change which sessions, what its log entries carry, and the office's words
// for a session it sent. The menus use Next's router and server actions: stand-ins are given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));
vi.mock("@/app/office/today-actions", () => ({
  setUrgentAction: vi.fn(),
  closeShiftAction: vi.fn(),
  reopenShiftAction: vi.fn(),
}));

const { SessionItem } = await import("@/app/office/events/session-row");
const { ShiftActions } = await import("@/app/office/shift-actions");

const KEY = "0b5f3a6e-2c1d-4e8f-9a7b-6c5d4e3f2a1b";
const SHIFT = "11111111-1111-4111-8111-111111111111";
const WORKER = "22222222-2222-4222-8222-222222222222";
const OFFICE_USER = "33333333-3333-4333-8333-333333333333";
const PLANNER = "This session comes from your planner. Change it there.";

describe("the planner as a caller", () => {
  it("is named by its key's id only, and a key's own fields are refused", () => {
    expect(firmCallerSchema.parse({ type: "api", keyId: KEY.toUpperCase() })).toEqual({
      type: "api",
      keyId: KEY,
    });
    expect(firmCallerSchema.parse({ type: "office", id: OFFICE_USER })).toEqual({
      type: "office",
      id: OFFICE_USER,
    });
    for (const bad of [
      { type: "api", id: KEY },
      { type: "api", keyId: KEY, key: "shiftdesk_x" },
      { type: "api", keyId: "not-an-id" },
      { type: "office", keyId: KEY },
      { type: "system", keyId: KEY },
    ]) {
      expect(firmCallerSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("changes only the sessions it sent; the office every one but a sheet's or the planner's", () => {
    const api = { type: "api" as const, keyId: KEY };
    const office = { type: "office" as const, id: OFFICE_USER };
    expect(sourceRefusal("api", api)).toBeNull();
    for (const source of ["native", "sheets", "csv"] as const) {
      expect(sourceRefusal(source, api)).toEqual({ status: "not_found" });
    }
    expect(sourceRefusal("native", office)).toBeNull();
    expect(sourceRefusal("csv", office)).toBeNull();
    expect(sourceRefusal("sheets", office)).toEqual({ status: "sheet" });
    expect(sourceRefusal("api", office)).toEqual({ status: "planner" });
  });

  it("is logged as the system with {via: 'api', keyId}; the office as itself, unmarked", () => {
    const api = { type: "api" as const, keyId: KEY };
    expect(callerActor(api)).toEqual({ actorType: "system", actorId: null });
    expect(callerMarks(api)).toEqual({ via: "api", keyId: KEY });
    const office = { type: "office" as const, id: OFFICE_USER };
    expect(callerActor(office)).toEqual({ actorType: "office", actorId: OFFICE_USER });
    expect(callerMarks(office)).toEqual({});
  });

  it("moves to instants or to the office's local date and times; cancels with a reason from the list", () => {
    const base = { shiftId: SHIFT, reason: "event_changed", by: { type: "api", keyId: KEY } };
    expect(
      moveShiftRequestSchema.safeParse({
        ...base,
        startsAt: new Date("2026-11-07T10:00:00Z"),
        endsAt: new Date("2026-11-07T18:00:00Z"),
        siteId: null,
      }).success,
    ).toBe(true);
    expect(
      moveShiftRequestSchema.safeParse({
        ...base,
        date: "2026-11-07",
        start: "10:00",
        end: "18:00",
        siteId: "",
      }).success,
    ).toBe(true);
    // Not a mix of the two, nor an instant that isn't one.
    expect(
      moveShiftRequestSchema.safeParse({
        ...base,
        date: "2026-11-07",
        startsAt: new Date("2026-11-07T10:00:00Z"),
        endsAt: new Date("2026-11-07T18:00:00Z"),
        siteId: null,
      }).success,
    ).toBe(false);
    expect(
      moveShiftRequestSchema.safeParse({
        ...base,
        startsAt: new Date("not a time"),
        endsAt: new Date("2026-11-07T18:00:00Z"),
        siteId: null,
      }).success,
    ).toBe(false);
    expect(cancelShiftRequestSchema.safeParse({ ...base, reason: "weather" }).success).toBe(true);
    // One booking's own reason isn't a whole session's.
    expect(cancelShiftRequestSchema.safeParse({ ...base, reason: "not_available" }).success).toBe(
      false,
    );
  });

  it("every entry it writes passes the action log's check (docs/office-v2.md 6.1)", () => {
    const marks = { by: "firm", via: "api", keyId: KEY };
    expect(passesLogCheck(marks)).toBe(true);
    for (const data of [
      { ...marks, fields: ["startsAt", "endsAt"], reason: "The event's times or place changed" },
      {
        ...marks,
        shiftId: SHIFT,
        workerId: WORKER,
        reason: "The event's times or place changed",
        oldStartsAt: "2026-11-07T08:00:00.000Z",
        oldEndsAt: "2026-11-07T16:00:00.000Z",
        newStartsAt: "2026-11-07T10:00:00.000Z",
        newEndsAt: "2026-11-07T18:00:00.000Z",
        oldSiteId: null,
        newSiteId: null,
        noticeHours: 119,
        rulesOk: true,
      },
      { ...marks, reason: "Weather or safety", workers: [{ workerId: WORKER, codes: ["rest"] }] },
      {
        ...marks,
        shiftId: SHIFT,
        workerId: WORKER,
        reason: "The event was cancelled",
        noticeHours: 119,
        strike: "by_firm",
        place: "session_cancelled",
      },
      { ...marks, reason: "The event was cancelled", bookings: 2 },
    ]) {
      expect(passesLogCheck(data)).toBe(true);
    }
  });
});

describe("the office's words for the planner", () => {
  const names: Names = {
    worker: (id) => (id === WORKER ? "Ann Booker" : "Someone"),
    office: (id) => (id === OFFICE_USER ? "Sam Rota" : "The office"),
  };
  const planner = (action: string, data: Record<string, unknown> = {}) =>
    eventWords(
      {
        action,
        actorType: "system",
        actorId: null,
        data: { by: "firm", via: "api", keyId: KEY, ...data },
      },
      names,
    );

  it("the action log says 'your planner' for its changes", () => {
    expect(planner("shift.created")).toBe("Created by your planner.");
    expect(planner("shift.changed", { fields: ["startsAt", "endsAt"] })).toBe(
      "Your planner: Changed the start and finish.",
    );
    expect(
      planner("shift.moved", {
        workerId: WORKER,
        noticeHours: 119,
        reason: "The event's times or place changed",
      }),
    ).toBe(
      "Your planner moved Ann Booker's shift, with 4 days' notice. Reason: The event's times or place changed.",
    );
    expect(planner("shift.curtailed", { workerId: WORKER, noticeHours: 119 })).toBe(
      "Your planner shortened Ann Booker's shift, with 4 days' notice.",
    );
    expect(
      planner("shift.move_refused", { workers: [{ workerId: WORKER, codes: ["rest"] }] }),
    ).toBe(
      "Your planner tried to move the shift. Not moved: someone booked can't work the new time.",
    );
    expect(
      planner("shift.cancelled", {
        workerId: WORKER,
        noticeHours: 119,
        reason: "The event was cancelled",
        strike: "by_firm",
      }),
    ).toBe(
      "Your planner cancelled Ann Booker, with 4 days' notice. Reason: The event was cancelled.",
    );
    expect(planner("shift.cancelled_by_firm", { reason: "Weather or safety", bookings: 2 })).toBe(
      "Your planner cancelled the shift. Reason: Weather or safety.",
    );
    // The office's own changes are still its own.
    expect(
      eventWords(
        {
          action: "shift.cancelled_by_firm",
          actorType: "office",
          actorId: OFFICE_USER,
          data: { by: "firm", reason: "Weather or safety", bookings: 2 },
        },
        names,
      ),
    ).toBe("Sam Rota cancelled the shift. Reason: Weather or safety.");
  });

  it("the office's refusals for a session from the planner", () => {
    expect(FROM_PLANNER_WORDS).toBe(PLANNER);
    expect(PLANNER_SESSION_WORDS).toBe(PLANNER);
    const refused = { status: "planner" as const };
    expect(editResultText(refused)).toBe(PLANNER);
    expect(detailsResultText(refused)).toBe(PLANNER);
    expect(moveResultLines(refused)).toEqual([PLANNER]);
    expect(cancelShiftResultText(refused)).toBe(PLANNER);
    expect(closeResultText(refused)).toBe(PLANNER);
    expect(cancelBookingResultText({ status: "keeps_place", why: "planner" }, "Ann Booker")).toBe(
      "This session's places come from your planner, so change them there. Nothing was changed.",
    );
    // The sheet's own words are unchanged.
    expect(cancelBookingResultText({ status: "keeps_place", why: "sheet" }, "Ann Booker")).toBe(
      "This shift's places come from your rota sheet, so change them there. Nothing was changed.",
    );
  });

  it("a cancellation record made by the planner", () => {
    expect(
      howText({ by: "planner", via: "api", officeName: null, reason: "Weather or safety" }),
    ).toBe("By your planner");
    expect(WHO_WORDS.planner).toBe("planner");
  });

  const html = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(node).replace(/&#x27;|&#39;/g, "'");
  const session = (o: Partial<SessionRow> = {}): SessionRow => ({
    shiftId: SHIFT,
    role: "steward",
    startsAt: new Date("2026-11-07T10:00:00Z"),
    endsAt: new Date("2026-11-07T18:00:00Z"),
    status: "open",
    headcount: 2,
    booked: 1,
    isUrgent: false,
    urgentGap: false,
    showing: true,
    payRatePence: null,
    post: null,
    meetingPoint: null,
    uniform: null,
    requirements: [],
    fromSheet: false,
    fromPlanner: true,
    started: false,
    ended: false,
    ...o,
  });

  it("a session's menu sends the office to the planner, but still offers, assigns and marks urgent", () => {
    const menu = (s: SessionRow) =>
      html(
        createElement(SessionItem, {
          session: s,
          timeZone: "Europe/London",
          withDay: false,
          eventShowing: true,
        }),
      );
    const fromPlanner = menu(session());
    expect(fromPlanner).toContain(PLANNER_SESSION_WORDS);
    expect(fromPlanner).not.toContain(SHEET_SESSION_WORDS);
    expect(fromPlanner).not.toContain("Change or cancel");
    for (const kept of ["Open this session", "Offer a place", "Assign someone", "Mark urgent"]) {
      expect(fromPlanner).toContain(kept);
    }
    expect(menu(session({ fromPlanner: false }))).toContain("Change or cancel");
  });

  it("the dashboard's quick actions leave out Mark as filled", () => {
    const actions = (fromSheet: boolean, fromPlanner: boolean) =>
      html(createElement(ShiftActions, { shiftId: SHIFT, isUrgent: true, fromSheet, fromPlanner }));
    expect(actions(false, true)).not.toContain("Mark as filled");
    expect(actions(true, false)).not.toContain("Mark as filled");
    expect(actions(false, false)).toContain("Mark as filled");
    expect(actions(false, true)).toContain("Offer to someone");
  });
});
