import type { APIRequestContext, Page } from "@playwright/test";
import { addEventWithSession, addOfficeUser, addSteward, bookAndCancel } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Integrations in a real browser (12J.1; docs/office-v2.md 5.3.2, 5.3.4), at phone width: an admin
// of this spec's own creates an API key, which is shown once and gone after a reload; the planner
// (this spec, server to server at the platform address) PUTs a session with it, which then shows on
// Events & sessions; the admin revokes the key, and the next call gets 401. Resourcers and payroll
// can't open the page. The event, site and refs are made up and this run's own (a retry makes new
// ones); the session is cancelled again through the API before the key is revoked.

const acme = "http://acme.localhost:3100";
// The API answers only at the platform address, never on a firm's own (5.3.2 "Where").
const api = "http://localhost:3100/api/v1";
const RUN = Date.now().toString(36);
const ADMIN = "integrations.admin@example.com";
const RESOURCER = "integrations.resourcer@example.com";
const PAYROLL = "integrations.payroll@example.com";
const KEY = /shiftdesk_[A-Za-z0-9_-]{43}/;
// A made-up address for the planner's calls (Caddy sets X-Real-IP in production).
const PLANNER_IP = "10.250.12.1";

async function officeLogin(page: Page, email: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  // Admins and resourcers land on the dashboard, payroll on the pay dashboard.
  await expect(page).toHaveURL(new RegExp(`^${acme}/office(/pay)?$`));
}

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

// A day 20 days ahead (UTC), so the session is still to come and books nobody's rest gap.
const dayAhead = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function planner(request: APIRequestContext, key: string) {
  const headers = {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    "x-real-ip": PLANNER_IP,
  };
  return {
    put: (ref: string, body: Record<string, unknown>) =>
      request.put(`${api}/sessions/${ref}`, { headers, data: JSON.stringify(body) }),
    get: (ref: string) => request.get(`${api}/sessions/${ref}`, { headers }),
  };
}

test("an admin creates a key (shown once); the planner sends a session with it; revoked, it's refused", async ({
  page,
  request,
}) => {
  await addOfficeUser("acme", { email: ADMIN, name: "Integrations Admin", role: "admin" });
  await officeLogin(page, ADMIN);
  await (await menuLink(page, "Integrations")).click();
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Integrations · Acme Events shifts");
  await expect(page.getByRole("heading", { name: "Your planner", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codes your planner can use" })).toBeVisible();
  await noSidewaysScroll(page);

  // Create a key: it's shown once, with the warning, and wraps at phone width.
  const label = `E2E planner ${RUN}`;
  await page.getByRole("textbox", { name: "Name" }).fill(label);
  await page.getByRole("button", { name: "Create a key" }).click();
  await expect(page.getByText("Copy this key now. You won't see it again.")).toBeVisible();
  const shown = page.locator("code").filter({ hasText: KEY });
  await expect(shown).toBeVisible();
  const key = ((await shown.textContent()) ?? "").trim();
  expect(key).toMatch(new RegExp(`^${KEY.source}$`));
  await noSidewaysScroll(page);
  // Listed by name and its last 4 characters only (stacked cards on a phone).
  const card = page.getByRole("listitem").filter({ hasText: label });
  await expect(card).toContainText(`…${key.slice(-4)}`);
  await expect(card).toContainText("Never");

  // Gone after a reload: the page never holds the key.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
  await expect(page.locator("code").filter({ hasText: KEY })).toHaveCount(0);
  expect(await page.content()).not.toContain(key);
  await expect(page.getByRole("listitem").filter({ hasText: label })).toBeVisible();

  // The planner sends a session with the key (made-up event, site and refs; a role code the acme
  // seed has): it's created, then shows on Events & sessions.
  const ref = `E2E-SESSION-${RUN}`;
  const event = `Planner Test Event ${RUN}`;
  const day = dayAhead(20);
  const call = planner(request, key);
  const created = await call.put(ref, {
    event: { ref: `E2E-EVENT-${RUN}`, name: event },
    site: { name: `Planner Test Ground ${RUN}` },
    role: "steward",
    starts_at: `${day}T10:00:00+00:00`,
    ends_at: `${day}T16:00:00+00:00`,
    places: 2,
    status: "open",
  });
  try {
    expect(created.status()).toBe(201);
    expect((await call.get(ref)).status()).toBe(200);
    await page.goto(`${acme}/office/events`);
    await expect(page.getByRole("heading", { name: "Events & sessions", level: 1 })).toBeVisible();
    await expect(page.getByText(event).first()).toBeVisible();
  } finally {
    // The session is this spec's own: cancel it again while the key still works.
    await call.put(ref, { status: "cancelled", change_reason: "event_cancelled" });
  }

  // Revoke the key: it asks first, then the planner's next call is refused at once.
  await page.goto(`${acme}/office/settings/integrations`);
  const listed = page.getByRole("listitem").filter({ hasText: label });
  await listed.getByRole("button", { name: `Revoke ${label}` }).click();
  await expect(
    listed.getByText(`Revoke ${label}? Your planner stops reaching ShiftDesk at once.`),
  ).toBeVisible();
  await listed.getByRole("button", { name: "Yes, revoke it" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Revoked. That key stopped working at once." }),
  ).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: label })).toHaveCount(0);
  expect((await call.get(ref)).status()).toBe(401);
  expect((await call.put(ref, { places: 3 })).status()).toBe(401);
  await noSidewaysScroll(page);
});

// The planner's webhook (12J.2; docs/office-v2.md 5.3.3, 5.3.4): an admin adds one (its signing
// secret shown once, gone after a reload; the address shown as its host and last 4 characters); a
// casual cancels; the e2e worker sends it through the console transport (WEBHOOK_TRANSPORT=console in
// serverEnv(): nothing leaves this machine) and the cancellation's record says it was sent. The
// address is made up (.example) and removed again at the end, so no other spec's bookings are sent.
test("an admin adds a webhook (secret shown once); a casual cancels; the record says it was sent", async ({
  page,
}) => {
  const admin = `webhook.admin.${RUN}@example.com`;
  await addOfficeUser("acme", { email: admin, name: "Webhook Admin", role: "admin" });
  await officeLogin(page, admin);
  await page.goto(`${acme}/office/settings/integrations`);
  await expect(page.getByRole("heading", { name: "Webhook", exact: true })).toBeVisible();
  const address = `https://hooks.example/e2e/${RUN}/k3F9`;
  try {
    await page.getByRole("textbox", { name: "Address" }).fill(address);
    await page.getByRole("button", { name: "Add a webhook" }).click();
    await expect(page.getByText("Signing secret:")).toBeVisible();
    await expect(
      page.getByText("Copy it into your planner now. You won't see it again."),
    ).toBeVisible();
    const secret = (
      (await page
        .locator("code")
        .filter({ hasText: /^whsec_/ })
        .textContent()) ?? ""
    ).trim();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    await expect(page.getByText("https://hooks.example/…k3F9")).toBeVisible();
    await expect(page.getByText("Added · nothing sent yet")).toBeVisible();
    await noSidewaysScroll(page);
    // Gone after a reload: neither the secret nor the whole address is ever on the page again.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Webhook", exact: true })).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(secret);
    expect(html).not.toContain(`/e2e/${RUN}/`);
    await expect(page.getByText("https://hooks.example/…k3F9")).toBeVisible();

    // A casual cancels their booking: the worker tells the planner, and the record says so.
    const { shiftId } = await addEventWithSession("acme", {
      name: `Webhook Test Event ${RUN}`,
      site: `Webhook Test Ground ${RUN}`,
      role: "steward",
      daysAhead: 9,
    });
    const workerId = await addSteward("acme", {
      firstName: "Wendy",
      lastName: `Webhook${RUN}`,
      mobileE164: "+447700900651",
    });
    const { ref } = await bookAndCancel("acme", { shiftId, workerId, reason: "Travel problem" });
    const planner = page.locator("dt", { hasText: /^Your planner$/ }).locator("+ dd");
    await expect(async () => {
      await page.goto(`${acme}/office/cancellations/${ref}`);
      await expect(planner).toHaveText(/^Sent to your planner at \d\d:\d\d on /, {
        timeout: 1_000,
      });
    }).toPass({ timeout: 30_000 });
    await page.goto(`${acme}/office/settings/integrations`);
    await expect(page.getByText(/^Working · last delivered /)).toBeVisible();
  } finally {
    await page.goto(`${acme}/office/settings/integrations`);
    const remove = page.getByRole("button", { name: "Remove", exact: true });
    if (await remove.isVisible()) {
      await remove.click();
      await page.getByRole("button", { name: "Yes, remove it" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Removed. Nothing more goes to your planner" }),
      ).toBeVisible();
    }
  }
  await expect(page.getByRole("button", { name: "Add a webhook" })).toBeVisible();
});

test("resourcers and payroll don't get Integrations", async ({ page }) => {
  for (const [email, role, home, theirs] of [
    [RESOURCER, "resourcer", "/office", "Events & sessions"],
    [PAYROLL, "payroll", "/office/pay", "Pay queries"],
  ] as const) {
    await addOfficeUser("acme", { email, name: `Integrations ${role}`, role });
    await page.context().clearCookies();
    await officeLogin(page, email);
    // Payroll lands on /office, then is sent on to the pay dashboard; the menu drawer shuts when
    // the page changes, so open it only once that move is over.
    await expect(page).toHaveURL(`${acme}${home}`);
    // Absent from the menu itself (opened first, so the check can't pass just because it's shut).
    await expect(await menuLink(page, theirs)).toBeVisible();
    await expect(await menuLink(page, "Integrations")).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect((await page.goto(`${acme}/office/settings/integrations`))?.status()).toBe(404);
  }
});
