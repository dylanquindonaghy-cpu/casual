import { describe, expect, it } from "vitest";
import { tokenFromFragment } from "@/lib/auth/link-fragment";

// A login link's token, as the link page reads it (audit L10): punctuation a phone or a copy takes
// from the end of the sentence isn't part of it.
const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v";

describe("the token in a login link", () => {
  it("is everything after the #, with trailing punctuation left off", () => {
    for (const tail of ["", ".", ",", ")", ".)", "!", "?", ";", ":", "'", '"', "’", " "]) {
      expect(tokenFromFragment(`#${TOKEN}${tail}`), JSON.stringify(tail)).toBe(TOKEN);
    }
  });

  // What a browser's location.hash actually holds: anything outside plain ASCII, and quotes,
  // spaces and ">", percent-encoded.
  it("the same, when the browser gives the punctuation percent-encoded", () => {
    for (const tail of ["%E2%80%99", "%E2%80%9D", "%22", "%3E", "%20", ".%20", "%E2%80%99."]) {
      expect(tokenFromFragment(`#${TOKEN}${tail}`), tail).toBe(TOKEN);
    }
    // As a browser would encode it, from a link with a curly quote typed after it.
    expect(tokenFromFragment(new URL(`https://acme.example/l#${TOKEN}’`).hash)).toBe(TOKEN);
  });

  it("anything after the token's 43 characters is left off, whatever it is", () => {
    for (const tail of ["…", "«", "»", "%E2%80%A6", " please", "-"]) {
      expect(tokenFromFragment(`#${TOKEN}${tail}`), tail).toBe(TOKEN);
    }
  });

  it("broken percent-encoding is read as it is (and the page then says the link didn't work)", () => {
    expect(tokenFromFragment(`#${TOKEN.slice(0, 40)}%E2%80`)).toBe(`${TOKEN.slice(0, 40)}%E2%80`);
  });

  it("keeps a token's own - and _ (they can end one)", () => {
    expect(tokenFromFragment(`#${TOKEN.slice(0, 41)}-_`)).toBe(`${TOKEN.slice(0, 41)}-_`);
  });

  it("nothing there: null", () => {
    expect(tokenFromFragment("")).toBeNull();
    expect(tokenFromFragment("#")).toBeNull();
    expect(tokenFromFragment("#.")).toBeNull();
  });
});
