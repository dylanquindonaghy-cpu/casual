// The dashboard's urgent place (Phase 18; Phase 21's words, from Dylan's brief): "3 of 4 filled",
// beside its bar. Pure and browser-safe (the urgent places are a client component).
export const placesFilledText = (free: number, total: number) =>
  `${Math.max(0, total - free)} of ${total} filled`;
