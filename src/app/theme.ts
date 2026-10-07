// Light or dark (docs/office-v2.md 3.1): the `sd-theme` cookie says which, and with no cookie the
// device's own setting decides (the prefers-color-scheme block in globals.css). The root layout
// reads it on the server and writes `data-theme` on <html>, so the page arrives in its colours and
// nothing flashes. The office's moon/sun button sets it (12A.2); casual pages follow the device.

export const THEME_COOKIE = "sd-theme";

export type Theme = "light" | "dark";

// The cookie's value as a theme, or undefined (follow the device) for anything else.
export function themeFromCookie(value: string | undefined): Theme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}
