import { request as httpRequest } from "node:http";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { WALKTHROUGH_PORT, WALKTHROUGH_SITE_PASSWORD } from "../../playwright.walkthrough.config";
import { seedFirms } from "../../src/lib/db/admin/seed-data";

// Demo mode (16.1; ADR-025), on the walkthrough's production build, which runs in demo mode as a
// demo server does (playwright.walkthrough.config.ts), after the walkthrough: the whole site needs
// the demo's password, nothing is sent, and each demo firm's Demo phone shows what it would have
// sent, its links logging people in as a real text or email would. People the walkthrough doesn't
// use. (The browser gives the password: the config's httpCredentials.)

test.describe.configure({ mode: "serial" });

const acme = `http://acme.localhost:${WALKTHROUGH_PORT}`;
const northline = `http://northline.localhost:${WALKTHROUGH_PORT}`;

const acmeFirm = seedFirms().find((f) => f.slug === "acme");
const casual = acmeFirm?.workers.find((w) => w.mobileE164 === "+447700900150");
if (!casual) throw new Error("no Acme casual on 07700 900150 in the seed");
const casualName = `${casual.firstName} ${casual.lastName}`;
const RESOURCER = "northline.resourcer@example.com";

let ip = 0;
async function phone(browser: Browser): Promise<Page> {
  ip += 1;
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    extraHTTPHeaders: { "x-real-ip": `10.76.0.${ip}` },
  });
  return context.newPage();
}
async function desk(browser: Browser): Promise<Page> {
  ip += 1;
  const context = await browser.newContext({
    ...devices["Desktop Chrome"],
    extraHTTPHeaders: { "x-real-ip": `10.76.1.${ip}` },
  });
  return context.newPage();
}

// A request from outside the browser (no remembered password), to a firm's address.
function get(host: string, path: string, authorization?: string) {
  return new Promise<{ status: number; challenge?: string; body: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: WALKTHROUGH_PORT,
        path,
        headers: { host, ...(authorization ? { authorization } : {}) },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            ...(res.headers["www-authenticate"]
              ? { challenge: res.headers["www-authenticate"] }
              : {}),
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
const basic = (password: string) => `Basic ${Buffer.from(`demo:${password}`).toString("base64")}`;

test("the whole site needs the demo's password; the server's own health check doesn't", async () => {
  const host = `acme.localhost:${WALKTHROUGH_PORT}`;
  for (const path of ["/login", "/demo", "/office", "/api/logout"]) {
    const without = await get(host, path);
    expect(without.status, path).toBe(401);
    expect(without.challenge, path).toBe('Basic realm="ShiftDesk demo", charset="UTF-8"');
    expect(without.body, path).toBe(
      "This demo needs its password. Ask the person who sent you the link.",
    );
    expect((await get(host, path, basic("not-the-demo-password"))).status, path).toBe(401);
  }
  const page = await get(host, "/login", basic(WALKTHROUGH_SITE_PASSWORD));
  expect(page.status).toBe(200);
  expect(page.body).toContain("A demo with made-up people.");
  expect((await get(host, "/api/health")).status).toBe(200);
  // The planner API checks its own key instead (the walkthrough's step 41 calls it with one): with
  // none, its own answer, not the password box.
  const api = await get(`localhost:${WALKTHROUGH_PORT}`, "/api/v1/sessions/SES-1");
  expect(api.status).toBe(401);
  expect(api.challenge).toBeUndefined();
  expect(api.body).toContain("invalid_key");
});

test("a casual logs in from the Demo phone", async ({ browser }) => {
  const page = await phone(browser);
  await page.goto(`${acme}/login`);
  const bar = page.getByRole("complementary", { name: "Demo" });
  await expect(bar).toContainText("A demo with made-up people.");
  await expect(bar.getByRole("link", { name: "Demo phone" })).toHaveAttribute("href", "/demo");
  await page.getByLabel("Your mobile number").fill("07700 900150");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your phone.")).toBeVisible();

  await bar.getByRole("link", { name: "Demo phone" }).click();
  await expect(page.getByRole("heading", { name: "Demo phone", level: 1 })).toBeVisible();
  // The worker sends in the background: the page checks again by itself every few seconds.
  const message = page
    .getByRole("listitem")
    .filter({ hasText: `to ${casualName}` })
    .filter({ hasText: "shifts link" })
    .first();
  await expect(message).toBeVisible({ timeout: 20_000 });
  await expect(message).toContainText("07700 900150");
  await message.getByRole("link", { name: /\/l#/ }).click();
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: `Hello ${casual.firstName}` })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Demo" })).toBeVisible();
});

test("the office logs in from its own firm's Demo phone; no firm sees another's messages", async ({
  browser,
}) => {
  const page = await desk(browser);
  await page.goto(`${northline}/office/login`);
  await page.getByLabel("Your work email").fill(RESOURCER);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();

  await page.goto(`${northline}/demo`);
  await expect(page.getByRole("heading", { name: "Demo phone", level: 1 })).toBeVisible();
  const email = page.getByRole("listitem").filter({ hasText: RESOURCER }).first();
  await expect(email).toBeVisible({ timeout: 20_000 });
  await expect(email).toContainText("Email to");
  // Acme's casual's text (the test before) is Acme's alone.
  await expect(page.getByText(`to ${casualName}`)).toHaveCount(0);

  await email.getByRole("link", { name: /\/office\/l#/ }).click();
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${northline}/office`);
  await expect(page.getByRole("complementary", { name: "Demo" })).toBeVisible();

  await page.goto(`${acme}/demo`);
  await expect(page.getByRole("heading", { name: "Demo phone", level: 1 })).toBeVisible();
  await expect(page.getByText(`to ${casualName}`).first()).toBeVisible();
  await expect(page.getByText(RESOURCER)).toHaveCount(0);
});
