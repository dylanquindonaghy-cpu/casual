import { addEventWithSession, addSteward, cancelOwnShift, strikesOn } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// Strikes on cancel in a real browser, on a phone (12C.1; docs/office-v2.md 4.5): a casual takes
// two sessions of this spec's own, one starting in about 20 hours and one in about 4 days, and
// cancels both. The first shows the strike warning and records a strike; the second says it
// doesn't and records none. The casual, the sessions and their sites are made up and this spec's
// own (the sessions are cancelled at the end); a retry makes new sessions (the run's suffix) and
// finds the casual again (who may then already have a strike, so the count isn't fixed).

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
const SOON = `Strike Test Yard ${RUN}`;
const LATER = `Strike Test Park ${RUN}`;
const CASUAL = { firstName: "Stella", lastName: "Strike", mobileE164: "+447700900613" };

test("a cancellation under 48 hours shows the warning and records a strike; one over 48 hours records none", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const soon = await addEventWithSession("acme", {
    name: `Strike Test Soon ${RUN}`,
    site: SOON,
    role: "steward",
    daysAhead: 20 / 24,
  });
  const later = await addEventWithSession("acme", {
    name: `Strike Test Later ${RUN}`,
    site: LATER,
    role: "steward",
    daysAhead: 4,
  });
  await addSteward("acme", CASUAL);
  try {
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill("07700 900613");
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page).toHaveURL(`${acme}/`);

    // Takes both in the app.
    for (const site of [SOON, LATER]) {
      await page.goto(`${acme}/shifts/open`);
      const row = page.getByRole("listitem").filter({ hasText: site });
      await row.getByRole("button", { name: "Take shift" }).click();
      await expect(row.getByText("You're booked.")).toBeVisible();
    }

    // The one starting in about 20 hours: the strike warning, then a strike.
    await page.goto(`${acme}/`);
    await expect(page.getByRole("heading", { name: "Your next shift" })).toBeVisible();
    await expect(page.getByText(SOON).first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel this shift" }).first().click();
    await expect(page.getByRole("note")).toHaveText(
      /^This shift starts in (19|20) hours\. Cancelling with less than 48 hours' notice gives you a strike\. Acme Events' strikes team gets a record of it\. You have \d+ strikes? in the last 90 days\.$/,
    );
    await expect(
      page.getByText(
        "Your cancellation is recorded the moment you confirm. Nobody needs to approve it.",
      ),
    ).toBeVisible();
    await page.getByLabel("Travel problem").check();
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(
      page.getByText(
        /^Cancelled\. Reference [0-9A-F]{8}\. A strike has been recorded\. It counts until .+\.$/,
      ),
    ).toBeVisible();
    // Their own account goes to the office.
    await page
      .getByLabel("If something stopped you, tell us what happened.")
      .fill("The trains were cancelled.");
    await page.getByRole("button", { name: "Send to the office" }).click();
    await expect(page.getByText(/^Sent to the office\. Reference [0-9A-F]{8}\.$/)).toBeVisible();
    await page.getByRole("button", { name: "Back to my shifts" }).click();

    // The one in about 4 days: no strike.
    await expect(page.getByText(LATER).first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel this shift" }).first().click();
    await expect(page.getByRole("note")).toHaveText(
      /^This shift starts in \d days\. Cancelling now doesn't give you a strike\.$/,
    );
    await page.getByLabel("Travel problem").check();
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(page.getByText(/^Cancelled\. Reference [0-9A-F]{8}\. No strike\.$/)).toBeVisible();

    expect(await strikesOn("acme", [soon.shiftId, later.shiftId])).toEqual([soon.shiftId]);
  } finally {
    await cancelOwnShift("acme", soon.shiftId);
    await cancelOwnShift("acme", later.shiftId);
  }
});
