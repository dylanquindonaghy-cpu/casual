import type { Page } from "@playwright/test";
import { addOfficeUser, addPastBookedShift, setDashboardCards } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// Marking who worked a shift in a real browser: a shift that ended a few hours ago with three people
// booked shows under the dashboard's "Who worked?" (round 8: Phase 26.2, and only there since
// Phase 26.4); its line opens the shift, where the resourcer marks one as not attended, the rest as
// worked in one go, then puts a mistake right; it's gone from the dashboard once all are marked. The resourcer is this spec's own (the seeded ones'
// login links are used up by the other office specs: 3 per email every 15 minutes), with Who
// worked? ticked under Customise (off by default since Phase 27.9).

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
  await setDashboardCards("acme", email, ["map", "toOffer", "updates", "comingUp", "whoWorked"]);
  // Ended a few hours ago (half a day's start, 8 hours long), so it's among the dashboard's first
  // sessions to mark (newest ended first) whatever the other specs left.
  const { shiftId, names } = await addPastBookedShift("acme", {
    role: "steward",
    daysAgo: 0.5,
    people: 3,
  });
  const [first = "", second = "", third = ""] = names;
  await officeLogin(page, email);

  // The dashboard's Who worked? column holds it (round 8, Phase 26.2): its line ("Sun 1 Nov ·
  // Steward · …"), a link to its page (no other session is like it), and its three people by name,
  // each with Worked and Didn't attend.
  await page.goto(`${acme}/office`);
  await expect(page.locator("dialog[data-offer-panel][data-ready]")).toHaveCount(1);
  const worked = page.locator("section#who-worked");
  const line = worked.locator(`a[href="/office/shifts/${shiftId}"]`);
  await expect(line).toHaveText(/^\w{3} \d{1,2} \w{3} · Steward · .*\d\d:\d\d–\d\d:\d\d$/);
  // Its own group (the line's parent): the same casuals can be in another one too.
  const group = line.locator("..");
  for (const name of names) {
    await expect(
      group.getByRole("button", { name: new RegExp(`^${name} worked, `) }),
    ).toBeVisible();
    await expect(
      group.getByRole("button", { name: new RegExp(`^${name} didn't attend, `) }),
    ).toBeVisible();
  }
  // Needs attention no longer lists it (Phase 26.4: the dashboard is where it's marked).
  await page.goto(`${acme}/office/needs-attention`);
  await expect(page.getByRole("region", { name: "Who worked?" })).toHaveCount(0);
  await page.goto(`${acme}/office`);
  await line.click();
  await expect(page).toHaveURL(`${acme}/office/shifts/${shiftId}`);

  // One didn't attend.
  await expect(page.getByText("Mark who worked it and who didn't attend.")).toBeVisible();
  await page.getByRole("button", { name: `Mark as not attended: ${second}` }).click();
  // Exact: once the page refreshes, the shift's history says "… marked {name} as not attended." too.
  await expect(page.getByText(`Marked ${second} as not attended.`, { exact: true })).toBeVisible();

  // The rest worked, in one go, after a "Yes".
  const rest = page.getByText("Mark the 2 people not marked yet as worked", { exact: true });
  await rest.click();
  await page.getByRole("button", { name: "Yes, mark them as worked" }).click();
  // The page refreshes (nobody is left to mark, so the choice goes) and the confirmation stays.
  await expect(rest).toHaveCount(0);
  await expect(page.getByText("Marked 2 people as worked.")).toBeVisible();
  await page.reload();
  // The session's Booked list (round 8, Phase 26.6: the casuals' Booked tab).
  const places = page.getByRole("region", { name: "Booked places" });
  await expect(places.getByText(`${first}: Worked`)).toBeVisible();
  await expect(places.getByText(`${second}: Didn't attend`)).toBeVisible();
  await expect(places.getByText(`${third}: Worked`)).toBeVisible();

  // A mistake: they did come.
  await page.getByRole("button", { name: `Change to worked: ${second}` }).click();
  await expect(page.getByText(`Marked ${second} as worked.`)).toBeVisible();
  await page.reload();
  await expect(places.getByText(`${second}: Worked`)).toBeVisible();
  // The history is a tab away.
  await page.goto(`${acme}/office/shifts/${shiftId}?tab=history`);
  const history = page.getByRole("region", { name: "History" });
  await expect(
    history.getByText(`marked ${second} as worked (was: not attended).`, { exact: false }),
  ).toBeVisible();

  // Nothing left to mark: gone from the dashboard's Who worked?.
  await page.goto(`${acme}/office`);
  await expect(page.locator("section#who-worked")).toBeVisible();
  await expect(line).toHaveCount(0);
});
