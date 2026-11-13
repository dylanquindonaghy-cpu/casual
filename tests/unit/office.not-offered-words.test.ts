import { describe, expect, it } from "vitest";
import type { LicenceState, NotOfferedWhy } from "@/lib/office/not-offered";
import {
  LICENCE_FALLBACK,
  licenceWhy,
  NOBODY_LEFT_OUT,
  NOT_OFFERED,
  notOfferedMore,
  notOfferedWhy,
} from "@/lib/office/offer-words";

// "Not offered, and why" (Phase 26.9, off-2; docs/screens.md "Offering a shift"): every reason's
// words, as the doc gives them.

const WORDS: Record<NotOfferedWhy, string> = {
  booked: "Booked on it",
  cancelled: "Cancelled off it",
  offered: "Already offered it",
  offers_off: "Turned offers off",
  cap: "Over today's 3 offers",
  licence: "A licence or card missing or out of date",
  elsewhere: "Booked elsewhere then",
  rest: "Too soon after another session",
  hours: "Over their weekly hours",
  unavailable: "Marked unavailable",
  blocked: "Blocked from the site",
  no_rule: "No rule for the role",
  unreachable: "No way to reach them",
  rules: "The rules say no",
};

describe("Not offered, and why: the words", () => {
  it.each(Object.entries(WORDS) as [NotOfferedWhy, string][])("%s: %s", (why, words) => {
    expect(notOfferedWhy(why, 3)).toBe(words);
  });

  it("the heading, the empty line, the rest counted, and the day's cap as the firm sets it", () => {
    expect(NOT_OFFERED).toBe("Not offered, and why");
    expect(NOBODY_LEFT_OUT).toBe("Everyone with the role can be offered it.");
    expect(notOfferedMore(4)).toBe("And 4 more.");
    expect(notOfferedWhy("cap", 5)).toBe("Over today's 5 offers");
  });
});

// A licence or card (Phase 37.3, w1-03): the first card the rules found, by the firm's own name, in
// the office's existing words. "No licence in date" is gone (the rule in this phase changes it).
const DS = "SIA door supervisor licence";
const lic = (
  state: LicenceState,
  names: string[] = [DS],
  date: string | null = null,
  year = 2026,
) => ({ names, state, date, year });

describe("Not offered, and why: a licence or card names the card", () => {
  it.each([
    [
      lic("missing", ["manual handling certificate"]),
      "Needs manual handling certificate (none on file)",
    ],
    [
      lic("missing", ["SIA door supervisor licence", "SIA security guard licence"]),
      "Needs SIA door supervisor licence or SIA security guard licence (none on file)",
    ],
    [lic("out_of_date", [DS], "2026-10-07"), "SIA door supervisor licence out of date (7 Oct)"],
    [
      lic("out_of_date", [DS], "2025-10-07"),
      "SIA door supervisor licence out of date (7 Oct 2025)",
    ],
    [lic("out_of_date"), "SIA door supervisor licence out of date"],
    [lic("runs_out", [DS], "2026-11-14"), "SIA door supervisor licence runs out Sat 14 Nov"],
    [lic("runs_out", [DS], "2027-01-08"), "SIA door supervisor licence runs out Fri 8 Jan 2027"],
    [lic("marked_expired"), "SIA door supervisor licence marked expired"],
    [lic("suspended"), "SIA door supervisor licence suspended"],
    [
      lic("applied", ["manual handling certificate"]),
      "Manual handling certificate applied for, not counted",
    ],
    [lic("over_allowance"), "SIA door supervisor licence applied for, over the allowance"],
    [lic("suspended", ["manual handling certificate"]), "Manual handling certificate suspended"],
  ])("%o reads %s", (l, words) => {
    expect(licenceWhy(l)).toBe(words);
    expect(notOfferedWhy("licence", 3, l)).toBe(words);
  });

  it("with no card found, the office's plain phrase; never 'No licence in date'", () => {
    expect(LICENCE_FALLBACK).toBe("A licence or card missing or out of date");
    expect(notOfferedWhy("licence", 3)).toBe(LICENCE_FALLBACK);
  });

  it("other reasons ignore a licence passed by mistake", () => {
    expect(notOfferedWhy("rest", 3, lic("suspended"))).toBe("Too soon after another session");
  });
});
