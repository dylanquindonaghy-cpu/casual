import { resolveFirmByDomain, resolveFirmBySlug } from "@/lib/db/directory";
import { appEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { approveCertificate } from "@/lib/tenancy/caddy-ask";

// Caddy's on-demand TLS check (src/lib/tenancy/caddy-ask.ts): 200 for a host in the firms table,
// 404 for anything else. Caddy calls it inside the server (http://web:3000), so src/proxy.ts lets
// this one path through whatever the Host header.
export async function GET(request: Request): Promise<Response> {
  const domain = new URL(request.url).searchParams.get("domain");
  const approved = await approveCertificate(domain, {
    baseDomain: appEnv().APP_BASE_DOMAIN,
    resolveFirmBySlug,
    resolveFirmByDomain,
  });
  log.info("caddy ask", { approved });
  return new Response(approved ? "ok" : "not ours", {
    status: approved ? 200 : 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
