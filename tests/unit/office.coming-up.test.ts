import { describe, expect, it } from "vitest";
import {
  askedChip,
  askedHref,
  askedLabel,
  bookedOf,
  casualHref,
  COMING_UP_ALL,
  COMING_UP_ALL_HREF,
  COMING_UP_SHOWN,
  comingUpDays,
  comingUpEmpty,
  comingUpHeading,
  comingUpLine,
  dayWord,
  licenceChip,
  licenceWords,
  placesShort,
  sessionLabel,
} from "@/lib/office/coming-up-copy";
import {
  COLUMN_IDS,
  COLUMN_TITLES,
  countWords,
  EMPTY_HINTS,
  emptyText,
} from "@/lib/office/board-copy";
import { expiredText } from "@/lib/office/dashboard-copy";

// The dashboard's Coming up in words (Phase 27.9; src/lib/office/coming-up-copy.ts): today and
// tomorrow in the firm's time zone (across midnight and both clock changes), each session's line,
// how many are booked, the column's line and empty words, and a person's two flags.
// tests/unit/office.board.test.ts renders the column; tests/integration/office.coming-up.test.ts
// reads its rows from the database.

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);
// Monday 26 October 2026, 11:20 London (GMT: the clocks went back the day before).
const NOW = at("2026-10-26T11:20:00Z");

describe("today and tomorrow, in the firm's time zone", () => {
  it("the days and the end of tomorrow on an ordinary day", () => {
    expect(comingUpDays(NOW, TZ)).toEqual({
      today: "2026-10-26",
      tomorrow: "2026-10-27",
      end: at("2026-10-28T00:00:00Z"),
    });
  });

  it("across midnight: a minute either side moves both days on", () => {
    expect(comingUpDays(at("2026-11-02T23:59:00Z"), TZ)).toEqual({
      today: "2026-11-02",
      tomorrow: "2026-11-03",
      end: at("2026-11-04T00:00:00Z"),
    });
    expect(comingUpDays(at("2026-11-03T00:01:00Z"), TZ)).toEqual({
      today: "2026-11-03",
      tomorrow: "2026-11-04",
      end: at("2026-11-05T00:00:00Z"),
    });
    // In summer time, 00:30 on Saturday in London is still Friday in UTC: it's Saturday here.
    expect(comingUpDays(at("2026-10-23T23:30:00Z"), TZ).today).toBe("2026-10-24");
  });

  it("over the clock change: tomorrow ends at the right midnight, 49 or 47 hours after today began", () => {
    // Saturday 24 Oct 2026 (summer time); the clocks go back at 02:00 on Sunday 25, so tomorrow
    // has 25 hours and ends at midnight GMT on Monday.
    const back = comingUpDays(at("2026-10-24T11:00:00Z"), TZ);
    expect(back).toEqual({
      today: "2026-10-24",
      tomorrow: "2026-10-25",
      end: at("2026-10-26T00:00:00Z"),
    });
    expect((back.end.getTime() - at("2026-10-23T23:00:00Z").getTime()) / 3_600_000).toBe(49);
    // Saturday 27 Mar 2027 (GMT); the clocks go forward at 01:00 on Sunday 28, so tomorrow has 23
    // hours and ends at midnight summer time (23:00 UTC).
    const forward = comingUpDays(at("2027-03-27T12:00:00Z"), TZ);
    expect(forward).toEqual({
      today: "2027-03-27",
      tomorrow: "2027-03-28",
      end: at("2027-03-28T23:00:00Z"),
    });
    expect((forward.end.getTime() - at("2027-03-27T00:00:00Z").getTime()) / 3_600_000).toBe(47);
  });

  it("a session's day: Today, Tomorrow, Yesterday (a night shift under way), else its date", () => {
    expect(dayWord(at("2026-10-26T19:00:00Z"), NOW, TZ)).toBe("Today");
    expect(dayWord(at("2026-10-26T23:30:00Z"), NOW, TZ)).toBe("Today");
    expect(dayWord(at("2026-10-27T00:30:00Z"), NOW, TZ)).toBe("Tomorrow");
    expect(dayWord(at("2026-10-25T22:00:00Z"), NOW, TZ)).toBe("Yesterday");
    expect(dayWord(at("2026-10-28T08:00:00Z"), NOW, TZ)).toBe("Wed 28 Oct");
    // Summer time: 00:30 on Sunday in London is Saturday in UTC, but tomorrow from Saturday night.
    expect(dayWord(at("2026-10-24T23:30:00Z"), at("2026-10-24T22:30:00Z"), TZ)).toBe("Tomorrow");
  });
});

describe("a session", () => {
  const tonight = {
    role: "csas_officer",
    site: "Northgate Demo Town Centre",
    eventName: "Night patrols",
    startsAt: at("2026-10-26T19:00:00Z"),
    endsAt: at("2026-10-27T01:00:00Z"),
  };

  it("its line: the day and times, the role (an acronym kept), and its venue or else its event", () => {
    expect(comingUpHeading(tonight, NOW, TZ)).toBe(
      "Today 19:00–01:00 · CSAS officer · Northgate Demo Town Centre",
    );
    expect(
      comingUpHeading(
        {
          ...tonight,
          role: "door_supervisor",
          site: null,
          startsAt: at("2026-10-27T08:00:00Z"),
          endsAt: at("2026-10-27T16:00:00Z"),
        },
        NOW,
        TZ,
      ),
    ).toBe("Tomorrow 08:00–16:00 · Door supervisor · Night patrols");
    expect(sessionLabel(comingUpHeading(tonight, NOW, TZ), bookedOf(3, 4))).toBe(
      "Open the session: Today 19:00–01:00 · CSAS officer · Northgate Demo Town Centre, 3 of 4 booked",
    );
  });

  it("how many are booked; red only while a place is free on one that starts today", () => {
    expect(bookedOf(3, 4)).toBe("3 of 4 booked");
    expect(bookedOf(1, 1)).toBe("1 of 1 booked");
    const s = { booked: 3, headcount: 4, startsAt: tonight.startsAt };
    expect(placesShort(s, NOW, TZ)).toBe(true);
    expect(placesShort({ ...s, booked: 4 }, NOW, TZ)).toBe(false);
    expect(placesShort({ ...s, startsAt: at("2026-10-27T08:00:00Z") }, NOW, TZ)).toBe(false);
  });
});

describe("the column", () => {
  it("its title, anchor, count words, line, empty words and foot", () => {
    expect(COLUMN_TITLES.comingUp).toBe("Coming up");
    expect(COLUMN_IDS.comingUp).toBe("coming-up");
    expect(countWords.comingUp(1)).toBe("1 session coming up");
    expect(countWords.comingUp(3)).toBe("3 sessions coming up");
    expect(comingUpLine(1, 1, false)).toBe("Today and tomorrow · 1 person on 1 session");
    expect(comingUpLine(5, 3, false)).toBe("Today and tomorrow · 5 people on 3 sessions");
    expect(comingUpLine(5, 3, true)).toBe(
      "Today and tomorrow · 5 people on 3 sessions on your contracts",
    );
    expect(comingUpEmpty(false)).toBe("Nobody's booked today or tomorrow.");
    expect(comingUpEmpty(true)).toBe("Nobody's booked on your contracts today or tomorrow.");
    expect(emptyText("comingUp", false, "all")).toBe(comingUpEmpty(false));
    expect(EMPTY_HINTS.comingUp).toBe(
      "Sessions today and tomorrow with someone booked show here, soonest first.",
    );
    expect([COMING_UP_ALL, COMING_UP_ALL_HREF]).toEqual(["All sessions", "/office/shifts"]);
    expect(COMING_UP_SHOWN).toBe(6);
  });

  it("Updates' empty words no longer promise uploads (Phase 27.9)", () => {
    expect(EMPTY_HINTS.updates).toBe(
      "Places taken, cancellations and offers with no reply show here.",
    );
  });
});

describe("a person's flags", () => {
  const today = "2026-10-26";
  const session = { role: "door_supervisor", startsAt: at("2026-11-07T08:00:00Z") };

  it("a licence: out of date (run out, or marked expired), or the day it runs out", () => {
    const licence = (expiresOn: string | null) => ({
      credential: "SIA door supervisor licence",
      expiresOn,
    });
    expect(licenceChip(licence(null), today)).toBe("SIA door supervisor licence out of date");
    expect(licenceChip(licence("2026-10-20"), today)).toBe(
      "SIA door supervisor licence out of date",
    );
    expect(licenceChip(licence("2026-10-26"), today)).toBe(
      "SIA door supervisor licence runs out Mon 26 Oct",
    );
    expect(licenceChip(licence("2026-11-07"), today)).toBe(
      "SIA door supervisor licence runs out Sat 7 Nov",
    );
    // Another sector's qualification by its own name, never "licence" for all.
    expect(licenceChip({ credential: "CSCS card", expiresOn: null }, today)).toBe(
      "CSCS card out of date",
    );
    // In full, Needs attention's own sentence, with its name.
    expect(licenceWords("Zoe Adeyemi", licence("2026-11-07"), session, today, TZ)).toBe(
      "Zoe Adeyemi's SIA door supervisor licence runs out on Sat 7 Nov, during their door supervisor session on Sat 7 Nov.",
    );
    expect(licenceWords("Zoe Adeyemi", licence("2026-11-01"), session, today, TZ)).toBe(
      "Zoe Adeyemi's SIA door supervisor licence runs out on Sun 1 Nov, before their door supervisor session on Sat 7 Nov.",
    );
    expect(licenceWords("Zoe Adeyemi", licence("2026-10-20"), session, today, TZ)).toBe(
      "Zoe Adeyemi's SIA door supervisor licence expired on Tue 20 Oct, before their door supervisor session on Sat 7 Nov.",
    );
    expect(
      licenceWords(
        "Kieran Doyle",
        { credential: "SIA CCTV licence", expiresOn: null },
        { role: "csas_officer", startsAt: at("2026-10-26T19:00:00Z") },
        today,
        TZ,
      ),
    ).toBe(
      "Kieran Doyle's SIA CCTV licence is marked as expired, and they're booked on a CSAS officer session on Mon 26 Oct.",
    );
  });

  it("Needs attention's sentence keeps an acronym role in capitals (Phase 26.10's rule)", () => {
    const words = expiredText(
      {
        worker: "Ben Example",
        credential: "SIA CCTV licence",
        expiresOn: "2026-10-20",
        role: "csas_officer",
        startsAt: at("2026-10-26T19:00:00Z"),
      },
      today,
      TZ,
    );
    expect(words).toBe(
      "Ben Example's SIA CCTV licence expired on Tue 20 Oct, before their CSAS officer session on Mon 26 Oct.",
    );
    expect(words).not.toMatch(/csas|Csas/);
  });

  it("asked: a time change or a swap waiting, a link to the request", () => {
    expect(askedChip("time_change")).toBe("Asked to change times");
    expect(askedChip("swap")).toBe("Asked to swap");
    expect(askedLabel("Ben Fraser", "time_change")).toBe(
      "Ben Fraser asked to change times. Open their request.",
    );
    expect(askedLabel("Eve Long", "swap")).toBe("Eve Long asked to swap. Open their request.");
    expect(askedHref("0b6b7f5e-1111-4222-8333-944445555666")).toBe(
      "/office/enquiries?view=app#request-0b6b7f5e-1111-4222-8333-944445555666",
    );
    expect(casualHref("w1")).toBe("/office/casuals/w1");
  });
});
