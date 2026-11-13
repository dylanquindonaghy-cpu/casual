import { describe, expect, it } from "vitest";
import { clientRequestInput, PAYLOADS } from "@/lib/client/payloads";
import { seedFirms } from "@/lib/db/admin/seed-data";
import {
  acmeMatchDay,
  CHAPTER_8,
  INDUCTION,
  MATCH_KICK_OFF,
  MATCH_NAME,
  matchDayFor,
  NEXT_MATCH_NAME,
  PREVIOUS_MATCH_NAME,
} from "@/lib/db/admin/seed-match";
import { acmeStory } from "@/lib/db/admin/seed-story";
import { isMadeUpEmail, isMadeUpMobile } from "@/lib/demo/made-up";
import { localDateOf, wallTimeOf } from "@/lib/time/zoned";
import { fakePoint } from "@/lib/travel/geocoder";
import { SPARE_MOBILES } from "../e2e/spare-mobiles";

// The match day to play with (Phase 36.5; src/lib/db/admin/seed-match.ts): a pure builder, so its
// shape is checked here on any day of the week; tests/integration/seed.match.test.ts checks what
// the seed stores.

const HOUR = 3_600_000;
const TZ = "Europe/London";
const acme = (now: Date) => {
  const firm = seedFirms(now).find((f) => f.slug === "acme");
  if (!firm) throw new Error("no acme");
  return firm;
};
const build = (now: Date) => acmeMatchDay(acme(now), now);
// 09:00 UTC on each day of a week (Monday 2026-11-09 to Sunday 2026-11-15), and some edges.
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 10, 9 + i, 9)));
const EDGES = [
  new Date("2026-11-14T16:29:00Z"), // Saturday, just before kick-off
  new Date("2026-11-14T16:31:00Z"), // just after
  new Date("2026-11-09T05:30:00Z"), // Monday before quiet hours end
  new Date("2026-03-28T12:00:00Z"), // the Saturday the clocks go forward on the Sunday
  new Date("2026-10-23T22:30:00Z"), // a Friday night in quiet hours
];
const clock = (d: Date) => {
  const w = wallTimeOf(d, TZ);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
};

// Each post's sessions as [post, role, start, end, places, booked].
const EXPECTED = [
  ["Deployment manager", "supervisor", "10:00", "20:30", 1, 1],
  ["Control room", "supervisor", "13:00", "19:30", 3, 3],
  ["North Gate", "supervisor", "12:30", "19:30", 1, 1],
  ["North Gate", "door_supervisor", "12:30", "19:30", 13, 10],
  ["South Bridge", "supervisor", "12:30", "19:30", 1, 1],
  ["South Bridge", "door_supervisor", "12:30", "19:30", 11, 11],
  ["West Ramp", "supervisor", "12:30", "19:30", 1, 1],
  ["West Ramp", "steward", "12:30", "19:30", 4, 4],
  ["South Ramp", "supervisor", "12:30", "19:30", 1, 1],
  ["South Ramp", "steward", "12:30", "19:30", 4, 3],
  ["Players' entrance search", "door_supervisor", "12:30", "19:30", 4, 4],
  ["Stadium tours", "steward", "09:30", "17:00", 2, 2],
  ["Station queue (Demo Central station)", "steward", "14:00", "20:00", 5, 5],
  ["Station queue (Demo Park station)", "steward", "14:00", "20:00", 5, 4],
  ["Estate patrol", "csas_officer", "12:30", "19:30", 3, 2],
  ["Car park North", "steward", "12:15", "20:30", 8, 4],
  ["Car park South", "steward", "12:15", "20:30", 6, 6],
  ["Agency area", "steward", "12:30", "19:30", 10, 6],
] as const;

describe("the match day's Saturday", () => {
  it("is the coming Saturday; on a Saturday, today until kick-off, then the next", () => {
    expect(WEEK.map((d) => matchDayFor(d))).toEqual([
      "2026-11-14",
      "2026-11-14",
      "2026-11-14",
      "2026-11-14",
      "2026-11-14",
      "2026-11-14", // Saturday 09:00: today
      "2026-11-21", // Sunday
    ]);
    expect(matchDayFor(EDGES[0]!)).toBe("2026-11-14");
    expect(matchDayFor(EDGES[1]!)).toBe("2026-11-21");
  });

  it.each([...WEEK, ...EDGES])("kicks off at 16:30 London time, ahead of the seed (%s)", (now) => {
    const m = build(now);
    expect(localDateOf(m.kickOff, TZ)).toBe(m.day);
    expect(clock(m.kickOff)).toBe(MATCH_KICK_OFF);
    expect(m.kickOff.getTime()).toBeGreaterThan(now.getTime());
    expect(new Date(`${m.day}T12:00:00Z`).getUTCDay()).toBe(6);
  });
});

describe("the match day's shape", () => {
  const now = WEEK[3]!; // Thursday
  const m = build(now);
  const ours = m.sessions.filter((s) => s.match === "this");

  it("has its 18 sessions at 14 posts, timed from kick-off as the sheet does, 83 places and 69 booked", () => {
    expect(
      ours.map((s) => [s.post, s.role, clock(s.startsAt), clock(s.endsAt), s.headcount, s.booked]),
    ).toEqual(EXPECTED.map((x) => [...x]));
    expect(new Set(ours.map((s) => s.post)).size).toBe(14);
    expect(ours.reduce((n, s) => n + s.headcount, 0)).toBe(83);
    expect(ours.reduce((n, s) => n + s.booked, 0)).toBe(69);
    // Most start 4 hours before kick-off and last 7.
    const gate = ours.find((s) => s.post === "North Gate" && s.role === "door_supervisor")!;
    expect((m.kickOff.getTime() - gate.startsAt.getTime()) / HOUR).toBe(4);
    expect((gate.endsAt.getTime() - gate.startsAt.getTime()) / HOUR).toBe(7);
  });

  it("counts each session's bookings as its rows say, one place each, nobody on two", () => {
    for (const s of m.sessions) {
      const live = m.bookings.filter(
        (b) => b.shiftId === s.id && (b.status === "confirmed" || b.status === "completed"),
      );
      expect(live.length, s.key).toBe(s.booked);
    }
    const thisMatch = new Set(ours.map((s) => s.id));
    const workers = m.bookings
      .filter((b) => thisMatch.has(b.shiftId) && b.status === "confirmed")
      .map((b) => b.workerId);
    expect(new Set(workers).size).toBe(workers.length);
  });

  it("every session has its pay, post, meeting point, uniform and instructions, and needs the ground induction; the car parks need Chapter 8 too", () => {
    for (const s of m.sessions) {
      expect(s.payRatePence).toBeGreaterThan(0);
      for (const text of [s.post, s.meetingPoint, s.uniform, s.instructions])
        expect(text.length).toBeGreaterThan(0);
      expect(s.requiredCredentials[0]).toBe(INDUCTION);
      expect(s.requiredCredentials.includes(CHAPTER_8)).toBe(s.post.startsWith("Car park"));
    }
    expect(ours.some((s) => s.instructions.includes("At 15:45, 5 of you move to"))).toBe(true);
    expect(m.credentialTypes.map((t) => t.code)).toEqual([INDUCTION, CHAPTER_8]);
    // Every squad member holds the induction, and the car park stewards Chapter 8.
    for (const w of m.workers) {
      const held = m.credentials.filter((c) => c.workerId === w.id).map((c) => c.type);
      expect(held).toContain(INDUCTION);
      expect(held.includes(CHAPTER_8)).toBe(w.kind === "cp");
    }
  });

  it("North Gate is urgent by the office's flag; the two cancellations are a casual's and the office's", () => {
    const gate = ours.find((s) => s.post === "North Gate" && s.role === "door_supervisor")!;
    expect([gate.isUrgent, gate.urgentCause]).toEqual([true, "office"]);
    const cancelled = m.bookings.filter(
      (b) => b.status === "cancelled_worker" || b.status === "cancelled_firm",
    );
    const post = (shiftId: string) => m.sessions.find((s) => s.id === shiftId);
    expect(
      cancelled.map((b) => [post(b.shiftId)?.match, post(b.shiftId)?.post, b.status, b.strikeCode]),
    ).toEqual([
      // Thursday 09:00: more than 48 hours before 12:30 on Saturday, so no strike.
      ["this", "South Ramp", "cancelled_worker", "enough_notice"],
      ["this", "Station queue (Demo Park station)", "cancelled_firm", "by_firm"],
      // The previous match's: 5 hours before, a strike.
      ["previous", "North Gate", "cancelled_worker", "issued"],
    ]);
    expect(m.strikes).toHaveLength(1);
    for (const b of cancelled) {
      const s = post(b.shiftId)!;
      expect(b.cancelledAt!.getTime()).toBeLessThan(s.startsAt.getTime());
      expect(b.cancelledAt!.getTime()).toBeGreaterThan(b.confirmedAt.getTime());
      expect(b.cancelledAt!.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("on Friday evening the South Ramp's cancellation is late: a strike, and urgent by the system", () => {
    const friday = new Date("2026-11-13T18:00:00Z");
    const late = build(friday);
    const ramp = late.sessions.find((s) => s.match === "this" && s.key === "south-ramp")!;
    const b = late.bookings.find((x) => x.shiftId === ramp.id && x.status === "cancelled_worker")!;
    expect(b.strikeCode).toBe("issued");
    expect([ramp.isUrgent, ramp.urgentCause]).toEqual([true, "dropout"]);
    expect(late.strikes).toHaveLength(2);
  });

  it("has the previous match two weeks before, worked, and a pay query still open about it", () => {
    expect(m.events.map((e) => e.name)).toEqual([MATCH_NAME, PREVIOUS_MATCH_NAME]);
    expect(m.previousDay).toBe("2026-10-31");
    const prev = m.sessions.filter((s) => s.match === "previous");
    expect(prev.every((s) => s.endsAt.getTime() < now.getTime())).toBe(true);
    const q = m.sessions.find((s) => s.id === m.payQuery.shiftId);
    expect(q?.match).toBe("previous");
    expect(
      m.bookings.some(
        (b) =>
          b.shiftId === m.payQuery.shiftId &&
          b.workerId === m.payQuery.workerId &&
          b.status === "completed",
      ),
    ).toBe(true);
  });

  it("two offers waiting on North Gate, to squad members nobody booked, this week outside quiet hours", () => {
    const gate = ours.find((s) => s.post === "North Gate" && s.role === "door_supervisor")!;
    expect(m.offers).toHaveLength(2);
    const booked = new Set(m.bookings.map((b) => b.workerId));
    for (const o of m.offers) {
      expect(o.shiftId).toBe(gate.id);
      expect(booked.has(o.workerId)).toBe(false);
      expect(o.sentAt.getTime()).toBeLessThanOrEqual(now.getTime());
      const h = wallTimeOf(o.sentAt, TZ).hour;
      expect(h >= 7 && h < 22).toBe(true);
    }
    // None on a Monday before quiet hours first end.
    expect(build(EDGES[2]!).offers).toEqual([]);
  });

  it("the client: Demo Stadium Ltd, its stadium, a made-up login, two requests waiting and one each accepted and declined", () => {
    expect(m.contract.name).toBe("Demo Stadium Ltd");
    expect(m.site).toMatchObject({ name: "Demo Stadium", addressLine1: "1 Demo Road" });
    expect(m.contact.name).toBe("Hannah Price");
    expect(
      m.requests.map((r) => [r.kind, r.status, (r.payload as { places?: number }).places]),
    ).toEqual([
      ["more_places", "waiting", 4],
      ["new_event", "waiting", undefined],
      ["more_places", "accepted", 2],
      ["other", "declined", undefined],
    ]);
    const gate = ours.find((s) => s.post === "North Gate" && s.role === "door_supervisor")!;
    expect(m.requests[0]?.shiftId).toBe(gate.id);
    // Each payload is its kind's shape, as the client's form sends it.
    for (const r of m.requests) expect(PAYLOADS[r.kind].safeParse(r.payload).success).toBe(true);
    const next = m.requests[1]!;
    expect(clientRequestInput.safeParse({ kind: "new_event", payload: next.payload }).success).toBe(
      true,
    );
    expect(next.payload).toMatchObject({ name: NEXT_MATCH_NAME, date: "2026-11-28" });
    // Urgent by the rules only: the North Gate one starts within 48 hours of Thursday 07:00
    // (sent two hours before the seed's 09:00), the new event never.
    expect([m.requests[0]?.urgent, next.urgent]).toEqual([false, false]);
    expect(build(new Date("2026-11-12T16:00:00Z")).requests[0]?.urgent).toBe(true);
    expect(m.requests.find((r) => r.status === "declined")?.officeAnswer).toBeTruthy();
  });
});

describe("the match day is made up (golden rule 7)", () => {
  it.each([...WEEK, ...EDGES])(
    "every number and email made up, every postcode a ZZ one with a made-up point (%s)",
    (now) => {
      const m = build(now);
      for (const w of m.workers) {
        expect(isMadeUpMobile(w.mobileE164), w.mobileE164).toBe(true);
        if (w.email) expect(isMadeUpEmail(w.email), w.email).toBe(true);
      }
      expect(isMadeUpEmail(m.contact.email)).toBe(true);
      expect(m.site.postcode).toMatch(/^ZZ\d/);
      expect(fakePoint(m.site.postcode)).not.toBeNull();
      for (const c of m.credentials) expect(c.number).toMatch(/^TEST-/);
    },
  );

  it("its casuals' numbers and names are nobody else's in the demo, and outside the browser specs' spare blocks", () => {
    const now = WEEK[0]!;
    const m = build(now);
    const firm = acme(now);
    const story = acmeStory(firm, now);
    const others = [...firm.workers, ...story.workers];
    const numbers = new Set(others.map((w) => w.mobileE164));
    const names = new Set(others.map((w) => `${w.firstName} ${w.lastName}`));
    for (const w of m.workers) {
      expect(numbers.has(w.mobileE164), w.mobileE164).toBe(false);
      expect(names.has(`${w.firstName} ${w.lastName}`)).toBe(false);
      const n = Number(w.mobileE164.slice(-3));
      for (const [from, to] of Object.values(SPARE_MOBILES))
        expect(n >= from && n <= to, w.mobileE164).toBe(false);
    }
    expect(new Set(m.workers.map((w) => w.mobileE164)).size).toBe(m.workers.length);
    expect(new Set(m.workers.map((w) => `${w.firstName} ${w.lastName}`)).size).toBe(
      m.workers.length,
    );
  });
});
