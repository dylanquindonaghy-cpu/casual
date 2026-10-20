// Demo mode's one password for the whole site (16.1; ADR-025): with DEMO_MODE=on and
// DEMO_SITE_PASSWORD set, every request (pages, server actions, API routes) needs it, as HTTP
// Basic login with the user name "demo". The browser asks once per address and remembers it. It's
// the app's own check, run first by src/proxy.ts (src/lib/http/proxy.ts), so the made-up demo, its
// Demo phone and the login links on it are only for the people it's shared with, whatever is in
// front of the app. Let through without it: the health check and Caddy's certificate check
// (callers inside the server, which read and write no firm data), and the planner API, which
// refuses anyone without one of a firm's own keys (`Authorization: Bearer`, which can't be sent
// alongside the password: src/lib/integrations/api.ts). A key is made by a firm's admin, logged in
// behind the password, so the planner integration can be shown on a demo server too.

export const DEMO_SITE_USER = "demo";
export const DEMO_REALM = "ShiftDesk demo";

// Shown only if the person cancels the browser's password box.
export const DEMO_PASSWORD_NEEDED =
  "This demo needs its password. Ask the person who sent you the link.";

// The planner API's paths: they check their own key instead.
export const checksItsOwnKey = (path: string): boolean =>
  path === "/api/v1" || path.startsWith("/api/v1/");

// The site password when the gate is on: demo mode with a password set; otherwise none.
export const demoSitePassword = (env: {
  DEMO_MODE?: string;
  DEMO_SITE_PASSWORD?: string;
}): string | undefined => (env.DEMO_MODE === "on" ? env.DEMO_SITE_PASSWORD : undefined);

// Whether an Authorization header carries the demo's user name and password.
export function demoLoginMatches(header: string | null, password: string): boolean {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? "");
  if (!match?.[1]) return false;
  let given: string;
  try {
    const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
    given = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  const colon = given.indexOf(":");
  if (colon < 0) return false;
  // Both compared in full whatever matches, so the time taken says nothing about the password.
  const user = sameText(given.slice(0, colon), DEMO_SITE_USER);
  const pass = sameText(given.slice(colon + 1), password);
  return user && pass;
}

// Compares every character of `expected`, whether or not an earlier one differed.
function sameText(given: string, expected: string): boolean {
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= (given.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
