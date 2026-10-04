import { describe, expect, it } from "vitest";
import { createLogger } from "@/lib/log";
import { routeConsoleThroughMasking } from "@/lib/log/console";
import { BROWSER_LEFT, CONNECTION_FAILED, createOnRequestError } from "@/lib/log/next";

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

  const context = {
    routerKind: "App Router" as const,
    routePath: "/office/shifts/[id]",
    routeType: "render" as const,
    revalidateReason: undefined,
  };

  // React cancels a page with this when the browser leaves before it's fully sent (a tab closed,
  // another page tapped, a test ending): not a server fault, so not logged as an error (it showed
  // as one on every e2e run). Anything else is still an error.
  it("a connection closed mid-page is a warning, not an error", async () => {
    const lines: string[] = [];
    const onRequestError = createOnRequestError(createLogger({ write: (l) => lines.push(l) }));
    const request = { path: "/office/shifts/abc?x=1", method: "GET", headers: {} };
    await onRequestError(new Error(BROWSER_LEFT), request, context);
    await onRequestError({ message: CONNECTION_FAILED }, request, context);
    await onRequestError(
      new Error("The destination stream closed early. Or did it?"),
      request,
      context,
    );
    await onRequestError(new TypeError("Cannot read properties of undefined"), request, context);
    expect(lines.map((l) => JSON.parse(l) as Record<string, unknown>)).toMatchObject([
      {
        level: "warn",
        msg: "request ended early: the connection closed before the page was sent",
        method: "GET",
        path: "/office/shifts/abc",
        route: "/office/shifts/[id]",
      },
      { level: "warn", msg: "request ended early: the connection closed before the page was sent" },
      { level: "error", msg: "request failed" },
      { level: "error", msg: "request failed" },
    ]);
    expect(lines[0]).not.toContain('"error"');
  });

  it("cuts a huge path before masking it", async () => {
    const lines: string[] = [];
    const onRequestError = createOnRequestError(createLogger({ write: (l) => lines.push(l) }));
    const started = performance.now();
    await onRequestError(
      new Error("x"),
      { path: "/a".repeat(8000), method: "GET", headers: {} },
      context,
    );
    expect(performance.now() - started).toBeLessThan(50);
    const path = (JSON.parse(lines[0] ?? "{}") as { path: string }).path;
    expect(path.length).toBeLessThanOrEqual(512 + 30);
  });
});
