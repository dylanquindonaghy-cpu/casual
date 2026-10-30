import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { uniqueSlug } from "./db";

// One row in every firm table for a new test firm, inserted as the superuser (bypassing RLS),
// plus builders for fresh rows. Used by tenancy.isolation and rls.mutation. A table without an
// entry here fails those tests by name, so a new table can't be left untested.

export const EXPECTED_TABLES = [
  "api_keys",
  "assignments",
  "auth_throttle",
  "connector_events",
  "credential_rules",
  "credential_types",
  "credentials",
  "events",
  "firm_secrets",
  "firms",
  "inbound_emails",
  "magic_links",
  "messages",
  "metrics_daily",
  "name_map",
  "offers",
  "office_users",
  "otp_codes",
  "pay_queries",
  "pay_records",
  "push_subscriptions",
  "requests",
  "roster_sources",
  "sessions",
  "sheet_name_problems",
  "shift_events",
  "shift_reminders",
  "shifts",
  "sites",
  "strikes",
  "travel_estimates",
  "uploads",
  "worker_site_blocks",
  "worker_travel",
  "worker_unavailable_days",
  "workers",
] as const;
export type TableName = (typeof EXPECTED_TABLES)[number];

export interface Tenant {
  firmId: string;
  slug: string;
  rows: Record<TableName, string>; // the id of this firm's row in each table
  workerId: string;
  officeUserId: string;
  sessionId: string;
  spareSessionId: string; // a session with no live code, for otp_codes inserts
  // The rota rows point at their own worker and site, not rows.workers / rows.sites: their
  // foreign keys have no ON DELETE action, and the isolation tests delete those two (rolled back).
  rosterWorkerId: string;
  rosterSiteId: string;
}

let seq = 0;
const next = () => (seq += 1);
// Ofcom's drama range only (+447700900000-999), never a real number.
const fakeMobile = () => `+447700900${String(next() % 1000).padStart(3, "0")}`;
const hash = () => randomBytes(32);
// A made-up spreadsheet id in Google's shape (44 url-safe characters). No such sheet exists.
const fakeSpreadsheetId = () => `test_${randomBytes(30).toString("base64url")}`.slice(0, 44);
const later = () => new Date(Date.now() + 60 * 60 * 1000);
// A shift starting tomorrow at 09:00 UTC for 8 hours (the exact time doesn't matter here).
const shiftTimes = () => {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(9, 0, 0, 0);
  return [start, new Date(start.getTime() + 8 * 60 * 60 * 1000)] as const;
};

async function one(pool: Pool, text: string, values: unknown[]): Promise<string> {
  const result = await pool.query<{ id: string }>(`${text} returning id::text as id`, values);
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`fixture insert returned no id: ${text}`);
  return id;
}

export async function createTenant(su: Pool): Promise<Tenant> {
  const slug = uniqueSlug();
  const firmId = await one(
    su,
    "insert into firms (name, slug, sector) values ($1, $2, 'security')",
    [`Test Firm ${slug}`, slug],
  );
  const workerId = await one(
    su,
    "insert into workers (firm_id, first_name, last_name, mobile_e164) values ($1, 'Test', 'Worker', $2)",
    [firmId, fakeMobile()],
  );
  const officeUserId = await one(
    su,
    "insert into office_users (firm_id, email, name, role) values ($1, $2, 'Test Office', 'admin')",
    [firmId, `office${next()}@example.com`],
  );
  const siteId = await one(su, "insert into sites (firm_id, name) values ($1, $2)", [
    firmId,
    `Site ${next()}`,
  ]);
  const credentialId = await one(
    su,
    "insert into credentials (firm_id, worker_id, type) values ($1, $2, 'SIA_DS')",
    [firmId, workerId],
  );
  const eventId = await one(
    su,
    "insert into events (firm_id, actor_type, action, entity_type) values ($1, 'system', 'test.fixture', 'test')",
    [firmId],
  );
  const magicLinkId = await one(
    su,
    `insert into magic_links (firm_id, kind, worker_id, token_hash, request_id, expires_at)
     values ($1, 'worker', $2, $3, $4, $5)`,
    [firmId, workerId, hash(), randomUUID(), later()],
  );
  const session = (kind: "worker" | "office") =>
    one(
      su,
      `insert into sessions (firm_id, kind, worker_id, office_user_id, token_hash, expires_at, rotated_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [
        firmId,
        kind,
        kind === "worker" ? workerId : null,
        kind === "office" ? officeUserId : null,
        hash(),
        later(),
      ],
    );
  const sessionId = await session("worker");
  const spareSessionId = await session("office");
  const otpCodeId = await one(
    su,
    "insert into otp_codes (firm_id, session_id, code_hash, expires_at) values ($1, $2, $3, $4)",
    [firmId, sessionId, hash(), later()],
  );
  const throttleId = await one(
    su,
    "insert into auth_throttle (firm_id, bucket, window_start, hits) values ($1, $2, now(), 1)",
    [firmId, `test:${next()}`],
  );
  const rosterWorkerId = await one(
    su,
    "insert into workers (firm_id, first_name, last_name, mobile_e164, roles) values ($1, 'Rota', 'Worker', $2, '{steward}')",
    [firmId, fakeMobile()],
  );
  const rosterSiteId = await one(su, "insert into sites (firm_id, name) values ($1, $2)", [
    firmId,
    `Rota site ${next()}`,
  ]);
  const credentialRuleId = await one(
    su,
    "insert into credential_rules (firm_id, sector, role, required_types) values ($1, 'security', 'door_supervisor', '{SIA_DS}')",
    [firmId],
  );
  const credentialTypeId = await one(
    su,
    "insert into credential_types (firm_id, code, name, sector, applied_allowed) values ($1, 'SIA_DS', 'SIA door supervisor licence', 'security', true)",
    [firmId],
  );
  // An event with no site: the isolation tests delete rows.sites, and its site link has no ON
  // DELETE action (shift_events_site_fk is tested in FK_CASES).
  const shiftEventId = await one(su, "insert into shift_events (firm_id, name) values ($1, $2)", [
    firmId,
    `Event ${next()}`,
  ]);
  const [startsAt, endsAt] = shiftTimes();
  const shiftId = await one(
    su,
    "insert into shifts (firm_id, event_id, site_id, role, starts_at, ends_at, headcount) values ($1, $2, $3, 'steward', $4, $5, 2)",
    [firmId, shiftEventId, rosterSiteId, startsAt, endsAt],
  );
  const assignmentId = await one(
    su,
    `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
     values ($1, $2, 1, $3, 'confirmed', now())`,
    [firmId, shiftId, rosterWorkerId],
  );
  // A strike on a booking the rota worker cancelled (its own row: rows.assignments stays strike-free
  // for the strikes_assignment_fk case).
  const cancelledId = await one(
    su,
    `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at, cancelled_at,
                              cancel_reason, notice_hours, cancel_via)
     values ($1, $2, 2, $3, 'cancelled_worker', now(), now(), 'Travel problem', 20, 'app')`,
    [firmId, shiftId, rosterWorkerId],
  );
  const strikeId = await one(
    su,
    `insert into strikes (firm_id, worker_id, assignment_id, shift_id, notice_hours, threshold_hours,
                          issued_at, expires_at)
     values ($1, $2, $3, $4, 20, 48, now(), now() + interval '90 days')`,
    [firmId, rosterWorkerId, cancelledId, shiftId],
  );
  const requestId = await one(
    su,
    "insert into requests (firm_id, worker_id, shift_id, type) values ($1, $2, $3, 'time_change')",
    [firmId, rosterWorkerId, shiftId],
  );
  const rosterSourceId = await one(
    su,
    `insert into roster_sources (firm_id, kind, spreadsheet_id, mapping)
     values ($1, 'sheets', $2, '{"version": 1}')`,
    [firmId, fakeSpreadsheetId()],
  );
  // A switched-off connector of its own (one source on per firm: the sheet above), for its event.
  const connectorSourceId = await one(
    su,
    `insert into roster_sources (firm_id, kind, enabled, connector, base_url, mapping)
     values ($1, 'connector', false, 'demo_portal', 'https://portal.example.test/api', '{}')`,
    [firmId],
  );
  const connectorEventId = await one(
    su,
    `insert into connector_events (firm_id, source_id, event_id, type, ref)
     values ($1, $2, 'evt-fixture-1', 'session.changed', 'PORTAL-S1')`,
    [firmId, connectorSourceId],
  );
  const nameMapId = await one(
    su,
    "insert into name_map (firm_id, kind, outside_name, code) values ($1, 'role', 'door supervisor (nlw)', 'door_supervisor')",
    [firmId],
  );
  const sheetNameProblemId = await one(
    su,
    `insert into sheet_name_problems (firm_id, source_id, kind, tab, row, outside_name, shift_id, seen_at)
     values ($1, $2, 'skipped_live', 'shifts', 9, 'Holiday', $3, now())`,
    [firmId, rosterSourceId, shiftId],
  );
  const secretId = await one(
    su,
    `insert into firm_secrets (firm_id, name, ciphertext, nonce, key_id)
     values ($1, 'portal.api_key', $2, $3, 'aaaaaaaaaaaa')`,
    [firmId, randomBytes(32), randomBytes(12)],
  );
  const offerId = await one(
    su,
    "insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, 1, 'push')",
    [firmId, shiftId, rosterWorkerId],
  );
  const unavailableDayId = await one(
    su,
    "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-12-25')",
    [firmId, workerId],
  );
  // No blocked_by: the isolation tests delete this firm's office user (its link is checked by
  // worker_site_blocks_blocked_by_fk below).
  const siteBlockId = await one(
    su,
    `insert into worker_site_blocks (firm_id, worker_id, site_id, reason)
     values ($1, $2, $3, 'client_asked')`,
    [firmId, workerId, siteId],
  );
  const estimateId = await one(
    su,
    `insert into travel_estimates (firm_id, origin_postcode, site_id, mode, arrive_by, minutes,
                                   metres, provider, computed_at, expires_at)
     values ($1, 'ZZ1 1AA', $2, 'car', '2027-01-01T08:30:00Z', 18, 11500, 'fake', now(),
             '2027-01-09T00:00:00Z')`,
    [firmId, siteId],
  );
  const travelId = await one(
    su,
    `insert into worker_travel (firm_id, worker_id, start_postcode, lat, lng, modes, max_minutes,
                                privacy_notice_version, updated_at)
     values ($1, $2, 'ZZ1 1AA', 53.83, -1.53, 'both', 45, 'travel-v1', now())`,
    [firmId, workerId],
  );
  // A staff photo (12F.2): three bytes stand in for the image.
  const uploadId = await one(
    su,
    `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data)
     values ($1, $2, 'photo', 'image/jpeg', 3, encode(sha256('\\xffd8ff'::bytea), 'hex'),
             '\\xffd8ff'::bytea)`,
    [firmId, workerId],
  );
  const pushSubscriptionId = await one(
    su,
    `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
     values ($1, $2, $3, 'test-p256dh', 'test-auth')`,
    [firmId, workerId, `https://push.example.test/${slug}`],
  );
  const shiftReminderId = await one(
    su,
    `insert into shift_reminders (firm_id, assignment_id, kind, starts_at, status, channel)
     values ($1, $2, '24h', now(), 'sent', 'whatsapp')`,
    [firmId, assignmentId],
  );
  // A rollup figure: no office user link (entered figures have one, tested in FK_CASES), so the
  // isolation tests can delete rows.office_users.
  const metricsId = await one(
    su,
    `insert into metrics_daily (firm_id, day, kind, metric, value)
     values ($1, '2026-10-26', 'daily', 'portal_actions', 12)`,
    [firmId],
  );
  // Pay records point at the rota worker too: their worker link has no ON DELETE action.
  const payRecordId = await one(
    su,
    `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence)
     values ($1, $2, '2026-10-26', '2026-11-01', 8, 1250)`,
    [firmId, rosterWorkerId],
  );
  // Pay queries point at the rota worker too (no ON DELETE action), and no shift (the shift link is
  // tested in FK_CASES).
  const payQueryId = await one(
    su,
    `insert into pay_queries (firm_id, worker_id, work_date, issue_type)
     values ($1, $2, '2026-10-26', 'missing_hours')`,
    [firmId, rosterWorkerId],
  );
  // A planner's API key (12J.1), made by an office user of its own: its creator link has no ON
  // DELETE action, and the isolation tests delete rows.office_users. The key maker's access is
  // off since (a key outlives its creator's), so the tenant still has one active admin.
  const apiKeyId = await one(
    su,
    `with u as (insert into office_users (firm_id, email, name, role, status)
                values ($1, $2, 'Key Maker', 'admin', 'disabled') returning id)
     insert into api_keys (firm_id, label, token_hash, hint, created_by)
     select $1, 'Our planner', $3, 'k3F9', u.id from u`,
    [firmId, `key-maker-${next()}@example.com`, hash()],
  );
  // A WhatsApp from the rota worker (no ON DELETE action on its worker link either); the reply
  // link is tested in FK_CASES.
  const messageId = await one(
    su,
    `insert into messages (firm_id, direction, channel, provider_message_id, worker_id, from_e164, to_e164, body)
     values ($1, 'in', 'whatsapp', $2, $3, '+447700900111', '+447700900000', 'shifts')`,
    [firmId, `SM${randomBytes(16).toString("hex")}`, rosterWorkerId],
  );
  // An email from the rota worker to the staffing inbox (P7.1).
  const inboundEmailId = await one(
    su,
    `insert into inbound_emails (firm_id, provider_message_id, worker_id, from_address, to_address, subject, body)
     values ($1, $2, $3, 'rota.worker@example.com', 'staffing@inbound.example.test', 'Saturday', 'Can I swap?')`,
    [firmId, `<${randomBytes(8).toString("hex")}@mail.example.test>`, rosterWorkerId],
  );
  return {
    firmId,
    slug,
    workerId,
    officeUserId,
    sessionId,
    spareSessionId,
    rosterWorkerId,
    rosterSiteId,
    rows: {
      api_keys: apiKeyId,
      firms: firmId,
      workers: workerId,
      office_users: officeUserId,
      sites: siteId,
      credentials: credentialId,
      events: eventId,
      magic_links: magicLinkId,
      sessions: sessionId,
      otp_codes: otpCodeId,
      auth_throttle: throttleId,
      credential_rules: credentialRuleId,
      credential_types: credentialTypeId,
      shift_events: shiftEventId,
      shifts: shiftId,
      assignments: assignmentId,
      requests: requestId,
      offers: offerId,
      roster_sources: rosterSourceId,
      connector_events: connectorEventId,
      firm_secrets: secretId,
      name_map: nameMapId,
      sheet_name_problems: sheetNameProblemId,
      pay_records: payRecordId,
      worker_unavailable_days: unavailableDayId,
      worker_site_blocks: siteBlockId,
      worker_travel: travelId,
      travel_estimates: estimateId,
      uploads: uploadId,
      strikes: strikeId,
      push_subscriptions: pushSubscriptionId,
      shift_reminders: shiftReminderId,
      metrics_daily: metricsId,
      pay_queries: payQueryId,
      messages: messageId,
      inbound_emails: inboundEmailId,
    },
  };
}

export interface Statement {
  text: string;
  values: unknown[];
}

// A fresh, valid row for `table` stamped with firmId and pointing at the parent rows in `p`.
export const INSERTS: Record<TableName, (firmId: string, p: Tenant) => Statement> = {
  firms: () => ({
    text: "insert into firms (name, slug, sector) values ($1, $2, 'security')",
    values: ["Probe Firm", uniqueSlug("p")],
  }),
  workers: (firmId) => ({
    text: "insert into workers (firm_id, first_name, last_name, mobile_e164) values ($1, 'Probe', 'Worker', $2)",
    values: [firmId, fakeMobile()],
  }),
  office_users: (firmId) => ({
    text: "insert into office_users (firm_id, email, name, role) values ($1, $2, 'Probe', 'resourcer')",
    values: [firmId, `probe${next()}@example.com`],
  }),
  sites: (firmId) => ({
    text: "insert into sites (firm_id, name) values ($1, $2)",
    values: [firmId, `Probe site ${next()}`],
  }),
  credentials: (firmId, p) => ({
    text: "insert into credentials (firm_id, worker_id, type) values ($1, $2, 'PTS')",
    values: [firmId, p.workerId],
  }),
  events: (firmId) => ({
    text: "insert into events (firm_id, actor_type, action, entity_type) values ($1, 'system', 'test.probe', 'test')",
    values: [firmId],
  }),
  magic_links: (firmId, p) => ({
    text: `insert into magic_links (firm_id, kind, worker_id, token_hash, request_id, expires_at)
           values ($1, 'worker', $2, $3, $4, $5)`,
    values: [firmId, p.workerId, hash(), randomUUID(), later()],
  }),
  sessions: (firmId, p) => ({
    text: `insert into sessions (firm_id, kind, worker_id, token_hash, expires_at, rotated_at)
           values ($1, 'worker', $2, $3, $4, now())`,
    values: [firmId, p.workerId, hash(), later()],
  }),
  otp_codes: (firmId, p) => ({
    text: "insert into otp_codes (firm_id, session_id, code_hash, expires_at) values ($1, $2, $3, $4)",
    values: [firmId, p.spareSessionId, hash(), later()],
  }),
  auth_throttle: (firmId) => ({
    text: "insert into auth_throttle (firm_id, bucket, window_start, hits) values ($1, $2, now(), 1)",
    values: [firmId, `probe:${next()}`],
  }),
  credential_rules: (firmId) => ({
    text: "insert into credential_rules (firm_id, sector, role, required_types) values ($1, 'rail', $2, '{PTS,SENTINEL}')",
    values: [firmId, `probe_role_${next()}`],
  }),
  credential_types: (firmId) => ({
    text: "insert into credential_types (firm_id, code, name, sector) values ($1, $2, 'Probe card', 'rail')",
    values: [firmId, `PROBE_${next()}`],
  }),
  shift_events: (firmId, p) => ({
    text: "insert into shift_events (firm_id, name, site_id) values ($1, $2, $3)",
    values: [firmId, `Probe event ${next()}`, p.rosterSiteId],
  }),
  shifts: (firmId, p) => ({
    text: "insert into shifts (firm_id, event_id, site_id, role, starts_at, ends_at) values ($1, $2, $3, 'steward', $4, $5)",
    values: [firmId, p.rows.shift_events, p.rosterSiteId, ...shiftTimes()],
  }),
  assignments: (firmId, p) => ({
    text: "insert into assignments (firm_id, shift_id, slot) values ($1, $2, $3)",
    values: [firmId, p.rows.shifts, 1 + next()],
  }),
  requests: (firmId, p) => ({
    text: "insert into requests (firm_id, worker_id, type) values ($1, $2, 'general')",
    values: [firmId, p.rosterWorkerId],
  }),
  // A disabled one: each firm may have only one enabled source (the fixture's).
  roster_sources: (firmId) => ({
    text: `insert into roster_sources (firm_id, kind, enabled, spreadsheet_id, mapping)
           values ($1, 'sheets', false, $2, '{"version": 1}')`,
    values: [firmId, fakeSpreadsheetId()],
  }),
  connector_events: (firmId, p) => ({
    text: `insert into connector_events (firm_id, source_id, event_id, type, ref)
           values ($1, $2, $3, 'staff.changed', 'PORTAL-W1')`,
    values: [firmId, p.rows.roster_sources, `evt-probe-${next()}`],
  }),
  name_map: (firmId) => ({
    text: "insert into name_map (firm_id, kind, outside_name, code) values ($1, 'role', $2, null)",
    values: [firmId, `probe name ${next()}`],
  }),
  sheet_name_problems: (firmId, p) => ({
    text: `insert into sheet_name_problems (firm_id, source_id, kind, tab, row, outside_name, seen_at)
           values ($1, $2, 'unreadable', 'shifts', $3, 'Door Supervisor (NLW)', now())`,
    values: [firmId, p.rows.roster_sources, 10 + next()],
  }),
  firm_secrets: (firmId) => ({
    text: `insert into firm_secrets (firm_id, name, ciphertext, nonce, key_id)
           values ($1, $2, $3, $4, 'aaaaaaaaaaaa')`,
    values: [firmId, `probe.secret_${next()}`, randomBytes(32), randomBytes(12)],
  }),
  offers: (firmId, p) => ({
    text: "insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, $4, 'whatsapp')",
    values: [firmId, p.rows.shifts, p.rosterWorkerId, 1 + next()],
  }),
  worker_unavailable_days: (firmId, p) => ({
    text: "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, $3)",
    values: [firmId, p.workerId, `2027-01-${String(1 + (next() % 28)).padStart(2, "0")}`],
  }),
  push_subscriptions: (firmId, p) => ({
    text: "insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth) values ($1, $2, $3, 'k', 'a')",
    values: [firmId, p.workerId, `https://push.example.test/extra-${next()}`],
  }),
  worker_site_blocks: (firmId, p) => ({
    text: "insert into worker_site_blocks (firm_id, worker_id, site_id, reason) values ($1, $2, $3, 'other')",
    values: [firmId, p.workerId, p.rosterSiteId],
  }),
  travel_estimates: (firmId, p) => ({
    text: `insert into travel_estimates (firm_id, origin_postcode, site_id, mode, arrive_by,
                                         minutes, provider, computed_at, expires_at)
           values ($1, 'ZZ2 2BB', $2, 'public_transport', $3, 41, 'fake', now(),
                   $3::timestamptz + interval '8 days')`,
    values: [firmId, p.rosterSiteId, new Date(Date.UTC(2027, 1, 1) + next() * 60_000)],
  }),
  api_keys: (firmId, p) => ({
    text: `insert into api_keys (firm_id, label, token_hash, hint, created_by)
           values ($1, 'Probe planner', $2, 'ab_-', $3)`,
    values: [firmId, hash(), p.officeUserId],
  }),
  // One per casual: a new casual, then their travel area.
  worker_travel: (firmId) => ({
    text: `with w as (insert into workers (firm_id, first_name, last_name, mobile_e164)
                      values ($1, 'Probe', 'Traveller', $2) returning id)
           insert into worker_travel (firm_id, worker_id, start_postcode, lat, lng, modes,
                                      max_minutes, privacy_notice_version, updated_at)
           select $1, w.id, 'ZZ2 2BB', 53.86, -1.51, 'car', 30, 'travel-v1', now() from w`,
    values: [firmId, fakeMobile()],
  }),
  // One strike per booking, so each gets its own cancelled booking.
  strikes: (firmId, p) => strikeOnNewBooking(firmId, p),
  // Approved, so any number may be added (one waiting at a time per casual).
  uploads: (firmId, p) => ({
    text: `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data, status,
                                checked_by, checked_at)
           values ($1, $2, 'photo', 'image/jpeg', 3, encode(sha256('\\xffd8ff'::bytea), 'hex'),
                   '\\xffd8ff'::bytea, 'approved', $3, now())`,
    values: [firmId, p.workerId, p.officeUserId],
  }),
  pay_records: (firmId, p) => ({
    text: `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence)
           values ($1, $2, '2026-11-02', '2026-11-08', 4, $3)`,
    values: [firmId, p.rosterWorkerId, 1000 + next()],
  }),
  shift_reminders: (firmId, p) => ({
    text: `insert into shift_reminders (firm_id, assignment_id, kind, starts_at, status, channel)
           values ($1, $2, '2h', $3, 'sent', 'sms')`,
    values: [firmId, p.rows.assignments, new Date(Date.UTC(2027, 0, 1) + next() * 60_000)],
  }),
  pay_queries: (firmId, p) => ({
    text: `insert into pay_queries (firm_id, worker_id, work_date, issue_type)
           values ($1, $2, '2026-11-02', 'late_pay')`,
    values: [firmId, p.rosterWorkerId],
  }),
  messages: (firmId, p) => ({
    text: `insert into messages (firm_id, direction, channel, provider_message_id, worker_id, from_e164, to_e164, body)
           values ($1, 'in', 'sms', $2, $3, '+447700900112', '+447700900000', 'pay')`,
    values: [firmId, `SM${randomBytes(16).toString("hex")}`, p.rosterWorkerId],
  }),
  inbound_emails: (firmId, p) => ({
    text: `insert into inbound_emails (firm_id, provider_message_id, worker_id, from_address, to_address, body)
           values ($1, $2, $3, 'rota.worker@example.com', 'staffing@inbound.example.test', 'pay')`,
    values: [firmId, `<${randomBytes(8).toString("hex")}@mail.example.test>`, p.rosterWorkerId],
  }),
  metrics_daily: (firmId) => ({
    text: `insert into metrics_daily (firm_id, day, kind, metric, value)
           values ($1, $2, 'daily', 'portal_actions', 3)`,
    values: [
      firmId,
      new Date(Date.UTC(2027, 0, 1) + next() * 86_400_000).toISOString().slice(0, 10),
    ],
  }),
};

// Every composite foreign key between firm tables. `own` supplies the row's other parents;
// `other` supplies the parent under test. Negative case: firm A's row, firm B's parent.
export const FK_CASES: Record<string, (firmId: string, own: Tenant, other: Tenant) => Statement> = {
  api_keys_created_by_fk: (firmId, _own, other) => ({
    text: `insert into api_keys (firm_id, label, token_hash, hint, created_by)
           values ($1, 'Probe planner', $2, 'ab_-', $3)`,
    values: [firmId, hash(), other.officeUserId],
  }),
  api_keys_revoked_by_fk: (firmId, own, other) => ({
    text: `insert into api_keys (firm_id, label, token_hash, hint, created_by, revoked_by, revoked_at)
           values ($1, 'Probe planner', $2, 'ab_-', $3, $4, now())`,
    values: [firmId, hash(), own.officeUserId, other.officeUserId],
  }),
  sheet_name_problems_source_fk: (firmId, _own, other) => ({
    text: `insert into sheet_name_problems (firm_id, source_id, kind, tab, row, outside_name, seen_at)
           values ($1, $2, 'unreadable', 'staff', $3, 'Probe role', now())`,
    values: [firmId, other.rows.roster_sources, 10 + next()],
  }),
  sheet_name_problems_shift_fk: (firmId, own, other) => ({
    text: `insert into sheet_name_problems (firm_id, source_id, kind, tab, row, outside_name, shift_id, seen_at)
           values ($1, $2, 'skipped_live', 'shifts', $3, 'Holiday', $4, now())`,
    values: [firmId, own.rows.roster_sources, 10 + next(), other.rows.shifts],
  }),
  connector_events_source_fk: (firmId, _own, other) => ({
    text: `insert into connector_events (firm_id, source_id, event_id, type, ref)
           values ($1, $2, $3, 'session.changed', 'PORTAL-S1')`,
    values: [firmId, other.rows.roster_sources, `evt-fk-${next()}`],
  }),
  credentials_worker_fk: (firmId, _own, other) => ({
    text: "insert into credentials (firm_id, worker_id, type) values ($1, $2, 'PTS')",
    values: [firmId, other.workerId],
  }),
  credentials_verified_by_fk: (firmId, own, other) => ({
    text: "insert into credentials (firm_id, worker_id, type, verified_by) values ($1, $2, 'PTS', $3)",
    values: [firmId, own.workerId, other.officeUserId],
  }),
  credentials_evidence_upload_fk: (firmId, own, other) => ({
    text: `insert into credentials (firm_id, worker_id, type, status, check_state, evidence_upload_id)
           values ($1, $2, 'PTS', 'expired', 'waiting', $3)`,
    values: [firmId, own.workerId, other.rows.uploads],
  }),
  // A waiting certificate of a type of its own each time (one waiting per casual and type).
  uploads_worker_fk: (firmId, _own, other) => ({
    text: `insert into uploads (firm_id, worker_id, kind, credential_type, content_type, size, sha256,
                                data)
           values ($1, $2, 'certificate', $3, 'image/jpeg', 3,
                   encode(sha256('\\xffd8ff'::bytea), 'hex'), '\\xffd8ff'::bytea)`,
    values: [firmId, other.workerId, `PROBE_${next()}`],
  }),
  uploads_checked_by_fk: (firmId, own, other) => ({
    text: `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data, status,
                                checked_by, checked_at)
           values ($1, $2, 'photo', 'image/jpeg', 3, encode(sha256('\\xffd8ff'::bytea), 'hex'),
                   '\\xffd8ff'::bytea, 'approved', $3, now())`,
    values: [firmId, own.workerId, other.officeUserId],
  }),
  magic_links_worker_fk: (firmId, _own, other) => ({
    text: `insert into magic_links (firm_id, kind, worker_id, token_hash, request_id, expires_at)
           values ($1, 'worker', $2, $3, $4, $5)`,
    values: [firmId, other.workerId, hash(), randomUUID(), later()],
  }),
  magic_links_office_user_fk: (firmId, _own, other) => ({
    text: `insert into magic_links (firm_id, kind, office_user_id, token_hash, request_id, expires_at)
           values ($1, 'office', $2, $3, $4, $5)`,
    values: [firmId, other.officeUserId, hash(), randomUUID(), later()],
  }),
  sessions_worker_fk: (firmId, _own, other) => ({
    text: `insert into sessions (firm_id, kind, worker_id, token_hash, expires_at, rotated_at)
           values ($1, 'worker', $2, $3, $4, now())`,
    values: [firmId, other.workerId, hash(), later()],
  }),
  sessions_office_user_fk: (firmId, _own, other) => ({
    text: `insert into sessions (firm_id, kind, office_user_id, token_hash, expires_at, rotated_at)
           values ($1, 'office', $2, $3, $4, now())`,
    values: [firmId, other.officeUserId, hash(), later()],
  }),
  otp_codes_session_fk: (firmId, _own, other) => ({
    text: "insert into otp_codes (firm_id, session_id, code_hash, expires_at) values ($1, $2, $3, $4)",
    values: [firmId, other.spareSessionId, hash(), later()],
  }),
  shifts_site_fk: (firmId, own, other) => ({
    text: "insert into shifts (firm_id, event_id, site_id, role, starts_at, ends_at) values ($1, $2, $3, 'steward', $4, $5)",
    values: [firmId, own.rows.shift_events, other.rosterSiteId, ...shiftTimes()],
  }),
  shifts_event_fk: (firmId, _own, other) => ({
    text: "insert into shifts (firm_id, event_id, role, starts_at, ends_at) values ($1, $2, 'steward', $3, $4)",
    values: [firmId, other.rows.shift_events, ...shiftTimes()],
  }),
  shift_events_site_fk: (firmId, _own, other) => ({
    text: "insert into shift_events (firm_id, name, site_id) values ($1, $2, $3)",
    values: [firmId, `Probe event ${next()}`, other.rosterSiteId],
  }),
  assignments_shift_fk: (firmId, _own, other) => ({
    text: "insert into assignments (firm_id, shift_id, slot) values ($1, $2, $3)",
    values: [firmId, other.rows.shifts, 1 + next()],
  }),
  assignments_worker_fk: (firmId, own, other) => ({
    text: `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
           values ($1, $2, $3, $4, 'confirmed', now())`,
    values: [firmId, own.rows.shifts, 1 + next(), other.workerId],
  }),
  requests_worker_fk: (firmId, _own, other) => ({
    text: "insert into requests (firm_id, worker_id, type) values ($1, $2, 'general')",
    values: [firmId, other.workerId],
  }),
  requests_shift_fk: (firmId, own, other) => ({
    text: "insert into requests (firm_id, worker_id, shift_id, type) values ($1, $2, $3, 'swap')",
    values: [firmId, own.rosterWorkerId, other.rows.shifts],
  }),
  requests_resolved_by_fk: (firmId, own, other) => ({
    text: `insert into requests (firm_id, worker_id, type, status, resolved_by, resolved_at)
           values ($1, $2, 'availability', 'approved', $3, now())`,
    values: [firmId, own.rosterWorkerId, other.officeUserId],
  }),
  requests_message_fk: (firmId, own, other) => ({
    text: "insert into requests (firm_id, worker_id, type, message_id) values ($1, $2, 'general', $3)",
    values: [firmId, own.rosterWorkerId, other.rows.messages],
  }),
  offers_shift_fk: (firmId, own, other) => ({
    text: "insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, $4, 'sms')",
    values: [firmId, other.rows.shifts, own.rosterWorkerId, 1 + next()],
  }),
  offers_worker_fk: (firmId, own, other) => ({
    text: "insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, $4, 'sms')",
    values: [firmId, own.rows.shifts, other.workerId, 1 + next()],
  }),
  offers_offered_by_fk: (firmId, own, other) => ({
    text: "insert into offers (firm_id, shift_id, worker_id, offered_by, channel) values ($1, $2, $3, $4, 'sms')",
    values: [firmId, own.rows.shifts, own.rosterWorkerId, other.officeUserId],
  }),
  worker_unavailable_days_worker_fk: (firmId, _own, other) => ({
    text: "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2027-02-01')",
    values: [firmId, other.workerId],
  }),
  worker_site_blocks_worker_fk: (firmId, own, other) => ({
    text: "insert into worker_site_blocks (firm_id, worker_id, site_id, reason) values ($1, $2, $3, 'other')",
    values: [firmId, other.workerId, own.rosterSiteId],
  }),
  worker_site_blocks_site_fk: (firmId, own, other) => ({
    text: "insert into worker_site_blocks (firm_id, worker_id, site_id, reason) values ($1, $2, $3, 'other')",
    values: [firmId, own.workerId, other.rosterSiteId],
  }),
  strikes_worker_fk: (firmId, own, other) =>
    strikeOnNewBooking(firmId, own, { workerId: other.rosterWorkerId }),
  strikes_shift_fk: (firmId, own, other) =>
    strikeOnNewBooking(firmId, own, { shiftId: other.rows.shifts }),
  strikes_assignment_fk: (firmId, own, other) => ({
    text: `insert into strikes (firm_id, worker_id, assignment_id, shift_id, notice_hours,
                                threshold_hours, issued_at, expires_at)
           values ($1, $2, $3, $4, 10, 48, now(), now() + interval '90 days')`,
    values: [firmId, own.rosterWorkerId, other.rows.assignments, own.rows.shifts],
  }),
  strikes_reviewed_by_fk: (firmId, own, other) =>
    strikeOnNewBooking(firmId, own, { reviewedBy: other.officeUserId }),
  strikes_withdrawn_by_fk: (firmId, own, other) =>
    strikeOnNewBooking(firmId, own, { withdrawnBy: other.officeUserId }),
  worker_site_blocks_blocked_by_fk: (firmId, own, other) => ({
    text: `insert into worker_site_blocks (firm_id, worker_id, site_id, reason, blocked_by)
           values ($1, $2, $3, 'incident', $4)`,
    values: [firmId, own.rosterWorkerId, own.rosterSiteId, other.officeUserId],
  }),
  travel_estimates_site_fk: (firmId, _own, other) => ({
    text: `insert into travel_estimates (firm_id, origin_postcode, site_id, mode, arrive_by,
                                         minutes, provider, computed_at, expires_at)
           values ($1, 'ZZ3 3CC', $2, 'car', $3, 20, 'fake', now(),
                   $3::timestamptz + interval '8 days')`,
    values: [firmId, other.rosterSiteId, new Date(Date.UTC(2027, 2, 1) + next() * 60_000)],
  }),
  worker_travel_worker_fk: (firmId, _own, other) => ({
    text: `insert into worker_travel (firm_id, worker_id, start_postcode, lat, lng, modes,
                                      max_minutes, privacy_notice_version, updated_at)
           values ($1, $2, 'ZZ3 3CC', 53.89, -1.49, 'car', 60, 'travel-v1', now())`,
    values: [firmId, other.rosterWorkerId],
  }),
  push_subscriptions_worker_fk: (firmId, _own, other) => ({
    text: "insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth) values ($1, $2, $3, 'k', 'a')",
    values: [firmId, other.workerId, `https://push.example.test/fk-${next()}`],
  }),
  pay_records_worker_fk: (firmId, _own, other) => ({
    text: `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence)
           values ($1, $2, '2026-11-09', '2026-11-15', 1, $3)`,
    values: [firmId, other.workerId, 2000 + next()],
  }),
  pay_queries_worker_fk: (firmId, _own, other) => ({
    text: `insert into pay_queries (firm_id, worker_id, work_date, issue_type)
           values ($1, $2, '2026-11-03', 'other')`,
    values: [firmId, other.workerId],
  }),
  pay_queries_shift_fk: (firmId, own, other) => ({
    text: `insert into pay_queries (firm_id, worker_id, shift_id, work_date, issue_type)
           values ($1, $2, $3, '2026-11-04', 'wrong_rate')`,
    values: [firmId, own.rosterWorkerId, other.rows.shifts],
  }),
  messages_worker_fk: (firmId, _own, other) => ({
    text: `insert into messages (firm_id, direction, channel, provider_message_id, worker_id, from_e164, to_e164)
           values ($1, 'in', 'whatsapp', $2, $3, '+447700900113', '+447700900000')`,
    values: [firmId, `SM${randomBytes(16).toString("hex")}`, other.workerId],
  }),
  inbound_emails_worker_fk: (firmId, _own, other) => ({
    text: `insert into inbound_emails (firm_id, provider_message_id, worker_id, from_address, to_address)
           values ($1, $2, $3, 'someone@example.com', 'staffing@inbound.example.test')`,
    values: [firmId, `<${randomBytes(8).toString("hex")}@mail.example.test>`, other.workerId],
  }),
  messages_reply_to_fk: (firmId, _own, other) => ({
    text: `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164, reply_to)
           values ($1, 'out', 'whatsapp', $2, '+447700900000', '+447700900113', $3)`,
    values: [firmId, `console-${randomUUID()}`, other.rows.messages],
  }),
  pay_queries_resolved_by_fk: (firmId, own, other) => ({
    text: `insert into pay_queries (firm_id, worker_id, work_date, issue_type, status, resolved_by,
             resolved_at, resolution_note)
           values ($1, $2, '2026-11-05', 'late_pay', 'resolved', $3, now(), 'Paid Friday.')`,
    values: [firmId, own.rosterWorkerId, other.officeUserId],
  }),
  metrics_daily_recorded_by_fk: (firmId, _own, other) => ({
    text: `insert into metrics_daily (firm_id, day, kind, metric, value, recorded_by)
           values ($1, $2, 'tally', 'calls_per_day', 1, $3)`,
    values: [
      firmId,
      new Date(Date.UTC(2027, 5, 1) + next() * 86_400_000).toISOString().slice(0, 10),
      other.officeUserId,
    ],
  }),
  shift_reminders_assignment_fk: (firmId, _own, other) => ({
    text: `insert into shift_reminders (firm_id, assignment_id, kind, starts_at, status)
           values ($1, $2, '24h', $3, 'skipped')`,
    values: [firmId, other.rows.assignments, new Date(Date.UTC(2027, 1, 1) + next() * 60_000)],
  }),
};

// A strike on a new cancelled booking of the tenant's rota worker (one statement: the booking, then
// the strike pointing at it), with any of its links pointed elsewhere.
function strikeOnNewBooking(
  firmId: string,
  p: Tenant,
  o: { workerId?: string; shiftId?: string; reviewedBy?: string; withdrawnBy?: string } = {},
): Statement {
  return {
    text: `with booking as (
             insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at,
                                      cancelled_at, cancel_reason, notice_hours)
             values ($1, $2, $3, $4, 'cancelled_worker', now(), now(), 'Travel problem', 10)
             returning id)
           insert into strikes (firm_id, worker_id, assignment_id, shift_id, notice_hours,
                                threshold_hours, issued_at, expires_at, reviewed_by, reviewed_at,
                                status, withdrawn_by, withdrawn_at)
           select $1, $5, booking.id, $6, 10, 48, now(), now() + interval '90 days',
                  $7::uuid, case when $7::uuid is null then null else now() end,
                  case when $8::uuid is null then 'live' else 'withdrawn' end,
                  $8::uuid, case when $8::uuid is null then null else now() end
             from booking`,
    values: [
      firmId,
      p.rows.shifts,
      100 + next(),
      p.rosterWorkerId,
      o.workerId ?? p.rosterWorkerId,
      o.shiftId ?? p.rows.shifts,
      o.reviewedBy ?? null,
      o.withdrawnBy ?? null,
    ],
  };
}
