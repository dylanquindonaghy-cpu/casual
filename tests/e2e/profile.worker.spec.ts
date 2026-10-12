import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// The profile page in a real browser: qualifications as the office holds them, a day marked
// unavailable and cleared again, and the notification settings kept after a reload.

const acme = "http://acme.localhost:3100";
const mobile = "+447700900125"; // a seeded Acme worker whose SIA licence has expired

test("a worker checks their licences, marks a day off and changes how we reach them", async ({
  page,
}) => {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900125");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(mobile, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Profile" })
    .click();
  await expect(page).toHaveURL(`${acme}/profile`);
  // Each section has its own confirmation.
  const days = page.getByRole("region", { name: "Days you can't work" });
  const reach = page.getByRole("region", { name: "How we reach you" });
  await expect(page.getByText("To change these, ask the office.")).toBeVisible();
  // Qualifications (12F.1): the ones her roles need, worst first, then right to work.
  const quals = page.getByRole("region", { name: "Qualifications" });
  const rows = quals.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("SIA door supervisor licence");
  await expect(
    rows.nth(0).getByText(/^Expired · Expired \d{1,2} [A-Z][a-z]{2}( \d{4})?$/),
  ).toBeVisible();
  await expect(
    rows
      .nth(0)
      .getByText("Until it's renewed you won't see door supervisor shifts. Upload the new one."),
  ).toBeVisible();
  await expect(rows.nth(1)).toContainText("Level 2 spectator safety qualification");
  await expect(rows.nth(1).getByText("Valid · No expiry date")).toBeVisible();
  await expect(quals.getByText("Not checked yet: ask the office")).toBeVisible();
  await expect(page.getByText("No days marked.")).toBeVisible();

  // Three days from now, London time.
  const day = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Europe/London",
  });
  await page.getByLabel("A day you can't work").fill(day);
  await page.getByRole("button", { name: "Mark as unavailable" }).click();
  await expect(days.getByRole("status")).toContainText(/^Marked .+ as unavailable\./);
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1);
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(days.getByRole("status")).toContainText(/ is available again\./);
  await expect(page.getByText("No days marked.")).toBeVisible();

  await page.getByLabel("Text message").check();
  await page.getByLabel("Tell me about open shifts").uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(reach.getByRole("status")).toContainText(
    "Saved. We'll send shift messages by text message. We won't tell you about open shifts.",
  );
  await expect(reach.getByRole("status")).toContainText("Acme Events Shift Team");
  await page.reload();
  await expect(page.getByLabel("Text message")).toBeChecked();
  await expect(page.getByLabel("Tell me about open shifts")).not.toBeChecked();
});

test("the profile without logging in goes to the login page", async ({ page }) => {
  await page.goto(`${acme}/profile`);
  await expect(page).toHaveURL(`${acme}/login`);
});
