import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { apiKeyHash, apiKeyHint, API_KEY_PREFIX } from "../../integrations/keys";
import { addDays, localDateOf, zonedToUtc } from "../../time/zoned";
import { apiKeys, assignments, metricsDaily, shiftEvents, shifts } from "../schema";
import type { FirmTx } from "../scoped";
import { seedId, type SeedFirm } from "./seed-data";
import type { SeedLog } from "./seed-log";
import { acmePilotFigures } from "./seed-pilot";

// Two more parts of Acme's demo (Phase 37.8, w1-12; docs/testing.md "Fixtures and the demo seed"):
//
// On the demo server only (seed()'s demoMode "on"):
// - The pilot's own figures (seed-pilot.ts): saved as the office saves them
//   (src/lib/metrics/entry.ts), each row dated its save and logged then, added once.
// - A "Demo planner" API key, one event it sent
//   ("Northgate Demo Fun Run", 9 days ahead, three sessions: "· From your planner"), two of them
//   booked by casuals in the app, each logged as the planner API and the app log them; and, when
//   the demo-reset service has INTEGRATIONS_SECRET (seed()'s `webhook`), its webhook: the
//   address set three days ago by the admin, a delivery that failed and the one that went after it
//   (setDemoWebhook writes the address and its status after the log, so no seeded booking queues
//   a real delivery). The key itself is random, never stored or shown: nobody can use it.

const TZ = "Europe/London";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const id = (what: string) => seedId(`acme/demo-planner/${what}`);
export const DEMO_PLANNER_LABEL = "Demo planner";
export const DEMO_PLANNER_REF = "DEMO-PLANNER-FUN-RUN";
export const DEMO_WEBHOOK_URL = "https://planner.example/hooks/acme-demo-k3F9";
// Casuals with a worked history (seed-history.ts) that no browser test uses.
const PLANNER_BOOKERS = [21, 24];
// When a delivery's last try fails: the webhook queue's retries (src/worker/jobs/queues.ts:
// retryLimit 6, retryDelay 60, retryBackoff, retryDelayMax 1800) wait 60 + 120 + 240 + 480 + 960 +
// 1800 seconds, 61 minutes in all.
const WEBHOOK_LAST_TRY_AFTER = 61 * 60_000;

const adminOf = (firm: SeedFirm) => {
  const admin = firm.officeUsers.find((u) => u.role === "admin");
  if (!admin) throw new Error(`${firm.slug} has no admin`);
  return admin.id;
};

export async function loadPilotFigures(
  tx: FirmTx,
  firm: SeedFirm,
  now: Date,
  log: SeedLog,
): Promise<void> {
  for (const save of acmePilotFigures(now, adminOf(firm))) {
    const added = await tx
      .insert(metricsDaily)
      .values(
        save.figures.map((f) => ({
          firmId: firm.id,
          day: save.weekStart,
          kind: save.kind,
          metric: f.metric,
          value: f.value.toFixed(2),
          recordedBy: save.recordedBy,
          updatedAt: save.savedAt,
          createdAt: save.savedAt,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: metricsDaily.id });
    if (added.length === 0) continue;
    log.add(
      {
        actorType: "office",
        actorId: save.recordedBy,
        action: save.kind === "baseline" ? "metrics.baseline_saved" : "metrics.tally_saved",
        entityType: "firm",
        entityId: firm.id,
        data: { weekStart: save.weekStart, figures: save.figures },
      },
      save.savedAt,
    );
  }
}

export interface DemoPlanner {
  webhook: boolean;
  addressSetAt: Date;
  lastDeliveredAt: Date | null;
}

const at = (date: string, time: string) => {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return zonedToUtc({ year, month, day, hour, minute }, TZ);
};

export async function loadDemoPlanner(
  tx: FirmTx,
  firm: SeedFirm,
  now: Date,
  log: SeedLog,
  o: { webhook: boolean },
): Promise<DemoPlanner | null> {
  const admin = adminOf(firm);
  const keyId = id("key");
  const created = new Date(now.getTime() - 3 * DAY);
  // A random key, never kept: only its hash and last 4 characters, as the office's "Make a key".
  const token = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [key] = await tx
    .insert(apiKeys)
    .values({
      id: keyId,
      firmId: firm.id,
      label: DEMO_PLANNER_LABEL,
      tokenHash: apiKeyHash(token),
      hint: apiKeyHint(token),
      createdBy: admin,
      lastUsedAt: new Date(now.getTime() - 2 * HOUR),
      createdAt: created,
    })
    .onConflictDoNothing()
    .returning({ id: apiKeys.id });
  if (!key) return null; // already there: a re-run adds nothing
  log.add(
    {
      actorType: "office",
      actorId: admin,
      action: "api_key.created",
      entityType: "api_key",
      entityId: keyId,
      data: { keyId },
    },
    created,
  );

  // The planner's event and its three sessions, sent an hour after the key was made.
  const sentAt = new Date(created.getTime() + HOUR);
  const day = addDays(localDateOf(now, TZ), 9);
  const eventId = id("event");
  await tx.insert(shiftEvents).values({
    id: eventId,
    firmId: firm.id,
    name: "Northgate Demo Fun Run",
    siteId: seedId("acme/story/site/northgate"),
    source: "api",
    plannerRef: DEMO_PLANNER_REF,
    createdAt: sentAt,
  });
  const marks = { by: "firm", via: "api", keyId };
  const sessions = [
    { n: 1, start: "08:00", end: "14:00" },
    { n: 2, start: "08:00", end: "14:00" },
    { n: 3, start: "12:00", end: "18:00" },
  ].map((s) => ({
    id: id(`shift/${s.n}`),
    firmId: firm.id,
    shiftEventId: eventId,
    siteId: seedId("acme/story/site/northgate"),
    role: "steward",
    startsAt: at(day, s.start),
    endsAt: at(day, s.end),
    headcount: 1,
    status: s.n <= PLANNER_BOOKERS.length ? ("filled" as const) : ("open" as const),
    source: "api" as const,
    externalRef: `${DEMO_PLANNER_REF}-${s.n}`,
    instructions: "Route marshal. Collect a hi-vis and a radio at the start line.",
    payRatePence: 1300,
    createdAt: sentAt,
  }));
  await tx.insert(shifts).values(sessions);
  for (const s of sessions) {
    log.add(
      {
        actorType: "system",
        action: "shift.created",
        entityType: "shift",
        entityId: s.id,
        data: marks,
      },
      sentAt,
    );
  }

  // Two casuals booked in the app a day later.
  const bookings = PLANNER_BOOKERS.map((i, k) => {
    const worker = firm.workers[i];
    const session = sessions[k];
    if (!worker || !session) throw new Error(`no worker ${i} or session for the planner`);
    const confirmedAt = new Date(created.getTime() + DAY + k * HOUR);
    return { id: id(`booking/${k + 1}`), worker: worker.id, session, confirmedAt };
  });
  await tx.insert(assignments).values(
    bookings.map((b) => ({
      id: b.id,
      firmId: firm.id,
      shiftId: b.session.id,
      slot: 1,
      workerId: b.worker,
      status: "confirmed" as const,
      confirmedAt: b.confirmedAt,
      bookedVia: "app" as const,
      createdAt: b.confirmedAt,
    })),
  );
  const refs = bookings.map((b) =>
    log.add(
      {
        actorType: "worker",
        actorId: b.worker,
        action: "shift.assigned",
        entityType: "assignment",
        entityId: b.id,
        data: {
          by: "worker",
          shiftId: b.session.id,
          workerId: b.worker,
          slot: 1,
          noticeHours:
            Math.round(((b.session.startsAt.getTime() - b.confirmedAt.getTime()) / HOUR) * 100) /
            100,
        },
      },
      b.confirmedAt,
    ),
  );
  if (!o.webhook) return { webhook: false, addressSetAt: created, lastDeliveredAt: null };

  // The webhook, added by the admin as the office logs it (src/lib/office/webhook-settings.ts),
  // before the bookings. As the delivery job logs it (src/lib/integrations/deliver.ts): the first
  // booking's delivery timed out on every try and was logged failed on its last, about an hour
  // later (WEBHOOK_LAST_TRY_AFTER), with nothing sent for it after; the second booking's, a few
  // minutes after that, went, so the webhook is working again.
  const addressSetAt = new Date(created.getTime() + 30 * 60_000);
  log.add(
    {
      actorType: "office",
      actorId: admin,
      action: "firm.settings_changed",
      entityType: "firm",
      entityId: firm.id,
      data: {
        by: "firm",
        keys: ["webhook.url", "webhook.signing_version"],
        webhook: "added",
        from: { "webhook.signing_version": 0 },
        to: { "webhook.signing_version": 1 },
      },
    },
    addressSetAt,
  );
  let lastDeliveredAt: Date | null = null;
  let failedAt: Date | null = null;
  bookings.forEach((b, k) => {
    const eventRef = refs[k];
    if (!eventRef) return;
    const data = { eventRef, bookingId: b.id, type: "booking.created" };
    if (k === 0) {
      failedAt = new Date(b.confirmedAt.getTime() + WEBHOOK_LAST_TRY_AFTER);
      log.add(
        {
          actorType: "system",
          action: "webhook.failed",
          entityType: "assignment",
          entityId: b.id,
          data: { ...data, code: "timeout" },
        },
        failedAt,
      );
      return;
    }
    const delivered = new Date(b.confirmedAt.getTime() + 5 * 60_000);
    log.add(
      {
        actorType: "system",
        action: "webhook.delivered",
        entityType: "assignment",
        entityId: b.id,
        data,
      },
      delivered,
    );
    if (!lastDeliveredAt || delivered > lastDeliveredAt) lastDeliveredAt = delivered;
  });
  // A delivery that worked after the failure: working, not failing (status.ts).
  if (!lastDeliveredAt || !failedAt || lastDeliveredAt <= failedAt) {
    throw new Error("the demo webhook's last delivery must come after its failure");
  }
  return { webhook: true, addressSetAt, lastDeliveredAt };
}

// After the log is written: the address (app_set_firm_setting, as the office's own save) and how
// its deliveries are going.
export async function setDemoWebhook(tx: FirmTx, planner: DemoPlanner): Promise<void> {
  if (!planner.webhook) return;
  await tx.execute(sql`select app_set_firm_setting('webhook.url', ${DEMO_WEBHOOK_URL})`);
  await tx.execute(sql`
    insert into webhook_status (firm_id, address_set_at, last_delivered_at, failing_since)
    values (app_current_firm_id(), ${planner.addressSetAt.toISOString()}::timestamptz,
            ${planner.lastDeliveredAt?.toISOString() ?? null}::timestamptz, null)
    on conflict (firm_id) do update
      set address_set_at = excluded.address_set_at, last_delivered_at = excluded.last_delivered_at,
          failing_since = null, updated_at = now()`);
}
