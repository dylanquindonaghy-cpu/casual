// The dashboard's urgent place (Phase 18): "1 of 4 places free". Pure and browser-safe (the
// focus card is a client component).
export const placesFreeText = (free: number, total: number) =>
  `${free} of ${total} ${total === 1 ? "place" : "places"} free`;
