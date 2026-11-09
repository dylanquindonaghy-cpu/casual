import { scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { isDemoFirm } from "./firms";
import { parseScryptHash } from "./scrypt-hash";
import { seedId } from "./seed-id";

export { parseScryptHash };

// The demo's staffing login (Phase 31.1; docs/screens.md "Phase 31"): on a demo server only, one
// login name and password open the office as a made-up admin of Acme Events, so Dylan can show the
// demo without waiting for a login email. Never off a demo server: every page and action checks
// staffDemoOn() on the server first. The login name is only what the form accepts; it's no one's
// email address (golden rule 7): the account it opens has a made-up one (STAFF_DEMO_USER).
//
// The password is never in the repo: only its salted scrypt hash (below). Any demo server can
// replace that hash, and so the password, with its own (DEMO_STAFF_LOGIN_HASH, which the login
// action reads wherever demo mode is on); the browser tests do, with the hash of a password they
// make at run time.

// The login name, compared after trimming and in any case.
export const STAFF_LOGIN_NAME = "Staffing@test.com";

// scrypt (N=2^15, r=8, p=1), a 16-byte random salt and a 32-byte key, base64url.
export const STAFF_LOGIN_HASH =
  "scrypt$32768$8$1$NweY1Jnw4U_ovLYLwXM8wQ$GAxII8lOSqUcN6C1jekO8bjUeC60yJXvkKQo4eZQETk";

// The made-up office user it logs in as, in the demo seed (src/lib/db/admin/seed-data.ts). Its id
// sorts after the three seeded roles', so anything that takes "the firm's first office user" by id
// still gets the one it got before.
export const STAFF_DEMO_FIRM_ID = seedId("firm/acme");
export const STAFF_DEMO_USER = {
  id: seedId("acme/office/staffing"),
  email: "staffing.demo@example.com",
  name: "Staffing (demo)",
  role: "admin",
} as const;

// The casual the "Casual mobile view" opens as: Zoe Adeyemi, the demo story's casual (07700 900400;
// src/lib/db/admin/seed-story.ts, the same fixed id).
export const DEMO_CASUAL_ID = seedId("acme/story/worker/zoe");

// The log entry openCasualView writes, in the same transaction as the casual's session it starts,
// naming that session (entity_type "session", entity_id its id). It is what marks a session as the
// office's look at Zoe's app rather than Zoe's own (Phase 33.3: her first-login tour isn't marked
// seen from it): the log is append-only, and nothing else writes this action.
export const DEMO_CASUAL_VIEW_ACTION = "auth.demo_casual_view";

// Whether the staffing demo pages and actions exist here: a demo server (DEMO_MODE=on), on Acme
// Events, the demo firm the login opens. Anywhere else they're not found.
export const staffDemoOn = (demoMode: string | undefined, firmId: string | null): boolean =>
  demoMode === "on" && firmId === STAFF_DEMO_FIRM_ID && isDemoFirm(firmId);

export const MAX_PASSWORD_LENGTH = 200;

export function loginNameMatches(raw: string): boolean {
  return raw.trim().toLowerCase() === STAFF_LOGIN_NAME.toLowerCase();
}

const scryptKey = (password: string, salt: Buffer, length: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, length, options, (error, key) => (error ? reject(error) : resolve(key))),
  );

// Whether the password matches the hash. The work is the same for any password (scrypt, then a
// constant-time compare), so the time taken says nothing.
export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const hash = parseScryptHash(stored);
  if (!hash || password.length > MAX_PASSWORD_LENGTH) return false;
  const { N, r, p, salt, key } = hash;
  const given = await scryptKey(password.normalize("NFC"), salt, key.length, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  });
  return timingSafeEqual(given, key);
}

// Makes a hash (the tests' own passwords; the committed one was made the same way, once).
export async function hashStaffPassword(password: string, salt: Buffer): Promise<string> {
  const N = 2 ** 15;
  const r = 8;
  const p = 1;
  const key = await scryptKey(password.normalize("NFC"), salt, 32, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  });
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

// Whether both match. Both are always checked, so a wrong name takes as long as a wrong password.
export async function staffLoginMatches(
  input: { email: string; password: string },
  stored: string,
): Promise<boolean> {
  const password = await passwordMatches(input.password, stored);
  const name = loginNameMatches(input.email);
  return password && name;
}
