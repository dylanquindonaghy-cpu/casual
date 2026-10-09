import { appEnv } from "./lib/env";
import { log } from "./lib/log";
import { createProxy } from "./lib/http/proxy";

// Runs before every page and server action (Next 16 renamed middleware to proxy): gives each
// request a request ID, logs it, and turns away hosts we don't serve. See src/lib/http/proxy.ts.
export const proxy = createProxy(log, () => appEnv().APP_BASE_DOMAIN);

export const config = {
  // Everything except build assets and the favicon (anchored, so /_next/staticX is covered).
  // The image optimiser (/_next/image?url=...) is deliberately host-checked too.
  matcher: ["/((?!_next/static/|favicon\\.ico$).*)"],
};
