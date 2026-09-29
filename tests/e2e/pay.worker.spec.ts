import { expect, test } from "./fixtures";
import { codeSentTo, loginLinkSentTo } from "./outbox";

// The pay pages' step-up in a real browser: a 6-digit code by WhatsApp (console mode).

const acme = "http://acme.localhost:3100";
const mobile = "+447700900102"; // a seeded Acme worker

test("pay needs a code: a wrong one counts down, the right one opens the page", async ({
  page,
}) => {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900102");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(mobile, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);

  await page.getByRole("link", { name: "See your pay" }).click();
  await expect(page).toHaveURL(`${acme}/pay`);
  await expect(page.getByText("To see your pay, we'll send you a 6-digit code.")).toBeVisible();
  const codeAsked = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Send me a code" }).click();
  const code = await codeSentTo(mobile, codeAsked);

  // A reload (or the phone dropping the tab while they read WhatsApp) keeps the code field.
  await page.reload();
  await expect(page.getByLabel("Your code")).toBeVisible();

  const wrong = code === "000000" ? "111111" : "000000";
  await page.getByLabel("Your code").fill(wrong);
  await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByText("That code isn't right. You have 4 tries left.")).toBeVisible();

  await page.getByLabel("Your code").fill(code);
  await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByText("No pay data yet for this period.")).toBeVisible();

  // Still open after a reload (30 minutes).
  await page.reload();
  await expect(page.getByText("No pay data yet for this period.")).toBeVisible();
});

test("pay without logging in goes to the login page", async ({ page }) => {
  await page.goto(`${acme}/pay`);
  await expect(page).toHaveURL(`${acme}/login`);
});
