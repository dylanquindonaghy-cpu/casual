import type { Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  bookAndCancel,
  cancelOwnShift,
  updatesSeenAt,
} from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// Updates in a real browser (Phase 26.4; the spec page's upd-1 to upd-3 and sys-8's bell): with the
// dashboard open, a casual of this spec's own cancels a session a day away; the office's own
// refresh (every 30 seconds) brings the pop-up by itself, with "Offer the place", "Open Updates"
// and "Dismiss". Open Updates: the cancellation under "Needs action", marked new, with "Offer the
// place"; "Mark all as seen" clears the mark; "Everything" holds it too; back on the dashboard it
// doesn't pop up again. The session, its site, the casual and the resourcer are this spec's own (a retry makes new
// ones), so nothing here touches another spec's.

const acme = "http://acme.localhost:3100";

async function officeLogin(page: Page, email: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
}

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

test("a casual's cancellation pops up by itself; Updates lists it under Needs action", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const run = `${Date.now().toString(36)}${testInfo.retry}`;
  const email = `updates.resourcer${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Updates Resourcer", role: "resourcer" });
  const { shiftId } = await addEventWithSession("acme", {
    name: `Updates Test Event ${run}`,
    site: `Updates Test Hall ${run}`,
    role: "steward",
    daysAhead: 1,
  });
  const workerId = await addSteward("acme", {
    firstName: "Una",
    lastName: "Updates",
    mobileE164: `+44770090071${testInfo.retry}`,
  });
  try {
    await officeLogin(page, email);
    await expect(page.locator("dialog[data-offer-panel][data-ready]")).toHaveCount(1);

    // It lands while the dashboard is open.
    // A day's notice: under the firm's strike line, so the casual was warned of a strike.
    const { assignmentId } = await bookAndCancel("acme", {
      shiftId,
      workerId,
      reason: "Travel problem",
      warning: "strike",
    });
    const popup = page.locator("[data-cancellation-popup]");
    const title = popup.locator("#cancellation-popup-title");
    // Another spec's cancellation in the last 30 minutes may pop up first: each is dismissed.
    for (let i = 0; i < 8; i++) {
      await expect(popup).toBeVisible({ timeout: 50_000 });
      if ((await popup.textContent())?.includes(`Updates Test Hall ${run},`)) break;
      await popup.getByRole("button", { name: "Dismiss" }).click();
    }
    await expect(popup).toHaveAttribute("role", "alert");
    await expect(title).toHaveText(/^Una Updates cancelled · \d+ hours' notice$/);
    await expect(popup).toContainText(`Steward, Updates Test Hall ${run}, `);
    await expect(popup.getByRole("link", { name: "Offer the place" })).toHaveAttribute(
      "href",
      `/office/offer/${shiftId}`,
    );
    await expect(popup.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await popup.getByRole("link", { name: "Open Updates" }).click();

    // Updates: the cancellation needs action (its place is open again), new, with its button.
    await expect(page).toHaveURL(`${acme}/office/updates`);
    await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();
    await expect(popup).toHaveCount(0);
    const list = page.locator("section#updates-list");
    // Phase 36.2: the kinds are chips over the list ("What kind"), Needs action the default.
    const views = page.getByRole("navigation", { name: "What kind" });
    await expect(views.getByRole("link", { name: /^Needs action \d+$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Two rows for the session: its cancellation, and its place still to fill (it starts within 48
    // hours).
    const here = list.locator("li", { hasText: `Updates Test Hall ${run}` });
    const row = here.filter({ hasText: "Una Updates cancelled" });
    await expect(row).toHaveAttribute("data-new", "");
    const open = here.filter({ hasText: /^1 place still to fill, starts in \d+ h/ });
    await expect(open.getByRole("link", { name: "Offer the place" })).toHaveAttribute(
      "href",
      `/office/offer/${shiftId}`,
    );
    await expect(open).not.toHaveAttribute("data-new");
    const record = row.getByRole("link", {
      name: /^New: Una Updates cancelled · \d+ hours' notice$/,
    });
    await expect(record).toHaveAttribute("href", `/office/cancellations/${assignmentId}`);
    await expect(row.getByRole("link", { name: "Offer the place" })).toHaveAttribute(
      "href",
      `/office/offer/${shiftId}`,
    );
    await expect(
      list.getByRole("link", { name: "Older updates are in the action log." }),
    ).toBeVisible();
    // The bell on Updates: the page open, still counting until "Mark all as seen".
    const bell = page.getByRole("banner").getByRole("link", { name: /^Updates/ });
    await expect(bell).toHaveAttribute("aria-current", "page");
    await expect(bell).toHaveAttribute("aria-label", /^Updates, (\d+|99\+) new$/);
    expect(await updatesSeenAt("acme", email)).toBeNull();
    await page.getByRole("button", { name: "Mark all as seen" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Marked as seen." })).toBeVisible();
    await expect(row).not.toHaveAttribute("data-new");
    await expect(row.getByRole("link", { name: /^Una Updates cancelled · / })).toBeVisible();
    expect(await updatesSeenAt("acme", email)).not.toBeNull();

    // Everything: the same row, under that kind (kept in the address since Phase 36.2).
    await views.getByRole("link", { name: "Everything" }).click();
    await expect(page).toHaveURL(`${acme}/office/updates?kind=everything`);
    await expect(views.getByRole("link", { name: "Everything" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(list.locator("li", { hasText: `Updates Test Hall ${run}` })).toHaveCount(2);

    // Back on the dashboard: it doesn't pop up again; the bell opens Updates.
    await page.goto(`${acme}/office`);
    await expect(page.locator("dialog[data-offer-panel][data-ready]")).toHaveCount(1);
    await expect(popup.filter({ hasText: `Updates Test Hall ${run},` })).toHaveCount(0);
    await page
      .getByRole("banner")
      .getByRole("link", { name: /^Updates/ })
      .click();
    await expect(page).toHaveURL(`${acme}/office/updates`);
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

test("Tell me about: a switch saved for the person; this device; the office's push route", async ({
  page,
}, testInfo) => {
  const email = `updates.tellme${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Tell Me Resourcer", role: "resourcer" });
  const url = `${acme}/api/office/push`;
  const fake = {
    endpoint: `https://fcm.googleapis.com/fcm/send/e2e-office-browser-${testInfo.retry}-${Date.now()}`,
    expirationTime: null,
    // A browser's keys as it gives them (a P-256 public key, a 16-byte auth secret): made up.
    keys: {
      p256dh:
        "BMjKn90ImxFVU1zSHNEtruyhx0HMcUneBp1ALg-PY6_yI87c_6dAPQLNPXaYzumNeXGAWfJ_VLuP-VKZbmUba3Q",
      auth: "6rFtYx17VYjqn0un5estNA",
    },
  };
  // Not logged in: refused.
  expect((await page.request.post(url, { data: fake, headers: { origin: acme } })).status()).toBe(
    401,
  );
  await officeLogin(page, email);
  await page.goto(`${acme}/office/updates`);
  const panel = page.getByRole("region", { name: "Tell me about" });
  await expect(panel).toContainText(
    "Only you get these. You don't look after any contracts, so they cover every venue.",
  );
  // The defaults: all on but uploads.
  for (const [name, on] of [
    ["Every cancellation", true],
    ["Cancellations under 48 hours", true],
    ["Places still open 6 hours before start", true],
    ["Uploads to check", false],
    ["A summary at 08:00", true],
  ] as const) {
    const sw = panel.getByRole("switch", { name: new RegExp(`^${name}`) });
    await expect(sw).toHaveAttribute("aria-checked", String(on));
  }
  // The whole row is the switch.
  const uploads = panel.getByRole("switch", { name: /^Uploads to check/ });
  await expect(uploads).toBeEnabled();
  await uploads.click();
  await expect(panel.getByRole("status")).toHaveText("Saved. Uploads to check: on.");
  await page.reload();
  await expect(panel.getByRole("switch", { name: /^Uploads to check/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await panel.getByRole("switch", { name: /^Uploads to check/ }).click();
  await expect(panel.getByRole("status")).toHaveText("Saved. Uploads to check: off.");
  // This device: no web push on the test server (no VAPID key), and it says so.
  await expect(panel.locator("[data-device-push]")).toHaveAttribute("data-device-push", "no_key");
  await expect(panel).toContainText(
    "Phone and computer notifications aren't turned on for your firm yet, so these two switches do nothing for now.",
  );
  // The route: only from the site's own page, then saved and removed.
  expect(
    (
      await page.request.post(url, {
        data: fake,
        headers: { origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  const saved = await page.request.post(url, { data: fake, headers: { origin: acme } });
  expect([saved.status(), await saved.json()]).toEqual([200, { status: "saved" }]);
  const removed = await page.request.delete(url, {
    data: { endpoint: fake.endpoint },
    headers: { origin: acme },
  });
  expect(await removed.json()).toEqual({ status: "removed" });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Updates fits the screen, and the bell is in the top bar", async ({ page }, testInfo) => {
    const email = `updates.phone${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Updates Phone", role: "resourcer" });
    await officeLogin(page, email);
    await page
      .getByRole("banner")
      .getByRole("link", { name: /^Updates/ })
      .click();
    await expect(page).toHaveURL(`${acme}/office/updates`);
    await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();
    // Phase 36.2: seven kinds now, so the row scrolls sideways inside its own track (never the
    // page): its first chip shows, the row fits the screen, and Everything is a scroll away.
    const views = page.getByRole("navigation", { name: "What kind" });
    await expect(views.getByRole("link", { name: /^Needs action/ })).toBeInViewport({ ratio: 1 });
    const row = await views.boundingBox();
    expect((row?.x ?? 0) + (row?.width ?? 0)).toBeLessThanOrEqual(390);
    await views.getByRole("link", { name: "Everything" }).scrollIntoViewIfNeeded();
    await expect(views.getByRole("link", { name: "Everything" })).toBeInViewport({ ratio: 1 });
    await noSidewaysScroll(page);
  });
});
