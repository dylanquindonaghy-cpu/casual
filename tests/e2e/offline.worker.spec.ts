import { devices, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { OFFLINE_CACHE } from "../../src/lib/portal/offline";
import { addBookedShift, addWorker } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// Home and Booked with no signal, in a real browser: the service worker (public/sw.js) keeps the
// last copy of each (Home with her next shift, Booked at /shifts: 12H.1), shows it offline with
// its notice, and logging out (on Profile) deletes them (and says so when there's no signal to log
// out with). Also the web app manifest
// and the iPhone "home screen" hint.

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

// The kept page's HTML, without the markers React puts between pieces of text ("Hello <!-- -->Sam").
const keptText = (page: Page) =>
  page.evaluate(async (name) => {
    const kept = await (await caches.open(name)).match("/");
    return kept ? (await kept.text()).replaceAll("<!-- -->", "") : "";
  }, OFFLINE_CACHE);

const hasCopy = (page: Page, path = "/") =>
  page.evaluate(async ([name, at]) => !!(await (await caches.open(name)).match(at)), [
    OFFLINE_CACHE,
    path,
  ] as const);

test("Home (her next shift) and Booked open with no signal, marked as copies; logging out deletes them", async ({
  page,
  context,
}, testInfo) => {
  // A casual of this spec's own (a retry gets another), so her next shift is this one.
  const n = testInfo.retry;
  const mobile = `+4477009006${22 + n}`;
  const site = `Offline Test Hall ${RUN}`;
  await addBookedShift("acme", {
    workerId: await addWorker("acme", {
      firstName: "Olive",
      lastName: `Offline${n || ""}`,
      mobileE164: mobile,
    }),
    daysAhead: 3,
    site,
  });
  await logIn(page, `07700 9006${22 + n}`, mobile);
  // Arriving on Home after logging in (no full page load) is enough to keep a copy.
  await expect.poll(() => hasCopy(page), { timeout: 15_000 }).toBe(true);
  await expect(page.getByText("No signal.")).toBeHidden();
  await expect(page.getByRole("region", { name: "Your next shift" })).toContainText(site);

  // Each page is checked by reloading it with no signal. (Opening a different address with no
  // signal isn't: the browser's offline switch doesn't reliably reach the service worker's own
  // request then, and the server answered it.)
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();
  await expect(page.getByText("No signal.")).toBeVisible();
  await expect(
    page.getByText(
      /^This is your saved copy from \d\d:\d\d on .+\. It updates when you're back online\.$/,
    ),
  ).toBeVisible();
  // The parts that need signal say so instead (Phase 18: For you's offline row; the header's plate).
  await expect(page.getByText("Open shifts need signal")).toBeVisible();
  await expect(page.getByTestId("brand-bar").getByText("Offline")).toBeVisible();
  await expect(page.getByText("Taking or cancelling a shift needs signal.")).toBeVisible();
  // The copy still has her next shift in full.
  await expect(page.getByRole("region", { name: "Your next shift" })).toContainText(site);
  await context.setOffline(false);

  // Booked, on the Shifts tab, is kept too.
  await page.goto(`${acme}/shifts`);
  await expect(page.getByRole("heading", { name: "Booked shifts" })).toBeVisible();
  await expect.poll(() => hasCopy(page, "/shifts"), { timeout: 15_000 }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Booked shifts" })).toBeVisible();
  await expect(page.getByText("No signal.")).toBeVisible();
  await expect(page.getByText(site).first()).toBeVisible();
  await context.setOffline(false);

  await page.reload();
  await expect(page.getByText("No signal.")).toBeHidden();
  // Log out is the last thing on Profile (12H.1).
  await page.goto(`${acme}/profile`);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await hasCopy(page)).toBe(false);
  expect(await hasCopy(page, "/shifts")).toBe(false);
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

// Audit L91: with no signal, Log out used to fail into the error page, leaving the phone logged in
// without saying so. (Logging out from the kept copy itself, where the fresh-copy watcher runs, is
// in the service worker's sandbox test: under `next dev` a kept copy offline can't load the dev
// server's own reload script, so it never becomes interactive here.)
test("logging out with no signal says it may not have, and keeps no copy; with signal it logs out", async ({
  page,
  context,
}) => {
  await logIn(page, "07700 900113", "+447700900113");
  await expect.poll(() => hasCopy(page), { timeout: 15_000 }).toBe(true);
  // Log out is on Profile (12H.1): opened with signal, then the signal goes.
  await page.goto(`${acme}/profile`);

  await context.setOffline(true);
  await page.getByRole("button", { name: "Log out" }).click();
  const said = page.getByText(
    "No signal. You may still be logged in. Your shifts are no longer kept on this phone. Try again when you have signal.",
  );
  await expect(said).toBeVisible();
  await page.waitForTimeout(3_000); // nothing replaces it
  await expect(said).toBeVisible();
  await expect(page).toHaveURL(`${acme}/profile`);
  expect(await hasCopy(page)).toBe(false);
  await expect(page.getByRole("button", { name: "Log out" })).toBeEnabled();

  // Signal again: still logged in (Profile opens), and now Log out works and clears the cookie.
  await context.setOffline(false);
  await page.reload();
  await expect(page).toHaveTitle(/^My profile · /);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login\?out=1/);
  const cookies = await context.cookies(acme);
  expect(cookies.map((c) => c.name)).not.toContain("__Host-sd_session");
  // The session really ended: My shifts sends you to log in.
  await page.goto(`${acme}/`);
  await expect(page).toHaveURL(/\/login/);
});

// Log out is a plain address now (audit L92: a page kept from a later build can still use it); it
// takes requests from the firm's own pages only, not another firm's (same site, other subdomain).
test("the logout address takes requests from the firm's own pages only", async ({ request }) => {
  for (const origin of ["http://evil.example", "http://northline.localhost:3100"]) {
    const refused = await request.post(`${acme}/api/logout`, {
      data: { kind: "worker" },
      headers: { origin },
    });
    expect(refused.status(), origin).toBe(403);
  }
  const unsaid = await request.post(`${acme}/api/logout`, { data: { kind: "worker" } });
  expect(unsaid.status()).toBe(403);
  const wrong = await request.post(`${acme}/api/logout`, {
    data: { kind: "admin" },
    headers: { origin: acme },
  });
  expect(wrong.status()).toBe(400);
  const ok = await request.post(`${acme}/api/logout`, {
    data: { kind: "office" },
    headers: { origin: acme },
  });
  expect(await ok.json()).toEqual({ status: "done" });
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
