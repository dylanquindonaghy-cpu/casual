// The pay pages' code step and their ways on (docs/screens.md "### 28.10", `/pay`, `/pay/query`;
// Phase 28.10). "6‑digit" has a non-breaking hyphen (U+2011) in every string, so it never splits
// across two lines on a phone (the Help page's rule). Plain strings and functions with no imports:
// safe for the client code gate, the pay query form and their tests.

export const SIX_DIGIT = "6‑digit";

// How the code comes: "message" (a text) or "email". With no way at all, there's no code step.
export type CodeWay = "message" | "email";

// The pay pages' one way on to a person: Messages (her thread with the office), never "contact
// the office" with nothing to tap. About her pay (`?about=pay`, src/lib/portal/message-office.ts
// MESSAGES_ABOUT_PAY): what she sends from there goes to payroll's digest as a pay query (Phase 29.1,
// Dylan's decision 20; golden rule 9), never sorted, so a pay question that can't go on Pay (no code
// sender, or older than 90 days) never gets the automatic pay link back, which would only bring her
// here again (the guardrails review of 28.10). Payroll's answer shows here, in "Your pay queries".
export const MESSAGE_OFFICE = { href: "/messages?about=pay", label: "Message the office" } as const;

export const PAY_CODE = {
  ask: (way: CodeWay) =>
    `To keep your pay private, we'll ${way === "email" ? "email" : "text"} you a ${SIX_DIGIT} code.`,
  sent: (way: CodeWay) =>
    way === "email"
      ? `We've emailed you a ${SIX_DIGIT} code. It works for 10 minutes.`
      : `We've sent a ${SIX_DIGIT} code by text. It works for 10 minutes.`,
  notSixDigits: (way: CodeWay) =>
    `Enter the ${SIX_DIGIT} code from your ${way === "email" ? "email" : "message"}.`,
  stopped: "This code has stopped working.",
  send: (way: CodeWay) => (way === "email" ? "Email me a code" : "Send me a code"),
  sendNew: (way: CodeWay) => (way === "email" ? "Email me a new code" : "Send me a new code"),
  // On the pay query, above the code card: she comes back to the query once the code is right.
  queryIntro: `Enter your ${SIX_DIGIT} code first. Then you'll come straight back here.`,
} as const;

// No way to send a code (no text sender, and email login off): a slip, then "Message the office".
export const NO_CODE_SENDER = {
  pay: {
    title: "We can't send you a code yet, so your pay can't open.",
    body: "Your pay day is above. For anything else about your pay, message the office.",
  },
  query: {
    title: "We can't send you a code yet, so you can't raise a pay query here.",
    body: "Message the office about your pay instead.",
  },
} as const;

// The pay query's 30 minutes ran out while she was writing: a link back to its own code step.
export const CODE_RAN_OUT = {
  before: "Your pay locks again after 30 minutes. ",
  link: "Get a new code",
  after: ", then try again.",
} as const;
