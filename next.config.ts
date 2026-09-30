import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The worker shares src/ but runs as its own process; keep server-only packages external.
  serverExternalPackages: ["pg", "pg-boss"],
  // Next's own terminal logs in development print each server action with its arguments (a mobile
  // typed into a search, a login link's token) and each request's full address: never personal
  // data or secrets in a log, even a developer's. The app's own request log (src/proxy.ts, masked)
  // records every request. The e2e teardown scans the output (tests/e2e/teardown.ts).
  logging: { serverFunctions: false, incomingRequests: false },
};

export default nextConfig;
