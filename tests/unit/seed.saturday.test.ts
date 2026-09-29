import { describe, expect, it } from "vitest";
import { seedFirms } from "@/lib/db/admin/seed-data";
import { acmeSaturday, FREE_WORKERS, nextSaturday } from "@/lib/db/admin/seed-saturday";

// Acme's Saturday event day for the demo seed (src/lib/db/admin/seed-saturday.ts): the pure
// builder. The loader and the database side are in tests/integration/seed.test.ts.

const acmeAt = (now: Date) => {
  const acme = seedFirms(now).find((f) => f.slug === "acme");
  if (!acme) throw new Error("no Acme");
  return { acme, day: acmeSaturday(acme.workers, acme.sites, now) };
};
const london = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

describe("nextSaturday", () => {
  it("is the first Saturday after today, never today", () => {
    expect(nextSaturday("2026-10-02")).toBe("2026-10-03"); // Friday -> tomorrow
    expect(nextSaturday("2026-10-03")).toBe("2026-10-10"); // Saturday -> next week's
    expect(nextSaturday("2026-10-04")).toBe("2026-10-10"); // Sunday
    expect(nextSaturday("2026-09-29")).toBe("2026-10-03"); // Tuesday
  });
});

describe("acmeSaturday", () => {
  it("builds 40 shifts, 32 bookings, the dropout and 8 open places", () => {
    const { day } = acmeAt(new Date("2026-09-29T09:00:00Z"));
    expect(day.day).toBe("2026-10-03");
    expect(day.shifts).toHaveLength(40);
    expect(day.bookings.filter((b) => b.status === "confirmed")).toHaveLength(32);
    expect(day.shifts.filter((s) => s.status === "open")).toHaveLength(8);
    expect(day.shifts.filter((s) => s.isUrgent)).toHaveLength(1);
    const dropout = day.bookings.find((b) => b.status === "cancelled_worker");
    expect(dropout).toMatchObject({ cancelReason: "I'm unwell" });
    // Booked three days ago, cancelled at 06:00 today (London: 05:00 UTC in September).
    expect(dropout?.cancelledAt).toEqual(new Date("2026-09-29T05:00:00Z"));
    expect(dropout?.noticeHours).toBe(4 * 24 - 5 + 7); // to Sat 08:00 BST (07:00 UTC)
  });

  it("never books the free demo workers, or anyone twice", () => {
    const { acme, day } = acmeAt(new Date("2026-09-29T09:00:00Z"));
    const free = new Set(acme.workers.slice(0, FREE_WORKERS).map((w) => w.id));
    expect(day.bookings.some((b) => free.has(b.workerId))).toBe(false);
    const confirmed = day.bookings.filter((b) => b.status === "confirmed").map((b) => b.workerId);
    expect(new Set(confirmed).size).toBe(confirmed.length);
  });

  it("before 6am, the dropout is recorded as just now", () => {
    const now = new Date("2026-09-29T04:30:00Z"); // 05:30 in London
    const dropout = acmeAt(now).day.bookings.find((b) => b.status === "cancelled_worker");
    expect(dropout?.cancelledAt).toEqual(now);
  });

  it("keeps the same ids all week, and a new Saturday gets new ones", () => {
    const tuesday = acmeAt(new Date("2026-09-29T09:00:00Z")).day;
    const thursday = acmeAt(new Date("2026-10-01T16:00:00Z")).day;
    const nextWeek = acmeAt(new Date("2026-10-06T09:00:00Z")).day;
    expect(thursday.shifts.map((s) => s.id)).toEqual(tuesday.shifts.map((s) => s.id));
    expect(thursday.bookings.map((b) => b.id)).toEqual(tuesday.bookings.map((b) => b.id));
    expect(nextWeek.day).toBe("2026-10-10");
    expect(nextWeek.shifts.some((s) => tuesday.shifts.some((t) => t.id === s.id))).toBe(false);
  });

  it("puts the times in London time, either side of the clocks going back", () => {
    const summer = acmeAt(new Date("2026-10-20T09:00:00Z")).day; // Sat 24 Oct, BST
    const winter = acmeAt(new Date("2026-10-27T09:00:00Z")).day; // Sat 31 Oct, GMT
    for (const d of [summer, winter]) {
      expect(new Set(d.shifts.map((s) => london(s.startsAt)))).toEqual(
        new Set(["12:00", "11:30", "08:00", "10:30", "09:00", "07:00", "15:00"]),
      );
    }
    expect(summer.shifts[0]?.startsAt.toISOString()).toBe("2026-10-24T11:00:00.000Z");
    expect(winter.shifts[0]?.startsAt.toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });

  it("gives every worker 1 to 8 weekly pay lines from the last 8 complete weeks", () => {
    const { acme, day } = acmeAt(new Date("2026-09-29T09:00:00Z")); // a Tuesday
    const byWorker = new Map<string, number>();
    for (const p of day.pay) byWorker.set(p.workerId, (byWorker.get(p.workerId) ?? 0) + 1);
    expect(byWorker.size).toBe(acme.workers.length);
    for (const n of byWorker.values()) expect(n).toBeGreaterThanOrEqual(1);
    for (const n of byWorker.values()) expect(n).toBeLessThanOrEqual(8);
    const starts = [...new Set(day.pay.map((p) => p.periodStart))].sort();
    expect(starts[0]).toBe("2026-08-03"); // 8 Mondays back
    expect(starts.at(-1)).toBe("2026-09-21"); // last week's Monday
    for (const p of day.pay) expect(p.grossPence).toBe(Math.round(Number(p.hours) * p.ratePence));
  });
});
