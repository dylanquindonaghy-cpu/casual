// The most casuals an urgent session's offer waves go to (Phase 25.3; P4's "a stop after 25 offers
// per free place"; fixed: Dylan, 2026-10-30): 25 for each place still free. Offers that couldn't be
// sent don't count (that casual can be offered it again); the office's own offers do. Another place
// coming free raises it, and the waves carry on (startOfferWaves). Pure, for the waves
// (src/lib/offers/waves.ts) and the dashboard's card (src/lib/office/dashboard-board.ts).
export const OFFER_LIMIT_PER_PLACE = 25;

export function offerLimit(placesFree: number): number {
  return OFFER_LIMIT_PER_PLACE * Math.max(0, placesFree);
}

// Whether a session with these offers sent (not failed) has had the most for its free places.
export function atOfferLimit(sent: number, placesFree: number): boolean {
  return placesFree > 0 && sent >= offerLimit(placesFree);
}
