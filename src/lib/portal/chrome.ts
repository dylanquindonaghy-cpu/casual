// The casual app's chrome as you scroll (Phase 24, 24.6: round 7 of the canvas), worked out from
// where the page is (`y`, px from the top) and where it was when the tab bar last changed (`last`):
// whether the page is under the firm's bar (its frosted edge shows), and whether the tab bar is
// shrunk to its icons (scrolling down shrinks it; scrolling up, or near the top, opens it). A few
// pixels either way change nothing, so a finger's wobble doesn't flicker it. Pure; browser-safe.

export const CHROME_NEAR_TOP = 24; // px: near the top, the tab bar is always open
export const CHROME_WOBBLE = 6; // px: a move this small changes nothing

export interface ChromeState {
  scrolled: boolean;
  mini: boolean;
  last: number;
}

export function chromeAfterScroll(y: number, before: ChromeState): ChromeState {
  const moved = y - before.last;
  const nearTop = y < CHROME_NEAR_TOP;
  const mini =
    nearTop || moved < -CHROME_WOBBLE ? false : moved > CHROME_WOBBLE ? true : before.mini;
  const last = nearTop || Math.abs(moved) > CHROME_WOBBLE ? y : before.last;
  return { scrolled: y > 0, mini, last };
}
