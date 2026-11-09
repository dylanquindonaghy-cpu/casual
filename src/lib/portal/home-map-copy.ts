// Home's words for Phase 32 (32.2; docs/screens.md "## Phase 32"): the title row, the map, its tabs
// and the card over it. Browser-safe: no imports but the date helpers.
import { datePartsOfDay } from "./sign-copy";

export const HOME_TITLE = "Home";
// The date line under it: "Monday 9 November · Pay day Fri 20 Nov".
export const payDayText = (payDay: string) => {
  const p = datePartsOfDay(payDay);
  return `Pay day ${p.dow} ${p.day} ${p.month}`;
};
// The title row's two ways on (from 1024px; the same pages as the tab bar's).
export const TITLE_LINKS = [
  { href: "/shifts/open", words: "Shifts you can take", icon: "search" },
  { href: "/shifts", words: "My week", icon: "shifts" },
] as const;

// --- The map ---------------------------------------------------------------------------------------
// Its name (never containing "Shifts you can take", the section's own name further down Home).
export const MAP_TITLE = "Map of your shift and open shifts";
export const TABS_LABEL = "Show on the map";
export const TAB_WORDS = {
  all: "All",
  urgent: "Urgent",
  this: "This week",
  next: "Next week",
} as const;
export const MAP_KEY = {
  mine: "Your shift",
  open: "Shifts you can take",
  urgent: "Urgent",
} as const;
export const MAP_KEY_LABEL = "Key";
export const MAP_EMPTY = "No places to show on the map yet.";
export const MAP_CREDIT = "© OpenStreetMap contributors";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

// A pin's days: "Tue 17", "Wed 11, Mon 16", "Wed 11, Mon 16 and 2 more".
export function mapDaysText(days: readonly string[]): string {
  const sorted = [...new Set(days)].sort();
  const words = sorted.slice(0, 2).map((d) => {
    const p = datePartsOfDay(d);
    return `${p.dow} ${p.day}`;
  });
  const more = sorted.length - words.length;
  return more > 0 ? `${words.join(", ")} and ${more} more` : words.join(", ");
}

// A pin's name, read out: "Your shift: Riverside Demo Park, Thu 12"; "Northgate Demo Common: 2
// shifts you can take, 1 urgent, Tue 17".
export function pinWords(o: {
  mine: boolean;
  name: string;
  count: number;
  urgent: number;
  days: readonly string[];
}): string {
  const days = mapDaysText(o.days);
  if (o.mine) return `${MAP_KEY.mine}: ${o.name}, ${days}`;
  const urgent = o.urgent > 0 ? `, ${o.urgent} urgent` : "";
  return `${o.name}: ${plural(o.count, "shift you can take", "shifts you can take")}${urgent}, ${days}`;
}

// --- The card over the map ---------------------------------------------------------------------
export const NEXT_TITLE = "Your next shift";
export const ON_NOW_TITLE = "On now";
// Beside it when she has more than one booking: "1 of 3" (the others are on Booked).
export const nextOfText = (n: number) => `1 of ${n}`;
export const QUALS_TILE = "Your qualifications";
export const qualsFigure = (valid: number, all: number) => `${valid} of ${all}`;
export const CAN_TAKE_TILE = "Shifts you can take";
export const urgentBadge = (n: number) => `${n} urgent`;

// Nothing booked.
export const EMPTY_TITLE = "No shifts booked";
export const emptyOnMap = (n: number) =>
  n === 1 ? "1 shift you can take is on the map." : `${n} shifts you can take are on the map.`;
export const EMPTY_NONE = "Take a shift and it shows up here, with the time and the gate.";
export const nearestText = (
  by: "distance" | "time",
  day: { dow: string; day: string; month: string },
) => `${by === "distance" ? "Nearest" : "Soonest"}: ${day.dow} ${day.day} ${day.month}`;
export const SEE_SHIFTS = "See shifts you can take";
// Shifts to see, but none she can take this minute (held by fair rotation, or ask only).
export const NEAREST_NONE = "None you can take straight away yet.";
