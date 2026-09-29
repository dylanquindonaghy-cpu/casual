import type { SaveFiguresResult, UpdateNowResult } from "../metrics/entry";
import { BASELINE_METRICS } from "../metrics/definitions";
import type { PilotReport } from "./pilot-report";

// The pilot metrics page in plain words (docs/screens.md `/office/reports/pilot`), with the
// playbook's targets (docs/pilot-playbook.md).

export interface PilotRow {
  label: string;
  baseline: string;
  now: string;
  target: string;
}

const NOT_ENTERED = "Not entered";
const NONE_YET = "None yet";
const NO_TALLY = "No tally for these dates";
const round1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-GB");
const pct = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 100);

// "2 hours 30 minutes", "45 minutes", "3 days 2 hours".
export function durationWords(minutes: number): string {
  const total = Math.round(minutes);
  const dayCount = Math.floor(total / (24 * 60));
  const hours = Math.floor((total % (24 * 60)) / 60);
  const mins = total % 60;
  const part = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (dayCount > 0)
    return hours > 0 ? `${part(dayCount, "day")} ${part(hours, "hour")}` : part(dayCount, "day");
  if (hours > 0)
    return mins > 0 ? `${part(hours, "hour")} ${part(mins, "minute")}` : part(hours, "hour");
  return part(mins, "minute");
}

export function pilotRows(r: PilotReport): PilotRow[] {
  const b = r.baseline.values;
  const t = r.tally.values;
  const d = r.daily.sums;
  const perWeek = (total: number) => round1((total / r.days) * 7);
  const counted = r.daily.daysCounted > 0;

  const messagesBaseline = ["emails_per_day", "calls_per_day", "whatsapp_per_day"] as const;
  const sumOf = (values: Partial<Record<string, number>>) => {
    const got = messagesBaseline.filter((k) => values[k] !== undefined);
    return got.length === 0 ? null : got.reduce((sum, k) => sum + (values[k] ?? 0), 0);
  };
  const baselineMessages = sumOf(b);
  const tallyMessages = sumOf(t);

  // Only requests whose 24 hours are up (or that were answered) can be late or not.
  const unanswered = pct(d.requests_slow, d.requests_due);
  const instant = pct(d.portal_actions, d.portal_actions + d.requests_created);
  const urgentFill = pct(r.live.urgentFilledByWave, r.live.urgentShifts);
  const adoption = pct(r.live.activeLoggedIn, r.live.activeWorkers);

  return [
    {
      label: "Messages in per day (emails, calls and WhatsApp)",
      baseline: baselineMessages === null ? NOT_ENTERED : round1(baselineMessages),
      now: tallyMessages === null ? NO_TALLY : round1(tallyMessages),
      target: "Half the baseline",
    },
    {
      label: "Shift queries unanswered after 24 hours",
      baseline: b.unanswered_pct === undefined ? NOT_ENTERED : `${round1(b.unanswered_pct)}%`,
      now: !counted ? NONE_YET : unanswered === null ? "No requests yet" : `${unanswered}%`,
      target: "Under 2%",
    },
    {
      label: "Portal actions (staff doing it themselves)",
      baseline: "Before the app",
      now: !counted ? NONE_YET : `${d.portal_actions} (${round1(d.portal_actions / r.days)} a day)`,
      target: "",
    },
    {
      label: "Answered straight away",
      baseline: "Before the app",
      now: !counted ? NONE_YET : instant === null ? "Nothing asked" : `${instant}%`,
      target: "90% or more",
    },
    {
      label: "Time to refill a cancellation (median)",
      baseline: b.refill_minutes === undefined ? NOT_ENTERED : durationWords(b.refill_minutes),
      now:
        r.live.refillMedianMinutes === null
          ? "No refilled cancellations"
          : `${durationWords(r.live.refillMedianMinutes)} (${r.live.refills} refilled)`,
      target: "Half the baseline",
    },
    {
      label: "Active workers (booked on a shift in these dates)",
      baseline: "",
      now: String(r.live.activeWorkers),
      target: "",
    },
    {
      label: "Portal adoption (active workers who have logged in)",
      baseline: "",
      now:
        adoption === null
          ? "No active workers"
          : `${adoption}% (${r.live.activeLoggedIn} of ${r.live.activeWorkers})`,
      target: "50% (stretch 75%)",
    },
    {
      label: "Urgent shifts filled from offers",
      baseline: "",
      now:
        urgentFill === null
          ? "No urgent shifts"
          : `${urgentFill}% (${r.live.urgentFilledByWave} of ${r.live.urgentShifts})`,
      target: "60% or more without a call",
    },
    {
      label: "No-shows per week",
      baseline: b.no_shows_per_week === undefined ? NOT_ENTERED : round1(b.no_shows_per_week),
      now: !counted ? NONE_YET : perWeek(d.no_shows),
      target: "Fewer than the baseline",
    },
    {
      label: "Short-notice cancellations per week (firm and worker)",
      baseline:
        b.short_notice_per_week === undefined ? NOT_ENTERED : round1(b.short_notice_per_week),
      now: !counted ? NONE_YET : perWeek(d.short_notice_cancellations),
      target: "",
    },
    {
      label: "Resourcer hours on staff admin per week",
      baseline:
        b.resourcer_hours_per_week === undefined ? NOT_ENTERED : round1(b.resourcer_hours_per_week),
      now: t.resourcer_hours_per_week === undefined ? NO_TALLY : round1(t.resourcer_hours_per_week),
      target: "15 to 20% fewer (30% in busy weeks)",
    },
  ];
}

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };
const COMMON: Record<Common["status"], string> = {
  logged_out: "Your session has ended. Log in again.",
  not_allowed: "You can't change the pilot figures.",
  error: "Something went wrong. Try again.",
};

export function saveFiguresText(
  result: SaveFiguresResult | Common | { status: "bad_date" },
  kind: "baseline" | "tally",
): string {
  switch (result.status) {
    case "saved":
      return kind === "baseline" ? "Baseline saved." : "This week's tally saved.";
    case "invalid":
      return `Check these: ${result.problems.map((p) => BASELINE_METRICS[p].label).join("; ")}. Each is a number, like 12 or 3.5.`;
    case "nothing":
      return "Fill in at least one figure.";
    case "bad_date":
      return kind === "baseline" ? "Choose the week's first day." : "Choose a day in the week.";
    default:
      return COMMON[result.status];
  }
}

export function updateNowText(result: UpdateNowResult | Common): string {
  return result.status === "updated" ? "Figures updated." : COMMON[result.status];
}
