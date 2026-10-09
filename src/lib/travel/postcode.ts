// UK postcodes (docs/office-v2.md 5.4): one format check, the tidy form ("LS1 4AP") and the
// district ("LS1", the outward code), which is all the office ever sees of a casual's postcode.
// Pure, so the browser can use it too.

// The outward code (1–2 letters, a digit, then a digit or letter), an optional space, and the
// inward code (a digit and two letters), after tidying.
export const POSTCODE = /^([A-Z]{1,2}[0-9][A-Z0-9]?) ?([0-9][A-Z]{2})$/;
// Longest input accepted before tidying ("  zz1   1aa ").
export const POSTCODE_INPUT_MAX = 12;

const squash = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, " ");

// "zz1  1aa" → "ZZ1 1AA"; null when it isn't a postcode.
export function tidyPostcode(raw: string): string | null {
  if (raw.length > POSTCODE_INPUT_MAX) return null;
  const m = POSTCODE.exec(squash(raw));
  return m ? `${m[1]} ${m[2]}` : null;
}

// "ZZ1 1AA" → "ZZ1"; null when it isn't a postcode.
export function postcodeDistrict(raw: string): string | null {
  const m = POSTCODE.exec(squash(raw));
  return m ? (m[1] ?? null) : null;
}
