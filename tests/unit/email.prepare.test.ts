import { describe, expect, it } from "vitest";
import { BODY_MAX, ownWords, prepareEmail, SUBJECT_MAX } from "@/lib/email/prepare";

// An email made ready to keep (P7.3; src/lib/email/prepare.ts): only what the casual wrote this
// time, the quoted history, signature and attachments left out, and nothing at all of anyone
// else's. Made-up people, addresses and numbers (Ofcom's drama range) only.

const lines = (...l: string[]) => l.join("\n");

describe("quoted history taken off", () => {
  it("a reply above Gmail's quote, its header on one line or wrapped", () => {
    expect(
      ownWords(
        lines(
          "Yes I can do Saturday.",
          "",
          "On Mon, 2 Nov 2026 at 09:00, Acme Shift Team <shifts@acme.example.com> wrote:",
          "> Can you do Saturday?",
          "> Acme Shift Team",
        ),
      ),
    ).toBe("Yes I can do Saturday.");
    expect(
      ownWords(
        lines(
          "Yes.",
          "On Mon, 2 Nov 2026 at 09:00, Acme Shift Team <",
          "shifts@acme.example.com> wrote:",
          "> Can you do Saturday?",
        ),
      ),
    ).toBe("Yes.");
  });

  it("a reply written below the quote keeps the reply; one written between quoted lines keeps each part", () => {
    expect(
      ownWords(
        lines(
          "On Mon, 2 Nov 2026 at 09:00, Acme Shift Team <shifts@acme.example.com> wrote:",
          "> Can you do Saturday?",
          "",
          "Yes I can.",
        ),
      ),
    ).toBe("Yes I can.");
    expect(ownWords(lines("> Saturday?", "Yes.", "> And Sunday?", "No, sorry."))).toBe(
      "Yes.\nNo, sorry.",
    );
  });

  it("Outlook's block, with or without its line of underscores, and an Original Message", () => {
    const below = [
      "From: Acme Shift Team <shifts@acme.example.com>",
      "Sent: 02 November 2026 09:00",
      "To: Ann Example <ann.example@example.com>",
      "Subject: Saturday",
      "",
      "Hi Ann, can you do Saturday?",
    ];
    expect(ownWords(lines("I can't make it.", "", ...below))).toBe("I can't make it.");
    expect(ownWords(lines("Fine.", "________________________________", ...below))).toBe("Fine.");
    expect(ownWords(lines("Ok", "-----Original Message-----", ...below))).toBe("Ok");
    // Under the underscores, a name from the address book with no address: still the block.
    const named = ["From: Acme Shift Team", "Sent: 02 November 2026 09:00", "To: Ann Example"];
    expect(ownWords(lines("Fine.", "________________________________", ...named))).toBe("Fine.");
    // With no underscores, a "From:" with no address is theirs.
    expect(ownWords(lines("Fine.", "", ...named))).toBe(
      "Fine.\n\nFrom: Acme Shift Team\nSent: 02 November 2026 09:00\nTo: Ann Example",
    );
    // "From:" in what they wrote, with no header after it, is theirs; so are times they ask for.
    expect(ownWords("From: me, sorry, I'm off sick.")).toBe("From: me, sorry, I'm off sick.");
    expect(ownWords(lines("Can I change Saturday?", "From: 10:00", "To: 18:00"))).toBe(
      "Can I change Saturday?\nFrom: 10:00\nTo: 18:00",
    );
    expect(ownWords(lines("Can I change?", "From: 10:00", "Date: Saturday 7th"))).toBe(
      "Can I change?\nFrom: 10:00\nDate: Saturday 7th",
    );
    expect(
      ownWords(lines("My new address:", "From: ann.new@example.com", "To: please update it")),
    ).toBe("My new address:\nFrom: ann.new@example.com\nTo: please update it");
  });

  it("nothing left of a forwarded thread, unless something was written above it", () => {
    const forwarded = [
      "---------- Forwarded message ---------",
      "From: Acme Shift Team <shifts@acme.example.com>",
      "Date: Mon, 2 Nov 2026 at 09:00",
      "Subject: Saturday",
      "",
      "Hi Ann, can you do Saturday?",
    ];
    expect(ownWords(lines(...forwarded))).toBeNull();
    expect(ownWords(lines("See below.", "", ...forwarded))).toBe("See below.");
    expect(ownWords(lines("Begin forwarded message:", "", "From: someone"))).toBeNull();
  });

  it("an ordinary 'On …' sentence isn't a header, even just above one", () => {
    expect(ownWords("On Saturday I can't come.")).toBe("On Saturday I can't come.");
    const quote = [
      "On Sat, 7 Nov 2026 at 10:00, Acme Shift Team <shifts@acme.example.com> wrote:",
      "> Can you do Saturday?",
    ];
    expect(ownWords(lines("On holiday that week, sorry", "", ...quote))).toBe(
      "On holiday that week, sorry",
    );
    expect(ownWords(lines("Hi,", "On Sunday I'm free.", "", ...quote))).toBe(
      "Hi,\nOn Sunday I'm free.",
    );
    expect(ownWords(lines("On it.", ...quote))).toBe("On it.");
    // A header with no "On" (some apps write only "Name <address> wrote:"): their "On …" line two
    // above it, across a blank line, is still theirs, and the header goes.
    expect(
      ownWords(
        lines(
          "On holiday that week, sorry",
          "",
          "Acme Shift Team <shifts@acme.example.com> wrote:",
          "> Can you do Saturday?",
        ),
      ),
    ).toBe("On holiday that week, sorry");
    // Straight above it: a line of theirs with no year is never the header's start.
    expect(
      ownWords(
        lines(
          "On Sunday I can do 10:00 to 18:00",
          "Acme Shift Team <shifts@acme.example.com> wrote:",
          "> Can you do Saturday?",
        ),
      ),
    ).toBe("On Sunday I can do 10:00 to 18:00");
    // Nor one quoted differently from the header, year or not.
    expect(
      ownWords(
        lines(
          "On Sunday I can do the 2026 rota's late shift",
          "> Acme Shift Team <shifts@acme.example.com> wrote:",
          ">> Can you do Saturday?",
        ),
      ),
    ).toBe("On Sunday I can do the 2026 rota's late shift");
    // "… wrote:" with no "On" and no address isn't a header: theirs.
    expect(ownWords(lines("On Sunday, my manager wrote:", "> see you then"))).toBe(
      "On Sunday, my manager wrote:",
    );
  });

  it("iPhone's header, wrapped with 'wrote:' on its own line, quoted or not", () => {
    const header = [
      "On 2 Nov 2026, at 09:00, Acme Shift Team <shifts@acme.example.com>",
      "wrote:",
      "",
      "> Can you do Saturday?",
    ];
    expect(ownWords(lines("Yes, see you then.", "", ...header))).toBe("Yes, see you then.");
    // Under the quote, in a reply to a reply: the header quoted as deep as each other.
    expect(
      ownWords(
        lines(
          "> On 2 Nov 2026, at 09:00, Acme Shift Team <shifts@acme.example.com>",
          "> wrote:",
          ">> Can you do Saturday?",
          "",
          "Yes I can.",
        ),
      ),
    ).toBe("Yes I can.");
    // A wrapped header straight under their own "On …" line: the nearer "On" starts it.
    expect(
      ownWords(
        lines(
          "On my way.",
          "On Sat, 7 Nov 2026 at 10:00, Acme <",
          "shifts@acme.example.com> wrote:",
        ),
      ),
    ).toBe("On my way.");
  });
});

describe("the signature and the rest", () => {
  it("a signature from its '-- ' line, and a phone's sign-off", () => {
    expect(ownWords(lines("Thanks", "-- ", "Ann Example", "07700 900123"))).toBe("Thanks");
    expect(ownWords(lines("Running late", "", "Sent from my iPhone"))).toBe("Running late");
    expect(ownWords(lines("Ok", "Get Outlook for Android"))).toBe("Ok");
  });

  it("Windows line ends, control characters and blank lines tidied; nothing left is none", () => {
    expect(ownWords("Line one\r\n\r\n\r\n\r\nLine two\u0007  ")).toBe("Line one\n\nLine two");
    expect(ownWords("   \n\n  ")).toBeNull();
    expect(ownWords("> only a quote")).toBeNull();
  });

  it("capped, never cutting a character in half", () => {
    const long = `${"a".repeat(BODY_MAX - 1)}👍🏽 more`;
    const kept = ownWords(long) ?? "";
    expect(Array.from(kept).length).toBeLessThanOrEqual(BODY_MAX);
    expect(kept.endsWith("�")).toBe(false);
  });
});

describe("what's kept of an email", () => {
  it("a known casual's: the subject tidied, their own words, how many attachments were left out", () => {
    expect(
      prepareEmail({
        subject: "  Re:   Saturday\u0000 ",
        text: lines("Yes.", "On Mon, 2 Nov 2026, Acme wrote:", "> Saturday?"),
        attachments: 2,
        fromKnownCasual: true,
      }),
    ).toEqual({ subject: "Re: Saturday", body: "Yes.", attachments: 2 });
    expect(
      prepareEmail({
        subject: "x".repeat(SUBJECT_MAX + 10),
        text: null,
        attachments: 5000,
        fromKnownCasual: true,
      }),
    ).toEqual({ subject: "x".repeat(SUBJECT_MAX), body: null, attachments: 1000 });
  });

  it("anyone else's: neither subject nor words, only how many attachments", () => {
    expect(
      prepareEmail({
        subject: "Invoice",
        text: "Please find our invoice attached.",
        attachments: 1,
        fromKnownCasual: false,
      }),
    ).toEqual({ subject: null, body: null, attachments: 1 });
  });
});

describe("every header pattern stays linear (the inbox's webhook runs it in the web request)", () => {
  // Each is about 500,000 characters, the most the webhook takes (512 kB), aimed at one pattern's
  // worst case. Linear: milliseconds. Quadratic: minutes.
  const N = 500_000;
  const fill = (unit: string) => unit.repeat(Math.ceil(N / unit.length)).slice(0, N);
  const ATTACKS: [string, string][] = [
    ["Outlook's From: angle brackets never closed", `From: ${fill("<")}`],
    ["Outlook's From: brackets and letters", `From: ${fill("<a")}`],
    [
      "Outlook's From: under underscores, Sent below",
      `${"_".repeat(32)}\nFrom: ${fill("<")}\nSent: x`,
    ],
    ["an On line of spaces", `On ${fill(" ")}x`],
    ["wrote: then spaces, not at the end", `x wrote:${fill(" ")}x`],
    ["many wrote:", fill("wrote: ")],
    ["Original Message dashes", `--- Original Message ${fill("-")}x`],
    ["a phone's sign-off, very long", `Ok\nSent from my ${fill("a")}`],
    ["quote marks", fill("> ")],
    ["one header line after another", fill("From: a <b>\n")],
    ["one blank line after another", fill("\n")],
  ];

  it.each(ATTACKS)("%s: in well under a second", (_name, text) => {
    expect(text.length).toBeGreaterThanOrEqual(N);
    const started = performance.now();
    ownWords(text);
    expect(performance.now() - started).toBeLessThan(750);
  });
});
