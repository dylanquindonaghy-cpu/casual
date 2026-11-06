import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpView } from "@/app/help/help-view";
import { firstComeWaves } from "@/lib/offers/waves";
import {
  bookingRuleLines,
  bookingRules,
  whyNotLines,
  type HelpFacts,
} from "@/lib/portal/help-facts";
import { AllocationSettingsError, parseAllocationSettings } from "@/lib/roster/allocation-input";
import { rulesSettingsSchema } from "@/lib/roster/eligibility-input";
import { quietHours } from "@/lib/rules/quiet-hours";
import { urgentWindowHours } from "@/lib/rules/urgent";
import { strikeSettings } from "@/lib/strikes/settings";

// Help's "The firm's rules for taking shifts" and "Why can't I see a shift?" (Phase 28.12;
// docs/screens.md "### 28.12"): every figure is what the rules' own parser returns for the firm's
// settings (golden rule 1: Help can't promise what the rules don't do), a setting the parser
// refuses leaves its line out without throwing, and no line says an offer runs out (offers close
// only when the shift fills, moves or is cancelled: src/lib/offers/close.ts).

const STRIKES_ON = { on: true, noticeHours: 48 };
const lines = (settings: Record<string, unknown>, strikes = STRIKES_ON) =>
  bookingRuleLines(bookingRules(settings), strikes);

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ \./g, ".");

function facts(settings: Record<string, unknown>, o: Partial<HelpFacts> = {}): HelpFacts {
  const strikes = strikeSettings(settings);
  return {
    noticeHours: strikes.noticeHours,
    liveDays: strikes.liveDays,
    photoRenewalMonths: 36,
    travelOn: true,
    strikesOn: strikes.enabled,
    loginWay: "message",
    pushOn: true,
    rules: bookingRules(settings),
    ...o,
  };
}
const help = (f: HelpFacts) =>
  text(
    renderToStaticMarkup(
      createElement(HelpView, { firmName: "Acme Events", facts: f, year: 2026 }),
    ),
  );

describe("offer groups, worded per allocation mode", () => {
  it("fair rotation with wave_minutes 20: the small group has 20 minutes", () => {
    const settings = { allocation_mode: "fair_rotation", wave_minutes: 20 };
    const parsed = parseAllocationSettings(settings);
    expect(parsed).toMatchObject({ mode: "fair_rotation", priorityMinutes: 20 });
    expect(bookingRules(settings).allocation).toEqual({
      mode: "fair_rotation",
      priorityMinutes: 20,
      urgentWindowHours: 24,
    });
    const all = lines(settings);
    expect(all).toContain(
      "A small group gets first go for 20 minutes, then everyone can take it. The group is the people with the fewest hours that week.",
    );
    expect(all).toContain(
      "Urgent shifts, and shifts starting in the next 24 hours, are open to everyone straight away.",
    );
    expect(all).toContain(
      "For an urgent shift, we message a small group first. If nobody takes it, more people are offered it after 20 minutes.",
    );
    expect(all.join(" ")).not.toContain("The first person to tap Take shift");
  });

  it("fair rotation: the urgent window is fair rotation's own (and 0 means only urgent ones)", () => {
    const own = { allocation_mode: "fair_rotation", urgent_window_hours: 6 };
    expect(lines(own)).toContain(
      "Urgent shifts, and shifts starting in the next 6 hours, are open to everyone straight away.",
    );
    expect(lines({ allocation_mode: "fair_rotation", urgent_window_hours: 0 })).toContain(
      "Urgent shifts are open to everyone straight away.",
    );
  });

  it("first come: the 'more people after' line with firstComeWaves' figure", () => {
    for (const settings of [
      {},
      { wave_minutes: 25 },
      { allocation_mode: "first_come_first_served", wave_minutes: 7 },
    ]) {
      const minutes = firstComeWaves(settings).minutes;
      expect(bookingRules(settings).allocation).toEqual({
        mode: "first_come_first_served",
        waveMinutes: minutes,
      });
      const all = lines(settings);
      expect(all).toContain("The first person to tap Take shift gets the place.");
      expect(all).toContain(
        `For an urgent shift, we message a few people first. If nobody takes it, more people are offered it after ${minutes} minutes.`,
      );
      expect(all.join(" ")).not.toContain("small group gets first go");
    }
    expect(firstComeWaves({ wave_minutes: 25 }).minutes).toBe(25);
    // firstComeWaves' own default for a value it won't take (and the line follows it).
    expect(lines({ wave_minutes: 999 })).toContain(
      `For an urgent shift, we message a few people first. If nobody takes it, more people are offered it after ${firstComeWaves({ wave_minutes: 999 }).minutes} minutes.`,
    );
  });

  it("broken allocation settings: the line is left out and nothing throws", () => {
    for (const broken of [
      { allocation_mode: "lottery" },
      { allocation_mode: "fair_rotation", wave_minutes: 0 },
      { allocation_mode: "fair_rotation", wave_size: "four" },
    ]) {
      expect(() => parseAllocationSettings(broken)).toThrow(AllocationSettingsError);
      expect(() => bookingRules(broken)).not.toThrow();
      expect(bookingRules(broken).allocation).toBeNull();
      const joined = lines(broken).join(" ");
      expect(joined).not.toMatch(/first go|more people are offered|first person to tap/);
      // The other rules still show.
      expect(joined).toContain("You can work up to 48 hours a week, Monday to Sunday.");
      // And the page renders.
      expect(() => help(facts(broken))).not.toThrow();
    }
  });
});

describe("the rest gap, the cap, the urgent window and quiet hours, from their parsers", () => {
  it("defaults: what each parser returns for no settings", () => {
    const rules = rulesSettingsSchema.parse({});
    const q = quietHours({});
    const all = lines({});
    expect(all).toContain(`You need at least ${rules.min_rest_hours} hours' rest between shifts.`);
    expect(all).toContain(
      `You can work up to ${rules.weekly_hours_cap} hours a week, Monday to Sunday.`,
    );
    expect(all).toContain(
      `A shift becomes urgent when someone drops out less than ${urgentWindowHours({})} hours before it starts. The office can mark a shift urgent too.`,
    );
    expect(all).toContain(
      `Between ${q.start} and ${q.end} we hold shift messages until ${q.end}. Urgent ones still come.`,
    );
    expect(all).toEqual(
      expect.arrayContaining([
        "You need at least 11 hours' rest between shifts.",
        "You can work up to 48 hours a week, Monday to Sunday.",
        "Between 22:00 and 07:00 we hold shift messages until 07:00. Urgent ones still come.",
      ]),
    );
  });

  it("custom settings: the firm's own figures", () => {
    const settings = {
      min_rest_hours: 10.5,
      weekly_hours_cap: 60,
      urgent_window_hours: 12,
      quiet_hours: { start: "23:00", end: "06:30", urgent_override: false },
    };
    const rules = rulesSettingsSchema.parse(settings);
    expect(rules.min_rest_hours).toBe(10.5);
    expect(urgentWindowHours(settings)).toBe(12);
    expect(quietHours(settings)).toEqual({ start: "23:00", end: "06:30", urgentOverride: false });
    const all = lines(settings);
    expect(all).toContain("You need at least 10.5 hours' rest between shifts.");
    expect(all).toContain("You can work up to 60 hours a week, Monday to Sunday.");
    expect(all).toContain(
      "A shift becomes urgent when someone drops out less than 12 hours before it starts. The office can mark a shift urgent too.",
    );
    expect(all).toContain(
      "Between 23:00 and 06:30 we hold shift messages until 06:30, even urgent ones.",
    );
  });

  it("edge values: 1 hour's rest, no rest gap, no urgent window, no quiet hours", () => {
    expect(lines({ min_rest_hours: 1 })).toContain(
      "You need at least 1 hour's rest between shifts.",
    );
    expect(lines({ min_rest_hours: 0 }).join(" ")).not.toContain("rest between shifts");
    expect(lines({ urgent_window_hours: 0 })).toContain(
      "A shift becomes urgent when the office marks it urgent.",
    );
    expect(lines({ quiet_hours: { start: "22:00", end: "22:00" } }).join(" ")).not.toContain(
      "hold shift messages",
    );
  });

  it("rules settings the parser refuses: the rest and cap lines are left out", () => {
    const broken = { weekly_hours_cap: -5 };
    expect(rulesSettingsSchema.safeParse(broken).success).toBe(false);
    expect(bookingRules(broken).rest).toBeNull();
    const joined = lines(broken).join(" ");
    expect(joined).not.toMatch(/rest between shifts|hours a week/);
    expect(whyNotLines(facts(broken))).toContain(
      "You'd have too little rest before or after another shift.",
    );
    expect(whyNotLines(facts(broken))).toContain("It would take you over your weekly hours.");
  });

  it("no line says an offer runs out or expires", () => {
    for (const settings of [
      {},
      { allocation_mode: "fair_rotation", wave_minutes: 20 },
      { allocation_mode: "fair_rotation", urgent_window_hours: 0 },
      { wave_minutes: 1 },
    ]) {
      const page = help(facts(settings));
      const all = [...lines(settings), ...whyNotLines(facts(settings))].join(" ");
      for (const words of [all, page]) {
        expect(words).not.toMatch(/runs? out|expires?|expired offer|offer ends/i);
      }
    }
  });
});

describe("what follows the firm's switches", () => {
  it("with strikes.enabled false, the strike lines are absent", () => {
    const off = { strikes: { enabled: false } };
    expect(
      lines(off, { on: strikeSettings(off).enabled, noticeHours: 48 }).join(" "),
    ).not.toContain("strike");
    const page = help(facts(off));
    expect(page).not.toContain("Cancelling and strikes");
    expect(page).not.toMatch(/you get a strike/);
    // On, the firm's own notice.
    const on = { strikes: { notice_hours: 24 } };
    expect(lines(on, { on: true, noticeHours: strikeSettings(on).noticeHours })).toContain(
      "If you cancel less than 24 hours before a shift starts, you get a strike.",
    );
  });

  it("with travel off, the travel lines are absent", () => {
    expect(whyNotLines(facts({}, { travelOn: false })).join(" ")).not.toContain("travel area");
    expect(whyNotLines(facts({}, { travelOn: true }))).toContain(
      "You can't get there in time from your travel area.",
    );
    const page = help(facts({}, { travelOn: false }));
    expect(page).not.toMatch(/travel area/i);
  });

  it("the 'You can take it from' line only under fair rotation", () => {
    const fair = whyNotLines(facts({ allocation_mode: "fair_rotation" })).join(" ");
    expect(fair).toContain("You can take it from");
    expect(whyNotLines(facts({})).join(" ")).not.toContain("You can take it from");
  });

  it("why a shift may not show: role, qualifications, days, rest and cap, not opened", () => {
    expect(whyNotLines(facts({ min_rest_hours: 12, weekly_hours_cap: 40 }))).toEqual([
      "It's for a role you don't do.",
      "A licence or card it needs is missing, or out of date.",
      "You can't get there in time from your travel area.",
      "You've marked that day as one you can't work.",
      "You're already booked at that time.",
      "You'd have less than 12 hours' rest before or after another shift.",
      "It would take you over 40 hours that week.",
      "The office hasn't opened it to casuals yet.",
    ]);
  });
});

describe("the help page", () => {
  it("shows both topics in the contents with the firm's numbers", () => {
    const html = renderToStaticMarkup(
      createElement(HelpView, {
        firmName: "Acme Events",
        facts: facts({ allocation_mode: "fair_rotation", wave_minutes: 20, min_rest_hours: 12 }),
        year: 2026,
      }),
    );
    expect(html).toContain('href="#firm-rules"');
    expect(html).toContain('href="#why-not"');
    expect(html).toContain('id="firm-rules"');
    expect(html).toContain('id="why-not"');
    const words = text(html);
    expect(words).toContain("The firm's rules for taking shifts");
    expect(words).toContain("These are Acme Events' own settings.");
    expect(words).toContain("A small group gets first go for 20 minutes");
    expect(words).toContain("You need at least 12 hours' rest between shifts.");
  });

  it("no 'Contact the office': each way to the office is a Message the office link", () => {
    const html = renderToStaticMarkup(
      createElement(HelpView, { firmName: "Acme Events", facts: facts({}), year: 2026 }),
    );
    expect(text(html)).not.toMatch(/contact the office/i);
    expect(html).toMatch(/<a [^>]*href="\/messages"[^>]*>Message the office<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/messages"[^>]*>message the office<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/messages\?about=pay"[^>]*>message the office<\/a>/);
    // 44px to tap.
    for (const m of html.matchAll(/<a [^>]*class="([^"]*)"[^>]*>[Mm]essage the office<\/a>/g)) {
      expect(m[1]).toContain("min-h-11");
    }
    expect(html).toMatch(/<a [^>]*href="\/shifts"[^>]*>Back to my shifts<\/a>/);
  });

  it("names the Profile folds and Send this photo; no phone notifications without a key", () => {
    const on = help(facts({}, { loginWay: "email", pushOn: true }));
    expect(on).toContain("Tap Days you can't work to open it.");
    expect(on).toContain(
      "Tap How we reach you to open it. Then choose whether to hear about open shifts, and turn on notifications on this phone. Tap Save settings.",
    );
    expect(on).toContain("Check it, then tap Send this photo.");
    expect(on).toContain("Tap Upload a new photo and face the camera. Then tap Send this photo.");
    const off = help(facts({}, { loginWay: "email", pushOn: false }));
    expect(off).toContain(
      "Tap How we reach you to open it. Then choose whether to hear about open shifts. Tap Save settings.",
    );
    expect(off).not.toContain("notifications on this phone");
  });
});
