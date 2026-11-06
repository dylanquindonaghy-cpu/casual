import { eq } from "drizzle-orm";
import { firms } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
import { appEnv } from "../env";
import { firstComeWaves } from "../offers/waves";
import { parseAllocationSettings } from "../roster/allocation-input";
import { rulesSettingsSchema } from "../roster/eligibility-input";
import { quietHours, type QuietHours } from "../rules/quiet-hours";
import { urgentWindowHours } from "../rules/urgent";
import { strikeSettings } from "../strikes/settings";
import { travelSettings } from "../travel/settings";
import { photoSettings } from "../uploads/settings";
import { hasTextSender, loginWay, type LoginWay } from "./login-way";

// The firm's own numbers the help page states (docs/office-v2.md 4.7; 12H.3): the notice that
// avoids a strike, how long a strike counts, and how often a staff photo is renewed; and whether it
// has travel areas on (13.4: the help on them shows only then); and how login links and pay codes
// go (P2.7); and whether it has phone notifications (its VAPID key; 28.11 hides that setting
// without one). Read inside the firm's own transaction (the help page is open without logging in;
// the firm comes from the address). Defaults when a setting isn't set, as everywhere else.
//
// Phase 28.12: "The firm's rules for taking shifts" (docs/screens.md "### 28.12"). Each fact comes
// from the very parser the rules use (golden rule 1: Help can only state what the rules do), and a
// fact whose parser refuses the firm's settings is left out (null), so this public page never
// throws over a bad setting:
// - how a newly opened place is shared, per allocation mode: parseAllocationSettings (fair
//   rotation's group and minutes; null on AllocationSettingsError), and first come's waves from
//   firstComeWaves (the minutes between urgent offers). `wave_minutes` means two things: under fair
//   rotation, how long the small group has (and the gap between urgent waves, waves.ts); under first
//   come, only the gap between urgent waves. So each mode is worded on its own;
// - the rest gap and the weekly hours cap: rulesSettingsSchema (null when it refuses: the rules
//   then refuse every booking, RulesSettingsError);
// - when a shift becomes urgent: urgentWindowHours;
// - quiet hours: quietHours (none when the start equals the end);
// - the strike notice: strikeSettings, only while strikes are on.
// No line ever says an offer runs out: offers close only when the shift fills, moves or is
// cancelled (src/lib/offers/close.ts).

export type AllocationFact =
  | {
      mode: "fair_rotation";
      priorityMinutes: number; // wave_minutes: how long the small group has first go
      urgentWindowHours: number; // a shift starting sooner (or urgent) is never held
    }
  | { mode: "first_come_first_served"; waveMinutes: number }; // between urgent offer waves

export interface BookingRules {
  allocation: AllocationFact | null; // null: the allocation settings don't parse
  rest: { minRestHours: number; weeklyHoursCap: number } | null; // null: rules settings refused
  urgentWindowHours: number;
  quiet: QuietHours;
}

export interface HelpFacts {
  noticeHours: number; // strikes.notice_hours (48)
  liveDays: number; // strikes.live_days (90)
  photoRenewalMonths: number; // photo.renewal_months (36)
  travelOn: boolean; // travel.enabled (off)
  strikesOn: boolean; // strikes.enabled (on): off, the strikes section isn't shown (P3.4)
  loginWay: LoginWay; // a text sender, else login_by_email (off)
  pushOn: boolean; // the deployment's VAPID key: phone notifications can be turned on
  rules: BookingRules; // 28.12: the firm's rules for taking shifts
}

// The firm's rules for taking shifts, each from the rules' own parser (pure).
export function bookingRules(settings: Record<string, unknown>): BookingRules {
  let allocation: AllocationFact | null;
  try {
    const parsed = parseAllocationSettings(settings);
    allocation =
      parsed.mode === "fair_rotation"
        ? {
            mode: "fair_rotation",
            priorityMinutes: parsed.priorityMinutes,
            urgentWindowHours: parsed.urgentWindowHours,
          }
        : { mode: "first_come_first_served", waveMinutes: firstComeWaves(settings).minutes };
  } catch {
    // AllocationSettingsError (the only thing it throws): leave the line out.
    allocation = null;
  }
  const rules = rulesSettingsSchema.safeParse(settings);
  return {
    allocation,
    rest: rules.success
      ? { minRestHours: rules.data.min_rest_hours, weeklyHoursCap: rules.data.weekly_hours_cap }
      : null,
    urgentWindowHours: urgentWindowHours(settings),
    quiet: quietHours(settings),
  };
}

// "1 hour", "24 hours", "10.5 hours".
export function hoursText(n: number): string {
  return n === 1 ? "1 hour" : `${n} hours`;
}
const minutesText = (n: number) => (n === 1 ? "1 minute" : `${n} minutes`);
// "11 hours' rest", "1 hour's rest".
const restText = (n: number) => (n === 1 ? "1 hour's rest" : `${n} hours' rest`);

// Each line of "The firm's rules for taking shifts", in the order the topic shows them. A line
// whose fact is null is left out. Never says an offer runs out (none does).
export function bookingRuleLines(
  rules: BookingRules,
  strikes: { on: boolean; noticeHours: number },
): string[] {
  const lines: string[] = [];
  const a = rules.allocation;
  if (a?.mode === "fair_rotation") {
    lines.push(
      `A small group gets first go for ${minutesText(a.priorityMinutes)}, then everyone can take it. The group is the people with the fewest hours that week.`,
    );
    lines.push(
      a.urgentWindowHours > 0
        ? `Urgent shifts, and shifts starting in the next ${hoursText(a.urgentWindowHours)}, are open to everyone straight away.`
        : "Urgent shifts are open to everyone straight away.",
    );
    lines.push(
      `For an urgent shift, we message a small group first. If nobody takes it, more people are offered it after ${minutesText(a.priorityMinutes)}.`,
    );
  } else if (a?.mode === "first_come_first_served") {
    lines.push("The first person to tap Take shift gets the place.");
    lines.push(
      `For an urgent shift, we message a few people first. If nobody takes it, more people are offered it after ${minutesText(a.waveMinutes)}.`,
    );
  }
  // In either mode, a session the office chooses for (Phase 26.6) is never first come or held: it's
  // asked for, and the office decides (src/lib/roster/asks.ts).
  lines.push(
    "Some shifts say “The office chooses”. Tap I can do this, and the office decides who works it.",
  );
  if (rules.rest) {
    if (rules.rest.minRestHours > 0) {
      lines.push(`You need at least ${restText(rules.rest.minRestHours)} between shifts.`);
    }
    lines.push(
      `You can work up to ${hoursText(rules.rest.weeklyHoursCap)} a week, Monday to Sunday.`,
    );
  }
  lines.push(
    rules.urgentWindowHours > 0
      ? `A shift becomes urgent when someone drops out less than ${hoursText(rules.urgentWindowHours)} before it starts. The office can mark a shift urgent too.`
      : "A shift becomes urgent when the office marks it urgent.",
  );
  const q = rules.quiet;
  if (q.start !== q.end) {
    lines.push(
      q.urgentOverride
        ? `Between ${q.start} and ${q.end} we hold shift messages until ${q.end}. Urgent ones still come.`
        : `Between ${q.start} and ${q.end} we hold shift messages until ${q.end}, even urgent ones.`,
    );
  }
  if (strikes.on) {
    lines.push(
      `If you cancel less than ${hoursText(strikes.noticeHours)} before a shift starts, you get a strike.`,
    );
  }
  return lines;
}

// "Why can't I see a shift?": each reason a shift may not show (or not be takeable yet), in plain
// words, with the firm's own numbers where its rules parse. Travel only while travel areas are on;
// the "You can take it from …" line only under fair rotation (first come never holds a shift).
export function whyNotLines(facts: Pick<HelpFacts, "travelOn" | "rules">): string[] {
  const { rest, allocation } = facts.rules;
  return [
    "It's for a role you don't do.",
    "A licence or card it needs is missing, or out of date.",
    ...(facts.travelOn ? ["You can't get there in time from your travel area."] : []),
    "You've marked that day as one you can't work.",
    "You're already booked at that time.",
    // No rest line at 0: the rest check can never fail then (eligibility.ts compares each gap with 0).
    ...(rest === null
      ? ["You'd have too little rest before or after another shift."]
      : rest.minRestHours > 0
        ? [`You'd have less than ${restText(rest.minRestHours)} before or after another shift.`]
        : []),
    rest
      ? `It would take you over ${hoursText(rest.weeklyHoursCap)} that week.`
      : "It would take you over your weekly hours.",
    "The office hasn't opened it to casuals yet.",
    ...(allocation?.mode === "fair_rotation"
      ? [
          "You can see it, but it says “You can take it from …”? A small group gets first go. At that time, tap Check again.",
        ]
      : []),
  ];
}

export async function helpFacts(
  firmId: string,
  run: WithFirm = withFirm,
  textSender: boolean = hasTextSender(),
  push: boolean = appEnv().VAPID_PUBLIC_KEY != null,
): Promise<HelpFacts> {
  return run(firmId, async (tx) => {
    const [firm] = await tx
      .select({ settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, firmId));
    const settings = firm?.settings ?? {};
    const strikes = strikeSettings(settings);
    return {
      noticeHours: strikes.noticeHours,
      liveDays: strikes.liveDays,
      photoRenewalMonths: photoSettings(settings).renewalMonths,
      travelOn: travelSettings(settings).enabled,
      strikesOn: strikes.enabled,
      loginWay: loginWay(textSender, settings),
      pushOn: push,
      rules: bookingRules(settings),
    };
  });
}
