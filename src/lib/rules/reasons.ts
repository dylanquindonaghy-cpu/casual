// The reasons a worker sees when a shift is blocked (docs/rules-and-credentials.md, docs/screens.md
// copy rules: short sentences, plain words, say what to do next).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// "2026-10-03" -> "3 Oct" (or "3 Oct 2025" when not the shift's year).
export function shortDate(isoDate: string, shiftYear: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const text = `${d} ${MONTHS[(m ?? 1) - 1]}`;
  return y === shiftYear ? text : `${text} ${y}`;
}

// "Sat 7 Nov" for a local date.
export function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const weekday = (new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7;
  return `${DAYS[weekday]} ${d} ${MONTHS[(m ?? 1) - 1]}`;
}

const roleName = (role: string) => role.replace(/_/g, " ");
const withArticle = (noun: string) => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
const hours = (h: number) =>
  `${Number.isInteger(h) ? String(h) : h.toFixed(1)} ${h === 1 ? "hour's" : "hours'"}`;

export const REASONS = {
  started: () => "This shift has already started.",
  not_active: () => "Your account isn't active. Contact the office.",
  wrong_role: (role: string) => `This shift needs ${withArticle(roleName(role))}.`,
  no_rule: () => "This shift isn't ready to take yet. Ask the office.",
  credential_missing: (name: string) =>
    `This shift needs a valid ${name}. Send it to the office to be checked.`,
  credential_expired: (name: string, date: string, alreadyExpired: boolean) =>
    alreadyExpired
      ? `Your ${name} expired on ${date}. Renew it, then send the new number to the office.`
      : `Your ${name} expires on ${date}, before this shift. Renew it, then send the new number to the office.`,
  credential_marked_expired: (name: string) =>
    `Your ${name} is marked as expired. Renew it, then send the new number to the office.`,
  credential_suspended: (name: string) => `Your ${name} is suspended. Contact the office.`,
  applied_not_allowed: (name: string) =>
    `Your ${name} is still being processed. This shift needs a valid one. Send it to the office when you have it.`,
  applied_over_allowance: (name: string) =>
    `Your ${name} is still being processed. Only a few people waiting for theirs can work each day, and today's places are taken.`,
  overlap: (time: string, day: string | null) =>
    day
      ? `You're already booked at ${time} on ${day}.`
      : `You're already booked at ${time} that day.`,
  travel: (time: string) => `This is too close to your booking at ${time} to travel between them.`,
  rest: (which: "previous" | "next", restHours: number) =>
    `This is too close to your ${which} shift (${hours(restHours)} rest needed).`,
  weekly_hours: () => "This would take you over your weekly hours limit.",
  unavailable: () =>
    "You've marked yourself unavailable that day. Change it in your profile to take this shift.",
  blocked_site: () => "This site isn't available to you. Contact the office.",
} as const;
