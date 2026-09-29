import type { Page } from "@playwright/test";
import { addOfficeUser, addPastBookedShift } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// Marking who worked a shift in a real browser: a shift that ran 3 days ago with three people
// booked shows on Today under "Who worked?"; the resourcer marks one as not attended, the rest as
// worked in one go, then puts a mistake right. The resourcer is this spec's own (the seeded ones'
// login links are used up by the other office specs: 3 per email every 15 minutes).

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

test("mark who worked a shift that ended: one not attended, the rest worked, a mistake put right", async ({
  page,
}) => {
  const email = "attendance.resourcer@example.com";
  await addOfficeUser("acme", { email, name: "Attendance Resourcer", role: "resourcer" });
  const { shiftId, names } = await addPastBookedShift("acme", {
    role: "steward",
    daysAgo: 3,
    people: 3,
  });
  const [first = "", second = "", third = ""] = names;
  await officeLogin(page, email);

  // Today lists it under "Who worked?".
  await page.goto(`${acme}/office/today`);
  const section = page.getByRole("region", { name: "Who worked?" });
  const card = section.locator("li", { has: page.locator(`a[href="/office/shifts/${shiftId}"]`) });
  await expect(card.getByText("3 people not marked yet.")).toBeVisible();
  await card.getByRole("link").click();
  await expect(page).toHaveURL(`${acme}/office/shifts/${shiftId}`);

  // One didn't attend.
  await expect(page.getByText("Mark who worked it and who didn't attend.")).toBeVisible();
  await page.getByRole("button", { name: `Mark as not attended: ${second}` }).click();
  await expect(page.getByText(`Marked ${second} as not attended.`)).toBeVisible();

  // The rest worked, in one go, after a "Yes".
  const rest = page.getByText("Mark the 2 people not marked yet as worked", { exact: true });
  await rest.click();
  await page.getByRole("button", { name: "Yes, mark them as worked" }).click();
  // The page refreshes (nobody is left to mark, so the choice goes) and the confirmation stays.
  await expect(rest).toHaveCount(0);
  await expect(page.getByText("Marked 2 people as worked.")).toBeVisible();
  await page.reload();
  const places = page.getByRole("region", { name: "Places" });
  await expect(places.getByText(`${first}: Worked`)).toBeVisible();
  await expect(places.getByText(`${second}: Didn't attend`)).toBeVisible();
  await expect(places.getByText(`${third}: Worked`)).toBeVisible();

  // A mistake: they did come.
  await page.getByRole("button", { name: `Change to worked: ${second}` }).click();
  await expect(page.getByText(`Marked ${second} as worked.`)).toBeVisible();
  await page.reload();
  await expect(places.getByText(`${second}: Worked`)).toBeVisible();
  const history = page.getByRole("region", { name: "History" });
  await expect(
    history.getByText(`marked ${second} as worked (was: not attended).`, { exact: false }),
  ).toBeVisible();

  // Nothing left to mark on Today.
  await page.goto(`${acme}/office/today`);
  await expect(section.locator(`a[href="/office/shifts/${shiftId}"]`)).toHaveCount(0);
});
