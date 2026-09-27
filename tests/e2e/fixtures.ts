import { createHash } from "node:crypto";
import { test as base } from "@playwright/test";

// Every e2e test gets its own client IP (as Caddy would set X-Real-IP), so tests don't share
// one rate-limit bucket and can't run each other out of login attempts.
// (Playwright calls the second argument `use`; it's named `provide` here because React's
// hooks lint rule treats any call to a function named `use` as a hook.)
export const test = base.extend({
  page: async ({ page }, provide, testInfo) => {
    const h = createHash("sha256").update(testInfo.testId).digest();
    await page.setExtraHTTPHeaders({ "x-real-ip": `10.${h[0]}.${h[1]}.${h[2]}` });
    await provide(page);
  },
});
export { expect } from "@playwright/test";
