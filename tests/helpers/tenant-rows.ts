import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { uniqueSlug } from "./db";

// One row in every firm table for a new test firm, inserted as the superuser (bypassing RLS),
// plus builders for fresh rows. Used by tenancy.isolation and rls.mutation. A table without an
// entry here fails those tests by name, so a new table can't be left untested.

export const EXPECTED_TABLES = [
  "assignments",
  "auth_throttle",
  "credential_rules",
  "credentials",
  "events",
  "firms",
  "magic_links",
  "offers",
  "office_users",
  "otp_codes",
  "requests",
  "roster_sources",
  "sessions",
  "shifts",
  "sites",
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
  const [startsAt, endsAt] = shiftTimes();
  const shiftId = await one(
    su,
    "insert into shifts (firm_id, site_id, role, starts_at, ends_at, headcount) values ($1, $2, 'steward', $3, $4, 2)",
    [firmId, rosterSiteId, startsAt, endsAt],
  );
  const assignmentId = await one(
    su,
    `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
     values ($1, $2, 1, $3, 'confirmed', now())`,
    [firmId, shiftId, rosterWorkerId],
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
  const offerId = await one(
    su,
    "insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, 1, 'push')",
    [firmId, shiftId, rosterWorkerId],
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
      shifts: shiftId,
      assignments: assignmentId,
      requests: requestId,
      offers: offerId,
      roster_sources: rosterSourceId,
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
  shifts: (firmId, p) => ({
    text: "insert into shifts (firm_id, site_id, role, starts_at, ends_at) values ($1, $2, 'steward', $3, $4)",
    values: [firmId, p.rosterSiteId, ...shiftTimes()],
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
  offers: (firmId, p) => ({
    text: "insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, $4, 'whatsapp')",
    values: [firmId, p.rows.shifts, p.rosterWorkerId, 1 + next()],
  }),
};

// Every composite foreign key between firm tables. `own` supplies the row's other parents;
// `other` supplies the parent under test. Negative case: firm A's row, firm B's parent.
export const FK_CASES: Record<string, (firmId: string, own: Tenant, other: Tenant) => Statement> = {
  credentials_worker_fk: (firmId, _own, other) => ({
    text: "insert into credentials (firm_id, worker_id, type) values ($1, $2, 'PTS')",
    values: [firmId, other.workerId],
  }),
  credentials_verified_by_fk: (firmId, own, other) => ({
    text: "insert into credentials (firm_id, worker_id, type, verified_by) values ($1, $2, 'PTS', $3)",
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
  shifts_site_fk: (firmId, _own, other) => ({
    text: "insert into shifts (firm_id, site_id, role, starts_at, ends_at) values ($1, $2, 'steward', $3, $4)",
    values: [firmId, other.rosterSiteId, ...shiftTimes()],
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
  offers_shift_fk: (firmId, own, other) => ({
    text: "insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, $4, 'sms')",
    values: [firmId, other.rows.shifts, own.rosterWorkerId, 1 + next()],
  }),
  offers_worker_fk: (firmId, own, other) => ({
    text: "insert into offers (firm_id, shift_id, worker_id, wave, channel) values ($1, $2, $3, $4, 'sms')",
    values: [firmId, own.rows.shifts, other.workerId, 1 + next()],
  }),
};
