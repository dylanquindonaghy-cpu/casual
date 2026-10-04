import { describe, expect, it } from "vitest";
import { eventWords, type Names } from "@/lib/office/event-words";
import {
  assignResultText,
  attendanceResultText,
  createProblems,
  createResultText,
  editResultText,
  importResultLines,
  restWorkedResultText,
} from "@/lib/office/shifts-copy";

// The office's shift screens in plain words (src/lib/office/shifts-copy.ts) and a shift's history
// (src/lib/office/event-words.ts).

const names: Names = {
  worker: (id) => (id === "w1" ? "Ann Booker" : "Someone"),
  office: (id) => (id === "o1" ? "Sam Rota" : "The office"),
};
const ev = (
  action: string,
  data: Record<string, unknown> = {},
  actorType = "system",
  actorId: string | null = null,
) => eventWords({ action, actorType, actorId, data }, names);

describe("a shift's history", () => {
  it("says who did what", () => {
    expect(ev("shift.created", { by: "firm" }, "office", "o1")).toBe("Created by Sam Rota.");
    expect(
      ev("shift.changed", { by: "firm", fields: ["startsAt", "headcount"] }, "office", "o1"),
    ).toBe("Sam Rota: Changed the start and places.");
    // A booking cancelled because the client needs fewer staff took its place away.
    expect(
      ev(
        "shift.changed",
        {
          by: "firm",
          fields: ["headcount"],
          from: { headcount: 3 },
          to: { headcount: 2 },
          reason: "The client needs fewer staff",
        },
        "office",
        "o1",
      ),
    ).toBe("Sam Rota: Changed the places from 3 to 2. Reason: The client needs fewer staff.");
    expect(ev("shift.assigned", { by: "worker", workerId: "w1" }, "worker", "w1")).toBe(
      "Ann Booker took it.",
    );
    expect(
      ev(
        "shift.assigned",
        { by: "firm", workerId: "w1", overridden: ["unavailable", "rest"], reason: "Rang in" },
        "office",
        "o1",
      ),
    ).toBe(
      "Sam Rota placed Ann Booker. Allowed despite: marked as a day off and too little rest. Reason: Rang in",
    );
    // From Phase 10 the words stay on the booking (the shift's page), not in the log.
    expect(
      ev(
        "shift.assigned",
        { by: "firm", workerId: "w1", overridden: ["rest"], reasonGiven: true },
        "office",
        "o1",
      ),
    ).toBe(
      "Sam Rota placed Ann Booker. Allowed despite: too little rest. The office gave a reason (shown with the booking until it's cleared).",
    );
    expect(
      ev("shift.cancelled", { by: "worker", workerId: "w1", noticeHours: 5 }, "worker", "w1"),
    ).toBe("Ann Booker cancelled, with 5 hours' notice.");
    expect(
      ev("shift.cancelled", { by: "firm", workerId: "w1", noticeHours: 50 }, "office", "o1"),
    ).toBe("Sam Rota cancelled Ann Booker, with 2 days' notice.");
    expect(ev("shift.marked_urgent", { cause: "dropout" })).toBe("Marked urgent after a dropout.");
    expect(ev("offer.sent", { workerId: "w1", wave: 2 })).toBe("Offered to Ann Booker (wave 2).");
    expect(ev("offer.sent", { workerId: "w1", offeredBy: "o1" })).toBe(
      "Sam Rota offered it to Ann Booker.",
    );
    expect(ev("shift.closed", {}, "office", "o1")).toBe("Sam Rota marked it as filled.");
    expect(
      ev(
        "shift.moved",
        { workerId: "w1", noticeHours: 30, reason: "Weather or safety" },
        "office",
        "o1",
      ),
    ).toBe("Sam Rota moved Ann Booker's shift, with 30 hours' notice. Reason: Weather or safety.");
    expect(
      ev(
        "shift.moved",
        { workerId: "w1", noticeHours: 30, rulesOk: false, codes: ["unavailable"] },
        "office",
        "o1",
      ),
    ).toBe(
      "Sam Rota moved Ann Booker's shift, with 30 hours' notice. The rules said they may not be able to work the new time.",
    );
    expect(
      ev(
        "shift.move_refused",
        { workers: [{ workerId: "w1", codes: ["credential_expired"] }] },
        "office",
        "o1",
      ),
    ).toBe("Sam Rota tried to move the shift. Not moved: someone booked can't work the new time.");
    expect(ev("shift.curtailed", { workerId: "w1", noticeHours: 2 }, "office", "o1")).toBe(
      "Sam Rota shortened Ann Booker's shift, with 2 hours' notice.",
    );
    expect(
      ev("shift.cancelled_by_firm", { reason: "The event was cancelled" }, "office", "o1"),
    ).toBe("Sam Rota cancelled the shift. Reason: The event was cancelled.");
    expect(
      ev(
        "shift.cancelled",
        { by: "firm", workerId: "w1", noticeHours: 50, reason: "Weather or safety" },
        "office",
        "o1",
      ),
    ).toBe("Sam Rota cancelled Ann Booker, with 2 days' notice. Reason: Weather or safety.");
    expect(ev("shift.change_notice_sent", { workerId: "w1" })).toBe(
      "Ann Booker was told about the change.",
    );
    expect(ev("shift.change_notice_skipped", { workerId: "w1", reason: "unchanged" })).toBe(
      "Ann Booker wasn't told: the shift is as they last heard it.",
    );
    expect(ev("shift.completed", { workerId: "w1", from: "confirmed" }, "office", "o1")).toBe(
      "Sam Rota marked Ann Booker as worked.",
    );
    expect(ev("shift.no_show", { workerId: "w1", from: "confirmed" }, "office", "o1")).toBe(
      "Sam Rota marked Ann Booker as not attended.",
    );
    expect(ev("shift.completed", { workerId: "w1", from: "no_show" }, "office", "o1")).toBe(
      "Sam Rota marked Ann Booker as worked (was: not attended).",
    );
    expect(ev("shift.no_show", { workerId: "w1", from: "completed" }, "office", "o1")).toBe(
      "Sam Rota marked Ann Booker as not attended (was: worked).",
    );
    expect(ev("something.new")).toBe("Recorded: something.new.");
  });
});

describe("the shift screens' words", () => {
  it("who worked it", () => {
    const marked = (outcome: "completed" | "no_show") =>
      attendanceResultText({ status: "marked", outcome, from: "confirmed" }, "Ann Booker");
    expect(marked("completed")).toBe("Marked Ann Booker as worked.");
    expect(marked("no_show")).toBe("Marked Ann Booker as not attended.");
    expect(attendanceResultText({ status: "unchanged" }, "Ann Booker")).toBe(
      "Ann Booker is already marked that way.",
    );
    expect(attendanceResultText({ status: "not_started" }, "Ann Booker")).toBe(
      "This shift hasn't started yet.",
    );
    expect(attendanceResultText({ status: "not_booked" }, "Ann Booker")).toBe(
      "Ann Booker isn't booked on this shift any more.",
    );
    expect(attendanceResultText({ status: "not_allowed" }, "Ann Booker")).toBe(
      "You can't change shifts.",
    );
    expect(restWorkedResultText({ status: "marked", count: 1 })).toBe("Marked 1 person as worked.");
    expect(restWorkedResultText({ status: "marked", count: 3 })).toBe("Marked 3 people as worked.");
    expect(restWorkedResultText({ status: "marked", count: 0 })).toBe(
      "Everyone was already marked.",
    );
    expect(restWorkedResultText({ status: "not_ended" })).toBe(
      "This shift hasn't ended yet. Mark each person instead.",
    );
  });

  it("creating", () => {
    expect(createResultText({ status: "created", shiftIds: ["a"] })).toBe("Shift created.");
    expect(createResultText({ status: "created", shiftIds: ["a", "b", "c"] })).toBe(
      "3 shifts created.",
    );
    const invalid = {
      status: "invalid" as const,
      problems: [
        { line: null, problem: "bad_date" as const },
        { line: 2, problem: "in_past" as const },
      ],
    };
    expect(createResultText(invalid)).toBe("Check the form: nothing has been saved.");
    expect(createProblems(invalid)).toEqual([
      "Choose a date.",
      "Line 2: That start time has already passed.",
    ]);
  });

  it("editing", () => {
    expect(editResultText({ status: "saved", fields: ["headcount"] })).toBe("Saved.");
    expect(editResultText({ status: "has_bookings" })).toMatch(/^People are booked on this shift/);
    expect(editResultText({ status: "invalid", problems: ["bad_time", "bad_role"] })).toBe(
      "Enter the start and finish as times, like 08:00. They can't be the same, 24 hours or more apart, or in the hour the clocks skip in March. Enter a role, like steward (letters, numbers and spaces only).",
    );
  });

  it("importing", () => {
    const result = {
      kind: "shifts" as const,
      created: 2,
      updated: 1,
      unchanged: 0,
      skipped: 1,
      problems: [{ row: 4, problem: "bad_time" as const }],
    };
    expect(importResultLines({ status: "agreement_needed" })).toEqual([
      "Nothing was saved: real staff data can be imported once your firm's agreement and data processing agreement with us are signed and recorded. Ask us to record them. You can still check a file.",
    ]);
    expect(importResultLines({ status: "done", result: { ...result, dryRun: true } })).toEqual([
      "This file would add 2 shifts, change 1, leave 0 as they are and skip 1.",
      "Row 4: the start or finish isn't a time we can read (use 09:00), or they're the same, 24 hours or more apart, or in the hour the clocks skip in March.",
    ]);
    expect(importResultLines({ status: "done", result: { ...result, dryRun: false } })[0]).toBe(
      "Imported: 2 shifts added, 1 changed, 0 left as they were, 1 skipped.",
    );
    expect(importResultLines({ status: "file_error", code: "missing_column" })).toEqual([
      "A column the import needs is missing. Check the header row.",
    ]);
  });

  it("assigning", () => {
    expect(
      assignResultText({ status: "booked", assignmentId: "a", slot: 1, overridden: [] }, "Ann"),
    ).toBe("Ann is booked on this shift. They'll get a message to say so.");
    expect(
      assignResultText(
        { status: "booked", assignmentId: "a", slot: 1, overridden: ["rest"] },
        "Ann",
      ),
    ).toBe(
      "Ann is booked on this shift. They'll get a message to say so. The override is in the log, and your reason is kept with the booking.",
    );
    expect(assignResultText({ status: "invalid_reason" }, "Ann")).toBe(
      "Give a reason for the override (no phone numbers or email addresses).",
    );
  });
});
