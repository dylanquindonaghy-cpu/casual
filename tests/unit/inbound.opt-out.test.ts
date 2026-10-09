import { describe, expect, it } from "vitest";
import { smsOptOutWord } from "@/lib/inbound/opt-out";

// STOP and START words in a text (src/lib/inbound/opt-out.ts): Twilio's standard English list, the
// whole message only.

describe("smsOptOutWord", () => {
  it("the stop words, any case, with spaces and a full stop or '!' around", () => {
    for (const body of [
      "STOP",
      "stop",
      " Stop ",
      "Stop.",
      "STOP!",
      "stop !",
      "STOPALL",
      "Unsubscribe",
      "cancel",
      "END",
      "quit",
      "OPTOUT",
      "revoke",
    ]) {
      expect(smsOptOutWord(body), body).toBe("stop");
    }
  });

  it("the start words; YES only counts for a number with texts off (the caller checks)", () => {
    expect(smsOptOutWord("START")).toBe("start");
    expect(smsOptOutWord("unstop")).toBe("start");
    expect(smsOptOutWord("Yes")).toBe("yes");
    expect(smsOptOutWord("yes!")).toBe("yes");
  });

  it("anything else, or a word inside a sentence, is an ordinary text", () => {
    for (const body of [
      null,
      "",
      "Please stop",
      "stop texting me",
      "cancel my shift",
      "Can I cancel?",
      "stop?",
      "st0p",
      "yes please",
      "stopstop",
    ]) {
      expect(smsOptOutWord(body), String(body)).toBeNull();
    }
  });
});
