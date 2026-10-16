import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  bookAndCancel,
  cancelOwnShift,
  downloadsBy,
  shareReference,
} from "./db";
import { AS_IT_IS_NOW } from "../../src/lib/office/cancellations-copy";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Cancellation records in a real browser (12C.3; docs/office-v2.md 3.4): a casual of this spec's
// own cancels its own session ("I'm unwell", 5 days ahead: no strike); a resourcer finds it under
// Cancellations, opens its record (the reason shown as given), downloads its PDF and the CSV (the
// casual's reason never in them). Then a second casual's cancellation is given the same reference:
// the reference lists both to choose from (each opening by the booking's full id) and its PDF
// address is refused, never one picked. Each download is logged export.downloaded by the route
// itself; one started from another site (another firm's address too) is refused and logs nothing;
// payroll can open neither the page nor the files. No page offers Approve, Decline or Deny: a
// cancellation is final.
// The session, its site, the casual and the resourcer are made up and this spec's own; a retry
// makes a new session (the run's suffix).

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
const SITE = `Records Test Hall ${RUN}`;
const RESOURCER = "cancellations.resourcer@example.com";
const PAYROLL = "cancellations.payroll@example.com";
const CASUAL = { firstName: "Rhona", lastName: "Record", mobileE164: "+447700900614" };
const SECOND = { firstName: "Rory", lastName: "Record", mobileE164: "+447700900615" };

async function officeLogin(page: Page, email = RESOURCER, home = "/office") {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}${home}`);
}

const noApproval = async (page: Page) => {
  for (const name of [/approve/i, /decline/i, /deny/i]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }
};

test("a resourcer opens a cancellation's record and downloads its PDF and the CSV; nothing to approve", async ({
  page,
  browser,
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
  await addOfficeUser("acme", { email: PAYROLL, name: "Records Payroll", role: "payroll" });
  const logged = await downloadsBy("acme", RESOURCER);
  const newDownloads = async () => (await downloadsBy("acme", RESOURCER)).slice(logged.length);
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
    await expect(page.getByText(AS_IT_IS_NOW)).toBeVisible();
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
    expect(await newDownloads()).toEqual([{ kind: "cancellation_pdf", assignmentId }]);

    await page.goto(`${acme}/office/cancellations`);
    const csv = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    const csvFile = await csv;
    expect(csvFile.suggestedFilename()).toBe("cancellations-all.csv");
    const text = await readFile((await csvFile.path()) ?? "", "utf8");
    expect(text).toContain(ref);
    expect(text).toContain("Casual's own reason (see ShiftDesk)");
    expect(text.toLowerCase()).not.toContain("unwell");
    const rows = (await newDownloads())[1] as { kind: string; view: string; rows: number };
    expect(rows).toMatchObject({ kind: "cancellations_csv", view: "all" });
    expect(rows.rows).toBeGreaterThanOrEqual(1);

    // Today's only (the dashboard's "Cancellations today"): the file holds just the rows the page
    // lists, fewer than every day's (the demo's cancellations are on earlier days), and is named
    // with the date.
    await page.goto(`${acme}/office/cancellations?day=today`);
    const todayRows = await page.locator('main li a[href^="/office/cancellations/"]').count();
    const todays = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    const todayFile = await todays;
    expect(todayFile.suggestedFilename()).toMatch(/^cancellations-all-\d{4}-\d{2}-\d{2}\.csv$/);
    const todayText = await readFile((await todayFile.path()) ?? "", "utf8");
    expect(todayText).toContain(ref);
    const today = (await newDownloads())[2] as { kind: string; date: string; rows: number };
    expect(today).toMatchObject({ kind: "cancellations_csv", view: "all", day: "today" });
    // The log names the day the file held, as its name does.
    expect(todayFile.suggestedFilename()).toBe(`cancellations-all-${today.date}.csv`);
    expect(today.rows).toBe(todayRows);
    expect(today.rows).toBeGreaterThanOrEqual(1);
    expect(today.rows).toBeLessThan(rows.rows);

    // Started from another site (or another firm's address): refused, nothing logged.
    for (const site of ["cross-site", "same-site"]) {
      for (const path of ["export", `${assignmentId}/pdf`]) {
        const answer = await page.request.get(`${acme}/office/cancellations/${path}`, {
          headers: { "sec-fetch-site": site },
        });
        expect(answer.status(), `${site} ${path}`).toBe(403);
      }
    }
    expect(await newDownloads()).toHaveLength(3);

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

    // Payroll: neither the page nor the files, and nothing logged.
    const payrollContext = await browser.newContext();
    try {
      const payroll = await payrollContext.newPage();
      await officeLogin(payroll, PAYROLL, "/office/pay");
      const pageAnswer = await payroll.goto(`${acme}/office/cancellations`);
      expect(pageAnswer?.status()).toBe(404);
      for (const path of ["export", `${assignmentId}/pdf`]) {
        expect((await payroll.request.get(`${acme}/office/cancellations/${path}`)).status()).toBe(
          404,
        );
      }
      expect(await downloadsBy("acme", PAYROLL)).toEqual([]);
    } finally {
      await payrollContext.close();
    }
  } finally {
    await cancelOwnShift("acme", shiftId);
    await cancelOwnShift("acme", second.shiftId);
  }
});
