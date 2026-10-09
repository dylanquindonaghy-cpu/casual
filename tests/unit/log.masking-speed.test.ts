import { describe, expect, it } from "vitest";
import { capText, maskText, maskWithoutLimit, MAX_PATH, MAX_TEXT, redact } from "@/lib/log/mask";

// Audit M13: the masker runs on every request's path, before any login, in the one web process.
// Two of its patterns were quadratic (a 16,000-character path took about 0.3 s), so a few crafted
// requests a second could stall every firm. Now every string is cut before masking (MAX_TEXT, and
// MAX_PATH for paths), and every pattern is linear on its own: each attack below is 200,000
// characters through the masker with no cut, which a quadratic pattern can't finish in seconds.

const N = 200_000;
const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v"; // made up: a login token's shape
const fill = (unit: string, extra = "") =>
  unit.repeat(Math.ceil(N / unit.length)).slice(0, N) + extra;

// Each attack aims at one pattern's worst case (its name says which).
const ATTACKS: [string, string][] = [
  ["EMAIL: letters with no @", fill("a")],
  ["EMAIL: a dotted run with no @", fill("a.")],
  ["EMAIL: a run, then an @ with no domain", fill("a", "@")],
  ["EMAIL: many @ with no domain", fill("a@")],
  ["EMAIL: a domain of dots and no last part", `x@${fill("a.")}`],
  ["EMAIL: a domain of hyphens", `x@${fill("a-")}`],
  ["URL_TAIL: slashes with no ? or #", fill("/")],
  ["URL_TAIL: a path with no ? or #", fill("/a")],
  ["URL_TAIL: a path of dots and tildes", fill("/.~")],
  ["URL_TAIL: addresses glued together", fill("http://")],
  ["URL_TAIL: an address with a long host", `https://${fill("a")}`],
  ["URL_TAIL: addresses apart, none with a ?", fill("http://a ")],
  ["PHONE: digits and separators", fill("1 2-3.(4) ")],
  ["PHONE: brackets", fill("1(((")],
  ["PHONE: plus signs", fill("+1")],
  ["PHONE: one long run of digits", fill("0")],
  ["PROTECTED: hex", fill("0f")],
  ["PROTECTED: date-like runs", fill("2026-")],
  ["PROTECTED: Twilio-like ids", fill("SM0123456789abcdef")],
  ["QUOTED_VALUE: a quote never closed", `: "${fill("a")}`],
  ["QUOTED_VALUE: colons and quotes", fill(':"')],
  ["QUOTED_VALUE: the word value", fill("value ")],
  ["URL_TAIL: addresses after a bracket", fill("(http://")],
  ["URL_TAIL: addresses after =", fill("=https://")],
  ["URL_TAIL: addresses after a comma", fill(",http://a")],
  ["URL_TAIL: a path, then a ? at the very end", fill("/a", "?x")],
  ["QUOTED_VALUE: a quote never closed, ending in a backslash", `: "${fill("a")}\\`],
  ["QUOTED_VALUE: backslashes", `: "${fill("\\")}`],
  ["EMAIL: domains with no local part", fill("@a.")],
  ["percent signs", fill("%4")],
  ["FAILED_QUERY", `Failed query: ${fill("x")}`],
];

describe("every masking pattern stays linear (audit M13)", () => {
  it.each(ATTACKS)("%s: 200,000 characters masked in well under a second", (_name, text) => {
    const started = performance.now();
    maskWithoutLimit(text);
    // Linear: a few milliseconds. Quadratic: minutes.
    expect(performance.now() - started).toBeLessThan(750);
  });

  it("the attacks are the length they say", () => {
    for (const [name, text] of ATTACKS) expect(text.length, name).toBeGreaterThanOrEqual(N);
  });

  it("a stack trace with a huge line: still quick, and the line isn't kept", () => {
    const err = new Error("x");
    err.stack = `Error: x\n    at ${fill("a")} (/app/x.ts:1:1)\n    at save (/app/src/x.ts:10:5)`;
    const started = performance.now();
    const out = redact(err) as { stack: string[] };
    expect(performance.now() - started).toBeLessThan(750);
    expect(out.stack).toEqual(["at save (/app/src/x.ts:10:5)"]);
  });
});

describe("strings are cut before masking", () => {
  it("login links glued to a word or address are still withheld", () => {
    for (const text of [
      `acme.localhost:3100/l#${TOKEN}`,
      `acme.example/office/l#${TOKEN}`,
      `./office/l#${TOKEN}`,
      `xhttps://acme.localhost:3100/l#${TOKEN}`,
      `a%2Fl%23${TOKEN}`,
      `(https://acme.example/l#${TOKEN})`,
      `href="/l#${TOKEN}"`,
    ]) {
      expect(maskText(text), text).not.toContain("A1b2C3d4");
      expect(maskText(text), text).toContain("?[withheld]");
    }
  });

  it("emails glued together are each masked", () => {
    expect(maskText("ann@example.com+bob@example.org")).toBe("***@example.com***@example.org");
    expect(maskText('"ann.booker@example.com"')).toBe('"***@example.com"');
    expect(maskText("mailto:ann@example.com")).toBe("mailto:***@example.com");
    expect(maskText("@example.com alone")).toBe("@example.com alone");
  });

  it("anything over MAX_TEXT is cut, and says so; shorter strings are untouched", () => {
    expect(MAX_TEXT).toBe(2000);
    expect(MAX_PATH).toBe(512);
    expect(capText("short")).toBe("short");
    const cut = capText(fill("word "));
    expect(cut.length).toBeLessThanOrEqual(MAX_TEXT + 30);
    expect(cut.endsWith("… [cut: too long to log]")).toBe(true);
    expect(capText(fill("/a"), MAX_PATH).length).toBeLessThanOrEqual(MAX_PATH + 30);
  });

  it("the whole 200,000 characters through maskText: quick, because it's cut first", () => {
    for (const [name, text] of ATTACKS) {
      const started = performance.now();
      maskText(text);
      expect(performance.now() - started, name).toBeLessThan(100);
    }
  });

  // Wherever the cut falls, nothing of a phone number, email, login token or quoted value is left
  // unmasked (the guardrails review found the first cut leaving part of a list of numbers, of a
  // long percent-encoded word and of a quoted value). Every cut position inside each sample.
  const SAMPLES = [
    "call 07700 900123 now ",
    "+44 (0)7700 900123 ",
    "(07700) 900-123 ",
    "07700.900.123 ",
    "07700 %20 900 %20 123 ",
    "Unknown numbers:\n07700900123\n07700900124\n07700900125\n",
    "to: +44 7700 900123 +44 7700 900124 +44 7700 900125 ",
    "mail ann.booker@example.com now ",
    "q=ann.booker%40example.com&m=%2B447700900123 ",
    "Hi%20Ann%20Booker%20here%2C%20my%20number%20is%2007700%20900123%2C%20",
    `link https://acme.example/l#${TOKEN} `,
    `link acme.example/office/l#${TOKEN} `,
  ];
  const leaks = (out: string) =>
    /\d{4,}|ann|booker|A1b2C3d4|\b7700\b/i.test(out.replace(/\[cut: too long to log\]/, ""));
  it("never leaves part of a phone number, email or token at the cut, wherever it falls", () => {
    for (const sample of SAMPLES) {
      const run = sample.repeat(Math.ceil(400 / sample.length) + 1);
      for (let shift = 0; shift < sample.length; shift += 1) {
        // Filler that's safe to log, then the samples, with the cut `shift` characters into them.
        const text = "x ".repeat(MAX_TEXT).slice(0, MAX_TEXT - 300 - shift) + run;
        expect(leaks(maskText(text)), `${JSON.stringify(sample)} cut ${shift} in`).toBe(false);
        expect(leaks(maskText(capText(text, MAX_PATH))), `path: ${shift}`).toBe(false);
      }
    }
  });

  it("a long percent-encoded word cut in the middle (one word to the cut) leaves nothing", () => {
    const share = encodeURIComponent(
      `Hi Ann Booker here, my number is 07700 900123, mail ann.booker@example.com. ${"Thanks ".repeat(400)}`,
    );
    for (const text of [
      `/share/${"q".repeat(450)}${share}`,
      `/share/${"q".repeat(1950)}${share}`,
    ]) {
      expect(leaks(maskText(text))).toBe(false);
      expect(leaks(maskText(capText(text, MAX_PATH)))).toBe(false);
    }
  });

  it("a quoted value cut before its closing quote is still withheld", () => {
    const value = `Priya Patel, 12 High Street, Bristol BS1 4AA ${"and more ".repeat(400)}`;
    const out = maskText(`invalid input syntax for type integer: "${value}"`);
    expect(out).toBe(`invalid input syntax for type integer: "[withheld]"… [cut: too long to log]`);
    expect(maskText(`value "Priya Patel\\`)).toBe(`value "[withheld]"`);
  });
});
