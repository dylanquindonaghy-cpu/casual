import { appEnv } from "../env";

// Failing on purpose, once, for the browser tests of the error screens (E2E_TEST_PAGES=on, only in
// the e2e run on localhost: src/lib/env.ts). Off, nothing here ever fails.
// - src/app/e2e/fails-once: a page that fails the first time it's opened with an id
//   (src/app/error.tsx shows);
// - frameFailsOnce(), in the root layout: the page's frame fails the first time a browser carrying
//   the FRAME_FAILS_COOKIE cookie with an id loads any page (src/app/global-error.tsx shows).
// tests/e2e/error-page.spec.ts taps "Try again" on each and gets the page.

export const FRAME_FAILS_COOKIE = "e2e_frame_fails_once";
// What each failure says: the e2e teardown expects these, and only these, as server errors.
export const PAGE_FAILS_ON_PURPOSE = "the e2e test page fails the first time, on purpose";
export const FRAME_FAILS_ON_PURPOSE = "the e2e test frame fails the first time, on purpose";
export const testPagesOn = () => appEnv().E2E_TEST_PAGES === "on";
export const isTestId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-z0-9-]{1,64}$/.test(id);

// Kept on globalThis so a development reload of this file doesn't forget which ids have failed.
const KEY = Symbol.for("shiftdesk.e2e.fails-once");
const store = globalThis as typeof globalThis & { [KEY]?: Set<string> };
const failed = (store[KEY] ??= new Set<string>());

// True the first time for this id (so the caller fails), false after.
export function firstTime(id: string): boolean {
  if (failed.has(id)) return false;
  if (failed.size >= 1000) failed.clear(); // a test run uses a handful
  failed.add(id);
  return true;
}

// The root layout's hook: with the test pages off (everywhere but the e2e run), it does nothing,
// not even reading the cookie.
export async function frameFailsOnce(readCookie: () => Promise<string | undefined>): Promise<void> {
  if (!testPagesOn()) return;
  const id = await readCookie();
  if (isTestId(id) && firstTime(`frame:${id}`)) {
    throw new Error(FRAME_FAILS_ON_PURPOSE);
  }
}
