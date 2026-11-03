import type { Page } from "@playwright/test";
import { addOfficeUser, addQualifiedCasual, setFirmSetting } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// Casuals, round 8, in a real browser (Phase 26.7, cas-1 to cas-6): the four counts open their
// tabs; on Need updating, a casual of this spec's own with an expired door supervisor licence has
// "Remind" (the licence message goes again, with its upload link; the row then says who reminded
// them), and its "…" menu adds a note and marks it sorted; their own page shows their reliability
// and the note. The resourcer is the spec's own; a retry finds the casual again.

const acme = "http://acme.localhost:3100";
const RUTH = { firstName: "Ruth", lastName: "Reminder", mobileE164: "+447700900681" };

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

test("counts open their tabs; Remind, a note and Mark as sorted on Need updating", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const email = `casuals.follow${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Follow Up Resourcer", role: "resourcer" });
  const ruth = await addQualifiedCasual("acme", RUTH, {
    roles: ["door_supervisor"],
    held: [{ type: "SIA_DS", daysAhead: -3 }],
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await officeLogin(page, email);
  await page.goto(`${acme}/office/casuals`);
  await expect(page.getByText(/^\d+ casuals · reliability over the last 90 days$/)).toBeVisible();
  // The four counts, each a link to its tab.
  const counts = page.getByRole("list", { name: "Counts" });
  for (const [name, view] of [
    ["Regulars", "regulars"],
    ["Reliable", "reliable"],
    ["Cancel often", "cancel_often"],
    ["Not worked lately", "not_worked"],
  ]) {
    await expect(counts.getByRole("link", { name: new RegExp(`^${name} \\d+`) })).toHaveAttribute(
      "href",
      `/office/casuals?view=${view}`,
    );
  }
  await counts.getByRole("link", { name: /^Regulars \d+/ }).click();
  await expect(page).toHaveURL(`${acme}/office/casuals?view=regulars`);
  await expect(
    page.getByRole("navigation", { name: "Show" }).getByRole("link", { name: /^Regulars \d+$/ }),
  ).toHaveAttribute("aria-current", "page");

  // The sort (cas-3): "Most strikes first", keeping the tab; its words then name the button.
  await page.locator("summary:visible", { hasText: /^By name$/ }).click();
  await page.getByRole("link", { name: "Most strikes first" }).click();
  await expect(page).toHaveURL(`${acme}/office/casuals?view=regulars&sort=strikes`);
  // The menu closes once a sort is chosen (it's keyed by the choice), named by the new one.
  await expect(page.getByRole("link", { name: "Most strikes first" })).toBeHidden();
  await page.locator("summary:visible", { hasText: /^Most strikes first$/ }).click();
  await expect(page.getByRole("link", { name: "Most strikes first" })).toHaveAttribute(
    "aria-current",
    "true",
  );

  // Need updating: Ruth's row, Remind. Quiet hours off for Acme while it goes (at night the
  // reminder waits for them to end, 22:00 to 07:00), then put back as they were.
  await page.goto(`${acme}/office/casuals?view=needs`);
  const row = page.getByRole("row").filter({ hasText: "Ruth Reminder" });
  await expect(row.getByText(/^SIA DS: expired /)).toBeVisible();
  const quietBefore = await setFirmSetting("acme", "quiet_hours", {
    start: "00:00",
    end: "00:00",
    urgent_override: true,
  });
  try {
    const asked = new Date(Date.now() - 1000);
    await row.getByRole("button", { name: "Remind: Ruth Reminder" }).click();
    await expect(
      row.getByRole("status").filter({ hasText: /^(Reminder on its way\.|One was reminded)/ }),
    ).toBeVisible();
    await sentTo(RUTH.mobileE164, asked, /^(Your SIA door supervisor licence expired on .+)$/);
  } finally {
    await setFirmSetting("acme", "quiet_hours", quietBefore);
  }
  await page.reload();
  await expect(row.getByText(/^Reminded by Follow Up Resourcer · /)).toBeVisible();

  // A note, then Mark as sorted, from the row's menu.
  await row.getByLabel("More for Ruth Reminder").click();
  await row.getByRole("button", { name: "Add a note: Ruth Reminder" }).click();
  await row.getByLabel("A note about Ruth").fill("Renewed, bringing the card in on Friday");
  await row.getByRole("button", { name: "Save note" }).click();
  await expect(row.getByRole("status").filter({ hasText: "Note added." })).toBeVisible();
  await expect(row.getByText("Note: Renewed, bringing the card in on Friday")).toBeVisible();
  // And on a phone, on her card (the list as cards below 640px).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Ruth Reminder" })
      .getByText("Note: Renewed, bringing the card in on Friday"),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await row.getByLabel("More for Ruth Reminder").click();
  await row.getByRole("button", { name: "Mark as sorted: Ruth Reminder" }).click();
  await expect(row.getByText(/^Sorted by Follow Up Resourcer · /)).toBeVisible();

  // Remind all (cas-4): a second casual of the spec's own (a number of each try's own, so a retry
  // within the day still has someone to remind) is on the button's count; pressing it reminds
  // everyone on it, says so, and they drop off it for 24 hours (Ruth, reminded above and now
  // sorted, was never on it).
  const rob = {
    firstName: "Rob",
    lastName: "Reminder",
    mobileE164: `+44770090068${2 + testInfo.retry}`,
  };
  await addQualifiedCasual("acme", rob, {
    roles: ["door_supervisor"],
    held: [{ type: "SIA_DS", daysAhead: -5 }],
  });
  await page.goto(`${acme}/office/casuals?view=needs`);
  const remindAll = page.getByRole("button", { name: /^Remind all \d+$/ });
  await expect(remindAll).toBeVisible();
  const before = Number(((await remindAll.textContent()) ?? "").replace(/\D+/g, ""));
  expect(before).toBeGreaterThanOrEqual(1);
  await remindAll.click();
  await expect(
    page.getByRole("status").filter({
      hasText:
        before === 1
          ? "Reminder on its way. It's in the log."
          : `${before} reminders on their way.`,
    }),
  ).toBeVisible();
  await page.reload();
  const robRow = page.getByRole("row").filter({ hasText: "Rob Reminder" });
  await expect(robRow.getByText(/^Reminded by Follow Up Resourcer · /)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remind all \d+$/ })).toHaveCount(0);

  // Her page: her reliability and the note.
  await page.goto(`${acme}/office/casuals/${ruth}`);
  await expect(page.getByRole("region", { name: "Reliability" })).toContainText(
    /New: \d+ shifts? so far/,
  );
  await expect(page.getByRole("region", { name: "Notes" })).toContainText(
    "Renewed, bringing the card in on Friday",
  );
});
