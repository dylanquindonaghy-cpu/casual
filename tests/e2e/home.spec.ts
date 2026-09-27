import { expect, test } from "@playwright/test";

test("home page renders on a phone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ShiftDesk" })).toBeVisible();
});
