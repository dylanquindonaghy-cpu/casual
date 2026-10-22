import { setFirmBrand } from "../../scripts/firm-brand-owner";
import { e2eAdminUrl } from "./db";
import { expect, test } from "./fixtures";

// Each firm's own bar at the top of its portal and office pages (Phase 8 branding; Phase 18: a
// white header; Phase 20: on the page's grey, with no line under it): its initial on its colour
// (the demo seed's), readable, then its name, and its logo once one is set with the owner's
// script. The logo address uses the reserved .invalid name, so the browser never fetches anything.

const acme = "http://acme.localhost:3100";
const northline = "http://northline.localhost:3100";

test("each firm's pages open with its own bar: name, colour and readable text", async ({
  page,
}) => {
  await page.goto(`${acme}/login`);
  const bar = page.getByTestId("brand-bar");
  await expect(bar).toHaveCSS("background-color", "rgb(238, 240, 243)"); // the page's grey (Phase 20)
  await expect(page.getByTestId("brand-name")).toHaveText("Acme Events");
  const mark = page.getByTestId("brand-mark");
  await expect(mark).toHaveText("A");
  await expect(mark).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(mark).toHaveCSS("color", "rgb(255, 255, 255)");
  // "Offline" shows only in the copy kept for no signal.
  await expect(bar.getByText("Offline")).toBeHidden();
  await expect(page).toHaveTitle("Acme Events shifts");
  await page.goto(`${acme}/office/login`);
  await expect(page.getByTestId("brand-name")).toHaveText("Acme Events");

  // The casual app's main button is in the firm's own colour too (Phase 17).
  await page.goto(`${acme}/login`);
  const send = page.getByRole("button", { name: "Send me a link" });
  await expect(send).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(send).toHaveCSS("color", "rgb(255, 255, 255)");

  await page.goto(`${northline}/login`);
  await expect(page.getByTestId("brand-name")).toContainText("Northline");
  await expect(page.getByTestId("brand-mark")).toHaveCSS("background-color", "rgb(15, 118, 110)");
  await expect(page.getByRole("button", { name: "Send me a link" })).toHaveCSS(
    "background-color",
    "rgb(15, 118, 110)",
  );
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
    await expect(page.getByTestId("brand-name")).toHaveText("Acme Events");
    // The logo in place of the initial.
    await expect(page.getByTestId("brand-mark")).toHaveCount(0);
  } finally {
    await setFirmBrand(e2eAdminUrl(), "acme", { logo: null });
  }
});
