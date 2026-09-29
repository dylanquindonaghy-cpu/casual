import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// Web push in a real browser, short of a real push service (not connected: PLAN.md Parking lot).
// The profile says phone notifications aren't switched on (no VAPID key), and the subscribe route
// only takes a logged-in worker's request from the portal's own page. The subscription posted here
// is made up: no browser subscribes, so nothing reaches Google or Apple.

const acme = "http://acme.localhost:3100";
const fake = {
  endpoint: "https://fcm.googleapis.com/fcm/send/e2e-phone",
  expirationTime: null,
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
};

test("the subscribe route: logged in, from our own page, a proper subscription", async ({
  page,
}) => {
  const url = `${acme}/api/push/subscribe`;
  // Not logged in.
  expect((await page.request.post(url, { data: fake, headers: { origin: acme } })).status()).toBe(
    401,
  );

  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900108");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo("+447700900108", asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();

  // From another site: refused.
  expect(
    (
      await page.request.post(url, { data: fake, headers: { origin: "https://evil.example" } })
    ).status(),
  ).toBe(403);
  // No Origin at all: refused.
  expect((await page.request.post(url, { data: fake })).status()).toBe(403);
  // Too big: refused before it's read.
  expect(
    (
      await page.request.post(url, {
        data: { ...fake, padding: "x".repeat(5000) },
        headers: { origin: acme },
      })
    ).status(),
  ).toBe(413);
  // Not a subscription, or not a browser push service: refused.
  expect(
    (
      await page.request.post(url, {
        data: { ...fake, endpoint: "https://evil.example/collect" },
        headers: { origin: acme },
      })
    ).status(),
  ).toBe(400);
  // Not a subscription: refused.
  expect(
    (
      await page.request.post(url, { data: { endpoint: "http://x" }, headers: { origin: acme } })
    ).status(),
  ).toBe(400);
  // Saved, then removed.
  const saved = await page.request.post(url, { data: fake, headers: { origin: acme } });
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toEqual({ status: "saved" });
  const removed = await page.request.delete(url, {
    data: { endpoint: fake.endpoint },
    headers: { origin: acme },
  });
  expect(await removed.json()).toEqual({ status: "removed" });
});

test("the profile says phone notifications aren't switched on yet", async ({ page }) => {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900109");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo("+447700900109", asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await page.getByRole("link", { name: "My profile" }).click();
  await expect(page.getByRole("heading", { name: "Notifications on this phone" })).toBeVisible();
  await expect(
    page.getByText("Phone notifications aren't switched on for Acme Events yet."),
  ).toBeVisible();
});
