import { webHealth } from "@/lib/db/health";
import { demoGate } from "@/lib/demo/gate";
import { appEnv } from "@/lib/env";

// Health (docs/api-and-jobs.md): 200 {"ok":true} when the web app reaches its database, 503
// {"ok":false} when it doesn't (checked at most once every 5 seconds, one check at a time). Docker's health check calls it inside the server
// (http://localhost:3000), so src/proxy.ts lets this one path through whatever the Host header.
// A demo server with no password set isn't healthy either (src/lib/demo/gate.ts): its deploy fails
// rather than reporting a site that turns everyone away.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const ok = demoGate(appEnv()).kind !== "missing" && (await webHealth());
  return Response.json(
    { ok },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
