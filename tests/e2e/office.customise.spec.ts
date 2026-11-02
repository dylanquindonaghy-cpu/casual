import type { Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// Contracts and Customise in a real browser (Phase 26.3; the spec page's "Customise and contracts"):
// an admin of this spec's own adds a contract on Settings with one of the demo's venues; under
// Customise (a panel from the right on a laptop, the whole screen on a phone) they look after it
// and add the Fill rate card; the dashboard is then narrowed to it ("My contracts" on) and shows
// the card; switching "My contracts" off shows everything; the contract is removed again. Their
// own login, so their choices touch nobody else's dashboard.

const acme = "http://acme.localhost:3100";

async function officeLogin(page: Page, email: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
}

test("a contract on Settings, looked after under Customise: the dashboard narrowed to it, with the card chosen", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const email = `customise.admin${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Customise Admin", role: "admin" });
  const name = `Custom Council ${Date.now() % 100_000}`;
  await officeLogin(page, email);

  // Settings: a new contract with the demo's arena.
  await page.goto(`${acme}/office/settings#contracts`);
  const contracts = page.getByRole("region", { name: "Contracts" });
  const add = contracts.locator("form").last();
  await add.getByLabel("Name").fill(name);
  await add.getByRole("checkbox", { name: /^Acme Demo Arena/ }).check();
  await add.getByRole("button", { name: "Add a contract" }).click();
  await expect(add.getByRole("status")).toHaveText(`Saved ${name}.`);

  // Customise: the panel, the contract switched on, Fill rate ticked, saved.
  await page.goto(`${acme}/office`);
  await expect(page.locator("dialog[data-offer-panel][data-ready]")).toHaveCount(1);
  await page.getByRole("link", { name: "Customise" }).click();
  const panel = page.getByRole("dialog", { name: "Customise your dashboard" });
  await expect(panel).toBeVisible();
  // As a person does it: the row (the switch's label); the switch's own input is for the keyboard.
  const contract = panel.getByRole("switch", { name: new RegExp(`^${name}`) });
  await expect(contract).not.toBeChecked();
  await panel.locator("label", { hasText: name }).click();
  await expect(contract).toBeChecked();
  await panel.getByRole("checkbox", { name: /^Fill rate/ }).check();
  await panel.getByRole("button", { name: "Save my dashboard" }).click();
  await expect(panel).toBeHidden();

  // The dashboard: narrowed to the contract ("My contracts" on), the Fill rate card with it.
  const mine = page.getByRole("switch", { name: "My contracts" });
  await expect(mine).toHaveAttribute("aria-checked", "true");
  const fill = page.locator("section#fill-rate");
  await expect(fill.getByRole("heading", { name: "Fill rate" })).toBeVisible();
  await expect(fill).toContainText(name);
  // Every pin on the map is the arena's (the only venue of the contract).
  const pins = page.locator("[data-venue-map] [data-venue]");
  for (const label of await pins.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))))
    expect(label).toMatch(/^Acme Demo Arena:/);

  // My contracts off: everything, and the address says so.
  await mine.click();
  await expect(page).toHaveURL(`${acme}/office?all=1`);
  await expect(page.getByRole("switch", { name: "My contracts" })).toHaveAttribute(
    "aria-checked",
    "false",
  );

  // Removed again (its venue stays): the dashboard shows everything with no switch.
  await page.goto(`${acme}/office/settings#contracts`);
  const row = page.getByRole("region", { name: "Contracts" }).locator("li", {
    has: page.getByRole("textbox", { name: "Name" }).and(page.locator(`[value="${name}"]`)),
  });
  await row.getByText("Remove", { exact: true }).click();
  await row.getByRole("button", { name: "Yes, remove it" }).click();
  await expect(row.getByRole("status")).toHaveText("Removed.");
  await page.goto(`${acme}/office`);
  await expect(page.getByRole("switch", { name: "My contracts" })).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Customise covers the whole screen", async ({ page }, testInfo) => {
    const email = `customise.phone${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Customise Phone", role: "resourcer" });
    await officeLogin(page, email);
    await expect(page.locator("dialog[data-offer-panel][data-ready]")).toHaveCount(1);
    await page.getByRole("link", { name: "Customise" }).click();
    const panel = page.getByRole("dialog", { name: "Customise your dashboard" });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect([box?.x, box?.y, box?.width, box?.height].map((n) => Math.round(n ?? -1))).toEqual([
      0, 0, 390, 844,
    ]);
    // Close: back where it was.
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole("link", { name: "Customise" })).toBeFocused();
  });
});
