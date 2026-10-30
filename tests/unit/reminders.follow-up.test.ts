import { describe, expect, it } from "vitest";
import { followUpKey, shiftRemindersPayload } from "@/lib/reminders/send";

// A slot's reminder runs (P4.5): the first is the tick's `shift-reminders:<slot>`, each follow-up
// the slot's next run number.

const FIRM = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("the follow-up's key", () => {
  it("is the same slot with the next run number", () => {
    expect(followUpKey("shift-reminders:5883420")).toBe("shift-reminders:5883420:2");
    expect(followUpKey("shift-reminders:5883420:2")).toBe("shift-reminders:5883420:3");
    expect(followUpKey("shift-reminders:5883420:9")).toBe("shift-reminders:5883420:10");
  });

  it("the payload takes a slot's first run and its follow-ups, and nothing else", () => {
    const ok = (key: string) =>
      shiftRemindersPayload.safeParse({ firmId: FIRM, idempotencyKey: key }).success;
    expect(ok("shift-reminders:5883420")).toBe(true);
    expect(ok("shift-reminders:5883420:2")).toBe(true);
    expect(ok("shift-reminders:5883420:9999")).toBe(true);
    for (const bad of [
      "shift-reminders:5883420:10000",
      "shift-reminders:5883420:two",
      "shift-reminders:5883420:2:3",
      "shift-reminders:",
      "offer-wave:5883420",
    ]) {
      expect(ok(bad), bad).toBe(false);
    }
  });
});
