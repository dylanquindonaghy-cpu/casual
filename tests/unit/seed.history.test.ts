import { describe, expect, it } from "vitest";
import { seedFirms } from "@/lib/db/admin/seed-data";
import { acmePastEvent } from "@/lib/db/admin/seed-extras";
import {
  acmeHistory,
  keptHistoryBookings,
  HISTORY_WORKERS,
  LATE_CANCELLERS,
  NEW_STEWARD_RATE,
  RATE_STEWARDS,
  rateDayFor,
} from "@/lib/db/admin/seed-history";
import { acmeSaturday } from "@/lib/db/admin/seed-saturday";
import { urgentWindowHours } from "@/lib/rules/urgent";
import { localDateOf, mondayOf } from "@/lib/time/zoned";

// Acme's worked history (src/lib/db/admin/seed-history.ts; Phase 37.8): the pure builder. The
// database side (each booking one the rules allowed, the casuals' counts) is in
// tests/integration/seed.test.ts.

const TZ = "Europe/London";
const HOUR = 3_600_000;
const build = (now: Date) => {
  const acme = seedFirms(now).find((f) => f.slug === "acme");
  if (!acme) throw new Error("no Acme");
  const saturday = acmeSaturday(acme.workers, acme.sites, now, acme.settings);
  return {
    acme,
    saturday,
    history: acmeHistory(acme.workers, acme.sites, saturday.pay, now, acme.settings),
  };
};
// A Tuesday, a Monday, a Friday and a Sunday.
const DAYS = [
  "2026-11-10T10:00:00Z",
  "2026-11-09T07:00:00Z",
  "2026-11-13T12:00:00Z",
  "2026-11-15T20:00:00Z",
];

describe("acmeHistory", () => {
  for (const when of DAYS) {
    const now = new Date(when);
    const { acme, saturday, history } = build(now);
    const today = localDateOf(now, TZ);
    const sessionOf = (id: string) => history.sessions.find((s) => s.id === id);

    it(`(${when}) the worked hours each week are the pay line's, at its rate`, () => {
      const rateWeek = mondayOf(rateDayFor(today));
      const rateStewards = new Set(RATE_STEWARDS.map((i) => acme.workers[i]?.id));
      for (const line of saturday.pay) {
        const worked = history.bookings.filter(
          (b) =>
            b.workerId === line.workerId &&
            b.status === "completed" &&
            mondayOf(localDateOf(sessionOf(b.shiftId)!.startsAt, TZ)) === line.periodStart,
        );
        const hours = worked.reduce((sum, b) => {
          const s = sessionOf(b.shiftId)!;
          return sum + (s.endsAt.getTime() - s.startsAt.getTime()) / HOUR;
        }, 0);
        expect({ line: line.id, hours }).toEqual({ line: line.id, hours: Number(line.hours) });
        for (const b of worked) {
          const rate = sessionOf(b.shiftId)!.payRatePence;
          const expected =
            line.periodStart === rateWeek && rateStewards.has(line.workerId)
              ? NEW_STEWARD_RATE
              : line.ratePence;
          expect(rate).toBe(expected);
        }
      }
    });

    it(`(${when}) nothing this week or later; no overlaps; 11 hours' rest, the last event's included`, () => {
      const monday = mondayOf(today);
      for (const s of history.sessions) expect(localDateOf(s.startsAt, TZ) < monday).toBe(true);
      const past = acmePastEvent(acme.workers, acme.sites, now);
      const held = (workerId: string) => [
        ...history.bookings
          .filter((b) => b.workerId === workerId && b.status !== "cancelled_worker")
          .map((b) => sessionOf(b.shiftId)!),
        ...past.bookings
          .filter((b) => b.workerId === workerId)
          .map((b) => past.shifts.find((s) => s.id === b.shiftId)!),
      ];
      for (const w of acme.workers) {
        const mine = held(w.id).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        for (let k = 1; k < mine.length; k++) {
          const gap = mine[k]!.startsAt.getTime() - mine[k - 1]!.endsAt.getTime();
          expect(gap).toBeGreaterThanOrEqual(11 * HOUR);
        }
      }
    });

    it(`(${when}) 30 workers: never 0, 25-29 or 45-47; the ones browser tests need`, () => {
      expect(HISTORY_WORKERS).toHaveLength(30);
      for (const i of [2, 10, 17, 18, 19, 20, 21, 22, 24, 50, 51, 52, 57]) {
        expect(HISTORY_WORKERS).toContain(i);
      }
      for (const i of [0, 25, 26, 27, 28, 29, 45, 46, 47]) expect(HISTORY_WORKERS).not.toContain(i);
      const booked = new Set(history.bookings.map((b) => b.workerId));
      for (const i of [0, 25, 26, 27, 28, 29, 45, 46, 47]) {
        expect(booked.has(acme.workers[i]?.id ?? "")).toBe(false);
      }
    });

    it(`(${when}) three late cancellers, three each in 60 days, each a strike, each place filled again`, () => {
      const late = history.bookings.filter((b) => b.status === "cancelled_worker");
      const by = new Map<string, number>();
      for (const b of late) by.set(b.workerId, (by.get(b.workerId) ?? 0) + 1);
      expect([...by.keys()].sort()).toEqual(LATE_CANCELLERS.map((i) => acme.workers[i]?.id).sort());
      for (const n of by.values()) expect(n).toBe(3);
      for (const b of late) {
        expect(b.noticeHours).toBeLessThan(48);
        // Outside Acme's urgent window (24 hours): the app marks a dropout inside it urgent and
        // logs it (cancel.ts), which the history doesn't.
        expect(b.noticeHours).toBeGreaterThanOrEqual(urgentWindowHours(acme.settings));
        expect(b.cancelledAt!.getTime()).toBeGreaterThan(now.getTime() - 60 * 24 * HOUR);
        expect(b.strikeCode).toBe("issued");
        expect(history.strikes.filter((k) => k.bookingId === b.id)).toHaveLength(1);
        const filler = history.bookings.find((x) => x.id === b.reopenedId);
        expect(filler).toMatchObject({ shiftId: b.shiftId, status: "completed" });
        expect(filler!.confirmedAt.getTime()).toBeGreaterThan(b.cancelledAt!.getTime());
      }
    });

    it(`(${when}) a login before each week worked`, () => {
      const weeks = new Set(
        history.bookings
          .filter((b) => b.status === "completed")
          .map((b) => `${b.workerId}/${mondayOf(localDateOf(sessionOf(b.shiftId)!.startsAt, TZ))}`),
      );
      const logins = new Set(
        history.logins.map(
          (l) => `${l.workerId}/${mondayOf(localDateOf(new Date(l.at.getTime() + 24 * HOUR), TZ))}`,
        ),
      );
      for (const w of weeks) expect(logins.has(w)).toBe(true);
      for (const l of history.logins) expect(l.at.getTime()).toBeLessThan(now.getTime());
    });
  }

  it("a week's draws and ids are the same whatever day the seed runs", () => {
    const a = build(new Date("2026-11-10T10:00:00Z")).history; // a Tuesday
    const b = build(new Date("2026-11-17T10:00:00Z")).history; // a week later, a Tuesday
    const c = build(new Date("2026-11-20T10:00:00Z")).history; // a Friday
    // The weeks all three runs cover: from the latest run's oldest pay week (Mon 21 Sep) to before
    // the earliest run's last complete week (Mon 2 Nov: the rate queries' week, its rate differs).
    const from = new Date("2026-09-21T00:00:00Z");
    const to = new Date("2026-11-02T00:00:00Z");
    const shared = (h: typeof a) => h.sessions.filter((s) => s.startsAt >= from && s.startsAt < to);
    const ids = (h: typeof a) =>
      shared(h)
        .map((s) => s.id)
        .sort();
    // The same sessions in every run, the no-shows' included.
    expect(ids(a).length).toBeGreaterThan(100);
    expect(ids(b)).toEqual(ids(a));
    expect(ids(c)).toEqual(ids(a));
    // On the same weekday a week later: the same days, hours and rates.
    const exact = (h: typeof a) =>
      new Map(
        shared(h).map((s) => [s.id, [s.startsAt.getTime(), s.endsAt.getTime(), s.payRatePence]]),
      );
    expect(exact(b)).toEqual(exact(a));
    // On another weekday the days can move (never yesterday's weekday), the hours and rates don't.
    const drawn = (h: typeof a) =>
      new Map(
        shared(h).map((s) => [s.id, [s.endsAt.getTime() - s.startsAt.getTime(), s.payRatePence]]),
      );
    expect(drawn(c)).toEqual(drawn(a));
    // And each booking is the same worker's, with the same outcome where both runs book it.
    const outcome = (h: typeof a) =>
      new Map(
        h.bookings
          .filter((x) => x.status !== "cancelled_worker" && ids(a).includes(x.shiftId))
          .map((x) => [x.id, [x.shiftId, x.workerId, x.status]]),
      );
    expect(outcome(b)).toEqual(outcome(a));
    expect(outcome(c)).toEqual(outcome(a));
  });
});

// A re-run over rows already there (loadHistory, seed.ts): a booking that clashes with one the
// casual already holds is left out, and a cancellation and the booking that refilled its place go
// together, whichever of them clashed (never a "reopened" place with no cancellation behind it).
describe("keptHistoryBookings", () => {
  const { history } = build(new Date("2026-11-10T10:00:00Z"));
  const cancelled = history.bookings.find(
    (b) => b.status === "cancelled_worker" && b.reopenedId !== null,
  );
  if (!cancelled?.reopenedId) throw new Error("no cancelled booking with a replacement");
  const pair = [cancelled.id, cancelled.reopenedId];
  const ids = (clashes: string[]) =>
    keptHistoryBookings(history.bookings, new Set(clashes)).map((b) => b.id);

  it("keeps every booking when nothing clashes", () => {
    expect(ids([])).toEqual(history.bookings.map((b) => b.id));
  });

  it("drops a cancellation's replacement when the cancellation clashed", () => {
    const kept = ids([cancelled.id]);
    expect(kept).toHaveLength(history.bookings.length - 2);
    for (const id of pair) expect(kept).not.toContain(id);
  });

  it("drops the cancellation when its replacement clashed", () => {
    const kept = ids([cancelled.reopenedId!]);
    expect(kept).toHaveLength(history.bookings.length - 2);
    for (const id of pair) expect(kept).not.toContain(id);
  });

  it("drops only the clashing booking when it is no cancellation's replacement", () => {
    const replacements = new Set(history.bookings.map((b) => b.reopenedId));
    const lone = history.bookings.find((b) => b.reopenedId === null && !replacements.has(b.id));
    if (!lone) throw new Error("no lone booking");
    expect(ids([lone.id])).toEqual(
      history.bookings.filter((b) => b.id !== lone.id).map((b) => b.id),
    );
  });
});
