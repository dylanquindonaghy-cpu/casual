import { describe, expect, it } from "vitest";
import { reachOf } from "@/lib/offers/reach";
import { reachLine } from "@/lib/office/offer-words";

// How an offer will reach a casual (Phase 26.9, off-1 and off-5; decision 4): the sender's order
// (src/lib/notify/send.ts deliverToWorker) worked out ahead, for the office's list. Never WhatsApp.

const base = { phones: 0, channel: "sms" as "sms" | "email", smsAllowed: true, hasEmail: false };

describe("reachOf", () => {
  it("an app notification first, whatever else is true", () => {
    for (const channel of ["sms", "email"] as const) {
      for (const smsAllowed of [true, false]) {
        expect(reachOf({ phones: 2, channel, smsAllowed, hasEmail: true }, false)).toEqual({
          how: "push",
        });
      }
    }
  });

  it("then their choice: email when they chose it and we hold their address", () => {
    expect(reachOf({ ...base, channel: "email", hasEmail: true }, true)).toEqual({
      how: "email",
      why: "chose_email",
    });
    // Chose email, but the address has gone: a text.
    expect(reachOf({ ...base, channel: "email" }, true)).toEqual({ how: "sms" });
  });

  it("a text while there's a text sender and they haven't replied STOP", () => {
    expect(reachOf(base, true)).toEqual({ how: "sms" });
    expect(reachOf({ ...base, hasEmail: true }, true)).toEqual({ how: "sms" });
  });

  it("an email when no text can go: no text sender, or STOP", () => {
    expect(reachOf({ ...base, hasEmail: true }, false)).toEqual({
      how: "email",
      why: "no_text_sender",
    });
    expect(reachOf({ ...base, hasEmail: true, smsAllowed: false }, true)).toEqual({
      how: "email",
      why: "texts_off",
    });
  });

  it("nothing at all: no phone, no texts, no address", () => {
    expect(reachOf(base, false)).toEqual({ how: "none" });
    expect(reachOf({ ...base, smsAllowed: false }, true)).toEqual({ how: "none" });
  });
});

describe("reachLine: the words on the office's list", () => {
  it("says how, and why", () => {
    expect(reachLine({ how: "push" })).toBe("By app notification");
    expect(reachLine({ how: "sms" })).toBe("By text: no app notifications on their phone");
    expect(reachLine({ how: "email", why: "chose_email" })).toBe("By email: they chose email");
    expect(reachLine({ how: "email", why: "texts_off" })).toBe("By email: they turned texts off");
    expect(reachLine({ how: "email", why: "no_text_sender" })).toBe(
      "By email: no text account yet",
    );
    expect(reachLine({ how: "none" })).toBe("No way to reach them");
  });
});
