import type { Instrumentation } from "next";
import type { Logger } from "./index";
import { maskText } from "./mask";

// Server errors Next.js captures (pages, server actions, route handlers), logged through our
// masking logger. The request path is logged without its query string.
export function createOnRequestError(logger: Logger): Instrumentation.onRequestError {
  return async (err, request, context) => {
    const digest =
      typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
    logger.error("request failed", {
      method: request.method,
      path: maskText(request.path.split(/[?#]/)[0] ?? ""),
      route: context.routePath,
      routeType: context.routeType,
      digest,
      error: err,
    });
  };
}
