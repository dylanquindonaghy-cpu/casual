import { STREETS_FILE, STREETS_OUTBOX, STREETS_PORT } from "../../playwright.streets.config";
import { MAP_FONTS, MAP_GLYPH_RANGES } from "../../src/lib/office/map-style";
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
//
// Phase 27.8 (the map with proper detail): the tiny file's two town names are laid out, so MapLibre
// asks for their letter shapes, and every one comes from /map-glyphs on this server (public/,
// served by the app as Caddy passes it on) and answers; its + and − buttons are there, 44px, named
// "Zoom in" and "Zoom out", and each moves the map one zoom step.

const acme = `http://acme.localhost:${STREETS_PORT}`;
const HOST = `acme.localhost:${STREETS_PORT}`;

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
  // Every letter-shape file the map asks for (any request with "map-glyphs" in it, on any host)
  // and its answer.
  const glyphs: { host: string; path: string; status: number }[] = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.href.includes("map-glyphs"))
      glyphs.push({ host: u.host, path: decodeURIComponent(u.pathname), status: r.status() });
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

  // The names' letter shapes: the big town's in Medium, the other's in Regular with its ’ from the
  // punctuation range, each from our own server and found there; nothing from anywhere else.
  await expect
    .poll(() => glyphs.map((g) => g.path).sort(), { timeout: 30_000 })
    .toEqual(
      expect.arrayContaining([
        "/map-glyphs/Noto Sans Medium/0-255.pbf",
        "/map-glyphs/Noto Sans Regular/0-255.pbf",
        "/map-glyphs/Noto Sans Regular/8192-8447.pbf",
      ]),
    );
  const shape = new RegExp(
    `^/map-glyphs/(?:${MAP_FONTS.join("|")})/(?:${MAP_GLYPH_RANGES.join("|")})\\.pbf$`,
  );
  for (const g of glyphs) {
    expect(g.host, g.path).toBe(HOST);
    expect(g.path).toMatch(shape);
    expect(g.status, g.path).toBe(200);
  }

  // The + and − buttons: named, 44px, each one zoom step (the map's zoom is on its box).
  const zoomIn = map.getByRole("button", { name: "Zoom in" });
  const zoomOut = map.getByRole("button", { name: "Zoom out" });
  await expect(zoomIn).toBeVisible();
  await expect(zoomOut).toBeVisible();
  for (const button of [zoomIn, zoomOut]) {
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await expect(map).toHaveAttribute("data-zoom", /^\d+\.\d\d$/);
  const zoom = async () => Number(await map.getAttribute("data-zoom"));
  const start = await zoom();
  await zoomIn.click();
  await expect.poll(zoom).toBeCloseTo(start + 1, 1);
  await zoomOut.click();
  await expect.poll(zoom).toBeCloseTo(start, 1);
  await expect(page.locator('[data-venue-map="plain"]')).toHaveCount(0);

  // Phase 27.4 (the map you can use): its buttons in one column, top right, each 44px: the list,
  // the zoom's two, back to every venue.
  const buttons = map.getByRole("group", { name: "Map buttons" });
  expect(
    await buttons
      .getByRole("button")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))),
  ).toEqual(["Show the sessions to offer", "Zoom in", "Zoom out", "Back to every venue"]);
  const xs = new Set<number>();
  for (const button of await buttons.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect([Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)]).toEqual([44, 44]);
    xs.add(Math.round(box?.x ?? 0));
  }
  expect(xs.size).toBe(1);
  // Where the map is (its centre, on its box), fitted to every venue as the page arrived.
  const centre = async () =>
    ((await map.getAttribute("data-center")) ?? "").split(",").map(Number) as [number, number];
  const near = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
  const fitted = await centre();
  expect(fitted.every(Number.isFinite)).toBe(true);
  // A pin moves the map to its venue, zoomed in to the area round it at least (13), and picks its
  // venue's first session into the card; the page then has who can take it.
  const pin = map.locator('a[data-venue]:not([aria-current="true"])').first();
  const id = /session=([0-9a-f-]{36})/.exec((await pin.getAttribute("href")) ?? "")?.[1];
  expect(id).toBeDefined();
  await pin.click();
  await expect(page.locator(`[data-chosen="${id}"]`)).toBeVisible();
  await expect(page).toHaveURL(`${acme}/office?session=${id}`);
  await expect(page.locator(`[data-chosen="${id}"] [data-takers]`)).toHaveText(/^\d+$/);
  await expect.poll(zoom).toBeGreaterThanOrEqual(12.99);
  await expect.poll(async () => near(await centre(), fitted)).toBe(false);
  await expect(pin).toHaveAttribute("aria-current", "true");
  // Back to every venue: the view the page arrived with.
  await buttons.getByRole("button", { name: "Back to every venue" }).click();
  await expect.poll(zoom).toBeCloseTo(start, 1);
  await expect.poll(async () => near(await centre(), fitted)).toBe(true);
  // The list button opens To offer over the map's right (pressed, named for shutting it), and
  // shuts it again.
  const show = buttons.getByRole("button", { name: "Show the sessions to offer" });
  await expect(show).toHaveAttribute("aria-pressed", "false");
  await show.click();
  const hide = buttons.getByRole("button", { name: "Hide the sessions to offer" });
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  const list = page.locator("section#to-offer");
  await expect(list).toBeVisible();
  const [m, l] = [await map.boundingBox(), await list.boundingBox()];
  expect(Math.round((m?.x ?? 0) + (m?.width ?? 0) - ((l?.x ?? 0) + (l?.width ?? 0)))).toBe(64);
  // A row of it moves the map too, to its session's venue.
  const before = await centre();
  const row = list
    .locator("[data-session]")
    .filter({ hasNot: page.locator('a[aria-current="true"]') })
    .first();
  const rowId = await row.getAttribute("data-session");
  await row.locator('a[href^="/office?"]').click();
  await expect(page.locator(`[data-chosen="${rowId}"]`)).toBeVisible();
  await expect.poll(zoom).toBeGreaterThanOrEqual(12.99);
  await expect.poll(async () => near(await centre(), before)).toBe(false);
  await hide.click();
  await expect(list).toBeHidden();
  await expect(show).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-venue-map="plain"]')).toHaveCount(0);

  // The file was read by range, from our own path; no other host was asked.
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((r) => r.startsWith("bytes="))).toBe(true);
  expect([...hosts]).toEqual([HOST]);
});
