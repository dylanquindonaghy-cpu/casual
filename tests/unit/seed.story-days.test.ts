import { describe, expect, it } from "vitest";
import { seedFirms } from "@/lib/db/admin/seed-data";
import { acmeSaturday } from "@/lib/db/admin/seed-saturday";
import { acmeStory } from "@/lib/db/admin/seed-story";

// The demo is dated from the day it's loaded (a demo server loads it afresh every night: 16.2), and
// two parts of it are dated differently: the story's sessions so many days from today, the
// walkthrough's event day on next Saturday. So which of them meet depends on the weekday. This
// pins the one meeting the tests rely on (tests/integration/seed.story.test.ts): Zoe's own
// Riverside shift (three days from today, 14:00 to 22:00) leaves her the rules' 11 hours' rest
// before or after the walkthrough's Saturday dropout (08:00) on every day but Tuesday (it ends 10
// hours before) and Wednesday (it's that same Saturday), when the rules keep the dropout from her.

const HOUR = 3_600_000;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Hours between Zoe's nearest booked shift and the dropout (negative: they overlap).
function restAround(now: Date) {
  const firm = seedFirms(now).find((f) => f.slug === "acme");
  if (!firm) throw new Error("no acme");
  const story = acmeStory(firm, now);
  const zoe = story.workers.find((w) => w.key === "zoe")?.id;
  const saturday = acmeSaturday(firm.workers, firm.sites, now);
  const dropout = saturday.shifts.find((s) => s.id === saturday.urgentShiftId);
  if (!zoe || !dropout) throw new Error("no Zoe or no dropout");
  const gaps = story.bookings
    .filter((b) => b.workerId === zoe && b.status === "confirmed")
    .map((b) => story.sessions.find((s) => s.id === b.shiftId))
    .filter((s) => s !== undefined && s.endsAt > now)
    .map((s) =>
      Math.max(
        (dropout.startsAt.getTime() - s!.endsAt.getTime()) / HOUR,
        (s!.startsAt.getTime() - dropout.endsAt.getTime()) / HOUR,
      ),
    );
  return Math.min(...gaps);
}

describe("the demo's story and the walkthrough's Saturday, by weekday", () => {
  it("leave Zoe 11 hours' rest around the dropout every day but Tuesday and Wednesday", () => {
    // A week of mornings and evenings (UK time, summer and winter alike).
    const clashes = new Set<string>();
    for (const start of ["2026-10-19", "2026-11-02"]) {
      for (let d = 0; d < 7; d += 1) {
        for (const hour of [8, 21]) {
          const now = new Date(`${start}T00:00:00Z`);
          now.setUTCDate(now.getUTCDate() + d);
          now.setUTCHours(hour);
          if (restAround(now) < 11) clashes.add(DAYS[(now.getUTCDay() + 6) % 7] ?? "");
        }
      }
    }
    expect([...clashes].sort()).toEqual(["Tue", "Wed"]);
  });

  it("on a Tuesday her shift ends 10 hours before it; on a Wednesday it's that same day", () => {
    expect(restAround(new Date("2026-10-20T08:00:00Z"))).toBe(10);
    expect(restAround(new Date("2026-10-21T08:00:00Z"))).toBeLessThan(0);
  });
});
