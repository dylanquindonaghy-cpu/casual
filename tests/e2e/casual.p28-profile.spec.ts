import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import sharp from "sharp";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import {
  P28_11_CASUAL,
  P28_11_EMAIL,
  P28_11_NUMBER,
  P28_11_TYPED,
  profileScene,
} from "./p28/28-11-data";

// Phase 28, 28.11 (docs/screens.md "### 28.11"): Profile, shorter and clearer, in a real browser as
// a made-up casual of this spec's own (tests/e2e/p28/28-11-data.ts), on a phone (390px):
// - My requests and Help are in the first screen;
// - her licence shows its number, with "message the office" a link to Messages; the qualification
//   the office marked sorted reads "The office has this in hand." with no upload;
// - travel, days off and how we reach her fold, and open without JavaScript too;
// - with no phone notifications (the test server has no key), "Notifications on this phone" isn't
//   there at all; her email address breaks only after its @ or a dot;
// - "The office sees the same figure.";
// - a chosen photo shows first, and nothing is sent until "Send this photo" (watched on the
//   network), then "Sent. The office will check your photo.";
// - "Back to my profile" is 52px tall on the upload and travel pages.
// Then screenshots at 390px and 1,280px (150%), light and dark, kept with the run.

const acme = "http://acme.localhost:3100";
const IP = "10.240.28.11";
const PHONE = { width: 390, height: 844 };
const SIZES = [
  { name: "phone", viewport: PHONE, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;

type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;

async function logIn(browser: Browser): Promise<Session> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": IP } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(P28_11_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P28_11_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(
      page.getByRole("heading", { name: `Hi ${P28_11_CASUAL.firstName}` }),
    ).toBeVisible();
    return await context.storageState();
  } finally {
    await context.close();
  }
}

const phoneContext = (
  browser: Browser,
  session: Session,
  o: { javaScriptEnabled?: boolean } = {},
) =>
  browser.newContext({
    storageState: session,
    viewport: PHONE,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "en-GB",
    extraHTTPHeaders: { "x-real-ip": IP },
    ...o,
  });

// A picture as a phone camera gives it.
const cameraPhoto = () =>
  sharp({
    create: { width: 2400, height: 3200, channels: 3, background: { r: 150, g: 120, b: 100 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

async function height(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box.height;
}

// Every place a line breaks inside her email address on screen: the character just before each
// new line (read off where each character is drawn), and the words as they read.
async function emailBreaks(email: Locator) {
  return email.evaluate((el) => {
    const chars: { ch: string; top: number }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const words = node.textContent ?? "";
      for (let i = 0; i < words.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        chars.push({ ch: words.charAt(i), top: Math.round(range.getBoundingClientRect().top) });
      }
    }
    const after: string[] = [];
    for (let i = 1; i < chars.length; i++) {
      const prev = chars[i - 1];
      const here = chars[i];
      if (prev && here && here.top > prev.top + 2) after.push(prev.ch);
    }
    return { words: chars.map((c) => c.ch).join(""), after };
  });
}

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

test("Profile, shorter and clearer: requests and Help first, folds, her number, in hand, the photo seen before it's sent", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  await profileScene();
  const session = await logIn(browser);

  const context = await phoneContext(browser, session);
  try {
    const page = await context.newPage();
    await page.goto(`${acme}/profile`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `${P28_11_CASUAL.firstName} ${P28_11_CASUAL.lastName}`,
      }),
    ).toBeVisible();

    // My requests and Help: rows in the first phone screen, each at least 44px to tap.
    const requests = page.getByRole("link", { name: /^My requests/ });
    const help = page.getByRole("link", { name: /^Help/ });
    await expect(requests).toHaveAttribute("href", "/requests");
    await expect(help).toHaveAttribute("href", "/help");
    for (const row of [requests, help]) {
      const box = await row.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    // Her licence: its number, and a way to fix a typo; Level 2, sorted by the office: in hand.
    const quals = page.getByRole("region", { name: "Qualifications", exact: true });
    const licence = quals.getByRole("listitem").filter({ hasText: "SIA door supervisor licence" });
    await expect(licence).toContainText(`Number: ${P28_11_NUMBER}`);
    const fix = licence.getByRole("link", { name: "message the office" });
    await expect(fix).toHaveAttribute("href", "/messages");
    expect(await height(fix)).toBeGreaterThanOrEqual(44);
    const upload = licence.getByRole("link", { name: "Upload a new one" });
    await expect(upload).toBeVisible();
    expect(await height(upload)).toBeGreaterThanOrEqual(44);
    const level2 = quals
      .getByRole("listitem")
      .filter({ hasText: "Level 2 spectator safety qualification" });
    await expect(level2).toContainText(
      "Until it's renewed you won't see steward shifts. The office has this in hand.",
    );
    await expect(level2.getByRole("link", { name: "Upload a new one" })).toHaveCount(0);
    await expect(page.getByText(/contact the office/i)).toHaveCount(0);

    // "The office", like every other line.
    await expect(page.getByRole("region", { name: "Your reliability" })).toContainText(
      "The office sees the same figure.",
    );

    // The folds: shut, each says how it stands; a tap opens it.
    const travel = page.getByRole("region", { name: "Your travel area" });
    const days = page.getByRole("region", { name: "Days you can't work" });
    const reach = page.getByRole("region", { name: "How we reach you" });
    await expect(travel).toContainText("Not set yet.");
    await expect(days).toContainText("No days marked");
    await expect(reach).toContainText("Open-shift alerts on");
    await expect(page.getByLabel("A day you can't work")).toBeHidden();
    await expect(travel.getByRole("link", { name: "Set your travel area" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Save settings" })).toBeHidden();
    await days.locator("summary").click();
    await expect(page.getByLabel("A day you can't work")).toBeVisible();
    await reach.locator("summary").click();
    await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
    // No phone notifications here (no key on the test server): nothing about them at all.
    await expect(page.getByText("Notifications on this phone")).toHaveCount(0);
    await expect(page.getByText(/doesn't use phone notifications/)).toHaveCount(0);

    // Her email address: whole, on its own line in How we reach you, breaking only after its @
    // or a dot (it's too long for one line at 390px, so it does break).
    const addresses = page.locator("[data-email]");
    await expect(addresses).toHaveCount(2); // Your details, and How we reach you
    let breaks = 0;
    for (const address of await addresses.all()) {
      await expect(address).toBeVisible();
      const read = await emailBreaks(address);
      expect(read.words).toBe(P28_11_EMAIL);
      for (const ch of read.after) expect(["@", "."], `broke after "${ch}"`).toContain(ch);
      breaks += read.after.length;
    }
    expect(breaks).toBeGreaterThan(0);
    await shoot(page, testInfo, "28.11 profile phone light (folds open)");

    // The staff photo: the chosen picture shows first; nothing leaves the phone until "Send this
    // photo" (an upload is the only multipart post this page makes).
    const sent: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        (request.headers()["content-type"] ?? "").startsWith("multipart/form-data")
      ) {
        sent.push(request.url());
      }
    });
    const photo = page.getByRole("region", { name: "Staff photo", exact: true });
    const camera = photo.getByLabel("Upload a new photo");
    await expect(camera).toBeEnabled();
    await camera.setInputFiles({
      name: "IMG_0311.jpg",
      mimeType: "image/jpeg",
      buffer: await cameraPhoto(),
    });
    const preview = photo.getByRole("img", { name: "The photo you chose" });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("src", /^blob:/);
    await expect(photo.getByText("Check it's clear and nothing is cut off.")).toBeVisible();
    await expect(photo.getByLabel("Take another")).toHaveAttribute("capture", "user");
    const send = photo.getByRole("button", { name: "Send this photo" });
    await expect(send).toBeEnabled();
    expect(await height(send)).toBeGreaterThanOrEqual(52);
    await page.waitForTimeout(1_500); // anything sent on choosing would have gone by now
    expect(sent).toEqual([]);
    await photo.scrollIntoViewIfNeeded();
    await shoot(page, testInfo, "28.11 photo preview phone light");
    await send.click();
    await expect(photo.getByRole("status")).toHaveText("Sent. The office will check your photo.");
    expect(sent.length).toBeGreaterThanOrEqual(1);
    await expect(preview).toHaveCount(0);
    await expect(photo).toContainText("Waiting for the office to check");

    // The upload page: the same first look, and a 52px way back.
    await page.goto(`${acme}/profile/upload/SIA_DS`);
    await expect(
      page.getByRole("heading", { name: "Upload your SIA door supervisor licence" }),
    ).toBeVisible();
    const before = sent.length;
    await page.getByLabel("Take or choose a photo").setInputFiles({
      name: "card.jpg",
      mimeType: "image/jpeg",
      buffer: await cameraPhoto(),
    });
    await expect(page.getByRole("img", { name: "The photo you chose" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send this photo" })).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(sent.length).toBe(before);
    expect(
      await height(page.getByRole("link", { name: "Back to my profile" })),
    ).toBeGreaterThanOrEqual(52);
    // The travel page: the same.
    await page.goto(`${acme}/profile/travel`);
    await expect(page.getByRole("heading", { name: "Your travel area", level: 1 })).toBeVisible();
    expect(
      await height(page.getByRole("link", { name: "Back to my profile" })),
    ).toBeGreaterThanOrEqual(52);
  } finally {
    await context.close();
  }

  // Without JavaScript: the folds still open (a native details), and the page is all there.
  const plain = await phoneContext(browser, session, { javaScriptEnabled: false });
  try {
    const page = await plain.newPage();
    await page.goto(`${acme}/profile`);
    const days = page.getByRole("region", { name: "Days you can't work" });
    await expect(page.getByLabel("A day you can't work")).toBeHidden();
    await days.locator("summary").click();
    await expect(page.getByLabel("A day you can't work")).toBeVisible();
    const reach = page.getByRole("region", { name: "How we reach you" });
    // Scrolled to the end, as she would: the last fold sits above Log out and the room left for
    // the tab bar, so the bar never covers it (Playwright alone counts it "in view" behind it).
    await page.mouse.wheel(0, 5_000);
    await reach.locator("summary").click();
    await expect(reach.getByText("Tell me about open shifts")).toBeVisible();
  } finally {
    await plain.close();
  }

  // Screenshots: Profile and an upload page, phone and laptop, light and dark.
  for (const size of SIZES)
    for (const theme of THEMES) {
      const look = await browser.newContext({
        storageState: session,
        viewport: size.viewport,
        deviceScaleFactor: size.scale,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        colorScheme: theme,
        locale: "en-GB",
        extraHTTPHeaders: { "x-real-ip": IP },
      });
      try {
        const page = await look.newPage();
        await page.goto(`${acme}/profile`);
        await expect(page.getByRole("link", { name: /^My requests/ })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(
          0,
        );
        await shoot(page, testInfo, `28.11 profile ${size.name} ${theme}`);
        await page.goto(`${acme}/profile/upload/SIA_DS`);
        await expect(page.getByRole("link", { name: "Back to my profile" })).toBeVisible();
        await shoot(page, testInfo, `28.11 upload ${size.name} ${theme}`);
      } finally {
        await look.close();
      }
    }
});
