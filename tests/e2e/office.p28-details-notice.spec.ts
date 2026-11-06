import type { Page } from "@playwright/test";
import { setFirmSetting } from "./db";
import { expect, sessionPanel, test } from "./fixtures";
import { sentTo } from "./outbox";
import { detailsNoticeChannels, detailsScene, startDetailsNoticeNow } from "./p28/28-3-data";

// Phase 28.3: a booked shift's briefing changed (docs/screens.md "28.3"; words
// `shift_details_changed` in docs/messaging-templates.md). A resourcer saves a new meeting point on a
// session with two casuals booked: the page says how many will be told, and each is told, Eli by a
// push (notifications on) and Dora by a text in the console outbox, naming the part that changed and
// never its value. The session's history says so.

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
  await expect(page).toHaveURL(new RegExp(`^${acme.replace(/\./g, "\\.")}/office$`));
}

test("a new meeting point on a booked session: the office sees who'll be told, and they are", async ({
  page,
}) => {
  const scene = await detailsScene("acme");
  await officeLogin(page, "acme.resourcer@example.com");
  await page.goto(`${acme}/office/shifts/${scene.shiftId}`);

  const panel = await sessionPanel(page, "Session details");
  await panel.getByLabel("Meeting point (optional)").fill("Gate C, north entrance");
  const saved = new Date(Date.now() - 1000);
  await panel.getByRole("button", { name: "Save details" }).click();
  await expect(panel.getByRole("status")).toHaveText("Saved. 2 booked casuals will be told.");

  // Quiet hours off for Acme while it goes (at night a notice for a session 15 days ahead waits
  // for them to end), then put back as they were.
  const quietBefore = await setFirmSetting("acme", "quiet_hours", {
    start: "00:00",
    end: "00:00",
    urgent_override: true,
  });
  try {
    // One job for the burst, two minutes on; here it starts now.
    expect(await startDetailsNoticeNow("acme", scene.shiftId)).toBe(1);

    // Dora has no notifications: a text, in the console outbox. The part, never the value.
    const text = await sentTo(
      scene.textMobile,
      saved,
      /(your shift's details changed \(meeting point\)\. .*)$/,
    );
    expect(text).toContain("See what changed: ");
    expect(text).toContain(`/shifts/${scene.shiftId}`);
    expect(text).not.toContain("Gate C");

    // Eli's phone took the push (the console push sender prints it to the worker's log): its
    // record.
    await expect
      .poll(() => detailsNoticeChannels("acme", scene.shiftId), { timeout: 20_000 })
      .toEqual({ [scene.pushWorker]: "push", [scene.textWorker]: "sms" });
  } finally {
    await setFirmSetting("acme", "quiet_hours", quietBefore);
  }

  // The session's history says each was told.
  await page.goto(`${acme}/office/shifts/${scene.shiftId}`);
  await page
    .getByRole("navigation", { name: "Show" })
    .getByRole("link", { name: "History" })
    .click();
  await expect(
    page.getByText(/Dora Briefing \w+ was told their shift's details changed\./).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Eli Briefing \w+ was told their shift's details changed\./).first(),
  ).toBeVisible();
});
