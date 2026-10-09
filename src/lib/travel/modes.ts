// A travel area's choices (docs/office-v2.md 4.6; S8): how a casual travels and their time limit.
// Here, not in the schema, so the browser can use them without database code.
export const TRAVEL_MODES = ["car", "public_transport", "both"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export const TRAVEL_MINUTES = [30, 45, 60, 90] as const;
export type TravelMinutes = (typeof TRAVEL_MINUTES)[number];
