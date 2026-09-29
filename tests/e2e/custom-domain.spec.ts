import { CUSTOM_DOMAIN } from "../../playwright.config";
import { setCustomDomain } from "../../scripts/firm-domain-owner";
import { e2eAdminUrl } from "./db";
import { expect, test } from "./fixtures";

// A firm's own domain (Phase 8): Acme's portal on shifts.acme-events.test (the browser maps it to
// this machine; see playwright.config.ts), served only once verified, with Acme's own bar; and
// Caddy's certificate check. Set with the owner's own code (scripts/firm-domain-owner.ts); the DNS
// lookup is a stand-in that says whether the CNAME is there.

const portal = `http://${CUSTOM_DOMAIN}:3100`;
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

test("Caddy's certificate check: yes to a firm's subdomain, no to anything else", async ({
  request,
}) => {
  expect((await request.get(ask("acme.localhost"))).status()).toBe(200);
  for (const no of ["nobody-here.localhost", "localhost", "unknown.example", "", "10.0.0.1"]) {
    expect((await request.get(ask(no))).status(), no).toBe(404);
  }
  expect(await (await request.get(ask("acme.localhost"))).text()).toBe("ok");
});
