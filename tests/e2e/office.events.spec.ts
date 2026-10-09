import type { Page } from "@playwright/test";
import { addEventWithSession, addOfficeUser, addSteward } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// Events & sessions in a real browser (12B.5): a resourcer switches an event off on its card and a
// casual's Open shifts loses its session; switched back on, it's there again. The event, the
// casual and the resourcer are this spec's own (made-up details), so nothing another spec sees
// changes.

const acme = "http://acme.localhost:3100";
const EVENT = "Switch Test Gala";
const SITE = "Switch Test Hall";
const RESOURCER = "events.resourcer@example.com";
const CASUAL = { firstName: "Esme", lastName: "Switch", mobileE164: "+447700900612" };

async function officeLogin(page: Page) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(RESOURCER);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(RESOURCER, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
}

async function casualLogin(page: Page) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900612");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(CASUAL.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
}

test("switching an event off hides it from a casual's open shifts; on again brings it back", async ({
  browser,
}) => {
  const { shiftId } = await addEventWithSession("acme", {
    name: EVENT,
    site: SITE,
    role: "steward",
    daysAhead: 3,
  });
  await addSteward("acme", CASUAL);
  await addOfficeUser("acme", { email: RESOURCER, name: "Events Resourcer", role: "resourcer" });

  const office = await (await browser.newContext()).newPage();
  const casual = await (await browser.newContext()).newPage();
  await officeLogin(office);
  await casualLogin(casual);
  // Its card on the casual's Open shifts (found by its site, which only it has).
  const session = casual.getByRole("listitem").filter({ hasText: SITE });
  await casual.goto(`${acme}/shifts/open`);
  await expect(session).toHaveCount(1);

  // The resourcer finds the event's card and switches it off.
  await (await menuLink(office, "Events & sessions")).click();
  await expect(office.getByRole("heading", { name: "Events & sessions", level: 1 })).toBeVisible();
  const card = office.getByRole("article", { name: EVENT });
  await expect(card.getByText("Showing to casuals", { exact: true })).toBeVisible();
  const toggle = card.getByRole("switch", { name: `Show ${EVENT} to casuals` });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(
    card
      .getByRole("status")
      .filter({ hasText: "Hidden from casuals. Booked casuals keep their shifts." }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(card.getByText("Hidden from casuals", { exact: true })).toBeVisible();
  // The Hidden tab has it; the Showing tab doesn't.
  await office.getByRole("link", { name: "Hidden", exact: true }).click();
  await expect(office.getByRole("article", { name: EVENT })).toBeVisible();
  await office.getByRole("link", { name: "Showing", exact: true }).click();
  await expect(office.getByRole("article", { name: EVENT })).toHaveCount(0);

  // The casual's Open shifts no longer has it, and its page says it isn't available.
  await casual.goto(`${acme}/shifts/open`);
  await expect(casual.getByRole("heading", { name: "Open shifts", level: 1 })).toBeVisible();
  await expect(session).toHaveCount(0);
  await casual.goto(`${acme}/shifts/${shiftId}`);
  await expect(casual.getByRole("heading", { name: "This shift isn't available." })).toBeVisible();

  // Switched back on, from the event's own page: the casual sees it again.
  await office.getByRole("link", { name: "Hidden", exact: true }).click();
  await office
    .getByRole("article", { name: EVENT })
    .getByRole("link", { name: EVENT, exact: true })
    .click();
  await expect(office.getByRole("heading", { name: EVENT, level: 1 })).toBeVisible();
  const again = office.getByRole("switch", { name: `Show ${EVENT} to casuals` });
  await again.click();
  await expect(office.getByRole("status").filter({ hasText: "Showing to casuals." })).toBeVisible();
  await expect(again).toHaveAttribute("aria-checked", "true");
  await casual.goto(`${acme}/shifts/open`);
  await expect(session).toHaveCount(1);
});
