import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { currentOfficeUser } from "@/lib/auth/office-login";
import { createSession } from "@/lib/auth/sessions";
import { LIMITS } from "@/lib/auth/throttle";
import { currentWorker } from "@/lib/auth/worker-login";
import { seed } from "@/lib/db/admin/seed";
import { withFirm } from "@/lib/db/scoped";
import { seedId } from "@/lib/demo/seed-id";
import {
  DEMO_CASUAL_ID,
  STAFF_DEMO_FIRM_ID,
  STAFF_DEMO_USER,
  STAFF_LOGIN_NAME,
  hashStaffPassword,
} from "@/lib/demo/staff-login";
import { loginWithStaffAccount, openCasualView } from "@/lib/demo/staff-session";
import { superuserPool, urls } from "../helpers/db";

// The staffing demo login and "Casual mobile view" (Phase 31) on the real database, as the app
// role, inside Acme's own withFirm transaction (golden rule 2): a right pair makes one office session
// for the made-up staffing admin and logs it; a wrong pair makes none; wrong pairs are throttled per
// IP and per login name; and the casual view starts a session for the demo story's Zoe only from an
// office session and only in demo mode. The password is made here, at run time; its hash is passed
// as DEMO_STAFF_LOGIN_HASH would be.

const ACME = STAFF_DEMO_FIRM_ID;
const NORTHLINE = seedId("firm/northline");
let su: Pool;
let password: string;
let hash: string;
let ipCount = 0;
const newIp = () => `10.31.${Math.floor(ipCount / 250)}.${(ipCount++ % 250) + 1}`;

const ctx = (over: { demoMode?: string; firmId?: string; ip?: string } = {}) => ({
  firm: { id: over.firmId ?? ACME },
  clientIp: over.ip ?? newIp(),
  demoMode: "demoMode" in over ? over.demoMode : "on",
  hash,
});

async function staffSessions(): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    "select count(*)::int as n from sessions where firm_id = $1 and office_user_id = $2",
    [ACME, STAFF_DEMO_USER.id],
  );
  return rows[0]?.n ?? 0;
}
async function zoeSessions(): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    "select count(*)::int as n from sessions where firm_id = $1 and worker_id = $2",
    [ACME, DEMO_CASUAL_ID],
  );
  return rows[0]?.n ?? 0;
}
async function eventsFor(action: string, entityId?: string) {
  const { rows } = await su.query<{
    firm_id: string;
    actor_type: string;
    actor_id: string | null;
    entity_type: string;
    entity_id: string | null;
    data: Record<string, unknown>;
  }>(
    `select firm_id::text, actor_type, actor_id::text, entity_type, entity_id::text, data
       from events where action = $1 and ($2::text is null or entity_id::text = $2) order by id`,
    [action, entityId ?? null],
  );
  return rows;
}

beforeAll(async () => {
  su = superuserPool();
  await seed({ adminUrl: urls.admin, appUrl: urls.app, nodeEnv: "test" });
  password = `t-${randomBytes(12).toString("base64url")}`;
  hash = await hashStaffPassword(password, randomBytes(16));
});
beforeEach(async () => {
  // Each test starts with no wrong tries counted for the demo login.
  await su.query("delete from auth_throttle where firm_id = $1 and bucket like 'login:demo_%'", [
    ACME,
  ]);
});
afterAll(async () => {
  await su.end();
});

describe("the staffing demo login", () => {
  it("a right pair makes one office session for the staffing admin in Acme, and logs it", async () => {
    const before = await staffSessions();
    const r = await loginWithStaffAccount(ctx(), {
      email: `  ${STAFF_LOGIN_NAME.toUpperCase()} `,
      password,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.officeUserId).toBe(STAFF_DEMO_USER.id);
    expect(await staffSessions()).toBe(before + 1);
    const me = await currentOfficeUser({ firm: { id: ACME } }, r.token);
    expect(me?.officeUser).toEqual({
      id: STAFF_DEMO_USER.id,
      name: "Staffing (demo)",
      role: "admin",
    });
    // Only on Acme: the same token means nothing to another firm.
    expect(await currentOfficeUser({ firm: { id: NORTHLINE } }, r.token)).toBeNull();
    const { rows } = await su.query<{ id: string }>(
      "select id::text from sessions where firm_id = $1 and office_user_id = $2 order by created_at desc limit 1",
      [ACME, STAFF_DEMO_USER.id],
    );
    const logged = await eventsFor("auth.demo_login", rows[0]?.id);
    expect(logged).toEqual([
      {
        firm_id: ACME,
        actor_type: "office",
        actor_id: STAFF_DEMO_USER.id,
        entity_type: "session",
        entity_id: rows[0]?.id,
        data: { kind: "office" },
      },
    ]);
  });

  it("a wrong pair makes no session and no login, whichever part is wrong; each is logged with no ids", async () => {
    const before = await staffSessions();
    const logins = (await eventsFor("auth.demo_login")).length;
    const failedBefore = (await eventsFor("auth.demo_login_failed")).length;
    const wrongs = [
      { email: STAFF_LOGIN_NAME, password: `${password}x` },
      { email: STAFF_DEMO_USER.email, password },
      { email: "", password: "" },
    ];
    for (const input of wrongs) {
      expect(await loginWithStaffAccount(ctx(), input)).toEqual({ status: "wrong" });
    }
    expect(await staffSessions()).toBe(before);
    expect(await eventsFor("auth.demo_login")).toHaveLength(logins);
    // One entry per wrong pair, as a refused login link is logged: never the name typed or the IP.
    const failed = (await eventsFor("auth.demo_login_failed")).slice(failedBefore);
    expect(failed).toEqual(
      wrongs.map(() => ({
        firm_id: ACME,
        actor_type: "system",
        actor_id: null,
        entity_type: "login_request",
        entity_id: null,
        data: {},
      })),
    );
  });

  it("wrong pairs sent all at once: at most 5 are checked, the rest wait (the count comes first)", async () => {
    const tries = 8;
    const results = await Promise.all(
      Array.from({ length: tries }, (_, i) =>
        loginWithStaffAccount(ctx(), { email: STAFF_LOGIN_NAME, password: `wrong-at-once-${i}` }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === "wrong").length).toBeLessThanOrEqual(
      LIMITS.demoLoginPerName.max,
    );
    expect(statuses.filter((s) => s === "rate_limited").length).toBeGreaterThanOrEqual(
      tries - LIMITS.demoLoginPerName.max,
    );
    expect(statuses.every((s) => s === "wrong" || s === "rate_limited")).toBe(true);
  });

  it("a right pair takes back its count: 5 right pairs then 4 wrong ones from one address still let the right pair in", async () => {
    const ip = newIp();
    for (let i = 0; i < LIMITS.demoLoginPerIp.max; i += 1) {
      const r = await loginWithStaffAccount(ctx({ ip }), { email: STAFF_LOGIN_NAME, password });
      expect(r.status).toBe("ok");
    }
    for (let i = 0; i < LIMITS.demoLoginPerIp.max - 1; i += 1) {
      const r = await loginWithStaffAccount(ctx({ ip }), {
        email: `other${i}@example.com`,
        password: "wrong",
      });
      expect(r.status).toBe("wrong");
    }
    const r = await loginWithStaffAccount(ctx({ ip }), { email: STAFF_LOGIN_NAME, password });
    expect(r.status).toBe("ok");
  });

  it("after 5 wrong pairs from one address, even the right pair waits; another address doesn't", async () => {
    const ip = newIp();
    for (let i = 0; i < LIMITS.demoLoginPerIp.max; i += 1) {
      const r = await loginWithStaffAccount(ctx({ ip }), {
        email: `someone${i}@example.com`,
        password: "wrong",
      });
      expect(r.status).toBe("wrong");
    }
    const before = await staffSessions();
    const limited = await loginWithStaffAccount(ctx({ ip }), { email: STAFF_LOGIN_NAME, password });
    expect(limited.status).toBe("rate_limited");
    if (limited.status === "rate_limited") {
      expect(limited.retryAfterMinutes).toBeGreaterThan(0);
      expect(limited.retryAfterMinutes).toBeLessThanOrEqual(15);
    }
    expect(await staffSessions()).toBe(before);
    expect((await loginWithStaffAccount(ctx(), { email: STAFF_LOGIN_NAME, password })).status).toBe(
      "ok",
    );
  });

  it("after 5 wrong passwords for the login name, from any addresses, it waits there too", async () => {
    const reached = async () =>
      (await eventsFor("auth.rate_limited")).filter(
        (e) => e.firm_id === ACME && e.data.limit === LIMITS.demoLoginPerName.name,
      ).length;
    const reachedBefore = await reached();
    for (let i = 0; i < LIMITS.demoLoginPerName.max; i += 1) {
      const r = await loginWithStaffAccount(ctx(), {
        email: i % 2 ? STAFF_LOGIN_NAME : ` ${STAFF_LOGIN_NAME.toLowerCase()}`,
        password: `wrong-${i}`,
      });
      expect(r.status).toBe("wrong");
    }
    const r = await loginWithStaffAccount(ctx(), { email: STAFF_LOGIN_NAME, password });
    expect(r.status).toBe("rate_limited");
    // The limit is logged once, at the first try it turns away (as every login limit is).
    expect(await reached()).toBe(reachedBefore + 1);
    await loginWithStaffAccount(ctx(), { email: STAFF_LOGIN_NAME, password });
    expect(await reached()).toBe(reachedBefore + 1);
  });

  it("refuses off a demo server, and on any firm but Acme", async () => {
    const before = await staffSessions();
    for (const c of [
      ctx({ demoMode: undefined }),
      ctx({ demoMode: "" }),
      ctx({ firmId: NORTHLINE }),
    ]) {
      expect(await loginWithStaffAccount(c, { email: STAFF_LOGIN_NAME, password })).toEqual({
        status: "off",
      });
    }
    expect(await staffSessions()).toBe(before);
  });

  it("the committed hash doesn't open it with the tests' password", async () => {
    const c = { ...ctx(), hash: undefined };
    expect(await loginWithStaffAccount(c, { email: STAFF_LOGIN_NAME, password })).toEqual({
      status: "wrong",
    });
  });
});

describe("Casual mobile view", () => {
  async function staffToken(): Promise<string> {
    const r = await loginWithStaffAccount(ctx(), { email: STAFF_LOGIN_NAME, password });
    if (r.status !== "ok") throw new Error(`login: ${r.status}`);
    return r.token;
  }

  it("from the staffing login, a casual's session for Zoe, logged with ids only", async () => {
    const token = await staffToken();
    const before = await zoeSessions();
    const r = await openCasualView(ctx(), token);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.workerId).toBe(DEMO_CASUAL_ID);
    expect(await zoeSessions()).toBe(before + 1);
    const zoe = await currentWorker({ firm: { id: ACME } }, r.token);
    expect(zoe?.worker).toMatchObject({
      id: DEMO_CASUAL_ID,
      firstName: "Zoe",
      lastName: "Adeyemi",
    });
    // It's a casual's session, not the office's.
    expect(await currentOfficeUser({ firm: { id: ACME } }, r.token)).toBeNull();
    const { rows } = await su.query<{ id: string }>(
      "select id::text from sessions where firm_id = $1 and worker_id = $2 order by created_at desc limit 1",
      [ACME, DEMO_CASUAL_ID],
    );
    expect(await eventsFor("auth.demo_casual_view", rows[0]?.id)).toEqual([
      {
        firm_id: ACME,
        actor_type: "office",
        actor_id: STAFF_DEMO_USER.id,
        entity_type: "session",
        entity_id: rows[0]?.id,
        data: { kind: "worker", workerId: DEMO_CASUAL_ID },
      },
    ]);
  });

  it("any office session on the demo firm will do", async () => {
    const resourcer = seedId("acme/office/resourcer");
    const session = await withFirm(ACME, (tx) =>
      createSession(tx, { kind: "office", subjectId: resourcer, now: new Date() }),
    );
    const r = await openCasualView(ctx(), session.token);
    expect(r.status).toBe("ok");
  });

  it("only from an office session: none, junk or a casual's own session open nothing", async () => {
    const zoeToken = await (async () => {
      const r = await openCasualView(ctx(), await staffToken());
      if (r.status !== "ok") throw new Error("no casual view");
      return r.token;
    })();
    const before = await zoeSessions();
    expect(await openCasualView(ctx(), undefined)).toEqual({ status: "logged_out" });
    expect(await openCasualView(ctx(), "not-a-token")).toEqual({ status: "logged_out" });
    expect(await openCasualView(ctx(), `shiftdesk_${"A".repeat(43)}`)).toEqual({
      status: "logged_out",
    });
    expect(await openCasualView(ctx(), zoeToken)).toEqual({ status: "logged_out" });
    expect(await zoeSessions()).toBe(before);
  });

  it("another firm's office session opens nothing on Acme (golden rule 2)", async () => {
    const northlineOffice = seedId("northline/office/resourcer");
    const theirs = await withFirm(NORTHLINE, (tx) =>
      createSession(tx, { kind: "office", subjectId: northlineOffice, now: new Date() }),
    );
    const before = await zoeSessions();
    // Northline's token, in Acme's context: not found there, so no casual view.
    expect(await openCasualView(ctx(), theirs.token)).toEqual({ status: "logged_out" });
    // And Acme's own staffing token in Northline's context: no staffing demo there at all.
    const ours = await staffToken();
    expect(await openCasualView(ctx({ firmId: NORTHLINE }), ours)).toEqual({ status: "off" });
    expect(await zoeSessions()).toBe(before);
    // The login itself, in Northline's context, makes no session in either firm.
    const staffBefore = await staffSessions();
    const { rows } = await su.query<{ n: number }>(
      "select count(*)::int as n from sessions where firm_id = $1 and kind = 'office'",
      [NORTHLINE],
    );
    expect(
      await loginWithStaffAccount(ctx({ firmId: NORTHLINE }), {
        email: STAFF_LOGIN_NAME,
        password,
      }),
    ).toEqual({ status: "off" });
    expect(await staffSessions()).toBe(staffBefore);
    const after = await su.query<{ n: number }>(
      "select count(*)::int as n from sessions where firm_id = $1 and kind = 'office'",
      [NORTHLINE],
    );
    expect(after.rows[0]?.n).toBe(rows[0]?.n);
    // No casual's session anywhere came from these.
    const { rows: theirsWorker } = await su.query<{ n: number }>(
      "select count(*)::int as n from sessions where firm_id = $1 and kind = 'worker' and created_at > now() - interval '1 minute'",
      [NORTHLINE],
    );
    expect(theirsWorker[0]?.n).toBe(0);
  });

  it("only in demo mode, and only on Acme", async () => {
    const token = await staffToken();
    const before = await zoeSessions();
    expect(await openCasualView(ctx({ demoMode: undefined }), token)).toEqual({ status: "off" });
    expect(await openCasualView(ctx({ firmId: NORTHLINE }), token)).toEqual({ status: "off" });
    expect(await zoeSessions()).toBe(before);
  });
});
