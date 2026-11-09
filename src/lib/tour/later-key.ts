import { createHmac } from "node:crypto";
import { appEnv } from "../env";

// The first-login tour's "Not now" holds for one login (Phase 33.2): the browser keeps it against
// this key, an HMAC of the login's own id with the server's session secret, so the page never
// carries the id or anything it could be matched to. Server only.
export function tourLaterKey(sessionId: string, secret: string = appEnv().SESSION_SECRET): string {
  return createHmac("sha256", secret).update(`tour-later:${sessionId}`).digest("hex").slice(0, 16);
}
