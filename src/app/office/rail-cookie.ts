// Whether the office rail is open with names (Phase 24; src/app/office/office-rail.tsx): the
// `sd-rail` cookie, written when someone presses the rail's own button and read by the office
// layout, so the next page arrives as they left it. Shut (icons) when there's none. Plain data, safe
// on the server and in the browser.

export const RAIL_COOKIE = "sd-rail";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function railOpenFromCookie(value: string | undefined): boolean {
  return value === "open";
}

export function railCookie(open: boolean, secure: boolean): string {
  return `${RAIL_COOKIE}=${open ? "open" : "shut"}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
