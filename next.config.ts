import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The worker shares src/ but runs as its own process; keep server-only packages external.
  serverExternalPackages: ["pg", "pg-boss"],
  // Next's own terminal logs in development print each server action with its arguments (a mobile
  // typed into a search, a login link's token) and each request's full address: never personal
  // data or secrets in a log, even a developer's. The app's own request log (src/proxy.ts, masked)
  // records every request. The e2e teardown scans the output (tests/e2e/teardown.ts).
  logging: { serverFunctions: false, incomingRequests: false },
  // Development only: the dev server refuses its live connection to any address but localhost, and
  // without it a page never becomes interactive. The browser tests try a firm's own domain on this
  // made-up name (CUSTOM_DOMAIN in playwright.config.ts; .test is reserved, so it never exists on
  // the internet). A production server ignores this.
  allowedDevOrigins: ["shifts.acme-events.test"],
};

export default nextConfig;
