import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { uniqueSlug } from "./db";

// One row in every firm table for a new test firm, inserted as the superuser (bypassing RLS),
// plus builders for fresh rows. Used by tenancy.isolation and rls.mutation. A table without an
// entry here fails those tests by name, so a new table can't be left untested.

export const EXPECTED_TABLES = [
  "auth_throttle",
  "credentials",
  "events",
  "firms",
  "magic_links",
  "office_users",
  "otp_codes",
  "sessions",
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
}

let seq = 0;
const next = () => (seq += 1);
// Ofcom's drama range only (+447700900000-999), never a real number.
const fakeMobile = () => `+447700900${String(next() % 1000).padStart(3, "0")}`;
const hash = () => randomBytes(32);
const later = () => new Date(Date.now() + 60 * 60 * 1000);

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
  return {
    firmId,
    slug,
    workerId,
    officeUserId,
    sessionId,
    spareSessionId,
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
};
