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
  // The e2e worker process tells them they're booked (Phase 10 task 19), or holds it for quiet
  // hours if this runs at night.
  const booked = new RegExp(
    `${name} was told they're booked\\.|Telling ${name} they're booked waits for quiet hours to end`,
  );
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(booked).first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });

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

  // The e2e worker process tells them. At night their booking message is still held, so the
  // change isn't sent separately: that message will give the new times.
  const told = new RegExp(
    `${name} was told about the change\\.|${name} wasn't told about the change: they hadn't been told about the booking yet`,
  );
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(told).first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  // Cancel the booking, with a reason and who asked (required: Phase 25.2). "The client needs
  // fewer staff" would take the place away, and this shift has only the one: refused, nothing
  // changed (Phase 10 task 19).
  await page.getByText(`Cancel ${name}'s booking`, { exact: true }).click();
  await page
    .locator("details[open]")
    .getByLabel("Why?")
    .selectOption({ label: "The client needs fewer staff" });
  await page.getByRole("button", { name: `Yes, cancel ${name}'s booking` }).click();
  await expect(page.getByText("Choose who asked for it.")).toBeVisible();
  const askedBy = page.locator("details[open]").getByLabel("Who asked for it?");
  // The casual by name, for one booking.
  await expect(askedBy.locator("option", { hasText: name })).toHaveCount(1);
  await askedBy.selectOption({ label: "The client" });
  await page.getByRole("button", { name: `Yes, cancel ${name}'s booking` }).click();
  await expect(
    page.getByText(
      "This is the shift's only place, so it can't go. To drop it, cancel the whole shift. Nothing was changed.",
    ),
  ).toBeVisible();
  await page
    .locator("details[open]")
    .getByLabel("Why?")
    .selectOption({ label: "Weather or safety" });
  await page.getByRole("button", { name: `Yes, cancel ${name}'s booking` }).click();
  const confirmation = page.getByText(
    new RegExp(`^Cancelled ${name}'s booking with \\d+ days' notice\\. They'll be told\\.$`),
  );
  await expect(confirmation).toBeVisible();
  // The page refreshes: the booking moves to Cancelled and its row, with its form, leaves the list.
  // The confirmation stays (it went with the row a moment after it showed, until Phase 22).
  await expect(page.getByText("Nobody booked yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cancelled", level: 3 })).toBeVisible();
  await expect(confirmation).toBeVisible();

  // The notice report says who asked (Phase 25.2), newest first.
  await page.goto(`${acme}/office/reports/notice?kind=cancellations`);
  const row = page
    .getByRole("region", { name: "Notice and cancellation report" })
    .locator("tr", { hasText: name })
    .filter({ hasText: "The office" })
    .first();
  await expect(row).toContainText("The client");
});
