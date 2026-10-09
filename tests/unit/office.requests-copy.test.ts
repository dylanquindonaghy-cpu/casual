import { describe, expect, it } from "vitest";
import type { QueueRequest } from "@/lib/office/request-queue";
import {
  answeredBy,
  answerResultText,
  approveHint,
  askedLines,
  kindName,
  toldText,
} from "@/lib/office/requests-copy";

// The office's requests page in plain words (src/lib/office/requests-copy.ts).

const request = (o: Partial<QueueRequest> = {}): QueueRequest => ({
  requestId: "11111111-1111-4111-8111-111111111111",
  ref: "11111111",
  type: "time_change",
  status: "open",
  worker: { id: "w", name: "Ann Booker", firstName: "Ann" },
  shift: null,
  asked: {
    start: null,
    end: null,
    swapWith: null,
    reasons: [],
    cancellation: null,
    note: null,
    voicemail: false,
  },
  createdAt: new Date("2026-11-02T09:00:00Z"),
  answer: null,
  ...o,
});
const asked = (o: Partial<QueueRequest["asked"]>) => ({
  start: null,
  end: null,
  swapWith: null,
  reasons: [],
  cancellation: null,
  note: null,
  voicemail: false,
  ...o,
});

describe("the requests page's words", () => {
  it("what they asked", () => {
    expect(
      askedLines(request({ asked: asked({ start: "13:00", end: "18:30", note: "Train." }) })),
    ).toEqual(["Asks for 13:00 to 18:30.", "Their note: Train."]);
    expect(askedLines(request({ type: "swap", asked: asked({ swapWith: "Cal Jones" }) }))).toEqual([
      "Could swap with: Cal Jones.",
    ]);
    expect(askedLines(request({ type: "swap" }))).toEqual(["Asks to swap (no one named)."]);
    expect(
      askedLines(request({ type: "review", asked: asked({ reasons: ["Your licence expired."] }) })),
    ).toEqual([
      "Asks the office to look again at a shift the rules refused. The rules said:",
      "• Your licence expired.",
    ]);
    // "Tell us what happened" after cancelling (12C.1): the booking's reference, then their words.
    expect(
      askedLines(
        request({
          type: "review",
          asked: asked({ cancellation: "4F2A9C1B", note: "The bus didn't come." }),
        }),
      ),
    ).toEqual([
      "Tells the office what happened when they cancelled (reference 4F2A9C1B).",
      "Their note: The bus didn't come.",
    ]);
    expect(approveHint("review", "4F2A9C1B")).toBe("Answering doesn't change a strike.");
    expect(askedLines(request({ type: "general", asked: asked({ note: "Parking?" }) }))).toEqual([
      "Their note: Parking?",
    ]);
    // A voicemail: the caller's number isn't proof of who rang.
    expect(
      askedLines(request({ type: "general", asked: asked({ note: "Call me.", voicemail: true }) })),
    ).toEqual([
      "Their note: Call me.",
      "From a voicemail on the shifts line. A caller's number can be faked: check anything unusual with them.",
    ]);
  });

  it("the kinds, and what approving does", () => {
    expect(kindName("time_change")).toBe("Time change");
    expect(kindName("general")).toBe("Question");
    expect(kindName("unknown")).toBe("Request");
    expect(approveHint("time_change")).toBe(
      "Approving doesn't change the shift. Make the change on the shift's page.",
    );
    expect(approveHint("review")).toBe(
      "Approving doesn't book them. Assign them on the shift's page.",
    );
    expect(approveHint("general")).toBeNull();
  });

  it("each answer says what happened", () => {
    expect(answerResultText({ status: "resolved", decision: "approved" }, "Ann")).toBe(
      "Approved. Ann will be told.",
    );
    expect(answerResultText({ status: "resolved", decision: "declined" }, "Ann")).toBe(
      "Declined. Ann will be told.",
    );
    expect(answerResultText({ status: "already", current: "approved" }, "Ann")).toBe(
      "This request was already answered.",
    );
    expect(answerResultText({ status: "already", current: "auto_resolved" }, "Ann")).toBe(
      "This request was already sorted.",
    );
    expect(answerResultText({ status: "note_needed" }, "Ann")).toBe("Add a note saying why.");
    expect(answerResultText({ status: "note_too_long" }, "Ann")).toBe(
      "The note is too long (500 characters at most).",
    );
    expect(answerResultText({ status: "not_allowed" }, "Ann")).toBe("You can't answer requests.");
    expect(answerResultText({ status: "logged_out" }, "Ann")).toBe(
      "Your session has ended. Log in again.",
    );
  });

  it("who answered", () => {
    const at = new Date();
    expect(
      answeredBy(
        request({ status: "approved", answer: { by: "Sam Rota", at, note: null, told: null } }),
      ),
    ).toBe("Approved by Sam Rota");
    expect(
      answeredBy(request({ status: "declined", answer: { by: null, at, note: null, told: null } })),
    ).toBe("Declined");
    expect(answeredBy(request({ status: "auto_resolved" }))).toBe("Sorted");
  });

  it("whether they've been told", () => {
    const answered = (told: "sending" | "sent" | "held" | "failed" | null) =>
      toldText(request({ status: "approved", answer: { by: "Sam", at: null, note: null, told } }));
    expect(answered("sent")).toBe("Ann was told.");
    expect(answered("held")).toBe("Telling Ann waits for quiet hours to end.");
    expect(answered("failed")).toBe("Telling Ann failed. Phone them.");
    expect(answered("sending")).toBe("Telling Ann.");
    expect(answered(null)).toBe("Ann will be told.");
    expect(toldText(request())).toBeNull();
    expect(toldText(request({ status: "auto_resolved" }))).toBeNull();
  });
});
