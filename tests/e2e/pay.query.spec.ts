import { expect, test } from "./fixtures";
import { codeSentTo, loginLinkSentTo } from "./outbox";

// Raising a pay query in a real browser: behind the pay code, a day, what's wrong and a note, the
// confirmation, then the query listed on the pay page "With payroll". A different seeded worker
// from the pay spec, so the two don't share the per-number login and code limits.

const acme = "http://acme.localhost:3100";
const mobile = "+447700900103"; // a seeded Acme worker

test("raise a pay query about a day, then see it on the pay page", async ({ page }) => {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900103");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(mobile, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);

  // Without the pay code, the form points back to the pay page.
  await page.goto(`${acme}/pay/query`);
  await expect(
    page.getByText("To keep your pay private, enter your pay code first."),
  ).toBeVisible();

  await page.goto(`${acme}/pay`);
  const codeAsked = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(await codeSentTo(mobile, codeAsked));
  await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByRole("heading", { name: "Your pay queries" })).toBeVisible();
  await expect(page.getByText("None in the last 90 days.")).toBeVisible();

  await page.getByRole("link", { name: "Raise a pay query" }).click();
  await expect(page).toHaveURL(`${acme}/pay/query`);
  await page.getByLabel("Which shift?").selectOption({ label: "A day not in the list" });
  const threeDaysAgo = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
    new Date(Date.now() - 3 * 86_400_000),
  );
  await page.getByLabel("Which day?").fill(threeDaysAgo);
  // "Something else" needs a word or two.
  await page.getByLabel("Something else").check();
  await page.getByRole("button", { name: "Send pay query" }).click();
  await expect(page.getByText("Tell payroll what's wrong.", { exact: true })).toBeVisible();

  await page.getByLabel("Paid late or not paid").check();
  await page.getByLabel("Tell payroll more (optional)").fill("Not paid for this day yet (e2e).");
  await page.getByRole("button", { name: "Send pay query" }).click();
  await expect(page.getByText("Pay query sent.")).toBeVisible();
  await expect(page.getByText(/^Reference: [0-9A-F]{8}$/)).toBeVisible();
  await expect(page.getByText("Acme Events Shift Team")).toBeVisible();

  await page.getByRole("link", { name: "Back to your pay" }).click();
  await expect(page).toHaveURL(`${acme}/pay`);
  await expect(page.getByText(/^Paid late or not paid: \w{3} \d{1,2} \w{3}$/)).toBeVisible();
  await expect(page.getByText("With payroll")).toBeVisible();
});
