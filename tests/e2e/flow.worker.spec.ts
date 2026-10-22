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
    await expect(page.getByRole("heading", { name: /^Hi / })).toBeVisible();
  });
  // Home with nothing booked (Phase 18): the empty pass, and the way to the open shifts.
  await expect(page.getByRole("heading", { name: "No shifts booked" })).toBeVisible();

  await timed("take a shift", async () => {
    await page.getByRole("link", { name: "Find a shift" }).click();
    await expect(page.getByRole("heading", { name: "Open shifts" })).toBeVisible();
    // Each card opens the shift's page, where "Take shift" is.
    const racecourse = page.getByRole("listitem").filter({ hasText: "Acme Demo Racecourse" });
    await expect(racecourse).toHaveCount(1);
    await racecourse.getByRole("link").click();
    await page.getByRole("button", { name: "Take shift" }).click();
    await expect(page.getByText("You're booked.")).toBeVisible();
    await expect(page.getByText(/^Reference: [0-9A-F]{8}$/)).toBeVisible();
    await expect(page.getByText("— Acme Events Shift Team")).toBeVisible();
  });

  await timed("cancel it", async () => {
    await page.getByRole("link", { name: "See my shifts" }).click();
    await expect(page.getByRole("heading", { name: "Your next shift" })).toBeVisible();
    await expect(page.getByText("Security officer").first()).toBeVisible();
    // "Can't make it?" opens the sheet: the warning, why, then "Cancel this shift". "Ask for a
    // change instead" opens the request form for this shift; "Keep my shift" closes the sheet and
    // nothing is cancelled.
    await page.getByRole("button", { name: "Can't make it?" }).click();
    const sheet = page.getByRole("dialog", { name: "Can't make it?" });
    await sheet.getByRole("link", { name: "Ask for a change instead" }).click();
    await expect(page).toHaveURL(new RegExp(`^${acme}/requests/new\\?shift=[0-9a-f-]{36}$`));
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Your next shift" })).toBeVisible();
    await page.getByRole("button", { name: "Can't make it?" }).click();
    await expect(sheet.getByRole("note")).toBeVisible();
    await sheet.getByRole("button", { name: "Keep my shift" }).click();
    await expect(sheet).toBeHidden();
    // No reason chosen (Phase 20): the problem right under the reasons, the focus on the first.
    await page.getByRole("button", { name: "Can't make it?" }).click();
    await expect(sheet.getByRole("note")).toBeVisible();
    // The reasons: four large buttons, two to a row (each radio is the whole of its button).
    const reasons = sheet.getByRole("radio");
    await expect(reasons).toHaveCount(4);
    // Measured once the sheet has finished rising.
    await sheet.evaluate((d) =>
      Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    const boxes = [];
    for (const [i, name] of [
      "I'm unwell",
      "Travel problem",
      "Family or caring",
      "Something else",
    ].entries()) {
      await expect(reasons.nth(i)).toHaveAccessibleName(name);
      const box = await reasons.nth(i).boundingBox();
      if (!box) throw new Error(`no box for ${name}`);
      expect(box.height).toBeGreaterThanOrEqual(48);
      boxes.push(box);
    }
    const [a, b, c, d] = boxes as [
      (typeof boxes)[0],
      (typeof boxes)[0],
      (typeof boxes)[0],
      (typeof boxes)[0],
    ];
    expect([b.y, d.y]).toEqual([a.y, c.y]); // two to a row
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    expect(c.y).toBeGreaterThan(a.y + a.height - 1); // the second row under the first
    await sheet.getByRole("button", { name: "Cancel this shift" }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Choose a reason.");
    await expect(sheet.getByLabel("I'm unwell")).toBeFocused();
    // Pressed again with still no reason: the focus goes back to it again.
    await sheet.getByRole("button", { name: "Cancel this shift" }).focus();
    await sheet.getByRole("button", { name: "Cancel this shift" }).click();
    await expect(sheet.getByLabel("I'm unwell")).toBeFocused();
    // "Something else" with no note: the problem says so and the focus goes to the note.
    await sheet.getByLabel("Something else").check();
    await sheet.getByRole("button", { name: "Cancel this shift" }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Tell the office why.");
    await expect(sheet.getByLabel("Tell the office why")).toBeFocused();
    await sheet.getByLabel("I'm unwell").check();
    // Its handle is a real one: a short pull and it goes back; a long one and it closes, with
    // nothing cancelled. On a small phone the sheet scrolls, and the handle stays at its top, so it
    // can always be pulled.
    const handle = sheet.locator("[data-sheet-handle]");
    const phone = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 560 });
    expect(
      await sheet.evaluate((d) => (d.scrollTo(0, d.scrollHeight), d.scrollTop)),
    ).toBeGreaterThan(0);
    await expect(handle).toBeInViewport({ ratio: 1 });
    if (phone) await page.setViewportSize(phone);
    const pull = async (by: number) => {
      // Where the handle is once the sheet has stopped moving (it springs back after a short pull).
      await sheet.evaluate((d) => Promise.all(d.getAnimations().map((a) => a.finished)));
      const box = await handle.boundingBox();
      if (!box) throw new Error("no handle");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + by, { steps: 8 });
      await page.mouse.up();
    };
    await pull(40);
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS("translate", "none"); // back in its place
    await pull(180);
    await expect(sheet).toBeHidden();
    await page.reload();
    await expect(page.getByText("Security officer").first()).toBeVisible();
    await page.getByRole("button", { name: "Can't make it?" }).click();
    await sheet.getByLabel("I'm unwell").check();
    // While it's being sent (held back here for a moment), the sheet can't be closed: "Keep my
    // shift" waits and Escape leaves it, so the answer is always seen.
    const toBooked = (url: URL) => url.pathname === "/shifts";
    await page.route(toBooked, async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await sheet.getByRole("button", { name: "Cancel this shift" }).click();
    await expect(sheet.getByRole("button", { name: "Keep my shift" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();
    // Whether it's a strike depends on when the run is (the notice); the words say which.
    await expect(
      sheet.getByText(
        /^Cancelled\. Reference [0-9A-F]{8}\. (No strike\.|A strike has been recorded\. It counts until .+\.)$/,
      ),
    ).toBeVisible();
    await expect(sheet.getByText(/^You gave \d+ (hours'|days') notice\.$/)).toBeVisible();
    await page.unroute(toBooked);
    await sheet.getByRole("button", { name: "Done" }).click();
  });
  await expect(page.getByText("No shifts booked yet.")).toBeVisible();

  await timed("ask for a change", async () => {
    await page.getByRole("link", { name: "See all open shifts" }).click();
    const centre = page.getByRole("listitem").filter({ hasText: "Acme Demo Shopping Centre" });
    await expect(centre).toHaveCount(1);
    await centre.getByRole("link").click();
    await page.getByRole("button", { name: "Take shift" }).click();
    await expect(page.getByText("You're booked.")).toBeVisible();
    await page.getByRole("link", { name: "See my shifts" }).click();
    // On the pass, "Ask for a change" is in its Details (Phase 20).
    await page.locator("[data-pass-more] summary").click();
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
