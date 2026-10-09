import { webHealth } from "@/lib/db/health";

// Health (docs/api-and-jobs.md): 200 {"ok":true} when the web app reaches its database, 503
// {"ok":false} when it doesn't (checked at most once every 5 seconds, one check at a time). Docker's health check calls it inside the server
// (http://localhost:3000), so src/proxy.ts lets this one path through whatever the Host header.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const ok = await webHealth();
  return Response.json(
    { ok },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
