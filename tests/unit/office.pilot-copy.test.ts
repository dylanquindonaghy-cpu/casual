import { describe, expect, it } from "vitest";
import { DAILY_METRICS, figureSchema } from "@/lib/metrics/definitions";
import { durationWords, pilotRows, saveFiguresText, updateNowText } from "@/lib/office/pilot-copy";
import type { PilotReport } from "@/lib/office/pilot-report";

// The pilot metrics page's words (src/lib/office/pilot-copy.ts) and the forms' figure check.

const report = (o: Partial<PilotReport> = {}): PilotReport => ({
  timeZone: "Europe/London",
  filters: { from: "2026-10-27", to: "2026-11-02" },
  clamped: false,
  days: 7,
  baseline: { values: {}, weekStart: null, updatedAt: null },
  tally: { values: {}, weeks: 0, thisWeek: "2026-11-02", thisWeekValues: {} },
  daily: {
    sums: Object.fromEntries(DAILY_METRICS.map((m) => [m, 0])) as PilotReport["daily"]["sums"],
    daysCounted: 0,
    updatedAt: null,
  },
  live: {
    refillMedianMinutes: null,
    refills: 0,
    activeWorkers: 0,
    activeLoggedIn: 0,
    urgentShifts: 0,
    urgentFilledByWave: 0,
  },
  ...o,
});
const row = (r: PilotReport, label: RegExp) => pilotRows(r).find((x) => label.test(x.label));

describe("the pilot metrics page's words", () => {
  it("before anything is entered or counted", () => {
    const r = report();
    expect(row(r, /^Messages in/)).toMatchObject({
      baseline: "Not entered",
      now: "No tally for these dates",
      target: "Half the baseline",
    });
    expect(row(r, /^Shift queries unanswered/)).toMatchObject({
      now: "None yet",
      target: "Under 2%",
    });
    expect(row(r, /^Portal adoption/)?.now).toBe("No active workers");
    expect(row(r, /^Time to refill/)?.now).toBe("No refilled cancellations");
  });

  it("baseline against now, as numbers people read", () => {
    const sums = { ...report().daily.sums };
    Object.assign(sums, {
      portal_actions: 90,
      requests_created: 10,
      requests_due: 8, // two made in the last 24 hours, not yet due
      requests_slow: 2,
      no_shows: 2,
      short_notice_cancellations: 5,
    });
    const r = report({
      baseline: {
        values: {
          emails_per_day: 40,
          calls_per_day: 12,
          whatsapp_per_day: 30,
          unanswered_pct: 40,
          refill_minutes: 240,
          no_shows_per_week: 3,
          resourcer_hours_per_week: 20,
          short_notice_per_week: 6,
        },
        weekStart: "2026-10-05",
        updatedAt: new Date(),
      },
      tally: {
        values: { emails_per_day: 20, calls_per_day: 5, resourcer_hours_per_week: 16.5 },
        weeks: 1,
        thisWeek: "2026-11-02",
        thisWeekValues: {},
      },
      daily: { sums, daysCounted: 7, updatedAt: new Date() },
      live: {
        refillMedianMinutes: 95,
        refills: 3,
        activeWorkers: 40,
        activeLoggedIn: 26,
        urgentShifts: 4,
        urgentFilledByWave: 3,
      },
    });
    expect(pilotRows(r).map((x) => [x.baseline, x.now])).toEqual([
      ["82", "25"],
      ["40%", "25%"],
      ["Before the app", "90 (12.9 a day)"],
      ["Before the app", "90%"],
      ["4 hours", "1 hour 35 minutes (3 refilled)"],
      ["", "40"],
      ["", "65% (26 of 40)"],
      ["", "75% (3 of 4)"],
      ["3", "2"],
      ["6", "5"],
      ["20", "16.5"],
    ]);
  });

  it("durations", () => {
    expect(durationWords(45)).toBe("45 minutes");
    expect(durationWords(60)).toBe("1 hour");
    expect(durationWords(61)).toBe("1 hour 1 minute");
    expect(durationWords(60 * 26)).toBe("1 day 2 hours");
    expect(durationWords(60 * 48)).toBe("2 days");
  });

  it("each save says what happened", () => {
    expect(
      saveFiguresText({ status: "saved", weekStart: "2026-10-05", count: 3 }, "baseline"),
    ).toBe("Baseline saved.");
    expect(saveFiguresText({ status: "saved", weekStart: "2026-11-02", count: 1 }, "tally")).toBe(
      "This week's tally saved.",
    );
    expect(
      saveFiguresText(
        { status: "invalid", problems: ["calls_per_day", "unanswered_pct"] },
        "baseline",
      ),
    ).toBe(
      "Check these: Calls per day; Shift queries unanswered after 24 hours (%). Each is a number, like 12 or 3.5.",
    );
    expect(saveFiguresText({ status: "nothing" }, "tally")).toBe("Fill in at least one figure.");
    expect(saveFiguresText({ status: "bad_date" }, "tally")).toBe("Choose a day in the week.");
    expect(saveFiguresText({ status: "bad_date" }, "baseline")).toBe(
      "Choose the week's first day.",
    );
    expect(saveFiguresText({ status: "not_allowed" }, "tally")).toBe(
      "You can't change the pilot figures.",
    );
    expect(updateNowText({ status: "updated", days: 8 })).toBe("Figures updated.");
  });

  it("a figure: blank, or a number from 0 to the maximum with at most 2 decimals", () => {
    const check = figureSchema(100);
    for (const ok of ["", " ", "0", "12", "3.5", "99.99", "100"]) {
      expect(check.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["-1", "1e3", "3.555", "101", "lots", "12,5"]) {
      expect(check.safeParse(bad).success, bad).toBe(false);
    }
  });
});
