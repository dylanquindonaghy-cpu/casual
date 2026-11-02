import type { CancelWeek, ContractFill, DayPlaces, NoShowWeek } from "./dashboard-cards-data";

// The dashboard's extra cards in words (Phase 26.3): each card's title, the line saying where its
// figures come from and when (the pre-build audit's aud-9), its empty state saying what will show
// (aud-10), and its table's words (the figures one tap away). Plain functions, so the tests read
// every line.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "Tue 3" and "3 Nov" for a yyyy-mm-dd day.
export function dayLabel(day: string): string {
  const [y = 2000, m = 1, d = 1] = day.split("-").map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
}
// "Tue 3 Nov".
export function dayMonthLabel(day: string): string {
  const [, m = 1] = day.split("-").map(Number);
  return `${dayLabel(day)} ${MONTHS[m - 1]}`;
}
export function weekLabel(monday: string): string {
  const [, m = 1, d = 1] = monday.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export const SHOW_TABLE = "Show as a table";

export const NEXT_TWO_WEEKS = {
  title: "Next 2 weeks",
  source: "Places on sessions to come, counted now",
  key: { booked: "Booked", offered: "Offered, no reply yet", open: "Open" },
  empty: "No sessions in the next 2 weeks. Sessions from your planner show here as they come in.",
  heads: ["Day", "Booked", "Offered", "Open"],
};
export const nextTwoWeeksSummary = (days: DayPlaces[]) => {
  const t = days.reduce(
    (s, d) => ({
      booked: s.booked + d.booked,
      offered: s.offered + d.offered,
      open: s.open + d.open,
    }),
    { booked: 0, offered: 0, open: 0 },
  );
  return `Next 2 weeks: ${t.booked} booked, ${t.offered} offered with no reply yet, ${t.open} open.`;
};

export const CANCELLATIONS_CARD = {
  title: "Cancellations",
  source: "From the cancellation records, by the week they were made",
  key: { short: "Under 48 hours' notice", longer: "48 hours or more" },
  empty: "No cancellations in the last 8 weeks. Each one shows here, by week.",
  heads: ["Week of", "Under 48 hours", "48 hours or more"],
};
export const cancellationsSummary = (weeks: CancelWeek[]) => {
  const short = weeks.reduce((n, w) => n + w.short, 0);
  const all = weeks.reduce((n, w) => n + w.short + w.longer, 0);
  return `${plural(all, "cancellation", "cancellations")} in the last 8 weeks, ${short} under 48 hours' notice.`;
};

export const NO_SHOWS_CARD = {
  title: "No-shows",
  source: "People marked as not attending, by the week of the session",
  empty: "No no-shows in the last 8 weeks. Anyone marked as not attending shows here, by week.",
  heads: ["Week of", "No-shows"],
};
export const noShowsSummary = (weeks: NoShowWeek[]) =>
  `${plural(
    weeks.reduce((n, w) => n + w.noShows, 0),
    "no-show",
    "no-shows",
  )} in the last 8 weeks.`;

export const WATCH_CARD = {
  title: "Watch list",
  source: "Reliability over the last 90 days, of casuals booked in the next 14 days",
  empty:
    "Nobody booked in the next 14 days is under 90%. Anyone who is shows here, least reliable first.",
  heads: ["Casual", "Reliability", "Next booked"],
};
export const watchSummary = (n: number) =>
  n === 0 ? "" : `${plural(n, "casual", "casuals")} booked soon under 90% reliable.`;

export const FILL_RATE_CARD = {
  title: "Fill rate",
  source: "Places booked of places needed, next 14 days, counted now",
  empty: "No sessions in the next 14 days. Each contract's places show here.",
  heads: ["Contract", "Booked", "Needed", "Filled"],
  none: "No contract",
};
export const fillPercent = (f: Pick<ContractFill, "booked" | "needed">) =>
  f.needed === 0 ? 0 : Math.round((f.booked / f.needed) * 100);
export const fillLine = (f: ContractFill) =>
  `${f.name ?? FILL_RATE_CARD.none}: ${f.booked} of ${f.needed} booked, ${fillPercent(f)}%`;
