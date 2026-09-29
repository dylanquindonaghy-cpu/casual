import { addOpenShift } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// The blocked-shift screen in a real browser: a worker whose SIA licence has expired opens a door
// supervisor shift (as from a shared link), sees why they can't take it, and asks the office to
// review it.

const acme = "http://acme.localhost:3100";
const mobile = "+447700900126"; // a seeded Acme door supervisor whose SIA licence has expired

test("a blocked worker sees why and asks the office to review", async ({ page }) => {
  // 40 days ahead: past Open shifts' 28-day window, so no other test's list changes.
  const shiftId = await addOpenShift("acme", { role: "door_supervisor", daysAhead: 40 });

  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900126");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(mobile, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);

  await page.goto(`${acme}/shifts/${shiftId}`);
  await expect(page.getByRole("heading", { name: "You can't take this shift:" })).toBeVisible();
  await expect(page.getByText(/Your SIA door supervisor licence expired on /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Take shift" })).toHaveCount(0);

  await page
    .getByLabel("Anything the office should know? (optional)")
    .fill("I renewed it on Monday.");
  await page.getByRole("button", { name: "Ask the office to review" }).click();
  const confirmation = page.getByRole("status");
  await expect(confirmation).toContainText("We've sent this to the office.");
  await expect(confirmation).toContainText(/Reference: [0-9A-F]{8}/);
  await expect(confirmation).toContainText("Acme Events Shift Team");
  const ref = (await confirmation.textContent())?.match(/Reference: ([0-9A-F]{8})/)?.[1] ?? "";

  // Back on the page later: it says it's been asked, with the same reference.
  await page.reload();
  await expect(page.getByText(`Reference: ${ref}.`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask the office to review" })).toHaveCount(0);

  // And it's in My requests, waiting for the office.
  await page.getByRole("link", { name: "See my requests" }).click();
  await expect(page).toHaveURL(`${acme}/requests`);
  await expect(page.getByText(/^Review: /)).toBeVisible();
  await expect(page.getByText(`Reference ${ref}`)).toBeVisible();
  await expect(page.getByText("Waiting for the office")).toBeVisible();
});

test("a shift link that doesn't exist says so", async ({ page }) => {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900127");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo("+447700900127", asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
  await page.goto(`${acme}/shifts/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByRole("heading", { name: "We can't find that shift." })).toBeVisible();
});
