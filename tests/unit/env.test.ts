import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/shiftdesk" };

describe("parseEnv", () => {
  it("accepts a minimal valid environment and applies defaults", () => {
    const env = parseEnv(base);
    expect(env.MESSAGING_TRANSPORT).toBe("console");
    expect(env.NODE_ENV).toBe("development");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://u:p@localhost/x" })).toThrow(/DATABASE_URL/);
  });

  it("rejects the twilio transport until it exists (Phase 4)", () => {
    expect(() => parseEnv({ ...base, MESSAGING_TRANSPORT: "twilio" })).toThrow(
      /MESSAGING_TRANSPORT/,
    );
  });

  it("rejects the console transport in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/MESSAGING_TRANSPORT/);
  });
});
