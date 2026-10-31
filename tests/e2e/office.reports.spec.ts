import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// The notice and cancellation report in a real browser, on the demo seed (its bookings and the
// urgent dropout are logged when it's seeded): the rows with who started them and the notice,
// the cancellations filter, and the CSV download. The resourcer is this spec's own (the seeded
// ones' login links are used up by the other office specs: 3 per email every 15 minutes).

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

test("the notice report lists bookings and the dropout, filters, and downloads as CSV", async ({
  page,
}) => {
  const email = "reports.resourcer@example.com";
  await addOfficeUser("acme", { email, name: "Reports Resourcer", role: "resourcer" });
  await officeLogin(page, email);

  await (await menuLink(page, "Notice report")).click();
  await expect(page).toHaveURL(`${acme}/office/reports/notice`);
  await expect(page.getByRole("heading", { name: "Notice and cancellation report" })).toBeVisible();
  await expect(page.getByText(/^Short notice means under 48 hours/)).toBeVisible();
  const rows = page.locator("tbody tr");
  // The seed's bookings, each started by the worker.
  await expect(
    rows.filter({ hasText: "Booked" }).filter({ hasText: "The worker" }).first(),
  ).toBeVisible();

  // Cancellations only: the demo's dropout (and any cancellation another spec made).
  await page.getByLabel("What").selectOption({ label: "Cancellations" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/kind=cancellations/);
  await expect(rows.first()).toBeVisible();
  for (const what of await rows.locator("td:nth-child(2)").allTextContents()) {
    expect(what).toBe("Cancelled");
  }
  await expect(rows.filter({ hasText: "The worker" }).first()).toContainText(/notice/);
  // Who asked for each (Phase 25.2), after who started it.
  await expect(page.getByRole("columnheader", { name: "Asked by" })).toBeVisible();

  // The same rows as a file.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download as a spreadsheet (CSV)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^notice-report-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const csv = await readFile((await download.path()) ?? "", "utf8");
  expect(csv.startsWith("\uFEFF")).toBe(true);
  const lines = csv.slice(1).trimEnd().split("\r\n");
  expect(lines[0]).toMatch(
    /^When \(firm time\),When \(UTC\),What,Started by,Asked by,Worker,Shift,/,
  );
  expect(lines.length).toBe((await rows.count()) + 1);
  expect(lines.slice(1).every((l) => l.includes(",Cancelled,"))).toBe(true);
  // Started from another site (or another firm's address): refused, like the cancellations files.
  for (const site of ["cross-site", "same-site"]) {
    const answer = await page.request.get(
      `${acme}/office/reports/notice/export?kind=cancellations`,
      {
        headers: { "sec-fetch-site": site },
      },
    );
    expect(answer.status(), site).toBe(403);
  }
});
