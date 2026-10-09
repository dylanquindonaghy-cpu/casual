import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR, MINUTE } from "@/lib/auth/clock";
import {
  consumeOfficeLoginLink,
  logoutOffice,
  refreshOfficeSession,
  requestOfficeLoginLink,
} from "@/lib/auth/office-login";
import { sendLoginCode } from "@/lib/auth/send-login-code";
import { createSession } from "@/lib/auth/sessions";
import { requestStepUpCode, verifyStepUpCode } from "@/lib/auth/step-up";
import { hashToken } from "@/lib/auth/tokens";
import {
  consumeWorkerLoginLink,
  logoutWorker,
  refreshWorkerSession,
  requestWorkerLoginLink,
} from "@/lib/auth/worker-login";
import { withFirm } from "@/lib/db/scoped";
import { appEnv } from "@/lib/env";
import {
  captureTransport,
  eventMark,
  eventsFor,
  latestLinkJob,
  mobileOf,
  runLinkJob,
} from "../helpers/auth";
import { superuserPool } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// The action log's auth rows are a product feature (golden rule 5), so their exact shape is
// pinned here: every auth.* action, for workers and office users, row for row. No test below
// uses toMatchObject on an event: an extra field or a changed id fails.

const NOW = new Date("2026-10-01T00:00:00.000Z"); // the start of a day, for the daily code limit
const at = (ms = 0) => ({ now: () => new Date(NOW.getTime() + ms) });

let su: Pool;
beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

let ipCounter = 0;
const freshIp = () => `10.7.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const ctx = (T: Tenant, ms = 0, clientIp = freshIp()) => ({
  firm: { id: T.firmId },
  clientIp,
  clock: at(ms),
});

async function idOf(table: "magic_links" | "sessions", token: string) {
  const { rows } = await su.query<{ id: string }>(
    `select id::text from ${table} where token_hash = $1`,
    [hashToken(token)],
  );
  return rows[0]?.id ?? null;
}

async function officeEmail(T: Tenant) {
  const { rows } = await su.query<{ email: string }>(
    "select email from office_users where id = $1",
    [T.officeUserId],
  );
  return rows[0]?.email ?? "";
}

const system = (action: string, entityType: string, entityId: string | null, data: object) => ({
  action,
  actor_type: "system",
  actor_id: null,
  entity_type: entityType,
  entity_id: entityId,
  data,
});

const rateLimited = (limit: string, entityType: string) =>
  system("auth.rate_limited", entityType, null, { limit });

describe("worker login events", () => {
  it("request, send, login, reuse, rotation and logout: every row in full", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    const { transport, sent } = captureTransport();

    await requestWorkerLoginLink(ctx(T), await mobileOf(su, T.workerId));
    const job = await latestLinkJob(su, T.firmId);
    await runLinkJob(job ?? { id: "", data: {} }, { transport, clock: at() });
    const token = /\/l#([A-Za-z0-9_-]{43})/.exec(sent[0]?.body ?? "")?.[1] ?? "";
    const login = await consumeWorkerLoginLink(ctx(T), token);
    if (login.status !== "ok") throw new Error("login failed");
    await consumeWorkerLoginLink(ctx(T), token);
    const rotated = await refreshWorkerSession(ctx(T, 25 * HOUR), login.token);
    expect(rotated).not.toBeNull();
    expect(await logoutWorker(ctx(T, 25 * HOUR), rotated?.token ?? "")).toBe(true);

    const linkId = await idOf("magic_links", token);
    const sessionId = await idOf("sessions", rotated?.token ?? "");
    const worker = { actor_type: "worker", actor_id: T.workerId };
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      system("auth.link_requested", "login_request", String(job?.data.idempotencyKey), {
        kind: "worker",
        matched: true,
      }),
      system("auth.link_sent", "magic_link", linkId, {
        purpose: "worker_login",
        channel: "whatsapp",
        providerMessageId: "capture-1",
      }),
      {
        action: "auth.login",
        ...worker,
        entity_type: "session",
        entity_id: sessionId,
        data: { kind: "worker", magicLinkId: linkId },
      },
      system("auth.link_rejected", "magic_link", linkId, { kind: "worker", reason: "used" }),
      {
        action: "auth.session_rotated",
        ...worker,
        entity_type: "session",
        entity_id: sessionId,
        data: {},
      },
      { action: "auth.logout", ...worker, entity_type: "session", entity_id: sessionId, data: {} },
    ]);
  });

  it("an unknown number is logged as not matched, and nothing is sent", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    await requestWorkerLoginLink(ctx(T), "07700 900999");
    const job = await latestLinkJob(su, T.firmId);
    const { transport } = captureTransport();
    await runLinkJob(job ?? { id: "", data: {} }, { transport, clock: at() });
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      system("auth.link_requested", "login_request", String(job?.data.idempotencyKey), {
        kind: "worker",
        matched: false,
      }),
    ]);
  });

  it("a token that matches no link is logged with no link id", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    await consumeWorkerLoginLink(ctx(T), "A".repeat(43));
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      system("auth.link_rejected", "magic_link", null, { kind: "worker", reason: "unknown" }),
    ]);
  });
});

describe("office login events", () => {
  it("request, send, login, reuse, rotation and logout: every row in full", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    const { transport, sent } = captureTransport();

    await requestOfficeLoginLink(ctx(T), await officeEmail(T));
    const job = await latestLinkJob(su, T.firmId);
    await runLinkJob(job ?? { id: "", data: {} }, { transport, clock: at() });
    const token = /\/office\/l#([A-Za-z0-9_-]{43})/.exec(sent[0]?.body ?? "")?.[1] ?? "";
    const login = await consumeOfficeLoginLink(ctx(T), token);
    if (login.status !== "ok") throw new Error("login failed");
    await consumeOfficeLoginLink(ctx(T), token);
    const rotated = await refreshOfficeSession(ctx(T, 25 * HOUR), login.token);
    expect(rotated).not.toBeNull();
    expect(await logoutOffice(ctx(T, 25 * HOUR), rotated?.token ?? "")).toBe(true);

    const linkId = await idOf("magic_links", token);
    const sessionId = await idOf("sessions", rotated?.token ?? "");
    const office = { actor_type: "office", actor_id: T.officeUserId };
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      system("auth.link_requested", "login_request", String(job?.data.idempotencyKey), {
        kind: "office",
        matched: true,
      }),
      system("auth.link_sent", "magic_link", linkId, {
        purpose: "office_login",
        channel: "email",
        providerMessageId: "capture-1",
      }),
      {
        action: "auth.login",
        ...office,
        entity_type: "session",
        entity_id: sessionId,
        data: { kind: "office", magicLinkId: linkId },
      },
      system("auth.link_rejected", "magic_link", linkId, { kind: "office", reason: "used" }),
      {
        action: "auth.session_rotated",
        ...office,
        entity_type: "session",
        entity_id: sessionId,
        data: {},
      },
      { action: "auth.logout", ...office, entity_type: "session", entity_id: sessionId, data: {} },
    ]);
  });

  it("an unknown address is logged as not matched", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    await requestOfficeLoginLink(ctx(T), "nobody@example.com");
    const job = await latestLinkJob(su, T.firmId);
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      system("auth.link_requested", "login_request", String(job?.data.idempotencyKey), {
        kind: "office",
        matched: false,
      }),
    ]);
  });
});

describe("pay-page code events", () => {
  async function loggedIn(T: Tenant) {
    return withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "worker", subjectId: T.workerId, now: NOW }),
    );
  }

  async function sendCode(T: Tenant, sessionId: string, code: string) {
    const { transport } = captureTransport();
    const result = await sendLoginCode(
      { firmId: T.firmId, idempotencyKey: randomUUID(), sessionId },
      withFirm,
      {
        transport,
        clock: at(),
        secret: appEnv().SESSION_SECRET, // what verifyStepUpCode checks against by default
        newCode: () => code,
      },
    );
    return result.sent ? result.otpCodeId : null;
  }

  it("request, send, a wrong try and the right one: every row in full", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    const since = await eventMark(su);
    expect(await requestStepUpCode({ firm: { id: T.firmId }, clock: at() }, s.token)).toEqual({
      status: "sent",
    });
    const codeId = await sendCode(T, s.id, "123456");
    await verifyStepUpCode({ firm: { id: T.firmId }, clock: at() }, s.token, "000000");
    await verifyStepUpCode({ firm: { id: T.firmId }, clock: at() }, s.token, "123456");

    const worker = { actor_type: "worker", actor_id: T.workerId };
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      {
        action: "auth.otp_requested",
        ...worker,
        entity_type: "session",
        entity_id: s.id,
        data: {},
      },
      system("auth.otp_sent", "otp_code", codeId, {
        channel: "whatsapp",
        providerMessageId: "capture-1",
      }),
      {
        action: "auth.otp_failed",
        ...worker,
        entity_type: "otp_code",
        entity_id: codeId,
        data: { attemptsLeft: 4 },
      },
      {
        action: "auth.otp_verified",
        ...worker,
        entity_type: "otp_code",
        entity_id: codeId,
        data: {},
      },
    ]);
  });

  it("five wrong tries: four failures, then locked", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    const codeId = await sendCode(T, s.id, "123456");
    const since = await eventMark(su);
    for (let i = 0; i < 5; i++) {
      await verifyStepUpCode({ firm: { id: T.firmId }, clock: at() }, s.token, "000000");
    }
    const row = (action: string, attemptsLeft: number) => ({
      action,
      actor_type: "worker",
      actor_id: T.workerId,
      entity_type: "otp_code",
      entity_id: codeId,
      data: { attemptsLeft },
    });
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      row("auth.otp_failed", 4),
      row("auth.otp_failed", 3),
      row("auth.otp_failed", 2),
      row("auth.otp_failed", 1),
      row("auth.otp_locked", 0),
    ]);
  });
});

// Each limit is logged once, when it is first reached, with its name and no personal data.
describe("rate-limit events, all seven limits", () => {
  const onlyLimits = async (firmId: string, since: number) =>
    (await eventsFor(su, firmId, since)).filter((e) => e.action === "auth.rate_limited");

  it("login:ip", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    for (let i = 0; i < 12; i++) {
      await requestWorkerLoginLink(ctx(T, 0, "203.0.113.10"), `07700 9001${10 + i}`);
    }
    expect(await onlyLimits(T.firmId, since)).toEqual([rateLimited("login:ip", "login_request")]);
  });

  it("login:mobile", async () => {
    const T = await createTenant(su);
    const mobile = await mobileOf(su, T.workerId);
    const since = await eventMark(su);
    for (let i = 0; i < 5; i++) await requestWorkerLoginLink(ctx(T), mobile);
    expect(await onlyLimits(T.firmId, since)).toEqual([
      rateLimited("login:mobile", "login_request"),
    ]);
  });

  it("office:ip", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    for (let i = 0; i < 12; i++) {
      await requestOfficeLoginLink(ctx(T, 0, "203.0.113.11"), `p${i}@example.com`);
    }
    expect(await onlyLimits(T.firmId, since)).toEqual([rateLimited("office:ip", "login_request")]);
  });

  it("office:email", async () => {
    const T = await createTenant(su);
    const address = await officeEmail(T);
    const since = await eventMark(su);
    for (let i = 0; i < 5; i++) await requestOfficeLoginLink(ctx(T), address);
    expect(await onlyLimits(T.firmId, since)).toEqual([
      rateLimited("office:email", "login_request"),
    ]);
  });

  it("link_fail:ip (logged at the 20th failure; the 21st attempt is refused)", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    for (let i = 0; i < 20; i++) {
      expect(await consumeWorkerLoginLink(ctx(T, 0, "203.0.113.12"), "x")).toEqual({
        status: "rejected",
      });
    }
    expect(await consumeWorkerLoginLink(ctx(T, 0, "203.0.113.12"), "x")).toMatchObject({
      status: "rate_limited",
    });
    const events = await eventsFor(su, T.firmId, since);
    expect(events).toHaveLength(21);
    expect(events.at(-1)).toEqual(rateLimited("link_fail:ip", "magic_link"));
    expect(events.slice(0, 20)).toEqual(
      Array.from({ length: 20 }, () =>
        system("auth.link_rejected", "magic_link", null, { kind: "worker", reason: "unknown" }),
      ),
    );
  });

  it("otp:worker", async () => {
    const T = await createTenant(su);
    const s = await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "worker", subjectId: T.workerId, now: NOW }),
    );
    const since = await eventMark(su);
    for (let i = 0; i < 5; i++)
      await requestStepUpCode({ firm: { id: T.firmId }, clock: at() }, s.token);
    expect(await onlyLimits(T.firmId, since)).toEqual([rateLimited("otp:worker", "session")]);
  });

  it("otp:worker_day (10 a day, even spread across 15-minute windows)", async () => {
    const T = await createTenant(su);
    const s = await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "worker", subjectId: T.workerId, now: NOW }),
    );
    const since = await eventMark(su);
    const results = [];
    for (let i = 0; i < 12; i++) {
      // Two a window: the 15-minute limit (3) is never reached.
      const when = at(Math.floor(i / 2) * 15 * MINUTE);
      results.push(
        (await requestStepUpCode({ firm: { id: T.firmId }, clock: when }, s.token)).status,
      );
    }
    expect(results).toEqual([...Array(10).fill("sent"), "rate_limited", "rate_limited"]);
    expect(await onlyLimits(T.firmId, since)).toEqual([rateLimited("otp:worker_day", "session")]);
  });
});
