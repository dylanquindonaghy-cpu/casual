import type { Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  bookAndCancel,
  cancelOwnShift,
  failEvidence,
} from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// The evidence email to the strikes team in a real browser (12C.4): a casual of this spec's own
// cancels a session a day away (a strike); its evidence email is marked failed, as the job leaves
// one that may have arrived. A resourcer sees it on the dashboard under "Strike evidence" (Needs attention; the bell counts it), opens the record
// from there and selects "Resend evidence". Nothing on the way offers Approve, Decline or Deny. The
// session, its site, the casual and the resourcer are made up and this spec's own; a retry makes a
// new session (the run's suffix).

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
const RESOURCER = "evidence.resourcer@example.com";
const CASUAL = { firstName: "Erin", lastName: "Evidence", mobileE164: "+447700900616" };

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

test("a failed evidence email shows on the dashboard, and its record resends it", async ({
  page,
}) => {
  const { shiftId } = await addEventWithSession("acme", {
    name: `Evidence Test Event ${RUN}`,
    site: `Evidence Test Hall ${RUN}`,
    role: "steward",
    daysAhead: 1,
  });
  const workerId = await addSteward("acme", CASUAL);
  await addOfficeUser("acme", { email: RESOURCER, name: "Evidence Resourcer", role: "resourcer" });
  try {
    const { assignmentId } = await bookAndCancel("acme", {
      shiftId,
      workerId,
      reason: "Travel problem",
      warning: "strike",
    });
    await failEvidence("acme", assignmentId);
    await officeLogin(page);

    const section = page.getByRole("region", { name: "Strike evidence" });
    await expect(section).toContainText("Erin Evidence's strike record couldn't be emailed");
    // The bell in the top bar counts it, and goes to Needs attention.
    await expect(page.getByRole("link", { name: /^Needs attention, \d+\+?$/ })).toHaveAttribute(
      "href",
      "/office#needs-attention",
    );
    await noSidewaysScroll(page);
    await section.locator(`a[href="/office/cancellations/${assignmentId}"]`).click();
    await expect(page).toHaveURL(`${acme}/office/cancellations/${assignmentId}`);

    await expect(page.getByRole("heading", { name: "The evidence email failed" })).toBeVisible();
    await expect(page.getByText("Couldn't be sent")).toBeVisible();
    await noApproval(page);
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "Resend evidence" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Sending it again. This record shows when it has gone.",
    );
    // Queued again: no longer failed, so the button goes.
    await expect(page.getByRole("heading", { name: "The evidence email failed" })).toHaveCount(0);
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});
