# Data model

Every table has `id uuid` (`events`: a `bigint` identity), `firm_id uuid` (except `firms`),
`created_at timestamptz`, RLS enabled **and forced**, and the tenant policy. Times in UTC. Money in
pence. Phones in E.164. The Drizzle schema in `src/lib/db/schema/` is the source of truth; the
DDL below is a readable sketch.

**Every unique key on a firm table starts with `firm_id`** (except random token hashes).
Postgres checks unique indexes before foreign keys, so a key like `(shift_id, slot)` would let
Firm A point a row at Firm B's shift and learn from a duplicate-key error that the slot is filled.
`rls.every-table` checks this for every index.

**Links between firm tables use composite foreign keys**, e.g. `(firm_id, worker_id) →
workers(firm_id, id)`, so every parent has `unique (firm_id, id)`. Postgres checks foreign keys
without RLS, so a plain `worker_id → workers(id)` would let Firm A point a row at Firm B's
worker. Links to `firms(id)` itself are plain: the policy's `WITH CHECK` pins `firm_id`.

**Exceptions to "every table has firm_id":** the `drizzle` schema (migration history, owner only)
and the `pgboss` schema (library-owned job queue). The jobs role owns the pgboss tables, so the
worker's queue connection isn't firm-restricted inside the queue: job payloads carry ids only,
never names, numbers, tokens or codes. `pgboss.job_common` has RLS enabled (not forced) with two
policies for the app role only, so the web may only insert jobs for its own firm (see
architecture.md, Tenancy).

## Tables at a glance

| Table | What it holds | Phase |
|---|---|---|
| firms | Name, slug, sector, branding, custom domain, settings | 1 |
| office_users | Resourcers, payroll, admins (email, role, status) | 1 |
| workers | Casual staff: name, mobile, email, status, roles | 1 |
| credentials | Licences/cards per worker: type, number, expiry, status | 1 |
| credential_rules | Which credentials a role needs, per sector | 2 |
| credential_types | The credential types a firm uses (code, name, sector, whether "applied" may count), seeded from its sector's pack | 2 |
| sites | Venues/sites (address; lat/lng kept for Stage 3) | 1 |
| shifts | Site, role, start/end, headcount, urgent flag, source | 2 |
| assignments | Worker on a shift slot: open → (offered) → confirmed → cancelled/no-show/completed | 2 |
| requests | Time changes, swaps, general asks, and their status | 2 |
| offers | Each offer sent in a wave and the response (table Phase 2; sending Phase 4) | 2 |
| messages | Every inbound/outbound message (WhatsApp, SMS, email, voice, portal) | 7 |
| pay_records | Imported hours, rates, pay dates | 3 |
| pay_queries | Structured pay questions + grouping key + status | 6 |
| events | Append-only action log (the evidence trail) | 1 |
| magic_links / sessions / otp_codes | Login (hashes only, never raw tokens or codes) | 1 |
| auth_throttle | Rate-limit counters for login and OTP requests (HMAC-keyed buckets) | 1 |
| push_subscriptions | Web push endpoints per worker | 4 |
| roster_sources | Where a firm's rota lives when it isn't our tables (Google Sheet id, column mapping, last sync, error code, sync lease) | 2 |
| metrics_daily | Pilot baseline and daily counts | 5 |

## Firm settings (jsonb on `firms.settings`)

```json
{
  "allocation_mode": "fair_rotation",
  "urgent_window_hours": 24,
  "short_notice_threshold_hours": 48,
  "wave_size": 4,
  "wave_minutes": 15,
  "escalate_hours_before_start": 3,
  "quiet_hours": { "start": "22:00", "end": "07:00", "urgent_override": true },
  "credential_applied_allowance_pct": 15,
  "min_rest_hours": 11,
  "weekly_hours_cap": 48,
  "travel_buffer_minutes": 0,
  "approve_mode": true,
  "sign_off": "Acme Events Shift Team"
}
```

(The 48-hour short-notice threshold is a placeholder until the 2027 regulations are final.)

## DDL sketch (Postgres)

```sql
create table firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,            -- 2-20 chars a-z0-9-; not www/portal/api/app/admin/xn--
  sector text not null,                 -- 'security' | 'rail' | 'construction' | 'cleaning'
  custom_domain text unique,
  domain_verified boolean not null default false,
  brand_logo_url text,                  -- https:// only
  brand_primary_color text,             -- #rrggbb only
  timezone text not null default 'Europe/London',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table office_users (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  email text not null,                  -- stored lowercase
  name text not null,
  role text not null,                   -- admin | resourcer | payroll
  status text not null default 'active', -- active | disabled (never deleted)
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, email)
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  name text not null,
  address_line1 text, address_line2 text, town text, postcode text,
  lat numeric(9,6), lng numeric(9,6),   -- Stage 3 only
  notes text,
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, name)
);

create table workers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  first_name text not null,
  last_name text not null,
  mobile_e164 text not null,
  email text,
  status text not null default 'active', -- active | inactive | blocked
  roles text[] not null default '{}',
  external_ref text,                     -- the sheet's staff id (Sheets firms); null otherwise
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, mobile_e164),
  unique (firm_id, external_ref)
);

create table credentials (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers(firm_id, id)
  type text not null,                    -- 'SIA_DS', 'SIA_SG', 'PTS', 'SENTINEL', 'CSCS', 'DBS'...
  number text,
  expires_on date,
  status text not null default 'valid',  -- valid | expired | applied | suspended
  verified_at timestamptz,
  verified_by uuid,                      -- (firm_id, verified_by) -> office_users(firm_id, id)
  -- Expiry warnings (credential-scan): the expiry date the warnings sent so far were about, and
  -- the last threshold sent. A new expires_on (a renewal) means none sent yet for it.
  expiry_warned_for date,
  expiry_warned_days smallint,           -- 30 | 14 | 7; set together with expiry_warned_for (check)
  created_at timestamptz not null default now()
);

-- The rota (Phase 2, src/lib/db/schema/roster.ts). Its foreign keys have no ON DELETE action:
-- deleting a worker, site, shift or office user that rota rows point at fails, so history is
-- never erased or orphaned. The app role may not DELETE shifts, assignments, requests or offers
-- (SELECT, INSERT, UPDATE only): they are cancelled or resolved, never removed.
-- Roles ('steward', 'door_supervisor', 'track_operative'...) are snake_case in shifts and
-- credential_rules (a CHECK), so they match workers.roles exactly.

create table credential_types (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  code text not null,                    -- ^[A-Z][A-Z0-9_]*$, as in credentials.type
  name text not null,                    -- as workers know it: "SIA door supervisor licence"
  sector text not null,                  -- the pack: security | rail | construction | cleaning | any
  applied_allowed boolean not null default false,  -- "applied" may count (SIA licences)
  created_at timestamptz not null default now(),
  unique (firm_id, code)
);

create table credential_rules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  sector text not null,                  -- the pack: security | rail | construction | cleaning
  role text not null,                    -- snake_case; one pack per role name in a firm
  required_types text[] not null,        -- all required; flat list of type codes ('SIA_DS'),
                                         -- no NULL, blank or comma-joined elements; '{}' = needs
                                         -- none. No row for a role = not eligible (fail closed).
                                         -- Any-of groups can be modelled later.
  created_at timestamptz not null default now(),
  unique (firm_id, role)
);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  site_id uuid,                          -- (firm_id, site_id) -> sites(firm_id, id)
  role text not null,                    -- snake_case
  starts_at timestamptz not null,
  ends_at timestamptz not null,          -- check: ends_at > starts_at
  headcount int not null default 1,      -- 1..1000
  is_urgent boolean not null default false,
  status text not null default 'open',   -- draft | open | filled | cancelled
  source text not null default 'native', -- native | sheets | csv
  external_ref text,                     -- the row's key in the firm's sheet or import
  instructions text,
  synced_holders text[],                 -- Sheets: the "Assigned" cell's staff ids after the last
                                         -- successful sync (the three-way merge's base)
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, source, external_ref) -- one shift per sheet/import row (NULLs don't collide)
);

-- One row per holder of a slot. A cancellation keeps its row (worker, reason, notice hours) and
-- a new open row reopens the slot, so only one "live" row (not cancelled) may exist per slot.
create table assignments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  shift_id uuid not null,                -- (firm_id, shift_id) -> shifts(firm_id, id)
  slot int not null,                     -- 1..headcount (>= 1 checked; <= headcount in code)
  worker_id uuid,                        -- (firm_id, worker_id) -> workers; null = unfilled slot
  status text not null default 'open',   -- open | offered | confirmed | cancelled_worker | cancelled_firm | no_show | completed
  offered_at timestamptz,                -- required when offered
  confirmed_at timestamptz,              -- required when confirmed, no_show or completed
  cancelled_at timestamptz,              -- cancelled_*: cancelled_at, a non-blank cancel_reason
  cancel_reason text,                    --   and notice_hours are all required (golden rule 12)
  notice_hours numeric(8,2),             -- starts_at - cancelled_at, in hours; negative if after the start
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  check ((status = 'open') = (worker_id is null))
);
create unique index assignments_one_live_per_slot on assignments (firm_id, shift_id, slot)
  where status not in ('cancelled_worker', 'cancelled_firm');
create unique index assignments_one_live_per_worker on assignments (firm_id, shift_id, worker_id)
  where worker_id is not null and status not in ('cancelled_worker', 'cancelled_firm');

-- First yes wins (one statement; the shift must still be open, so the open slots of a draft,
-- filled or cancelled shift can't be taken):
-- update assignments a set worker_id = $1, status = 'confirmed', confirmed_at = now()
--   from shifts s
--  where a.id = $2 and a.worker_id is null
--    and s.firm_id = a.firm_id and s.id = a.shift_id and s.status = 'open'
-- returning a.id;

create table requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers
  shift_id uuid,                         -- (firm_id, shift_id) -> shifts; required for time_change and swap
  type text not null,                    -- time_change | swap | availability | general
  payload jsonb not null default '{}',   -- a JSON object; shape validated in code per type
  status text not null default 'open',   -- open | approved | declined | auto_resolved | escalated
  resolved_by uuid,                      -- (firm_id, resolved_by) -> office_users
  resolved_at timestamptz,
  -- open/escalated: neither set. approved/declined: both set. auto_resolved: resolved_at only.
  created_at timestamptz not null default now(),
  unique (firm_id, id)
);

create table offers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  shift_id uuid not null,                -- (firm_id, shift_id) -> shifts
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers
  wave int not null,                     -- >= 1
  channel text not null,                 -- push | whatsapp | sms
  sent_at timestamptz not null default now(),
  responded_at timestamptz,              -- set exactly when response is set
  response text,                         -- accepted | declined | expired | filled_elsewhere
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, shift_id, worker_id, wave) -- a retried offer-wave job (key shift:wave) sends nothing new
);

-- Where a firm's rota lives when it isn't our tables (native firms have no row). No secrets:
-- the firm shares its sheet with our service account; the key is in the worker's environment.
create table roster_sources (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  kind text not null,                    -- 'sheets'
  enabled boolean not null default true,
  spreadsheet_id text not null,          -- ^[A-Za-z0-9_-]{20,100}$
  mapping jsonb not null,                -- tabs and header names (src/lib/roster/sheets/mapping.ts)
  last_synced_at timestamptz,
  last_attempted_at timestamptz,         -- the last sync that ran, success or not (for back-off)
  last_error_code text,                  -- a code only (^[a-z_]{1,50}$), never a message or cell
  sync_started_at timestamptz,           -- the sync's lease (5 minutes)
  created_at timestamptz not null default now()
);
create unique index roster_sources_one_enabled_per_firm on roster_sources (firm_id) where enabled;

create table messages (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  direction text not null,               -- in | out
  channel text not null,                 -- whatsapp | sms | email | voice | portal
  provider_message_id text unique,       -- idempotency
  worker_id uuid references workers(id),
  body text,
  transcript text,
  handled_as text,                       -- keyword | ai | office
  created_at timestamptz not null default now()
);

create table pay_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null references workers(id),
  period_start date not null,
  period_end date not null,
  hours numeric not null,
  rate_pence int not null,
  gross_pence int,
  pay_date date,
  source text not null default 'import',
  created_at timestamptz not null default now()
);

create table pay_queries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null references workers(id),
  shift_id uuid references shifts(id),
  issue_type text not null,              -- missing_hours | wrong_rate | late_pay | other
  details text,
  group_key text,                        -- set by code (week + site + rate code + issue)
  status text not null default 'open',   -- open | in_digest | resolved
  created_at timestamptz not null default now()
);

create table events (
  id bigint generated always as identity primary key,  -- no sequence grant needed
  firm_id uuid not null references firms(id),
  actor_type text not null,              -- worker | office | system | ai
  actor_id uuid,
  action text not null,                  -- e.g. 'shift.assigned', 'shift.cancelled', 'offer.sent'
  entity_type text not null,
  entity_id uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
-- events is append-only: the app role has SELECT and INSERT only, and events has only
-- select and insert policies. data never holds tokens, codes, phones, emails or IPs
-- (recordEvent() refuses anything the log masker would change).
-- Login events (kind worker or office): auth.link_requested (entity login_request; data {kind, matched}),
-- auth.link_sent (magic_link; {purpose, channel, providerMessageId}), auth.link_rejected
-- (magic_link or none; {kind, reason: unknown|used|expired|wrong_kind|inactive}), auth.login
-- (session; actor worker/office), auth.session_rotated, auth.logout, auth.rate_limited
-- (login_request, magic_link or session; {limit: "login:mobile" | "login:ip" | "office:email" |
-- "office:ip" | "link_fail:ip" | "otp:worker" | "otp:worker_day"}; once per window, when the
-- limit is first reached). Pay-page codes: auth.otp_requested (session),
-- auth.otp_sent, auth.otp_failed ({attemptsLeft}), auth.otp_locked, auth.otp_verified (otp_code).
-- Cancelling (src/lib/roster/cancel.ts): shift.cancelled (assignment; actor worker or office; {by:
-- worker|firm, shiftId, workerId, noticeHours}); the reason a person typed is only on the row
-- (assignments.cancel_reason). The Sheets sync's adds source and its fixed reason ("Removed on the
-- rota sheet", "Shift cancelled on the rota sheet").
-- Booking (src/lib/roster/book.ts): shift.assigned (assignment; actor worker or office; {by:
-- worker|firm, shiftId, workerId, slot, noticeHours, overridden?, reason?}); from the Sheets sync
-- the same with source: sheets and reason "Put on the rota sheet by the office".
-- shift.booking_refused (shift; {by, workerId, codes}) when the rules turn a booking down, and
-- roster.sheet_booking_refused (shift; {source, workerId, codes}) for a sheet name (codes may
-- include settings_invalid when the firm's rules settings are broken).
-- Credential expiry (actor system): credential.expiry_warning (credential; {type, expiresOn, days,
-- daysLeft, channel, providerMessageId}), credential.expired (credential; {type, expiresOn,
-- notified, superseded?, channel, providerMessageId}), credential.weekly_list_sent (firm; {date,
-- recipients, skipped, expiring, expired}: counts only, never the names in the email).

-- Login (Phase 1). kind says whose row it is; a CHECK ties kind to exactly one subject column.
create table magic_links (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  kind text not null,                    -- worker | office
  worker_id uuid,                        -- (firm_id, worker_id) -> workers, on delete cascade
  office_user_id uuid,                   -- (firm_id, office_user_id) -> office_users, cascade
  token_hash bytea not null unique,      -- sha256 of 32 random bytes; the raw token is never stored
  request_id uuid not null unique,       -- the login request; makes the send job safe to retry
  expires_at timestamptz not null,       -- 15 minutes
  sent_at timestamptz,
  used_at timestamptz,                   -- single use: one conditional UPDATE sets it
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  kind text not null,                    -- worker | office
  worker_id uuid, office_user_id uuid,   -- composite FKs as above
  token_hash bytea not null unique,      -- sha256 of the cookie value
  prev_token_hash bytea unique,          -- the token before the last rotation...
  prev_valid_until timestamptz,          -- ...still accepted for 60 s
  expires_at timestamptz not null,       -- 30 days from login
  rotated_at timestamptz not null,
  revoked_at timestamptz,
  stepped_up_until timestamptz,          -- set by a correct OTP (pay pages)
  created_at timestamptz not null default now(),
  unique (firm_id, id)
);

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  session_id uuid not null,              -- (firm_id, session_id) -> sessions, cascade
  code_hash bytea not null,              -- HMAC-SHA256 with SESSION_SECRET
  expires_at timestamptz not null,       -- 10 minutes
  attempts int not null default 0,       -- 0..5
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
-- one live code per session:
create unique index otp_codes_one_live_per_session on otp_codes (firm_id, session_id) where consumed_at is null;

create table auth_throttle (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  bucket text not null,                  -- e.g. 'login:mobile:<hmac>'; never a raw number or IP
  window_start timestamptz not null,
  hits int not null default 0,
  created_at timestamptz not null default now(),
  unique (firm_id, bucket, window_start)
);

-- The firm for the current transaction. NULL when unset, so policies fail closed. The nullif
-- matters: a pooled connection that ran a firm transaction returns '' afterwards, not NULL.
create function app_current_firm_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.current_firm_id', true), '')::uuid $$;

-- RLS pattern (every firm table; generated by drizzle-kit from the schema):
alter table workers enable row level security;
alter table workers force row level security;   -- applied by db:migrate: binds the owner too
create policy firm_isolation on workers for all to public
  using (firm_id = (select app_current_firm_id()))
  with check (firm_id = (select app_current_firm_id()));
-- (select ...) makes Postgres evaluate the function once per query, not once per row.
-- firms uses id instead of firm_id, plus a directory_read policy for the owner only, used by
-- the app_resolve_firm() function (host -> firm before any firm is known) and app_firm_ids()
-- (every firm's id, for the worker's scheduled jobs; ids only).
```

**Grants.** drizzle-kit never writes `FORCE ROW LEVEL SECURITY` or grants, so `db:migrate`
applies `src/lib/db/admin/access.ts` after the migrations: FORCE on every table and exactly the
listed privileges for `shiftdesk_app` (never TRUNCATE, which ignores RLS; no DELETE on `events`,
`shifts`, `assignments`, `requests` or `offers`). A new table without an
entry there fails the migrate. Adding a table: Drizzle schema + `.enableRLS()` + the tenant
policy, `npm run db:generate`, a `TABLE_ACCESS` entry, and fixtures in
`tests/helpers/tenant-rows.ts` (the isolation tests fail by name until they exist).

## Retention (defaults, per firm)

| Data | Keep |
|---|---|
| Raw messages and transcripts | 90 days |
| Call audio | Don't store by default (30 days if enabled) |
| Cases, requests, events, notice report | 12 months (check 2027 rules; may need longer) |
| Workers and credentials | Until the firm deletes them |
| Magic links and OTP codes | 7 days after expiry |
| Sessions | 30 days after expiry or revocation |
| Rate-limit counters (auth_throttle) | 1 day |
| Finished pg-boss jobs | 1 day (ids-only payloads) |

A nightly job purges expired data and writes an event for each purge run.
