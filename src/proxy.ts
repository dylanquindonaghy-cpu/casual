import { demoGate } from "./lib/demo/gate";
import { appEnv } from "./lib/env";
import { log } from "./lib/log";
import { createProxy } from "./lib/http/proxy";

// Runs before every page and server action (Next 16 renamed middleware to proxy): gives each
// request a request ID, logs it, turns away hosts we don't serve, and on a demo server asks for
// the demo's password (src/lib/demo/gate.ts). See src/lib/http/proxy.ts.
export const proxy = createProxy(
  log,
  () => appEnv().APP_BASE_DOMAIN,
  () => demoGate(appEnv()),
);

export const config = {
  // Everything except build assets and the favicon (anchored, so /_next/staticX is covered).
  // The image optimiser (/_next/image?url=...) is deliberately host-checked too.
  matcher: ["/((?!_next/static/|favicon\\.ico$).*)"],
};
