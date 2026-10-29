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
    // "From:" in what they wrote, with no header after it, is theirs.
    expect(ownWords("From: me, sorry, I'm off sick.")).toBe("From: me, sorry, I'm off sick.");
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

  it("an ordinary 'On …' sentence isn't a header", () => {
    expect(ownWords("On Saturday I can't come.")).toBe("On Saturday I can't come.");
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
