import { setFirmBrand } from "../../scripts/firm-brand-owner";
import { e2eAdminUrl } from "./db";
import { expect, test } from "./fixtures";

// Each firm's own bar at the top of its portal and office pages (Phase 8 branding): its name on its
// colour (the demo seed's), readable text, and its logo once one is set with the owner's script.
// The logo address uses the reserved .invalid name, so the browser never fetches anything.

const acme = "http://acme.localhost:3100";
const northline = "http://northline.localhost:3100";

test("each firm's pages open with its own bar: name, colour and readable text", async ({
  page,
}) => {
  await page.goto(`${acme}/login`);
  const bar = page.getByTestId("brand-bar");
  await expect(bar).toHaveText("Acme Events");
  await expect(bar).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(bar).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page).toHaveTitle("Acme Events shifts");
  await page.goto(`${acme}/office/login`);
  await expect(page.getByTestId("brand-bar")).toHaveText("Acme Events");

  await page.goto(`${northline}/login`);
  await expect(page.getByTestId("brand-bar")).toContainText("Northline");
  await expect(page.getByTestId("brand-bar")).toHaveCSS("background-color", "rgb(15, 118, 110)");
});

test("a logo set with the owner's script shows in the bar, beside the name", async ({ page }) => {
  const logo = "https://logo.acme.invalid/acme-events.png";
  expect(await setFirmBrand(e2eAdminUrl(), "acme", { logo })).toEqual({
    status: "saved",
    fields: ["logo"],
  });
  try {
    await page.goto(`${acme}/login`);
    const img = page.getByTestId("brand-bar").locator("img");
    await expect(img).toHaveAttribute("src", logo);
    await expect(img).toHaveAttribute("alt", "");
    await expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(page.getByTestId("brand-bar")).toContainText("Acme Events");
  } finally {
    await setFirmBrand(e2eAdminUrl(), "acme", { logo: null });
  }
});
