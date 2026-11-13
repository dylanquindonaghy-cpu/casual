// The answer library's fill-ins (Phase 35; docs/screens.md "## Phase 35", "Fill-ins"): the only
// facts an answer's words may hold, each written as {key} in the answer and filled in by code from
// the firm's data for the casual who asked (src/lib/answers/facts.ts), never by the AI. A fixed
// list: an answer naming any other {word} is refused (src/lib/answers/validate.ts). Browser-safe
// (the office's fill-in picker lists them): no imports.

export const FILL_IN_KEYS = [
  "first_name",
  "next_pay_day",
  "pay_cycle",
  "next_shift",
  "next_shift_instructions",
  "licence_expiry",
  "pay_link",
  "profile_link",
  "shifts_link",
] as const;
export type FillInKey = (typeof FILL_IN_KEYS)[number];

export interface FillIn {
  key: FillInKey;
  label: string; // the office's name for it (the picker's chip)
  example: string; // what it looks like for a made-up casual (the office's preview)
  hint: string; // where it comes from, and when there's none
}

export const FILL_INS: readonly FillIn[] = [
  {
    key: "first_name",
    label: "First name",
    example: "Zoe",
    hint: "Their first name, as you hold it.",
  },
  {
    key: "next_pay_day",
    label: "Next pay day",
    example: "Friday 20 November",
    hint: "The next pay day not yet past (last week's while it's still to come), from your pay calendar, or payroll's own date where it's on her own pay record.",
  },
  {
    key: "pay_cycle",
    label: "That pay cycle",
    example: "Mon 9 to Sun 15 Nov",
    hint: "The days that pay day covers.",
  },
  {
    key: "next_shift",
    label: "Next shift",
    example: "Steward, Sat 14 Nov, 14:00 to 22:00 at Riverside Arena",
    hint: "Their next booked shift. None booked: the answer isn't sent, the office gets the question.",
  },
  {
    key: "next_shift_instructions",
    label: "Its instructions",
    example: "Uniform: black trousers, hi-vis. Meet at gate B at 13:30.",
    hint: "The uniform, meeting point and instructions on their next shift (at most 300 characters). None: the office gets the question.",
  },
  {
    key: "licence_expiry",
    label: "Licence expiry",
    example: "SIA door supervisor licence runs to 1 December 2026",
    hint: "Their qualification that runs out soonest, and when. None with a date: the office gets the question.",
  },
  {
    key: "pay_link",
    label: "Link to Pay",
    example: "https://acme.shiftdesk.example/pay",
    hint: "Their pay page (hours, rates and pay dates).",
  },
  {
    key: "profile_link",
    label: "Link to Profile",
    example: "https://acme.shiftdesk.example/profile",
    hint: "Their profile, where they add a new licence or card.",
  },
  {
    key: "shifts_link",
    label: "Link to Shifts",
    example: "https://acme.shiftdesk.example/shifts",
    hint: "Their shifts.",
  },
];

export const isFillInKey = (key: string): key is FillInKey =>
  (FILL_IN_KEYS as readonly string[]).includes(key);

// Every {word} in an answer's words, in order, repeats kept ("{next_shift}" → "next_shift"). A
// word of letters, digits and underscores only; a lone brace isn't a fill-in.
const TOKEN = /\{([A-Za-z0-9_]+)\}/g;
export function tokensIn(body: string): string[] {
  return [...body.matchAll(TOKEN)].map((m) => m[1] ?? "");
}

// The fill-ins an answer needs (known keys only, once each, in the list's order).
export function fillInsNeeded(body: string): FillInKey[] {
  const used = new Set(tokensIn(body));
  return FILL_IN_KEYS.filter((k) => used.has(k));
}
