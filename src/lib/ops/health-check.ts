import type { HealthResult } from "./alerts";

// The web app's health check as the worker sees it inside the server (HEALTH_CHECK_URL, e.g.
// http://web:3000/api/health). Healthy: 200 with {"ok":true} (src/app/api/health/route.ts). Three
// tries, 5 seconds apart, each with a 5-second limit, so one slow answer isn't an alert. The server
// being down altogether is the outside uptime check's job (docs/runbooks.md "Monitoring and
// alerts (once)"): nothing on it can report that.

export interface HealthCheckDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  timeoutMs?: number;
  gapMs?: number;
}

async function once(url: string, deps: Required<HealthCheckDeps>): Promise<HealthResult> {
  try {
    const res = await deps.fetch(url, {
      signal: AbortSignal.timeout(deps.timeoutMs),
      redirect: "manual",
      cache: "no-store",
    });
    if (res.status !== 200) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    return body?.ok === true ? { ok: true } : { ok: false, detail: "an unexpected answer" };
  } catch {
    return { ok: false, detail: "no answer" };
  }
}

export async function checkWebHealth(
  url: string,
  deps: HealthCheckDeps = {},
): Promise<HealthResult> {
  const full: Required<HealthCheckDeps> = {
    fetch: deps.fetch ?? fetch,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    attempts: deps.attempts ?? 3,
    timeoutMs: deps.timeoutMs ?? 5_000,
    gapMs: deps.gapMs ?? 5_000,
  };
  let last: HealthResult = { ok: false, detail: "no answer" };
  for (let i = 0; i < full.attempts; i += 1) {
    if (i > 0) await full.sleep(full.gapMs);
    last = await once(url, full);
    if (last.ok) return last;
  }
  return last;
}
