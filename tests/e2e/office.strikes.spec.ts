import type { Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  bookAndCancel,
  cancelOwnShift,
  eraseCasual,
  withdrawStrikeAs,
} from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Strikes in a real browser (12C.5; docs/office-v2.md 3.5): a casual of this spec's own cancels a
// session a day away (a strike). A resourcer opens Strikes from the menu, finds them, opens the
// strike's record from there, keeps it (marked as reviewed), then withdraws it with a reason: the
// record then says who kept it, who withdrew it, when and why, and the Strikes page shows it
// withdrawn. Nothing offers Approve, Decline or Deny. Every answer stays on screen after the record
// refreshes, though its button goes (19.1): kept on a deleted casual's strike, and "already
// withdrawn" when someone else withdrew it while the form was open. The sessions, their sites, the
// casuals and the office users are made up and this spec's own; a retry makes new sessions (the
// run's suffix).

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
const RESOURCER = "strikes.resourcer@example.com";
const ADMIN = "strikes.admin@example.com";
const CASUAL = { firstName: "Sian", lastName: "Strike", mobileE164: "+447700900617" };
const ERASED = { firstName: "Erin", lastName: "Strike", mobileE164: "+447700900622" };
const LATE = { firstName: "Lewis", lastName: "Strike", mobileE164: "+447700900623" };
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

    // Keep it first (any live strike can be marked as reviewed, once).
    await page.getByRole("button", { name: "Keep strike" }).click();
    await expect(page.getByRole("status")).toHaveText("Kept, and marked as reviewed.");
    await expect(page.getByText(/^Kept after a review by Strikes Resourcer at /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep strike" })).toHaveCount(0);

    // Then withdraw it after all.
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
    // The answer outlives the refresh that drew the withdrawn record, though the buttons go (19.1).
    await expect(page.getByRole("status")).toHaveText(
      "Withdrawn. It no longer counts, and the casual sees it as withdrawn.",
    );
    await expect(page.getByRole("button", { name: "Withdraw strike…" })).toHaveCount(0);
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

// A deleted casual's strike: the record says it can't be withdrawn and offers only "Keep strike".
// Keeping it takes that last button away when the record refreshes; the answer stays (19.1).
test("a deleted casual's strike is kept, and the answer stays after the refresh", async ({
  page,
}) => {
  const { shiftId } = await addEventWithSession("acme", {
    name: `Strikes Erased Event ${RUN}`,
    site: `Strikes Erased Hall ${RUN}`,
    role: "steward",
    daysAhead: 1,
  });
  const workerId = await addSteward("acme", ERASED);
  await addOfficeUser("acme", { email: RESOURCER, name: "Strikes Resourcer", role: "resourcer" });
  await addOfficeUser("acme", { email: ADMIN, name: "Strikes Admin", role: "admin" });
  try {
    const { assignmentId } = await bookAndCancel("acme", {
      shiftId,
      workerId,
      reason: "Travel problem",
      warning: "strike",
    });
    await eraseCasual("acme", { workerId, adminEmail: ADMIN });
    await officeLogin(page);
    await page.goto(`${acme}/office/cancellations/${assignmentId}`);
    await expect(
      page.getByRole("heading", { name: /^Strike: Issued \(counts until/ }),
    ).toBeVisible();
    await expect(
      page.getByText("This casual's details were deleted, so their strikes can't be withdrawn."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Withdraw strike…" })).toHaveCount(0);

    await page.getByRole("button", { name: "Keep strike" }).click();
    await expect(page.getByText(/^Kept after a review by Strikes Resourcer at /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep strike" })).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("Kept, and marked as reviewed.");
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

// The withdraw form is open when someone else withdraws the strike: "Withdraw strike" then answers
// that it's already withdrawn, the record refreshes, the form closes and the answer stays (19.1).
test("withdrawing a strike someone else has just withdrawn says so, and the form closes", async ({
  page,
}) => {
  const { shiftId } = await addEventWithSession("acme", {
    name: `Strikes Late Event ${RUN}`,
    site: `Strikes Late Hall ${RUN}`,
    role: "steward",
    daysAhead: 1,
  });
  const workerId = await addSteward("acme", LATE);
  await addOfficeUser("acme", { email: RESOURCER, name: "Strikes Resourcer", role: "resourcer" });
  await addOfficeUser("acme", { email: ADMIN, name: "Strikes Admin", role: "admin" });
  try {
    const { assignmentId } = await bookAndCancel("acme", {
      shiftId,
      workerId,
      reason: "Travel problem",
      warning: "strike",
    });
    await officeLogin(page);
    await page.goto(`${acme}/office/cancellations/${assignmentId}`);
    await page.getByRole("button", { name: "Withdraw strike…" }).click();
    await page.getByLabel("Why are you withdrawing it?").fill(REASON);
    await withdrawStrikeAs("acme", {
      assignmentId,
      byEmail: ADMIN,
      reason: "Withdrawn from another screen",
    });

    await page.getByRole("button", { name: "Withdraw strike", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Strike: Issued, then withdrawn" }),
    ).toBeVisible();
    await expect(page.getByText(/^Withdrawn by Strikes Admin at /)).toBeVisible();
    await expect(page.getByLabel("Why are you withdrawing it?")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Withdraw strike", exact: true })).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("This strike has already been withdrawn.");
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});
