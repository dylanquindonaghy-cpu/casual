// When to show "Put your shifts on your home screen" (docs/screens.md, `/` and `/profile`).
// Browser-safe: no imports. iPhone and iPad only (Android is parked), not when the portal is
// already running from the home screen, and never again once the worker taps "Don't show again".

export const HOME_SCREEN_HINT_KEY = "shiftdesk.homeScreenHint";

export function shouldShowHomeScreenHint(device: {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean; // running from the home screen already
  dismissed: boolean;
}): boolean {
  if (device.standalone || device.dismissed) return false;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  const iPad = /Macintosh/.test(device.userAgent) && device.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(device.userAgent) || iPad;
}
