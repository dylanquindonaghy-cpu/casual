import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendLoginCode } from "@/lib/auth/send-login-code";
import { sendPortalLink } from "@/lib/auth/send-portal-link";
import { createSession } from "@/lib/auth/sessions";
import { verifyStepUpCode } from "@/lib/auth/step-up";
import { consumeWorkerLoginLink } from "@/lib/auth/worker-login";
import { scanCredentials } from "@/lib/credentials/scan";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import type { MessagingTransport, OutboundMessage } from "@/lib/messaging/transport";
import { runFirmChangeNotice } from "@/lib/notices/firm-change";
import { runRequestUpdate } from "@/lib/notices/request-update";
import { runOfficeOffer } from "@/lib/offers/office-offer";
import { runEscalation } from "@/lib/offers/waves";
import { cancelBookingByOffice } from "@/lib/office/quick-actions";
import type { PushTransport } from "@/lib/push/transport";
import { resolveRequest } from "@/lib/requests/resolve";
import { tokenFrom } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { createTenant } from "../helpers/tenant-rows";

// Golden rule 3 for every sender (Phase 10, audit finding M10): a job that fails AFTER its message
// went (the commit of the record step failing, an event the log masker refuses, a crash) is retried
// by pg-boss, and the retry must send nothing. Each sender claims its work in a committed
// transaction before the message, so the retry finds the claim; the retry also logs what the failed
// run couldn't (the send, marked unconfirmed), so the action log and the notice report keep it.
// The transaction-runner here fails any transaction a message was sent during, and the first one
// started after a message (the record step). Real database, app role, nothing sent anywhere.

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
const noPush: PushTransport = {
  name: "none",
  async send() {
    return { status: "skipped" };
  },
};

// A transport that remembers what went (or throws, when `down`), and a runner that fails the
// record step: any transaction a message was sent during, and the first one after a message.
function harness(o: { down?: boolean } = {}) {
  const sent: OutboundMessage[] = [];
  const transport: MessagingTransport = {
    name: "capture",
    async send(message) {
      if (o.down) throw new Error("provider down");
      sent.push(message);
      return { providerMessageId: `capture-${sent.length}` };
    },
  };
  let tripped = false;
  const failingAfterSend: WithFirm = async (firmId, fn) => {
    if (!tripped && sent.length > 0) {
      tripped = true;
      throw new Error("the record step failed");
    }
    const before = sent.length;
    return withFirm(firmId, async (tx) => {
      const value = await fn(tx);
      if (!tripped && sent.length > before) {
        tripped = true;
        throw new Error("the record step failed"); // a send inside this transaction: roll it back
      }
      return value;
    });
  };
  return { sent, transport, failingAfterSend };
}

// Runs `job` with the failing runner (it must throw), then again normally; returns the messages.
async function failThenRetry(
  job: (run: WithFirm, transport: MessagingTransport) => Promise<unknown>,
): Promise<OutboundMessage[]> {
  const h = harness();
  await expect(job(h.failingAfterSend, h.transport)).rejects.toThrow("the record step failed");
  expect(h.sent).toHaveLength(1);
  await job(withFirm, h.transport);
  return h.sent;
}

const eventsOf = async (firmId: string, action: string) =>
  (
    await su.query<{ entity_id: string; data: Record<string, unknown> }>(
      "select entity_id::text, data from events where firm_id = $1 and action = $2 order by id",
      [firmId, action],
    )
  ).rows;

async function officeOfferSetup() {
  const f = await bookingFirm(su, withFirm, {});
  const workerId = await f.worker({ first: "Rae" });
  const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
  const officeUserId = await f.office("resourcer");
  const payload = {
    firmId: f.firmId,
    idempotencyKey: `office-offer:${shiftId}:${workerId}`,
    shiftId,
    workerId,
    officeUserId,
  };
  const deps = (transport: MessagingTransport) => ({
    transport,
    push: noPush,
    baseDomain: "localhost:3000",
    clock,
  });
  return { f, workerId, shiftId, payload, deps };
}

async function linkSetup() {
  const T = await createTenant(su);
  const payload = {
    firmId: T.firmId,
    idempotencyKey: randomUUID(),
    purpose: "worker_login" as const,
    subjectId: T.workerId,
  };
  const deps = (transport: MessagingTransport) => ({
    transport,
    clock,
    baseDomain: "localhost:3000",
  });
  return { T, payload, deps };
}

async function codeSetup() {
  const T = await createTenant(su);
  const session = await withFirm(T.firmId, (tx) =>
    createSession(tx, { kind: "worker", subjectId: T.workerId, now: NOW }),
  );
  const payload = { firmId: T.firmId, idempotencyKey: randomUUID(), sessionId: session.id };
  const deps = (transport: MessagingTransport) => ({
    transport,
    clock,
    secret: SECRET,
    newCode: () => "424242",
  });
  return { T, session, payload, deps };
}

// A worker whose licence is warned about (expires in 7 days) or expired (the day before), on the
// scan of Tuesday 3 November.
async function scanSetup(expiresOn: string) {
  const f = await bookingFirm(su, withFirm, {});
  await f.worker({ first: "Sam", credentials: [{ type: "SIA_DS", expiresOn }] });
  const payload = { firmId: f.firmId, idempotencyKey: "credential-scan:2026-11-03" };
  return { f, payload };
}

describe("a job that fails after its message is sent never sends it again, and logs it once", () => {
  it("the office's offer: one offer.sent (unconfirmed) and no 'wasn't sent'", async () => {
    const t = await officeOfferSetup();
    const sent = await failThenRetry((run, transport) =>
      runOfficeOffer(t.payload, run, t.deps(transport)),
    );
    expect(sent).toHaveLength(1);
    const logged = await eventsOf(t.f.firmId, "offer.sent");
    expect(logged).toHaveLength(1);
    expect(logged[0]?.data).toMatchObject({
      shiftId: t.shiftId,
      workerId: t.workerId,
      unconfirmed: true,
    });
    expect(typeof logged[0]?.data.noticeHours).toBe("number");
    expect(await eventsOf(t.f.firmId, "offer.office_not_sent")).toEqual([]);
  });

  it("the escalation email (claimed first: nothing follows a sent email; a rerun sends nothing)", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const shiftId = await f.shift({ startsAt: hoursFromNow(10) });
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
    await f.office("resourcer");
    const payload = { firmId: f.firmId, idempotencyKey: `escalate-shift:${shiftId}`, shiftId };
    const h = harness();
    const deps = {
      transport: h.transport,
      push: noPush,
      baseDomain: "localhost:3000",
      clock: { now: () => hoursFromNow(7) },
    };
    expect(await runEscalation(payload, h.failingAfterSend, deps)).toEqual({
      status: "escalated",
      notified: 1,
    });
    // pg-boss runs it again (the worker died before marking it complete): nothing more.
    expect(await runEscalation(payload, withFirm, deps)).toEqual({ status: "already" });
    expect(h.sent).toHaveLength(1);
    // (A crash between two office users' emails: tests/integration/offers.waves.lock.test.ts.)
  });

  it("the credential expiry warning: logged once, unconfirmed", async () => {
    const t = await scanSetup("2026-11-09");
    const sent = await failThenRetry((run, transport) =>
      scanCredentials(t.payload, run, { transport }),
    );
    expect(sent).toHaveLength(1);
    const logged = await eventsOf(t.f.firmId, "credential.expiry_warning");
    expect(logged.map((e) => e.data)).toEqual([
      expect.objectContaining({ days: 7, expiresOn: "2026-11-09", unconfirmed: true }),
    ]);
  });

  it("the credential expiry notice: the expiry logged with the claim, the notice once, unconfirmed", async () => {
    const t = await scanSetup("2026-11-02");
    const sent = await failThenRetry((run, transport) =>
      scanCredentials(t.payload, run, { transport }),
    );
    expect(sent).toHaveLength(1);
    expect(await eventsOf(t.f.firmId, "credential.expired")).toHaveLength(1);
    expect(
      (await eventsOf(t.f.firmId, "credential.expiry_notice_sent")).map((e) => e.data),
    ).toEqual([expect.objectContaining({ type: "SIA_DS", unconfirmed: true })]);
  });

  it("the office's Monday list (claimed first: a rerun sends nothing)", async () => {
    const f = await bookingFirm(su, withFirm, {});
    await f.worker({
      first: "Sam",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-10-28", status: "expired" }],
    });
    await f.office("admin");
    await f.office("resourcer");
    const payload = { firmId: f.firmId, idempotencyKey: "credential-scan:2026-11-02" };
    const h = harness();
    expect(
      await scanCredentials(payload, h.failingAfterSend, { transport: h.transport }),
    ).toMatchObject({ weeklyList: "sent" });
    expect(h.sent.map((m) => m.channel)).toEqual(["email", "email"]);
    expect(await scanCredentials(payload, withFirm, { transport: h.transport })).toMatchObject({
      weeklyList: "already_sent",
    });
    expect(h.sent).toHaveLength(2);
  });

  it("a login link: logged once, unconfirmed, and the link that went still logs in", async () => {
    const t = await linkSetup();
    const sent = await failThenRetry((run, transport) =>
      sendPortalLink(t.payload, run, t.deps(transport)),
    );
    expect(sent).toHaveLength(1);
    expect((await eventsOf(t.T.firmId, "auth.link_sent")).map((e) => e.data)).toEqual([
      { purpose: "worker_login", channel: "whatsapp", unconfirmed: true },
    ]);
    expect(
      (await consumeWorkerLoginLink({ firm: { id: t.T.firmId }, clock }, tokenFrom(sent[0])))
        .status,
    ).toBe("ok");
  });

  it("a pay-page login code: logged once, unconfirmed, and the code that went still works", async () => {
    const t = await codeSetup();
    const sent = await failThenRetry((run, transport) =>
      sendLoginCode(t.payload, run, t.deps(transport)),
    );
    expect(sent).toHaveLength(1);
    expect((await eventsOf(t.T.firmId, "auth.otp_sent")).map((e) => e.data)).toEqual([
      { channel: "whatsapp", unconfirmed: true },
    ]);
    const verified = await verifyStepUpCode(
      { firm: { id: t.T.firmId }, clock, secret: SECRET },
      t.session.token,
      "424242",
    );
    expect(verified.status).toBe("ok");
  });

  it("two copies of a login-code job at once: one code, and it works", async () => {
    const t = await codeSetup();
    const h = harness();
    await Promise.all([
      sendLoginCode(t.payload, withFirm, t.deps(h.transport)),
      sendLoginCode(t.payload, withFirm, t.deps(h.transport)),
    ]);
    expect(h.sent).toHaveLength(1);
    const verified = await verifyStepUpCode(
      { firm: { id: t.T.firmId }, clock, secret: SECRET },
      t.session.token,
      "424242",
    );
    expect(verified.status).toBe("ok");
  });

  it("a firm-change notice (the office cancelled their booking)", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const workerId = await f.worker({ first: "Ann" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    await f.booking(workerId, shiftId);
    const officeUserId = await f.office("resourcer");
    expect(
      await cancelBookingByOffice(
        { firm: { id: f.firmId }, officeUserId, run: withFirm, clock },
        shiftId,
        workerId,
        "event_cancelled",
      ),
    ).toMatchObject({ status: "cancelled" });
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = 'firm-change-notice' and data ->> 'firmId' = $1",
      [f.firmId],
    );
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.data as Parameters<typeof runFirmChangeNotice>[0];
    const sent = await failThenRetry((run, transport) =>
      runFirmChangeNotice(payload, run, {
        transport,
        push: noPush,
        baseDomain: "localhost:3000",
        clock,
      }),
    );
    expect(sent).toHaveLength(1);
  });

  it("a request's answer to the worker", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const workerId = await f.worker({ first: "Ben" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    await f.booking(workerId, shiftId);
    const officeUserId = await f.office("resourcer");
    const { rows } = await su.query<{ id: string }>(
      `insert into requests (firm_id, worker_id, shift_id, type, payload, status, created_at)
       values ($1, $2, $3, 'general', $4, 'open', $5) returning id::text as id`,
      [f.firmId, workerId, shiftId, JSON.stringify({ text: "Can I bring a coat?" }), NOW],
    );
    const requestId = rows[0]?.id ?? "";
    expect(
      await resolveRequest(
        withFirm,
        f.firmId,
        { requestId, decision: "approved", note: "", by: { type: "office", id: officeUserId } },
        { clock },
      ),
    ).toMatchObject({ status: "resolved" });
    const payload = { firmId: f.firmId, idempotencyKey: `request-update:${requestId}`, requestId };
    const sent = await failThenRetry((run, transport) =>
      runRequestUpdate(payload, run, { transport, push: noPush, clock }),
    );
    expect(sent).toHaveLength(1);
  });
});

describe("a send that fails is logged, and never tried again", () => {
  it("the office's offer: offer.send_failed with the offer, marked failed", async () => {
    const t = await officeOfferSetup();
    const h = harness({ down: true });
    expect(await runOfficeOffer(t.payload, withFirm, t.deps(h.transport))).toEqual({
      status: "failed",
    });
    const failed = await eventsOf(t.f.firmId, "offer.send_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.data).toMatchObject({ workerId: t.workerId, code: "Error" });
    expect(typeof failed[0]?.data.offerId).toBe("string");
    expect(await runOfficeOffer(t.payload, withFirm, t.deps(h.transport))).toEqual({
      status: "already",
    });
    expect(await eventsOf(t.f.firmId, "offer.sent")).toEqual([]);
  });

  it("a login link: auth.link_send_failed, and a rerun sends nothing", async () => {
    const t = await linkSetup();
    const h = harness({ down: true });
    expect(await sendPortalLink(t.payload, withFirm, t.deps(h.transport))).toEqual({
      sent: false,
      reason: "failed",
    });
    expect((await eventsOf(t.T.firmId, "auth.link_send_failed")).map((e) => e.data)).toEqual([
      { purpose: "worker_login", channel: "whatsapp", code: "Error" },
    ]);
    expect(await sendPortalLink(t.payload, withFirm, t.deps(h.transport))).toEqual({
      sent: false,
      reason: "already_sent",
    });
    expect(await eventsOf(t.T.firmId, "auth.link_sent")).toEqual([]);
  });

  it("a login code: auth.otp_send_failed, and a rerun sends nothing", async () => {
    const t = await codeSetup();
    const h = harness({ down: true });
    expect(await sendLoginCode(t.payload, withFirm, t.deps(h.transport))).toEqual({
      sent: false,
      reason: "failed",
    });
    expect((await eventsOf(t.T.firmId, "auth.otp_send_failed")).map((e) => e.data)).toEqual([
      { channel: "whatsapp", code: "Error" },
    ]);
    expect(await sendLoginCode(t.payload, withFirm, t.deps(h.transport))).toEqual({
      sent: false,
      reason: "already_sent",
    });
    expect(await eventsOf(t.T.firmId, "auth.otp_sent")).toEqual([]);
  });

  it("the credential warning and the expiry notice: their _failed events, counted, not retried", async () => {
    for (const [expiresOn, failedAction] of [
      ["2026-11-09", "credential.expiry_warning_failed"],
      ["2026-11-02", "credential.expiry_notice_failed"],
    ] as const) {
      const t = await scanSetup(expiresOn);
      const h = harness({ down: true });
      expect(await scanCredentials(t.payload, withFirm, { transport: h.transport })).toMatchObject({
        warned: 0,
        failed: 1,
      });
      expect((await eventsOf(t.f.firmId, failedAction)).map((e) => e.data)).toEqual([
        expect.objectContaining({ type: "SIA_DS", channel: "whatsapp", code: "Error" }),
      ]);
      const ok = harness();
      expect(await scanCredentials(t.payload, withFirm, { transport: ok.transport })).toMatchObject(
        { warned: 0, expired: 0, failed: 0 },
      );
      expect(ok.sent).toEqual([]);
    }
  });
});
