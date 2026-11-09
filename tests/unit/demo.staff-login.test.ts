import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seedFirms } from "@/lib/db/admin/seed-data";
import { acmeStory } from "@/lib/db/admin/seed-story";
import { isMadeUpEmail } from "@/lib/demo/made-up";
import { seedId } from "@/lib/demo/seed-id";
import {
  DEMO_CASUAL_ID,
  STAFF_DEMO_FIRM_ID,
  STAFF_DEMO_USER,
  STAFF_LOGIN_HASH,
  STAFF_LOGIN_NAME,
  hashStaffPassword,
  loginNameMatches,
  parseScryptHash,
  passwordMatches,
  staffDemoOn,
  staffLoginMatches,
} from "@/lib/demo/staff-login";
import { parseAppEnv } from "@/lib/env";

// The staffing demo login's checks (Phase 31.1): a salted scrypt hash compared in constant time,
// the login name in any case and with spaces trimmed, and the gate (a demo server, on Acme only).
// The real password is never here: these tests make their own at run time.

const testPassword = () => `t-${randomBytes(9).toString("base64url")}`;

describe("the staffing demo login's hash", () => {
  it("matches its own password and nothing else", async () => {
    const password = testPassword();
    const hash = await hashStaffPassword(password, randomBytes(16));
    expect(await passwordMatches(password, hash)).toBe(true);
    expect(await passwordMatches(`${password}x`, hash)).toBe(false);
    expect(await passwordMatches(password.toUpperCase(), hash)).toBe(false);
    expect(await passwordMatches("", hash)).toBe(false);
    expect(await passwordMatches(` ${password}`, hash)).toBe(false);
    // Too long to be tried at all.
    expect(await passwordMatches("x".repeat(201), hash)).toBe(false);
  });

  it("the same password with another salt makes another hash", async () => {
    const password = testPassword();
    const a = await hashStaffPassword(password, randomBytes(16));
    const b = await hashStaffPassword(password, randomBytes(16));
    expect(a).not.toBe(b);
    expect(await passwordMatches(password, b)).toBe(true);
  });

  it("the committed hash is scrypt with N=2^15, a 16-byte salt and a 32-byte key", async () => {
    const parsed = parseScryptHash(STAFF_LOGIN_HASH);
    expect(parsed).toMatchObject({ N: 32768, r: 8, p: 1 });
    expect(parsed?.salt.length).toBe(16);
    expect(parsed?.key.length).toBe(32);
    expect(await passwordMatches(testPassword(), STAFF_LOGIN_HASH)).toBe(false);
  });

  it("refuses a hash that isn't one, or that would be too weak or too slow", async () => {
    const good = await hashStaffPassword("p", randomBytes(16));
    const [, , r, p, salt, key] = good.split("$");
    for (const bad of [
      "",
      "plain-text",
      `bcrypt$32768$${r}$${p}$${salt}$${key}`,
      `scrypt$1024$${r}$${p}$${salt}$${key}`, // too weak
      `scrypt$1048576$${r}$${p}$${salt}$${key}`, // too slow
      `scrypt$30000$${r}$${p}$${salt}$${key}`, // not a power of two
      `scrypt$32768$${r}$${p}$c2FsdA$${key}`, // a short salt
      `scrypt$32768$${r}$${p}$${salt}$a2V5`, // a short key
      `scrypt$32768$${r}$${p}$${salt}`,
    ]) {
      expect(parseScryptHash(bad), bad).toBeNull();
      expect(await passwordMatches("p", bad), bad).toBe(false);
    }
  });
});

describe("the login name", () => {
  it("matches in any case, with spaces around it trimmed", () => {
    expect(loginNameMatches(STAFF_LOGIN_NAME)).toBe(true);
    expect(loginNameMatches(STAFF_LOGIN_NAME.toLowerCase())).toBe(true);
    expect(loginNameMatches(STAFF_LOGIN_NAME.toUpperCase())).toBe(true);
    expect(loginNameMatches(`  ${STAFF_LOGIN_NAME}\t`)).toBe(true);
    expect(loginNameMatches(`${STAFF_LOGIN_NAME}x`)).toBe(false);
    expect(loginNameMatches(STAFF_DEMO_USER.email)).toBe(false);
    expect(loginNameMatches("")).toBe(false);
  });

  it("both must match, whichever part is wrong", async () => {
    const password = testPassword();
    const hash = await hashStaffPassword(password, randomBytes(16));
    const email = ` ${STAFF_LOGIN_NAME.toUpperCase()} `;
    expect(await staffLoginMatches({ email, password }, hash)).toBe(true);
    expect(await staffLoginMatches({ email: "someone@example.com", password }, hash)).toBe(false);
    expect(await staffLoginMatches({ email, password: "wrong" }, hash)).toBe(false);
  });
});

describe("where the staffing demo exists", () => {
  const northline = seedId("firm/northline");
  it("only on a demo server, and only on Acme Events", () => {
    expect(staffDemoOn("on", STAFF_DEMO_FIRM_ID)).toBe(true);
    expect(staffDemoOn(undefined, STAFF_DEMO_FIRM_ID)).toBe(false);
    expect(staffDemoOn("", STAFF_DEMO_FIRM_ID)).toBe(false);
    expect(staffDemoOn("off", STAFF_DEMO_FIRM_ID)).toBe(false);
    expect(staffDemoOn("on", northline)).toBe(false);
    expect(staffDemoOn("on", "11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(staffDemoOn("on", null)).toBe(false);
  });
});

describe("the account it opens and the casual it shows", () => {
  const acme = seedFirms().find((f) => f.slug === "acme");
  it("is a made-up admin in Acme's seed, never the login name", () => {
    expect(acme?.id).toBe(STAFF_DEMO_FIRM_ID);
    expect(acme?.officeUsers).toContainEqual({ ...STAFF_DEMO_USER });
    expect(isMadeUpEmail(STAFF_DEMO_USER.email)).toBe(true);
    expect(STAFF_DEMO_USER.role).toBe("admin");
    const emails = seedFirms().flatMap((f) => f.officeUsers.map((u) => u.email.toLowerCase()));
    expect(emails).not.toContain(STAFF_LOGIN_NAME.toLowerCase());
    // Its id sorts after the seeded roles', so "the first office user" is the one it was.
    const ids = (acme?.officeUsers ?? []).map((u) => u.id).sort();
    expect(ids.at(-1)).toBe(STAFF_DEMO_USER.id);
  });

  it("the casual view opens as the demo story's Zoe Adeyemi, 07700 900400", () => {
    const zoe = acmeStory(acme!, new Date()).workers.find((w) => w.key === "zoe");
    expect(zoe).toMatchObject({
      id: DEMO_CASUAL_ID,
      firstName: "Zoe",
      lastName: "Adeyemi",
      mobileE164: "+447700900400",
    });
  });
});

describe("the hash setting (DEMO_STAFF_LOGIN_HASH)", () => {
  const base = {
    DATABASE_URL: "postgres://shiftdesk_app:p@localhost:5432/shiftdesk",
    APP_BASE_DOMAIN: "localhost:3000",
    SESSION_SECRET: "test-only-secret-not-for-any-real-use-0123",
    NODE_ENV: "test",
  };
  it("takes a scrypt hash, never a password", async () => {
    const hash = await hashStaffPassword(testPassword(), randomBytes(16));
    expect(parseAppEnv({ ...base, DEMO_STAFF_LOGIN_HASH: hash }).DEMO_STAFF_LOGIN_HASH).toBe(hash);
    expect(parseAppEnv({ ...base, DEMO_STAFF_LOGIN_HASH: "" }).DEMO_STAFF_LOGIN_HASH).toBe(
      undefined,
    );
    expect(() => parseAppEnv({ ...base, DEMO_STAFF_LOGIN_HASH: "a-password-1!" })).toThrow(
      /DEMO_STAFF_LOGIN_HASH/,
    );
  });

  it("refuses at startup a hash whose numbers the login would refuse (else every login is wrong)", async () => {
    const good = await hashStaffPassword(testPassword(), randomBytes(16));
    const [, , , , salt, key] = good.split("$");
    for (const [N, r, p] of [
      [3, 8, 1],
      [32768, 99, 1],
      [32768, 8, 0],
      [1024, 8, 1],
      [30000, 8, 1],
    ]) {
      const bad = ["scrypt", N, r, p, salt, key].join("$");
      expect(() => parseAppEnv({ ...base, DEMO_STAFF_LOGIN_HASH: bad }), bad).toThrow(
        /DEMO_STAFF_LOGIN_HASH/,
      );
    }
  });
});
