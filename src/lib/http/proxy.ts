import { NextResponse, type NextRequest } from "next/server";
import type { Logger } from "../log";
import { capText, MAX_PATH } from "../log/mask";
import { parseHost } from "../tenancy/host";

// The body of src/proxy.ts, built with its dependencies so tests can check what it does.
// 1. Every request gets a fresh request ID. A client-sent x-request-id is overwritten, never
//    trusted. Server code reads it with requestId() (src/lib/request.ts) for its log lines.
// 2. Hosts we don't serve get a plain 404 before any page runs. Only the host's shape is checked
//    here (no database): whether the slug or custom domain is a real firm's is decided by
//    getCurrentFirm(). Two paths are let through on any host, for callers inside the server:
//    Caddy's on-demand TLS check (/api/caddy/ask, at http://web:3000) and the health check
//    (/api/health, Docker's at http://localhost:3000). Neither reads or writes firm data.
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
    const path = request.nextUrl.pathname;
    const internal = path === "/api/caddy/ask" || path === "/api/health";

    // The path only (never the query string), cut to MAX_PATH first: this runs for every request
    // on any host, before any login, so a huge path must cost nothing (audit M13). The logger masks
    // it, percent-encoding included.
    logger.info("request", {
      requestId,
      method: request.method,
      host:
        match?.kind === "firm" ? match.slug : (match?.kind ?? (internal ? "internal" : "rejected")),
      path: capText(path, MAX_PATH),
    });

    if (!match && !internal) {
      return new NextResponse("Not found", {
        status: 404,
        headers: { "x-request-id": requestId, "content-type": "text/plain; charset=utf-8" },
      });
    }

    // Our messages end sentences after a link ("Details: …/shifts/<id>."). A phone that takes the
    // full stop into the link would open a page that doesn't exist: no path of ours ends with
    // punctuation, so go to the same address without it (Phase 10 task 19, audit L10).
    const trimmed = path.replace(TRAILING_PUNCTUATION, "");
    if (trimmed !== path && trimmed.length > 0) {
      const to = request.nextUrl.clone();
      to.pathname = trimmed;
      const redirect = NextResponse.redirect(to, 308);
      redirect.headers.set("x-request-id", requestId);
      return redirect;
    }

    const response = NextResponse.next({ request: { headers } });
    response.headers.set("x-request-id", requestId);
    return response;
  };
}

// A full stop, comma or other sentence punctuation at the very end of a path, as a message puts
// after a link (including its percent-encoded forms for quotes).
const TRAILING_PUNCTUATION = /(?:[.,;:!?)\]]|%22|%27|%E2%80%99|%E2%80%9D)+$/i;
