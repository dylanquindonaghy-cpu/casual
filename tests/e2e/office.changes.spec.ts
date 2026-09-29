import type { Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// Firm-initiated changes in a real browser (golden rule 12): a resourcer makes a shift of their
// own (so the demo data other specs use is untouched), books someone, moves it with a reason, sees
// the notice logged in its history, then cancels the booking. The worker's messages come from the
// e2e worker process through the console outbox. The resourcer is this spec's own (the seeded ones'
// login links are used up by the other office specs: 3 per email every 15 minutes).

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

const dayFromNow = (days: number) => {
  const d = new Date(Date.now() + days * 24 * 3_600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("move a booked shift with a reason, see the notice logged, then cancel the booking", async ({
  page,
}) => {
  const email = "changes.resourcer@example.com";
  await addOfficeUser("acme", { email, name: "Changes Resourcer", role: "resourcer" });
  await officeLogin(page, email);
  await page.goto(`${acme}/office/shifts/new`);
  await page.getByLabel("Date").fill(dayFromNow(16));
  await page.getByLabel("Role").fill("steward");
  await page.getByLabel("Start").fill("09:00");
  await page.getByLabel("Finish").fill("17:00");
  await page.getByRole("button", { name: "Create shift" }).click();
  await expect(page).toHaveURL(/\/office\/shifts\/[0-9a-f-]{36}$/);

  // Book someone the rules allow.
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
  await page.reload();

  // Move it: a reason is required.
  await expect(page.getByRole("heading", { name: "Move, shorten or cancel" })).toBeVisible();
  await page.getByLabel("New start").fill("11:00");
  await page.getByLabel("New finish").fill("19:00");
  await page.getByRole("button", { name: "Move for everyone booked" }).click();
  await expect(page.getByText("Choose a reason.")).toBeVisible();
  await page.locator("#move-reason").selectOption({ label: "The event's times or place changed" });
  await page.getByRole("button", { name: "Move for everyone booked" }).click();
  await expect(
    page.getByText(/^Moved\. 1 person booked will be told\. Their notice: \d+ days' notice\.$/),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(
      new RegExp(
        `moved ${name}'s shift, with \\d+ days' notice\\. Reason: The event's times or place changed\\.`,
      ),
    ),
  ).toBeVisible();

  // The e2e worker process tells them (or holds it for quiet hours, if this runs at night).
  const told = new RegExp(
    `${name} was told about the change\\.|Telling ${name} waits for quiet hours to end`,
  );
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(told).first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  // Cancel the booking, with a reason.
  await page.getByText(`Cancel ${name}'s booking`, { exact: true }).click();
  await page
    .locator("details[open]")
    .getByLabel("Why?")
    .selectOption({ label: "The client needs fewer staff" });
  await page.getByRole("button", { name: `Yes, cancel ${name}'s booking` }).click();
  await expect(
    page.getByText(
      new RegExp(`^Cancelled ${name}'s booking with \\d+ days' notice\\. They'll be told\\.$`),
    ),
  ).toBeVisible();
});
