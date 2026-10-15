import { PHOTO_RENEWAL_MONTHS } from "./photo";

// The staff photo's settings (docs/office-v2.md 5.2, D3; 12F.2), in firms.settings, set by the
// owner (`npm run firm:settings`): photo.renewal_months, how often a casual's photo is renewed (36,
// the SIA licence's three years; whole months from 12 to 60). Anything else reads as the default.
export const PHOTO_RENEWAL_LIMITS = { min: 12, max: 60 } as const;

export function photoSettings(settings: Record<string, unknown>): { renewalMonths: number } {
  const raw = settings.photo;
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const months = p.renewal_months;
  return {
    renewalMonths:
      typeof months === "number" &&
      Number.isInteger(months) &&
      months >= PHOTO_RENEWAL_LIMITS.min &&
      months <= PHOTO_RENEWAL_LIMITS.max
        ? months
        : PHOTO_RENEWAL_MONTHS,
  };
}
