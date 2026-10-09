import { wallTimeOf } from "../time/zoned";

// A shift's travel line in words (docs/office-v2.md 4.3, 5.4; 12G.2; shown on the casual's pages by
// 12G.3). Pure.
//
// - Worked out: "7.2 miles · 18 min by car · 41 min by public transport"; with no public transport
//   in time, "… · no public transport by 09:30" (the arrive-by time, the firm's clock); beyond the
//   90-minute ceiling by car, "over 90 min by car".
// - Not worked out yet, or the travel service is down, but both points known: "about 7 miles
//   (straight line) · Travel time not known yet".
// - No travel area, or a site with no location: "Distance not known yet".

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
export const straightMiles = (metres: number) => {
  const miles = Math.max(1, Math.round(metres / METRES_PER_MILE));
  return `about ${miles} ${miles === 1 ? "mile" : "miles"} (straight line)`;
};
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
};

export const DISTANCE_NOT_KNOWN = "Distance not known yet";
export const TIME_NOT_KNOWN = "Travel time not known yet";

export function travelLineText(f: TravelFacts, tz: string): string {
  if (f.kind === "unknown") return DISTANCE_NOT_KNOWN;
  if (f.kind === "straight") return `${straightMiles(f.straightMetres)} · ${TIME_NOT_KNOWN}`;
  const distance =
    f.car?.metres != null ? roadMiles(f.car.metres) : straightMiles(f.straightMetres);
  const car = f.car ? `${f.car.minutes} min by car` : "over 90 min by car";
  const transport = f.publicTransport
    ? `${f.publicTransport.minutes} min by public transport`
    : `no public transport by ${hhmm(f.arriveBy, tz)}`;
  return `${distance} · ${car} · ${transport}`;
}
