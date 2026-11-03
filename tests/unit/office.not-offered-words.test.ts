import { describe, expect, it } from "vitest";
import type { NotOfferedWhy } from "@/lib/office/not-offered";
import {
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
  licence: "No licence in date",
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
