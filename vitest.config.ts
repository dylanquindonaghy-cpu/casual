import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/setup/global-db.ts"],
    setupFiles: ["tests/setup/env.ts"],
    // A test with no assertions fails instead of passing silently.
    expect: { requireAssertions: true },
    // Integration tests share one real database (and some alter policies inside transactions);
    // run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
