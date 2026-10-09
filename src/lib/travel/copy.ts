import type { TravelMode } from "./modes";

// A travel area in words (docs/office-v2.md 3.7, 4.6; 12G.1). Pure, so the browser can use it.

export const TRAVEL_MODE_WORDS: Record<TravelMode, string> = {
  car: "Car",
  public_transport: "Public transport",
  both: "Both",
};

// "car", "public transport", "car or public transport".
export const travelModesText = (modes: TravelMode) =>
  modes === "both" ? "car or public transport" : modes === "car" ? "car" : "public transport";

// What the office sees: "ZZ1 · 45 min, car or public transport" (the district only).
export const officeTravelText = (
  t: { district: string; maxMinutes: number; modes: TravelMode } | null,
) => (t ? `${t.district} · ${t.maxMinutes} min, ${travelModesText(t.modes)}` : "Not set");
