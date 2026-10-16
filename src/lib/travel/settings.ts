import { TRAVEL_MINUTES, type TravelMinutes } from "./modes";

// The firm's travel settings (docs/office-v2.md 5.2), set by the owner with `npm run firm:settings`:
// - `travel.enabled` (13.4): travel areas are switched on for this firm. Off unless it's exactly
//   true: the firm's own DPIA comes first (docs/dpia-travel.md, Part 2). Off, a casual sees no
//   "Where you work", no prompt to add a home area and no travel lines, and nothing is filtered
//   or ordered by distance (a home area saved earlier is kept but not used).
// - `travel.default_max_minutes`: the time limit a casual's travel area starts with until they
//   choose (30, 45, 60 or 90; 45 by default).
// Anything else falls back to the default. Pure.

export const TRAVEL_DEFAULTS = { enabled: false, defaultMaxMinutes: 45 } as const satisfies {
  enabled: boolean;
  defaultMaxMinutes: TravelMinutes;
};

export const isTravelMinutes = (v: unknown): v is TravelMinutes =>
  typeof v === "number" && (TRAVEL_MINUTES as readonly number[]).includes(v);

export function travelSettings(settings: Record<string, unknown>): {
  enabled: boolean;
  defaultMaxMinutes: TravelMinutes;
} {
  const raw = settings.travel;
  const t = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled: t.enabled === true,
    defaultMaxMinutes: isTravelMinutes(t.default_max_minutes)
      ? t.default_max_minutes
      : TRAVEL_DEFAULTS.defaultMaxMinutes,
  };
}
