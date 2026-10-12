import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// The urgent board in a real browser, on the demo seed's Saturday: the early door supervisor
// shift at the arena is the urgent dropout. A free door supervisor with a valid licence sees it
// on My shifts and the board, and takes it; a steward sees no urgent gaps.

const acme = "http://acme.localhost:3100";

async function logIn(page: Page, typed: string, e164: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill(typed);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(e164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();
}

test("a free door supervisor sees the urgent dropout and takes it", async ({ page }) => {
  await logIn(page, "07700 900138", "+447700900138"); // Acme worker 38: valid SIA, unbooked
  // Home's urgent shifts (12H.1): the dropout, with its role · event and site.
  const onHome = page.getByRole("region", { name: "Urgent: needed now, and you can take them" });
  await expect(onHome.getByRole("listitem")).toHaveCount(1);
  await expect(onHome).toContainText("Door supervisor");
  await expect(onHome).toContainText("Acme Demo Arena");
  await onHome.getByRole("link", { name: "See urgent shifts" }).click();
  await expect(page).toHaveURL(`${acme}/urgent`);
  await expect(page.getByRole("heading", { name: "Urgent shifts" })).toBeVisible();
  const card = page.getByRole("listitem");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Urgent");
  await expect(card).toContainText(/08:00 to 16:00/);
  await expect(card).toContainText("Door supervisor");
  await expect(card).toContainText("Acme Demo Arena");
  await card.getByRole("button", { name: "Take shift" }).click();
  await expect(page.getByText("You're booked.")).toBeVisible();
  await page.getByRole("link", { name: "See my shifts" }).click();
  await expect(page.getByRole("heading", { name: "Your next shift" })).toBeVisible();
  // Filled now: no urgent gap left for anyone.
  await expect(
    page.getByRole("region", { name: "Urgent: needed now, and you can take them" }),
  ).toHaveCount(0);
});

test("a steward sees no urgent gaps: the urgent shift needs a door supervisor", async ({
  page,
}) => {
  await logIn(page, "07700 900101", "+447700900101"); // a free steward
  await expect(page.getByRole("heading", { name: /urgent shifts? needs? someone/ })).toHaveCount(0);
  await page.goto(`${acme}/urgent`);
  await expect(page.getByText("No urgent gaps right now.")).toBeVisible();
  await expect(page.getByRole("link", { name: "See all open shifts" })).toBeVisible();
});
