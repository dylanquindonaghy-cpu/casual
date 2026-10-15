import { CUSTOM_DOMAIN } from "../../playwright.config";
import { setCustomDomain } from "../../scripts/firm-domain-owner";
import { addOfficeUser, e2eAdminUrl } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// A firm's own domain (Phase 8): Acme's portal on https://shifts.acme-events.test (the browser maps
// it to this machine's https front, as Caddy would serve it; see playwright.config.ts), served only
// once verified, with Acme's own bar; logging in there (Phase 10); and Caddy's certificate check.
// Set with the owner's own code (scripts/firm-domain-owner.ts); the DNS lookup is a stand-in that
// says whether the CNAME is there.

// https, through the browser tests' stand-in for Caddy (tests/e2e/tls-front.ts), whose certificate
// is self-signed: accepted here only.
const portal = `https://${CUSTOM_DOMAIN}`;
test.use({ ignoreHTTPSErrors: true });
const ask = (domain: string) => `http://localhost:3100/api/caddy/ask?domain=${domain}`;
const set = (cname: string[]) =>
  setCustomDomain(
    e2eAdminUrl(),
    "acme",
    { set: CUSTOM_DOMAIN, replace: true },
    {
      baseDomain: "localhost:3100",
      resolveCname: async () => cname,
    },
  );

test("Acme on its own domain: not served until verified, then its portal with its bar", async ({
  page,
  request,
}) => {
  try {
    // Saved, but its CNAME isn't there yet: not served, no certificate.
    expect(await set([])).toMatchObject({ status: "saved", verified: false });
    expect((await page.goto(`${portal}/login`))?.status()).toBe(404);
    expect((await page.goto(`${portal}/`))?.status()).toBe(404);
    expect((await request.get(ask(CUSTOM_DOMAIN))).status()).toBe(404);

    // The CNAME points to portal.<our domain>: verified.
    expect(
      await setCustomDomain(
        e2eAdminUrl(),
        "acme",
        { check: true },
        {
          baseDomain: "localhost:3100",
          resolveCname: async () => ["acme.localhost"], // Acme's own subdomain
        },
      ),
    ).toMatchObject({ status: "checked", verified: true });
    const res = await page.goto(`${portal}/login`);
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("brand-bar")).toHaveText("Acme Events");
    await expect(page.getByRole("heading", { name: "Log in to Acme Events" })).toBeVisible();
    // The portal's home page too: not logged in on this address yet, so to its login page.
    await page.goto(`${portal}/`);
    await expect(page).toHaveURL(`${portal}/login`);
    await expect(page.getByTestId("brand-bar")).toHaveText("Acme Events");
    expect((await request.get(ask(CUSTOM_DOMAIN))).status()).toBe(200);
  } finally {
    await setCustomDomain(
      e2eAdminUrl(),
      "acme",
      { clear: true },
      {
        baseDomain: "localhost:3100",
        resolveCname: async () => [],
      },
    );
  }
});

const verify = () =>
  setCustomDomain(
    e2eAdminUrl(),
    "acme",
    { set: CUSTOM_DOMAIN, replace: true },
    { baseDomain: "localhost:3100", resolveCname: async () => ["acme.localhost"] },
  );
const clear = () =>
  setCustomDomain(
    e2eAdminUrl(),
    "acme",
    { clear: true },
    { baseDomain: "localhost:3100", resolveCname: async () => [] },
  );
const SESSION = { worker: "__Host-sd_session", office: "__Host-sd_office" } as const;
const sessionsOn = async (
  context: import("@playwright/test").BrowserContext,
  address: string,
  name: string,
) => (await context.cookies(address)).filter((c) => c.name === name);

// Audit M7, L84: someone who starts on the firm's own domain is sent a link back to it, and stays
// logged in there (the session cookie belongs to the address the link opened). Before, every link
// went to acme.<our domain>, so the own domain never held a login.
test("a worker logs in on Acme's own domain and stays logged in there", async ({
  page,
  context,
}) => {
  try {
    expect(await verify()).toMatchObject({ verified: true });
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${portal}/login`);
    await page.getByLabel("Your mobile number").fill("07700 900116");
    await page.getByRole("button", { name: "Send me a link" }).click();
    await expect(page.getByText("Check your phone.")).toBeVisible();
    const link = await loginLinkSentTo("+447700900116", asked);
    expect(link.startsWith(`${portal}/l#`)).toBe(true);

    await page.goto(link);
    await expect(page).toHaveURL(`${portal}/l`);
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page).toHaveURL(`${portal}/`);
    await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();
    await expect(page.getByTestId("brand-bar")).toHaveText("Acme Events");
    expect(await sessionsOn(context, portal, SESSION.worker)).toHaveLength(1);
    expect(await sessionsOn(context, "http://acme.localhost:3100", SESSION.worker)).toHaveLength(0);

    // Still logged in there: another page, then a fresh visit.
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Profile" })
      .click();
    await page.getByRole("link", { name: "My requests" }).click();
    await expect(page).toHaveURL(`${portal}/requests`);
    await page.goto(`${portal}/`);
    await expect(page).toHaveURL(`${portal}/`);
    await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();
  } finally {
    await clear();
  }
});

test("an office user logs in on Acme's own domain and stays logged in there", async ({
  page,
  context,
}) => {
  // This spec's own admin (the seeded ones' links are used up by the other office specs).
  const email = "domain.admin@example.com";
  await addOfficeUser("acme", { email, name: "Domain Admin", role: "admin" });
  try {
    expect(await verify()).toMatchObject({ verified: true });
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${portal}/office/login`);
    await page.getByLabel("Your work email").fill(email);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await expect(page.getByText("Check your email.")).toBeVisible();
    const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
    expect(link.startsWith(`${portal}/office/l#`)).toBe(true);

    await page.goto(link);
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page).toHaveURL(`${portal}/office`);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Domain Admin Admin" })).toBeVisible();
    expect(await sessionsOn(context, portal, SESSION.office)).toHaveLength(1);
    expect(await sessionsOn(context, "http://acme.localhost:3100", SESSION.office)).toHaveLength(0);

    await page.goto(`${portal}/office/team`);
    await expect(page).toHaveURL(`${portal}/office/team`);
    await expect(page.getByRole("heading", { name: "Office team" })).toBeVisible();
  } finally {
    await clear();
  }
});

test("Caddy's certificate check: yes to a firm's subdomain, no to anything else", async ({
  request,
}) => {
  expect((await request.get(ask("acme.localhost"))).status()).toBe(200);
  for (const no of ["nobody-here.localhost", "localhost", "unknown.example", "", "10.0.0.1"]) {
    expect((await request.get(ask(no))).status(), no).toBe(404);
  }
  expect(await (await request.get(ask("acme.localhost"))).text()).toBe("ok");
});
