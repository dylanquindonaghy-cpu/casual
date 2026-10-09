import { z } from "zod";
import { logoutOffice } from "@/lib/auth/office-login";
import { clearSessionCookie, readSessionToken } from "@/lib/auth/session-cookie";
import { logoutWorker } from "@/lib/auth/worker-login";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// POST: log out (docs/api-and-jobs.md). A route, not a server action: an action's id changes with
// each build, so a My shifts copy kept on a phone before a deploy could no longer log out (audit
// L92); this address never changes. The firm comes from the host, the session from its cookie;
// the request must come from the site's own page (its Origin is this host). Ends the session and
// clears its cookie, as the old actions did; the browser then goes to the login page itself.

const body = z.strictObject({ kind: z.enum(["worker", "office"]) });
const MAX_BODY = 1024;

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && !!host && new URL(origin).host === host;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) return Response.json({ status: "forbidden" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY) {
    return Response.json({ status: "too_large" }, { status: 413 });
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY) {
    return Response.json({ status: "too_large" }, { status: 413 });
  }
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const parsed = body.safeParse(raw);
  if (!parsed.success) return Response.json({ status: "invalid" }, { status: 400 });
  const { kind } = parsed.data;
  const firm = await getCurrentFirm();
  try {
    const token = await readSessionToken(kind);
    if (token) {
      if (kind === "worker") await logoutWorker({ firm }, token);
      else await logoutOffice({ firm }, token);
    }
    await clearSessionCookie(kind);
    return Response.json({ status: "done" });
  } catch (error) {
    (await requestLog()).error("logout failed", { firmId: firm.id, error });
    return Response.json({ status: "error" }, { status: 500 });
  }
}
