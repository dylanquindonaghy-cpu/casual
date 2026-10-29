import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendLoginCode } from "@/lib/auth/send-login-code";
import { sendPortalLink } from "@/lib/auth/send-portal-link";
import { createSession } from "@/lib/auth/sessions";
import { verifyStepUpCode } from "@/lib/auth/step-up";
import { consumeWorkerLoginLink } from "@/lib/auth/worker-login";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  NoTextSenderError,
  type MessagingTransport,
  type OutboundMessage,
} from "@/lib/messaging/transport";
import { tokenFrom } from "../helpers/auth";
import { NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// A casual's login link and pay-page code by email (P2.6; PLAN.md "Connecting the firm's systems"
// 16): only with no text sender (MESSAGING_TRANSPORT=none, P2.5), only where the firm has switched
// `login_by_email` on, and only to the address held for them; otherwise by WhatsApp as before, or
// not at all (logged, `no_channel`). Real database, app role; the transports capture (nothing is
// sent anywhere). The words are the approved ones (tests/unit/copy.templates-doc.test.ts).

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const SECRET = "test-only-secret-not-for-any-real-use-0123";
const clock = { now: () => NOW };

// What went. `texts: false`: no text sender at all (a WhatsApp or text is refused before anything
// is tried); otherwise every channel takes it. An email comes back with an SMTP server's kind of
// Message-ID (the sending host after an "@", which the action log refuses as an address).
function capture(o: { texts: boolean }) {
  const sent: OutboundMessage[] = [];
  const transport: MessagingTransport = {
    name: "capture",
    ...(o.texts ? {} : { texts: false as const }),
    async send(message) {
      if (!o.texts && message.channel !== "email") throw new NoTextSenderError(message.channel);
      sent.push(message);
      return {
        providerMessageId:
          message.channel === "email"
            ? `<id-${sent.length}@mail.example.test>`
            : `SM${sent.length}`,
      };
    },
  };
  return { sent, transport };
}

const loginByEmail = (t: Tenant, on: boolean) =>
  su.query(
    `update firms set settings = settings || jsonb_build_object('login_by_email', $2::boolean)
      where id = $1`,
    [t.firmId, on],
  );
const giveEmail = (t: Tenant, email: string | null) =>
  su.query("update workers set email = $2 where id = $1", [t.workerId, email]);

const eventsOf = async (firmId: string, action: string) =>
  (
    await su.query<{ entity_type: string; data: Record<string, unknown> }>(
      "select entity_type, data from events where firm_id = $1 and action = $2 order by id",
      [firmId, action],
    )
  ).rows;
// The links made for one login request (the tenant's fixture has a link of its own).
const linksFor = async (requestId: string) =>
  (await su.query("select id from magic_links where request_id = $1", [requestId])).rows.length;

const linkPayload = (t: Tenant) => ({
  firmId: t.firmId,
  idempotencyKey: randomUUID(),
  purpose: "worker_login" as const,
  subjectId: t.workerId,
});
const linkDeps = (transport: MessagingTransport) => ({
  transport,
  clock,
  baseDomain: "localhost:3000",
});

async function session(t: Tenant) {
  const s = await withFirm(t.firmId, (tx) =>
    createSession(tx, { kind: "worker", subjectId: t.workerId, now: NOW }),
  );
  const payload = { firmId: t.firmId, idempotencyKey: randomUUID(), sessionId: s.id };
  return { s, payload };
}
const codeDeps = (transport: MessagingTransport, code = "424242") => ({
  transport,
  clock,
  secret: SECRET,
  newCode: () => code,
});
const verify = (t: Tenant, token: string, code: string) =>
  verifyStepUpCode({ firm: { id: t.firmId }, clock, secret: SECRET }, token, code);

describe("a casual's login link by email (P2.6)", () => {
  it("no text sender, switched on, an address held: the link by email, and it logs them in", async () => {
    const t = await createTenant(su);
    await loginByEmail(t, true);
    await giveEmail(t, "rae.casual@example.test");
    const c = capture({ texts: false });
    expect(await sendPortalLink(linkPayload(t), withFirm, linkDeps(c.transport))).toMatchObject({
      sent: true,
    });
    const [email] = c.sent;
    expect(email).toMatchObject({
      channel: "email",
      to: "rae.casual@example.test",
      subject: `Your Test Firm ${t.slug} shifts link`,
    });
    expect(email && "body" in email ? email.body : "").toMatch(
      new RegExp(
        `^Here's your Test Firm ${t.slug} shifts link\\. It works for 15 minutes and only for you\\. If you didn't ask for it, you can ignore this email: http://${t.slug}\\.localhost:3000/l#[A-Za-z0-9_-]{43} — Test Firm ${t.slug} Shift Team$`,
      ),
    );
    // Logged by the way it went, its id as the log takes it (never the address).
    expect((await eventsOf(t.firmId, "auth.link_sent")).map((e) => e.data)).toEqual([
      { purpose: "worker_login", channel: "email", providerMessageId: "id-1" },
    ]);
    const login = await consumeWorkerLoginLink({ firm: { id: t.firmId }, clock }, tokenFrom(email));
    expect(login.status).toBe("ok");
  });

  it("switched off (the default): no email, no link made, and the miss logged (no_channel)", async () => {
    const t = await createTenant(su);
    await giveEmail(t, "rae.casual@example.test");
    const c = capture({ texts: false });
    const payload = linkPayload(t);
    expect(await sendPortalLink(payload, withFirm, linkDeps(c.transport))).toEqual({
      sent: false,
      reason: "no_channel",
    });
    expect(c.sent).toEqual([]);
    expect(await linksFor(payload.idempotencyKey)).toBe(0);
    expect(await eventsOf(t.firmId, "auth.link_send_failed")).toEqual([
      {
        entity_type: "worker",
        data: { purpose: "worker_login", channel: null, code: "no_channel" },
      },
    ]);
  });

  it("switched on but no address held: the same", async () => {
    const t = await createTenant(su);
    await loginByEmail(t, true);
    const c = capture({ texts: false });
    const payload = linkPayload(t);
    expect(await sendPortalLink(payload, withFirm, linkDeps(c.transport))).toEqual({
      sent: false,
      reason: "no_channel",
    });
    expect(c.sent).toEqual([]);
    expect(await linksFor(payload.idempotencyKey)).toBe(0);
  });

  it("with a text sender, by WhatsApp as before, whatever the setting", async () => {
    const t = await createTenant(su);
    await loginByEmail(t, true);
    await giveEmail(t, "rae.casual@example.test");
    const c = capture({ texts: true });
    await sendPortalLink(linkPayload(t), withFirm, linkDeps(c.transport));
    expect(c.sent.map((m) => m.channel)).toEqual(["whatsapp"]);
    expect((await eventsOf(t.firmId, "auth.link_sent")).map((e) => e.data.channel)).toEqual([
      "whatsapp",
    ]);
  });

  it("the same job again sends nothing more", async () => {
    const t = await createTenant(su);
    await loginByEmail(t, true);
    await giveEmail(t, "rae.casual@example.test");
    const c = capture({ texts: false });
    const payload = linkPayload(t);
    await sendPortalLink(payload, withFirm, linkDeps(c.transport));
    expect(await sendPortalLink(payload, withFirm, linkDeps(c.transport))).toEqual({
      sent: false,
      reason: "already_sent",
    });
    expect(c.sent).toHaveLength(1);
  });
});

describe("the office's login link by email: its id as the action log takes it", () => {
  it("an SMTP Message-ID's host never fails the record of a link that went", async () => {
    const t = await createTenant(su);
    const c = capture({ texts: true });
    expect(
      await sendPortalLink(
        {
          firmId: t.firmId,
          idempotencyKey: randomUUID(),
          purpose: "office_login",
          subjectId: t.officeUserId,
        },
        withFirm,
        linkDeps(c.transport),
      ),
    ).toMatchObject({ sent: true });
    expect((await eventsOf(t.firmId, "auth.link_sent")).map((e) => e.data)).toEqual([
      { purpose: "office_login", channel: "email", providerMessageId: "id-1" },
    ]);
  });
});

describe("a casual's pay-page code by email (P2.6)", () => {
  it("no text sender, switched on, an address held: the code by email, and it works", async () => {
    const t = await createTenant(su);
    await loginByEmail(t, true);
    await giveEmail(t, "rae.casual@example.test");
    const { s, payload } = await session(t);
    const c = capture({ texts: false });
    expect(await sendLoginCode(payload, withFirm, codeDeps(c.transport))).toMatchObject({
      sent: true,
    });
    expect(c.sent).toEqual([
      {
        channel: "email",
        to: "rae.casual@example.test",
        subject: `Your Test Firm ${t.slug} code`,
        body: `Your Test Firm ${t.slug} code is 424242. It works for 10 minutes. Don't share it with anyone. If you didn't ask for it, you can ignore this email. — Test Firm ${t.slug} Shift Team`,
      },
    ]);
    expect((await eventsOf(t.firmId, "auth.otp_sent")).map((e) => e.data)).toEqual([
      { channel: "email", providerMessageId: "id-1" },
    ]);
    expect((await verify(t, s.token, "424242")).status).toBe("ok");
  });

  it("switched off: no email, no new code (an earlier one still works), and the miss logged", async () => {
    const t = await createTenant(su);
    await giveEmail(t, "rae.casual@example.test");
    const { s, payload } = await session(t);
    // An earlier code, sent while there was a text sender.
    await sendLoginCode(payload, withFirm, codeDeps(capture({ texts: true }).transport, "111111"));
    const c = capture({ texts: false });
    expect(
      await sendLoginCode(
        { ...payload, idempotencyKey: randomUUID() },
        withFirm,
        codeDeps(c.transport, "222222"),
      ),
    ).toEqual({ sent: false, reason: "no_channel" });
    expect(c.sent).toEqual([]);
    expect(await eventsOf(t.firmId, "auth.otp_send_failed")).toEqual([
      { entity_type: "session", data: { channel: null, code: "no_channel" } },
    ]);
    expect((await verify(t, s.token, "111111")).status).toBe("ok");
  });

  it("with a text sender, by WhatsApp as before, logged by its channel", async () => {
    const t = await createTenant(su);
    await loginByEmail(t, true);
    await giveEmail(t, "rae.casual@example.test");
    const { payload } = await session(t);
    const c = capture({ texts: true });
    await sendLoginCode(payload, withFirm, codeDeps(c.transport));
    expect(c.sent.map((m) => m.channel)).toEqual(["whatsapp"]);
    expect((await eventsOf(t.firmId, "auth.otp_sent")).map((e) => e.data)).toEqual([
      { channel: "whatsapp", providerMessageId: "SM1" },
    ]);
  });
});
