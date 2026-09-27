import { expect, test } from "./fixtures";

test("home page renders on a phone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ShiftDesk" })).toBeVisible();
});
