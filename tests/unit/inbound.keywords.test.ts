import { describe, expect, it } from "vitest";
import { createFakeAi } from "@/lib/ai/client";
import { classifyMessage } from "@/lib/ai/classify-message";
import {
  keywordIntent,
  libraryAllowed,
  RESERVED_EXAMPLE_WORDS,
  reservedWordIn,
} from "@/lib/inbound/keywords";

// What a worker's WhatsApp asks for (src/lib/inbound/keywords.ts), and the AI's label when no
// keyword matched (src/lib/ai/classify-message.ts, with a fake AI: no real model is called).

describe("keywords", () => {
  it("each keyword, as a whole word in any case", () => {
    expect(keywordIntent("shifts")).toBe("shifts");
    expect(keywordIntent("Any WORK this weekend?")).toBe("shifts");
    expect(keywordIntent("I'm available Saturday")).toBe("shifts");
    expect(keywordIntent("shift")).toBeNull();
    expect(keywordIntent("cancel")).toBe("cancel");
    expect(keywordIntent("When are wages in?")).toBe("pay");
    expect(keywordIntent("where's my payslip")).toBe("pay");
    expect(keywordIntent("HELP")).toBe("office");
    expect(keywordIntent("can I talk to someone")).toBe("office");
  });

  it("in order: cancel, pay, shifts, then the office", () => {
    expect(keywordIntent("Can I cancel my shift on Saturday?")).toBe("cancel");
    expect(keywordIntent("help, I haven't been paid for that shift")).toBe("pay");
    expect(keywordIntent("help me find shifts")).toBe("shifts");
  });

  it("dropouts never get the open shifts link: their own shift goes to the AI or the office", () => {
    expect(keywordIntent("can't make my shift tomorrow")).toBeNull();
    expect(keywordIntent("I'm not available Saturday")).toBeNull();
    expect(keywordIntent("running late for work")).toBeNull();
    expect(keywordIntent("sick, can’t work today")).toBeNull();
    expect(keywordIntent("what time is my shift")).toBeNull(); // "shift" alone isn't a keyword
    // "help" still reaches the office; "cancel" and pay still get theirs.
    expect(keywordIntent("sick, need help")).toBe("office");
    expect(keywordIntent("I can't make it, please cancel")).toBe("cancel");
    expect(keywordIntent("not been paid")).toBe("pay");
  });

  it("parts of words don't count; nothing matched is null", () => {
    expect(keywordIntent("payment")).toBeNull();
    expect(keywordIntent("paypal")).toBeNull();
    expect(keywordIntent("hello")).toBeNull();
    expect(keywordIntent("running 10 mins late")).toBeNull();
    expect(keywordIntent("")).toBeNull();
  });
});

describe("asking for a person by name comes first (Phase 35, the guardrails review's H1)", () => {
  it("'office' and 'talk' beat cancel, pay and shifts; 'help' still comes last", () => {
    expect(keywordIntent("office, when do we get paid")).toBe("office");
    expect(keywordIntent("Can I talk to someone about my payslip")).toBe("office");
    expect(keywordIntent("I need to cancel Saturday, can the office ring me")).toBe("office");
    expect(keywordIntent("OFFICE")).toBe("office");
    expect(keywordIntent("Please can someone from the office help? (About: Pay day)")).toBe(
      "office",
    );
    // "help" stays the least specific, as before.
    expect(keywordIntent("help, I haven't been paid for that shift")).toBe("pay");
    expect(keywordIntent("help me find shifts")).toBe("shifts");
  });
});

describe("libraryAllowed: no library answer for a cancel, a person or a dropout", () => {
  it.each([
    "sick, can't make tonight, is anyone in?",
    "I need to cancel Saturday, what do I wear",
    "cancelling: where do i park",
    "office, when do we get paid",
    "can I talk to someone, is there parking",
    "help, where do I park",
    "running late, where do i park",
    "I won't make it, what uniform",
    "not available, is pay this friday",
    "I'm ill, is anyone in",
    "unable to come, where do I park",
    "I cannot come tonight",
  ])("not: %s", (text) => {
    expect(libraryAllowed(text)).toBe(false);
  });

  it.each(["where do I park?", "When do we get paid?", "is anyone in", "what do i wear"])(
    "allowed: %s",
    (text) => {
      expect(libraryAllowed(text)).toBe(true);
    },
  );
});

describe("reservedWordIn: the words an answer's example may not hold", () => {
  it("the cancel, person and dropout words, STOP and START, as whole words", () => {
    for (const w of [
      "cancel",
      "cancelling",
      "canceling",
      "cancellation",
      "office",
      "help",
      "talk",
      "stop",
      "start",
      "cant",
      "not",
      "sick",
      "late",
    ]) {
      expect(reservedWordIn(`what about ${w} then`), w).toBe(w);
    }
    expect(reservedWordIn("What time is the OFFICE open")).toBe("office");
    expect(reservedWordIn("I can't come")).toBe("cant");
    expect(reservedWordIn("is there an office-party")).toBe("office");
    // Inside a longer word doesn't count.
    expect(reservedWordIn("officer on the gate")).toBeNull();
    expect(reservedWordIn("starting time")).toBeNull();
    expect(reservedWordIn("where do i park")).toBeNull();
    expect(RESERVED_EXAMPLE_WORDS).toEqual(expect.arrayContaining(["office", "start", "late"]));
  });
});

describe("the AI's label", () => {
  it("one of the four labels (any case, a full stop allowed) is used", async () => {
    for (const [answer, label] of [
      ["shifts", "shifts"],
      ["Cancel.", "cancel"],
      [" PAY ", "pay"],
      ["office", "office"],
    ] as const) {
      expect(
        await classifyMessage(
          "x",
          createFakeAi(() => answer),
        ),
      ).toBe(label);
    }
  });

  it("anything else, a failure or no answer in time is nobody's label (the office gets it)", async () => {
    for (const answer of ["They want to cancel", "refund", "", "shifts pay", "Pay them £50"]) {
      expect(
        await classifyMessage(
          "x",
          createFakeAi(() => answer),
        ),
      ).toBeNull();
    }
    const fails = createFakeAi(() => {
      throw new Error("down");
    });
    expect(await classifyMessage("x", fails)).toBeNull();
    const hangs = createFakeAi(() => new Promise<string>(() => undefined));
    expect(await classifyMessage("x", hangs, { timeoutMs: 20 })).toBeNull();
  });

  it("the AI is given the worker's text only, for sorting", async () => {
    let seen = { purpose: "", prompt: "" };
    await classifyMessage(
      "running late, sorry",
      createFakeAi((r) => {
        seen = { purpose: r.purpose, prompt: r.prompt };
        return "office";
      }),
    );
    expect(seen).toEqual({ purpose: "classify_message", prompt: "running late, sorry" });
  });
});
