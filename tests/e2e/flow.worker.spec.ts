import { expect, test } from "./fixtures";
import { codeSentTo, loginLinkSentTo } from "./outbox";

// The staff half of the demo script (docs/testing.md) on a phone-sized screen, on the demo
// seed's Saturday: log in → take a shift → cancel it → ask for a change → see pay with a code.
// Phase 3's "Done when": logging in, taking and cancelling each take under 30 seconds.
//
// The worker is a security officer the seed leaves unbooked (Acme worker 57); the two open
// security officer shifts are the only ones they can take, and no other test counts them.

const acme = "http://acme.localhost:3100";
const typed = "07700 900157";
const mobile = "+447700900157";
const LIMIT_MS = 30_000;

test("a worker logs in, takes a shift, cancels it, asks for a change and sees their pay", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const timings: Record<string, number> = {};
  const timed = async (step: string, run: () => Promise<void>) => {
    const started = Date.now();
    await run();
    timings[step] = Date.now() - started;
    expect(timings[step], `${step} took ${timings[step]} ms`).toBeLessThan(LIMIT_MS);
  };

  await timed("log in", async () => {
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(typed);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await expect(page.getByText("Check your phone.")).toBeVisible();
    await page.goto(await loginLinkSentTo(mobile, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();
  });
  await expect(page.getByText("No shifts booked yet.")).toBeVisible();

  await timed("take a shift", async () => {
    await page.getByRole("link", { name: "See all open shifts" }).click();
    await expect(page.getByRole("heading", { name: "Open shifts" })).toBeVisible();
    const racecourse = page.getByRole("listitem").filter({ hasText: "Acme Demo Racecourse" });
    await expect(racecourse).toHaveCount(1);
    await racecourse.getByRole("button", { name: "Take shift" }).click();
    await expect(page.getByText("You're booked.")).toBeVisible();
    await expect(racecourse.getByText(/^Reference: [0-9A-F]{8}$/)).toBeVisible();
    await expect(racecourse.getByText("— Acme Events Shift Team")).toBeVisible();
  });

  await timed("cancel it", async () => {
    await page.getByRole("link", { name: "See my shifts" }).click();
    await expect(page.getByRole("heading", { name: "Your next shift" })).toBeVisible();
    await expect(page.getByText("Security officer").first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel this shift" }).click();
    await page.getByLabel("I'm unwell").check();
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
    // Whether it's a strike depends on when the run is (the notice); the words say which.
    await expect(
      page.getByText(
        /^Cancelled\. Reference [0-9A-F]{8}\. (No strike\.|A strike has been recorded\. It counts until .+\.)$/,
      ),
    ).toBeVisible();
    await expect(page.getByText(/^You gave \d+ (hours'|days') notice\.$/)).toBeVisible();
  });
  await page.getByRole("button", { name: "Back to my shifts" }).click();
  await expect(page.getByText("No shifts booked yet.")).toBeVisible();

  await timed("ask for a change", async () => {
    await page.getByRole("link", { name: "See all open shifts" }).click();
    const centre = page.getByRole("listitem").filter({ hasText: "Acme Demo Shopping Centre" });
    await expect(centre).toHaveCount(1);
    await centre.getByRole("button", { name: "Take shift" }).click();
    await expect(page.getByText("You're booked.")).toBeVisible();
    await page.getByRole("link", { name: "See my shifts" }).click();
    await page.getByRole("link", { name: "Ask for a change" }).click();
    await expect(page).toHaveURL(new RegExp(`^${acme}/requests/new\\?shift=`));
    await page.getByLabel("Change the times").check();
    await page.getByLabel("New start").fill("16:00");
    await page.getByLabel("New finish").fill("23:00");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Request sent.")).toBeVisible();
    await expect(page.getByText("You asked for 16:00 to 23:00.")).toBeVisible();
  });
  await page.getByRole("link", { name: "See my requests" }).click();
  await expect(page).toHaveURL(`${acme}/requests`);
  await expect(page.getByText(/^Time change: Sat \d+ \w+, 15:00 to 23:00$/)).toBeVisible();
  await expect(page.getByText("Waiting for the office")).toBeVisible();
  await page.getByRole("link", { name: "Back to my shifts" }).click();

  await timed("see pay with a code", async () => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pay" }).click();
    await expect(page.getByText("To see your pay, we'll send you a 6-digit code.")).toBeVisible();
    const asked = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: "Send me a code" }).click();
    await page.getByLabel("Your code").fill(await codeSentTo(mobile, asked));
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page.getByText("The last 8 weeks, from Acme Events's payroll.")).toBeVisible();
    await expect(page.getByText(/ at £13\.50 an hour$/).first()).toBeVisible();
  });

  testInfo.annotations.push({ type: "timings (ms)", description: JSON.stringify(timings) });
  console.log(`[flow] timings in ms: ${JSON.stringify(timings)}`);
});
