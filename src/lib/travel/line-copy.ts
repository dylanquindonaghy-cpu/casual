import { wallTimeOf } from "../time/zoned";

// A shift's travel line in words (docs/office-v2.md 4.3, 5.4; 12G.2; shown on the casual's pages by
// 12G.3). Pure.
//
// In the casual app (`travelLineText`: Open shifts, the urgent board, Booked, Home's pass and the
// shift page, the one source of these words, the pass's figure tiles included; Phase 28, 28.8):
// - Worked out: "7.2 miles · 18 min by car · 41 min by public transport"; with no public transport
//   in time, "… · no public transport by 09:30" (the arrive-by time, the firm's clock); beyond the
//   90-minute ceiling by car, "over 90 min by car".
// - Not worked out yet, or the travel service is down, but both points known, one sentence: "About
//   7 miles away. Travel time isn't worked out yet." (28.8: the review found "(straight line)" and
//   "not known" read as values.)
// - No travel area, or a site with no location: "Distance not known yet".
//
// On the shifts line (`travelLineCompact`: the WhatsApp and text replies, src/lib/inbound/
// personal-reply.ts), the same facts in the line's own short form, unchanged by 28.8: "about 7
// miles (straight line) · Travel time not known yet" while the time isn't worked out.

export type TravelFacts =
  | { kind: "unknown" }
  | { kind: "straight"; straightMetres: number }
  | {
      kind: "estimated";
      straightMetres: number;
      arriveBy: Date;
      car: { minutes: number; metres: number | null } | null; // null: over 90 minutes
      publicTransport: { minutes: number } | null; // null: not in time
    };

const METRES_PER_MILE = 1609.344;

const roadMiles = (metres: number) => `${(metres / METRES_PER_MILE).toFixed(1)} miles`;
// Whole miles in a straight line, at least 1.
const wholeMiles = (metres: number) => {
  const miles = Math.max(1, Math.round(metres / METRES_PER_MILE));
  return `${miles} ${miles === 1 ? "mile" : "miles"}`;
};
export const straightMiles = (metres: number) => `about ${wholeMiles(metres)} (straight line)`;
// "About 2 miles away": the straight line, in the casual app's sentence (28.8).
export const milesAway = (metres: number) => `About ${wholeMiles(metres)} away`;
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
};

export const DISTANCE_NOT_KNOWN = "Distance not known yet";
export const TIME_NOT_KNOWN = "Travel time not known yet";
// The casual app's words while only the straight line is known (28.8).
export const TIME_NOT_WORKED_OUT = "Travel time isn't worked out yet.";
// "About 2 miles away. Travel time isn't worked out yet.": the casual app's one sentence while only
// the straight line is known, in the travel line and in place of the figure tiles on Home's pass
// (src/lib/portal/home-copy.ts `travelStrip`; 28.8).
export const notWorkedOutText = (straightMetres: number) =>
  `${milesAway(straightMetres)}. ${TIME_NOT_WORKED_OUT}`;

// Worked out: the distance, by car and by public transport (the same in the app and on the line).
function estimatedText(f: Extract<TravelFacts, { kind: "estimated" }>, tz: string): string {
  const distance =
    f.car?.metres != null ? roadMiles(f.car.metres) : straightMiles(f.straightMetres);
  const car = f.car ? `${f.car.minutes} min by car` : "over 90 min by car";
  const transport = f.publicTransport
    ? `${f.publicTransport.minutes} min by public transport`
    : `no public transport by ${hhmm(f.arriveBy, tz)}`;
  return `${distance} · ${car} · ${transport}`;
}

// The casual app's travel line.
export function travelLineText(f: TravelFacts, tz: string): string {
  if (f.kind === "unknown") return DISTANCE_NOT_KNOWN;
  if (f.kind === "straight") return notWorkedOutText(f.straightMetres);
  return estimatedText(f, tz);
}

// The shifts line's travel words (WhatsApp and text replies): its own short form, "·" between
// the parts (a text turns them into commas).
export function travelLineCompact(f: TravelFacts, tz: string): string {
  if (f.kind === "unknown") return DISTANCE_NOT_KNOWN;
  if (f.kind === "straight") return `${straightMiles(f.straightMetres)} · ${TIME_NOT_KNOWN}`;
  return estimatedText(f, tz);
}
