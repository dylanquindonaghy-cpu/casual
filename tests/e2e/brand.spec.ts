import { setFirmBrand } from "../../scripts/firm-brand-owner";
import { e2eAdminUrl } from "./db";
import { expect, test } from "./fixtures";

// Each firm's own bar at the top of its portal and office pages (Phase 8 branding; Phase 18: a
// white header; Phase 20: on the page's grey, with no line under it; Phase 24: see-through, on the
// wash; Phase 27.6: on round 8's street map; Phase 27.7: on the plain ground): its initial on its
// colour (the demo seed's),
// readable, then its name, and its logo once
// one is set with the owner's script. The logo address uses the reserved .invalid name, so the
// browser never fetches anything.

const acme = "http://acme.localhost:3100";
const northline = "http://northline.localhost:3100";

test("each firm's pages open with its own bar: name, mark and readable text", async ({ page }) => {
  await page.goto(`${acme}/login`);
  const bar = page.getByTestId("brand-bar");
  await expect(bar).toHaveCSS("background-color", "rgba(0, 0, 0, 0)"); // the plain ground shows
  await expect(page.getByTestId("brand-name")).toHaveText("Acme Events");
  const mark = page.getByTestId("brand-mark");
  await expect(mark).toHaveText("A");
  // Phase 32 (32.1, the approved mock-up): the firm's mark is the office's lime, its initial in dark
  // olive (Acme's own blue until then).
  await expect(mark).toHaveCSS("background-color", "rgb(233, 248, 111)");
  await expect(mark).toHaveCSS("color", "rgb(23, 24, 0)");
  // "Offline" shows only in the copy kept for no signal.
  await expect(bar.getByText("Offline")).toBeHidden();
  await expect(page).toHaveTitle("Acme Events shifts");
  await page.goto(`${acme}/office/login`);
  await expect(page.getByTestId("brand-name")).toHaveText("Acme Events");
  // Round 8 (Phase 26): the office is hi-vis inside; since Phase 32 the firm's mark over its login
  // is the same lime.
  await expect(page.getByTestId("brand-mark")).toHaveCSS("background-color", "rgb(233, 248, 111)");
  await expect(page.getByRole("button", { name: "Send me a link" })).toHaveCSS(
    "background-color",
    "rgb(233, 248, 111)",
  );

  // The casual app's main button: the firm's own colour from Phase 17 to Phase 31; since Phase 32
  // (32.3, the approved mock-up) the office's lime with dark olive words, one flat colour (the
  // gradient's two ends the same), in the light look and the dark.
  await page.goto(`${acme}/login`);
  const send = page.getByRole("button", { name: "Send me a link" });
  await expect(send).toHaveCSS("background-color", "rgb(233, 248, 111)");
  await expect(send).toHaveCSS(
    "background-image",
    /^linear-gradient\((?:180deg, )?rgb\(233, 248, 111\), rgb\(233, 248, 111\)\)$/,
  );
  await expect(send).toHaveCSS("color", "rgb(23, 24, 0)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(15, 15, 16)");
  await expect(send).toHaveCSS("background-color", "rgb(233, 248, 111)");
  await expect(send).toHaveCSS("color", "rgb(23, 24, 0)");
  await expect(page.getByTestId("brand-mark")).toHaveCSS("background-color", "rgb(233, 248, 111)");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto(`${northline}/login`);
  await expect(page.getByTestId("brand-name")).toContainText("Northline");
  // Every firm's mark and main button the same lime since Phase 32 (Northline's teal until then).
  await expect(page.getByTestId("brand-mark")).toHaveCSS("background-color", "rgb(233, 248, 111)");
  await expect(page.getByRole("button", { name: "Send me a link" })).toHaveCSS(
    "background-color",
    "rgb(233, 248, 111)",
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
