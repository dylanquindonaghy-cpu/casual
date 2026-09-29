import type { Page } from "@playwright/test";
import { addOfficeUser, addSwapRequest } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// Answering a worker's request in a real browser: a resourcer opens Requests from Today, declines
// a swap request (a note is needed to decline), sees the confirmation, then sees it answered with
// the note and that the worker was told (or that telling them waits for quiet hours, if this runs
// at night). The request and the resourcer are this spec's own, so the demo's requests stay
// waiting for the Today spec and the seeded users' login links aren't used up.

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

test("decline a request with a note: the confirmation, then answered and the worker told", async ({
  page,
}) => {
  const email = "requests.resourcer@example.com";
  await addOfficeUser("acme", { email, name: "Requests Resourcer", role: "resourcer" });
  const note = "Could someone else take this one? (e2e)";
  const { ref, worker, firstName } = await addSwapRequest("acme", note);
  await officeLogin(page, email);

  await page.getByRole("link", { name: "See requests" }).click();
  await expect(page).toHaveURL(`${acme}/office/requests`);
  const waiting = page.getByRole("region", { name: "Waiting for an answer" });
  const card = waiting.locator("li", { hasText: `Reference ${ref}` });
  await expect(card.getByText(`Swap: ${worker}`)).toBeVisible();
  await expect(card.getByText(`Their note: ${note}`)).toBeVisible();
  await expect(card.getByText("Asks to swap (no one named).")).toBeVisible();

  // Declining needs a note.
  await card.getByRole("button", { name: `Decline and tell ${firstName}` }).click();
  await expect(card.getByText("Add a note saying why.")).toBeVisible();
  await card
    .getByLabel(`Note to ${firstName} (needed to decline)`)
    .fill("Sorry, we need you there.");
  await card.getByRole("button", { name: `Decline and tell ${firstName}` }).click();
  await expect(card.getByText(`Declined. ${firstName} will be told.`)).toBeVisible();

  // Answered, with the note; the worker process tells them (or holds it for quiet hours).
  const told = new RegExp(
    `${firstName} was told\\.|Telling ${firstName} waits for quiet hours to end\\.`,
  );
  await expect(async () => {
    await page.reload();
    const answered = page
      .getByRole("region", { name: "Answered in the last 7 days" })
      .locator("li", { hasText: `Reference ${ref}` });
    await expect(answered.getByText(/^Declined by Requests Resourcer at /)).toBeVisible({
      timeout: 1000,
    });
    await expect(answered.getByText("Note: Sorry, we need you there.")).toBeVisible({
      timeout: 1000,
    });
    await expect(answered.getByText(told)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(waiting.locator("li", { hasText: `Reference ${ref}` })).toHaveCount(0);
});
