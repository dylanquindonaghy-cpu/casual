import type { Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// The action log in a real browser, on the demo seed (its bookings and the urgent dropout are
// logged when it's seeded): filter by type, then by the worker who cancelled, then follow their
// shift to its page and back to the log for that shift. The resourcer is this spec's own (the
// seeded ones' login links are used up by the other office specs: 3 per email every 15 minutes).

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

test("filter the action log by type and worker, and follow a shift", async ({ page }) => {
  const email = "log.resourcer@example.com";
  await addOfficeUser("acme", { email, name: "Log Resourcer", role: "resourcer" });
  await officeLogin(page, email);

  await page.getByRole("link", { name: "Action log" }).click();
  await expect(page).toHaveURL(`${acme}/office/log`);
  await expect(page.getByRole("heading", { name: "Action log" })).toBeVisible();
  // Someone logging in is logged too: this spec's own login is there.
  await expect(page.getByText("Log Resourcer logged in.").first()).toBeVisible();

  // Cancellations only.
  await page.getByLabel("Type").selectOption({ label: "Cancellations" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/type=cancellations/);
  const lines = page.locator("main li");
  await expect(lines.first()).toBeVisible();
  // Each line's first <p> is "{time} · {type}" (src/app/office/log/page.tsx).
  for (const kind of await lines.locator("p:first-child").allTextContents()) {
    expect(kind).toMatch(/ · Cancellations$/);
  }
  // A worker's own cancellation (the demo's dropout, or one another spec made).
  // (Matched on the words' own line: the whole item starts with the time.)
  const ownWords = /^[A-Z][a-z]+ [A-Z][a-z]+ cancelled, with /;
  const own = lines.filter({ has: page.locator("p", { hasText: ownWords }) }).first();
  const text = (await own.locator("p").nth(1).textContent()) ?? "";
  const name = /^([A-Z][a-z]+ [A-Z][a-z]+) cancelled/.exec(text)?.[1] ?? "";
  expect(name).not.toBe("");

  // That worker, every type.
  await page.getByLabel("Worker").selectOption({ label: name });
  await page.getByLabel("Type").selectOption({ label: "All types" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/worker=[0-9a-f-]{36}/);
  await expect(page.getByText(new RegExp(`^${name} cancelled, with `)).first()).toBeVisible();
  await expect(page.getByText(`${name} took it.`).first()).toBeVisible();

  // Their shift's page, then that shift in the log.
  await lines
    .filter({ has: page.locator("p", { hasText: new RegExp(`^${name} cancelled, with `) }) })
    .first()
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/office\/shifts\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "See this shift in the action log" }).click();
  await expect(page).toHaveURL(/\/office\/log\?shift=[0-9a-f-]{36}$/);
  await expect(page.getByText("Everything logged for this shift.")).toBeVisible();
  await expect(page.getByText(new RegExp(`^${name} cancelled, with `)).first()).toBeVisible();
});
