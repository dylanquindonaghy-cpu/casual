import { TRAVEL_SCENE_ROLE, travelScene } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// The travel filter in a real browser (12G.3; docs/office-v2.md 4.2, 4.3; D2): a casual of this
// spec's own, travelling by car for up to 45 minutes, and two urgent sessions in a role only she
// has: one 20 minutes away, one 80. Home and the urgent board count and show only the near one,
// with its travel line, and say one more is further than she travels; a direct link to the far one
// still books it, and her booking then carries its own travel line. Made-up people and postcodes;
// the estimates are written as the travel job would (no travel service is called).

const acme = "http://acme.localhost:3100";
const CASUAL = { firstName: "Tess", lastName: "Trip", mobileE164: "+447700900619" };

test("Home and the urgent board show only shifts in her travel area; a direct link still books", async ({
  page,
}) => {
  const { near, far } = await travelScene("acme", CASUAL);
  expect(TRAVEL_SCENE_ROLE).toBe("travel_check");

  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900619");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(CASUAL.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();

  // Home: two urgent sessions in her role, one in her area.
  await expect(page.getByRole("heading", { name: "1 urgent shift needs someone" })).toBeVisible();
  await page.getByRole("link", { name: "See urgent shifts" }).click();
  await expect(page).toHaveURL(`${acme}/urgent`);
  const card = page.getByRole("listitem");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Travel check");
  await expect(card).toContainText("7.5 miles · 20 min by car · no public transport by");
  await expect(page.getByText("1 more urgent shift is further than you travel.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Change how far" })).toHaveAttribute(
    "href",
    "/profile/travel",
  );

  // Open shifts: the same.
  await page.goto(`${acme}/shifts/open`);
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("1 more shift is further than you travel.")).toBeVisible();

  // The far one, opened from a direct link: still bookable.
  await page.goto(`${acme}/shifts/${far}`);
  await page.getByRole("button", { name: "Take shift" }).click();
  await expect(page.getByText("You're booked.")).toBeVisible();
  await page.goto(`${acme}/`);
  const next = page.getByRole("region", { name: "Your next shift" });
  await expect(next).toContainText("60.0 miles · 80 min by car · no public transport by");
  void near;
});
