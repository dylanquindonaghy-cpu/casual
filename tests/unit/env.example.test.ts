import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminEnvSchema, appEnvSchema, workerEnvSchema } from "@/lib/env";

// .env.example names every setting the code reads (audit L8), so a new one can't go undocumented.
// The browser tests' own switch is the exception: it must never be in an env file (src/lib/env.ts).
const NEVER_LISTED = ["E2E_TEST_PAGES"];

describe(".env.example", () => {
  it("names every setting the app, the worker and the scripts read", () => {
    const example = readFileSync(".env.example", "utf8");
    const named = new Set(
      [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] ?? ""),
    );
    const read = new Set([
      ...Object.keys(appEnvSchema.shape),
      ...Object.keys(workerEnvSchema.shape),
      ...Object.keys(adminEnvSchema.shape),
    ]);
    const missing = [...read].filter((key) => !named.has(key) && !NEVER_LISTED.includes(key));
    expect(missing).toEqual([]);
    for (const key of NEVER_LISTED) expect(named.has(key), key).toBe(false);
  });
});
