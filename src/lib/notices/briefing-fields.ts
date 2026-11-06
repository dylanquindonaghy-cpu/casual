// A session's briefing (Phase 28.2): the details a booked casual works from, and so the only
// changes she is told about (28.3's notice) or shown as "Changed since you booked" (28.5). The
// names are the ones every writer of `shift.changed` gives its `fields` (the office's editor,
// src/lib/office/shift-editor.ts DETAIL_FIELDS; the planner, src/lib/integrations/sessions.ts; the
// rota sheet and a file import name `instructions` the same way), each with the casual's word.
//
// A closed list. Never in it: places (headcount: other people's bookings), the event's name, the
// times or the site (a move is the firm's own change, told with its notice hours:
// src/lib/roster/firm-change.ts), and the rota sheet's override codes (they name other casuals).
// Pure and browser-safe: no imports.

export const BRIEFING_FIELDS = [
  "instructions",
  "meetingPoint",
  "uniform",
  "post",
  "payRatePence",
  "requirements",
] as const;
export type BriefingField = (typeof BRIEFING_FIELDS)[number];

export const BRIEFING_WORDS: Readonly<Record<BriefingField, string>> = {
  instructions: "instructions",
  meetingPoint: "meeting point",
  uniform: "uniform",
  post: "post",
  payRatePence: "pay",
  requirements: "what you need",
};

export const isBriefingField = (field: unknown): field is BriefingField =>
  typeof field === "string" && (BRIEFING_FIELDS as readonly string[]).includes(field);

// The briefing fields among a `shift.changed` entry's `fields` (anything: it comes from the log),
// each once, in the list's order. Everything else is dropped.
export function briefingFieldsOf(fields: unknown): BriefingField[] {
  if (!Array.isArray(fields)) return [];
  const named = new Set(fields.filter(isBriefingField));
  return BRIEFING_FIELDS.filter((f) => named.has(f));
}

// "instructions", "instructions and pay", "meeting point, uniform and pay": the casual's words, in
// the list's order. Empty when none.
export function briefingWords(fields: readonly BriefingField[]): string {
  const words = BRIEFING_FIELDS.filter((f) => fields.includes(f)).map((f) => BRIEFING_WORDS[f]);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}
