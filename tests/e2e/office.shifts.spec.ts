import type { Page } from "@playwright/test";
import { accountMenu, expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office's shift screens in a real browser, on the demo seed: a resourcer creates a shift,
// checks someone against the rules and assigns them, creates several for an event, and imports a
// small file (checked first). Dates are 12+ days ahead, clear of the demo Saturday.

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
  // Payroll's home is the pay dashboard: /office sends them on (12A.3).
  await expect(page).toHaveURL(new RegExp(`^${acme.replace(/\./g, "\\.")}/office(/pay)?$`));
}

// yyyy-mm-dd, `days` from today (London and the machine agree closely enough 12+ days out).
const dayFromNow = (days: number) => {
  const d = new Date(Date.now() + days * 24 * 3_600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("a resourcer creates a shift and assigns someone the rules allow", async ({ page }) => {
  await officeLogin(page, "acme.resourcer@example.com");
  await (await menuLink(page, "Shifts")).click();
  await expect(page.getByRole("heading", { name: "Shifts", exact: true })).toBeVisible();
  // The tab names the page first (src/app/layout.tsx's template).
  await expect(page).toHaveTitle("Shifts · Acme Events shifts");
  // On a phone the menu is a drawer (12A.2; it was a sideways row): shut again once a link is
  // chosen, with "Menu" there to open it (tests/e2e/office.shell.spec.ts drives it fully).
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Office menu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "New shift" }).click();
  await page.getByLabel("Date").fill(dayFromNow(12));
  await page.getByLabel("Role").fill("steward");
  await page.getByLabel("Start").fill("10:00");
  await page.getByLabel("Finish").fill("18:00");
  await page.getByLabel("Places").fill("2");
  await page.getByRole("button", { name: "Create shift" }).click();
  await expect(page).toHaveURL(/\/office\/shifts\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Steward", level: 1 })).toBeVisible();
  await expect(page.getByText("0 of 2 booked · Open")).toBeVisible();
  await expect(page.getByText(/Created by /)).toBeVisible(); // the history

  // Check people in turn until the rules say yes, then assign them.
  const options = await page
    .getByLabel("Who?")
    .locator("option:not([disabled])")
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  let name = "";
  for (const value of options.slice(0, 8)) {
    await page.getByLabel("Who?").selectOption(value);
    await page.getByRole("button", { name: "Check" }).click();
    const yes = page.getByText(/^The rules say (.+) can work this shift\.$/);
    if (await yes.isVisible()) {
      name = ((await yes.textContent()) ?? "").replace(/^The rules say (.+) can work.*$/, "$1");
      break;
    }
  }
  expect(name).not.toBe("");
  await page.getByRole("button", { name: `Assign ${name}` }).click();
  await expect(page.getByText(`${name} is booked on this shift.`)).toBeVisible();
  await expect(page.getByText("1 of 2 booked · Open")).toBeVisible();
});

test("several shifts for an event, and a file import checked first", async ({ page }) => {
  await officeLogin(page, "acme.admin@example.com");
  await page.goto(`${acme}/office/shifts/event`);
  await page.getByLabel("Date").fill(dayFromNow(13));
  const lines = page.getByRole("group");
  await lines.nth(0).getByLabel("Role").fill("steward");
  await lines.nth(0).getByLabel("Start").fill("08:00");
  await lines.nth(0).getByLabel("Finish").fill("16:00");
  await lines.nth(1).getByLabel("Role").fill("door supervisor");
  await lines.nth(1).getByLabel("Start").fill("20:00");
  await lines.nth(1).getByLabel("Finish").fill("04:00");
  await page.getByRole("button", { name: "Create these shifts" }).click();
  await expect(page.getByText("2 shifts created.")).toBeVisible();

  await page.goto(`${acme}/office/shifts/import`);
  const [y, m, d] = dayFromNow(14).split("-");
  // The file field waits for the page (docs/ui-design.md "Forms wait for the page"): a file chosen
  // before then would be lost.
  await expect(page.getByLabel("Your file (.csv or .xlsx)")).toBeEnabled();
  await page.getByLabel("Your file (.csv or .xlsx)").setInputFiles({
    name: "shifts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`Date,Start,End,Role,Needed\n${d}/${m}/${y},09:00,17:00,Steward,3\n`),
  });
  await page.getByRole("button", { name: "Check the file" }).click();
  await expect(
    page.getByText("This file would add 1 shift, change 0, leave 0 as they are and skip 0."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import these shifts" }).click();
  await expect(
    page.getByText("Imported: 1 shift added, 0 changed, 0 left as they were, 0 skipped."),
  ).toBeVisible();
  await page.goto(`${acme}/office/shifts?from=${dayFromNow(14)}`);
  await expect(page.getByRole("link", { name: /09:00 to 17:00 · Steward/ }).first()).toBeVisible();
});

test("payroll doesn't get the shift screens", async ({ page }) => {
  await officeLogin(page, "acme.payroll@example.com");
  // Absent from the menu itself (opened first, so the check can't pass just because it's shut).
  await expect(await menuLink(page, "Pay queries")).toBeVisible();
  await expect(await menuLink(page, "Shifts")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const response = await page.goto(`${acme}/office/shifts`);
  expect(response?.status()).toBe(404);
  // The office's own not-found page (src/app/office/not-found.tsx): plain words, and the way back
  // leads to the office, not to the staff app.
  await expect(page.getByRole("heading", { name: "We can't find that page." })).toBeVisible();
  await expect(page.getByText("The link may be old or mistyped.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the office" })).toHaveAttribute(
    "href",
    "/office",
  );
  await expect(page.getByRole("link", { name: "Go to my shifts" })).toHaveCount(0);
  await expect(page.getByText("404")).toHaveCount(0);
  // It keeps the office shell: the menu, and the account menu's one "Log out".
  await expect(await menuLink(page, "Pay queries")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect((await accountMenu(page)).getByRole("button", { name: "Log out" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(1);
});
