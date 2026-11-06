import { describe, expect, it } from "vitest";
import {
  MESSAGE_ABOUT,
  messageAboutSchema,
  messageOfficeHref,
  messagesHref,
  payQueryHref,
  readMessageOffice,
} from "@/lib/portal/message-office";

// "Message the office" about a session (Phase 28.2; src/lib/portal/message-office.ts): one link
// contract for every casual page, a pay question about an ended session sent to payroll's pay
// query instead (golden rule 9), and zod refusing anything else.

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = new Date("2026-11-07T12:00:00Z");
const ended = { id: ID, endsAt: new Date("2026-11-07T11:00:00Z") };
const endsNow = { id: ID, endsAt: NOW };
const onNow = { id: ID, endsAt: new Date("2026-11-07T18:00:00Z") };

describe("messageOfficeHref", () => {
  it("sends a pay question about an ended session to the pay query, never to Messages", () => {
    expect(messageOfficeHref(ended, "pay", NOW)).toBe(`/pay/query?shift=${ID}`);
    expect(messageOfficeHref(endsNow, "pay", NOW)).toBe(`/pay/query?shift=${ID}`);
  });

  it("sends a pay question about a session that hasn't ended to Messages", () => {
    expect(messageOfficeHref(onNow, "pay", NOW)).toBe(`/messages?shift=${ID}&about=pay`);
  });

  it("sends every other topic to Messages, ended or not", () => {
    for (const about of ["late", "started", "other"] as const) {
      expect(messageOfficeHref(onNow, about, NOW)).toBe(`/messages?shift=${ID}&about=${about}`);
      expect(messageOfficeHref(ended, about, NOW)).toBe(`/messages?shift=${ID}&about=${about}`);
    }
  });

  it("refuses an unknown topic or an id that isn't one", () => {
    expect(() => messageOfficeHref(onNow, "refund" as never, NOW)).toThrow();
    expect(() => messagesHref("../admin", "pay")).toThrow();
    expect(() => payQueryHref("1 or 1=1")).toThrow();
  });
});

describe("the topics", () => {
  it("are pay, late, started and other; zod refuses anything else", () => {
    expect(MESSAGE_ABOUT).toEqual(["pay", "late", "started", "other"]);
    for (const about of MESSAGE_ABOUT) {
      expect(messageAboutSchema.safeParse(about).success).toBe(true);
    }
    for (const bad of ["", "PAY", "refund", "pay ", 1, null]) {
      expect(messageAboutSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("readMessageOffice (Messages' query)", () => {
  it("reads a session and a topic", () => {
    expect(readMessageOffice({ shift: ID, about: "late" })).toEqual({ shift: ID, about: "late" });
  });

  it("ignores a missing, unknown or repeated value, or an id that isn't one", () => {
    expect(readMessageOffice({})).toBeNull();
    expect(readMessageOffice({ shift: ID })).toBeNull();
    expect(readMessageOffice({ shift: ID, about: "refund" })).toBeNull();
    expect(readMessageOffice({ shift: "not-an-id", about: "pay" })).toBeNull();
    expect(readMessageOffice({ shift: [ID, ID], about: "pay" })).toBeNull();
    expect(readMessageOffice({ shift: ID, about: ["pay", "late"] })).toBeNull();
  });
});
