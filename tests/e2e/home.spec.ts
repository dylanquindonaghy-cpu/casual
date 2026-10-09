import { expect, test } from "./fixtures";

test("home page renders on a phone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ShiftDesk" })).toBeVisible();
});

test("a link that goes nowhere says so in plain words, with a way back", async ({ page }) => {
  // A mistyped page on a firm's portal, and a firm address that doesn't exist.
  for (const url of [
    "http://acme.localhost:3100/no-such-page",
    "http://no-such-firm.localhost:3100/",
  ]) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We can't find that page." })).toBeVisible();
    await expect(page.getByText("The link may be old or mistyped.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to my shifts" })).toBeVisible();
    await expect(page.getByText("404")).toHaveCount(0);
  }
});
