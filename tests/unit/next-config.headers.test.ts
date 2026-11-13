import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// Phase 37.7 (w1-11): Next doesn't announce itself (no X-Powered-By: Next.js on any answer). Caddy
// removes the header too (deploy/Caddyfile); this covers development, the browser tests and any
// server without Caddy. The browser test checks a production answer
// (tests/e2e/demo.staff-login.spec.ts).
describe("Next's own headers", () => {
  it("sends no X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
