import { resetPushSpec } from "./db";
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
  // A phone's keys as a browser gives them (a P-256 public key, a 16-byte auth secret): made up.
  keys: {
    p256dh:
      "BMjKn90ImxFVU1zSHNEtruyhx0HMcUneBp1ALg-PY6_yI87c_6dAPQLNPXaYzumNeXGAWfJ_VLuP-VKZbmUba3Q",
    auth: "6rFtYx17VYjqn0un5estNA",
  },
};

test("the subscribe route: logged in, from our own page, a proper subscription", async ({
  page,
}) => {
  const url = `${acme}/api/push/subscribe`;
  // A retried test starts as the first try did: nothing counted, none of its phones saved.
  await resetPushSpec("acme", fake.endpoint);
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
  await expect(page.getByRole("heading", { name: /^Hi / })).toBeVisible();

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
  // Each save that writes counts against the worker's limit (10 every 15 minutes, 13.3; 1 so
  // far): new phones until it's refused with how long to wait, the 11th.
  const statuses: number[] = [];
  let answer = removed;
  for (let n = 1; n <= 12 && answer.status() !== 429; n++) {
    answer = await page.request.post(url, {
      data: { ...fake, endpoint: `${fake.endpoint}-${n}` },
      headers: { origin: acme },
    });
    statuses.push(answer.status());
  }
  expect(statuses).toEqual([...Array<number>(9).fill(200), 429]);
  expect(Number(answer.headers()["retry-after"])).toBeGreaterThan(0);
  expect(await answer.json()).toEqual({ status: "rate_limited" });
  // Re-saving a phone already saved writes nothing, so isn't refused; nor is turning one off.
  const again = await page.request.post(url, {
    data: { ...fake, endpoint: `${fake.endpoint}-1` },
    headers: { origin: acme },
  });
  expect(again.status()).toBe(200);
  const off = await page.request.delete(url, {
    data: { endpoint: `${fake.endpoint}-2` },
    headers: { origin: acme },
  });
  expect(await off.json()).toEqual({ status: "removed" });
});

test("the profile says phone notifications aren't switched on yet", async ({ page }) => {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900109");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo("+447700900109", asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Profile" })
    .click();
  await expect(page.getByRole("heading", { name: "Notifications on this phone" })).toBeVisible();
  await expect(
    page.getByText("Phone notifications aren't switched on for Acme Events yet."),
  ).toBeVisible();
});
