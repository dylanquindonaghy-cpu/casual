import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consumeOfficeLoginLink, currentOfficeUser } from "@/lib/auth/office-login";
import { createSendPortalLinkTask, sendPortalLink } from "@/lib/auth/send-portal-link";
import { createSession } from "@/lib/auth/sessions";
import { consumeWorkerLoginLink } from "@/lib/auth/worker-login";
import {
  addClientContact,
  listClientContacts,
  sendClientLoginLink,
  setClientContactOn,
} from "@/lib/client/contacts";
import {
  consumeClientLoginLink,
  currentClient,
  logoutClient,
  refreshClientSession,
  requestClientLoginLink,
} from "@/lib/client/login";
import { withFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import type { OutboundMessage } from "@/lib/messaging";
import { removeContract } from "@/lib/office/contracts";
import {
  captureTransport,
  eventMark,
  eventsFor,
  latestLinkJob,
  quietLogger,
} from "../helpers/auth";
import { superuserPool } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Client logins (Phase 36.3) on the real database: an admin adds a client contact to a contract;
// the contact logs in with a one-time emailed link (the office login's rules: the same answer for
// any address, used once, 15 minutes, hashed, rate-limited per address and IP, used by a POST) into
// a session of its own kind; switching them off ends every session and unused link at once. Only
// admins manage client logins, checked inside each transaction.

let su: Pool;
beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

const NOW = new Date("2026-11-11T12:00:00.000Z");
const at = (when: Date) => ({ now: () => when });
let ipCounter = 0;
const freshIp = () => `10.36.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const ctx = (T: Tenant, when = NOW) => ({
  firm: { id: T.firmId },
  clientIp: freshIp(),
  clock: at(when),
});
const office = (T: Tenant, officeUserId = T.officeUserId) => ({
  firm: { id: T.firmId },
  officeUserId,
  clock: at(NOW),
  secret: "test-secret-for-client-links-0123456789",
});

async function officeUser(T: Tenant, role: "admin" | "resourcer" | "payroll") {
  const { rows } = await su.query<{ id: string }>(
    `insert into office_users (firm_id, email, name, role) values ($1, $2, $3, $4)
     returning id::text as id`,
    [T.firmId, `${role}${randomUUID().slice(0, 8)}@example.com`, `Test ${role}`, role],
  );
  return rows[0]?.id ?? "";
}

// A client contact on the tenant's contract, added by its admin through the library.
async function contact(T: Tenant, email = `priya.${randomUUID().slice(0, 8)}@example.com`) {
  const added = await addClientContact(office(T), {
    contractId: T.rows.clients,
    name: "Priya Shah",
    email,
  });
  if (added.status !== "added") throw new Error(`not added: ${added.status}`);
  return { id: added.clientContactId, email };
}

// Sends a client link and returns the email and its token.
async function clientLinkFor(T: Tenant, clientContactId: string, when = NOW) {
  const { transport, sent } = captureTransport();
  await sendPortalLink(
    {
      firmId: T.firmId,
      idempotencyKey: randomUUID(),
      purpose: "client_login",
      subjectId: clientContactId,
    },
    withFirm,
    { transport, clock: at(when), baseDomain: "localhost:3000" },
  );
  const email = sent[0] as Extract<OutboundMessage, { channel: "email" }> | undefined;
  const token = /\/client\/l#([A-Za-z0-9_-]{43})\b/.exec(email?.body ?? "")?.[1] ?? "";
  return { email, token };
}

describe("client login, start to finish", () => {
  it("emails a one-time link that logs the client in once, on their own firm, with their contract", async () => {
    const A = await createTenant(su);
    const B = await createTenant(su);
    const c = await contact(A);
    const since = await eventMark(su);

    expect(await requestClientLoginLink(ctx(A), `  ${c.email.toUpperCase()} `)).toEqual({
      status: "sent",
    });
    const job = await latestLinkJob(su, A.firmId);
    expect(job?.data).toMatchObject({ purpose: "client_login", subjectId: c.id });
    expect(JSON.stringify(job?.data)).not.toContain(c.email);

    const { transport, sent } = captureTransport();
    const def = createSendPortalLinkTask(() => ({
      transport,
      clock: at(NOW),
      baseDomain: "localhost:3000",
    }));
    const result = await runFirmTask(def, job ?? { id: "", data: {} }, undefined, quietLogger);
    expect(result.status).toBe("completed");
    const email = sent[0] as Extract<OutboundMessage, { channel: "email" }>;
    expect(email).toMatchObject({ channel: "email", to: c.email });
    expect(email.subject).toBe(`Your Test Firm ${A.slug} client login link`);
    expect(email.body).toContain(`http://${A.slug}.localhost:3000/client/l#`);
    expect(email.body.trim().endsWith(`— Test Firm ${A.slug} Shift Team`)).toBe(true);
    const token = /\/client\/l#([A-Za-z0-9_-]{43})/.exec(email.body)?.[1] ?? "";

    expect(await consumeClientLoginLink(ctx(B), token)).toEqual({ status: "rejected" });
    const login = await consumeClientLoginLink(ctx(A), token);
    expect(login).toMatchObject({ status: "ok", clientContactId: c.id });
    expect(await consumeClientLoginLink(ctx(A), token)).toEqual({ status: "rejected" });
    if (login.status !== "ok") return;

    expect(await currentClient(ctx(A), login.token)).toMatchObject({
      contact: { id: c.id, name: "Priya Shah", contractId: A.rows.clients },
    });
    expect(await currentClient(ctx(B), login.token)).toBeNull();
    const { rows: last } = await su.query<{ at: Date | null }>(
      "select last_login_at as at from client_contacts where id = $1",
      [c.id],
    );
    expect(last[0]?.at?.toISOString()).toBe(NOW.toISOString());

    const events = await eventsFor(su, A.firmId, since);
    expect(events.map((e) => [e.action, e.data.kind])).toEqual([
      ["auth.link_requested", "client"],
      ["auth.link_sent", undefined],
      ["auth.login", "client"],
      ["auth.link_rejected", "client"],
    ]);
    expect(events[1]?.data).toMatchObject({ purpose: "client_login", channel: "email" });
    expect(events[2]).toMatchObject({ actor_type: "client", actor_id: c.id });
    expect(JSON.stringify(events)).not.toContain(c.email);
  });

  it("a link works for 15 minutes", async () => {
    const T = await createTenant(su);
    const c = await contact(T);
    const { token } = await clientLinkFor(T, c.id);
    const late = new Date(NOW.getTime() + 15 * 60_000 + 1000);
    expect(await consumeClientLoginLink(ctx(T, late), token)).toEqual({ status: "rejected" });
  });

  it("an unknown or switched-off address gets the same answer and a job, but no email", async () => {
    const T = await createTenant(su);
    const on = await contact(T);
    const off = await contact(T);
    await setClientContactOn(office(T), { clientContactId: off.id, on: false });
    const known = await requestClientLoginLink(ctx(T), on.email);
    for (const address of ["nobody@example.com", off.email]) {
      expect(await requestClientLoginLink(ctx(T), address)).toEqual(known);
      const job = await latestLinkJob(su, T.firmId);
      expect(job?.data).toMatchObject({ purpose: "client_login", subjectId: null });
    }
    // A switched-off contact's job, if one were queued for them, sends nothing.
    const { transport, sent } = captureTransport();
    const r = await sendPortalLink(
      {
        firmId: T.firmId,
        idempotencyKey: randomUUID(),
        purpose: "client_login",
        subjectId: off.id,
      },
      withFirm,
      { transport, clock: at(NOW), baseDomain: "localhost:3000" },
    );
    expect(r).toEqual({ sent: false, reason: "inactive" });
    expect(sent).toEqual([]);
  });

  it("3 links per address every 15 minutes, 10 per IP; known and unknown alike", async () => {
    const T = await createTenant(su);
    const c = await contact(T);
    for (let i = 0; i < 3; i++)
      expect((await requestClientLoginLink(ctx(T), c.email)).status).toBe("sent");
    expect(await requestClientLoginLink(ctx(T), c.email)).toMatchObject({
      status: "rate_limited",
    });
    for (let i = 0; i < 3; i++) await requestClientLoginLink(ctx(T), "nobody@example.com");
    expect(await requestClientLoginLink(ctx(T), "nobody@example.com")).toMatchObject({
      status: "rate_limited",
    });
    const ip = { firm: { id: T.firmId }, clientIp: freshIp(), clock: at(NOW) };
    for (let i = 0; i < 10; i++)
      expect((await requestClientLoginLink(ip, `p${i}@example.com`)).status).toBe("sent");
    expect(await requestClientLoginLink(ip, "p99@example.com")).toMatchObject({
      status: "rate_limited",
    });
    // Counted apart from the office's, and as HMACs only.
    const { rows } = await su.query<{ bucket: string }>(
      "select bucket from auth_throttle where firm_id = $1 and bucket like 'login:client%'",
      [T.firmId],
    );
    expect(new Set(rows.map((r) => r.bucket.replace(/:[A-Za-z0-9_-]{32}$/, "")))).toEqual(
      new Set(["login:client_email", "login:client_email_day", "login:client_ip"]),
    );
    for (const r of rows) expect(r.bucket).not.toContain(c.email);
  });

  it("something that isn't an email address is refused with no job", async () => {
    const T = await createTenant(su);
    for (const junk of ["", "not-an-email", "a@b"]) {
      expect(await requestClientLoginLink(ctx(T), junk)).toEqual({ status: "invalid_email" });
    }
    expect(await latestLinkJob(su, T.firmId)).toBeUndefined();
  });
});

describe("clients, office users and workers are kept apart", () => {
  it("a client link opens neither the office nor the casual app, and theirs never open the client's", async () => {
    const T = await createTenant(su);
    const c = await contact(T);
    const client = await clientLinkFor(T, c.id);
    expect(await consumeOfficeLoginLink(ctx(T), client.token)).toEqual({ status: "rejected" });
    expect(await consumeWorkerLoginLink(ctx(T), client.token)).toEqual({ status: "rejected" });
    expect((await consumeClientLoginLink(ctx(T), client.token)).status).toBe("ok");

    const officeSession = await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "office", subjectId: T.officeUserId, now: NOW }),
    );
    const clientSession = await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "client", subjectId: c.id, now: NOW }),
    );
    expect(await currentClient(ctx(T), officeSession.token)).toBeNull();
    expect(await currentOfficeUser(ctx(T), clientSession.token)).toBeNull();
  });

  it("the session's token is renewed after 24 hours; logout ends it", async () => {
    const T = await createTenant(su);
    const c = await contact(T);
    const s = await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "client", subjectId: c.id, now: NOW }),
    );
    expect(await refreshClientSession(ctx(T), s.token)).toBeNull();
    const day = new Date(NOW.getTime() + 24 * 3_600_000);
    const fresh = await refreshClientSession(ctx(T, day), s.token);
    expect(fresh?.token).toBeDefined();
    expect(await logoutClient(ctx(T, day), fresh?.token ?? "")).toBe(true);
    expect(await currentClient(ctx(T, day), fresh?.token ?? "")).toBeNull();
  });
});

describe("an admin's client logins", () => {
  it("adds one (address lower case, once per firm), lists them, and logs ids only", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    const added = await addClientContact(office(T), {
      contractId: T.rows.clients,
      name: " Tom Reed ",
      email: "Tom.Reed@Example.COM",
    });
    expect(added.status).toBe("added");
    expect(
      await addClientContact(office(T), {
        contractId: T.rows.clients,
        name: "Tom again",
        email: "tom.reed@example.com",
      }),
    ).toEqual({ status: "email_taken" });
    expect(
      await addClientContact(office(T), { contractId: T.rows.clients, name: "", email: "x@y.z" }),
    ).toEqual({ status: "invalid", problem: "name" });
    expect(
      await addClientContact(office(T), {
        contractId: T.rows.clients,
        name: "X",
        email: "not an email",
      }),
    ).toEqual({ status: "invalid", problem: "email" });
    // Another firm's contract is no contract here.
    const other = await createTenant(su);
    expect(
      await addClientContact(office(T), {
        contractId: other.rows.clients,
        name: "X",
        email: "x@example.com",
      }),
    ).toEqual({ status: "not_found" });

    const list = await listClientContacts(office(T), T.rows.clients);
    expect(list.status === "ok" && list.contacts.map((c) => [c.name, c.email, c.isOn])).toEqual([
      ["Test Client", expect.stringMatching(/@example\.com$/), true],
      ["Tom Reed", "tom.reed@example.com", true],
    ]);
    const { rows: events } = await su.query<{ action: string; data: Record<string, unknown> }>(
      "select action, data from events where firm_id = $1 and id > $2 order by id",
      [T.firmId, since],
    );
    expect(events.map((e) => [e.action, e.data])).toEqual([
      ["client_contact.added", { contractId: T.rows.clients }],
    ]);
  });

  it("switching one off ends every session and every unused link at once; on again, they log in afresh", async () => {
    const T = await createTenant(su);
    const c = await contact(T);
    const one = await clientLinkFor(T, c.id);
    const login = await consumeClientLoginLink(ctx(T), one.token);
    if (login.status !== "ok") throw new Error("login failed");
    const unused = await clientLinkFor(T, c.id);

    const off = await setClientContactOn(office(T), { clientContactId: c.id, on: false });
    expect(off).toEqual({ status: "switched", on: false, sessions: 1, links: 1 });
    expect(await currentClient(ctx(T), login.token)).toBeNull();
    expect(await setClientContactOn(office(T), { clientContactId: c.id, on: false })).toEqual({
      status: "unchanged",
    });
    expect(await setClientContactOn(office(T), { clientContactId: c.id, on: true })).toMatchObject({
      status: "switched",
      on: true,
    });
    // The old session and the link from before stay dead.
    expect(await currentClient(ctx(T), login.token)).toBeNull();
    expect(await consumeClientLoginLink(ctx(T), unused.token)).toEqual({ status: "rejected" });
    const { rows } = await su.query<{ action: string; data: Record<string, unknown> }>(
      `select action, data from events where firm_id = $1 and entity_id = $2
         and action like 'client_contact.switched%' order by id`,
      [T.firmId, c.id],
    );
    expect(rows).toEqual([
      {
        action: "client_contact.switched_off",
        data: { contractId: T.rows.clients, sessions: 1, links: 1 },
      },
      {
        action: "client_contact.switched_on",
        data: { contractId: T.rows.clients, sessions: 0, links: 0 },
      },
    ]);
  });

  it("'Send link' queues the same job, at most 3 every 15 minutes; never to one switched off", async () => {
    const T = await createTenant(su);
    const c = await contact(T);
    for (let i = 0; i < 3; i++) {
      expect(await sendClientLoginLink(office(T), c.id)).toEqual({ status: "sent" });
    }
    const job = await latestLinkJob(su, T.firmId);
    expect(job?.data).toMatchObject({ purpose: "client_login", subjectId: c.id });
    expect(await sendClientLoginLink(office(T), c.id)).toMatchObject({ status: "rate_limited" });
    await setClientContactOn(office(T), { clientContactId: c.id, on: false });
    expect(await sendClientLoginLink(office(T), c.id)).toEqual({ status: "off" });
    expect(await sendClientLoginLink(office(T), randomUUID())).toEqual({ status: "not_found" });
  });

  it.each(["resourcer", "payroll"] as const)("a %s can't manage client logins", async (role) => {
    const T = await createTenant(su);
    const c = await contact(T);
    const who = office(T, await officeUser(T, role));
    expect(await listClientContacts(who, T.rows.clients)).toEqual({ status: "not_allowed" });
    expect(
      await addClientContact(who, {
        contractId: T.rows.clients,
        name: "X",
        email: "x@example.com",
      }),
    ).toEqual({ status: "not_allowed" });
    expect(await setClientContactOn(who, { clientContactId: c.id, on: false })).toEqual({
      status: "not_allowed",
    });
    expect(await sendClientLoginLink(who, c.id)).toEqual({ status: "not_allowed" });
  });

  it("removing a contract removes its client logins, their sessions and requests, and says so in the log", async () => {
    const T = await createTenant(su);
    const c = await contact(T);
    const s = await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "client", subjectId: c.id, now: NOW }),
    );
    expect(await removeContract(office(T), T.rows.clients)).toEqual({ status: "removed" });
    expect(await currentClient(ctx(T), s.token)).toBeNull();
    const { rows } = await su.query<{ n: number }>(
      `select (select count(*) from client_contacts where firm_id = $1)
            + (select count(*) from client_requests where firm_id = $1)
            + (select count(*) from sessions where firm_id = $1 and kind = 'client') as n`,
      [T.firmId],
    );
    expect(Number(rows[0]?.n)).toBe(0);
    const { rows: ev } = await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'client.removed'",
      [T.firmId],
    );
    // The fixture's own login and this one.
    expect(ev[0]?.data).toEqual({ sites: 0, clientLogins: 2 });
  });
});
