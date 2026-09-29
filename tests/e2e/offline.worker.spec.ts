import { devices, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { OFFLINE_CACHE } from "../../src/lib/portal/offline";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// My shifts with no signal, in a real browser: the service worker (public/sw.js) keeps the last
// copy, shows it offline with its notice, and logging out deletes it. Also the web app manifest
// and the iPhone "home screen" hint.

const acme = "http://acme.localhost:3100";

async function logIn(page: Page, typed: string, e164: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill(typed);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(e164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
}

// The kept page's HTML, without the markers React puts between pieces of text ("Hello <!-- -->Sam").
const keptText = (page: Page) =>
  page.evaluate(async (name) => {
    const kept = await (await caches.open(name)).match("/");
    return kept ? (await kept.text()).replaceAll("<!-- -->", "") : "";
  }, OFFLINE_CACHE);

const hasCopy = (page: Page) =>
  page.evaluate(async (name) => !!(await (await caches.open(name)).match("/")), OFFLINE_CACHE);

test("My shifts opens with no signal, marked as a copy; logging out deletes it", async ({
  page,
  context,
}) => {
  await logIn(page, "07700 900103", "+447700900103");
  // Arriving on My shifts after logging in (no full page load) is enough to keep a copy.
  await expect.poll(() => hasCopy(page), { timeout: 15_000 }).toBe(true);
  await expect(page.getByText("No signal.")).toBeHidden();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();
  await expect(page.getByText("No signal.")).toBeVisible();
  await expect(page.getByText(/^These are your shifts from \d\d:\d\d on /)).toBeVisible();
  await expect(page.getByText("Taking or cancelling a shift needs signal.")).toBeVisible();
  await context.setOffline(false);

  await page.reload();
  await expect(page.getByText("No signal.")).toBeHidden();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await hasCopy(page)).toBe(false);
});

test("a new login on the same phone never shows the last worker's copy", async ({
  page,
  browser,
}, testInfo) => {
  await logIn(page, "07700 900106", "+447700900106");
  const first = (await page.getByRole("heading", { name: /^Hello / }).textContent()) ?? "";
  await expect.poll(() => keptText(page), { timeout: 15_000 }).toContain(first);

  // Someone else asks for a link from their own phone and opens it on this one, without the
  // first worker logging out.
  const h = createHash("sha256").update(`${testInfo.testId}:other`).digest();
  const otherPhone = await browser.newContext({
    ...devices["Pixel 7"],
    extraHTTPHeaders: { "x-real-ip": `10.${h[0]}.${h[1]}.${h[2]}` },
  });
  let link = "";
  try {
    const asking = await otherPhone.newPage();
    const asked = new Date(Date.now() - 1000);
    await asking.goto(`${acme}/login`);
    await asking.getByLabel("Your mobile number").fill("07700 900107");
    await asking.getByRole("button", { name: "Send me a link" }).click();
    link = await loginLinkSentTo("+447700900107", asked);
  } finally {
    await otherPhone.close();
  }
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
  const second = (await page.getByRole("heading", { name: /^Hello / }).textContent()) ?? "";
  expect(second).not.toBe(first);
  await expect.poll(() => keptText(page), { timeout: 15_000 }).toContain(second);
  expect(await keptText(page)).not.toContain(first);
});

test("the web app manifest names the firm, in its colour", async ({ page }) => {
  const response = await page.request.get(`${acme}/manifest.webmanifest`);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({
    name: "Acme Events shifts",
    start_url: "/",
    display: "standalone",
    theme_color: "#1d4ed8", // the demo seed's Acme colour (Phase 8 branding)
  });
});

test("on an iPhone, My shifts suggests the home screen until 'Don't show again'", async ({
  browser,
}, testInfo) => {
  const h = createHash("sha256").update(testInfo.testId).digest();
  const iphone = await browser.newContext({
    ...devices["iPhone 13"],
    extraHTTPHeaders: { "x-real-ip": `10.${h[0]}.${h[1]}.${h[2]}` },
  });
  try {
    const page = await iphone.newPage();
    await logIn(page, "07700 900104", "+447700900104");
    const hint = page.getByRole("heading", { name: "Put your shifts on your home screen" });
    await expect(hint).toBeVisible();
    await expect(
      page.getByText(
        "Open your browser's Share menu, then tap Add to Home Screen. Your shifts then open in one tap.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Don't show again" }).click();
    await expect(hint).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();
    await expect(hint).toBeHidden();
  } finally {
    await iphone.close();
  }
});

test("on Android, no home screen hint", async ({ page }) => {
  await logIn(page, "07700 900105", "+447700900105");
  await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Put your shifts on your home screen" }),
  ).toHaveCount(0);
});
