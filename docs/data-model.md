# Data model

Every table has `id uuid`, `firm_id uuid` (except `firms`), `created_at timestamptz`, and an
RLS policy. Times in UTC. Money in pence. Phones in E.164.

## Tables at a glance

| Table | What it holds | Phase |
|---|---|---|
| firms | Name, slug, sector, branding, custom domain, settings | 1 |
| office_users | Resourcers, payroll, admins | 1 |
| workers | Casual staff: name, mobile, email, status, roles | 1 |
| credentials | Licences/cards per worker: type, number, expiry, status | 1 |
| credential_rules | Which credentials a role needs, per sector | 2 |
| sites | Venues/sites (address; lat/lng kept for Stage 3) | 1 |
| shifts | Site, role, start/end, headcount, urgent flag, source | 2 |
| assignments | Worker on a shift: offered → accepted → confirmed → cancelled/completed | 2 |
| requests | Time changes, swaps, general asks, and their status | 2 |
| offers | Each offer sent in a wave and the response | 4 |
| messages | Every inbound/outbound message (WhatsApp, SMS, email, voice, portal) | 7 |
| pay_records | Imported hours, rates, pay dates | 3 |
| pay_queries | Structured pay questions + grouping key + status | 6 |
| events | Append-only action log (the evidence trail) | 1 |
| magic_links / sessions / otp_codes | Login | 1 |
| push_subscriptions | Web push endpoints per worker | 4 |
| roster_sources | Adapter type + config + last sync | 2 |
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
  slug text not null unique,
  sector text not null,                 -- 'security' | 'rail' | 'construction' | 'cleaning'
  custom_domain text unique,
  domain_verified boolean not null default false,
  brand_logo_url text,
  brand_primary_color text,
  timezone text not null default 'Europe/London',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
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
  created_at timestamptz not null default now(),
  unique (firm_id, mobile_e164)
);

create table credentials (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null references workers(id),
  type text not null,                    -- 'SIA_DS', 'SIA_SG', 'PTS', 'SENTINEL', 'CSCS', 'DBS'...
  number text,
  expires_on date,
  status text not null default 'valid',  -- valid | expired | applied | suspended
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz not null default now()
);

create table credential_rules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  role text not null,                    -- 'steward', 'door_supervisor', 'track_operative'...
  required_types text[] not null,        -- any-of groups can be modelled later
  created_at timestamptz not null default now()
);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  site_id uuid,
  role text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  headcount int not null default 1,
  is_urgent boolean not null default false,
  status text not null default 'open',   -- draft | open | filled | cancelled
  source text not null default 'native', -- native | sheets | csv
  external_ref text,
  instructions text,
  created_at timestamptz not null default now()
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  shift_id uuid not null references shifts(id),
  slot int not null,                     -- 1..headcount; unique per shift
  worker_id uuid references workers(id), -- null = unfilled slot
  status text not null default 'open',   -- open | offered | confirmed | cancelled_worker | cancelled_firm | no_show | completed
  offered_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  notice_hours numeric,                  -- starts_at - cancelled_at, in hours
  created_at timestamptz not null default now(),
  unique (shift_id, slot)
);

-- First yes wins (one statement):
-- update assignments set worker_id = $1, status = 'confirmed', confirmed_at = now()
--   where id = $2 and worker_id is null returning id;

create table requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null references workers(id),
  shift_id uuid references shifts(id),
  type text not null,                    -- time_change | swap | availability | general
  payload jsonb not null default '{}',
  status text not null default 'open',   -- open | approved | declined | auto_resolved | escalated
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table offers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  shift_id uuid not null references shifts(id),
  worker_id uuid not null references workers(id),
  wave int not null,
  channel text not null,                 -- push | whatsapp | sms
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  response text                          -- accepted | declined | expired | filled_elsewhere
);

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
  id bigserial primary key,
  firm_id uuid not null references firms(id),
  actor_type text not null,              -- worker | office | system | ai
  actor_id uuid,
  action text not null,                  -- e.g. 'shift.taken', 'shift.cancelled', 'offer.sent'
  entity_type text not null,
  entity_id uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
-- events is append-only: revoke update/delete from the app role.

-- RLS pattern (repeat for every firm-scoped table):
alter table workers enable row level security;
create policy firm_isolation on workers
  using (firm_id = current_setting('app.current_firm_id')::uuid)
  with check (firm_id = current_setting('app.current_firm_id')::uuid);
```

## Retention (defaults, per firm)

| Data | Keep |
|---|---|
| Raw messages and transcripts | 90 days |
| Call audio | Don't store by default (30 days if enabled) |
| Cases, requests, events, notice report | 12 months (check 2027 rules; may need longer) |
| Workers and credentials | Until the firm deletes them |

A nightly job purges expired data and writes an event for each purge run.
