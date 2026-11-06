import { describe, expect, it } from "vitest";
import { NO_RATE_TEXT } from "@/lib/portal/format";
import {
  milesAway,
  travelLineCompact,
  travelLineText,
  type TravelFacts,
} from "@/lib/travel/line-copy";

// The casual app's travel sentence and the card's pay words, Phase 28 (28.8; docs/screens.md "The
// casual app, Phase 28"): while the travel time isn't worked out, one sentence ("About 2 miles away.
// Travel time isn't worked out yet."), the one source for Open shifts, the urgent board, Booked,
// Home's pass and the shift page; worked out, today's words. The shifts line (WhatsApp and text
// replies) keeps its own short form. Pure.

const TZ = "Europe/London";
const arriveBy = new Date("2026-11-07T09:00:00Z");
const estimated = (o: Partial<Extract<TravelFacts, { kind: "estimated" }>> = {}): TravelFacts => ({
  kind: "estimated",
  straightMetres: 9000,
  arriveBy,
  car: { minutes: 18, metres: 11587 },
  publicTransport: { minutes: 41 },
  ...o,
});

describe("the casual app's travel line", () => {
  it("minutes not worked out yet: one sentence, the distance in whole miles", () => {
    expect(travelLineText({ kind: "straight", straightMetres: 3200 }, TZ)).toBe(
      "About 2 miles away. Travel time isn't worked out yet.",
    );
    expect(travelLineText({ kind: "straight", straightMetres: 300 }, TZ)).toBe(
      "About 1 mile away. Travel time isn't worked out yet.",
    );
    expect(milesAway(11300)).toBe("About 7 miles away");
    // Nothing that reads as a value: no "(straight line)", no "not known", no "·" list.
    const sentence = travelLineText({ kind: "straight", straightMetres: 11300 }, TZ);
    expect(sentence).not.toMatch(/straight line|not known|·/);
    // One sentence of facts, then the one about the time: each ends with a full stop.
    expect(sentence.split(". ")).toEqual([
      "About 7 miles away",
      "Travel time isn't worked out yet.",
    ]);
  });

  it("minutes known: today's words, unchanged", () => {
    expect(travelLineText(estimated(), TZ)).toBe(
      "7.2 miles · 18 min by car · 41 min by public transport",
    );
    expect(travelLineText(estimated({ publicTransport: null }), TZ)).toBe(
      "7.2 miles · 18 min by car · no public transport by 09:00",
    );
    expect(travelLineText(estimated({ car: null }), TZ)).toBe(
      "about 6 miles (straight line) · over 90 min by car · 41 min by public transport",
    );
  });

  it("no distance (no travel area, or a site with no location): unchanged", () => {
    expect(travelLineText({ kind: "unknown" }, TZ)).toBe("Distance not known yet");
  });
});

describe("the shifts line's travel words", () => {
  it("keep their own short form whatever the app says", () => {
    expect(travelLineCompact({ kind: "straight", straightMetres: 11300 }, TZ)).toBe(
      "about 7 miles (straight line) · Travel time not known yet",
    );
    expect(travelLineCompact({ kind: "unknown" }, TZ)).toBe("Distance not known yet");
    for (const f of [estimated(), estimated({ car: null }), estimated({ publicTransport: null })])
      expect(travelLineCompact(f, TZ)).toBe(travelLineText(f, TZ));
  });
});

describe("a card's pay with no rate set", () => {
  it("reads 'Pay not given yet' (the shift's page is where she asks)", () => {
    expect(NO_RATE_TEXT).toBe("Pay not given yet");
  });
});
