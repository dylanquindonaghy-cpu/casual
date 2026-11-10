import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STARTERS } from "@/lib/answers/starters";
import { keywordIntent, libraryAllowed } from "@/lib/inbound/keywords";
import {
  ANSWERS_INTRO,
  answerSwitchResultText,
  channelSwitchResultText,
  channelUsesText,
  exampleFromQuestion,
  fillInLabels,
  lastEditedText,
  MASTER_OFF,
  savedText,
  usesText,
  wordParts,
} from "@/lib/office/answers-copy";
import {
  answerChosenStep,
  emailSortedStep,
  enquiriesEmptyText,
  filledInStep,
  outcomeWords,
  sortedStep,
  VIEW_LABELS,
} from "@/lib/office/enquiries-copy";
import {
  askOfficeWords,
  ASK_OFFICE_BUTTON,
  ASK_OFFICE_SENT,
  askOfficeTexts,
  MESSAGES_INTRO,
} from "@/lib/portal/messages-copy";
import { MessagesView } from "@/app/messages/messages-view";
import { AnswerWords } from "@/app/office/settings/answers/answer-words";

// The answer library's screens in plain words (Phase 35.3, 35.4; docs/screens.md "## Phase 35"):
// the office's page and form words, Enquiries' lines for one of the firm's answers, and the casual's
// "Not what you needed? Ask the office", whose words always reach a person. Pure.

const flat = (s: string) => s.replace(/\s+/g, " ");
const screens = flat(readFileSync("docs/screens.md", "utf8"));
const TZ = "Europe/London";

describe("Settings → Automatic answers' words", () => {
  it("the words with their fill-ins as chips, by name; a {word} not on the list stays as text", () => {
    expect(wordParts("Your next pay day is {next_pay_day}. See {pay_link}")).toEqual([
      { text: "Your next pay day is " },
      { fillIn: "Next pay day" },
      { text: ". See " },
      { fillIn: "Link to Pay" },
    ]);
    expect(wordParts("Hi {nope} and {first_name}{first_name}")).toEqual([
      { text: "Hi " },
      { text: "{nope}" },
      { text: " and " },
      { fillIn: "First name" },
      { fillIn: "First name" },
    ]);
    const html = renderToStaticMarkup(createElement(AnswerWords, { body: "For {next_shift}: ok" }));
    expect(html).toContain("data-fill-in");
    expect(html).toContain("Next shift");
    expect(html).not.toContain("{next_shift}");
  });

  it("uses, last edits, the switches' answers and a save, in the screens' words", () => {
    expect(usesText(0)).toBe("Not used in the last 7 days");
    expect(usesText(1)).toBe("Used once in the last 7 days");
    expect(usesText(23)).toBe("Used 23 times in the last 7 days");
    expect(channelUsesText(false, 4)).toBe("Off");
    expect(channelUsesText(true, 41)).toBe("41 answered in the last 7 days");
    expect(
      lastEditedText(
        {
          updatedByName: "Sam Rota",
          updatedAt: new Date("2026-11-02T09:41:00Z"),
          starterKey: null,
        },
        TZ,
      ),
    ).toBe("Edited by Sam Rota, 09:41 on Mon 2 Nov");
    expect(
      lastEditedText({ updatedByName: null, updatedAt: new Date(), starterKey: "pay_day" }, TZ),
    ).toBe("One of the starter answers, not changed yet");
    expect(channelSwitchResultText("app", { status: "saved", on: false })).toBe(
      "App messages: switched off. They go to a person.",
    );
    expect(channelSwitchResultText("texts", { status: "not_allowed" })).toBe(
      "Only admins can change automatic answers.",
    );
    expect(answerSwitchResultText("Pay day", { status: "switched", on: true })).toBe(
      "“Pay day” is on: it answers casuals now.",
    );
    expect(savedText("Pay day", false)).toBe(
      "Saved “Pay day”. It's off: nothing goes until you switch it on.",
    );
    for (const words of [
      ANSWERS_INTRO,
      MASTER_OFF,
      "App messages: answered automatically now, with the answers that are on.",
      "“Pay day” is off: those questions go to a person.",
      "Saved “Pay day”. It's on: it answers casuals now.",
      "No questions went to a person in the last 30 days.",
    ])
      expect(screens).toContain(words);
  });

  it("Make this an answer: their question on one line, cut at a word before 100 characters", () => {
    expect(exampleFromQuestion("  Is there\nfood   at the festival? ")).toBe(
      "Is there food at the festival?",
    );
    const long = `${"word ".repeat(30)}end`;
    const cut = exampleFromQuestion(long);
    expect([...cut].length).toBeLessThanOrEqual(100);
    expect(cut.endsWith("word")).toBe(true);
    expect(fillInLabels(["next_shift", "made_up"])).toEqual([
      "Next shift",
      "a fill-in not on the list",
    ]);
  });
});

describe("Enquiries: one of the firm's answers", () => {
  const at = (d: Date) => d.toISOString().slice(11, 16);
  it('the chip names it ("Answered automatically · Pay day"); other outcomes as before', () => {
    expect(outcomeWords("answer", "Pay day")).toBe("Answered automatically · Pay day");
    expect(outcomeWords("answer", null)).toBe("Answered automatically");
    expect(outcomeWords("keyword", "Pay day")).toBe("Answered by keyword");
    expect(VIEW_LABELS.answered).toBe("Answered automatically");
    expect(enquiriesEmptyText("answered", 90)).toBe(
      "Nothing answered automatically in the last 90 days.",
    );
    expect(screens).toContain('"Answered automatically · Pay day"');
  });

  it("how it was answered: which, how, who switched it on, what was filled in or missing", () => {
    const on = { by: "Sam Rota", at: new Date("2026-11-02T09:41:00Z") };
    expect(answerChosenStep({ name: "Pay day", matchedBy: "example", switchedOn: on }, at)).toBe(
      "“Pay day”, matched by one of its example questions. Switched on by Sam Rota at 09:41.",
    );
    expect(
      answerChosenStep(
        { name: "Pay day", matchedBy: "ai", switchedOn: { by: null, at: on.at } },
        at,
      ),
    ).toBe(
      "“Pay day”, picked by the AI from your answers that are on. Switched on when it was set up, at 09:41.",
    );
    expect(
      filledInStep({ fillIns: ["next_pay_day", "pay_link"], missing: null, changedSince: false }),
    ).toBe("Next pay day, Link to Pay. The values are in the words that went.");
    expect(filledInStep({ fillIns: [], missing: null, changedSince: true })).toBe(
      "Nothing: its words are the same for everyone. The answer's words have been changed since.",
    );
    expect(
      filledInStep({ fillIns: ["next_shift"], missing: ["next_shift"], changedSince: false }),
    ).toBe("Not sent: we have no Next shift for them, so it was passed to a person.");
    expect(screens).toContain(
      '"Not sent: we have no Next shift for them, so it was passed to a person."',
    );
    // Switched off (the answer, or its channel) between the read and the claim (M2).
    expect(
      filledInStep({
        fillIns: ["next_pay_day"],
        missing: null,
        changedSince: false,
        switchedOff: true,
      }),
    ).toBe("Not sent: it was switched off before it went, so it was passed to a person.");
    expect(sortedStep({ how: "person", why: "answer_switched_off" })).toBe(
      "One of your answers matched, but it was switched off before it went: passed to a person.",
    );
    expect(emailSortedStep({ how: "person", why: "answer_switched_off" })).toBe(
      "One of your answers matched, but it was switched off before it went: passed to a person.",
    );
    expect(screens).toContain(
      '"Not sent: it was switched off before it went, so it was passed to a person."',
    );
  });
});

describe("Messages: Not what you needed? Ask the office", () => {
  it("the intro in the mock-up's words, still sending a pay dispute to payroll", () => {
    expect(MESSAGES_INTRO).toBe(
      "Ask us anything. Common questions are answered straight away; anything else goes to the office. If your pay looks wrong, raise a pay query on the Pay page: it goes to payroll.",
    );
    expect(screens).toContain(MESSAGES_INTRO);
    expect(screens).toContain(`**${ASK_OFFICE_BUTTON}**`);
    expect(screens).toContain(`"${ASK_OFFICE_SENT}"`);
  });

  it("its words always name the answer and always reach a person: the keyword 'office' first, and never a library answer", () => {
    // Whatever the answer's name, even one holding another keyword ("Pay day", "Cancelling a
    // shift", "Help with shifts") or another answer's example question: "office" is the first
    // keyword, and a message with it never gets a library answer (the guardrails review, H1).
    const names = [
      ...STARTERS.map((s) => s.name),
      "Pay day",
      "Cancelling a shift",
      "Help with shifts",
      "Work available",
      "Uniform",
      "my last question",
    ];
    for (const name of names) {
      const words = askOfficeWords(name);
      expect(words, name).toBe(`Please can someone from the office help? (About: ${name})`);
      expect(words, name).toBe(askOfficeTexts(name)[0]);
      expect(keywordIntent(words), name).toBe("office");
      expect(libraryAllowed(words), name).toBe(false);
    }
    // The older wordings, still read as hers in a thread that holds one, reach a person too.
    for (const words of askOfficeTexts("Pay day")) {
      expect(keywordIntent(words)).toBe("office");
      expect(libraryAllowed(words)).toBe(false);
    }
  });

  it("the button sits under the latest of the firm's answers only", () => {
    const at = new Date("2026-11-10T10:40:00Z");
    const html = renderToStaticMarkup(
      createElement(MessagesView, {
        thread: {
          items: [
            { id: "m1", mine: true, text: "what do i wear", at, from: null },
            {
              id: "r1",
              mine: false,
              text: "For Steward. Automatic reply. — Acme Events Shift Team",
              at,
              from: "automatic",
              libraryAnswer: true,
            },
          ],
          more: false,
          latestMineAt: at,
          answered: true,
          askOffice: { replyId: "r1", words: "Please…", asked: false },
        },
        now: at,
        timeZone: TZ,
        linkOrigin: "https://acme.example.test",
        composer: null,
        askOffice: createElement("button", { type: "button" }, ASK_OFFICE_BUTTON),
      }),
    );
    expect(html).toContain(ASK_OFFICE_BUTTON);
    expect(html.indexOf(ASK_OFFICE_BUTTON)).toBeGreaterThan(html.indexOf("For Steward."));
    expect(html).toContain(MESSAGES_INTRO);
  });
});
