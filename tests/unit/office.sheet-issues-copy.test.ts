import { describe, expect, it } from "vitest";
import { eventWords, type Names } from "@/lib/office/event-words";
import { sheetChangeText, sheetNameText } from "@/lib/office/today-copy";

// The dashboard's "From your rota sheet" (Needs attention; src/lib/office/today-copy.ts) and the sheet's refusals in the
// action log (event-words.ts), word for word as docs/screens.md gives them.

describe("From your rota sheet", () => {
  it("a change the rules refused, with who and why", () => {
    expect(
      sheetChangeText({
        fields: ["startsAt", "endsAt"],
        reason: "rules",
        people: [{ name: "Ada Example", codes: ["credential_expired"] }],
      }),
    ).toBe(
      "Your rota sheet changes its start and finish, but Ada Example (a licence or card out of date) can't work it: not changed here. Change the sheet back, or cancel that booking and the next sync makes the change.",
    );
  });

  it("a change to a shift that has started", () => {
    expect(sheetChangeText({ fields: ["endsAt", "status"], reason: "started", people: [] })).toBe(
      "Your rota sheet changes its finish and status, but the shift has started: not changed here.",
    );
  });

  it("names it couldn't book, and one taken out because every place was taken", () => {
    expect(
      sheetNameText({ name: "Ben Example", codes: ["credential_missing", "rest"], dropped: false }),
    ).toBe(
      "Ben Example is in your rota sheet but isn't booked: a licence or card missing and too little rest. The next sync tries again.",
    );
    expect(sheetNameText({ name: "Dee Example", codes: ["no_place"], dropped: true })).toBe(
      "Dee Example was in your rota sheet, but every place was taken: taken out of the sheet.",
    );
  });
});

describe("the sheet's refusals in the action log", () => {
  const names: Names = {
    worker: (id) => (id === "w1" ? "Ada Example" : "Someone"),
    office: () => "The office",
  };
  const ev = (action: string, data: Record<string, unknown>) =>
    eventWords({ action, actorType: "system", actorId: null, data }, names);

  it("says what wasn't changed and why", () => {
    expect(
      ev("roster.sheet_change_refused", {
        fields: ["role"],
        reason: "rules",
        workers: [{ workerId: "w1", codes: ["wrong_role"] }],
      }),
    ).toBe(
      "The rota sheet's change to the role wasn't made: Ada Example (not that role) can't work it.",
    );
    expect(ev("roster.sheet_change_refused", { fields: ["status"], reason: "started" })).toBe(
      "The rota sheet's change to the status wasn't made: the shift had started.",
    );
    expect(ev("roster.sheet_booking_refused", { workerId: "w1", codes: ["no_place"] })).toBe(
      "Ada Example is in the rota sheet but couldn't be booked: no place left.",
    );
  });
});
