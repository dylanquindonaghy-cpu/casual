import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  bookAndCancel,
  cancelOwnShift,
  shareReference,
} from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Cancellation records in a real browser (12C.3; docs/office-v2.md 3.4): a casual of this spec's
// own cancels its own session ("I'm unwell", 5 days ahead: no strike); a resourcer finds it under
// Cancellations, opens its record (the reason shown as given), downloads its PDF and the CSV (the
// casual's reason never in them). Then a second casual's cancellation is given the same reference:
// the reference lists both to choose from (each opening by the booking's full id) and its PDF
// address is refused, never one picked. No page offers Approve, Decline or Deny: a cancellation is
// final.
// The session, its site, the casual and the resourcer are made up and this spec's own; a retry
// makes a new session (the run's suffix).

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
const SITE = `Records Test Hall ${RUN}`;
const RESOURCER = "cancellations.resourcer@example.com";
const CASUAL = { firstName: "Rhona", lastName: "Record", mobileE164: "+447700900614" };
const SECOND = { firstName: "Rory", lastName: "Record", mobileE164: "+447700900615" };

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

test("a resourcer opens a cancellation's record and downloads its PDF and the CSV; nothing to approve", async ({
  page,
}) => {
  const { shiftId } = await addEventWithSession("acme", {
    name: `Records Test Event ${RUN}`,
    site: SITE,
    role: "steward",
    daysAhead: 5,
  });
  const second = await addEventWithSession("acme", {
    name: `Records Test Event Two ${RUN}`,
    site: `${SITE} Two`,
    role: "steward",
    daysAhead: 6,
  });
  const workerId = await addSteward("acme", CASUAL);
  const secondWorkerId = await addSteward("acme", SECOND);
  await addOfficeUser("acme", { email: RESOURCER, name: "Records Resourcer", role: "resourcer" });
  try {
    const { ref, assignmentId } = await bookAndCancel("acme", {
      shiftId,
      workerId,
      reason: "I'm unwell",
    });
    await officeLogin(page);
    await (await menuLink(page, "Cancellations")).click();
    await expect(page.getByRole("heading", { name: "Cancellations", level: 1 })).toBeVisible();
    await expect(page.getByText("Cancellations this week")).toBeVisible();
    await noApproval(page);

    const record = page.getByRole("link").filter({ hasText: "Rhona Record" }).first();
    await expect(record).toBeVisible();
    await record.click();
    await expect(page).toHaveURL(`${acme}/office/cancellations/${ref}`);
    await expect(page.getByRole("heading", { name: `Cancellation ${ref}` })).toBeVisible();
    const field = (label: string) =>
      page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("+ dd");
    await expect(field("Session")).toContainText("Steward");
    await expect(field("Site")).toHaveText(SITE);
    await expect(field("How")).toHaveText("In the app");
    await expect(field("Reason")).toHaveText("I'm unwell");
    await expect(field("Strike")).toHaveText("None: enough notice");
    await noApproval(page);

    // The PDF link names the booking's full id: always this one.
    await expect(page.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
      "href",
      `/office/cancellations/${assignmentId}/pdf`,
    );
    const pdf = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download PDF" }).click();
    const pdfFile = await pdf;
    expect(pdfFile.suggestedFilename()).toBe(`cancellation-${ref}.pdf`);
    const pdfBytes = await readFile((await pdfFile.path()) ?? "");
    expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");

    await page.goto(`${acme}/office/cancellations`);
    const csv = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    const csvFile = await csv;
    expect(csvFile.suggestedFilename()).toBe("cancellations-all.csv");
    const text = await readFile((await csvFile.path()) ?? "", "utf8");
    expect(text).toContain(ref);
    expect(text).toContain("Casual's own reason (see ShiftDesk)");
    expect(text.toLowerCase()).not.toContain("unwell");

    // A second cancellation sharing the reference: a choice, never one picked.
    const other = await bookAndCancel("acme", {
      shiftId: second.shiftId,
      workerId: secondWorkerId,
      reason: "Travel problem",
    });
    await shareReference("acme", { id: other.assignmentId, like: assignmentId });
    await page.goto(`${acme}/office/cancellations/${ref}`);
    await expect(page.getByRole("heading", { name: `Cancellation ${ref}` })).toBeVisible();
    await expect(
      page.getByText("2 cancellations have this reference. Choose the one you want."),
    ).toBeVisible();
    await noApproval(page);
    expect((await page.request.get(`${acme}/office/cancellations/${ref}/pdf`)).status()).toBe(409);
    await page.getByRole("link").filter({ hasText: "Rhona Record" }).click();
    await expect(page).toHaveURL(`${acme}/office/cancellations/${assignmentId}`);
    await expect(field("Casual")).toHaveText("Rhona Record");
  } finally {
    await cancelOwnShift("acme", shiftId);
    await cancelOwnShift("acme", second.shiftId);
  }
});
