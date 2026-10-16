import { addOpenShift, addSteward, setFirmSetting } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// Travel areas switched off for a firm (13.4; `travel.enabled`), in a real browser on a phone: the
// demo firm has them on, so this spec switches them off for itself and puts the setting back after,
// even when it fails. Off, a casual has no "Where you work" (its page is not found), Open shifts
// asks for no home area and shows no travel lines, and Help has no travel area section. A steward
// of this spec's own (made up) and an open shift of its own.

const acme = "http://acme.localhost:3100";
const CASUAL = { firstName: "Otto", lastName: "Offtravel", mobileE164: "+447700900661" };

test("travel areas off: no Where you work, no prompt or travel lines, no help on it; on again: back", async ({
  page,
}) => {
  await addSteward("acme", CASUAL);
  await addOpenShift("acme", { role: "steward", daysAhead: 4 });
  const before = await setFirmSetting("acme", "travel", { enabled: false });
  try {
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill("07700 900661");
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page).toHaveURL(`${acme}/`);
    await expect(page.getByText(/home area|minutes from your home/)).toHaveCount(0);

    await page.goto(`${acme}/profile`);
    await expect(page.getByRole("heading", { name: "Otto Offtravel", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Where you work" })).toHaveCount(0);
    expect((await page.goto(`${acme}/profile/travel`))?.status()).toBe(404);

    await page.goto(`${acme}/shifts/open`);
    await expect(page.getByRole("heading", { name: "Open shifts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Take shift" }).first()).toBeVisible();
    await expect(page.getByText("Add your home area")).toHaveCount(0);
    await expect(page.locator("[data-travel-line]")).toHaveCount(0);

    await page.goto(`${acme}/help`);
    await expect(page.getByRole("heading", { name: "Help", level: 1 })).toBeVisible();
    await expect(page.getByText("Your travel area")).toHaveCount(0);
  } finally {
    await setFirmSetting("acme", "travel", before);
  }
  // On again (the demo firm's own setting): Where you work is back.
  await page.goto(`${acme}/profile`);
  await expect(page.getByRole("region", { name: "Where you work" })).toBeVisible();
});
