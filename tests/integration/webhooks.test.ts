import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createKeyDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { recordEvent, recordEvents } from "@/lib/events/record";
import { collectFirmData } from "@/lib/gdpr/firm-export";
import { eraseWorker } from "@/lib/gdpr/worker-erase";
import { createWebhookDeliverTask, WEBHOOK_RETRY_LIMIT } from "@/lib/integrations/deliver";
import { cancellationPage } from "@/lib/integrations/records";
import { WEBHOOK_DELIVER_QUEUE } from "@/lib/integrations/outbox";
import { keyFromSigningSecret, signingSecret, webhookEventId } from "@/lib/integrations/secrets";
import { WebhookSendError } from "@/lib/integrations/send";
import { verifySignature, WEBHOOK_USER_AGENT } from "@/lib/integrations/sign";
import { putSessionRequest } from "@/lib/integrations/sessions";
import type { WebhookRequest, WebhookTransport } from "@/lib/integrations/webhook-transport";
import { WEBHOOK_SCHEMAS } from "@/lib/integrations/webhooks";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { loadCancellationRecord } from "@/lib/office/cancellations";
import { plannerText } from "@/lib/office/cancellations-copy";
import { loadNeedsAttention, needsCount } from "@/lib/office/dashboard";
import { integrationsPage } from "@/lib/office/integrations";
import { assignWorker, cancelBookingByOffice, cancelShift } from "@/lib/office/quick-actions";
import {
  addWebhook,
  removeWebhook,
  renewSigningSecret,
  sendTestWebhook,
  webhookStatus,
} from "@/lib/office/webhook-settings";
import { CANCEL_REASONS } from "@/lib/portal/cancel-reasons";
import { cancelMyShift } from "@/lib/portal/cancel-shift";
import { takeShift } from "@/lib/portal/take-shift";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import { syncSheet } from "@/lib/roster/sheets/sync";
import { withdrawStrike } from "@/lib/strikes/manage";
import { STRIKE_WARNING_VERSION, type WarningKind } from "@/lib/strikes/words";
import { createBoss } from "@/worker/boss";
import { failedJobCounts, inOrder, WEBHOOK_WORK_OPTIONS } from "@/worker/jobs";
import { ensureQueues, QUEUES } from "@/worker/jobs/queues";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, uniqueSlug, urls } from "../helpers/db";
import { FakeSheets, SHIFT_HEADER, shiftRow, STAFF_HEADER, staffRow } from "../helpers/fake-sheets";
import { answer, apiDeps, apiRequest, keptLog, plannerKey } from "../helpers/planner-api";

// The planner's webhooks (12J.2; docs/office-v2.md 5.3.3, 5.3.4) on the real database, as the app
// role: the settings function's webhook keys, the Integrations page's actions, the action log as
// the outbox (every booking and cancellation path queues exactly one delivery, none after a
// rollback, and only the firm's own), the delivery job with a fake transport (nothing reaches the
// network), its retries and last try through a real pg-boss worker, and what the office sees.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
let resolveKey: ReturnType<typeof createKeyDirectory>;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(6);
  withFirm = createWithFirm(app);
  resolveKey = createKeyDirectory(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const SECRET = "test-only-integrations-secret-not-for-any-real-use";
const BASE = "localhost:3000";
const at = (d: Date) => ({ now: () => d });
const later = (h: number) => new Date(NOW.getTime() + h * HOUR);
const saw = (kind: WarningKind) => ({ kind, version: STRIKE_WARNING_VERSION });
const PATH_SECRET = "catch/123456/k3F9";

// A firm with an admin, a resourcer and (unless asked not to) a webhook.
async function webhookFirm(o: { webhook?: boolean; host?: string } = {}) {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const url = `https://${o.host ?? `${f.firmId.slice(0, 8)}.hooks.example`}/${PATH_SECRET}`;
  const ctx = (officeUserId = admin, extra: { localDatabase?: boolean } = {}) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: at(NOW),
    secret: SECRET,
    baseDomain: BASE,
    resolveDomain: async () => null,
    localDatabase: true,
    ...extra,
  });
  let secret: string | null = null;
  if (o.webhook !== false) {
    const added = await addWebhook(ctx(), { address: url });
    if (added.status !== "added") throw new Error(`webhook not added: ${added.status}`);
    secret = added.secret;
  }
  const portal = (now = NOW) => ({
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Booking Test Shift Team" },
    run: withFirm,
    clock: at(now),
  });
  const office = (now = NOW, officeUserId = resourcer) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: at(now),
  });
  return { f, admin, resourcer, url, ctx, secret, portal, office };
}
type WebhookFirm = Awaited<ReturnType<typeof webhookFirm>>;

// The firm's queued deliveries (any state), oldest first.
const deliveries = async (firmId: string) =>
  (
    await su.query<{ id: string; data: { logEntryId?: number; testId?: string; firmId: string } }>(
      `select id::text as id, data from pgboss.job
        where name = $1 and data ->> 'firmId' = $2 order by created_on, id`,
      [WEBHOOK_DELIVER_QUEUE, firmId],
    )
  ).rows;

const entry = async (id: number) =>
  (
    await su.query<{ action: string; entity_id: string }>(
      "select action, entity_id::text from events where id = $1",
      [id],
    )
  ).rows[0];

const logged = async (firmId: string, action: string) =>
  (
    await su.query<{ entity_type: string; entity_id: string; data: Record<string, unknown> }>(
      `select entity_type, entity_id::text, data from events
        where firm_id = $1 and action = $2 order by id`,
      [firmId, action],
    )
  ).rows;

// The actions of the entries the firm's deliveries are about, in order.
const deliveredActions = async (firmId: string) => {
  const out: string[] = [];
  for (const d of await deliveries(firmId)) {
    if (d.data.logEntryId !== undefined) out.push((await entry(d.data.logEntryId))?.action ?? "?");
  }
  return out;
};

// A transport that keeps what it was asked to send; `fail` makes each send throw that code.
function fakeTransport(o: { fail?: WebhookSendError["code"] } = {}) {
  const sent: WebhookRequest[] = [];
  const transport: WebhookTransport = {
    name: "fake",
    async send(r) {
      sent.push(r);
      if (o.fail) throw new WebhookSendError(o.fail);
    },
  };
  return { sent, transport };
}

const deliverTask = (transport: WebhookTransport, now = NOW, logger = keptLog().logger) =>
  createWebhookDeliverTask(() => ({ transport, secret: SECRET, clock: at(now), logger }));

// Runs one queued delivery as the worker would (try `retryCount` of WEBHOOK_RETRY_LIMIT).
const deliver = (
  job: { id: string; data: unknown },
  transport: WebhookTransport,
  o: { retryCount?: number; now?: Date } = {},
) =>
  runFirmTask(
    deliverTask(transport, o.now),
    { ...job, retryCount: o.retryCount ?? 0, retryLimit: WEBHOOK_RETRY_LIMIT },
    withFirm,
    keptLog().logger,
  );

// A booking taken by a casual, 100 hours ahead (no strike either way).
async function takenBooking(t: WebhookFirm, hours = 100) {
  const worker = await t.f.worker();
  const shiftId = await t.f.shift({ startsAt: hoursFromNow(hours), role: "steward" });
  expect(await takeShift(t.portal(), worker, shiftId)).toMatchObject({ status: "booked" });
  const { rows } = await su.query<{ id: string }>(
    "select id::text from assignments where shift_id = $1 and worker_id = $2 and status = 'confirmed'",
    [shiftId, worker],
  );
  return { worker, shiftId, bookingId: rows[0]?.id ?? "" };
}

const settingsOf = async (firmId: string) =>
  (
    await su.query<{ settings: Record<string, unknown> }>(
      "select settings from firms where id = $1",
      [firmId],
    )
  ).rows[0]?.settings ?? {};

describe("app_set_firm_setting(): the webhook's keys", () => {
  const set = (firmId: string, key: string, value: string | null) =>
    withFirm(firmId, (tx) => tx.execute(sql`select app_set_firm_setting(${key}, ${value})`));

  it("sets and removes the address, and raises the signing version itself on each change", async () => {
    const t = await webhookFirm({ webhook: false });
    const id = t.f.firmId;
    await set(id, "webhook.url", "https://hooks.example/a");
    expect((await settingsOf(id)).webhook).toEqual({
      url: "https://hooks.example/a",
      signing_version: 1,
    });
    // The same address: nothing changes, so the secret stays.
    await set(id, "webhook.url", "https://hooks.example/a");
    expect((await settingsOf(id)).webhook).toMatchObject({ signing_version: 1 });
    await set(id, "webhook.rotate", null);
    expect((await settingsOf(id)).webhook).toMatchObject({ signing_version: 2 });
    await set(id, "webhook.url", "https://hooks.example/b");
    expect((await settingsOf(id)).webhook).toEqual({
      url: "https://hooks.example/b",
      signing_version: 3,
    });
    await set(id, "webhook.url", null);
    expect((await settingsOf(id)).webhook).toEqual({ signing_version: 4 });
    // Removing nothing changes nothing; a new address carries on from 4, so no old secret returns.
    await set(id, "webhook.url", null);
    await set(id, "webhook.url", "https://hooks.example/a");
    expect((await settingsOf(id)).webhook).toEqual({
      url: "https://hooks.example/a",
      signing_version: 5,
    });
  });

  it("refuses what isn't an https address, a rotation with nothing to rotate, and setting the version", async () => {
    const t = await webhookFirm({ webhook: false });
    const id = t.f.firmId;
    for (const bad of [
      "http://hooks.example/a",
      "https://user@hooks.example/a",
      "hooks.example",
      `https://hooks.example/${"x".repeat(500)}`,
    ]) {
      await expect(set(id, "webhook.url", bad)).rejects.toMatchObject({ cause: { code: "22023" } });
    }
    await expect(set(id, "webhook.rotate", null)).rejects.toMatchObject({
      cause: { code: "22023" },
    });
    await set(id, "webhook.url", "https://hooks.example/a");
    await expect(set(id, "webhook.rotate", "1")).rejects.toMatchObject({
      cause: { code: "22023" },
    });
    // The version can't be set, lowered or raised by name: only the function's own changes move it.
    for (const v of ["0", "1", "99", null]) {
      await expect(set(id, "webhook.signing_version", v)).rejects.toMatchObject({
        cause: { code: "42501" },
      });
    }
    expect((await settingsOf(id)).webhook).toEqual({
      url: "https://hooks.example/a",
      signing_version: 1,
    });
    // And the app can't write firms itself (the settings function is the only way).
    await expect(
      withFirm(id, (tx) =>
        tx.execute(
          sql`update firms set settings = jsonb_set(settings, '{webhook,signing_version}', '0') where id = ${id}`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});

describe("the Integrations page's webhook", () => {
  it("adding shows the secret once (derived, never stored), logs the keys only, and the page shows a hint", async () => {
    const t = await webhookFirm({ webhook: false });
    const added = await addWebhook(t.ctx(), { address: `  ${t.url}  ` });
    expect(added).toEqual({
      status: "added",
      secret: signingSecret(SECRET, t.f.firmId, 1),
      hint: `https://${new URL(t.url).hostname}/…k3F9`,
    });
    expect(await addWebhook(t.ctx(), { address: t.url })).toEqual({ status: "unchanged" });
    const settings = JSON.stringify(await settingsOf(t.f.firmId));
    expect(settings).not.toContain("whsec_");
    expect(await logged(t.f.firmId, "firm.settings_changed")).toEqual([
      {
        entity_type: "firm",
        entity_id: t.f.firmId,
        data: {
          by: "firm",
          keys: ["webhook.url", "webhook.signing_version"],
          webhook: "added",
          from: { "webhook.signing_version": 0 },
          to: { "webhook.signing_version": 1 },
        },
      },
    ]);
    // Nowhere in the log: not the address, its path or the secret.
    const { rows } = await su.query<{ all: string }>(
      "select coalesce(string_agg(data::text, ' '), '') as all from events where firm_id = $1",
      [t.f.firmId],
    );
    expect(rows[0]?.all).not.toContain("hooks.example");
    expect(rows[0]?.all).not.toContain(PATH_SECRET);
    // The firm's data export keeps the address's hint only, as the page shows it (a secret).
    const exported = JSON.stringify(await withFirm(t.f.firmId, (tx) => collectFirmData(tx, NOW)));
    expect(exported).not.toContain(PATH_SECRET);
    expect(exported).toContain(`"url":"https://${new URL(t.url).hostname}/…k3F9"`);
    const page = await integrationsPage({ ...t.ctx() });
    expect(page?.webhook).toEqual({
      hint: `https://${new URL(t.url).hostname}/…k3F9`,
      status: { kind: "new" },
    });
  });

  it("a new signing secret stops the old one; removing stops new deliveries; each logged", async () => {
    const t = await webhookFirm();
    const renewed = await renewSigningSecret(t.ctx());
    expect(renewed).toEqual({ status: "renewed", secret: signingSecret(SECRET, t.f.firmId, 2) });
    expect(renewed.status === "renewed" && renewed.secret).not.toBe(t.secret);
    await takenBooking(t);
    expect(await deliveries(t.f.firmId)).toHaveLength(1);
    // The delivery queued before removal finds no address: nothing sent, nothing logged.
    expect(await removeWebhook(t.ctx())).toEqual({ status: "removed" });
    expect(await removeWebhook(t.ctx())).toEqual({ status: "no_webhook" });
    const [queued] = await deliveries(t.f.firmId);
    if (!queued) throw new Error("no delivery");
    const fake = fakeTransport();
    expect(await deliver(queued, fake.transport)).toMatchObject({
      status: "completed",
      output: { status: "no_webhook" },
    });
    expect(fake.sent).toEqual([]);
    // New bookings queue nothing.
    await takenBooking(t);
    expect(await deliveries(t.f.firmId)).toHaveLength(1);
    expect((await logged(t.f.firmId, "firm.settings_changed")).map((e) => e.data.webhook)).toEqual([
      "added",
      "new_secret",
      "removed",
    ]);
    expect(await renewSigningSecret(t.ctx())).toEqual({ status: "no_webhook" });
    expect(await sendTestWebhook(t.ctx())).toEqual({ status: "no_webhook" });
  });

  it("admins only; Gate B; never ShiftDesk's own addresses or a firm's own domain", async () => {
    const t = await webhookFirm({ webhook: false });
    for (const who of [
      t.resourcer,
      await t.f.office("payroll"),
      await t.f.office("admin", "disabled"),
    ]) {
      expect(await addWebhook(t.ctx(who), { address: t.url })).toEqual({ status: "not_allowed" });
    }
    expect(await addWebhook(t.ctx(t.admin, { localDatabase: false }), { address: t.url })).toEqual({
      status: "agreement_needed",
    });
    for (const [address, problem] of [
      ["http://hooks.example/x", "not_https"],
      ["https://203.0.113.9/x", "ip_address"],
      ["https://[2001:db8::1]/x", "ip_address"],
      ["https://hooks.example:8443/x", "port"],
      ["https://me:pw@hooks.example/x", "credentials"],
      ["https://acme.localhost/x", "ours"],
      ["https://localhost/x", "ours"],
    ] as const) {
      expect(await addWebhook(t.ctx(), { address })).toEqual({ status: "invalid", problem });
    }
    const firmDomain = { ...t.ctx(), resolveDomain: async () => ({ id: "x" }) as never };
    expect(await addWebhook(firmDomain, { address: "https://shifts.firm.example/x" })).toEqual({
      status: "invalid",
      problem: "firm_domain",
    });
    expect((await settingsOf(t.f.firmId)).webhook).toBeUndefined();
    expect(await logged(t.f.firmId, "firm.settings_changed")).toEqual([]);
  });
});

describe("the action log is the outbox: each path queues exactly one delivery", () => {
  it("a casual takes a session", async () => {
    const t = await webhookFirm();
    await takenBooking(t);
    expect(await deliveredActions(t.f.firmId)).toEqual(["shift.assigned"]);
  });

  it("the office assigns someone", async () => {
    const t = await webhookFirm();
    const worker = await t.f.worker();
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(100), role: "steward" });
    expect(await assignWorker(t.office(), shiftId, worker, null)).toMatchObject({
      status: "booked",
    });
    expect(await deliveredActions(t.f.firmId)).toEqual(["shift.assigned"]);
  });

  it("a casual cancels", async () => {
    const t = await webhookFirm();
    const b = await takenBooking(t);
    await cancelMyShift(t.portal(), b.worker, b.shiftId, "Travel problem", saw("notice"));
    expect(await deliveredActions(t.f.firmId)).toEqual(["shift.assigned", "shift.cancelled"]);
  });

  it("the office cancels one booking", async () => {
    const t = await webhookFirm();
    const b = await takenBooking(t);
    expect(await cancelBookingByOffice(t.office(), b.shiftId, b.worker, "other")).toMatchObject({
      status: "cancelled",
    });
    expect(await deliveredActions(t.f.firmId)).toEqual(["shift.assigned", "shift.cancelled"]);
  });

  it("the office cancels a session: one per booking", async () => {
    const t = await webhookFirm();
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(100), role: "steward", headcount: 2 });
    for (const slot of [1, 2]) await t.f.booking(await t.f.worker(), shiftId, "confirmed", slot);
    expect(await cancelShift(t.office(), shiftId, "weather")).toMatchObject({
      status: "cancelled",
      bookings: 2,
    });
    expect(await deliveredActions(t.f.firmId)).toEqual(["shift.cancelled", "shift.cancelled"]);
  });

  it("the planner cancels its session through the API", async () => {
    const t = await webhookFirm();
    const key = await plannerKey(su, t.f.firmId, t.admin);
    const deps = apiDeps({ run: withFirm, resolveKey, now: () => NOW });
    const put = async (body: unknown) =>
      answer(
        await putSessionRequest(
          apiRequest("PUT", "/api/v1/sessions/S-1", { key: key.key, body }),
          "S-1",
          deps,
        ),
      );
    const session = {
      site: { name: "Riverside Arena" },
      role: "steward",
      starts_at: "2026-11-07T08:00:00Z",
      ends_at: "2026-11-07T16:00:00Z",
      places: 2,
    };
    expect((await put(session)).status).toBe(201);
    const { rows } = await su.query<{ id: string }>(
      "select id::text from shifts where firm_id = $1 and external_ref = 'S-1'",
      [t.f.firmId],
    );
    await t.f.booking(await t.f.worker(), rows[0]?.id ?? "", "confirmed", 1);
    expect(
      (await put({ ...session, status: "cancelled", change_reason: "event_cancelled" })).status,
    ).toBe(200);
    expect(await deliveredActions(t.f.firmId)).toEqual(["shift.cancelled"]);
  });

  it("the office withdraws a strike", async () => {
    const t = await webhookFirm();
    const b = await takenBooking(t, 20);
    expect(
      await cancelMyShift(t.portal(later(1)), b.worker, b.shiftId, "Travel problem", saw("strike")),
    ).toMatchObject({
      status: "cancelled",
      strike: expect.anything(),
    });
    expect(
      await withdrawStrike(t.office(later(2)), b.bookingId, "Their train was cancelled"),
    ).toEqual({
      status: "withdrawn",
    });
    expect(await deliveredActions(t.f.firmId)).toEqual([
      "shift.assigned",
      "shift.cancelled",
      "strike.withdrawn",
    ]);
  });

  it("the rota sheet books a name and takes one off", async () => {
    const slug = uniqueSlug("w");
    const { rows } = await su.query<{ id: string }>(
      "insert into firms (name, slug, sector) values ($1, $2, 'rail') returning id::text as id",
      [`Webhook Sheet ${slug}`, slug],
    );
    const firmId = rows[0]?.id ?? "";
    const sheetId = `test_${randomBytes(30).toString("base64url")}`.slice(0, 44);
    await su.query(
      "insert into roster_sources (firm_id, kind, spreadsheet_id, mapping) values ($1, 'sheets', $2, $3)",
      [firmId, sheetId, JSON.stringify(DEFAULT_SHEET_MAPPING)],
    );
    await su.query(
      "insert into credential_rules (firm_id, sector, role, required_types) values ($1, 'rail', 'track_operative', '{}')",
      [firmId],
    );
    const fake = new FakeSheets();
    fake.create(sheetId, {
      Staff: [
        STAFF_HEADER,
        staffRow({
          ref: "N001",
          first: "Ada",
          last: "Example",
          mobile: "07700 900301",
          roles: "track_operative",
        }),
      ],
      Shifts: [
        SHIFT_HEADER,
        shiftRow({
          ref: "P1",
          date: "07/11/2026",
          start: "22:00",
          end: "06:00",
          role: "Track Operative",
          needed: "1",
          assigned: "",
        }),
      ],
    });
    const sync = (when: Date) =>
      syncSheet({ run: withFirm, firmId, client: fake, clock: at(when) });
    expect((await sync(NOW)).status).toBe("synced");
    await withFirm(firmId, (tx) =>
      tx.execute(sql`select app_set_firm_setting('webhook.url', 'https://hooks.example/sheet')`),
    );
    fake.setCell(sheetId, "Shifts", 2, "Assigned", "N001");
    expect(await sync(later(1))).toMatchObject({ booked: 1 });
    expect(await deliveredActions(firmId)).toEqual(["shift.assigned"]);
    fake.setCell(sheetId, "Shifts", 2, "Assigned", "");
    expect(await sync(later(2))).toMatchObject({ cancelled: 1 });
    expect(await deliveredActions(firmId)).toEqual(["shift.assigned", "shift.cancelled"]);
  });

  it("none after a rollback, none without an address, and recordEvents() refuses these actions", async () => {
    const t = await webhookFirm();
    const b = await takenBooking(t);
    expect(await deliveries(t.f.firmId)).toHaveLength(1);
    await expect(
      withFirm(t.f.firmId, async (tx) => {
        await recordEvent(tx, {
          actorType: "system",
          action: "shift.cancelled",
          entityType: "assignment",
          entityId: b.bookingId,
        });
        throw new Error("rolled back");
      }),
    ).rejects.toThrow(/rolled back/);
    expect(await deliveries(t.f.firmId)).toHaveLength(1);
    for (const action of ["shift.assigned", "shift.cancelled", "strike.withdrawn"]) {
      await expect(
        withFirm(t.f.firmId, (tx) =>
          recordEvents(tx, [
            { actorType: "system", action, entityType: "assignment", entityId: b.bookingId },
          ]),
        ),
      ).rejects.toThrow(/recordEvents can't write/);
    }
    const none = await webhookFirm({ webhook: false });
    await takenBooking(none);
    expect(await deliveries(none.f.firmId)).toEqual([]);
  });
});

describe("delivering", () => {
  it("a 2xx: one signed POST to the firm's address, its schema's body, logged webhook.delivered", async () => {
    const t = await webhookFirm();
    const b = await takenBooking(t);
    const [job] = await deliveries(t.f.firmId);
    if (!job?.data.logEntryId) throw new Error("no delivery");
    const fake = fakeTransport();
    expect(await deliver(job, fake.transport)).toMatchObject({
      status: "completed",
      output: { status: "delivered", type: "booking.created" },
    });
    const [sent] = fake.sent;
    if (!sent || !t.secret) throw new Error("nothing sent");
    expect(sent.url).toBe(t.url);
    const eventRef = webhookEventId(SECRET, t.f.firmId, job.data.logEntryId);
    expect(sent.headers).toMatchObject({
      "webhook-id": eventRef,
      "webhook-timestamp": String(NOW.getTime() / 1000),
      "content-type": "application/json",
      "user-agent": WEBHOOK_USER_AGENT,
    });
    // A receiver checks it with the secret the admin was shown.
    expect(
      verifySignature(
        keyFromSigningSecret(t.secret),
        {
          id: sent.headers["webhook-id"] ?? "",
          timestamp: sent.headers["webhook-timestamp"] ?? "",
          signature: sent.headers["webhook-signature"] ?? "",
        },
        sent.body,
        NOW.getTime() / 1000,
      ),
    ).toBe(true);
    const body = WEBHOOK_SCHEMAS["booking.created"].parse(JSON.parse(sent.body));
    expect(body).toMatchObject({
      id: eventRef,
      type: "booking.created",
      firm: { id: t.f.firmId },
      data: { booking: { id: b.bookingId, status: "booked", booked_by: "casual" } },
    });
    expect(await logged(t.f.firmId, "webhook.delivered")).toEqual([
      {
        entity_type: "assignment",
        entity_id: b.bookingId,
        data: { eventRef, bookingId: b.bookingId, type: "booking.created" },
      },
    ]);
    // The same delivery again (pg-boss's at-least-once): the same webhook-id.
    const again = fakeTransport();
    await deliver(job, again.transport);
    expect(again.sent[0]?.headers["webhook-id"]).toBe(eventRef);
  });

  it("each casual quick reason reads casual_own_reason; a cancellation's data is GET /cancellations' record", async () => {
    const t = await webhookFirm();
    const reasons = [...CANCEL_REASONS, "Something else: my car broke down"];
    for (const reason of reasons) {
      const b = await takenBooking(t);
      await cancelMyShift(t.portal(), b.worker, b.shiftId, reason, saw("notice"));
    }
    const fake = fakeTransport();
    for (const job of await deliveries(t.f.firmId)) await deliver(job, fake.transport);
    const cancelled = fake.sent
      .map((s) => JSON.parse(s.body) as { type: string })
      .filter((b) => b.type === "booking.cancelled")
      .map((b) => WEBHOOK_SCHEMAS["booking.cancelled"].parse(b));
    expect(cancelled).toHaveLength(4);
    const page = await withFirm(t.f.firmId, (tx) =>
      cancellationPage(tx, { from: "since", since: new Date(0) }, NOW),
    );
    for (const body of cancelled) {
      expect(body.data.booking.cancellation.reason_code).toBe("casual_own_reason");
      expect(body.data).toEqual(page.records.find((r) => r.booking.id === body.data.booking.id));
    }
    const all = fake.sent.map((s) => s.body).join("\n");
    expect(all).not.toMatch(/unwell|health|car broke|Travel problem|Family/i);
    expect(all).not.toMatch(/\+44|07700|@/);
  });

  it("real bodies: a casual's cancel at 15 hours, the office's of one booking, the planner's of the session, an erasure", async () => {
    const t = await webhookFirm();
    const key = await plannerKey(su, t.f.firmId, t.admin);
    let now = NOW;
    const deps = apiDeps({ run: withFirm, resolveKey, now: () => now });
    const put = async (body: unknown) =>
      answer(
        await putSessionRequest(
          apiRequest("PUT", "/api/v1/sessions/RACE-STW-1", { key: key.key, body }),
          "RACE-STW-1",
          deps,
        ),
      );
    const session = {
      event: { ref: "RACEDAY-2026", name: "Raceday" },
      site: { name: "Acme Demo Racecourse", postcode: "ZZ9 9ZZ" },
      role: "steward",
      starts_at: hoursFromNow(16).toISOString(),
      ends_at: hoursFromNow(24).toISOString(),
      places: 3,
      pay_rate_pence: 1260,
      post: "Gate B",
      meeting_point: "Staff entrance, Gate B",
      uniform: "Black trousers, boots. Hi-vis provided.",
      requirements: ["STEWARD_L2"],
    };
    expect((await put(session)).status).toBe(201);
    const { rows } = await su.query<{ id: string }>(
      "select id::text from shifts where firm_id = $1 and external_ref = 'RACE-STW-1'",
      [t.f.firmId],
    );
    const shiftId = rows[0]?.id ?? "";
    const casual = async (ref: string) => {
      const id = await t.f.worker();
      await su.query("update workers set external_ref = $2 where id = $1", [id, ref]);
      return id;
    };
    const [ann, ben, cal] = [
      await casual("ST-0041"),
      await casual("ST-0042"),
      await casual("ST-0043"),
    ];
    // Ann takes it and cancels 15 hours before the start: a strike. Ben is placed by the office,
    // which then cancels his booking. Cal takes it; then the planner cancels the whole session.
    expect(await takeShift(t.portal(), ann, shiftId)).toMatchObject({ status: "booked" });
    expect(
      await cancelMyShift(t.portal(later(1)), ann, shiftId, "I'm unwell", saw("strike")),
    ).toMatchObject({
      status: "cancelled",
      noticeHours: 15,
      strike: expect.anything(),
    });
    expect(await assignWorker(t.office(), shiftId, ben, null)).toMatchObject({ status: "booked" });
    expect(await cancelBookingByOffice(t.office(later(2)), shiftId, ben, "other")).toMatchObject({
      status: "cancelled",
    });
    expect(await takeShift(t.portal(), cal, shiftId)).toMatchObject({ status: "booked" });
    now = later(3);
    expect(
      (await put({ ...session, status: "cancelled", change_reason: "event_cancelled" })).status,
    ).toBe(200);

    const fake = fakeTransport();
    for (const job of await deliveries(t.f.firmId))
      await deliver(job, fake.transport, { now: later(3) });
    const cancelled = fake.sent
      .map((r) => JSON.parse(r.body) as { type: string })
      .filter((b) => b.type === "booking.cancelled")
      .map((b) => WEBHOOK_SCHEMAS["booking.cancelled"].parse(b));
    const of = (staffRef: string) => {
      const body = cancelled.find((b) => b.data.booking.casual?.staff_ref === staffRef);
      if (!body) throw new Error(`no body for ${staffRef}`);
      return body.data;
    };
    for (const staffRef of ["ST-0041", "ST-0042", "ST-0043"]) {
      const data = of(staffRef);
      expect(data.session).toMatchObject({
        ref: "RACE-STW-1",
        source: "api",
        event: { ref: "RACEDAY-2026", name: "Raceday" },
        site: { name: "Acme Demo Racecourse", postcode: "ZZ9 9ZZ" },
        role: "steward",
        starts_at: session.starts_at.replace(".000Z", "Z"),
        ends_at: session.ends_at.replace(".000Z", "Z"),
        pay_rate_pence: 1260,
        post: "Gate B",
        meeting_point: "Staff entrance, Gate B",
        uniform: "Black trousers, boots. Hi-vis provided.",
        requirements: ["STEWARD_L2"],
      });
      expect(data.booking.ref).toBe(data.booking.id.slice(0, 8).toUpperCase());
      expect(data.booking.casual).toMatchObject({
        staff_ref: staffRef,
        first_name: "Sam",
        last_name: "Booker",
      });
    }
    expect(of("ST-0041").booking.cancellation).toEqual({
      at: later(1).toISOString().replace(".000Z", "Z"),
      by: "casual",
      via: "app",
      notice_hours: 15,
      reason_code: "casual_own_reason",
      strike: { status: "issued", live_strikes: 1 },
    });
    expect(of("ST-0042").booking).toMatchObject({
      booked_by: "office",
      cancellation: {
        by: "office",
        via: "office",
        reason_code: "other",
        strike: { status: "none" },
      },
    });
    expect(of("ST-0043").booking).toMatchObject({
      booked_by: "casual",
      cancellation: {
        by: "planner",
        via: "api",
        reason_code: "event_cancelled",
        strike: { status: "none" },
      },
    });
    const all = fake.sent.map((r) => r.body).join("\n");
    expect(all).not.toMatch(/unwell|health|\+44|07700|@example/i);

    // After Ann's details are erased, her cancellation's body (built when sent) names nobody.
    expect(await eraseWorker(t.office(later(4), t.admin), ann)).toMatchObject({ status: "erased" });
    const again = fakeTransport();
    for (const job of await deliveries(t.f.firmId))
      await deliver(job, again.transport, { now: later(4) });
    const erased = again.sent
      .map((r) => WEBHOOK_SCHEMAS["booking.cancelled"].safeParse(JSON.parse(r.body)))
      .flatMap((p) => (p.success ? [p.data.data.booking] : []))
      .filter((b) => b.casual === null);
    expect(erased.length).toBeGreaterThan(0);
    for (const b of erased) expect(b).toMatchObject({ casual: null, erased: true });
    expect(again.sent.map((r) => r.body).join("\n")).not.toContain("ST-0041");
  });

  it("firm B never receives firm A's events: a job naming A's entry under B finds nothing", async () => {
    const a = await webhookFirm();
    const b = await webhookFirm();
    await takenBooking(a);
    expect(await deliveries(b.f.firmId)).toEqual([]);
    const [job] = await deliveries(a.f.firmId);
    if (!job?.data.logEntryId) throw new Error("no delivery");
    const forged = {
      id: job.id,
      data: { ...job.data, firmId: b.f.firmId },
    };
    const fake = fakeTransport();
    expect(await deliver(forged, fake.transport)).toMatchObject({
      status: "completed",
      output: { status: "gone" },
    });
    expect(fake.sent).toEqual([]);
    await deliver(job, fake.transport);
    expect(fake.sent.map((s) => s.url)).toEqual([a.url]);
  });

  it("a failure throws for a retry, logging nothing; the last try logs webhook.failed once and completes", async () => {
    const t = await webhookFirm();
    const b = await takenBooking(t);
    const [job] = await deliveries(t.f.firmId);
    if (!job) throw new Error("no delivery");
    const fake = fakeTransport({ fail: "http_500" });
    const kept = keptLog();
    const run = (retryCount: number) =>
      runFirmTask(
        deliverTask(fake.transport, NOW, kept.logger),
        { ...job, retryCount, retryLimit: WEBHOOK_RETRY_LIMIT },
        withFirm,
        kept.logger,
      );
    for (let i = 0; i < WEBHOOK_RETRY_LIMIT; i++) {
      expect(await run(i)).toMatchObject({
        status: "failed",
        output: { error: "handler_failed", code: "WebhookSendError" },
      });
    }
    expect(await logged(t.f.firmId, "webhook.failed")).toEqual([]);
    expect(await run(WEBHOOK_RETRY_LIMIT)).toMatchObject({
      status: "completed",
      output: { status: "failed", code: "http_500" },
    });
    expect(await logged(t.f.firmId, "webhook.failed")).toEqual([
      {
        entity_type: "assignment",
        entity_id: b.bookingId,
        data: {
          eventRef: expect.stringMatching(/^evt_[A-Za-z]{22}$/),
          bookingId: b.bookingId,
          type: "booking.created",
          code: "http_500",
        },
      },
    ]);
    // Not the address's path, anywhere in what was logged or kept.
    expect(JSON.stringify(kept.lines)).not.toContain(PATH_SECRET);
    expect(JSON.stringify(kept.lines)).toContain(new URL(t.url).hostname);
  });

  it("the test event: a test.ping delivery, logged on the firm", async () => {
    const t = await webhookFirm();
    expect(await sendTestWebhook(t.ctx())).toEqual({ status: "queued" });
    expect(await sendTestWebhook(t.ctx(t.resourcer))).toEqual({ status: "not_allowed" });
    // Pressed again straight away: nothing more queued (one every 30 seconds per firm).
    expect(await sendTestWebhook(t.ctx())).toEqual({ status: "too_soon" });
    expect(await deliveries(t.f.firmId)).toHaveLength(1);
    const [job] = await deliveries(t.f.firmId);
    if (!job) throw new Error("no delivery");
    const fake = fakeTransport();
    expect(await deliver(job, fake.transport)).toMatchObject({
      output: { status: "delivered", type: "test.ping" },
    });
    expect(
      WEBHOOK_SCHEMAS["test.ping"].parse(JSON.parse(fake.sent[0]?.body ?? "{}")),
    ).toMatchObject({
      type: "test.ping",
      firm: { id: t.f.firmId },
    });
    expect(await logged(t.f.firmId, "webhook.delivered")).toEqual([
      {
        entity_type: "firm",
        entity_id: t.f.firmId,
        data: { eventRef: expect.stringMatching(/^evt_/), type: "test.ping" },
      },
    ]);
  });
});

describe("what the office sees", () => {
  it("the record's planner line, the page's status and Needs attention follow the log", async () => {
    const t = await webhookFirm();
    const none = await webhookFirm({ webhook: false });
    const record = async (firm: WebhookFirm, bookingId: string) => {
      const found = await withFirm(firm.f.firmId, (tx) =>
        loadCancellationRecord(tx, bookingId, NOW),
      );
      if (found?.status !== "found") throw new Error("no record");
      return plannerText(found.record.row.planner, "Europe/London");
    };
    const needs = (firm: WebhookFirm) =>
      withFirm(firm.f.firmId, (tx) => loadNeedsAttention(tx, NOW, "Europe/London"));

    const n = await takenBooking(none);
    await cancelMyShift(none.portal(), n.worker, n.shiftId, "Travel problem", saw("notice"));
    expect(await record(none, n.bookingId)).toBe("No webhook set up");

    const ok = await takenBooking(t);
    await cancelMyShift(t.portal(), ok.worker, ok.shiftId, "Travel problem", saw("notice"));
    expect(await record(t, ok.bookingId)).toBe("Sending");
    for (const job of await deliveries(t.f.firmId)) await deliver(job, fakeTransport().transport);
    expect(await record(t, ok.bookingId)).toMatch(/^Sent to your planner at \d\d:\d\d on /);
    expect((await withFirm(t.f.firmId, webhookStatus)).status).toMatchObject({ kind: "working" });
    expect((await needs(t)).webhookFailing).toBeNull();

    const bad = await takenBooking(t);
    await cancelMyShift(t.portal(), bad.worker, bad.shiftId, "Travel problem", saw("notice"));
    const failing = fakeTransport({ fail: "timeout" });
    const [, , created, cancel] = await deliveries(t.f.firmId);
    for (const job of [created, cancel]) {
      if (job) await deliver(job, failing.transport, { retryCount: WEBHOOK_RETRY_LIMIT });
    }
    expect(await record(t, bad.bookingId)).toMatch(
      /^Couldn't reach your planner \(gave up at \d\d:\d\d on /,
    );
    const status = (await withFirm(t.f.firmId, webhookStatus)).status;
    expect(status.kind).toBe("failing");
    const items = await needs(t);
    expect(items.webhookFailing).not.toBeNull();
    // One item (beside the others this firm has: its strikes team's address isn't set).
    expect(needsCount(items).count).toBe(needsCount({ ...items, webhookFailing: null }).count + 1);
    // A delivery that works again clears it.
    expect(await sendTestWebhook(t.ctx())).toEqual({ status: "queued" });
    const test = (await deliveries(t.f.firmId)).at(-1);
    if (test) await deliver(test, fakeTransport().transport);
    expect((await needs(t)).webhookFailing).toBeNull();
    // A new address starts again.
    await addWebhook(t.ctx(), { address: "https://other.hooks.example/x" });
    expect((await withFirm(t.f.firmId, webhookStatus)).status).toEqual({ kind: "new" });
  });
});

describe("through a real pg-boss worker", () => {
  let boss: PgBoss;
  beforeAll(async () => {
    boss = createBoss(urls.jobs);
    await boss.start();
    await ensureQueues(
      boss,
      QUEUES.filter((q) => q.name === WEBHOOK_DELIVER_QUEUE),
    );
  });
  afterAll(async () => {
    await boss.stop({ graceful: false });
  });

  // No waiting between tries in a test: the queue's own waits (a minute, doubling) are in queues.ts.
  const noWaits = (firmId: string) =>
    su.query(
      `update pgboss.job set retry_delay = 0, retry_backoff = false, retry_delay_max = null
        where name = $1 and data ->> 'firmId' = $2`,
      [WEBHOOK_DELIVER_QUEUE, firmId],
    );
  const until = async (check: () => Promise<boolean>, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  it("the queue's own retries, then the last try logs once, raises one item and leaves no failed job", async () => {
    expect(QUEUES.find((q) => q.name === WEBHOOK_DELIVER_QUEUE)?.options).toMatchObject({
      retryLimit: 6,
      retryDelay: 60,
      retryBackoff: true,
      retryDelayMax: 1800,
    });
    const t = await webhookFirm();
    await takenBooking(t);
    await noWaits(t.f.firmId);
    const failedBefore =
      (await failedJobCounts(boss)).find((c) => c.queue === WEBHOOK_DELIVER_QUEUE)?.count ?? 0;
    const fake = fakeTransport({ fail: "http_500" });
    const mine = deliverTask(fake.transport, new Date());
    const workId = await boss.work(
      WEBHOOK_DELIVER_QUEUE,
      { ...WEBHOOK_WORK_OPTIONS, pollingIntervalSeconds: 0.5 },
      (jobs) => inOrder(jobs, (j) => runFirmTask(mine, j, withFirm, keptLog().logger)),
    );
    try {
      expect(
        await until(async () => (await logged(t.f.firmId, "webhook.failed")).length > 0, 45_000),
      ).toBe(true);
    } finally {
      await boss.offWork(WEBHOOK_DELIVER_QUEUE, { id: workId });
    }
    // This firm's tries (the worker also takes what earlier tests here left queued).
    expect(fake.sent.filter((r) => r.url === t.url)).toHaveLength(WEBHOOK_RETRY_LIMIT + 1);
    expect(await logged(t.f.firmId, "webhook.failed")).toHaveLength(1);
    const { rows } = await su.query<{ state: string }>(
      "select state from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [WEBHOOK_DELIVER_QUEUE, t.f.firmId],
    );
    expect(rows.map((r) => r.state)).toEqual(["completed"]);
    expect(
      (await failedJobCounts(boss)).find((c) => c.queue === WEBHOOK_DELIVER_QUEUE)?.count ?? 0,
    ).toBe(failedBefore);
    const items = await withFirm(t.f.firmId, (tx) => loadNeedsAttention(tx, NOW, "Europe/London"));
    expect(items.webhookFailing).not.toBeNull();
    expect(needsCount(items).count).toBe(needsCount({ ...items, webhookFailing: null }).count + 1);
  }, 60_000);

  it("with firm A's endpoint hanging, firm B's webhook is still delivered within 5 seconds", async () => {
    const a = await webhookFirm();
    const b = await webhookFirm();
    let release: () => void = () => undefined;
    const hung = new Promise<void>((resolve) => (release = resolve));
    const sentTo: string[] = [];
    const transport: WebhookTransport = {
      name: "fake",
      async send(r) {
        sentTo.push(r.url);
        if (r.url === a.url) await hung;
      },
    };
    const mine = deliverTask(transport, new Date());
    const workId = await boss.work(
      WEBHOOK_DELIVER_QUEUE,
      { ...WEBHOOK_WORK_OPTIONS, pollingIntervalSeconds: 0.5 },
      (jobs) => inOrder(jobs, (j) => runFirmTask(mine, j, withFirm, keptLog().logger)),
    );
    try {
      // A's three first (all in one group: one runs, two wait), then B's.
      for (let i = 0; i < 3; i++) await takenBooking(a);
      await takenBooking(b);
      expect(
        await until(
          async () => (await logged(b.f.firmId, "webhook.delivered")).length === 1,
          5_000,
        ),
      ).toBe(true);
      // Only one of A's ran at a time: the others wait behind the hanging one.
      expect(sentTo.filter((u) => u === a.url)).toHaveLength(1);
    } finally {
      release();
      await until(async () => (await logged(a.f.firmId, "webhook.delivered")).length === 3, 10_000);
      await boss.offWork(WEBHOOK_DELIVER_QUEUE, { id: workId });
    }
  }, 30_000);
});
