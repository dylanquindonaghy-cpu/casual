import { describe, expect, it } from "vitest";
import { shiftWindow } from "@/lib/roster/shift-window";
import { timesOn } from "@/lib/roster/shift-times";

// One rule for a shift's start and finish: the office's editor, the Sheets sync and every import
// (audit L67). Europe/London: the clocks go forward at 01:00 on Sun 28 Mar 2027 (01:00 to 02:00
// doesn't happen) and back at 02:00 on Sun 31 Oct 2027 (01:00 to 02:00 happens twice).

const LONDON = "Europe/London";
const at = (iso: string) => new Date(iso);
const hours = (w: { startsAt: Date; endsAt: Date } | null) =>
  w ? (w.endsAt.getTime() - w.startsAt.getTime()) / 3_600_000 : null;

describe("shiftWindow", () => {
  it("a day shift, and a night shift that ends the next morning", () => {
    expect(
      shiftWindow(
        { year: 2027, month: 6, day: 12 },
        { hour: 9, minute: 0 },
        { hour: 17, minute: 0 },
        LONDON,
      ),
    ).toEqual({ startsAt: at("2027-06-12T08:00:00Z"), endsAt: at("2027-06-12T16:00:00Z") });
    expect(
      shiftWindow(
        { year: 2027, month: 6, day: 12 },
        { hour: 22, minute: 0 },
        { hour: 6, minute: 0 },
        LONDON,
      ),
    ).toEqual({ startsAt: at("2027-06-12T21:00:00Z"), endsAt: at("2027-06-13T05:00:00Z") });
  });

  it("nights across a clock change are their real length", () => {
    // 22:00 Sat to 06:00 Sun: 7 hours in March, 9 in October.
    expect(
      hours(
        shiftWindow(
          { year: 2027, month: 3, day: 27 },
          { hour: 22, minute: 0 },
          { hour: 6, minute: 0 },
          LONDON,
        ),
      ),
    ).toBe(7);
    expect(
      hours(
        shiftWindow(
          { year: 2027, month: 10, day: 30 },
          { hour: 22, minute: 0 },
          { hour: 6, minute: 0 },
          LONDON,
        ),
      ),
    ).toBe(9);
  });

  it.each([
    ["a finish equal to the start", { year: 2027, month: 6, day: 12 }, [9, 0], [9, 0]],
    // Only 23 real hours (the clocks go forward that night), but still a typo, not a shift.
    [
      "a finish equal to the start, over the March night",
      { year: 2027, month: 3, day: 27 },
      [9, 0],
      [9, 0],
    ],
    ["a start the clocks skip", { year: 2027, month: 3, day: 28 }, [1, 30], [6, 0]],
    ["a finish the clocks skip, the same day", { year: 2027, month: 3, day: 28 }, [0, 30], [1, 30]],
    ["a finish the clocks skip, the next day", { year: 2027, month: 3, day: 27 }, [22, 0], [1, 30]],
    [
      "24 hours or more, made of the hour that happens twice",
      { year: 2027, month: 10, day: 31 },
      [1, 30],
      [1, 15],
    ],
  ] as const)("refused: %s", (_label, date, [sh, sm], [eh, em]) => {
    expect(
      shiftWindow(date, { hour: sh, minute: sm }, { hour: eh, minute: em }, LONDON),
    ).toBeNull();
  });

  it("the office's editor uses the same rule (timesOn)", () => {
    expect(timesOn({ year: 2027, month: 3, day: 28 }, "01:30", "06:00", LONDON)).toBeNull();
    expect(timesOn({ year: 2027, month: 6, day: 12 }, "09:00", "09:00", LONDON)).toBeNull();
    expect(hours(timesOn({ year: 2027, month: 6, day: 12 }, "22:00", "06:00", LONDON))).toBe(8);
  });
});
