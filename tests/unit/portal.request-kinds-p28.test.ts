import { describe, expect, it } from "vitest";
import { REQUEST_STATUSES, REQUEST_TYPES } from "@/lib/db/schema";
import { requestUpdateMessage } from "@/lib/messaging/templates";
import {
  BRIEFING_FIELDS,
  BRIEFING_WORDS,
  briefingFieldsOf,
  briefingWords,
  isBriefingField,
} from "@/lib/notices/briefing-fields";
import { eventWords } from "@/lib/office/event-words";
import { logTypeLabel } from "@/lib/office/log-types";
import {
  attendancePayload,
  attendancePayloadSchema,
  holdsContactDetails,
  KIND_NAMES,
  MAX_REQUEST_NOTE,
  STATUS_WORDS,
  statusWord,
} from "@/lib/portal/request-kinds";

// Phase 28.2's words and checks (src/lib/portal/request-kinds.ts, src/lib/notices/briefing-fields.ts,
// the action log's two new entries): the new request kind and status in plain words, never a raw
// code; the attendance question's payload; the closed list of briefing fields.

describe("request kinds and statuses in words", () => {
  it("names the attendance question and the taken-back status", () => {
    expect(KIND_NAMES.attendance).toBe("Attendance question");
    expect(STATUS_WORDS.withdrawn).toBe("Taken back");
    expect(statusWord("attendance", "withdrawn")).toBe("Taken back");
    expect(statusWord("time_change", "withdrawn")).toBe("Taken back");
  });

  it("an answered attendance question reads 'Answered', approved or declined: a request never changes a mark", () => {
    expect(statusWord("attendance", "approved")).toBe("Answered");
    expect(statusWord("attendance", "declined")).toBe("Answered");
    expect(statusWord("attendance", "open")).toBe("Waiting for the office");
    expect(statusWord("attendance", "escalated")).toBe("Waiting for the office");
    // The others keep their words.
    expect(statusWord("time_change", "approved")).toBe("Approved");
    expect(statusWord("swap", "declined")).toBe("Declined");
    expect(statusWord("general", "approved")).toBe("Answered");
  });

  it("every kind and status the table allows has words, never its code", () => {
    for (const type of REQUEST_TYPES) {
      expect(KIND_NAMES[type]).toMatch(/^[A-Z][a-z ]+$/);
      for (const status of REQUEST_STATUSES) {
        const word = statusWord(type, status);
        expect(word).not.toBe(status);
        expect(word).not.toMatch(/_/);
        expect(word).toMatch(/^[A-Z]/);
      }
    }
  });

  it("the office's answer to one reads 'is answered' in the request_update message", () => {
    const type = (KIND_NAMES.attendance ?? "").toLowerCase();
    expect(
      requestUpdateMessage(
        { name: "Acme", signOff: "Acme Shift Team" },
        {
          type,
          ref: "3F2A9C1B",
          status: statusWord("attendance", "declined").toLowerCase(),
          note: null,
        },
      ),
    ).toBe("Your request (attendance question, ref 3F2A9C1B) is answered. — Acme Shift Team");
  });
});

describe("the attendance question's payload", () => {
  it("takes what she said and an optional note", () => {
    expect(attendancePayload({ said: "worked", note: "  On gate 3.  " })).toEqual({
      said: "worked",
      note: "On gate 3.",
    });
    expect(attendancePayload({ said: "not_worked" })).toEqual({ said: "not_worked", note: "" });
  });

  it("refuses an unknown answer, extra fields, phone numbers, emails and anything over 500 characters", () => {
    expect(attendancePayload({ said: "maybe", note: "" })).toBeNull();
    expect(attendancePayload({ note: "" })).toBeNull();
    expect(
      attendancePayloadSchema.safeParse({ said: "worked", note: "", mark: "completed" }).success,
    ).toBe(false);
    for (const note of [
      "Ring me on 07700 900123",
      "+44 7700 900123 is my number",
      "email me at sam.booker@example.com",
      "x".repeat(MAX_REQUEST_NOTE + 1),
    ]) {
      expect(attendancePayload({ said: "worked", note })).toBeNull();
    }
    expect(
      attendancePayload({ said: "worked", note: "x".repeat(MAX_REQUEST_NOTE) }),
    ).not.toBeNull();
    // A time or a gate number isn't a phone number.
    expect(attendancePayload({ said: "worked", note: "Signed in at 09:58 at gate 12." })).toEqual({
      said: "worked",
      note: "Signed in at 09:58 at gate 12.",
    });
  });

  it("holdsContactDetails is the log masker's own test", () => {
    expect(holdsContactDetails("07700900123")).toBe(true);
    expect(holdsContactDetails("sam@example.com")).toBe(true);
    expect(holdsContactDetails("I was there all day")).toBe(false);
  });
});

describe("the briefing fields", () => {
  it("are a closed list, each with the casual's word", () => {
    expect(BRIEFING_FIELDS).toEqual([
      "instructions",
      "meetingPoint",
      "uniform",
      "post",
      "payRatePence",
      "requirements",
    ]);
    expect(BRIEFING_WORDS).toEqual({
      instructions: "instructions",
      meetingPoint: "meeting point",
      uniform: "uniform",
      post: "post",
      payRatePence: "pay",
      requirements: "what you need",
    });
  });

  it("never take places, the event's name, times, site or the sheet's override codes", () => {
    for (const field of [
      "headcount",
      "eventName",
      "event",
      "startsAt",
      "endsAt",
      "siteId",
      "role",
      "overridden",
    ]) {
      expect(isBriefingField(field)).toBe(false);
    }
    expect(
      briefingFieldsOf(["headcount", "uniform", "eventName", "instructions", "uniform", "siteId"]),
    ).toEqual(["instructions", "uniform"]);
    expect(briefingFieldsOf("instructions")).toEqual([]);
    expect(briefingFieldsOf(undefined)).toEqual([]);
  });

  it("read as a list in the casual's words", () => {
    expect(briefingWords([])).toBe("");
    expect(briefingWords(["instructions"])).toBe("instructions");
    expect(briefingWords(["payRatePence", "instructions"])).toBe("instructions and pay");
    expect(briefingWords(["requirements", "meetingPoint", "uniform"])).toBe(
      "meeting point, uniform and what you need",
    );
  });
});

describe("the action log's two new entries", () => {
  const names = { worker: () => "Ann Booker", office: () => "Sam Rota" };
  const say = (action: string, data: Record<string, unknown>) =>
    eventWords({ action, actorType: "worker", actorId: "w", data }, names);

  it("have plain words and a group", () => {
    expect(say("shift.still_coming", { assignmentId: "a", shiftId: "s", workerId: "w" })).toBe(
      "Ann Booker said they're still coming.",
    );
    expect(say("request.withdrawn", { type: "attendance", workerId: "w" })).toBe(
      "Ann Booker took back a request.",
    );
    expect(logTypeLabel("shift.still_coming")).toBe("Who worked");
    expect(logTypeLabel("request.withdrawn")).toBe("Requests");
  });

  it("an attendance question's request.created names the kind in words", () => {
    expect(say("request.created", { type: "attendance", shiftId: "s", said: "worked" })).toBe(
      "Ann Booker sent a request (attendance question).",
    );
  });
});
