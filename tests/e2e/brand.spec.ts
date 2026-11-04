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

test("each firm's pages open with its own bar: name, colour and readable text", async ({
  page,
}) => {
  await page.goto(`${acme}/login`);
  const bar = page.getByTestId("brand-bar");
  await expect(bar).toHaveCSS("background-color", "rgba(0, 0, 0, 0)"); // the plain ground shows
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
  // Round 8 (Phase 26): the office is hi-vis inside, but the firm's bar over its login keeps the
  // firm's own colour.
  await expect(page.getByTestId("brand-mark")).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(page.getByRole("button", { name: "Send me a link" })).toHaveCSS(
    "background-color",
    "rgb(233, 248, 111)",
  );

  // The casual app's main button is in the firm's own colour too (Phase 17): tinted glass since
  // Phase 24, the blue as it reads on every point of the glass and its own tint (over the plain
  // ground since Phase 27.7: Acme's own #1d4ed8; #1b49cb over round 8's street lines, #1a45bf on
  // round 7's wash) to its shade (#1840b1, was #163ca6).
  await page.goto(`${acme}/login`);
  const send = page.getByRole("button", { name: "Send me a link" });
  await expect(send).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(send).toHaveCSS(
    "background-image",
    /^linear-gradient\((?:180deg, )?rgb\(29, 78, 216\), rgb\(24, 64, 177\)\)$/,
  );
  await expect(send).toHaveCSS("color", "rgb(255, 255, 255)");
  // And in the dark look (Phase 27.6, Dylan: "firm's colour"): round 8's charcoal, the firm's colour
  // still on the main button with its white words (the light set's: they read on themselves),
  // never the office's hi-vis.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(15, 15, 16)");
  await expect(send).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(send).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByTestId("brand-mark")).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto(`${northline}/login`);
  await expect(page.getByTestId("brand-name")).toContainText("Northline");
  await expect(page.getByTestId("brand-mark")).toHaveCSS("background-color", "rgb(15, 118, 110)");
  // Northline's teal on its band as it is; its button darker (#0e6f67 over the plain ground since
  // Phase 27.7; #0c625b over round 8's street lines, #0c5c56 on round 7's wash), so its words read
  // on its own pale tint over round 8's glass too.
  await expect(page.getByRole("button", { name: "Send me a link" })).toHaveCSS(
    "background-color",
    "rgb(14, 111, 103)",
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
