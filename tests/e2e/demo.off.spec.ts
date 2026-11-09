import { expect, test } from "./fixtures";

// Without demo mode (the main browser run, as every real server): no Demo phone and no demo bar
// (16.1; ADR-025). Demo mode itself is tested on the walkthrough's build (demo.spec.ts).

const acme = "http://acme.localhost:3100";

test("there's no Demo phone and no demo bar without demo mode", async ({ page }) => {
  const answer = await page.goto(`${acme}/demo`);
  expect(answer?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Demo phone" })).toHaveCount(0);
  await page.goto(`${acme}/login`);
  await expect(page.getByLabel("Your mobile number")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Demo" })).toHaveCount(0);
});

test("there's no staffing demo login and no 'Choose a view' without demo mode (Phase 31)", async ({
  page,
}) => {
  for (const path of ["/start/login", "/start", "/start/phone"]) {
    const answer = await page.goto(`${acme}${path}`);
    expect(answer?.status(), path).toBe(404);
  }
  await page.goto(`${acme}/office/login`);
  await expect(page.getByLabel("Your work email")).toBeVisible();
  await expect(page.getByRole("link", { name: /staffing account/ })).toHaveCount(0);
});
