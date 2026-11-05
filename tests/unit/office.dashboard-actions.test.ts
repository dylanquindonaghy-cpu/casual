import { describe, expect, it } from "vitest";
import { onWatchList, WATCH_BELOW } from "@/lib/office/dashboard-cards-data";
import type { Update } from "@/lib/office/dashboard-map";
import {
  NO_REPLY_HREF,
  OFFER_THE_PLACE,
  OPEN_THE_SESSION,
  SEE_THE_OFFERS,
  SEE_THE_RECORD,
  updateAction,
  updateLines,
} from "@/lib/office/dashboard-map-copy";
import { reliabilityOf, type Reliability } from "@/lib/rules/reliability";

// The dashboard's actions (Phase 27.10; Dylan, 2026-11-05: "there still needs to be more ctas and
// data here on the dash but keep it simple"): which one action each update gets
// (src/lib/office/dashboard-map-copy.ts updateAction), every case, with its words, where it goes and
// what a screen reader hears; and the watch list's one rule (dashboard-cards-data.ts onWatchList),
// which the Watch list card and Coming up's "On the watch list" chip both read.
// tests/unit/office.board.test.ts renders them in the columns.

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);
// Thursday 5 November 2026, 07:00 London (GMT).
const NOW = at("2026-11-05T07:00:00Z");

const cancelled = (o: Partial<Extract<Update, { kind: "cancelled" }>> = {}): Update => ({
  kind: "cancelled",
  at: at("2026-11-05T06:00:00Z"),
  shiftId: "s-door",
  ref: "a-chloe",
  worker: "Chloe Quigley",
  role: "door_supervisor",
  site: "Acme Demo Arena",
  startsAt: at("2026-11-07T08:00:00Z"),
  noticeHours: 50,
  strike: null,
  reopened: true,
  ...o,
});

describe("each update's one action", () => {
  it("a cancellation whose place is still to fill: Offer the place, in the offer panel", () => {
    expect(updateAction(cancelled(), TZ)).toEqual({
      label: "Offer the place",
      href: "/office/offer/s-door",
      name: "Offer the place: door supervisor, Sat 7 Nov 08:00",
      offer: "s-door",
    });
    // An acronym role stays in capitals mid-sentence.
    expect(updateAction(cancelled({ role: "csas_officer" }), TZ)?.name).toBe(
      "Offer the place: CSAS officer, Sat 7 Nov 08:00",
    );
    // Summer time: the session's own clock in London.
    expect(updateAction(cancelled({ startsAt: at("2026-10-24T07:00:00Z") }), TZ)?.name).toBe(
      "Offer the place: door supervisor, Sat 24 Oct 08:00",
    );
  });

  it("any other cancellation (filled since, started, cancelled by the office): See the record", () => {
    const record = updateAction(cancelled({ reopened: false }), TZ);
    expect(record).toEqual({
      label: "See the record",
      href: "/office/cancellations/a-chloe",
      name: "See the record of Chloe Quigley's cancellation: door supervisor, Sat 7 Nov 08:00",
      offer: null,
    });
    // Whatever the strike or the notice: only whether the place is still to fill decides it.
    for (const o of [{ strike: "live" as const }, { strike: "withdrawn" as const }, {}])
      expect(updateAction(cancelled({ ...o, noticeHours: 3, reopened: false }), TZ)?.label).toBe(
        SEE_THE_RECORD,
      );
    expect(updateAction(cancelled({ strike: "live", noticeHours: 3 }), TZ)?.label).toBe(
      OFFER_THE_PLACE,
    );
    // The record's link is the row's own.
    expect(record?.href).toBe(updateLines(cancelled({ reopened: false }), TZ).href);
  });

  it("a place taken: Open the session", () => {
    const took: Update = {
      kind: "took",
      at: at("2026-11-05T09:06:00Z"),
      shiftId: "s-steward",
      worker: "Ben Fraser",
      role: "steward",
      site: null,
      startsAt: at("2026-11-08T17:00:00Z"),
      placesFree: 2,
    };
    expect(updateAction(took, TZ)).toEqual({
      label: "Open the session",
      href: "/office/shifts/s-steward",
      name: "Open the session: steward, Sun 8 Nov 17:00",
      offer: null,
    });
    // Full now or not, the same.
    expect(updateAction({ ...took, placesFree: 0 }, TZ)?.label).toBe(OPEN_THE_SESSION);
    expect(updateAction(took, TZ)?.href).toBe(updateLines(took, TZ).href);
  });

  it("the offers with no reply: See the offers, on Events & sessions' Need people", () => {
    const noReply: Update = {
      kind: "no-reply",
      at: at("2026-11-05T08:02:00Z"),
      oldest: at("2026-11-05T07:19:00Z"),
      offers: 3,
      sessions: 2,
    };
    expect(updateAction(noReply, TZ)).toEqual({
      label: "See the offers",
      href: "/office/events?view=need",
      name: "See the offers: 3 offers with no reply yet",
      offer: null,
    });
    expect(updateAction({ ...noReply, offers: 1, sessions: 1 }, TZ)?.name).toBe(
      "See the offers: 1 offer with no reply yet",
    );
    expect(NO_REPLY_HREF).toBe("/office/events?view=need");
    expect(updateLines(noReply, TZ).href).toBe(NO_REPLY_HREF);
    expect(SEE_THE_OFFERS).toBe("See the offers");
  });

  it("a photo or certificate to check (the Updates page's, never the dashboard's): none", () => {
    expect(
      updateAction(
        {
          kind: "upload",
          at: at("2026-11-05T08:00:00Z"),
          workerId: "w1",
          worker: "Pia Photo",
          what: "photo",
        },
        TZ,
      ),
    ).toBeNull();
  });

  it("every action's name starts with its words (WCAG 2.5.3: the label in the name)", () => {
    const all = [
      updateAction(cancelled(), TZ),
      updateAction(cancelled({ reopened: false }), TZ),
      updateAction(
        {
          kind: "took",
          at: at("2026-11-05T09:06:00Z"),
          shiftId: "s1",
          worker: "Ben Fraser",
          role: "steward",
          site: "Acme Demo Arena",
          startsAt: at("2026-11-08T17:00:00Z"),
          placesFree: 0,
        },
        TZ,
      ),
      updateAction(
        { kind: "no-reply", at: at("2026-11-05T08:02:00Z"), oldest: NOW, offers: 2, sessions: 1 },
        TZ,
      ),
    ];
    expect(all.map((a) => a?.label)).toEqual([
      "Offer the place",
      "See the record",
      "Open the session",
      "See the offers",
    ]);
    for (const a of all) expect(a?.name.startsWith(a.label)).toBe(true);
  });
});

describe("the watch list's one rule (the Watch list card's, and Coming up's chip)", () => {
  const counts = (worked: number, noShows: number, lateCancels = 0) =>
    reliabilityOf({ worked, noShows, lateCancels });

  it("a reliability figure under 90%: on it", () => {
    expect(WATCH_BELOW).toBe(90);
    expect(onWatchList(counts(4, 2))).toBe(true); // 66%, red
    expect(onWatchList(counts(8, 2))).toBe(true); // 80%, amber
    expect(onWatchList(counts(8, 0, 2))).toBe(true); // late cancellations count against it too
    expect(onWatchList(counts(89, 11))).toBe(true); // 89%
  });

  it("90% or more: not on it (90 itself is green)", () => {
    expect(onWatchList(counts(9, 1))).toBe(false); // 90%
    expect(onWatchList(counts(10, 0))).toBe(false);
  });

  it("a new casual (under 5 counted) has no figure, so never; no record at all, never", () => {
    const fresh: Reliability = counts(0, 4);
    expect(fresh.kind).toBe("new");
    expect(onWatchList(fresh)).toBe(false);
    expect(onWatchList(counts(0, 0))).toBe(false);
    expect(onWatchList(undefined)).toBe(false);
  });

  it("Coming up's chip says the card's own figure", async () => {
    const { watchWords } = await import("@/lib/office/coming-up-copy");
    expect(watchWords("Dev Shah")).toBe(
      `Dev Shah is on the watch list: under ${WATCH_BELOW}% reliable.`,
    );
  });
});
