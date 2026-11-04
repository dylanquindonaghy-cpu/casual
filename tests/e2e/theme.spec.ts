import { expect, test } from "./fixtures";

// Light or dark (docs/office-v2.md 3.1; PLAN.md 12A.1): the sd-theme cookie's theme is in the page
// as the server sends it, so nothing flashes; with no cookie the device decides; a light cookie
// wins over a dark device. The firm's mark in its bar keeps its own colour either way.

const acme = "http://acme.localhost:3100";
// The page behind the glass (Phase 18: the canvas, in both themes; Phase 20: dark greys, D7;
// Phase 24: the wash's base; Phase 27.6: round 8's ground, off-white or charcoal, as the office's;
// Phase 27.7: the plain colour behind every page, nothing drawn over it).
const LIGHT_CANVAS = "rgb(242, 242, 240)"; // #f2f2f0
const DARK_CANVAS = "rgb(15, 15, 16)"; // #0f0f10
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

// Round 8 (Phase 26): the office has its own look, dark until someone picks light, whatever the
// device says; the casual pages above still follow the device (in round 8's colours since Phase
// 27.6, so on a light device with no cookie the casual page is off-white while the office is
// charcoal).
const OFFICE = { dark: "rgb(15, 15, 16)", light: "rgb(242, 242, 240)" }; // #0f0f10, #f2f2f0

test("the office: dark with no cookie on a light device; light only when picked", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${acme}/office/login`);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await expect(page.locator("body")).toHaveCSS("background-color", OFFICE.dark);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  // The casual login on the same light device, no cookie: light (it follows the phone).
  await page.goto(`${acme}/login`);
  await expect(page.locator("body")).toHaveCSS("background-color", LIGHT_CANVAS);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");

  await context.addCookies([{ name: "sd-theme", value: "light", url: acme }]);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${acme}/office/login`);
  await expect(page.locator("body")).toHaveCSS("background-color", OFFICE.light);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  // The casual login, on the same device, takes the light cookie too.
  await page.goto(`${acme}/login`);
  await expect(page.locator("body")).toHaveCSS("background-color", LIGHT_CANVAS);
});
