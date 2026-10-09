import { TRAVEL_MINUTES, type TravelMinutes } from "./modes";

// The firm's travel setting (docs/office-v2.md 5.2): `travel.default_max_minutes`, the time limit a
// casual's travel area starts with until they choose (30, 45, 60 or 90; 45 by default). Set by the
// owner with `npm run firm:settings`. Anything else falls back to the default. Pure.

export const TRAVEL_DEFAULTS = { defaultMaxMinutes: 45 } as const satisfies {
  defaultMaxMinutes: TravelMinutes;
};

export const isTravelMinutes = (v: unknown): v is TravelMinutes =>
  typeof v === "number" && (TRAVEL_MINUTES as readonly number[]).includes(v);

export function travelSettings(settings: Record<string, unknown>): {
  defaultMaxMinutes: TravelMinutes;
} {
  const raw = settings.travel;
  const t = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    defaultMaxMinutes: isTravelMinutes(t.default_max_minutes)
      ? t.default_max_minutes
      : TRAVEL_DEFAULTS.defaultMaxMinutes,
  };
}
