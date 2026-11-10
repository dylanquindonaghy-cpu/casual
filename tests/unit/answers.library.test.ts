import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILL_IN_KEYS, FILL_INS, fillInsNeeded, tokensIn } from "@/lib/answers/fill-ins";
import { aboutPayTrouble, matchByExample, normalise } from "@/lib/answers/match";
import { previewAnswer, renderAnswer } from "@/lib/answers/render";
import { DEMO_STARTERS_ON, STARTERS } from "@/lib/answers/starters";
import { answerSwitches } from "@/lib/answers/switches";
import { ANSWER_ERRORS, checkAnswer } from "@/lib/answers/validate";
import { applySetting } from "@/lib/onboarding/settings";
import { eventWords } from "@/lib/office/event-words";
import { enquiryOutcome } from "@/lib/office/enquiry-rules";
import { shiftsLineReply, inboxAnswerEmail, forTheApp } from "@/lib/messaging/templates";

// The answer library's pure parts (Phase 35; docs/screens.md "## Phase 35"): the match by example
// phrase, the fill-ins, the pay-trouble guard, the office's validation, the starters, the switches.

const a = (id: string, ...examples: string[]) => ({ id, examples });

describe("matchByExample", () => {
  const payDay = a("pay", "when do we get paid", "when will i get paid", "when is payday");
  const wear = a("wear", "what do i wear", "do i need my hi vis");
  const parking = a("park", "where do i park", "is there parking");

  it("finds an example phrase as a whole-word run, whatever the case and punctuation", () => {
    expect(matchByExample("Hi! When will I get PAID this week??", [payDay, wear])).toBe(payDay);
    expect(matchByExample("do I need my hi-vis tomorrow", [payDay, wear])).toBe(wear);
    expect(matchByExample("Is there parking, at all?", [payDay, wear, parking])).toBe(parking);
  });

  it("never inside a longer word, nor a phrase only partly there", () => {
    expect(matchByExample("when do we get paidd", [payDay])).toBeNull();
    expect(matchByExample("is there parkingspace", [parking])).toBeNull();
    expect(matchByExample("when will i", [payDay])).toBeNull();
    expect(matchByExample("", [payDay])).toBeNull();
    expect(matchByExample("!!!", [payDay])).toBeNull();
  });

  it("apostrophes are dropped on both sides", () => {
    const office = a("office", "whats the office number");
    expect(matchByExample("What's the office number?", [office])).toBe(office);
    expect(normalise("Didn’t get   PAID!")).toBe("didnt get paid");
  });

  it("the longest example wins; a tie between two answers is none", () => {
    const short = a("short", "uniform");
    const long = a("long", "what uniform do i need");
    expect(matchByExample("what uniform do i need on saturday", [short, long])).toBe(long);
    const one = a("one", "is anyone in");
    const two = a("two", "is someone in");
    const three = a("three", "is anyone in");
    expect(matchByExample("hello is anyone in", [one, two])).toBe(one);
    expect(matchByExample("hello is anyone in", [one, three])).toBeNull();
    // The same answer matching twice isn't a tie.
    expect(
      matchByExample("is anyone in, is anyone in", [a("x", "is anyone in", "anyone in")]),
    ).toEqual(expect.objectContaining({ id: "x" }));
  });

  it("an answer with no examples never matches by example", () => {
    expect(matchByExample("anything at all", [a("none")])).toBeNull();
  });
});

describe("PAY_TROUBLE: a message about pay going wrong never gets a library answer", () => {
  it.each([
    "my pay is wrong",
    "I haven't been paid",
    "I wasn't paid for Saturday, hasn't come through",
    "I didn't get paid",
    "there's money missing",
    "I've been underpaid",
    "you owe me for last week",
    "my pay was short",
    "it's a mistake on my payslip",
    "incorrect hours",
    "I want to dispute my pay",
    "not paid yet",
  ])("%s", (text) => {
    expect(aboutPayTrouble(text)).toBe(true);
  });

  it.each(["when will i get paid", "is pay this friday", "what do i wear", "where do i park"])(
    "not: %s",
    (text) => {
      expect(aboutPayTrouble(text)).toBe(false);
    },
  );
});

describe("renderAnswer", () => {
  it("fills in every fill-in by code", () => {
    expect(
      renderAnswer("Hi {first_name}, pay day is {next_pay_day}: {pay_link}", {
        first_name: "Zoe",
        next_pay_day: "Friday 20 November",
        pay_link: "https://acme.example.test/pay",
      }),
    ).toEqual({ text: "Hi Zoe, pay day is Friday 20 November: https://acme.example.test/pay" });
    expect(renderAnswer("No fill-ins at all.", {})).toEqual({ text: "No fill-ins at all." });
  });

  it("any fill-in with no value: nothing goes, and it says which", () => {
    expect(
      renderAnswer("For {next_shift}: {next_shift_instructions}", {
        next_shift: "Steward, Sat 14 Nov",
        next_shift_instructions: null,
      }),
    ).toEqual({ missing: ["next_shift_instructions"] });
    expect(renderAnswer("{next_shift} {next_shift}", { next_shift: "  " })).toEqual({
      missing: ["next_shift"],
    });
    // A {word} that isn't a fill-in never goes out as typed.
    expect(renderAnswer("Hello {nickname}", {})).toEqual({ missing: ["nickname"] });
  });

  it("the office's preview uses each fill-in's made-up example", () => {
    expect(previewAnswer(STARTERS[0]?.body ?? "")).toEqual({
      text: "Your next pay day is Friday 20 November, for shifts Mon 9 to Sun 15 Nov. Your hours and rates: https://acme.shiftdesk.example/pay",
    });
  });
});

describe("fill-ins", () => {
  it("are the fixed list, each with a label and an example", () => {
    expect([...FILL_IN_KEYS]).toEqual([
      "first_name",
      "next_pay_day",
      "pay_cycle",
      "next_shift",
      "next_shift_instructions",
      "licence_expiry",
      "pay_link",
      "profile_link",
      "shifts_link",
    ]);
    expect(FILL_INS.map((f) => f.key)).toEqual([...FILL_IN_KEYS]);
    for (const f of FILL_INS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.example.length).toBeGreaterThan(0);
    }
  });

  it("the tokens an answer holds, and the fill-ins it needs", () => {
    expect(tokensIn("a {pay_link} b {x} {pay_link} { y } {}")).toEqual([
      "pay_link",
      "x",
      "pay_link",
    ]);
    expect(fillInsNeeded("{pay_link} {first_name} {x}")).toEqual(["first_name", "pay_link"]);
  });
});

describe("checkAnswer (the office's form)", () => {
  it("trims, drops blank example lines, and keeps the words", () => {
    expect(
      checkAnswer({
        name: "  Pay   day ",
        examples: "when do we get paid\n\n  when is payday  \n",
        body: " Pay day is {next_pay_day}. ",
      }),
    ).toEqual({
      ok: true,
      answer: {
        name: "Pay day",
        examples: ["when do we get paid", "when is payday"],
        body: "Pay day is {next_pay_day}.",
      },
    });
    expect(checkAnswer({ name: "X", examples: ["a", " b "], body: "Y" })).toMatchObject({
      ok: true,
      answer: { examples: ["a", "b"] },
    });
  });

  it("refuses an unknown fill-in, and anything too long or missing", () => {
    expect(checkAnswer({ name: "X", examples: "", body: "Hi {nickname}" })).toEqual({
      ok: false,
      errors: { body: ANSWER_ERRORS.unknownFillIn },
    });
    expect(checkAnswer({ name: "", examples: "", body: "" })).toEqual({
      ok: false,
      errors: { name: ANSWER_ERRORS.nameMissing, body: ANSWER_ERRORS.bodyMissing },
    });
    expect(checkAnswer({ name: "x".repeat(61), examples: "", body: "y" })).toMatchObject({
      errors: { name: ANSWER_ERRORS.nameLong },
    });
    expect(checkAnswer({ name: "x", examples: "", body: "y".repeat(601) })).toMatchObject({
      errors: { body: ANSWER_ERRORS.bodyLong },
    });
    expect(
      checkAnswer({ name: "x", examples: Array(11).fill("q").join("\n"), body: "y" }),
    ).toMatchObject({ errors: { examples: ANSWER_ERRORS.examplesMany } });
    expect(checkAnswer({ name: "x", examples: "q".repeat(101), body: "y" })).toMatchObject({
      errors: { examples: ANSWER_ERRORS.exampleLong },
    });
    expect(checkAnswer(null)).toMatchObject({ ok: false });
  });
});

describe("the five starters", () => {
  it("are valid answers, filled only from the fixed fill-ins", () => {
    expect(STARTERS.map((s) => s.key)).toEqual([
      "pay_day",
      "what_to_wear",
      "renewing_licence",
      "parking",
      "office_hours",
    ]);
    for (const s of STARTERS) {
      expect(checkAnswer({ name: s.name, examples: s.examples.join("\n"), body: s.body })).toEqual({
        ok: true,
        answer: { name: s.name, examples: [...s.examples], body: s.body },
      });
    }
    expect(DEMO_STARTERS_ON).not.toContain("parking");
    expect(DEMO_STARTERS_ON).toHaveLength(4);
  });

  it("migration 0073 adds the same words for the firms there then", () => {
    const sql = readFileSync("drizzle/0073_answer_library.sql", "utf8");
    for (const s of STARTERS) {
      expect(sql).toContain(`'${s.key}', '${s.name}'`);
      expect(sql).toContain(`E'${s.examples.join("\\n")}'`);
      expect(sql).toContain(`'${s.body.replace(/'/g, "''")}'`);
    }
  });

  it("none of them answers a pay dispute", () => {
    for (const s of STARTERS) for (const e of s.examples) expect(aboutPayTrouble(e)).toBe(false);
  });
});

describe("the three switches", () => {
  it("are off unless true", () => {
    expect(answerSwitches({})).toEqual({ app: false, texts: false, email: false });
    expect(answerSwitches({ answers: { app: true, texts: "true", email: 1 } })).toEqual({
      app: true,
      texts: false,
      email: false,
    });
    expect(answerSwitches({ answers: [true] })).toEqual({ app: false, texts: false, email: false });
  });

  it("the owner's command sets one and keeps the others", () => {
    expect(applySetting({ answers: { app: true } }, "answers.email", "true")).toEqual({
      answers: { app: true, email: true },
    });
    expect(applySetting({}, "answers.texts", "yes")).toBeNull();
  });
});

describe("the reply's words on each channel", () => {
  const firm = { name: "Acme Events", signOff: "Acme Events Shift Team" };
  it("texts: the words, then the automatic line and the sign-off; the app: without SEND OFFICE", () => {
    const text = shiftsLineReply(firm, {
      intent: "answer",
      words: "Pay day is Friday 20 November.",
    });
    expect(text).toBe(
      "Pay day is Friday 20 November. Automatic reply. Send OFFICE to reach a person. — Acme Events Shift Team",
    );
    expect(forTheApp(text)).toBe(
      "Pay day is Friday 20 November. Automatic reply. — Acme Events Shift Team",
    );
  });

  it("email: Hi, the words, the automatic line, the sign-off", () => {
    expect(
      inboxAnswerEmail(firm, "answer", {
        firstName: "Zoe",
        subject: "pay",
        link: "",
        words: "Pay day is Friday 20 November.",
      }),
    ).toEqual({
      subject: "Re: pay",
      body: "Hi Zoe,\n\nPay day is Friday 20 November.\n\nThis is an automatic reply. To reach a person, reply to this email.\n\n— Acme Events Shift Team",
    });
  });
});

describe("the office's words for it", () => {
  const names = { worker: () => "Ann Booker", office: () => "Sam Rota", credential: () => "x" };
  const say = (action: string, data: Record<string, unknown>, actorType = "office") =>
    eventWords({ action, actorType, actorId: "o", data }, names);
  it("in the log", () => {
    expect(say("answer.created", { answerId: "a", starter: "pay_day" }, "system")).toBe(
      "A starter answer was added to your answers, switched off.",
    );
    expect(say("answer.created", { answerId: "a" })).toBe("Sam Rota added an answer.");
    expect(say("answer.changed", { answerId: "a", keys: ["examples", "body"] })).toBe(
      "Sam Rota changed an answer's example questions and words.",
    );
    expect(say("answer.switched", { answerId: "a", on: true })).toBe(
      "Sam Rota switched an answer on: it can go to casuals.",
    );
    expect(say("answer.switched", { answerId: "a", on: false })).toBe(
      "Sam Rota switched an answer off: it won't go to casuals.",
    );
    expect(say("firm.settings_changed", { by: "firm", keys: ["answers.texts"], on: true })).toBe(
      "Sam Rota switched your answers on for texts.",
    );
    expect(
      say(
        "message.received",
        { channel: "sms", handledAs: "keyword", intent: "answer", workerId: "w" },
        "worker",
      ),
    ).toBe("Ann Booker sent a text to the shifts line (one of your answers).");
    expect(
      say(
        "message.received",
        {
          channel: "app",
          handledAs: "keyword",
          intent: "office",
          answerMissing: ["next_shift"],
          workerId: "w",
        },
        "worker",
      ),
    ).toBe(
      "Ann Booker sent a message in the app (for the office). One of your answers matched, but it needs a fact we don't have for them: it's waiting for a person.",
    );
  });

  it("on Enquiries: a library answer is its own outcome", () => {
    expect(
      enquiryOutcome({
        handled: true,
        handledAs: "keyword",
        intent: "answer",
        waiting: false,
        doneInApp: false,
      }),
    ).toBe("answer");
  });
});
