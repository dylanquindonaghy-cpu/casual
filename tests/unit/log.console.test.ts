import { describe, expect, it } from "vitest";
import { createLogger } from "@/lib/log";
import { routeConsoleThroughMasking } from "@/lib/log/console";
import { createOnRequestError } from "@/lib/log/next";

// Errors printed outside our logger (Next.js's own error output, Node's) and server errors
// captured by Next.js go through the same masking.

describe("console routing", () => {
  it("masks what console.error and console.warn print", () => {
    const printed: unknown[][] = [];
    const target = {
      error: (...args: unknown[]) => printed.push(args),
      warn: (...args: unknown[]) => printed.push(args),
    };
    routeConsoleThroughMasking(target);
    routeConsoleThroughMasking(target); // idempotent: wraps once
    target.error(
      "Failed to save",
      new Error("Failed query: insert ...\nparams: Priya,07700900123"),
    );
    target.warn("worker +447700900123 not found");
    const out = JSON.stringify(printed);
    for (const leak of ["Priya", "7700900", "insert"]) expect(out).not.toContain(leak);
    expect(printed).toHaveLength(2);
  });
});

describe("Next.js request errors", () => {
  it("logs route, path without query string, and the masked error", async () => {
    const lines: string[] = [];
    const onRequestError = createOnRequestError(createLogger({ write: (l) => lines.push(l) }));
    await onRequestError(
      new Error('invalid input syntax for type uuid: "Priya Secretname"'),
      { path: "/login?mobile=07700900123", method: "POST", headers: {} },
      {
        routerKind: "App Router",
        routePath: "/login",
        routeType: "action",
        revalidateReason: undefined,
      },
    );
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({
      msg: "request failed",
      method: "POST",
      path: "/login",
      route: "/login",
    });
    for (const leak of ["Priya", "7700900", "mobile"]) expect(lines[0]).not.toContain(leak);
  });
});
