import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The worker shares src/ but runs as its own process; keep server-only packages external.
  serverExternalPackages: ["pg", "pg-boss"],
};

export default nextConfig;
