import { expect, test } from "./fixtures";

// Light or dark (docs/office-v2.md 3.1; PLAN.md 12A.1): the sd-theme cookie's theme is in the page
// as the server sends it, so nothing flashes; with no cookie the device decides; a light cookie
// wins over a dark device. The firm's mark in its bar keeps its own colour either way.

const acme = "http://acme.localhost:3100";
// The page behind the cards (Phase 18: the canvas, in both themes).
const LIGHT_CANVAS = "rgb(242, 244, 247)"; // #f2f4f7
const DARK_CANVAS = "rgb(15, 22, 38)"; // #0f1626
const BRAND = "rgb(29, 78, 216)"; // the demo seed's Acme colour

test("the sd-theme cookie's theme arrives with the page: no flash", async ({ page, context }) => {
  const sent = await page.request.get(`${acme}/login`, { headers: { cookie: "sd-theme=dark" } });
  const html = await sent.text();
  expect(html).toMatch(/<html lang="en-GB" data-theme="dark"/);
  expect(html).toContain('<meta name="color-scheme" content="light dark"/>');

  await context.addCookies([{ name: "sd-theme", value: "dark", url: acme }]);
  await page.goto(`${acme}/login`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_CANVAS);
  await expect(page.getByTestId("brand-mark")).toHaveCSS("background-color", BRAND);
});

test("no cookie: light, or dark when the device says so", async ({ page }) => {
  await page.goto(`${acme}/login`);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await expect(page.locator("body")).toHaveCSS("background-color", LIGHT_CANVAS);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_CANVAS);
  await expect(page.getByTestId("brand-mark")).toHaveCSS("background-color", BRAND);
});

test("a light cookie wins over the device's dark setting; an unknown value is ignored", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await context.addCookies([{ name: "sd-theme", value: "light", url: acme }]);
  await page.goto(`${acme}/login`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", LIGHT_CANVAS);

  await context.addCookies([{ name: "sd-theme", value: "purple", url: acme }]);
  await page.goto(`${acme}/login`);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_CANVAS);
});
