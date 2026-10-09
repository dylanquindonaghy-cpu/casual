import { z } from "zod";

// The pilot's figures (docs/pilot-playbook.md), browser-safe: the forms use these too. No database
// code may be imported here (tests/unit/client-boundary.test.ts).

// The playbook's week-0 baseline, entered by the office.
export const BASELINE_METRICS = {
  emails_per_day: { label: "Staff emails per day", max: 100_000 },
  calls_per_day: { label: "Calls per day", max: 100_000 },
  whatsapp_per_day: { label: "WhatsApp messages per day", max: 100_000 },
  unanswered_pct: { label: "Shift queries unanswered after 24 hours (%)", max: 100 },
  refill_minutes: { label: "Time to refill a cancellation (median, in minutes)", max: 100_000 },
  no_shows_per_week: { label: "No-shows per week", max: 100_000 },
  resourcer_hours_per_week: { label: "Resourcer hours on staff admin per week", max: 168 },
  short_notice_per_week: {
    label: "Short-notice cancellations per week (firm and worker)",
    max: 100_000,
  },
} as const;
export type BaselineMetric = keyof typeof BASELINE_METRICS;
export const BASELINE_KEYS = Object.keys(BASELINE_METRICS) as BaselineMetric[];

// What the office still counts itself during the pilot (the app can't see its inbox or phone).
export const TALLY_KEYS = [
  "emails_per_day",
  "calls_per_day",
  "whatsapp_per_day",
  "resourcer_hours_per_week",
] as const satisfies readonly BaselineMetric[];
export type TallyMetric = (typeof TALLY_KEYS)[number];

// The nightly rollup's counts for one firm-local day (src/lib/metrics/rollup.ts).
export const DAILY_METRICS = [
  "worker_logins", // workers who logged in (each counted once a day)
  "portal_actions", // workers doing it themselves: taking or cancelling shifts, days off, settings, pay page
  "requests_created", // requests for the office (not portal actions: someone has to answer them)
  "requests_due", // made that day and answered, or 24 hours old (whether answered in time is known)
  "requests_slow", // of those, not answered within 24 hours
  "worker_cancellations",
  "firm_cancellations",
  "short_notice_cancellations", // either kind, under the firm's short-notice threshold
  "urgent_shifts", // shifts marked urgent
  "urgent_filled_by_wave", // urgent shifts a worker took from an offer wave
  "no_shows", // bookings marked not attended, by the shift's day
] as const;
export type DailyMetric = (typeof DAILY_METRICS)[number];

// A form's figure: blank (leave it as it is) or a number from 0 to the metric's maximum, with at
// most 2 decimal places.
export function figureSchema(max: number) {
  return z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || /^\d+(\.\d{1,2})?$/.test(v), "a number, like 12 or 3.5")
    .refine((v) => v === "" || Number(v) <= max, `at most ${max}`);
}

export const isoDay = z
  .string()
  .regex(/^(20\d\d|2100)-\d{2}-\d{2}$/)
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, "a real date");
