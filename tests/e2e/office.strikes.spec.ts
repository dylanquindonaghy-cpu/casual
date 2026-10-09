import type { Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  bookAndCancel,
  cancelOwnShift,
} from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Strikes in a real browser (12C.5; docs/office-v2.md 3.5): a casual of this spec's own cancels a
// session a day away (a strike). A resourcer opens Strikes from the menu, finds them, opens the
// strike's record from there and withdraws it with a reason: the record then says who, when and
// why, and the Strikes page shows it withdrawn. Nothing offers Approve, Decline or Deny. The
// session, its site, the casual and the resourcer are made up and this spec's own; a retry makes a
// new session (the run's suffix).

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
const RESOURCER = "strikes.resourcer@example.com";
const CASUAL = { firstName: "Sian", lastName: "Strike", mobileE164: "+447700900617" };
const REASON = "She rang the office before the cut-off; booked by mistake";

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

const noApproval = async (page: Page) => {
  for (const name of [/approve/i, /decline/i, /deny/i]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }
};

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

test("a resourcer withdraws a strike from the Strikes page, with a reason", async ({ page }) => {
  const { shiftId } = await addEventWithSession("acme", {
    name: `Strikes Test Event ${RUN}`,
    site: `Strikes Test Hall ${RUN}`,
    role: "steward",
    daysAhead: 1,
  });
  const workerId = await addSteward("acme", CASUAL);
  await addOfficeUser("acme", { email: RESOURCER, name: "Strikes Resourcer", role: "resourcer" });
  try {
    const { assignmentId } = await bookAndCancel("acme", {
      shiftId,
      workerId,
      reason: "Travel problem",
      warning: "strike",
    });
    await officeLogin(page);
    await (await menuLink(page, "Strikes")).click();
    await expect(page.getByRole("heading", { name: "Strikes", level: 1 })).toBeVisible();
    await noApproval(page);
    await noSidewaysScroll(page);
    const casual = page.getByRole("listitem").filter({
      has: page.getByRole("heading", { name: "Sian Strike" }),
    });
    await expect(casual).toContainText(/\d+ live strikes?/);
    await casual.locator(`a[href="/office/cancellations/${assignmentId}"]`).click();
    await expect(page).toHaveURL(`${acme}/office/cancellations/${assignmentId}`);
    await expect(
      page.getByRole("heading", { name: /^Strike: Issued \(counts until/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Withdraw strike…" }).click();
    await page.getByLabel("Why are you withdrawing it?").fill(REASON);
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "Withdraw strike", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Withdrawn. It no longer counts, and the casual sees it as withdrawn.",
    );
    await expect(
      page.getByRole("heading", { name: "Strike: Issued, then withdrawn" }),
    ).toBeVisible();
    await expect(page.getByText(`Why: ${REASON}`)).toBeVisible();
    await expect(page.getByText(/^Withdrawn by Strikes Resourcer at /)).toBeVisible();
    await noApproval(page);

    // On the Strikes page (All): their latest strike reads "Withdrawn".
    await page.goto(`${acme}/office/strikes?view=all`);
    const row = page.getByRole("listitem").filter({
      has: page.getByRole("heading", { name: "Sian Strike" }),
    });
    await expect(row).toContainText("Withdrawn");
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});
