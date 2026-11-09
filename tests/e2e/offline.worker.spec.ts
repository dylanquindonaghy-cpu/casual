import { devices, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { OFFLINE_CACHE } from "../../src/lib/portal/offline";
import { addBookedShift, addWorker } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import { addPastWorkedShift } from "./p28/28-13-data";

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

// The kept page's HTML, without the markers React puts between pieces of text ("Hi <!-- -->Sam").
const keptText = (page: Page, path = "/") =>
  page.evaluate(
    async ([name, at]) => {
      const kept = await (await caches.open(name)).match(at);
      return kept ? (await kept.text()).replaceAll("<!-- -->", "") : "";
    },
    [OFFLINE_CACHE, path] as const,
  );

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
  const workerId = await addWorker("acme", {
    firstName: "Olive",
    lastName: `Offline${n || ""}`,
    mobileE164: mobile,
  });
  await addBookedShift("acme", { workerId, daysAhead: 3, site });
  // And one she worked 4 days ago (Phase 28.13: Past 90 days), at a site and a pay rate of its
  // own, so the kept copy of /shifts can be checked for any trace of it.
  const pastSite = `Offline Past Hall ${RUN}`;
  const pastShiftId = await addPastWorkedShift(workerId, { site: pastSite, daysAgo: 4 });
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
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.getByText("No signal.")).toBeVisible();
  await expect(
    page.getByText(
      /^This is your saved copy from \d\d:\d\d on .+\. It updates when you're back online\.$/,
    ),
  ).toBeVisible();
  // The parts that need signal say so instead (Phase 18: the offline row, under "Shifts you can
  // take" since Phase 24; the header's plate), and when it was updated isn't shown.
  const offline = page
    .getByRole("region", { name: "Shifts you can take" })
    .locator('[data-for-you="offline"]');
  await expect(offline).toBeVisible();
  await expect(offline).toContainText("Open shifts need signal");
  await expect(page.locator('[data-for-you="apply"]')).toBeHidden();
  await expect(page.getByText(/^Updated \d\d:\d\d$/)).toBeHidden();
  await expect(page.locator("[data-casual-top]").getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.getByText("Taking or cancelling a shift needs signal.")).toBeVisible();
  // The copy still has her next shift in full.
  await expect(page.getByRole("region", { name: "Your next shift" })).toContainText(site);
  // And the tab bar (Phase 24, 24.6; Messages since Phase 25.6): the floating capsule, its five
  // tabs plain links to their pages, Home the current one.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.locator(":scope > div")).toBeVisible();
  const links = tabs.getByRole("link");
  // (Profile carries her count when something needs doing: "Profile, 1 thing needs doing".)
  await expect(links).toHaveText(["Home", "Shifts", /^\d*Messages$/, "Pay", /^\d*Profile$/]);
  await expect(links.nth(4)).toHaveAccessibleName(/^Profile(, \d+ things? needs? doing)?$/);
  expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")))).toEqual([
    "/",
    "/shifts",
    "/messages",
    "/pay",
    "/profile",
  ]);
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("button")).toHaveCount(0);
  await context.setOffline(false);
  // Signal again: the copy opens the fresh page by itself (Phase 29.6), before going on.
  await expect(page.getByText("No signal.")).toBeHidden({ timeout: 10_000 });

  // Booked, on the Shifts tab, is kept too.
  await page.goto(`${acme}/shifts`);
  await expect(page.getByRole("heading", { name: "Booked shifts" })).toBeVisible();
  await expect.poll(() => hasCopy(page, "/shifts"), { timeout: 15_000 }).toBe(true);
  // Phase 28.13: the kept copy is Upcoming only, even after Past 90 days has been opened (its
  // address has a query, which public/sw.js never keeps): no past row, no pay figure from one,
  // and nothing about requests or the pay query.
  await page.goto(`${acme}/shifts?view=past`);
  await expect(page.getByRole("region", { name: "The last 90 days" })).toContainText(pastSite);
  await page.goto(`${acme}/shifts`);
  await expect(page.getByRole("heading", { name: "Booked shifts" })).toBeVisible();
  await expect.poll(() => keptText(page, "/shifts"), { timeout: 15_000 }).toContain(site);
  const keptBooked = await keptText(page, "/shifts");
  expect(keptBooked).not.toContain(pastSite);
  expect(keptBooked).not.toContain(pastShiftId);
  expect(keptBooked).not.toContain("£17.43");
  expect(keptBooked).not.toContain("The last 90 days");
  expect(keptBooked).not.toContain("Think this mark is wrong?");
  expect(keptBooked).not.toContain("kind=attendance");
  expect(keptBooked).not.toContain("/pay/query");
  expect(keptBooked).not.toContain("Ask about the pay for this shift");
  expect(keptBooked).not.toMatch(/Reference [0-9A-F]{8}/);
  expect(await hasCopy(page, "/shifts?view=past")).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Booked shifts" })).toBeVisible();
  await expect(page.getByText("No signal.")).toBeVisible();
  await expect(page.getByText(site).first()).toBeVisible();
  await context.setOffline(false);
  // Booked's copy opens the fresh page by itself too (Phase 29.6).
  await expect(page.getByText("No signal.")).toBeHidden({ timeout: 10_000 });
  await expect(page).toHaveURL(`${acme}/shifts`);

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
  // Who is logged in: her name in the top bar (Phase 32; the "Hi {name}" headline before).
  const first = (await page.locator("[data-you] .truncate").textContent()) ?? "";
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
  const second = (await page.locator("[data-you] .truncate").textContent()) ?? "";
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
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(hint).toBeHidden();
  } finally {
    await iphone.close();
  }
});

test("on Android, no home screen hint", async ({ page }) => {
  await logIn(page, "07700 900105", "+447700900105");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Put your shifts on your home screen" }),
  ).toHaveCount(0);
});
