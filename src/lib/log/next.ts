import type { Instrumentation } from "next";
import type { Logger } from "./index";
import { capText, maskText, MAX_PATH } from "./mask";

// What React's server renderer cancels a page with when the response's connection closes before
// the page is fully sent: usually the browser left (a tab closed, another page tapped, a test
// ending) while the page was still streaming; it can also be a proxy or timeout closing it. Not
// the page failing: logged as a warning, not an error.
export const BROWSER_LEFT = "The destination stream closed early.";
// React's other reason for the same: writing to that connection failed.
export const CONNECTION_FAILED = "The destination stream errored while writing data.";

// By the message alone (an error made in another part of the server may not be this Error class).
const browserLeft = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  "message" in err &&
  (err.message === BROWSER_LEFT || err.message === CONNECTION_FAILED);

// Server errors Next.js captures (pages, server actions, route handlers), logged through our
// masking logger. The request path is logged without its query string, cut to MAX_PATH. A
// connection closed mid-page is a warning, not an error (it showed as an error on every e2e run).
export function createOnRequestError(logger: Logger): Instrumentation.onRequestError {
  return async (err, request, context) => {
    const where = {
      method: request.method,
      path: maskText(capText(request.path.split(/[?#]/)[0] ?? "", MAX_PATH)),
      route: context.routePath,
      routeType: context.routeType,
    };
    if (browserLeft(err)) {
      logger.warn("request ended early: the connection closed before the page was sent", where);
      return;
    }
    const digest =
      typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
    logger.error("request failed", { ...where, digest, error: err });
  };
}
