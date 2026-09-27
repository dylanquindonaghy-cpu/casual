import { NextResponse, type NextRequest } from "next/server";
import type { Logger } from "../log";
import { parseHost } from "../tenancy/host";

// The body of src/proxy.ts, built with its dependencies so tests can check what it does.
// 1. Every request gets a fresh request ID. A client-sent x-request-id is overwritten, never
//    trusted. Server code reads it with requestId() (src/lib/request.ts) for its log lines.
// 2. Hosts we don't serve get a plain 404 before any page runs. Only the host's shape is checked
//    here (no database): whether the slug is a real firm is decided by getCurrentFirm().
export function createProxy(
  logger: Logger,
  baseDomain: () => string,
): (request: NextRequest) => NextResponse {
  return (request) => {
    const requestId = crypto.randomUUID();
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    const host = request.headers.get("host");
    const match = parseHost(host, baseDomain());

    // The path only (never the query string). The logger masks it, percent-encoding included.
    logger.info("request", {
      requestId,
      method: request.method,
      host: match?.kind === "firm" ? match.slug : (match?.kind ?? "rejected"),
      path: request.nextUrl.pathname,
    });

    if (!match) {
      return new NextResponse("Not found", {
        status: 404,
        headers: { "x-request-id": requestId, "content-type": "text/plain; charset=utf-8" },
      });
    }

    const response = NextResponse.next({ request: { headers } });
    response.headers.set("x-request-id", requestId);
    return response;
  };
}
