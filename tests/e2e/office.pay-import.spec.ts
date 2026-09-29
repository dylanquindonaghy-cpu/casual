import { addOfficeUser } from "./db";
import { expect, test } from "./fixtures";
import { codeSentTo, loginLinkSentTo, sentTo } from "./outbox";

// Payroll imports a pay file in a real browser: check it (nothing saved), import it, then the
// worker sees the line on their pay page behind the pay code. A seeded Acme worker no other spec
// logs in as, and a payroll user of this spec's own (the login limits are per number and email).

const acme = "http://acme.localhost:3100";
const mobile = "+447700900111";

// dd/mm/yyyy, London time, `days` from today.
const ukDate = (days: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London" }).format(
    new Date(Date.now() + days * 86_400_000),
  );

test("payroll checks and imports a pay file; the worker sees the line", async ({ page }) => {
  const email = "import.payroll@example.com";
  await addOfficeUser("acme", { email, name: "Import Payroll", role: "payroll" });
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/));
  await page.getByRole("button", { name: "Log me in" }).click();
  await page.getByRole("link", { name: "Import pay records" }).click();
  await expect(page).toHaveURL(`${acme}/office/pay/import`);
  await expect(page.getByRole("heading", { name: "Import pay records" })).toBeVisible();

  // A week ending 3 days ago, at a rate no seeded line has; and a row for nobody here.
  const file = [
    "Mobile,Period start,Period end,Hours,Rate,Gross pay,Pay date",
    `07700 900111,${ukDate(-9)},${ukDate(-3)},12.5,19.87,248.38,${ukDate(-1)}`,
    `07700 900999,${ukDate(-9)},${ukDate(-3)},8,13.00,,`,
  ].join("\n");
  await page.getByLabel("Your file (.csv or .xlsx)").setInputFiles({
    name: "pay.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(file),
  });
  await page.getByRole("button", { name: "Check the file" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText(
    "This file would add 1 pay line, change 0, leave 0 as they are and skip 1.",
  );
  await expect(status).toContainText("Row 3: no worker here has that staff ID or mobile.");
  await page.getByRole("button", { name: "Import these pay records" }).click();
  await expect(status).toContainText(
    "Imported: 1 pay line added, 0 changed, 0 left as they were, 1 skipped.",
  );
  await expect(page.getByRole("link", { name: "Go to pay queries" })).toBeVisible();

  // The worker, with their pay code, sees it.
  const linkAsked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900111");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(mobile, linkAsked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
  await page.goto(`${acme}/pay`);
  const codeAsked = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(await codeSentTo(mobile, codeAsked));
  await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByText("12.5 hours at £19.87 an hour")).toBeVisible();
  await expect(page.getByText("Gross pay: £248.38")).toBeVisible();
});
