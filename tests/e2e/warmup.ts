import { PORT } from "../../playwright.config";

// Before the browser tests: one request to each page the tests open first, so the dev server has
// built them before any test waits on one. `next dev` builds a page the first time it's asked for,
// and the office's dashboard can take longer than a test's 5-second wait: the first test to log in
// to the office then timed out with "Logging in…" still showing (24.6, the office half of
// tests/e2e/casual.app.spec.ts). A page with no session still builds before it sends you to log in,
// so no login is needed here. CI's production build has nothing to build, so these are quick there.
const PAGES = [
  "/office/login",
  "/office/l",
  "/office",
  "/office/events",
  "/office/enquiries",
  "/office/casuals",
  "/login",
  "/l",
  "/",
  "/shifts",
  "/shifts/open",
  "/pay",
  "/profile",
];

export default async function warmUp(): Promise<void> {
  for (const path of PAGES) {
    // A page that fails here is still built; the tests themselves say what's wrong with it.
    await fetch(`http://acme.localhost:${PORT}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    }).catch(() => undefined);
  }
}
