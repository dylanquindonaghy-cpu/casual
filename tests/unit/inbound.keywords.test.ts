import { describe, expect, it } from "vitest";
import { createFakeAi } from "@/lib/ai/client";
import { classifyMessage } from "@/lib/ai/classify-message";
import { keywordIntent } from "@/lib/inbound/keywords";

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
