import { z } from "zod";

// Each office user's own dashboard (Phase 26.3; the spec page's "Customise and contracts", cus-3
// and cus-4, and the pre-build audit's aud-13): which cards they see, saved to them (not to a
// browser), and the contracts they look after. The cards in the order the dashboard shows them;
// the first four are on until someone turns them off. Plain data and functions, so the tests read
// every line.

export const DASHBOARD_CARDS = [
  "map",
  "toOffer",
  "updates",
  "whoWorked",
  "nextTwoWeeks",
  "cancellations",
  "fillRate",
  "noShows",
] as const;
export type DashboardCard = (typeof DASHBOARD_CARDS)[number];

export const DEFAULT_CARDS: readonly DashboardCard[] = ["map", "toOffer", "updates", "whoWorked"];

// What "What you see" calls each card, and the line under it.
export const CARD_WORDS: Record<DashboardCard, { name: string; line: string }> = {
  map: { name: "Venue map", line: "Places to fill at each venue" },
  toOffer: { name: "To offer", line: "Sessions with places" },
  updates: { name: "Updates", line: "Cancellations and to-dos" },
  whoWorked: { name: "Who worked?", line: "To confirm after a session" },
  nextTwoWeeks: { name: "Next 2 weeks", line: "Booked, offered and open places each day" },
  cancellations: { name: "Cancellations", line: "By week, under 48 hours in red" },
  fillRate: { name: "Fill rate", line: "Booked of needed, per contract" },
  noShows: { name: "No-shows", line: "By week" },
};

// What's saved: a set of known cards (unknown ones dropped, each once, in the dashboard's order).
// Nothing saved, or nothing readable: the defaults.
const saved = z.array(z.string().max(40)).max(40);
export function readCards(value: unknown): DashboardCard[] {
  const parsed = saved.safeParse(value);
  if (!parsed.success) return [...DEFAULT_CARDS];
  const set = new Set(parsed.data);
  return DASHBOARD_CARDS.filter((c) => set.has(c));
}
