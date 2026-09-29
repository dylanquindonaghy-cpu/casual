import { describe, expect, it } from "vitest";
import { eventWords, type Names } from "@/lib/office/event-words";
import {
  assignResultText,
  createProblems,
  createResultText,
  editResultText,
  importResultLines,
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
      "Ann Booker wasn't told: the shift is back to what they knew.",
    );
    expect(ev("something.new")).toBe("Recorded: something.new.");
  });
});

describe("the shift screens' words", () => {
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
      "Enter the start and finish as times, like 08:00. Enter a role, like steward (letters, numbers and spaces only).",
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
    expect(importResultLines({ status: "done", result: { ...result, dryRun: true } })).toEqual([
      "This file would add 2 shifts, change 1, leave 0 as they are and skip 1.",
      "Row 4: a time isn't a time we can read (use 09:00).",
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
    ).toBe("Ann is booked on this shift.");
    expect(
      assignResultText(
        { status: "booked", assignmentId: "a", slot: 1, overridden: ["rest"] },
        "Ann",
      ),
    ).toBe("Ann is booked on this shift. The override and your reason are in the log.");
    expect(assignResultText({ status: "invalid_reason" }, "Ann")).toBe(
      "Give a reason for the override (no phone numbers or email addresses).",
    );
  });
});
