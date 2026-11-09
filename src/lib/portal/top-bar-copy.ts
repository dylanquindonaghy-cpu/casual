// The casual app's top bar's words (Phase 32, 32.1; docs/screens.md "## Phase 32"). Browser-safe:
// no imports.

// The bell opens My requests, where the office's answers to her requests are (they're marked seen
// there: src/app/requests/answers-seen.tsx). Its name says what it opens and how many she hasn't
// seen: "Answers from the office", "Answers from the office, 1 new", "…, 2 new" (never "My requests":
// that's Profile's own row to the same page).
export const BELL_HREF = "/requests";
export const bellWords = (n: number): string =>
  n <= 0 ? "Answers from the office" : `Answers from the office, ${n} new`;
// The number on the bell: at most "99+".
export const bellNumber = (n: number): string => (n > 99 ? "99+" : String(n));

// Her initials on her round badge: first and last name's first letters ("Zoe Adeyemi" → "ZA").
export function barInitials(firstName: string, lastName: string): string {
  const first = (s: string) => s.match(/\p{L}/u)?.[0]?.toUpperCase() ?? "";
  return first(firstName) + first(lastName) || "?";
}
