import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILL_IN_KEYS, FILL_INS, fillInsNeeded, tokensIn } from "@/lib/answers/fill-ins";
import { EXAMPLE_COVER, aboutPayTrouble, matchByExample, normalise } from "@/lib/answers/match";
import { answerText, previewAnswer, renderAnswer, usesPayFillIn } from "@/lib/answers/render";
import { ANSWER_PAY_HINT } from "@/lib/messaging/templates";
import { DEMO_STARTERS_ON, STARTERS } from "@/lib/answers/starters";
import { answerSwitches } from "@/lib/answers/switches";
import { ANSWER_TEXT_PARTS_AT } from "@/lib/answers/limits";
import {
  ANSWER_ERRORS,
  ANSWER_NOTES,
  checkAnswer,
  looksSignedByPerson,
} from "@/lib/answers/validate";
import { LIBRARY_STOP_WORDS, libraryAllowed, reservedWordIn } from "@/lib/inbound/keywords";
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

  // Widened by the guardrails review (M1): one test a phrase, as a casual might write it.
  it.each([
    "my pay is late",
    "pay's late again this week",
    "I'm still waiting for my pay",
    "I haven't received my wages",
    "havent received anything",
    "it hasn't gone in yet",
    "hasnt gone in",
    "my wages haven't gone in",
    "it's not in my account",
    "I only got £40",
    "it was less than I worked",
    "why was money deducted",
    "what's this deduction",
    "there are deductions I don't understand",
    "I think I was overpaid",
    "my hours are not right",
    "where is my pay",
    "where's my money",
    "where is my wages?",
    "wheres my pay",
  ])("widened: %s", (text) => {
    expect(aboutPayTrouble(text)).toBe(true);
  });

  it.each([
    "when will i get paid",
    "when do we get paid",
    "is pay this friday",
    "when is payday",
    "what do i wear",
    "where do i park",
    "where is my shift",
    "the plate on the gate",
  ])("not: %s", (text) => {
    expect(aboutPayTrouble(text)).toBe(false);
  });
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

  it("the office's preview uses each fill-in's made-up example, with the pay query hint where it goes", () => {
    expect(previewAnswer(STARTERS[0]?.body ?? "")).toEqual({
      text: "Your next pay day is Friday 20 November, for shifts Mon 9 to Sun 15 Nov. Your hours and rates: https://acme.shiftdesk.example/pay If your pay looks wrong, tap 'Raise a pay query' on your pay page, so payroll sees it.",
    });
    expect(previewAnswer("Park at gate C.")).toEqual({ text: "Park at gate C." });
  });

  it("an answer using a pay fill-in gets the pay query hint after its words, added by code (M1)", () => {
    expect(ANSWER_PAY_HINT).toBe(
      "If your pay looks wrong, tap 'Raise a pay query' on your pay page, so payroll sees it.",
    );
    for (const key of ["next_pay_day", "pay_cycle", "pay_link"] as const) {
      expect(usesPayFillIn(`x {${key}}`), key).toBe(true);
      expect(answerText(`See {${key}}.`, { [key]: "v" }), key).toEqual({
        text: `See v. ${ANSWER_PAY_HINT}`,
      });
    }
    expect(usesPayFillIn("For {next_shift}: {next_shift_instructions} {profile_link}")).toBe(false);
    expect(answerText("Hi {first_name}.", { first_name: "Zoe" })).toEqual({ text: "Hi Zoe." });
    // One that can't go gets no hint: it says what's missing, as before.
    expect(answerText("Pay day is {next_pay_day}.", {})).toEqual({ missing: ["next_pay_day"] });
    // In docs/messaging-templates.md.
    const templates = readFileSync("docs/messaging-templates.md", "utf8").replace(/\s+/g, " ");
    expect(templates).toContain(ANSWER_PAY_HINT);
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

  it("refuses an example with a word that always reaches a person or a built-in reply (H1)", () => {
    for (const line of [
      "what time is the office open",
      "can I cancel",
      "cancelling a shift",
      "is there a cancellation fee",
      "can I talk to someone",
      "help with parking",
      "stop texts",
      "what time do we start",
      "I can't find the gate",
      "not sure what to wear",
      "off sick what now",
      "running late",
    ]) {
      expect(
        checkAnswer({ name: "x", examples: `where do i park\n${line}`, body: "y" }),
        line,
      ).toEqual({ ok: false, errors: { examples: ANSWER_ERRORS.exampleReserved } });
    }
    // Inside a longer word is fine; a name or the words may hold them.
    expect(
      checkAnswer({
        name: "Office hours",
        examples: "officer at the gate\nstarting time",
        body: "The office is open 9 to 5. Cancelling is in the app.",
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses a name or an example holding a phone number or an email address (L2)", () => {
    expect(
      checkAnswer({ name: "Ring 07700 900123", examples: "where do i park", body: "y" }),
    ).toEqual({ ok: false, errors: { name: ANSWER_ERRORS.nameContact } });
    expect(checkAnswer({ name: "x", examples: "is +447700900123 your number", body: "y" })).toEqual(
      { ok: false, errors: { examples: ANSWER_ERRORS.exampleContact } },
    );
    expect(checkAnswer({ name: "x", examples: "can I email zoe@example.com", body: "y" })).toEqual({
      ok: false,
      errors: { examples: ANSWER_ERRORS.exampleContact },
    });
    // Times, dates and short numbers aren't phone numbers.
    expect(
      checkAnswer({
        name: "Gate 3 at 13:30",
        examples: "is it gate 3 on 14/11\nwhat about the 2026 season",
        body: "y",
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("the form's notes, never a block (L1, L3)", () => {
  it("long words: a text goes in several parts", () => {
    expect(ANSWER_TEXT_PARTS_AT).toBe(300);
    expect(ANSWER_NOTES.longText).toBe("Over 300 characters: a text sends it in several parts.");
  });

  it.each([
    "Park at gate C.\nThanks, Sam",
    "Park at gate C.\nCheers Sam",
    "Park at gate C.\nMany thanks,\nSam Rota",
    "Park at gate C.\nKind regards",
    "Park at gate C.\nRegards, Sam",
    "Park at gate C.\n— Sam",
    "Park at gate C.\n- Sam Rota",
    "Park at gate C. Cheers, Sam",
    "Park at gate C. Thanks Sam.",
  ])("looks signed by a person: %s", (body) => {
    expect(looksSignedByPerson(body)).toBe(true);
    expect(checkAnswer({ name: "x", examples: "", body })).toMatchObject({ ok: true });
  });

  it.each([
    "Thanks for asking. Park at gate C.",
    "Thanks, {first_name}. Park at gate C.",
    "Park at gate C. Thanks!",
    "Thanks to everyone who came.",
    "Gate B opens at 9 - see you there.",
    "Best to arrive early.",
    "Your next pay day is {next_pay_day}.",
  ])("not: %s", (body) => {
    expect(looksSignedByPerson(body)).toBe(false);
  });

  it("the notes in the screens' words", () => {
    expect(ANSWER_NOTES.personSignOff).toBe(
      "Replies are signed by the firm's Shift Team: don't add a person's name.",
    );
    const screens = readFileSync("docs/screens.md", "utf8").replace(/\s+/g, " ");
    expect(screens).toContain(`"${ANSWER_NOTES.longText}"`);
    expect(screens).toContain(`"${ANSWER_NOTES.personSignOff}"`);
    expect(screens).toContain(`"${ANSWER_ERRORS.exampleReserved}"`);
    expect(screens).toContain(`"${ANSWER_ERRORS.exampleContact}"`);
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

  it("migration 0073 adds the same words for the firms there then, and 0074 Office hours' new example", () => {
    const sql = readFileSync("drizzle/0073_answer_library.sql", "utf8");
    const fix = readFileSync("drizzle/0074_answer_examples.sql", "utf8");
    for (const s of STARTERS) {
      expect(sql).toContain(`'${s.key}', '${s.name}'`);
      expect(sql).toContain(`'${s.body.replace(/'/g, "''")}'`);
      if (s.key === "office_hours") {
        // 0073's "what time is the office open" held "office" (the guardrails review, H1): 0074
        // replaces it where it's still the starter's own.
        expect(sql).toContain(`E'is anyone in\\nwhat time is the office open'`);
        expect(fix).toContain(`SET examples = E'${s.examples.join("\\n")}'`);
        expect(fix).toContain(`examples = E'is anyone in\\nwhat time is the office open'`);
      } else {
        expect(sql).toContain(`E'${s.examples.join("\\n")}'`);
      }
    }
  });

  it("none of their examples holds a word kept from the library (H1)", () => {
    for (const s of STARTERS) for (const e of s.examples) expect(reservedWordIn(e), e).toBeNull();
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
    // Switched off between the read and the claim (M2).
    expect(
      say(
        "message.received",
        {
          channel: "sms",
          handledAs: "keyword",
          intent: "office",
          answerId: "a",
          matchedBy: "example",
          answerSwitchedOff: true,
          workerId: "w",
        },
        "worker",
      ),
    ).toBe(
      "Ann Booker sent a text to the shifts line (for the office). One of your answers matched, but it was switched off before it went: it's waiting for a person.",
    );
    expect(
      say(
        "email.received",
        {
          handledAs: "keyword",
          intent: "office",
          answerId: "a",
          matchedBy: "example",
          answerSwitchedOff: true,
          workerId: "w",
        },
        "worker",
      ),
    ).toBe(
      "Ann Booker emailed the staffing inbox. One of your answers matched, but it was switched off before it went: it's waiting for a person.",
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

// The second guardrails review (2026-11-10): dropouts worded without the dropout words, short
// examples inside long messages, more ways of saying pay went wrong, and the pay hint by topic.
describe("the second review's findings", () => {
  it("a message that says a shift went wrong never gets a library answer (M1)", () => {
    for (const text of [
      "I'm poorly, is anyone in?",
      "family emergency tonight, what time do you open",
      "stuck in traffic, where do I park",
      "I'm in hospital, is anyone in",
      "had an accident, where do i park",
      "train delayed, is anyone in",
      "car breakdown, what time do you open",
      "I missed the bus, is anyone in",
      "can I swap my shift, is anyone in",
      "I want to drop Saturday, is anyone in",
    ]) {
      expect(libraryAllowed(text), text).toBe(false);
    }
    expect(libraryAllowed("is anyone in")).toBe(true);
    expect(libraryAllowed("where do i park at the arena")).toBe(true);
    for (const w of LIBRARY_STOP_WORDS) expect(reservedWordIn(`what about ${w}`), w).toBe(w);
  });

  it("an example must be at least a third of the message's words (M1)", () => {
    const office = a("office", "is anyone in");
    const wear = a("wear", "what do i wear");
    expect(matchByExample("is anyone in?", [office])?.id).toBe("office");
    expect(matchByExample("hi, is anyone in today", [office])?.id).toBe("office");
    expect(
      matchByExample("the stewards at gate 4 are short tonight and nobody knows, is anyone in", [
        office,
      ]),
    ).toBeNull();
    expect(matchByExample("What do I wear for the food festival?", [wear])?.id).toBe("wear");
    expect(EXAMPLE_COVER).toBe(1 / 3);
    expect(matchByExample("What kit do I need?", [a("kit", "what kit")])?.id).toBe("kit");
    expect(
      matchByExample("so what kit do i need for the big arena gig", [a("kit", "what kit")]),
    ).toBeNull();
  });

  it("more ways of saying pay went wrong (L)", () => {
    for (const text of [
      "I wasn't paid for Saturday, when do we get paid?",
      "we werent paid last week",
      "you haven't paid me",
      "it hasn't paid in",
      "you didn't pay me for friday",
      "I didnt get paid",
      "you only paid me 4 hours",
      "problem with my pay",
      "issue with my wages",
      "I have a query about pay",
      "my pay is low",
      "I got less this week",
    ]) {
      expect(aboutPayTrouble(text), text).toBe(true);
    }
    for (const s of STARTERS) {
      for (const ex of s.examples) expect(aboutPayTrouble(ex), ex).toBe(false);
    }
  });

  it("an answer about pay by its name or examples gets the pay query hint too (L)", () => {
    const body = "We pay every Friday.";
    expect(answerText(body, {})).toEqual({ text: body });
    expect(answerText(body, {}, { name: "Pay day", examples: ["when is it"] })).toEqual({
      text: `${body} ${ANSWER_PAY_HINT}`,
    });
    expect(answerText(body, {}, { name: "Fridays", examples: ["when do we get paid"] })).toEqual({
      text: `${body} ${ANSWER_PAY_HINT}`,
    });
    expect(answerText("Bring a torch.", {}, { name: "Kit", examples: ["what to bring"] })).toEqual({
      text: "Bring a torch.",
    });
    expect(previewAnswer(body, { name: "Pay day", examples: [] })).toEqual({
      text: `${body} ${ANSWER_PAY_HINT}`,
    });
  });
});
