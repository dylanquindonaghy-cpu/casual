import { describe, expect, it } from "vitest";
import { homeWeek, type WeekBooking } from "@/lib/portal/home-week";
import { WEEK_LEGEND } from "@/lib/portal/home-copy";

// "Your week" on Home (Phase 30.1; docs/screens.md "### 30.1"): this week and next, Monday to
// Sunday on the firm's calendar, from now, her bookings and the shifts she can take. Pure.

const TZ = "Europe/London";
const booking = (id: string, startsAt: string, hours = 8, role = "steward"): WeekBooking => ({
  shiftId: id,
  role,
  startsAt: new Date(startsAt),
  endsAt: new Date(new Date(startsAt).getTime() + hours * 3_600_000),
});

describe("homeWeek", () => {
  // Friday 6 November 2026, 15:38 London (GMT).
  const NOW = new Date("2026-11-06T15:38:00Z");

  it("two rows of seven, Monday first, today marked, booked and open days linked and named", () => {
    const weeks = homeWeek(
      NOW,
      TZ,
      [booking("s-mon", "2026-11-09T14:00:00Z")],
      [
        { startsAt: new Date("2026-11-07T10:00:00Z") },
        { startsAt: new Date("2026-11-07T18:00:00Z") },
        { startsAt: new Date("2026-11-11T09:00:00Z") },
        { startsAt: new Date("2026-11-09T07:00:00Z") }, // the day she's booked: still booked
      ],
    );
    expect(weeks.map((w) => [w.name, w.range])).toEqual([
      ["This week", "2 to 8 Nov"],
      ["Next week", "9 to 15 Nov"],
    ]);
    const [thisWeek, nextWeek] = weeks;
    expect(thisWeek!.tiles.map((t) => t.dow)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(thisWeek!.tiles.map((t) => t.date)).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
    const fri = thisWeek!.tiles[4]!;
    expect(fri).toMatchObject({ today: true, past: false, booked: false, open: 0, href: null });
    expect(fri.name).toBe("Friday 6 November, today: nothing booked");
    expect(thisWeek!.tiles[0]!.past).toBe(true);
    const sat = thisWeek!.tiles[5]!;
    expect(sat).toMatchObject({ open: 2, booked: false, href: "/shifts/open?day=2026-11-07" });
    expect(sat.name).toBe("Saturday 7 November: 2 shifts you can take");
    const mon = nextWeek!.tiles[0]!;
    expect(mon).toMatchObject({ booked: true, open: 1, href: "/shifts/s-mon" });
    expect(mon.name).toBe(
      "Monday 9 November: booked, Steward 14:00 to 22:00. Also 1 shift you can take",
    );
    const wed = nextWeek!.tiles[2]!;
    expect(wed.name).toBe("Wednesday 11 November: 1 shift you can take");
    expect(WEEK_LEGEND).toBe("Filled: booked · outlined: shifts you can take");
  });

  it("two bookings on one day: both named, the first linked; the week across two months", () => {
    const now = new Date("2026-10-28T12:00:00Z"); // Wednesday 28 October
    const weeks = homeWeek(
      now,
      TZ,
      [booking("late", "2026-11-01T18:00:00Z", 4), booking("early", "2026-11-01T08:00:00Z", 4)],
      [],
    );
    expect(weeks.map((w) => w.range)).toEqual(["26 Oct to 1 Nov", "2 to 8 Nov"]);
    const sun = weeks[0]!.tiles[6]!;
    expect(sun.href).toBe("/shifts/early");
    expect(sun.name).toBe(
      "Sunday 1 November: booked, Steward 08:00 to 12:00 and Steward 18:00 to 22:00",
    );
  });

  it("the week turns over at midnight on the firm's calendar, not UTC's", () => {
    // Sunday 8 November 23:30 GMT: still the week of Monday 2 November.
    expect(homeWeek(new Date("2026-11-08T23:30:00Z"), TZ, [], [])[0]!.range).toBe("2 to 8 Nov");
    // Monday 9 November 00:30.
    expect(homeWeek(new Date("2026-11-09T00:30:00Z"), TZ, [], [])[0]!.range).toBe("9 to 15 Nov");
    // In summer time: Sunday 23:30 UTC on 2 August is already Monday 3 August in London.
    const summer = homeWeek(new Date("2026-08-02T23:30:00Z"), TZ, [], []);
    expect(summer[0]!.range).toBe("3 to 9 Aug");
    expect(summer[0]!.tiles[0]!.today).toBe(true);
  });

  it("across the clocks going back (Sunday 25 October 2026): each booking on its London day", () => {
    // 01:30 BST on Sunday 25 October, before the clocks go back at 02:00 BST.
    const now = new Date("2026-10-25T00:30:00Z");
    const weeks = homeWeek(
      now,
      TZ,
      [
        // 00:30 BST on Sunday 25 October (the 24th in UTC).
        booking("sun-early", "2026-10-24T23:30:00Z"),
        // 23:30 GMT on Sunday 25 October.
        booking("sun-late", "2026-10-25T23:30:00Z", 2),
        // 00:30 GMT on Monday 26 October: next week.
        booking("mon", "2026-10-26T00:30:00Z"),
      ],
      [],
    );
    expect(weeks[0]!.range).toBe("19 to 25 Oct");
    const sun = weeks[0]!.tiles[6]!;
    expect(sun.today).toBe(true);
    expect(sun.href).toBe("/shifts/sun-early");
    // 8 hours from 00:30 BST is 07:30 GMT (the hour the clocks went back).
    expect(sun.name).toBe(
      "Sunday 25 October, today: booked, Steward 00:30 to 07:30 and Steward 23:30 to 01:30",
    );
    expect(weeks[0]!.tiles[5]!.booked).toBe(false); // Saturday 24th: nothing
    expect(weeks[1]!.tiles[0]).toMatchObject({
      day: "2026-10-26",
      booked: true,
      href: "/shifts/mon",
    });
  });

  it("a past day she was marked as not attending is never 'booked' (filled or named)", () => {
    const NOW = new Date("2026-11-06T15:38:00Z");
    const weeks = homeWeek(
      NOW,
      TZ,
      [
        { ...booking("missed", "2026-11-02T14:00:00Z"), noShow: true },
        booking("worked", "2026-11-03T09:00:00Z"),
        { ...booking("both-missed", "2026-11-04T08:00:00Z", 4), noShow: true },
        booking("both-worked", "2026-11-04T14:00:00Z", 4),
      ],
      [],
    );
    const [mon, tue, wed] = weeks[0]!.tiles;
    expect(mon).toMatchObject({ booked: false, missed: true, href: "/shifts/missed" });
    expect(mon!.name).toBe("Monday 2 November: not attended, Steward 14:00 to 22:00");
    expect(mon!.name).not.toContain("booked");
    expect(tue).toMatchObject({ booked: true, missed: false, href: "/shifts/worked" });
    // A day with both: filled for the one she worked, the other named as not attended.
    expect(wed).toMatchObject({ booked: true, missed: false, href: "/shifts/both-worked" });
    expect(wed!.name).toBe(
      "Wednesday 4 November: booked, Steward 14:00 to 18:00; not attended, Steward 08:00 to 12:00",
    );
  });

  it("the kept copy's names: no 'today', no shifts she can take; her bookings stay", () => {
    const NOW = new Date("2026-11-06T15:38:00Z");
    const weeks = homeWeek(
      NOW,
      TZ,
      [booking("fri", "2026-11-06T18:00:00Z", 4)],
      [
        { startsAt: new Date("2026-11-07T10:00:00Z") },
        { startsAt: new Date("2026-11-06T19:00:00Z") },
      ],
    );
    const fri = weeks[0]!.tiles[4]!;
    expect(fri.name).toBe(
      "Friday 6 November, today: booked, Steward 18:00 to 22:00. Also 1 shift you can take",
    );
    expect(fri.nameOffline).toBe("Friday 6 November: booked, Steward 18:00 to 22:00");
    const sat = weeks[0]!.tiles[5]!;
    expect(sat.name).toBe("Saturday 7 November: 1 shift you can take");
    expect(sat.nameOffline).toBe("Saturday 7 November: nothing booked");
    const sun = weeks[0]!.tiles[6]!;
    expect(sun.nameOffline).toBe(sun.name);
  });
});
