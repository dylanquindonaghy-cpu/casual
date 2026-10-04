import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consumeOfficeLoginLink,
  currentOfficeUser,
  logoutOffice,
  officeTeam,
  requestOfficeLoginLink,
} from "@/lib/auth/office-login";
import { createSendPortalLinkTask, sendPortalLink } from "@/lib/auth/send-portal-link";
import { MINUTE } from "@/lib/auth/clock";
import { createSession } from "@/lib/auth/sessions";
import { hashToken } from "@/lib/auth/tokens";
import { consumeWorkerLoginLink, currentWorker } from "@/lib/auth/worker-login";
import { magicLinks } from "@/lib/db/schema";
import { withFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import type { OutboundMessage } from "@/lib/messaging";
import {
  captureTransport,
  eventMark,
  eventsFor,
  latestLinkJob,
  quietLogger,
} from "../helpers/auth";
import { superuserPool } from "../helpers/db";
import { fulfilled, race } from "../helpers/race";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Office login: work email -> one-time link by email -> 30-day session with a role.

let su: Pool;
beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

let ipCounter = 0;
const freshIp = () => `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

async function officeEmail(T: Tenant, id = T.officeUserId) {
  const { rows } = await su.query<{ email: string }>(
    "select email from office_users where id = $1",
    [id],
  );
  return rows[0]?.email ?? "";
}

async function addOfficeUser(T: Tenant, role: "admin" | "resourcer" | "payroll") {
  const { rows } = await su.query<{ id: string }>(
    `insert into office_users (firm_id, email, name, role) values ($1, $2, $3, $4) returning id::text`,
    [T.firmId, `${role}${randomUUID().slice(0, 8)}@example.com`, `Test ${role}`, role],
  );
  return rows[0]?.id ?? "";
}

// One fixed moment for the whole file, so no test depends on the machine's clock (a rate-limit
// window can't roll over halfway through a test).
const NOW = new Date("2026-10-01T12:00:00.000Z");
const at = (when: Date) => ({ now: () => when });

// Sends an office link to an office user and returns the email and its token.
async function officeLinkFor(T: Tenant, officeUserId = T.officeUserId, when = NOW) {
  const { transport, sent } = captureTransport();
  await sendPortalLink(
    {
      firmId: T.firmId,
      idempotencyKey: randomUUID(),
      purpose: "office_login",
      subjectId: officeUserId,
    },
    withFirm,
    { transport, clock: at(when), baseDomain: "localhost:3000" },
  );
  const email = sent[0] as Extract<OutboundMessage, { channel: "email" }> | undefined;
  const token = /\/office\/l#([A-Za-z0-9_-]{43})\b/.exec(email?.body ?? "")?.[1] ?? "";
  return { email, token };
}

const ctx = (T: Tenant, when = NOW) => ({
  firm: { id: T.firmId },
  clientIp: freshIp(),
  clock: at(when),
});

describe("office login, start to finish", () => {
  it("emails a one-time link that logs the office user in once, on their own firm, with their role", async () => {
    const A = await createTenant(su);
    const B = await createTenant(su);
    const since = await eventMark(su);
    const address = await officeEmail(A);

    expect(await requestOfficeLoginLink(ctx(A), `  ${address.toUpperCase()} `)).toEqual({
      status: "sent",
    });
    const job = await latestLinkJob(su, A.firmId);
    expect(job?.data).toMatchObject({ purpose: "office_login", subjectId: A.officeUserId });
    expect(JSON.stringify(job?.data)).not.toContain(address);

    const { transport, sent } = captureTransport();
    const def = createSendPortalLinkTask(() => ({
      transport,
      clock: at(NOW),
      baseDomain: "localhost:3000",
    }));
    const result = await runFirmTask(def, job ?? { id: "", data: {} }, undefined, quietLogger);
    expect(result.status).toBe("completed");
    const email = sent[0] as Extract<OutboundMessage, { channel: "email" }>;
    expect(email).toMatchObject({ channel: "email", to: address });
    expect(email.subject).toBe(`Your Test Firm ${A.slug} office login link`);
    expect(email.body).toContain(`http://${A.slug}.localhost:3000/office/l#`);
    expect(email.body.trim().endsWith(`— Test Firm ${A.slug} Shift Team`)).toBe(true);
    const token = /\/office\/l#([A-Za-z0-9_-]{43})/.exec(email.body)?.[1] ?? "";

    expect(await consumeOfficeLoginLink(ctx(B), token)).toEqual({ status: "rejected" });
    const login = await consumeOfficeLoginLink(ctx(A), token);
    expect(login).toMatchObject({ status: "ok", officeUserId: A.officeUserId });
    expect(await consumeOfficeLoginLink(ctx(A), token)).toEqual({ status: "rejected" });
    if (login.status !== "ok") return;

    expect((await currentOfficeUser(ctx(A), login.token))?.officeUser).toMatchObject({
      id: A.officeUserId,
      role: "admin",
    });
    expect(await currentOfficeUser(ctx(B), login.token)).toBeNull();

    const events = await eventsFor(su, A.firmId, since);
    expect(events.map((e) => [e.action, e.data.kind])).toEqual([
      ["auth.link_requested", "office"],
      ["auth.link_sent", undefined],
      ["auth.login", "office"],
      ["auth.link_rejected", "office"],
    ]);
    expect(events[1]?.data).toMatchObject({ purpose: "office_login", channel: "email" });
    expect(events[2]).toMatchObject({ actor_type: "office", actor_id: A.officeUserId });
    expect(JSON.stringify(events)).not.toContain(address);
  });

  it("an unknown or disabled address gets the same answer and a job, but no email", async () => {
    const T = await createTenant(su);
    const disabled = await addOfficeUser(T, "resourcer");
    await su.query("update office_users set status = 'disabled' where id = $1", [disabled]);
    const known = await requestOfficeLoginLink(ctx(T), await officeEmail(T));
    for (const address of ["nobody@example.com", await officeEmail(T, disabled)]) {
      expect(await requestOfficeLoginLink(ctx(T), address)).toEqual(known);
      const job = await latestLinkJob(su, T.firmId);
      expect(job?.data).toMatchObject({ subjectId: null });
    }
  });

  it("something that isn't an email address is refused with no job and no event", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    for (const junk of ["", "not-an-email", "a@b", "@example.com"]) {
      expect(await requestOfficeLoginLink(ctx(T), junk)).toEqual({ status: "invalid_email" });
    }
    expect(await latestLinkJob(su, T.firmId)).toBeUndefined();
    expect(await eventsFor(su, T.firmId, since)).toEqual([]);
  });

  it("3 links per address every 15 minutes", async () => {
    const T = await createTenant(su);
    const address = await officeEmail(T);
    for (let i = 0; i < 3; i++)
      expect((await requestOfficeLoginLink(ctx(T), address)).status).toBe("sent");
    expect(await requestOfficeLoginLink(ctx(T), address)).toMatchObject({ status: "rate_limited" });
  });

  it("10 links per address a day (audit L49)", async () => {
    const T = await createTenant(su);
    const address = await officeEmail(T);
    const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    for (let i = 0; i < 10; i++) {
      // Three to a 15-minute window, so only the daily cap can stop them.
      const when = later(Math.floor(i / 3) * 15);
      expect((await requestOfficeLoginLink(ctx(T, when), address)).status).toBe("sent");
    }
    expect(await requestOfficeLoginLink(ctx(T, later(60)), address)).toMatchObject({
      status: "rate_limited",
    });
    expect(await requestOfficeLoginLink(ctx(T, later(24 * 60)), address)).toMatchObject({
      status: "sent",
    });
  });
});

describe("office rate limits", () => {
  it("10 requests per IP across addresses; the 11th is refused", async () => {
    const T = await createTenant(su);
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      expect(
        (
          await requestOfficeLoginLink(
            { firm: { id: T.firmId }, clientIp: ip, clock: at(NOW) },
            `p${i}@example.com`,
          )
        ).status,
      ).toBe("sent");
    }
    expect(
      await requestOfficeLoginLink(
        { firm: { id: T.firmId }, clientIp: ip, clock: at(NOW) },
        "p99@example.com",
      ),
    ).toMatchObject({ status: "rate_limited" });
  });

  it("requests refused by the IP limit don't count against the address they name", async () => {
    const T = await createTenant(su);
    const admin = await officeEmail(T);
    const attacker = { firm: { id: T.firmId }, clientIp: freshIp(), clock: at(NOW) };
    for (let i = 0; i < 10; i++) await requestOfficeLoginLink(attacker, "junk");
    for (let i = 0; i < 3; i++) {
      expect(await requestOfficeLoginLink(attacker, admin)).toMatchObject({
        status: "rate_limited",
      });
    }
    // The admin, from their own connection, still gets a link.
    expect(await requestOfficeLoginLink(ctx(T), admin)).toEqual({ status: "sent" });
  });

  it("known and unknown addresses reach the limit identically", async () => {
    const T = await createTenant(su);
    const known = await officeEmail(T);
    for (let i = 0; i < 4; i++) {
      expect(await requestOfficeLoginLink(ctx(T), known)).toEqual(
        await requestOfficeLoginLink(ctx(T), "nobody@example.com"),
      );
    }
  });

  it("stores only HMACs of the address and IP", async () => {
    const T = await createTenant(su);
    const address = await officeEmail(T);
    await requestOfficeLoginLink(
      { firm: { id: T.firmId }, clientIp: "203.0.113.88", clock: at(NOW) },
      address,
    );
    const { rows } = await su.query<{ bucket: string }>(
      "select bucket from auth_throttle where firm_id = $1 and bucket like 'office:%'",
      [T.firmId],
    );
    expect(rows.map((r) => r.bucket.replace(/:[A-Za-z0-9_-]{32}$/, "")).sort()).toEqual([
      "office:email",
      "office:email_day",
      "office:ip",
    ]);
    for (const r of rows) {
      expect(r.bucket).not.toContain(address);
      expect(r.bucket).not.toContain("203.0.113.88");
    }
  });
});

describe("workers and office users are kept apart", () => {
  it("an office link can't log anyone in as a worker, and a worker link can't open the office", async () => {
    const T = await createTenant(su);
    const office = await officeLinkFor(T);
    expect(await consumeWorkerLoginLink(ctx(T), office.token)).toEqual({ status: "rejected" });
    expect((await consumeOfficeLoginLink(ctx(T), office.token)).status).toBe("ok");

    const { transport, sent } = captureTransport();
    await sendPortalLink(
      {
        firmId: T.firmId,
        idempotencyKey: randomUUID(),
        purpose: "worker_login",
        subjectId: T.workerId,
      },
      withFirm,
      { transport, clock: at(NOW), baseDomain: "localhost:3000" },
    );
    const workerToken = /\/l#([A-Za-z0-9_-]{43})/.exec(sent[0]?.body ?? "")?.[1] ?? "";
    expect(await consumeOfficeLoginLink(ctx(T), workerToken)).toEqual({ status: "rejected" });
  });

  it("a worker's session token is never an office session, and the reverse", async () => {
    const T = await createTenant(su);
    const now = NOW;
    const workerSession = await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "worker", subjectId: T.workerId, now }),
    );
    const officeSession = await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "office", subjectId: T.officeUserId, now }),
    );
    expect(await currentOfficeUser(ctx(T), workerSession.token)).toBeNull();
    expect(await currentWorker(ctx(T), officeSession.token)).toBeNull();
  });

  it("a disabled office user is out at their next request, and logout ends a session", async () => {
    const T = await createTenant(su);
    const one = await officeLinkFor(T);
    const login = await consumeOfficeLoginLink(ctx(T), one.token);
    if (login.status !== "ok") throw new Error("login failed");
    const two = await officeLinkFor(T);
    const second = await consumeOfficeLoginLink(ctx(T), two.token);
    if (second.status !== "ok") throw new Error("login failed");

    expect(await logoutOffice(ctx(T), second.token)).toBe(true);
    expect(await currentOfficeUser(ctx(T), second.token)).toBeNull();

    expect(await currentOfficeUser(ctx(T), login.token)).not.toBeNull();
    await su.query("update office_users set status = 'disabled' where id = $1", [T.officeUserId]);
    expect(await currentOfficeUser(ctx(T), login.token)).toBeNull();
  });
});

describe("roles", () => {
  it.each([
    ["admin", true],
    ["resourcer", false],
    ["payroll", false],
  ] as const)("the office team list is for admins only: %s -> %s", async (role, allowed) => {
    const T = await createTenant(su);
    const id = await addOfficeUser(T, role);
    const session = await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "office", subjectId: id, now: NOW }),
    );
    const team = await officeTeam(ctx(T), session.token);
    if (allowed) {
      expect(team?.map((m) => m.role).sort()).toEqual(["admin", "admin"]);
    } else {
      expect(team).toBeNull();
    }
  });

  it("an admin session from one firm sees nothing on another firm's portal", async () => {
    const A = await createTenant(su);
    const B = await createTenant(su);
    const session = await withFirm(A.firmId, (tx) =>
      createSession(tx, { kind: "office", subjectId: A.officeUserId, now: NOW }),
    );
    expect(await officeTeam(ctx(A), session.token)).not.toBeNull();
    expect(await officeTeam(ctx(B), session.token)).toBeNull();
  });

  it("each role is what the session reports", async () => {
    const T = await createTenant(su);
    for (const role of ["admin", "resourcer", "payroll"] as const) {
      const id = await addOfficeUser(T, role);
      const session = await withFirm(T.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: id, now: NOW }),
      );
      expect((await currentOfficeUser(ctx(T), session.token))?.officeUser.role).toBe(role);
    }
  });
});

async function linkIdOf(token: string): Promise<string | undefined> {
  const { rows } = await su.query<{ id: string }>(
    "select id::text from magic_links where token_hash = $1",
    [hashToken(token)],
  );
  return rows[0]?.id;
}

const rejected = (id: string | undefined, reason: string) => ({
  action: "auth.link_rejected",
  actor_type: "system",
  actor_id: null,
  entity_type: "magic_link",
  entity_id: id ?? null,
  data: { kind: "office", reason },
});

describe("office links: 15 minutes, used once, only for an active user", () => {
  it("works 1 ms before it expires", async () => {
    const T = await createTenant(su);
    const t0 = new Date("2026-10-01T09:00:00.000Z");
    const { token } = await officeLinkFor(T, T.officeUserId, t0);
    const login = await consumeOfficeLoginLink(
      ctx(T, new Date(t0.getTime() + 15 * MINUTE - 1)),
      token,
    );
    expect(login).toMatchObject({ status: "ok", officeUserId: T.officeUserId });
  });

  it("is refused from the moment it expires, and the log says why", async () => {
    const T = await createTenant(su);
    const t0 = new Date("2026-10-01T09:00:00.000Z");
    const { token } = await officeLinkFor(T, T.officeUserId, t0);
    const since = await eventMark(su);
    expect(
      await consumeOfficeLoginLink(ctx(T, new Date(t0.getTime() + 15 * MINUTE)), token),
    ).toEqual({ status: "rejected" });
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      rejected(await linkIdOf(token), "expired"),
    ]);
  });

  it("a second use is refused, and the log says it was used", async () => {
    const T = await createTenant(su);
    const { token } = await officeLinkFor(T);
    expect((await consumeOfficeLoginLink(ctx(T), token)).status).toBe("ok");
    const since = await eventMark(su);
    expect(await consumeOfficeLoginLink(ctx(T), token)).toEqual({ status: "rejected" });
    expect(await eventsFor(su, T.firmId, since)).toEqual([rejected(await linkIdOf(token), "used")]);
  });

  it("a user disabled after the link was sent can't use it", async () => {
    const T = await createTenant(su);
    const { token } = await officeLinkFor(T);
    await su.query("update office_users set status = 'disabled' where id = $1", [T.officeUserId]);
    const since = await eventMark(su);
    expect(await consumeOfficeLoginLink(ctx(T), token)).toEqual({ status: "rejected" });
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      rejected(await linkIdOf(token), "inactive"),
    ]);
  });

  it("10 taps at the same moment: exactly one logs in (control: a read-then-write version lets several in)", async () => {
    const T = await createTenant(su);

    // Canary: check-then-update on an office link lets more than one through.
    const naive = await officeLinkFor(T);
    const naiveResults = await race(10, T.firmId, async (tx) => {
      const [link] = await tx
        .select({ id: magicLinks.id })
        .from(magicLinks)
        .where(and(eq(magicLinks.tokenHash, hashToken(naive.token)), isNull(magicLinks.usedAt)));
      if (!link) return null;
      await tx.update(magicLinks).set({ usedAt: NOW }).where(eq(magicLinks.id, link.id));
      return link.id;
    });
    expect(fulfilled(naiveResults).filter(Boolean).length).toBeGreaterThan(1);

    // The real thing, through the same function the /office/l page calls.
    const { token } = await officeLinkFor(T);
    const since = await eventMark(su);
    const results = await race(10, T.firmId, (tx) =>
      consumeOfficeLoginLink({ ...ctx(T), run: (_firmId, fn) => fn(tx) }, token),
    );
    const outcomes = fulfilled(results);
    expect(outcomes).toHaveLength(10);
    expect(outcomes.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(9);

    const events = await eventsFor(su, T.firmId, since);
    const id = await linkIdOf(token);
    expect(events.filter((e) => e.action === "auth.login")).toHaveLength(1);
    expect(events.filter((e) => e.action === "auth.link_rejected")).toEqual(
      Array.from({ length: 9 }, () => rejected(id, "used")),
    );
    expect(events).toHaveLength(10);
  });
});
