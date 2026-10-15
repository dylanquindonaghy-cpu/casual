import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendLoginCode } from "@/lib/auth/send-login-code";
import { sendPortalLink } from "@/lib/auth/send-portal-link";
import { createSession } from "@/lib/auth/sessions";
import { scanCredentials } from "@/lib/credentials/scan";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import type { MessagingTransport } from "@/lib/messaging/transport";
import { runFirmChangeNotice } from "@/lib/notices/firm-change";
import { runPayQueryUpdate } from "@/lib/notices/pay-query-update";
import { runRequestUpdate } from "@/lib/notices/request-update";
import { runShiftConfirmed } from "@/lib/notices/shift-confirmed";
import { runOfficeOffer } from "@/lib/offers/office-offer";
import { runOfferWave } from "@/lib/offers/waves";
import { sortPayQueries } from "@/lib/office/pay-sort";
import { assignWorker, cancelBookingByOffice } from "@/lib/office/quick-actions";
import type { PushTransport } from "@/lib/push/transport";
import { runShiftReminders } from "@/lib/reminders/send";
import { resolveRequest } from "@/lib/requests/resolve";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { createTenant } from "../helpers/tenant-rows";

// Audit finding M12: the action log refuses event data the log masker would change, and the masker
// once read any run of 10+ digits as a phone number. A real Twilio message id ("SM" + 32 lowercase
// hex) has such a run about 1 in 12 times, so once Twilio was connected the event logging a send
// would have failed after the message went. Every sender that logs its provider's message id is run
// here with a transport that returns Twilio-shaped ids holding a 30-digit run: each logs the id
// exactly as given. Real database, app role, fixed clock, nothing sent anywhere.

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

const clock = { now: () => NOW };
const noPush: PushTransport = {
  name: "none",
  async send() {
    return { status: "skipped" };
  },
};

// Twilio-shaped ids, each with a 10-digit run and the hex letters c to f.
function twilio() {
  const ids: string[] = [];
  const transport: MessagingTransport = {
    name: "twilio-shaped",
    async send() {
      const id = `SM${String(1_000_000_000 + ids.length)}cdef0123456789abcdef01`;
      ids.push(id);
      return { providerMessageId: id };
    },
  };
  return { ids, transport };
}

// The provider ids in the firm's events for an action, exactly as stored.
async function loggedIds(firmId: string, action: string): Promise<unknown[]> {
  const { rows } = await su.query<{ data: Record<string, unknown> }>(
    "select data from events where firm_id = $1 and action = $2 order by id",
    [firmId, action],
  );
  return rows.map((r) => r.data.providerMessageId);
}

describe("every sender logs a Twilio-shaped message id as it is", () => {
  it("an offer wave (offer.sent)", async () => {
    const f = await bookingFirm(su, withFirm, {});
    await f.worker({ first: "Rae" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(10) });
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
    const t = twilio();
    expect(
      await runOfferWave(
        { firmId: f.firmId, idempotencyKey: `offer-wave:${shiftId}:1`, shiftId, wave: 1 },
        withFirm,
        { transport: t.transport, push: noPush, baseDomain: "localhost:3000", clock },
      ),
    ).toEqual({ status: "sent", sent: 1, next: null });
    expect(t.ids[0]).toMatch(/\d{10}/);
    expect(await loggedIds(f.firmId, "offer.sent")).toEqual(t.ids);
  });

  it("the office's offer (offer.sent)", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const workerId = await f.worker({ first: "Rae" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    const officeUserId = await f.office("resourcer");
    const t = twilio();
    expect(
      await runOfficeOffer(
        {
          firmId: f.firmId,
          idempotencyKey: `office-offer:${shiftId}:${workerId}`,
          shiftId,
          workerId,
          officeUserId,
        },
        withFirm,
        { transport: t.transport, push: noPush, baseDomain: "localhost:3000", clock },
      ),
    ).toMatchObject({ status: "sent" });
    expect(await loggedIds(f.firmId, "offer.sent")).toEqual(t.ids);
  });

  it("a login link (auth.link_sent)", async () => {
    const T = await createTenant(su);
    const t = twilio();
    expect(
      await sendPortalLink(
        {
          firmId: T.firmId,
          idempotencyKey: randomUUID(),
          purpose: "worker_login",
          subjectId: T.workerId,
        },
        withFirm,
        { transport: t.transport, clock, baseDomain: "localhost:3000" },
      ),
    ).toMatchObject({ sent: true });
    expect(await loggedIds(T.firmId, "auth.link_sent")).toEqual(t.ids);
  });

  it("a pay-page code (auth.otp_sent)", async () => {
    const T = await createTenant(su);
    const session = await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "worker", subjectId: T.workerId, now: NOW }),
    );
    const t = twilio();
    expect(
      await sendLoginCode(
        { firmId: T.firmId, idempotencyKey: randomUUID(), sessionId: session.id },
        withFirm,
        { transport: t.transport, clock, secret: "test-only-secret-not-for-any-real-use-0123" },
      ),
    ).toMatchObject({ sent: true });
    expect(await loggedIds(T.firmId, "auth.otp_sent")).toEqual(t.ids);
  });

  it("the credential warning and expiry notice", async () => {
    const f = await bookingFirm(su, withFirm, {});
    await f.worker({ first: "Sam", credentials: [{ type: "SIA_DS", expiresOn: "2026-11-09" }] });
    await f.worker({ first: "Tia", credentials: [{ type: "SIA_DS", expiresOn: "2026-11-02" }] });
    const t = twilio();
    expect(
      await scanCredentials(
        { firmId: f.firmId, idempotencyKey: "credential-scan:2026-11-03" },
        withFirm,
        { transport: t.transport, baseDomain: "localhost:3000" },
      ),
    ).toMatchObject({ warned: 1, expired: 1, failed: 0 });
    const logged = [
      ...(await loggedIds(f.firmId, "credential.expiry_warning")),
      ...(await loggedIds(f.firmId, "credential.expiry_notice_sent")),
    ];
    expect(logged.sort()).toEqual([...t.ids].sort());
  });

  it("a shift reminder (shift.reminder_sent)", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const workerId = await f.worker({ first: "Ann" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(23) });
    await f.booking(workerId, shiftId);
    const t = twilio();
    expect(
      await runShiftReminders(
        {
          firmId: f.firmId,
          idempotencyKey: `shift-reminders:${Math.floor(NOW.getTime() / 300_000)}`,
        },
        withFirm,
        { transport: t.transport, push: noPush, baseDomain: "localhost:3000", clock },
      ),
    ).toMatchObject({ sent: 1 });
    expect(await loggedIds(f.firmId, "shift.reminder_sent")).toEqual(t.ids);
  });

  it("a firm-change notice (shift.change_notice_sent)", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const workerId = await f.worker({ first: "Ann" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    await f.booking(workerId, shiftId);
    const officeUserId = await f.office("resourcer");
    await cancelBookingByOffice(
      { firm: { id: f.firmId }, officeUserId, run: withFirm, clock },
      shiftId,
      workerId,
      "event_cancelled",
    );
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = 'firm-change-notice' and data ->> 'firmId' = $1",
      [f.firmId],
    );
    const t = twilio();
    await runFirmChangeNotice(
      rows[0]?.data as Parameters<typeof runFirmChangeNotice>[0],
      withFirm,
      {
        transport: t.transport,
        push: noPush,
        baseDomain: "localhost:3000",
        clock,
      },
    );
    expect(t.ids).toHaveLength(1);
    expect(await loggedIds(f.firmId, "shift.change_notice_sent")).toEqual(t.ids);
  });

  it("the office booked them (shift.booked_notice_sent)", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const workerId = await f.worker({ first: "Ada" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    const officeUserId = await f.office("resourcer");
    expect(
      await assignWorker(
        { firm: { id: f.firmId }, officeUserId, run: withFirm, clock },
        shiftId,
        workerId,
        null,
      ),
    ).toMatchObject({ status: "booked" });
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = 'shift-confirmed' and data ->> 'firmId' = $1",
      [f.firmId],
    );
    const t = twilio();
    await runShiftConfirmed(rows[0]?.data as Parameters<typeof runShiftConfirmed>[0], withFirm, {
      transport: t.transport,
      push: noPush,
      baseDomain: "localhost:3000",
      clock,
    });
    expect(t.ids).toHaveLength(1);
    expect(await loggedIds(f.firmId, "shift.booked_notice_sent")).toEqual(t.ids);
  });

  it("a request's answer (request.update_sent)", async () => {
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
    await resolveRequest(
      withFirm,
      f.firmId,
      { requestId, decision: "approved", note: "", by: { type: "office", id: officeUserId } },
      { clock },
    );
    const t = twilio();
    await runRequestUpdate(
      { firmId: f.firmId, idempotencyKey: `request-update:${requestId}`, requestId },
      withFirm,
      { transport: t.transport, push: noPush, clock },
    );
    expect(t.ids).toHaveLength(1);
    expect(await loggedIds(f.firmId, "request.update_sent")).toEqual(t.ids);
  });

  it("a pay query's answer (pay_query.update_sent)", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const workerId = await f.worker({ first: "Cal" });
    const { rows } = await su.query<{ id: string }>(
      `insert into pay_queries (firm_id, worker_id, work_date, issue_type)
       values ($1, $2, '2026-10-31', 'late_pay') returning id::text as id`,
      [f.firmId, workerId],
    );
    const payQueryId = rows[0]?.id ?? "";
    const payroll = await f.office("payroll");
    await sortPayQueries(
      { firm: { id: f.firmId }, officeUserId: payroll, run: withFirm, clock },
      [payQueryId],
      "Paid on Friday.",
    );
    const t = twilio();
    await runPayQueryUpdate(
      { firmId: f.firmId, idempotencyKey: `pay-query-update:${payQueryId}`, payQueryId },
      withFirm,
      { transport: t.transport, push: noPush, clock },
    );
    expect(t.ids).toHaveLength(1);
    expect(await loggedIds(f.firmId, "pay_query.update_sent")).toEqual(t.ids);
  });
});
