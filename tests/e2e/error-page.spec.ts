import { FRAME_FAILS_COOKIE } from "../../src/lib/e2e/fails-once";
import { addOfficeUser } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Audit M4: "Try again" on the error screens must fetch the page again. A page that fails on the
// server (a database timeout on My shifts, say) used to fail again on "Try again", because the
// button only redrew what the browser already had. The failures here are on purpose and only in
// the e2e run (E2E_TEST_PAGES, src/lib/e2e/fails-once.ts): src/app/e2e/fails-once fails the first
// time it's opened with an id, and the cookie makes the page's frame (the root layout) fail once.

const PORTAL = "http://acme.localhost:3100";
// Each test, and each retry of it, gets its own id.
const uniqueId = () => {
  const info = test.info();
  return `${info.testId}-${info.retry}-${Date.now().toString(36)}`.toLowerCase().slice(0, 64);
};
const failsOnce = () => `${PORTAL}/e2e/fails-once?id=${uniqueId()}`;

test("a page that failed once: 'Try again' fetches it again and it shows", async ({ page }) => {
  await page.goto(failsOnce());
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(page.getByText("It's not you. Try again in a moment.")).toBeVisible();
  // The page's error screen (src/app/error.tsx), not the whole-page one, which has no such link.
  await expect(page.getByRole("link", { name: "Go to my shifts" })).toBeVisible();
  // Enabled once React has taken over the page (a tap before that would do nothing).
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "It worked this time" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
});

test("'Go to my shifts' on the error page loads My shifts afresh", async ({ page }) => {
  await page.goto(failsOnce());
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  // A full page load (not the app moving between its own pages, which keeps the error when the
  // failed page is My shifts itself): anything the old page left in the browser is gone.
  await page.evaluate(() => {
    (window as Window & { leftBehind?: boolean }).leftBehind = true;
  });
  await page.getByRole("link", { name: "Go to my shifts" }).click();
  // Logged out, My shifts asks for a login.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & { leftBehind?: boolean }).leftBehind),
  ).toBeUndefined();
});

test("with no signal, it says so and 'Try again' waits for the signal", async ({
  page,
  context,
}) => {
  await page.goto(failsOnce());
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("heading", { name: "No signal" })).toBeVisible();
  await expect(page.getByText("Check your signal and try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "It worked this time" })).toBeVisible();
});

test("the whole page failed once (its frame): 'Try again' loads it again and it shows", async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: FRAME_FAILS_COOKIE, value: uniqueId(), url: PORTAL }]);
  await page.goto(`${PORTAL}/login`);
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  // The whole-page error screen (src/app/global-error.tsx): no "Go to my shifts".
  await expect(page.getByRole("link", { name: "Go to my shifts" })).toHaveCount(0);
  // Under `next dev` (the local run), Next's developer overlay opens over a frame failure and takes
  // the tap; a production server (CI's run) has none. Escape closes it, as a developer would.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Send me a link" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  await expect(page).toHaveURL(`${PORTAL}/login`);
});

test("the test-only page is the only way to fail on purpose: a bad id is not found", async ({
  page,
}) => {
  const response = await page.goto(`${PORTAL}/e2e/fails-once?id=NOT_OK`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We can't find that page." })).toBeVisible();
});

// Phase 37.6 (w1-09): the casual not-found names itself in the tab.
test("an address that matches no page: the tab says Page not found", async ({ page }) => {
  expect((await page.goto(`${PORTAL}/no-such-page`))?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We can't find that page." })).toBeVisible();
  await expect(page).toHaveTitle("Page not found · Acme Events shifts");
});

// Phase 37.6 (w1-08): an office page that fails keeps the office frame and the office's words.
test("an office page that failed once keeps the office frame; 'Try again' fetches it again", async ({
  page,
}, testInfo) => {
  const email = `errorpage.admin${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Error Admin", role: "admin" });
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${PORTAL}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${PORTAL}/office`);

  await page.goto(`${PORTAL}/office/e2e/fails-once?id=${uniqueId()}`);
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(page.getByText("It's not you. Try again in a moment.")).toBeVisible();
  await expect(page.getByText("If it keeps happening, contact the office.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Go to my shifts" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to the office" })).toHaveAttribute(
    "href",
    "/office",
  );
  await expect(page.locator("#main").getByText(/^Updated \d/)).toHaveCount(0);
  // The office frame stays: its menu is there.
  await expect(await menuLink(page, "Casuals")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "It worked this time" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
});
