import { STREETS_FILE, STREETS_OUTBOX, STREETS_PORT } from "../../playwright.streets.config";
import { addOfficeUser } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";
import { pmtilesFixture, rangeOf } from "./pmtiles-fixture";

// The dashboard's street map in a real browser (Phase 26.2, decision 9; the claims-auditor's round
// 1), on the run with the firm's map file set (playwright.streets.config.ts): MapLibre opens the
// file by byte range from our own server path (answered here with a tiny map file, as Caddy serves
// the real one), loads its worker from our own route, and draws; the map then says it's the
// streets, carries OpenStreetMap's credit, and keeps its venue pins. Nothing is asked of any other
// host. (The worker file going missing once kept the streets from drawing, unseen by the other
// runs, which have no street map.)

const acme = `http://acme.localhost:${STREETS_PORT}`;

test("the street map: the firm's file by range from our own path, MapLibre's worker from our route, drawn", async ({
  page,
}) => {
  const file = pmtilesFixture();
  const asked: string[] = [];
  await page.route(`**${STREETS_FILE}`, async (route) => {
    const range = route.request().headers()["range"];
    asked.push(range ?? "whole");
    const answer = rangeOf(file, range);
    await route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
  });
  // Every request the page makes: only this server (and the browser's own data: and blob: URLs).
  const hosts = new Set<string>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http")) hosts.add(u.host);
  });
  const worker = page.waitForResponse((r) => r.url().includes("/office/map-worker"));

  const email = "streets.resourcer@example.com";
  await addOfficeUser("acme", { email, name: "Streets Resourcer", role: "resourcer" });
  const sent = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(
    email,
    sent,
    /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/,
    STREETS_OUTBOX,
  );
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);

  // Drawn: MapLibre's canvas, the streets, the credit; its worker answered from our route.
  const map = page.locator('[data-venue-map="streets"]');
  await expect(map).toBeVisible({ timeout: 30_000 });
  await expect(map.locator("canvas.maplibregl-canvas")).toBeVisible();
  await expect(map.getByText("© OpenStreetMap contributors")).toBeVisible();
  const answered = await worker;
  expect(answered.status()).toBe(200);
  expect(answered.headers()["content-type"]).toContain("text/javascript");
  // Still the streets once it has loaded (a failed load falls back to the plain map).
  await page.waitForTimeout(2000);
  await expect(page.locator('[data-venue-map="plain"]')).toHaveCount(0);
  // The file was read by range, from our own path; no other host was asked.
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((r) => r.startsWith("bytes="))).toBe(true);
  expect([...hosts]).toEqual([`acme.localhost:${STREETS_PORT}`]);
});
