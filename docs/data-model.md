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
| workers | Casual staff: name, mobile, email, status, roles, how we reach them (WhatsApp or text) and whether they want open-shift alerts | 1 |
| worker_unavailable_days | Days a worker marked as "can't work" on their profile (one row per firm-local day) | 3 |
| worker_site_blocks | Sites a worker may not work at (rules check 9), set by the office with a reason | 10 |
| worker_travel | A casual's travel area: start postcode and its central point, ways of travelling, time limit (12G.1, S8) | 12 |
| travel_estimates | Travel time (and distance by car) from a postcode to a site, by car or public transport, arriving by a time; keyed by postcode, never by person (12G.2, S9) | 12 |
| credentials | Licences/cards per worker: type, number, expiry, status; whether the office has checked it (verified, or a casual's upload waiting or turned down), and the upload it came from (12F.2, S6) | 1 |
| uploads | A casual's staff photos and certificate images (JPEG re-encoded by the server, 1 MB at most): kind, type, size, sha256, the bytes, and the office's check (waiting, approved or rejected with a reason) (12F.2, S7) | 12 |
| credential_rules | Which credentials a role needs, per sector | 2 |
| credential_types | The credential types a firm uses (code, name, sector, whether "applied" may count, whether only the office records it: 12F.2), seeded from its sector's pack | 2 |
| sites | Venues/sites (address; the postcode's central point in lat/lng, looked up when the postcode is saved: 12G.1) | 1 |
| shift_events | Events: the sessions (shifts) of one job, with a "show to casuals" switch. Not `events`, the action log | 12 |
| shifts | Sessions: site, role, start/end, headcount, urgent flag, source; their event, pay rate, post, meeting point, uniform, extra requirements and "show to casuals" switch (12B.1) | 2 |
| assignments | Worker on a shift slot: open → (offered) → confirmed → cancelled/no-show/completed; how a cancellation was made and the strike warning the casual confirmed against (12C.1) | 2 |
| strikes | A strike issued for a casual's own late cancellation (one per booking), its review flag, withdrawal and evidence email (12C.1) | 12 |
| requests | Time changes, swaps, general asks, reviews of refused shifts, and their status | 2 |
| offers | Each offer sent (in a wave, or by the office to one worker) and the response (table Phase 2; waves Phase 4; office offers Phase 5) | 2 |
| shift_reminders | Each 24 h / 2 h reminder a booking got (sent, failed or skipped for quiet hours) | 4 |
| messages | Every inbound/outbound message (WhatsApp, SMS, email, voice, portal) | 7 |
| pay_records | Imported hours, rates, pay dates | 3 |
| pay_queries | Structured pay questions + grouping key + status | 6 |
| events | Append-only action log (the evidence trail) | 1 |
| magic_links / sessions / otp_codes | Login (hashes only, never raw tokens or codes) | 1 |
| auth_throttle | Rate-limit counters for login and OTP requests, and the shifts line's unknown-number alerts (HMAC-keyed buckets) | 1 |
| api_keys | A planner's API keys: a label, the key's sha256 and last 4 characters (never the key), who made and revoked it, when last used (12J.1, S11) | 12 |
| firm_secrets | A firm's own credentials for its systems (its ops portal's API key, its webhook secret), each sealed under a key the database never sees (P5.1, ADR-026) | P5 |
| connector_events | What a connector's source said changed (a session or a staff record, by its ref), one row per event id per source, and what the job made of it (P5.3) | P5 |
| inbound_emails | Emails to a firm's staffing inbox, one row per Message-ID: who it's from, and only a known casual's subject and words, quoted history taken off; how many attachments were left out (P7.1) | P7 |
| push_subscriptions | Web push endpoints per worker | 4 |
| roster_sources | Where a firm's rota lives when it isn't our tables: a Google Sheet (its id, column mapping) or a connector to the firm's own system (which one, its base address; P5.2), with the last sync, error code and sync lease | 2 |
| name_map | What the firm's own system calls a role, qualification, staff type or cancellation reason, mapped to a ShiftDesk code or to skip (P3.2) | P3 |
| metrics_daily | Pilot baseline and daily counts | 5 |

## Firm settings (jsonb on `firms.settings`)

```json
{
  "allocation_mode": "fair_rotation",
  "urgent_window_hours": 24,
  "short_notice_threshold_hours": 48,
  "wave_size": 4,
  "wave_minutes": 15,
  "wave_per_place": 5,
  "escalate_hours_before_start": 3,
  "quiet_hours": { "start": "22:00", "end": "07:00", "urgent_override": true },
  "credential_applied_allowance_pct": 15,
  "min_rest_hours": 11,
  "weekly_hours_cap": 48,
  "travel_buffer_minutes": 0,
  "approve_mode": true,
  "auto_replies": false,
  "sign_off": "Acme Events Shift Team",
  "pay_digest": { "time": "09:00", "days": ["mon", "tue", "wed", "thu", "fri"] }
}
```

`pay_digest` (built, `src/lib/pay/digest-schedule.ts`): when the payroll digest goes, firm-local.
Read field by field: a time or day list that makes no sense gets the default (09:00, Monday to
Friday); `"days": []` means no scheduled digest (payroll can still send one from its page). There's
no settings screen for it yet.

`auto_replies` (P4.7, `src/lib/inbound/limits.ts`): whether the shifts line answers WhatsApps and
texts by itself. Only `true` turns it on; missing or anything else is off, the default. Off,
nothing goes back by WhatsApp or text, and every casual's message waits for the office in Need a
person (`docs/messaging-templates.md`, "Notification policy"). The made-up firms in the seed have
it on.

`firm_system_sends` (P2.3, `src/lib/notices/who-sends.ts`; "Connecting the firm's systems" 9 and
17): whether the firm's own system (its rota sheet, or its CRM through the API: P5) reminds the
casuals it books. Only `true` turns it on; off, the default, ShiftDesk reminds every booking. On,
no 24-hour or 2-hour reminder goes from ShiftDesk for a booking whose `assignments.booked_via` is
sheet or api; offers and the office's change and cancellation notices still go. A booking
confirmation only ever goes for the office's own booking in ShiftDesk, either way.

`login_by_email` (P2.6, `src/lib/auth/login-channel.ts`; "Connecting the firm's systems" 16):
whether a casual's login link and pay-page code may go by email. Only `true` turns it on; missing
or anything else is off, the default. It matters only when there's no text sender
(`MESSAGING_TRANSPORT=none`, P2.5): then, on and with an address held for the casual, the link or
code goes by email (`docs/messaging-templates.md` "Email to casuals"); off, or no address, nothing
is made and the miss is logged (`no_channel`). With a text sender they go by WhatsApp either way.
The login, Pay, Help and Profile pages say which way it goes by the same two facts (P2.7,
`src/lib/portal/login-way.ts`).

`pay_calendar` (P3.1, `src/lib/pay/calendar.ts`; "Connecting the firm's systems" 1, replacing
D8): `{ "days": 14, "anchor": "2026-03-02", "pay_day_after": 5, "label": "cycle" }`, the firm's pay
periods: 7 or 14 days counted from `anchor`, a Monday that starts period 1 (needed for 14), each
paid `pay_day_after` days after it ends on a Sunday (0 to 27; 5 is the Friday after), called
`week` or `cycle` (the default: week for 7 days, cycle for 14). Read whole: nothing set, or
anything the app can't read, is today's rule, ISO weeks, Monday to Sunday, paid the Friday after.
Set by the owner with `npm run firm:settings` (`pay_calendar.days`, `.anchor`, `.pay_day_after`,
`.label`), which refuses a part that would leave the whole unreadable (fortnights without their
start; going back to weeks, set `pay_calendar.days=7` before `pay_calendar.anchor=none`). A
period's number counts on from the anchor's (1), and its fortnights run on unbroken, across New
Year: the year-end rule waits for the firm's payroll (`docs/discovery-axlr8.md` §5.5), and could
move the periods themselves (a new cycle 1 on Mon 4 Jan 2027 would shift every fortnight from Mon
28 Dec 2026 by a week), not only their numbers. Pay-query grouping uses it now: a new query is keyed
on the firm's period at once, and the open ones follow at the next regroup (the payroll digest, or a
pay import). Home reads it (Phase 25.2). Payroll's pay-query headings and the digest's headline
still say "the week of" its first Monday, and the dashboards and the pay page read weeks, until the
office's half of Phase 25.2, so leave a live firm on weeks until then.

(The 48-hour short-notice threshold is a placeholder until the 2027 regulations are final.)

`strikes` (12B.7): `{ "email": "…", "email_verified_at": "2026-11-02T09:00:00.000Z" }`, the
strikes team's address (no default) and when it was confirmed by its emailed link
(`src/lib/office/strikes-email.ts`). Admins set the address on Settings; strike evidence only ever
goes to a confirmed one. The app's login can't update `firms` at all: the only way it changes
`firms.settings` is the owner-run function `app_set_firm_setting(key, value)` (migration 0036,
checks tightened in 0037; `SECURITY DEFINER`, `search_path` pinned, callable only by the app
role, for the current firm only). It accepts `strikes.email` (an address, or NULL to clear it)
and `strikes.email_verified_at` (an ISO time in UTC such as `2026-11-02T09:00:00.000Z`, or NULL;
never a word like `now` or `infinity`), refuses every other key (`retention.*` first among them),
clears the confirmed time when the address changes, needs an address before a time, and refuses
`settings` or `settings.strikes` that aren't JSON objects rather than replacing them. Every other setting stays with the owner (`npm run firm:settings`).

`webhook` (12J.2, S11 (b); migration 0047): `{ "url": "https://…", "signing_version": 3 }`, the
firm's planner's webhook address (no default; a secret: never logged, shown on the page as its host
and last 4 characters) and the version its signing secret is derived from
(`src/lib/integrations/secrets.ts`; the secret itself is never stored). `app_set_firm_setting()`
also accepts `webhook.url` (an `https://` address of at most 500 characters, or NULL to remove it;
the same address again changes nothing) and `webhook.rotate` (NULL only, and only while an address
is set). Each adds 1 to `signing_version`, which no call can set or lower, so an old signing secret
never comes back. Admins change it on Integrations (`src/lib/office/webhook-settings.ts`), logged
`firm.settings_changed` with the keys, what changed and the version's old and new numbers.

The owner's strike settings (12C.1), in the same object, read by `src/lib/strikes/settings.ts`
(a value out of range is ignored for the default) and set with `npm run firm:settings`:
`strikes.enabled` (true, P3.4: only `false` switches strikes off, and then a casual's own
cancellation is never a strike, its decision "strikes_off"; those given stay as they are),
`strikes.notice_hours` (48, 1 to 336: a casual's own cancellation with less notice is a strike;
kept apart from `short_notice_threshold_hours`, the law's), `strikes.live_days` (90, 1 to 365:
how long a strike counts) and `strikes.keep_months` (12, 7 to 72: when its row is deleted, never
inside the 6-month tribunal limit; `firm:settings` accepts it only if it covers `live_days` plus 6
months, a month counted as 28 days, so with 90 days counting the shortest is 10).

The owner's travel settings, read by `src/lib/travel/settings.ts`: `travel.enabled` (13.4; off
unless exactly `true`): travel areas are on for the firm (off, no casual sees or saves one, and
nothing is filtered, ordered or worked out by distance; the firm's DPIA Part 2 comes first,
`docs/dpia-travel.md`); `travel.default_max_minutes` (12G.1; 45; 30, 45, 60 or 90): a casual's
time limit on `/profile/travel` until they choose their own. Which look-up service is used is a server setting
(`TRAVEL_PROVIDER`), never per firm.

The owner's staff photo setting (12F.2), read by `src/lib/uploads/settings.ts`:
`photo.renewal_months` (36; whole months, 12 to 60): how often a casual's staff photo is due again,
from the day the current one (the latest approved) was uploaded. "Due soon" starts 30 days before
(`EXPIRING_SOON_DAYS`).

## DDL sketch (Postgres)

```sql
create table firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,            -- 2-20 chars a-z0-9-; not www/portal/api/app/admin/xn--
  sector text not null,                 -- 'security' | 'rail' | 'construction' | 'cleaning'
  custom_domain text unique,             -- a lowercase host name (a check); served and approved for a
                                         -- certificate only when domain_verified (Phase 8)
  domain_verified boolean not null default false, -- its CNAME points to <slug>.<base>
                                         -- (`npm run firm:domain`, the owner)
  brand_logo_url text,                  -- https:// only; set with `npm run firm:brand` (the owner)
  brand_primary_color text,             -- #rrggbb only; the firm's bar (Phase 8); settings.sign_off
                                         -- is its own sign-off, if any (else "[Firm] Shift Team")
  timezone text not null default 'Europe/London',
  shifts_line_e164 text unique,          -- the firm's own WhatsApp/text/calls number, E.164 (a CHECK
                                         -- like workers.mobile_e164's); null
                                         -- until bought (Twilio). One number, one firm. Set by
                                         -- `npm run firm:line` (the owner), never by the app.
  inbox_address text unique,             -- P7.1: the firm's staffing inbox at our email provider
                                         -- (its own mailbox forwards there), lower case, a CHECK
                                         -- on its form. One address, one firm. Set by `npm run
                                         -- firm:inbox` (the owner), never by the app; found for an
                                         -- incoming email by app_firm_by_inbox() (0060).
  settings jsonb not null default '{}',
  agreement_signed_on date,              -- Gate B: the day the agreement and DPA were signed, set by
                                         -- `npm run firm:agreement` (the owner), never by the app.
                                         -- Null: a live database takes no imported staff data and
                                         -- connects no rota sheet for the firm (Phase 10)
  created_at timestamptz not null default now()
);
-- app_firm_by_line(number) (migration 0021): the firm for an incoming message's "To" number, before
-- any firm is known (runs as the owner, directory fields only; like app_resolve_firm for a host).

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
  lat numeric(9,6), lng numeric(9,6),   -- the postcode's central point (12G.1), saved with it
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
  mobile_e164 text,                      -- empty only once erased (below)
  email text,                            -- kept lowercase and checked as an address by upsertWorker (P2.6; the app's rule, no database check)
  status text not null default 'active', -- active | inactive | blocked
  roles text[] not null default '{}',
  external_ref text,                     -- the sheet's staff id (Sheets firms); null otherwise
  notify_channel text not null default 'whatsapp', -- whatsapp | sms (profile page; Phase 3)
  offer_alerts boolean not null default true,      -- tell me about open shifts (profile page)
  sms_opted_out_at timestamptz,          -- they replied STOP to a text (Phase 7): no texts from any
                                         -- sender until START (src/lib/notify/send.ts)
  office_deactivated_at timestamptz,     -- the office made them inactive (Phase 10): no sheet or
                                         -- file makes them active again, only the office (clears it)
  erased_at timestamptz,                 -- GDPR deletion (Phase 8, src/lib/gdpr/worker-erase.ts)
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, mobile_e164),
  unique (firm_id, external_ref),
  -- A worker has a mobile until erased. An erased row stays (offers, bookings, cancellations and
  -- pay lines point at it: the notice report's evidence) and is exactly "Deleted worker": no
  -- mobile, email or staff id, no roles, inactive, texts not marked off.
  check ((erased_at is null and mobile_e164 is not null)
      or (erased_at is not null and mobile_e164 is null and email is null and external_ref is null
          and first_name = 'Deleted' and last_name = 'worker' and status = 'inactive'
          and roles = '{}' and sms_opted_out_at is null))
);

-- Phase 4 (src/lib/db/schema/people.ts). A phone's web push address for a worker (the profile's
-- "Turn on notifications"), one row per endpoint in a firm (a new login on the same phone takes it
-- over). Deleted with the worker and when the push service says it's gone. Never logged.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers, on delete cascade
  endpoint text not null,                -- https only, at most 2048 characters
  p256dh text not null,                  -- the browser's keys for encrypting the push
  auth text not null,
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, endpoint)
);

-- Phase 3 (src/lib/db/schema/people.ts). Days the worker can't work, set on their profile: today
-- to 180 days ahead, at most 60 upcoming. The rules engine's check 8 refuses a booking on a shift
-- touching one (the office may override with a reason). Marking a day never cancels a booking
-- already made. Removed with the worker (on delete cascade). Events: worker.unavailable_added and
-- worker.unavailable_removed ({day}).
create table worker_unavailable_days (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers, on delete cascade
  day date not null,                     -- firm-local
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, worker_id, day)
);

-- A site a worker may not work at (Phase 10; rules check 9, "blocked site"). Added and removed by
-- the office on the worker's page (src/lib/office/worker-access.ts), each with a reason from a
-- fixed list; removing one deletes the row. Events: worker.site_blocked {workerId, siteId, reason,
-- futureBookings} and worker.site_unblocked {workerId, siteId, reason}.
create table worker_site_blocks (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers, on delete cascade
  site_id uuid not null,                 -- (firm_id, site_id) -> sites, on delete cascade
  reason text not null,                  -- client_asked | incident | other
  blocked_by uuid,                       -- (firm_id, blocked_by) -> office_users
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, worker_id, site_id)
);

-- A casual's travel area (12G.1; S8; docs/office-v2.md 4.6, 5.4; docs/dpia-travel.md), set on
-- /profile/travel: where they start from (a postcode, which needn't be home, and its central point
-- from the geocoder: never a house number, GPS or movement), how they travel and their time limit.
-- A table of its own so the workers_erased check is unchanged. The office reads the district only
-- (split_part(start_postcode, ' ', 1), in SQL). Deleted by the casual ("Remove my travel area"),
-- when the office makes them inactive as "They've left", and on erasure; in their export. Events:
-- travel.profile_changed {changed: ["postcode" | "modes" | "maxMinutes"], maxMinutes} and
-- travel.profile_removed {}: never the postcode or its point.
create table worker_travel (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers, on delete cascade
  start_postcode text not null,          -- tidy UK format, e.g. 'ZZ1 1AA'
  lat numeric(9,6) not null, lng numeric(9,6) not null,
  modes text not null,                   -- car | public_transport | both
  max_minutes integer not null,          -- 30 | 45 | 60 | 90
  privacy_notice_version text not null,  -- the page's privacy line they saw (travel-v1)
  updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, worker_id)
);

-- Travel estimates (12G.2; S9, built narrower; docs/office-v2.md 5.4): how long from a postcode to a
-- site by one way of travelling, arriving by a time (30 minutes before a session starts). Keyed by
-- the postcode, never by the person; worked out by the travel job (src/lib/travel/estimates.ts),
-- never by a page. The app adds and deletes rows and updates only the result columns
-- (COLUMN_UPDATES). Deleted when they expire (7 days after their last session, by the retention
-- purge, even during a hold) and with a site's old ones when its postcode changes. Not in the
-- firm's data export (they're keyed by casuals' full postcodes, which the office never sees).
create table travel_estimates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  origin_postcode text not null,         -- tidy UK format, e.g. 'ZZ2 2BB'
  site_id uuid not null,                 -- (firm_id, site_id) -> sites, on delete cascade
  mode text not null,                    -- car | public_transport
  arrive_by timestamptz not null,        -- the session's start minus 30 minutes
  minutes integer,                       -- 0 to 90; null: not within 90 minutes
  metres integer,                        -- the road distance, by car only
  provider text not null,                -- fake | traveltime
  computed_at timestamptz not null,
  expires_at timestamptz not null,       -- the last session's end + 7 days
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, origin_postcode, site_id, mode, arrive_by)
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
  -- The office's check (S6; 12F.2): 'verified' is the office's own (imported, recorded, or an upload
  -- a named person approved: verified_at/by filled); 'waiting' and 'rejected' are a casual's upload
  -- not (yet) accepted. Only verified records count anywhere (the rules engine, the expiry scan,
  -- the dashboard, the import's "latest record"), and an unchecked one is always stored as expired with
  -- its upload (credentials_unchecked_never_valid), so a reader that missed the filter still
  -- couldn't count it.
  check_state text not null default 'verified',  -- verified | waiting | rejected
  rejected_reason text,                  -- blurry | wrong_document | expired | doesnt_match | other; only when rejected
  evidence_upload_id uuid,               -- (firm_id, evidence_upload_id) -> uploads(firm_id, id)
  created_at timestamptz not null default now()
);

-- Photos and certificate images (S7; 12F.2; docs/office-v2.md 5.5), in Postgres so RLS, erasure and
-- export cover them. Re-encoded by the server (src/lib/uploads/image.ts): always a JPEG, no location
-- or other hidden data, 1 MB at most. The app may add, check (status, checked_by, checked_at,
-- reject_reason: COLUMN_UPDATES) and delete them (a waiting one replaced, the retention purge,
-- erasure), never rewrite the bytes or whose they are. Served only by /files/[id]. The current
-- staff photo is the latest approved one, so workers has no photo column. The JSON exports carry
-- every column but `data`.
create table uploads (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers(firm_id, id), on delete cascade
  kind text not null,                    -- photo | certificate
  credential_type text,                  -- a certificate's type code; null for a photo (check)
  content_type text not null,            -- always 'image/jpeg'
  size integer not null,                 -- = octet_length(data), 1 to 1,000,000
  sha256 text not null,                  -- hex: the fingerprint the exports carry
  data bytea not null,
  uploaded_by text not null default 'casual',
  status text not null default 'waiting', -- waiting | approved | rejected
  checked_by uuid,                       -- (firm_id, checked_by) -> office_users(firm_id, id)
  checked_at timestamptz,                -- set with checked_by, when not waiting (check)
  reject_reason text,                    -- as credentials.rejected_reason; only when rejected
  created_at timestamptz not null default now(),
  unique (firm_id, id)
);
-- One waiting per casual, kind and type: a new one replaces it.
create unique index uploads_one_waiting on uploads (firm_id, worker_id, kind, coalesce(credential_type, ''))
  where status = 'waiting';

-- The rota (Phase 2, src/lib/db/schema/roster.ts). Its foreign keys have no ON DELETE action:
-- deleting a worker, site, shift or office user that rota rows point at fails, so history is
-- never erased or orphaned. The app role may not DELETE shifts, assignments, requests, offers or shift_reminders
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
  -- Only the office records it (12F.2, migration 0043): a casual can't upload an image of it. From
  -- the pack's `officeRecorded` (right to work, CSAS, drugs and alcohol tests, rail medicals, DBS),
  -- backfilled for existing firms; a firm may mark its own types too, and the packs' list always
  -- holds (`casualMayUpload`).
  office_recorded boolean not null default false,
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
  any_of_types text[] not null default '{}', -- and one of these (P3.3, Rules 3; migration 0052):
                                         -- two or more codes in the same format, none also in
                                         -- required_types; '{}' = no group. The security pack's
                                         -- security_officer: {SIA_SG,SIA_DS} (rules a firm already
                                         -- has keep theirs)
  created_at timestamptz not null default now(),
  unique (firm_id, role)
);

-- Events (Phase 12, 12B.1; docs/office-v2.md 3.3, S1). Every shift belongs to one. "Shifts for an
-- event" makes its own (planner_ref empty); the planner API finds or makes its own by the
-- planner's ref (source api, 12J.1). The sheet sync, the file import, "New shift" and
-- migration 0035 put a new shift in its site and day's automatic event: named "Acme Demo Arena ·
-- Sat 10 Oct" ("Sat 10 Oct" with no site; a long site name is cut to fit 200 characters), the day
-- being the shift's start in the firm's time zone, and found again by its key in planner_ref,
-- 'auto:{site id or none}:{yyyy-mm-dd}' (src/lib/roster/shift-events.ts). Migration 0035 grouped
-- the shifts already there the same way (the first migration that changes data). A shift whose
-- date or site later changes keeps its event. The switch is ShiftDesk's own, never read from or
-- written to a planner. Never deleted, only hidden: the app may insert rows and update only
-- showing_to_casuals and name (the planner renames its own events: TABLE_ACCESS SELECT, INSERT;
-- COLUMN_UPDATES), so a key, site, source or firm can't be rewritten. 'auto:' keys are reserved:
-- the planner API refuses a ref that starts with it.
create table shift_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  name text not null,                    -- 1..200 characters
  site_id uuid,                          -- (firm_id, site_id) -> sites(firm_id, id)
  source text not null default 'native', -- native | sheets | csv | api: who made it (an
                                         -- automatic event's earliest shift; api: the planner)
  planner_ref text,                      -- 1..200; an automatic event's 'auto:' key, or the
                                         -- planner's own id for its event (source api)
  showing_to_casuals boolean not null default true,
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, source, planner_ref)  -- one event per planner ref (12J.1; NULLs don't collide),
                                         -- so two PUTs naming one new event share its row
);
create unique index shift_events_auto_key on shift_events (firm_id, planner_ref)
  where planner_ref like 'auto:%';       -- one automatic event per firm, site and day

create table shifts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  event_id uuid not null,                -- (firm_id, event_id) -> shift_events(firm_id, id); in
                                         -- TypeScript shiftEventId (eventId is a log entry's id)
  site_id uuid,                          -- (firm_id, site_id) -> sites(firm_id, id)
  role text not null,                    -- snake_case
  starts_at timestamptz not null,
  ends_at timestamptz not null,          -- check: ends_at > starts_at
  headcount int not null default 1,      -- 1..1000
  is_urgent boolean not null default false, -- a dropout inside urgent_window_hours, or the office (src/lib/roster/urgent.ts)
  status text not null default 'open',   -- draft | open | filled | cancelled
  source text not null default 'native', -- native | sheets | csv | api (the planner API, 12J.1:
                                         -- the office's whole-session edits, moves and cancels
                                         -- of these get "planner")
  external_ref text,                     -- the row's key in the firm's sheet or import, or the
                                         -- planner's ref for the session (source api)
  instructions text,
  synced_holders text[],                 -- Sheets: the "Assigned" cell's staff ids after the last
                                         -- successful sync (the three-way merge's base; names the
                                         -- sync couldn't book left out, so they're tried again).
                                         -- A connector's session (P5.5): the staff refs the system
                                         -- listed at the last read, less those it couldn't book
                                         -- here (a booking cancelled here stays in, so it isn't
                                         -- booked again)
  source_read_at timestamptz,            -- a connector's session only (P5.5's review): when its
                                         -- record was last read and applied; an older read
                                         -- changes nothing, and it is the session's "last read"
                                         -- for a cancellation's notice (null: not a connector's;
                                         -- shifts_source_read_api_only)
  sheet_issues jsonb,                    -- Sheets only (Phase 10): what the sheet asks for that the last
                                         -- sync couldn't do ({change?: {fields, wanted, reason, workers},
                                         -- names?: [{workerId, codes, dropped?}]}), for the dashboard; null: none
  -- The session's own details (12B.1, S2): set in ShiftDesk's session editor for every source;
  -- the sheet sync and the file import never write them, nor the switch.
  pay_rate_pence int,                    -- whole pence an hour, 0 or more
  post text,                             -- 1..200 characters
  meeting_point text,                    -- 1..300; public to casuals who can see the session
  uniform text,                          -- 1..300; likewise (instructions: booked casuals only)
  required_credentials text[] not null default '{}', -- qualification codes needed on top of the
                                         -- role's (all of them), at most 20; the same format check
                                         -- as credential_rules.required_types. Checked by the rules
                                         -- on top of the role's (12B.3). Logged as "requirements",
                                         -- never by this name
  showing_to_casuals boolean not null default true, -- the session's own switch: casuals see it
                                         -- only while this and its event's are on
                                         -- (src/lib/roster/visibility.ts, 12B.4)
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, source, external_ref) -- one shift per sheet/import row or planner ref (NULLs
                                         -- don't collide)
);
-- Indexed by (firm_id, starts_at), (firm_id, event_id) and (firm_id, ends_at): sessions by their
-- start, an event's sessions, and sessions still running or to come (the last two for a big firm,
-- PLAN.md P4.1).

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
  override_reason text,                  -- the office's typed reason for placing them despite a rule
                                         --   (Phase 10: here, not in the log; cleared by erasure and
                                         --   the retention purge)
  notice_hours numeric(8,2),             -- starts_at - cancelled_at, in hours; negative if after the start
  office_kept_at timestamptz,            -- Phase 10: the office kept it though its worker stopped being
                                         -- active or was blocked from the site (the dashboard's "Bookings
                                         -- to check"); cleared when that happens again
  cancel_via text,                       -- 12C.1: app | office | sheet | import | api (the planner
                                         -- API, 12J.1); empty on older rows
  cancel_asked_by text,                  -- P3.4: who asked for it, apart from who carried it out
                                         -- (status) and where (cancel_via): casual (their own
                                         -- cancel) | firm (the office's) | client | unknown (a
                                         -- rota sheet's, a file's or a planner's: their data
                                         -- doesn't say). Set by every cancellation (the plug's
                                         -- markCancelled, a caller that knows may say); only on a
                                         -- cancelled row; migration 0053 filled the cancellations
                                         -- there were from their status and cancel_via (none:
                                         -- from the session's source). Each shift.cancelled log
                                         -- entry says it too (askedBy); the notice report reads
                                         -- the entry's, else the booking's, and counts by it
  booked_via text,                       -- P2.2: where the booking was made: app (the casual took it,
                                         --   or accepted an offer) | office | sheet | api (the firm's
                                         --   own system, P5); set with the booking, in its
                                         --   transaction; empty on an open slot; "who sends what"
                                         --   reads it (P2.3); migration 0049 filled the bookings there
                                         --   were from their shift.assigned lines, firm by firm (none:
                                         --   the office's)
  strike_warning_version text,           -- 12C.1: on a casual's own cancellation in the app, the strike
  strike_warning_shown_at timestamptz,   --   warning on screen when they confirmed (its version) and
                                         --   then; both or neither, only on cancelled_worker
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  check ((status = 'open') = (worker_id is null))
);
create unique index assignments_one_live_per_slot on assignments (firm_id, shift_id, slot)
  where status not in ('cancelled_worker', 'cancelled_firm');
create unique index assignments_one_live_per_worker on assignments (firm_id, shift_id, worker_id)
  where worker_id is not null and status not in ('cancelled_worker', 'cancelled_firm');
-- Also indexed by (firm_id, worker_id) and (firm_id, cancelled_at): a casual's bookings, and the
-- firm's cancellations by when (P4.1).

-- Strikes (12C.1; src/lib/strikes/): a row only for a strike issued, by strikeDecision() inside
-- cancelBooking()'s transaction. The app reads and adds rows and may change only the review,
-- withdrawal and evidence columns; app_purge_old_strikes() deletes them (below).
create table strikes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers
  assignment_id uuid not null,           -- (firm_id, assignment_id) -> assignments; one strike per booking
  shift_id uuid not null,                -- (firm_id, shift_id) -> shifts
  notice_hours numeric(8,2) not null,    -- as on the booking; always under threshold_hours
  threshold_hours int not null,          -- the firm's strikes.notice_hours then
  issued_at timestamptz not null,
  expires_at timestamptz not null,       -- issued_at + strikes.live_days; "expired" is worked out
  status text not null default 'live',   -- live | withdrawn
  review_needed boolean not null default false, -- a person should look: needs a review reason
  review_reasons text[] not null default '{}',  -- unwell | family_or_caring (never in the log)
  reviewed_by uuid, reviewed_at timestamptz,     -- "Keep strike" (12C.5); both or neither
  withdrawn_by uuid, withdrawn_at timestamptz,   -- withdrawn: both; live: neither
  withdrawn_reason text,                 -- 1-500 characters; cleared when the casual is erased
  evidence_email_status text,            -- pending (queued with the strike) | sent | failed | not_set_up
                                         -- (no confirmed strikes-team address); 12C.4
  evidence_email_to text, evidence_email_sent_at timestamptz,  -- where and when it went
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, assignment_id)
);

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
  shift_id uuid,                         -- (firm_id, shift_id) -> shifts; required for time_change, swap and review
  type text not null,                    -- time_change | swap | availability | general | review
                                         -- review (Phase 3): "Ask the office to review" a shift the rules
                                         -- refused; payload {codes, reasons, note}: the rules' codes and the
                                         -- words the worker saw, and their optional note; or, from "Tell us
                                         -- what happened" after cancelling (12C.1), {codes: [],
                                         -- reasons: [], note, cancellation}: the cancelled booking's
                                         -- reference (not a rules review: waitingReview() skips it)
  payload jsonb not null default '{}',   -- a JSON object; shape validated in code per type
  status text not null default 'open',   -- open | approved | declined | auto_resolved | escalated
  resolved_by uuid,                      -- (firm_id, resolved_by) -> office_users
  resolved_at timestamptz,
  resolution_note text,                  -- the office's note to the worker with its answer (Phase 5):
                                         -- approved/declined only, 1-500 characters; free text, so
                                         -- never copied into events
  -- open/escalated: neither set. approved/declined: both set. auto_resolved: resolved_at only.
  -- A question (general) answered is stored approved and shown "Answered" (12D.1).
  message_id uuid,                       -- 12D.1 (S5): the shifts-line message a question came from,
                                         -- (firm_id, message_id) -> messages ON DELETE SET NULL
                                         -- (message_id): the 90-day purge or an erasure clears the link,
                                         -- never the request (migration 0044, by hand). One request per
                                         -- message (unique (firm_id, message_id) where set). Until 0044 the
                                         -- id was payload.messageId; 0044 moved it here
  created_at timestamptz not null default now(),
  unique (firm_id, id)
);

create table offers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  shift_id uuid not null,                -- (firm_id, shift_id) -> shifts
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers
  wave int,                              -- >= 1: sent in a wave; null: sent by the office
  offered_by uuid,                       -- (firm_id, offered_by) -> office_users; set exactly when wave is null
  channel text not null,                 -- push | whatsapp | sms | email (P2.4: the way it went)
  sent_at timestamptz not null default now(),
  responded_at timestamptz,              -- set exactly when response is set
  response text,                         -- accepted | declined | expired | filled_elsewhere | failed (couldn't be sent)
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, shift_id, worker_id, wave) -- a retried offer-wave job (key shift:wave) sends nothing new
  -- plus a unique index on (firm_id, shift_id, worker_id) where wave is null: one office offer
  -- per worker per shift
);
-- Indexed by (firm_id, worker_id, sent_at) for the daily offer cap, and by (firm_id, sent_at) for
-- the firm's offers by when (P4.1).

-- Each shift reminder a booking got, or why not (src/lib/reminders/send.ts). Written before the
-- message goes. Evidence in a no-show dispute: the app never deletes one.
create table shift_reminders (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  assignment_id uuid not null,           -- (firm_id, assignment_id) -> assignments
  kind text not null,                    -- 24h | 2h
  starts_at timestamptz not null,        -- the start time it was for (a moved shift gets new ones)
  status text not null,                  -- sending (claimed; left so if the job stopped: may have gone, never resent)
                                         -- | sent | failed (not resent: it may have arrived) | skipped (quiet hours)
  channel text,                          -- push | whatsapp | sms | email (P2.4); null exactly when skipped
  recorded_at timestamptz not null default now(), -- when it was claimed or skipped
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, assignment_id, kind, starts_at) -- claimed once: a retried or doubled job sends nothing twice
);

-- Pilot metrics (Phase 5, docs/pilot-playbook.md; src/lib/db/schema/metrics.ts): one number per
-- firm, kind, day and metric. baseline: the office's week-0 figures (day: the week's first day);
-- tally: the office's weekly count of emails, calls, WhatsApp and resourcer hours (day: that
-- week's Monday); daily: the nightly rollup's counts for one firm-local day
-- (src/lib/metrics/rollup.ts, the last 7 days recomputed each night). Figures only; no DELETE.
create table metrics_daily (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  day date not null,
  kind text not null,                    -- baseline | tally | daily
  metric text not null,                  -- e.g. calls_per_day, portal_actions (^[a-z][a-z_]{0,59}$)
  value numeric(12,2) not null,          -- >= 0
  recorded_by uuid,                      -- (firm_id, recorded_by) -> office_users; set exactly when kind <> 'daily'
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, kind, day, metric)
);

-- Where a firm's rota lives when it isn't our tables (native firms have no row): a Google Sheet,
-- or (P5.2, migration 0055) a connector reading the firm's own system, whose changes go through
-- exactly the planner API's rules as the firm's planner (src/lib/roster/firm-caller.ts: allowed
-- only while its source is on, its row held for the change, and never while the firm has a live
-- planner API key: one planner writes its sessions, not two). No secrets: the firm shares its
-- sheet with our service account (the key is in the worker's environment), and a connector's
-- credentials are in the secret store (firm_secrets). Rows are added and changed only by the owner
-- (npm run firm:sheet; a connector's in the tests only until P5.3); the app role may read them
-- and update only the five sync status columns (last_synced_at, last_near_synced_at,
-- last_attempted_at, last_error_code, sync_started_at: a column-level grant).
create table roster_sources (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  kind text not null,                    -- 'sheets' | 'connector'
  enabled boolean not null default true,
  spreadsheet_id text,                   -- a sheet's only: ^[A-Za-z0-9_-]{20,100}$
  connector text,                        -- a connector's only: 'demo_portal' (the made-up portal)
  base_url text,                         -- a connector's only: https on 443, a public DNS name
                                         -- (no IP, bare, .localhost, .internal or .local name),
                                         -- a path with no dot segment; nothing else; <= 300
  mapping jsonb not null,                -- a sheet's tabs and header names ('{}' for a connector)
  last_synced_at timestamptz,            -- a connector's: its last full pull (P5.4)
  last_near_synced_at timestamptz,       -- a connector's only: its last pull of the next 48 hours
  last_attempted_at timestamptz,         -- the last sync that ran, success or not (for back-off)
  last_error_code text,                  -- a code only (^[a-z_]{1,50}$), never a message or cell
  sync_started_at timestamptz,           -- the sync's lease (a sheet's 5 minutes, a connector's 10)
  created_at timestamptz not null default now()
);
-- roster_sources_kind_fields: a sheet has its spreadsheet and nothing of a connector's; a
-- connector its connector and base address and no spreadsheet.
create unique index roster_sources_one_enabled_per_firm on roster_sources (firm_id) where enabled;
-- One spreadsheet, one firm (audit L45): across firms on purpose (the app can't write the column).
create unique index roster_sources_spreadsheet_id_key on roster_sources (spreadsheet_id);

-- A firm's name map (P3.2, migration 0051; src/lib/roster/names.ts): what its own system calls a
-- role ("Door Supervisor (NLW)", "12D"), a qualification, a staff type or a cancellation reason,
-- and the ShiftDesk code it stands for, or skip (code null: "Holiday", "Not Set"). The rota sheet's
-- sync and the file import read role names through it, and the credentials import a
-- qualification's: a mapped name is its code, a skipped one is left off a worker's roles and its
-- shift or credential row isn't brought in (the import counts it as ignored; the sync counts it,
-- and reports skipped_live for a row that made a session still to come, which stays as it is), and
-- a name the firm hasn't mapped is read as before (normaliseRole: a bad role if it can't be, so
-- never offered). Staff types and cancellation reasons, which neither the sheet nor a file
-- carries, and a role's pay rate are for the connector (P5): the sheet and the import never write
-- a session's pay (S2). Set only by the owner (npm run firm:names), logged firm.settings_changed
-- {keys: ["name_map.<kind>"], name, from, to}, with fromRatePence and toRatePence when either
-- side has a pay rate; the app role may only read it.
create table name_map (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  kind text not null,                    -- role | qualification | staff_type | cancellation_reason
  outside_name text not null,            -- 1-200 characters, as names.ts keys it: trimmed, lower
                                         -- case, one space between words, no control or format
                                         -- characters
  code text,                             -- null: skip. A role as the rules spell it; a qualification
                                         -- one of the firm's credential types; a staff type casual;
                                         -- a cancellation reason who asked (P3.4): casual | firm |
                                         -- client | unknown (the database checks the format)
  pay_rate_pence integer,                -- a role's only, not skipped, 0 to 100000 (whole pence an hour)
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, kind, outside_name)
);

create table messages (                 -- built in Phase 7 (migrations 0022-0024): WhatsApp, texts, calls
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  direction text not null,               -- in | out
  channel text not null,                 -- whatsapp | sms | voice (a call, or its voicemail)
  provider_message_id text not null,     -- Twilio's MessageSid (a call: its CallSid; a voicemail: its
                                         -- RecordingSid), or the transport's id for a reply;
                                         -- unique per firm (golden rule 3: a repeat stores nothing)
  worker_id uuid,                        -- (firm_id, worker_id) -> workers; set when the sender is one
  from_e164 text,                        -- E.164; empty only on an incoming voice row (a call or
                                         -- its voicemail) from a withheld number (a check says so)
  to_e164 text not null,                 -- inbound: the firm's shifts line
  body text,                             -- at most 1600; the worker's words: never copied into events
  handled_as text,                       -- keyword | ai | office | unknown | opt_out (inbound only)
  intent text,                           -- shifts | cancel | pay | office
  handled_at timestamptz,                -- the reply job claimed it (at most one reply)
  reply_to uuid,                         -- outbound: (firm_id, reply_to) -> the message it answers;
                                         -- indexed (firm_id, reply_to) for Enquiries (12D.1, S5). The
                                         -- office's reply on Enquiries is stored when sent from the page,
                                         -- provider_message_id "office-reply:{uuid}" until the
                                         -- enquiry-reply job has sent it (then the provider's id)
  twilio_opt_out text,                   -- stop | start: Twilio's own opt-out handling acted on this
                                         -- incoming text (and confirmed it); null otherwise
  created_at timestamptz not null default now(),
  unique (firm_id, id), unique (firm_id, provider_message_id)
);

-- Phase 3 (src/lib/db/schema/pay.ts). The payroll's figures as imported (`npm run import --kind
-- pay`), never worked out here. The app may insert and update, not delete (NO_DELETE, like the
-- rota's evidence); the worker link has no ON DELETE action. Events: pay_record.imported
-- ({source, periodStart, periodEnd}) and pay_record.updated ({source, fields}): never amounts.
create table pay_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers(firm_id, id)
  period_start date not null,
  period_end date not null,              -- >= period_start
  hours numeric(6,2) not null,           -- 0 to 1000
  rate_pence int not null,               -- >= 0
  gross_pence int,                       -- >= 0; only when payroll gave it
  pay_date date,
  source text not null default 'import', -- import
  updated_at timestamptz,                -- set when a re-import changes the line
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, worker_id, period_start, period_end, rate_pence)  -- one line per period and rate
);

-- A worker's structured pay question (Phase 6, src/lib/portal/pay-queries.ts), raised behind the
-- pay-page code. The day worked is always set: the shift's day, or the day they typed. Details are
-- free text: kept here, never copied into events. No DELETE for the app role.
create table pay_queries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  worker_id uuid not null,               -- (firm_id, worker_id) -> workers
  shift_id uuid,                         -- (firm_id, shift_id) -> shifts; null for a day typed in
  work_date date not null,               -- the day the question is about (firm time)
  issue_type text not null,              -- missing_hours | wrong_rate | late_pay | other
  details text,                          -- 1-1000 characters, or null
  group_key text,                        -- set by code (src/lib/pay/grouping.ts): the issue and the week (the
                                         -- first Monday of the firm's pay period, P3.1), plus the pay line's
                                         -- rate (wrong rate) or the site (hours missing); "pay1:" versioned
  status text not null default 'open',   -- open | in_digest | resolved
  resolved_by uuid,                      -- (firm_id, resolved_by) -> office_users: who sorted it
  resolved_at timestamptz,               -- when payroll sorted it
  resolution_note text,                  -- payroll's note to the worker, 1-500 characters (typed by a
                                         -- person; sent to the worker, never in an event)
  created_at timestamptz not null default now(),
  unique (firm_id, id)
  -- Only a sorted query carries resolved_by, resolved_at and resolution_note (migration 0019).
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
-- Indexed by (firm_id, created_at) and by (firm_id, entity_id, id): one thing's history (the dashboard's
-- wave status, the action log by shift or worker); and by (firm_id, action, created_at): entries of
-- one kind over a time (the sends the ops alerts count, the webhook status; P4.1).
-- events is append-only: the app role has SELECT and INSERT only, and events has only
-- select and insert policies. data never holds tokens, codes, phones, emails or IPs
-- (recordEvent() refuses anything the log masker would change).
-- Login events (kind worker or office): auth.link_requested (entity login_request; data {kind, matched}),
-- auth.link_sent (magic_link; {purpose, channel, providerMessageId}, + ownDomain: true when the
-- link was on the firm's own domain; channel email for an office user, and for a worker since
-- P2.6 when it went by email: login_by_email), auth.link_send_failed (magic_link; {purpose,
-- channel, code}; or, P2.6, on the worker with {purpose, channel: null, code: no_channel} when
-- nothing could carry it and no link was made), auth.link_rejected
-- (magic_link or none; {kind, reason: unknown|used|expired|wrong_kind|inactive}), auth.login
-- (session; actor worker/office), auth.session_rotated, auth.logout, auth.rate_limited
-- (login_request, magic_link, session, api_key or worker; {limit: "login:mobile" |
-- "login:mobile_day" | "login:ip" | "office:email" | "office:email_day" | "office:ip" |
-- "link_fail:ip" | "otp:worker" | "otp:worker_day" | "api:key" | "push:worker" (13.3) |
-- "take:worker" (13.5) | "strikes_link:…"}; once per window, when the limit is first reached;
-- the worker's own limits name them as the entity). Pay-page codes: auth.otp_requested (session),
-- auth.otp_sent ({channel, providerMessageId}: whatsapp, or email since P2.6),
-- auth.otp_send_failed ({channel, code}; or on the session {channel: null, code: no_channel}, no
-- code made: P2.6), auth.otp_failed ({attemptsLeft}), auth.otp_locked, auth.otp_verified (otp_code).
-- Worker requests (src/lib/portal/requests.ts): request.created (request; actor worker; {type,
-- shiftId}): the typed note and any colleague's name stay on the row (requests.payload:
-- time_change {start, end, note} local "HH:MM" times; swap {swapWith, note}).
-- Cancelling (src/lib/roster/cancel.ts): shift.cancelled (assignment; actor worker or office; {by:
-- worker|firm, shiftId, workerId, noticeHours, strike, place, reopenedId?}); the reason a person
-- typed is only on the row (assignments.cancel_reason). `place` (12C.3) is what became of the
-- place, recorded in the same transaction: reopened (`reopenedId`: the new open row, whose booking
-- is who filled it again), above_places (above the shift's places by then), started (the shift
-- had started), removed ("The client needs fewer staff") or session_cancelled (the whole shift);
-- entries from before it have none. The Sheets sync's adds source and its fixed reason ("Removed
-- on the rota sheet", "Shift cancelled on the rota sheet").
-- Strikes (src/lib/strikes/): strike.issued (strike; actor system; {assignmentId, shiftId, workerId,
-- noticeHours, thresholdHours}); its evidence email (12C.4): strike.evidence_queued (the address
-- confirmed while it waited; {}), strike.evidence_sending and strike.evidence_sent {request,
-- attempt}, strike.evidence_failed {request, attempt, code, retry} (code not_set_up, withdrawn,
-- stopped, not_built, or the error's class), strike.evidence_resend (actor office; {}). The
-- request names the series in base 36 (no run of digits the log would take for a phone number).
-- Never the address: it's on the strike row (evidence_email_to) with the time it went.
-- Booking (src/lib/roster/book.ts): shift.assigned (assignment; actor worker or office; {by:
-- worker|firm, shiftId, workerId, slot, noticeHours, overridden?, reason?}); from the Sheets sync
-- the same with source: sheets and reason "Put on the rota sheet by the office".
-- shift.booking_refused (shift; {by, workerId, codes}) when the rules turn a booking down, and
-- roster.sheet_booking_refused (shift; {source, workerId, codes}) for a sheet name (codes may
-- include settings_invalid when the firm's rules settings are broken).
-- Credential expiry (actor system): credential.expiry_warning (credential; {type, expiresOn, days,
-- daysLeft, channel, providerMessageId}; one caught up after a crash: {type, expiresOn, days,
-- unconfirmed: true}, no channel, 14.3), credential.expired (credential; {type, expiresOn,
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
  request_id uuid,                       -- the send-login-code job's key: a retry sends nothing (Phase 10)
  code_hash bytea not null,              -- HMAC-SHA256 with SESSION_SECRET
  expires_at timestamptz not null,       -- 10 minutes
  attempts int not null default 0,       -- 0..5
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
-- one live code per session:
create unique index otp_codes_one_live_per_session on otp_codes (firm_id, session_id) where consumed_at is null;
-- one code per send-login-code job:
create unique index otp_codes_request_key on otp_codes (firm_id, request_id);

create table auth_throttle (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  bucket text not null,                  -- e.g. 'login:mobile:<hmac>'; never a raw number or IP
  window_start timestamptz not null,
  hits int not null default 0,
  created_at timestamptz not null default now(),
  unique (firm_id, bucket, window_start)
);

-- A planner's API keys (12J.1, S11; docs/office-v2.md 5.3.2; ADR-022). The key itself
-- (`shiftdesk_` and 43 random characters, src/lib/integrations/keys.ts) is shown once and never
-- stored or logged. The app may only read and add rows and change last_used_at, revoked_at and
-- revoked_by (TABLE_ACCESS SELECT, INSERT; COLUMN_UPDATES), so a key's hash, label or maker can
-- never be rewritten; never deleted (its id is the actor on every change it made); left out of the
-- firm's data export. At most 10 live per firm (in code). Logged: api_key.created and
-- api_key.revoked (actor office; {keyId}: never the label, which is typed text); the API's own
-- changes carry {by: "firm", via: "api", keyId} with the system actor.
-- The secret store (P5.1, migration 0054; ADR-026; src/lib/db/schema/secrets.ts): a firm's own
-- credentials, each AES-256-GCM under SECRETS_KEY (the worker's and the owner command's settings
-- only, never the web app's or the database's), with its firm and name bound in, so a value moved
-- to another firm or name never opens (src/lib/secret-store/crypto.ts). The app role has no rights on it
-- at all (TABLE_ACCESS []); the owner writes it (npm run firm:secret, the value from standard
-- input), logged firm.settings_changed {keys: ["secret.<name>"], change: added | replaced |
-- removed}, never the value. Read only through app_read_firm_secret(firm, name), run as the owner
-- and callable by the jobs role alone: the worker reads on a jobs-role connection of its own
-- (src/lib/db/firm-secret.ts). Left out of the firm's data export.
create table firm_secrets (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  name text not null,                    -- ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$, at most 64:
                                         -- portal.api_key, portal.webhook_secret
  ciphertext bytea not null,             -- the sealed value and its 16-byte tag (17 to 4112 bytes)
  nonce bytea not null,                  -- 12 random bytes, new for every value
  key_id text not null,                  -- which SECRETS_KEY sealed it: the first 12 hex of its
                                         -- sha256, never the key
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, name)
);

-- What a connector's source said changed (P5.3, migration 0056; src/lib/connector/): one row per
-- event its webhook sent, unique by the source's own event id (the same webhook twice is one row
-- and one job), naming what changed and nothing of it: the job reads the record from the source's
-- API, never from the webhook. The webhook inserts it (with its connector-event job, in the same
-- transaction) and the job sets its outcome (COLUMN_UPDATES: status, outcome_code, processed_at);
-- never deleted or rewritten by the app. The webhook finds the source's firm through
-- app_connector_source_firm(source) (run as the owner, which reads every firm's sources through
-- roster_sources' owner-only source_lookup policy; the app role may call it), only once the
-- signature has passed. Erasing a worker deletes the staff.changed rows naming their staff ref
-- (app_erase_worker, 0056).
create table connector_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  source_id uuid not null,               -- (firm_id, source_id) -> roster_sources (firm_id, id)
  event_id text not null,                -- the source's webhook-id: 1..100 letters, digits, . _ : -
  type text not null,                    -- 'session.changed' | 'staff.changed'
  ref text not null,                     -- the source's ref for the session or staff record
  status text not null default 'queued', -- queued | applied | refused | ignored | failed
  outcome_code text,                     -- ^[a-z0-9_]{1,50}$: created, updated, added, gone,
                                         -- skipped_name, source_off, not_allowed, bad_role…
  processed_at timestamptz,              -- set with the outcome (queued: neither)
  created_at timestamptz not null default now(),
  unique (firm_id, id),
  unique (firm_id, source_id, event_id)
);

-- Emails to a firm's staffing inbox (P7.1; PLAN.md P7): stored once per Message-ID in the firm by
-- the email provider's webhook (P7.2; golden rule 3; an email sent to two firms' inboxes is a row
-- in each). Their own table, not messages, until the office's Enquiries learns email. Words only
-- from a known casual (the sender's address one active worker's here, and the provider's word that
-- it passed DMARC); anyone else's are never stored. Attachments are never kept: only how many. Inserted and
-- read by the app; deleted only by the owner-run app_erase_worker() (theirs, and from their address
-- before it was known) and app_purge_old_messages() (at retention.message_days, with the messages).
create table inbound_emails (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  provider_message_id text not null,     -- the email's Message-ID, printable, <= 250
  worker_id uuid,                        -- (firm_id, worker_id) -> workers: a known casual
  from_address text not null,            -- lower case, as firms.inbox_address's form
  to_address text not null,              -- the firm's inbox
  subject text,                          -- a known casual's only, <= 300
  body text,                             -- a known casual's only, quoted history and signature
                                         -- taken off, <= 4000
  attachments integer not null default 0, -- how many were left out (never kept)
  handled_as text, intent text, handled_at timestamptz, -- set once by its job (P7.4)
  created_at timestamptz not null default now(),
  unique (firm_id, provider_message_id)
);

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  label text not null,                   -- 1..60 characters, trimmed; the admin's name for it
  token_hash bytea not null unique,      -- sha256 of the whole key (32 bytes)
  hint text not null,                    -- the key's last 4 characters ([A-Za-z0-9_-]), shown "…k3F9"
  created_by uuid not null,              -- (firm_id, created_by) -> office_users
  revoked_by uuid,                       -- (firm_id, revoked_by) -> office_users
  last_used_at timestamptz,              -- updated at most once a minute
  revoked_at timestamptz,                -- revoked_at and revoked_by: both or neither
  created_at timestamptz not null default now(),
  unique (firm_id, id)
);
-- app_api_key_lookup(hash) (migration 0045): the firm id and key id of the key with this sha256,
-- if it isn't revoked, before any firm is known (runs as the owner, through a select policy for the
-- owner only; ids only; like app_firm_by_line for a number). Only the app role may call it, through
-- resolveApiKey() (src/lib/db/directory.ts); the API's work then runs in withFirm() for that firm.
-- Trigger api_keys_revocation_final (migration 0046): once revoked_at is set, any UPDATE of
-- revoked_at or revoked_by fails (23514), whoever runs it, so a revoked key never comes back
-- (only a migration, as the owner, could drop the trigger).

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
`shift_events`, `shifts`, `assignments`, `requests`, `offers`, `shift_reminders`, `strikes` or
`api_keys`; on `shift_events` only its switch and name may be updated, on `strikes` only the
review, withdrawal and evidence columns, and on `api_keys` only when it was last used and its
revocation). A new table without an entry there fails the migrate. Adding a table: Drizzle schema +
`.enableRLS()` + the tenant policy, `npm run db:generate`, a `TABLE_ACCESS` entry, and fixtures in
`tests/helpers/tenant-rows.ts` (the isolation tests fail by name until they exist).

## Retention (defaults, per firm)

Per firm, in `firms.settings.retention` (Phase 10, audit M24; set with `npm run firm:settings`, the
owner's; `src/lib/gdpr/retention-settings.ts`): `message_days` (default 90), `request_note_days`
(default 365), both 30 to 2190, and `hold_until` (a date). "Dylan to confirm" in
`docs/compliance.md`.

| Data | Keep | Built (Phase 8) |
|---|---|---|
| Raw messages and transcripts | `retention.message_days` (90) | Yes: `messages` older than that, by `app_purge_old_messages()`, which reads the firm's settings itself; a newer reply stays (its `reply_to` cleared) |
| The words typed into a request (`requests.payload.note`, `.swapWith`) | `retention.request_note_days` (365) after it closed | Yes: removed from closed requests (approved, declined, auto-resolved), the request stays; open and escalated ones keep them |
| The office's override reason (`assignments.override_reason`) | The same, after the booking | Yes: cleared |
| Photos and certificate images (`uploads`, 12F.2) | One turned down: 30 days after the check (with its "Not accepted" record). A staff photo replaced by a newer approved one: 30 days after that one was approved. The current photo and a certificate's image stay with what they prove | Yes: `retention-purge` (none during a hold); erasure deletes them all |
| Strikes (`strikes`) | `strikes.keep_months` (12) after it was issued, which always covers the 90 days it counts plus 6 months | Yes: deleted by `app_purge_old_strikes()` (12C.1, migrations 0038 and 0039), which reads the firm's settings itself; their `strike.issued` log entries (ids and hours) stay with the action log |
| Everything personal, during a hold | Until the day after `retention.hold_until` | The purge skips messages, request words, override reasons, strikes and uploads (logins still tidy up) |
| Call audio | Don't store by default (30 days if enabled) | Not stored |
| Cases, requests, events, notice report | 12 months (check 2027 rules; may need longer) | **Not yet**: events are append-only and no policy lets anyone delete them (PLAN.md Parking lot) |
| Workers and credentials | Until the firm deletes them | An admin erases a worker (`/office/data`) |
| Magic links and OTP codes | 7 days after expiry | Yes |
| Sessions | 30 days after expiry or revocation | Yes (their codes go with them) |
| Rate-limit counters (auth_throttle) | 1 day | Yes (a day after the window started; the longest window is a day) |
| A planner's API keys (`api_keys`, 12J.1) | For good: a revoked key stays, since its id is the actor on what it changed (only the key's hash and last 4 characters are kept) | Nothing to purge |
| Finished pg-boss jobs | 1 day (ids-only payloads) | Yes (queue option) |

The nightly `retention-purge` job (`src/lib/gdpr/retention.ts`, 03:30 London, one per firm)
purges what is built above and writes one `retention.purged` event per firm per run, with how
many of each.

**Deleting messages.** The app role has no DELETE on `messages`. Two owner-run functions (SECURITY
DEFINER, pinned search_path, bound to the current firm by forced RLS) are the only ways:
`app_purge_old_messages()` (older than the firm's `retention.message_days`, read inside the function from the firm's own settings, so no caller can shorten it; nothing during a hold) and
`app_erase_worker(worker)` (for one worker of this firm not yet erased: it reads their number
from the row, makes the row "Deleted worker" and deletes their messages, the replies to them, and
messages from or to that number with no worker set; the caller can't name a number, and it runs
once per worker).

**Deleting strikes.** The app role has no DELETE on `strikes` either. The owner-run
`app_purge_old_strikes()` (migrations 0038 and 0039; SECURITY DEFINER, pinned search_path, the
current firm only) deletes those issued more than the firm's `strikes.keep_months` (12, read
inside the function) ago, and none while `retention.hold_until` holds. It also never deletes one
that stopped counting less than 6 months ago: with settings made by `firm:settings` that can't
happen (`keep_months` must cover the counting plus 6 months), so it only guards against settings
edited by hand. The nightly purge calls it.
