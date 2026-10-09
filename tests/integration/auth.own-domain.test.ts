import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consumeOfficeLoginLink, requestOfficeLoginLink } from "@/lib/auth/office-login";
import { sendPortalLink, sendPortalLinkPayload } from "@/lib/auth/send-portal-link";
import { consumeWorkerLoginLink, requestWorkerLoginLink } from "@/lib/auth/worker-login";
import { withFirm } from "@/lib/db/scoped";
import type { FirmAddress } from "@/lib/tenancy/portal-url";
import { captureTransport, latestLinkJob, mobileOf, runLinkJob, tokenFrom } from "../helpers/auth";
import { superuserPool } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// A firm's own domain holds a login (audit M7): a login link goes back to the address the request
// came in on, the firm's own verified domain or its portal, so the session (a host-only cookie) is
// on the address the person uses. The domain comes from the firm's own record, never the request;
// a domain no longer verified gets the portal. The browser test logs in on one:
// tests/e2e/custom-domain.spec.ts.

let su: Pool;
beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

const NOW = new Date("2026-10-01T09:00:00.000Z");
const clock = { now: () => NOW };
let ip = 0;
const ctx = (T: Tenant, address?: FirmAddress) => ({
  firm: { id: T.firmId },
  clientIp: `10.9.${Math.floor(++ip / 250)}.${ip % 250}`,
  clock,
  ...(address ? { address } : {}),
});

const domainOf = (T: Tenant) => `shifts.${T.slug}.example`;
async function setDomain(T: Tenant, domain: string | null, verified: boolean) {
  await su.query("update firms set custom_domain = $1, domain_verified = $2 where id = $3", [
    domain,
    verified,
    T.firmId,
  ]);
}

async function officeEmail(T: Tenant) {
  const { rows } = await su.query<{ email: string }>(
    "select email from office_users where id = $1",
    [T.officeUserId],
  );
  return rows[0]?.email ?? "";
}

// The newest auth.link_sent entry's data, for the firm.
async function sentLog(T: Tenant) {
  const { rows } = await su.query<{ data: Record<string, unknown> }>(
    `select data from events where firm_id = $1 and action = 'auth.link_sent'
      order by created_at desc, id desc limit 1`,
    [T.firmId],
  );
  return rows[0]?.data;
}

// Requests a worker's link as the login page does, then sends it as the worker would.
async function workerLink(T: Tenant, address: FirmAddress | undefined, baseDomain: string) {
  await requestWorkerLoginLink(ctx(T, address), await mobileOf(su, T.workerId));
  const job = await latestLinkJob(su, T.firmId);
  const { transport, sent } = captureTransport();
  await runLinkJob(job ?? { id: "", data: {} }, { transport, clock, baseDomain });
  return { job, message: sent[0] };
}

describe("a worker's login link", () => {
  it("asked for on the firm's own domain: the link is on that domain, and logs them in", async () => {
    const T = await createTenant(su);
    await setDomain(T, domainOf(T), true);
    const { job, message } = await workerLink(T, "own_domain", "shiftdesk.example");
    expect(job?.data.address).toBe("own_domain");
    expect(message?.body).toContain(`https://${domainOf(T)}/l#`);
    expect(message?.body).not.toContain("shiftdesk.example");
    // The log says the link went to the firm's own domain.
    expect(await sentLog(T)).toEqual({
      purpose: "worker_login",
      channel: "whatsapp",
      ownDomain: true,
      providerMessageId: "capture-1",
    });
    const login = await consumeWorkerLoginLink(ctx(T), tokenFrom(message));
    expect(login.status).toBe("ok");
  });

  it("on any base domain, the own domain is https (a browser keeps no session over http there)", async () => {
    const T = await createTenant(su);
    await setDomain(T, domainOf(T), true);
    const { message } = await workerLink(T, "own_domain", "localhost:3100");
    expect(message?.body).toContain(`https://${domainOf(T)}/l#`);
  });

  it("asked for on the portal: the portal, even when the firm has its own domain", async () => {
    const T = await createTenant(su);
    await setDomain(T, domainOf(T), true);
    const { job, message } = await workerLink(T, "portal", "shiftdesk.example");
    expect(job?.data.address).toBe("portal");
    expect(message?.body).toContain(`https://${T.slug}.shiftdesk.example/l#`);
    expect(message?.body).not.toContain(domainOf(T));
    expect(await sentLog(T)).not.toHaveProperty("ownDomain");
  });

  it("with no address said (as before this change): the portal", async () => {
    const T = await createTenant(su);
    await setDomain(T, domainOf(T), true);
    const { job, message } = await workerLink(T, undefined, "shiftdesk.example");
    expect(job?.data.address).toBe("portal");
    expect(message?.body).toContain(`https://${T.slug}.shiftdesk.example/l#`);
  });

  it.each([
    ["no longer verified", true, false],
    ["taken off the firm", false, true],
  ])("the own domain %s by the time it's sent: the portal", async (_name, keepDomain, verified) => {
    const T = await createTenant(su);
    await setDomain(T, domainOf(T), true);
    await requestWorkerLoginLink(ctx(T, "own_domain"), await mobileOf(su, T.workerId));
    await setDomain(T, keepDomain ? domainOf(T) : null, verified);
    const job = await latestLinkJob(su, T.firmId);
    const { transport, sent } = captureTransport();
    await runLinkJob(job ?? { id: "", data: {} }, {
      transport,
      clock,
      baseDomain: "shiftdesk.example",
    });
    expect(sent[0]?.body).toContain(`https://${T.slug}.shiftdesk.example/l#`);
    expect(sent[0]?.body).not.toContain(domainOf(T));
    expect(await sentLog(T)).not.toHaveProperty("ownDomain");
  });

  it("a job queued before this change (no address in it) gets the portal", async () => {
    const T = await createTenant(su);
    await setDomain(T, domainOf(T), true);
    const { transport, sent } = captureTransport();
    const result = await sendPortalLink(
      {
        firmId: T.firmId,
        idempotencyKey: randomUUID(),
        purpose: "worker_login",
        subjectId: T.workerId,
      },
      withFirm,
      { transport, clock, baseDomain: "shiftdesk.example" },
    );
    expect(result.sent).toBe(true);
    expect(sent[0]?.body).toContain(`https://${T.slug}.shiftdesk.example/l#`);
  });

  it("the job takes only the two words, never an address", () => {
    const base = {
      firmId: randomUUID(),
      idempotencyKey: randomUUID(),
      purpose: "worker_login",
      subjectId: randomUUID(),
    };
    for (const address of ["https://evil.example", "evil.example", ""]) {
      expect(sendPortalLinkPayload.safeParse({ ...base, address }).success, address).toBe(false);
    }
    expect(sendPortalLinkPayload.parse(base).address).toBe("portal");
  });
});

describe("an office user's login link", () => {
  it("asked for on the firm's own domain: the office link is on that domain, and logs them in", async () => {
    const T = await createTenant(su);
    await setDomain(T, domainOf(T), true);
    await requestOfficeLoginLink(ctx(T, "own_domain"), await officeEmail(T));
    const job = await latestLinkJob(su, T.firmId);
    const { transport, sent } = captureTransport();
    await runLinkJob(job ?? { id: "", data: {} }, {
      transport,
      clock,
      baseDomain: "shiftdesk.example",
    });
    expect(job?.data).toMatchObject({ purpose: "office_login", address: "own_domain" });
    expect(sent[0]?.body).toContain(`https://${domainOf(T)}/office/l#`);
    const login = await consumeOfficeLoginLink(ctx(T), tokenFrom(sent[0]));
    expect(login.status).toBe("ok");
  });

  it("asked for on the portal: the portal", async () => {
    const T = await createTenant(su);
    await setDomain(T, domainOf(T), true);
    await requestOfficeLoginLink(ctx(T, "portal"), await officeEmail(T));
    const job = await latestLinkJob(su, T.firmId);
    const { transport, sent } = captureTransport();
    await runLinkJob(job ?? { id: "", data: {} }, {
      transport,
      clock,
      baseDomain: "shiftdesk.example",
    });
    expect(sent[0]?.body).toContain(`https://${T.slug}.shiftdesk.example/office/l#`);
  });
});
