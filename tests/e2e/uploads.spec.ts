import type { Page } from "@playwright/test";
import sharp from "sharp";
import { addOfficeUser, addQualifiedCasual } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// Photos and certificate images in a real browser, on a phone (12F.2; docs/office-v2.md 3.7, 4.6,
// 5.5): a made-up steward of this spec's own (Una; a retry gets its own) uploads a staff photo with
// "Upload a new photo" and her Level 2 certificate from its upload page; the phone shrinks each to a
// JPEG first. A resourcer of its own sees the Casuals badge and "Uploads to check", opens each
// image (served by /files, only to them and her) and approves both, typing the certificate's
// expiry date. Una's Profile then shows her photo, up to date, and the certificate valid. Nobody
// logged out gets an image, and none is ever cached.

const acme = "http://acme.localhost:3100";

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
// A picture as a phone camera gives it: bigger than the 1,600px the phone sends.
const cameraPhoto = () =>
  sharp({
    create: { width: 2400, height: 3200, channels: 3, background: { r: 120, g: 140, b: 160 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
// An image on the page that the browser actually loaded (not a broken link): its address answers
// 200 to this browser, and the browser finished drawing it.
async function loaded(page: Page, alt: string) {
  const img = page.getByRole("img", { name: alt, exact: true }).first();
  const src = await img.getAttribute("src");
  const answer = await page.request.get(new URL(src ?? "", page.url()).toString());
  expect(answer.status(), `${alt}: ${src}`).toBe(200);
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  return true;
}

test("a casual uploads a photo and a certificate; the office checks them; her profile shows them", async ({
  page,
  browser,
}, testInfo) => {
  const n = testInfo.retry;
  const UNA = {
    firstName: "Una",
    lastName: `Upload${n || ""}`,
    mobileE164: `+4477009006${40 + n}`,
  };
  const una = `Una Upload${n || ""}`;
  await addQualifiedCasual("acme", UNA, { roles: ["steward"], held: [] });
  const resourcer = `uploads.resourcer${n || ""}@example.com`;
  await addOfficeUser("acme", { email: resourcer, name: "Ula Resourcer", role: "resourcer" });

  // Una logs in on her phone.
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page
    .getByLabel("Your mobile number")
    .fill(`0${UNA.mobileE164.slice(3, 7)} ${UNA.mobileE164.slice(7)}`);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(UNA.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" }).click();

  // The staff photo: none yet. "Upload a new photo" opens the front camera.
  const photo = page.getByRole("region", { name: "Staff photo", exact: true });
  await expect(photo).toContainText("No photo yet.");
  await expect(photo).toContainText("Missing");
  const camera = photo.getByLabel("Upload a new photo");
  await expect(camera).toHaveAttribute("capture", "user");
  await expect(camera).toBeEnabled();
  await camera.setInputFiles({
    name: "IMG_0001.jpg",
    mimeType: "image/jpeg",
    buffer: await cameraPhoto(),
  });
  await expect(photo.getByRole("status")).toHaveText("Sent. The office will check your photo.");
  await expect(photo).toContainText("Waiting for the office to check");
  await noSidewaysScroll(page);

  // Her Level 2 certificate, from its upload page (the back camera, or her photos).
  const quals = page.getByRole("region", { name: "Qualifications", exact: true });
  await expect(quals).toContainText("Level 2 spectator safety qualification");
  await expect(quals).toContainText("Missing · Needed for steward shifts");
  await quals.getByRole("link", { name: "Upload a certificate" }).click();
  await expect(page).toHaveURL(`${acme}/profile/upload/STEWARD_L2`);
  await expect(
    page.getByRole("heading", { name: "Upload your Level 2 spectator safety qualification" }),
  ).toBeVisible();
  const card = page.getByLabel("Take or choose a photo");
  await expect(card).toHaveAttribute("capture", "environment");
  await expect(card).toBeEnabled();
  await card.setInputFiles({
    name: "card.jpg",
    mimeType: "image/jpeg",
    buffer: await cameraPhoto(),
  });
  await expect(page.getByRole("status")).toHaveText("Sent. The office will check it.");
  await expect(page.getByText(/^Being checked · Sent \d{1,2} [A-Z][a-z]{2}/)).toBeVisible();
  await noSidewaysScroll(page);

  // The resourcer, in a browser of their own.
  const officeContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const office = await officeContext.newPage();
  try {
    const sentAt = new Date(Date.now() - 1000);
    await office.goto(`${acme}/office/login`);
    await office.getByLabel("Your work email").fill(resourcer);
    await office.getByRole("button", { name: "Send me a link" }).click();
    await expect(office.getByText("Check your email.")).toBeVisible();
    await office.goto(
      await sentTo(resourcer, sentAt, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/),
    );
    await office.getByRole("button", { name: "Log me in" }).click();
    await expect(office).toHaveURL(`${acme}/office`);

    // The Casuals menu says there are uploads to check; its view lists Una's two, oldest first.
    await expect(await menuLink(office, "Casuals")).toContainText(/\d+/);
    await office.goto(`${acme}/office/casuals?view=uploads`);
    const toCheck = office.getByRole("region", { name: "Uploads to check", exact: true });
    const hers = toCheck.getByRole("listitem").filter({ hasText: una });
    await expect(hers).toHaveCount(2);
    await expect(hers.nth(0)).toContainText("Staff photo · sent");
    await expect(hers.nth(1)).toContainText("Level 2 spectator safety qualification · sent");
    await hers.nth(0).getByRole("link", { name: "Check it" }).click();
    await expect(office.getByRole("heading", { name: una, level: 1 })).toBeVisible();

    // Each image, served to the office: approve the photo; the certificate with its expiry date.
    const uploads = office.getByRole("region", { name: "Uploads to check", exact: true });
    expect(await loaded(office, `New staff photo of ${una}`)).toBe(true);
    expect(await loaded(office, `Level 2 spectator safety qualification sent by ${una}`)).toBe(
      true,
    );
    const photoRow = uploads.getByRole("listitem").filter({ hasText: "Staff photo" });
    await photoRow.getByRole("button", { name: "Approve staff photo" }).click();
    // The answer stays in place (the rest of the page refreshes around it).
    await expect(photoRow.getByRole("status")).toHaveText("Approved. It counts from now.");
    const certificateRow = uploads.getByRole("listitem").filter({ hasText: "Level 2 spectator" });
    const nextYear = new Date().getUTCFullYear() + 2;
    await certificateRow.getByLabel("Expiry date on the card").fill(`${nextYear}-06-30`);
    await certificateRow.getByLabel("Number on the card").fill("L2-0042");
    await certificateRow
      .getByRole("button", { name: "Approve Level 2 spectator safety qualification" })
      .click();
    await expect(certificateRow.getByRole("status")).toHaveText("Approved. It counts from now.");
    // Nothing left to check once the page is opened again.
    await office.reload();
    await expect(office.getByRole("region", { name: "Uploads to check", exact: true })).toHaveCount(
      0,
    );
    const staffPhoto = office.getByRole("region", { name: "Staff photo", exact: true });
    await expect(staffPhoto).toContainText("Up to date");
    expect(await loaded(office, `Staff photo of ${una}`)).toBe(true);
    const officeQuals = office.getByRole("region", { name: "Qualifications", exact: true });
    await expect(officeQuals).toContainText(`Valid · Valid until 30 Jun ${nextYear}`);
    await expect(
      officeQuals.getByRole("link", { name: "See the card it came from" }),
    ).toBeVisible();

    // The Casuals table's Staff photo column: the upload date and its status.
    await office.goto(`${acme}/office/casuals`);
    const row = office
      .getByRole("region", { name: "All: casuals" })
      .getByRole("row")
      .filter({ hasText: una });
    await expect(row.getByRole("cell").nth(2)).toHaveText(/^\d{1,2} [A-Z][a-z]{2}Up to date$/);
  } finally {
    await officeContext.close();
  }

  // Una's Profile: her photo, up to date; the certificate valid.
  await page.goto(`${acme}/profile`);
  await expect(photo).toContainText(/Last uploaded \d{1,2} [A-Z][a-z]{2} · renew by/);
  await expect(photo).toContainText("Up to date");
  expect(await loaded(page, `Staff photo of ${una}`)).toBe(true);
  await expect(quals).toContainText(`Valid · Valid until 30 Jun`);

  // The image itself: hers, never cached; nobody logged out gets it.
  const src = await photo.getByRole("img", { name: `Staff photo of ${una}` }).getAttribute("src");
  expect(src).toMatch(/^\/files\/[0-9a-f-]{36}$/);
  const mine = await page.request.get(`${acme}${src}`);
  expect(mine.status()).toBe(200);
  expect(mine.headers()["content-type"]).toBe("image/jpeg");
  expect(mine.headers()["cache-control"]).toBe("private, no-store");
  // The phone sent at most 1,600px, and the server re-encoded it.
  const size = await sharp(await mine.body()).metadata();
  expect(Math.max(size.width ?? 0, size.height ?? 0)).toBeLessThanOrEqual(1600);
  expect(size.exif).toBeUndefined();
  const stranger = await (await browser.newContext()).request.get(`${acme}${src}`);
  expect(stranger.status()).toBe(404);
  expect(stranger.headers()["cache-control"]).toBe("private, no-store");
  expect((await page.locator("body").innerText()).toLowerCase()).not.toContain("credential");
});
