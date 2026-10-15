import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { addOfficeUser, addWorker } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// A GDPR request in a real browser (docs/runbooks.md "GDPR requests"): an admin finds a worker by
// their mobile, downloads their data as JSON and CSV, deletes their personal details (only once
// the box is ticked), and the firm's own download then holds the anonymous row. The admin and the
// worker are this spec's own, so the other specs' people are never touched.

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

async function download(page: Page, name: string): Promise<{ file: string; text: string }> {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name }).click(),
  ]);
  return {
    file: file.suggestedFilename(),
    text: await readFile((await file.path()) ?? "", "utf8"),
  };
}

test("an admin downloads a worker's data, deletes their details, and downloads the firm's", async ({
  page,
}) => {
  const email = "data.admin@example.com";
  await addOfficeUser("acme", { email, name: "Data Admin", role: "admin" });
  const workerId = await addWorker("acme", {
    firstName: "Dana",
    lastName: "Erasure",
    mobileE164: "+447700900871",
  });
  await officeLogin(page, email);

  await (await menuLink(page, "Data requests")).click();
  await expect(page.getByRole("heading", { name: "Data requests" })).toBeVisible();
  await page.getByLabel("Name or mobile number").fill("07700 900871");
  await page.getByRole("button", { name: "Find" }).click();
  // Audit L54: what was typed (a mobile) never goes into the address, where the browser's history,
  // the next site's Referer and a server log would keep it: the search is a form action.
  await expect(page.getByRole("link", { name: "Dana Erasure" })).toBeVisible();
  expect(page.url()).toBe(`${acme}/office/data`);
  await page.getByRole("link", { name: "Dana Erasure" }).click();
  await expect(page).toHaveURL(`${acme}/office/data/workers/${workerId}`);
  await expect(page.getByRole("heading", { name: "Dana Erasure" })).toBeVisible();

  const json = await download(page, "Download (JSON)");
  expect(json.file).toMatch(/^worker-[0-9a-f]{8}-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(json.text) as { worker: Record<string, unknown> };
  expect(data.worker).toMatchObject({
    id: workerId,
    firstName: "Dana",
    lastName: "Erasure",
    mobileE164: "+447700900871",
  });
  const csv = await download(page, "Download (CSV, opens in Excel)");
  expect(csv.file).toMatch(/\.csv$/);
  expect(csv.text.startsWith("﻿Section,Record,Field,Value\r\n")).toBe(true);
  expect(csv.text).toContain("worker,1,lastName,Erasure");
  // Started from another site (or another firm's address): refused, like the cancellations files.
  for (const site of ["cross-site", "same-site"]) {
    for (const path of [
      `data/workers/${workerId}/export?format=json`,
      `data/workers/${workerId}/export?format=csv`,
      "data/export",
    ]) {
      const answer = await page.request.get(`${acme}/office/${path}`, {
        headers: { "sec-fetch-site": site },
      });
      expect(answer.status(), `${site} ${path}`).toBe(403);
    }
  }

  // Deleting needs the box ticked first.
  const erase = page.getByRole("button", { name: "Delete Dana Erasure’s personal details" });
  await erase.click();
  await expect(page.getByRole("status")).toHaveText(
    "Tick the box to say you understand this can't be undone.",
  );
  await page.getByLabel("I understand this can’t be undone").check();
  await erase.click();
  await expect(page.getByRole("status")).toHaveText(
    "Deleted. Dana Erasure's personal details are gone. Their shift history stays, without a name. Words other people wrote that name them, like a colleague's swap request or pay query, aren't changed.",
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Deleted worker" })).toBeVisible();
  await expect(page.getByText(/^Deleted on /)).toBeVisible();

  await page.getByRole("link", { name: "Back to data requests" }).click();
  const firm = await download(page, "Download all your data");
  expect(firm.file).toMatch(/^acme-data-\d{4}-\d{2}-\d{2}\.json$/);
  const all = JSON.parse(firm.text) as { tables: Record<string, Record<string, unknown>[]> };
  expect(all.tables.workers?.find((w) => w.id === workerId)).toMatchObject({
    firstName: "Deleted",
    lastName: "worker",
    mobileE164: null,
  });
  expect(firm.text).not.toContain("Erasure");
});
