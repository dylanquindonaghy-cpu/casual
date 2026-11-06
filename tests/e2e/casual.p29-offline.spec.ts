import type { BrowserContext, Page } from "@playwright/test";
import { OFFLINE_CACHE } from "../../src/lib/portal/offline";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import { addP29_6Casual } from "./p29/29-6-data";

// Phase 29.6, from the live phone check: with no signal, a tab or link from Home no longer throws
// her out to the browser's own "No internet" page. The service worker (public/sw.js) answers any
// other page with an in-app "No signal" page, with "Try again" and "Open my saved shifts"; and the
// saved copy, which says "It updates when you're back online", does so by itself when the signal
// comes back.

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);

async function logIn(page: Page, typed: string, e164: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill(typed);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(e164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
}

const hasCopy = (page: Page) =>
  page.evaluate(async (name) => !!(await (await caches.open(name)).match("/")), OFFLINE_CACHE);

// No signal. The browser's offline switch doesn't always reach the service worker's own request
// for a page it hasn't opened yet (tests/e2e/offline.worker.spec.ts), so that request is also
// failed as a lost connection would fail it: the page itself and its data.
const OTHER_PAGES = /\/(pay|profile|messages)(\?.*)?$/;
async function signalOff(context: BrowserContext) {
  await context.setOffline(true);
  await context.route(OTHER_PAGES, (route) => route.abort("internetdisconnected"));
}
async function signalOn(context: BrowserContext) {
  await context.unroute(OTHER_PAGES);
  await context.setOffline(false);
}

test("with no signal a tab stays in the app with a way back, and the saved copy updates itself when signal returns", async ({
  page,
  context,
}, testInfo) => {
  const zoe = await addP29_6Casual(testInfo.retry, RUN);
  await logIn(page, zoe.typed, zoe.mobileE164);
  await expect.poll(() => hasCopy(page), { timeout: 15_000 }).toBe(true);
  await expect(page.getByRole("region", { name: "Your next shift" })).toContainText(zoe.site);

  // No signal, then the Pay tab.
  await signalOff(context);
  const tabs = page.getByRole("navigation", { name: "Main" });
  await tabs.getByRole("link", { name: "Pay", exact: true }).click();
  await expect(page).toHaveURL(`${acme}/pay`);
  await expect(page.getByRole("heading", { name: "No signal" })).toBeVisible();
  await expect(
    page.getByText("This page needs signal. Try again when you have signal."),
  ).toBeVisible();
  const again = page.getByRole("link", { name: "Try again" });
  const saved = page.getByRole("link", { name: "Open my saved shifts" });
  await expect(again).toHaveAttribute("href", "/pay");
  await expect(saved).toHaveAttribute("href", "/");
  for (const link of [again, saved]) {
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  // "Try again" with still no signal: the same page, still in the app.
  await again.click();
  await expect(page.getByRole("heading", { name: "No signal" })).toBeVisible();

  // "Open my saved shifts": the saved Home, marked as a copy.
  await page.getByRole("link", { name: "Open my saved shifts" }).click();
  await expect(page).toHaveURL(`${acme}/`);
  await expect(page.getByText("No signal.")).toBeVisible();
  await expect(page.getByTestId("brand-bar").getByText("Offline")).toBeVisible();
  await expect(page.getByRole("region", { name: "Your next shift" })).toContainText(zoe.site);

  // Signal again, and nothing tapped: the fresh page replaces the copy within a few seconds.
  await signalOn(context);
  await expect(page.getByText("No signal.")).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("brand-bar").getByText("Offline")).toBeHidden();
  await expect(page.getByText(/^Updated \d\d:\d\d$/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Your next shift" })).toContainText(zoe.site);
  await expect(page).toHaveURL(`${acme}/`);
});
