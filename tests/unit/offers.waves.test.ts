import { describe, expect, it } from "vitest";
import { shiftEscalationEmail, shiftUrgentMessage } from "@/lib/messaging/templates";
import type { WaveCandidate } from "@/lib/offers/candidates";
import { escalateHours, firstComeWaves, pickWave, WAVE_MAX, waveCap } from "@/lib/offers/waves";
import { dayWords } from "@/lib/portal/format";

// The pure parts of offer waves (src/lib/offers/waves.ts) and their message copy
// (docs/messaging-templates.md).

const candidate = (
  workerId: string,
  hours: number,
  lastOfferedAt: Date | null = null,
): WaveCandidate => ({
  workerId,
  hoursThisWeek: hours,
  lastOfferedAt,
  mobile: "+447700900100",
  channel: "whatsapp",
  smsAllowed: true,
  email: null,
});

describe("pickWave: the best first, in both modes", () => {
  const people = [
    candidate("d", 24),
    candidate("b", 8, new Date("2026-11-01T10:00:00Z")),
    candidate("a", 0),
    candidate("c", 8, new Date("2026-10-30T10:00:00Z")),
    candidate("e", 8),
  ];

  it("fewest hours, then longest since their last offer (never offered first), then id", () => {
    expect(pickWave(people, 3).map((c) => c.workerId)).toEqual(["a", "e", "c"]);
    expect(pickWave(people, 10).map((c) => c.workerId)).toEqual(["a", "e", "c", "b", "d"]);
  });

  // Phase 10 task 19 (audit L18): with the wave's seed, ties are a shuffle fixed by the shift and
  // wave, not the lowest ids every time.
  it("the last tie break: fixed for a given shift and wave, different across shifts", () => {
    const tied = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => candidate(id, 8));
    const order = (seed: string) => pickWave(tied, 10, seed).map((c) => c.workerId);
    expect(order("shift-1:1")).toEqual(order("shift-1:1"));
    const firsts = new Set(Array.from({ length: 20 }, (_, i) => order(`shift-${i}:1`)[0]));
    expect(firsts.size).toBeGreaterThan(3);
    // Hours and last offer still come first: the tie break only orders the tied.
    const mixed = [candidate("z", 0), ...tied.slice(0, 3)];
    expect(pickWave(mixed, 10, "shift-1:1")[0]?.workerId).toBe("z");
  });

  // Until P4.3 first come, first served sent to everyone at once (about 1,500 texts for one place
  // at a big firm); now it takes the best of the ranking too, up to its cap (below).
  it("takes only as many as the wave's size, the best first", () => {
    expect(pickWave(people, 2).map((c) => c.workerId)).toEqual(["a", "e"]);
    expect(pickWave(people, 0)).toEqual([]);
  });
});

describe("waveCap: how many a wave goes to (P4.3)", () => {
  const firstCome = { mode: "first_come_first_served" } as const;
  const fair = {
    mode: "fair_rotation",
    groupSize: 4,
    priorityMinutes: 15,
    urgentWindowHours: 24,
  } as const;

  it("first come, first served: 5 per free place by default, at most 50 a wave", () => {
    const perPlace = firstComeWaves({}).perPlace;
    expect(perPlace).toBe(5);
    expect(waveCap(firstCome, { perPlace }, 1)).toBe(5);
    expect(waveCap(firstCome, { perPlace }, 4)).toBe(20);
    expect(waveCap(firstCome, { perPlace }, 10)).toBe(WAVE_MAX);
    expect(WAVE_MAX).toBe(50);
  });

  it("a place taken shrinks it; a filled shift's is nothing", () => {
    expect(waveCap(firstCome, { perPlace: 5 }, 2)).toBe(10);
    expect(waveCap(firstCome, { perPlace: 5 }, 1)).toBe(5);
    expect(waveCap(firstCome, { perPlace: 5 }, 0)).toBe(0);
  });

  it("fair rotation keeps its fixed wave size, whatever the places", () => {
    expect(waveCap(fair, { perPlace: 5 }, 1)).toBe(4);
    expect(waveCap(fair, { perPlace: 5 }, 10)).toBe(4);
  });

  it("the firm's own numbers, and the defaults for any that make no sense", () => {
    expect(firstComeWaves({ wave_per_place: 3, wave_minutes: 10 })).toEqual({
      perPlace: 3,
      minutes: 10,
    });
    expect(firstComeWaves({})).toEqual({ perPlace: 5, minutes: 15 });
    for (const bad of [0, 21, 2.5, "3", null]) {
      expect(firstComeWaves({ wave_per_place: bad }).perPlace).toBe(5);
    }
    for (const bad of [0, 241, 2.5, "10", null]) {
      expect(firstComeWaves({ wave_minutes: bad }).minutes).toBe(15);
    }
  });
});

describe("dayWords", () => {
  const TZ = "Europe/London";
  const now = new Date("2026-11-02T09:00:00Z"); // Monday
  it("says today, tomorrow or the date, in London time", () => {
    expect(dayWords(new Date("2026-11-02T19:00:00Z"), now, TZ)).toBe("today");
    expect(dayWords(new Date("2026-11-03T08:00:00Z"), now, TZ)).toBe("tomorrow");
    expect(dayWords(new Date("2026-11-07T08:00:00Z"), now, TZ)).toBe("on Sat 7 Nov");
    // 23:30 UTC on Sat 24 Oct is already Sunday 00:30 in London (BST): tomorrow.
    expect(dayWords(new Date("2026-10-24T23:30:00Z"), new Date("2026-10-24T09:00:00Z"), TZ)).toBe(
      "tomorrow",
    );
  });
});

describe("escalateHours", () => {
  it("reads the firm's setting, defaulting to 3, also for nonsense (a cancellation must never fail)", () => {
    expect(escalateHours({})).toBe(3);
    expect(escalateHours({ escalate_hours_before_start: 6 })).toBe(6);
    expect(escalateHours({ escalate_hours_before_start: "soon" })).toBe(3);
    expect(escalateHours({ escalate_hours_before_start: -1 })).toBe(3);
  });
});

describe("the messages", () => {
  const voice = { name: "Acme Events", signOff: "Acme Events Shift Team" };
  it("shift_urgent: role with a or an, site if there is one, the day, times, the link, the sign-off", () => {
    expect(
      shiftUrgentMessage(voice, {
        role: "door_supervisor",
        site: "Acme Demo Arena",
        day: "today",
        start: "19:00",
        end: "03:00",
        link: "https://acme.example/shifts/1",
      }),
    ).toBe(
      "URGENT: we need a door supervisor at Acme Demo Arena today 19:00–03:00. Tap to take it: https://acme.example/shifts/1. — Acme Events Shift Team",
    );
    expect(
      shiftUrgentMessage(voice, {
        role: "usher",
        site: null,
        day: "on Sat 7 Nov",
        start: "08:00",
        end: "16:00",
        link: "L",
      }),
    ).toBe(
      "URGENT: we need an usher on Sat 7 Nov 08:00–16:00. Tap to take it: L. — Acme Events Shift Team",
    );
  });

  it("shift_escalation: what's unfilled, how many offers went out, where to act", () => {
    const one = shiftEscalationEmail(voice, {
      role: "door_supervisor",
      site: "Acme Demo Arena",
      when: "Sat 7 Nov, 08:00 to 16:00",
      freePlaces: 1,
      offersSent: 4,
      link: "https://acme.example/office",
    });
    expect(one.subject).toBe(
      "Unfilled: Door supervisor at Acme Demo Arena, Sat 7 Nov, 08:00 to 16:00",
    );
    expect(one.body).toBe(
      [
        "The door supervisor shift at Acme Demo Arena, Sat 7 Nov, 08:00 to 16:00, still has 1 place free.",
        "4 offers sent, none accepted for the free place.",
        "Open the office dashboard: https://acme.example/office",
        "— Acme Events Shift Team",
      ].join("\n\n"),
    );
    const two = shiftEscalationEmail(voice, {
      role: "steward",
      site: null,
      when: "W",
      freePlaces: 2,
      offersSent: 1,
      link: "L",
    });
    expect(two.body).toContain("still has 2 places free.");
    expect(two.body).toContain("1 offer sent, none accepted for the free places.");
    const none = shiftEscalationEmail(voice, {
      role: "steward",
      site: null,
      when: "W",
      freePlaces: 1,
      offersSent: 0,
      link: "L",
    });
    expect(none.body).toContain("Nobody else could be offered it (no one eligible and available).");
    expect(none.body).not.toContain("0 offers");
  });
});
