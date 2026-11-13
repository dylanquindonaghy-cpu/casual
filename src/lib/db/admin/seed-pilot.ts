import { BASELINE_KEYS, TALLY_KEYS, type BaselineMetric } from "../../metrics/definitions";
import { addDays, localDateOf, mondayOf, zonedToUtc } from "../../time/zoned";

// The pilot's own figures for the demo (Phase 37.8, w1-12; docs/pilot-playbook.md): the week-0
// baseline the office would enter, and its weekly tallies of what the app can't see (emails, calls,
// WhatsApp messages, resourcer hours), falling gently as the pilot goes on. Made-up round numbers
// (golden rule 7). A pure builder, loaded by seed-demo-extras.ts: the baseline for the Monday 5
// weeks back, saved the Monday after it; a tally for each of the 4 Mondays since, saved the Monday
// after its week (never after the seed's now). Each is the office's own save, by the firm's admin.

const TZ = "Europe/London";

export const PILOT_BASELINE: Record<BaselineMetric, number> = {
  emails_per_day: 60,
  calls_per_day: 45,
  whatsapp_per_day: 120,
  unanswered_pct: 20,
  refill_minutes: 180,
  no_shows_per_week: 4,
  resourcer_hours_per_week: 30,
  short_notice_per_week: 6,
};

// Weeks 1 to 4 of the pilot, oldest first.
const TALLIES: Record<(typeof TALLY_KEYS)[number], number[]> = {
  emails_per_day: [52, 44, 37, 31],
  calls_per_day: [40, 34, 29, 25],
  whatsapp_per_day: [104, 88, 73, 61],
  resourcer_hours_per_week: [27, 24, 21, 19],
};

export interface PilotSave {
  kind: "baseline" | "tally";
  weekStart: string; // the week's Monday, yyyy-mm-dd
  savedAt: Date;
  figures: { metric: BaselineMetric; value: number }[];
  recordedBy: string;
}

export function acmePilotFigures(now: Date, adminId: string): PilotSave[] {
  const monday = mondayOf(localDateOf(now, TZ));
  const savedOn = (weekStart: string) => {
    const [year = 2000, month = 1, day = 1] = addDays(weekStart, 7).split("-").map(Number);
    const at = zonedToUtc({ year, month, day, hour: 10, minute: 0 }, TZ);
    return new Date(Math.min(at.getTime(), now.getTime()));
  };
  const baselineWeek = addDays(monday, -35);
  const saves: PilotSave[] = [
    {
      kind: "baseline",
      weekStart: baselineWeek,
      savedAt: savedOn(baselineWeek),
      figures: BASELINE_KEYS.map((metric) => ({ metric, value: PILOT_BASELINE[metric] })),
      recordedBy: adminId,
    },
  ];
  for (let week = 1; week <= 4; week++) {
    const weekStart = addDays(baselineWeek, 7 * week);
    saves.push({
      kind: "tally",
      weekStart,
      savedAt: savedOn(weekStart),
      figures: TALLY_KEYS.map((metric) => ({ metric, value: TALLIES[metric][week - 1] ?? 0 })),
      recordedBy: adminId,
    });
  }
  return saves;
}
