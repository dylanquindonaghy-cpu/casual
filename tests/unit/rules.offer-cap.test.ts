import { describe, expect, it } from "vitest";
import { DAILY_OFFER_CAP, localDayOf, mayOfferToday } from "@/lib/rules/offer-cap";

// The daily offer cap (src/lib/rules/offer-cap.ts): at most 3 shift offers per worker per
// firm-local day, unless the offer is urgent.

const TZ = "Europe/London";

describe("mayOfferToday", () => {
  it("the cap is 3", () => {
    expect(DAILY_OFFER_CAP).toBe(3);
  });

  it("non-urgent: yes up to 2 offers today, no from 3", () => {
    expect(mayOfferToday({ offersToday: 0, urgent: false })).toBe(true);
    expect(mayOfferToday({ offersToday: 2, urgent: false })).toBe(true);
    expect(mayOfferToday({ offersToday: 3, urgent: false })).toBe(false);
    expect(mayOfferToday({ offersToday: 7, urgent: false })).toBe(false);
  });

  it("urgent: always yes, however many offers today", () => {
    expect(mayOfferToday({ offersToday: 0, urgent: true })).toBe(true);
    expect(mayOfferToday({ offersToday: 3, urgent: true })).toBe(true);
    expect(mayOfferToday({ offersToday: 50, urgent: true })).toBe(true);
  });
});

describe("localDayOf", () => {
  it("winter (GMT): midnight to midnight UTC", () => {
    expect(localDayOf(new Date("2026-11-02T09:00:00Z"), TZ)).toEqual({
      from: new Date("2026-11-02T00:00:00Z"),
      to: new Date("2026-11-03T00:00:00Z"),
    });
  });

  it("summer (BST): the local day starts at 23:00 UTC the evening before", () => {
    // 23:30 UTC on 14 July is 00:30 on 15 July in London.
    expect(localDayOf(new Date("2026-07-14T23:30:00Z"), TZ)).toEqual({
      from: new Date("2026-07-14T23:00:00Z"),
      to: new Date("2026-07-15T23:00:00Z"),
    });
  });

  it("the last moment of the day is in it; local midnight starts the next", () => {
    const day = localDayOf(new Date("2026-11-02T23:59:59Z"), TZ);
    expect(day.from).toEqual(new Date("2026-11-02T00:00:00Z"));
    expect(localDayOf(new Date("2026-11-03T00:00:00Z"), TZ).from).toEqual(day.to);
  });

  it("the clocks go back (25 October 2026): a 25-hour day", () => {
    const day = localDayOf(new Date("2026-10-25T12:00:00Z"), TZ);
    expect(day).toEqual({
      from: new Date("2026-10-24T23:00:00Z"),
      to: new Date("2026-10-26T00:00:00Z"),
    });
    expect(day.to.getTime() - day.from.getTime()).toBe(25 * 3_600_000);
  });

  it("the clocks go forward (29 March 2026): a 23-hour day", () => {
    const day = localDayOf(new Date("2026-03-29T12:00:00Z"), TZ);
    expect(day).toEqual({
      from: new Date("2026-03-29T00:00:00Z"),
      to: new Date("2026-03-29T23:00:00Z"),
    });
    expect(day.to.getTime() - day.from.getTime()).toBe(23 * 3_600_000);
  });
});
