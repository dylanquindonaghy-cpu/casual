# Architecture

One Next.js app and one background worker, from the same codebase, running in Docker on a
single AWS Lightsail server in London, with a managed Postgres database. Every firm's data is
in the same database, separated by `firm_id` and Row Level Security.

Scale is small (tens to a couple of hundred messages per firm per day, spiking on event
mornings). Reliability matters far more than scale.

## Diagram

```
 Casual workers (phone browser)     WhatsApp / SMS / calls        Firm's Google Sheet
          |                                  |                           |
          | HTTPS (firm domain)              | webhooks                  | sync job (1–2 min)
          v                                  v                           v
 +---------------------------- AWS London (eu-west-2) ---------------------------------+
 |  Lightsail server (Docker Compose)                                                   |
 |   caddy   -> HTTPS for our domain + firm custom domains (on-demand TLS, "ask" check) |
 |   web     -> Next.js: staff portal, office dashboard, /api/webhooks/*                |
 |   worker  -> pg-boss jobs: offer waves, escalations, syncs, digests, AI calls        |
 |                 |                        |                                           |
 |                 v                        v                                           |
 |   Lightsail managed Postgres      Amazon Bedrock (Claude, EU profile)                |
 |   (data + job queue + RLS)        Haiku: sort/summarise. Sonnet: only if needed      |
 |                                                                                      |
 |   Amazon SES (digests, office emails)       AWS Budgets (alert at £50)               |
 +--------------------------------------------------------------------------------------+
          |
     Twilio: UK number per firm, WhatsApp templates, SMS fallback, voice (call-to-text)
     Stage 2: ElevenLabs agent on the same Twilio number (AI phone add-on)
```

## Tenancy

- Every request resolves a firm from the hostname: `firmslug.<our-domain>` or the firm's own
  custom domain (lookup in `firms.custom_domain`, Phase 8). `src/proxy.ts` rejects hosts we don't
  serve (404) without touching the database; pages and actions call `getCurrentFirm()` for the
  firm itself (ADR-012). Slugs: 2-20 characters a-z, 0-9 and hyphens; `www`, `portal`, `api`,
  `app`, `admin` and punycode (`xn--`) are refused. Dev: `http://<slug>.localhost:3000`.
- **Three database roles** (ADR-011):
  - `shiftdesk_app` for the web and the worker's data access. No superuser, no BYPASSRLS, owns
    nothing, member of no role, no TRUNCATE, no temp tables.
  - `shiftdesk_jobs` for the worker's pg-boss connection only. It owns the `pgboss` schema.
  - The owner (Lightsail master user; locally the `shiftdesk_owner` role) runs migrations,
    `db:seed` and nothing else. The web and worker never hold its credentials.
- **The scoped client** (`withFirm(firmId, tx => ...)` in `src/lib/db/scoped.ts`) opens a
  transaction and runs `select set_config('app.current_firm_id', $1, true)`: `SET LOCAL` with a
  bound parameter, ended by COMMIT/ROLLBACK so a pooled connection never carries a firm into the
  next request. Nesting throws. The pool refuses to run as a superuser, a BYPASSRLS role or a
  table owner. ESLint blocks app code from importing the raw pool, the owner connection or `pg`.
- **RLS** is enabled and forced on every table, with one policy:
  `firm_id = (select app_current_firm_id())`, where `app_current_firm_id()` returns NULL when no
  firm is set, so a query outside `withFirm` sees nothing and can write nothing.
- **Before the firm is known** (host lookup), `resolveFirmBySlug()` calls `app_resolve_firm()`,
  a `SECURITY DEFINER` function with a pinned `search_path` that returns only directory fields
  (id, slug, name, timezone, sign-off). Only the app role may execute it.
- **Scheduled jobs that visit every firm** (the Sheets sync tick) list firms through
  `app_firm_ids()` (`listFirmIds()`), another `SECURITY DEFINER` function that returns ids only,
  then work inside each firm's own `withFirm` transaction.
- **Jobs** extend a zod envelope `{ firmId, idempotencyKey }` (`src/lib/jobs/firm-job.ts`); the
  worker runs each handler inside `withFirm(payload.firmId)`. The web queues a job inside its own
  `withFirm` transaction (`sendFirmJob`), taking `firmId` from that transaction. An RLS policy on
  `pgboss.job_common` rejects any job whose `firmId` isn't the current firm, so the web can't
  start work in another firm. That RLS is enabled but not forced and binds only the app role;
the jobs role owns the pgboss tables and isn't firm-restricted there, so payloads carry ids only.
- Tests (all as `shiftdesk_app`): every table's catalogue entry (`rls.every-table`), Firm A
  can't read, change, insert into or point at Firm B's rows with a control showing Firm B can
  (`tenancy.isolation`), the same probes catch a deliberately broken policy (`rls.mutation`),
  plus `scoped-client`, `directory`, `jobs.envelope` and `lint.db-boundary`.

## Login

**Workers (no passwords):**
1. Enter mobile number on the firm's portal.
2. If the number belongs to an active worker in this firm, send a one-time link by WhatsApp
   (template) or SMS. Same response either way, so numbers can't be probed.
3. Link token: random 32 bytes, stored as a hash, single use, 15-minute expiry. The token goes
   in the URL fragment (`/l#<token>`), never the path or query string: browsers don't send the
   fragment to the server, so it never reaches request logs, proxies or Referer headers.
4. Session cookie `__Host-sd_session`: httpOnly, Secure, SameSite=Lax, host-only (the `__Host-`
   prefix stops another firm's subdomain setting it). The session lasts 30 days from login; its
   token is replaced daily by a server action while the portal is in use, and the old token keeps
   working for 60 seconds. Every lookup checks the session kind and that the worker is still
   active. Only token hashes are stored. The link page asks "Log me in" (a POST), so link
   previews and email scanners can't use the link up.
5. Pay pages need a step-up code (`src/lib/auth/step-up.ts`): 6 digits by WhatsApp, 10 minutes,
   5 tries, one live code per session (asking again replaces it), 3 requests per worker per 15
   minutes and 10 a day. After a reload the page offers the code field while a sent code still
   works. Created inside the `send-login-code` job and stored as an HMAC bound to the session.
   Each try is taken by one conditional UPDATE (parallel guesses can't get more than 5), then
   compared in constant time. A correct code opens the pay pages for 30 minutes
   (`sessions.stepped_up_until`).
6. Rate limits (`src/lib/auth/throttle.ts`), in fixed 15-minute windows per firm: 10 link
   requests per IP (anything typed, junk included) and 3 per number; 20 failed link uses per IP
   (successful logins don't count). Checked IP first, stopping at the first refusal, so a refused
   IP can't use up a worker's allowance. Link requests are counted in their own transaction before
   the real work (a request that fails still counts), with one conditional upsert (parallel
   requests can't lose a count). Failed link uses are counted in the login's own transaction,
   after a check of the current count, so a burst can let a few extra through (a soft limit:
   it exists to stop guessing and log flooding). Buckets are HMACs (SESSION_SECRET) of the number or IP, never the value; IPv6 counts
   per /64. The IP is `X-Real-IP` only, which Caddy sets (Phase 8); without it all clients share
   one bucket. A refusal says "Too many tries. Try again in {n} minutes."; `auth.rate_limited` is
   logged once per window, when a limit is first reached. Known and unknown numbers are treated
   identically. Known trade-off: people behind one shared IP (venue Wi-Fi, mobile carrier NAT)
   share the per-IP request limit (docs/runbooks.md).

**Office users:** email magic link; roles `admin`, `resourcer`, `payroll`. Add TOTP later.
Same flow as workers (`src/lib/auth/office-login.ts`, shared parts in `link-login.ts`): work
email → the same answer whether or not it's known → `send-portal-link` emails a one-time link to
`/office/l#<token>` (15 minutes, single use, hashed) → a 30-day session in the `__Host-sd_office`
cookie (a worker and an office session can exist side by side; neither works as the other).
Limits: 3 links per address and 10 per IP every 15 minutes. Each office area lists the roles
that may use it (`src/lib/auth/roles.ts`); pages check with `requireOfficeArea()` and a role
without access gets the not-found page. Disabling an office user ends their sessions at their
next request.

## Roster plugs

The firm's rota can live in different places. The app talks to all of them the same way:

```ts
// src/lib/roster/plug.ts (one plug per firm)
interface RosterPlug {
  readonly source: "native" | "sheets" | "csv";
  readonly canWrite: boolean; // false: nothing changes, writes return needs_approval, office taps approve
  listStaff(): Promise<RosterStaff[]>;                    // keyed by ref, the source's own key
  getShifts(from: Date, to: Date): Promise<RosterShift[]>; // starting in [from, to), every status, with slot holders
  assign(shiftId: string, workerId: string): Promise<AssignResult>;
  //   assigned {assignmentId, slot} | filled | already_assigned | not_open | not_found | needs_approval
  markCancelled(shiftId: string, workerId: string,
    cancel: { reason: string; by: "worker" | "firm"; at: Date }): // at: when the person asked
    Promise<CancelResult>; // cancelled {assignmentId, noticeHours} | not_assigned | not_found | needs_approval
}
```

Reads return records keyed by `ref` (our id for native, the sheet or file's row key otherwise,
stored as `shifts.external_ref`); writes take our ids, and each adapter maps between them.
Adapters reading an outside source (Sheets, CSV) check its data with the zod schemas in `plug.ts`
(`rosterStaffSchema`, `rosterShiftSchema`); the native adapter maps our own rows, whose CHECKs
already hold. Every adapter computes notice with `noticeHours()` (`src/lib/roster/notice.ts`) from
`cancel.at`, never from when the call runs (a retried job must not shrink a worker's notice). A
plug records; it never decides eligibility (the rules engine does, before `assign`). Adapters that
write our tables are built on the caller's `withFirm` transaction, and the caller writes the
`events` row from the result in that same transaction. On `needs_approval` nothing is recorded;
the caller keeps the pending change for the office. Every adapter must pass the shared contract
suite, `describeRosterContract()` in `tests/helpers/roster-contract.ts`: first yes wins, slot
order, cancel and reopen, the stored cancellation evidence (who, why, notice hours), read-only
behaviour, the `[from, to)` window, and another firm's rows out of reach.

| Adapter | When | Notes |
|---|---|---|
| Native | Firm has no rota system, or wants ours | Our tables are the source of truth. `nativeRosterPlug(tx, { clock })` in `src/lib/roster/native.ts`, on the caller's `withFirm` transaction. `assign` locks the shift row, creates any missing open slot rows up to the headcount, then does the one conditional update; the shift becomes `filled` with its last slot and `open` again on a cancel. |
| Google Sheets | Most target firms | Firm shares the sheet with our service account. Column mapping per firm, by header text (`roster_sources.mapping`, `src/lib/roster/sheets/mapping.ts`): a staff tab with a staff id column, a shifts tab with a shift id column and an "Assigned" column listing staff ids in slot order. Sync every minute on event days, every 15 minutes otherwise. One batch read and at most one batch write per sync. Never read the sheet per request (Google rate limits): the portal uses `sheetsRosterPlug`, our mirror of the sheet, and only the sync job touches Google. |
| CSV/Excel | Onboarding and firms emailing spreadsheets | Import workers, credentials, shifts, pay records. |
| Approve-only | Any system we can read but not write | We prepare the change; office applies it with one tap. |

Firms already on Deputy or Parim are not targets, so no plugs for them are planned.

**Before confirming any assignment, re-read the live source** (for Sheets, re-fetch that row).

**The Sheets sync** (`src/lib/roster/sheets/sync.ts`, run by the `sheets-sync` job): claim the
firm's sync lease; read the sheet once; in one transaction mirror staff (by staff id; a worker
with the same mobile and no staff id is linked) and shifts (by shift id), then merge who holds each
shift three ways: the sheet now, our bookings now, and what the sheet held after the last sync
(`shifts.synced_holders`). A name removed on either side is removed; a booking made here is always
kept (the worker was told it's confirmed); a name added in the sheet is booked while places
remain, and any left over is logged as a conflict for the office. The office's changes in the sheet
are applied through the roster plug and logged like any firm change (golden rule 12): a removed
name is a cancellation by the firm with notice hours, a "Cancelled" status cancels each booking,
new times are logged per booked worker as moved or curtailed, and new shifts, changed fields and
status changes each get an event. Shifts that have started are mirrored but their bookings are
history: never booked, cancelled or re-timed by a sync (so a first sync books no old names). The
merge base becomes the "Assigned" cell as read. Then one batch write puts our bookings back into
every cell that differs, after re-reading (one request) each target row's id and "Assigned" cells:
a row that moved or a cell the office edited meanwhile is left for the next sync. Each written cell
becomes the new base. A failed or skipped write loses nothing: the next sync pushes the same
bookings and still sees any newer office edit. Draft rows' names are left alone. Bad rows are
skipped and reported by row number and a code, never their contents. Staff changes are logged by
field name; a worker blocked here stays blocked whatever the sheet says, and a changed mobile
revokes the worker's sessions and unused login links (login goes by mobile). The sync's lease on
`roster_sources` fences every later write, so an overrunning sync can't clobber the next one.
**Not live yet:** `SHEETS_TRANSPORT` accepts only `none` until the rules engine checks the names an
office puts in its sheet (credentials in date, golden rule 6).

## Rules engine

Pure functions in `src/lib/rules/`. Input: worker, their credentials, the shift, the worker's
other assignments, firm settings. Output: `{ ok: boolean, reasons: string[] }`.

Checks:
1. Every credential the role needs is present and in date on the shift date.
2. Firm "applied/in progress" allowance (e.g. SIA ACS firms may deploy a capped share of staff
   whose licence is in progress — cap is a firm setting; confirm current SIA rules).
3. Qualification/role match.
4. No overlapping assignment (including travel buffer if set).
5. Minimum rest between shifts.
6. Weekly hours cap.
7. Worker not blocked for this site/client.

Credential rules are data (`credential_rules` table) per sector and role:

| Sector | Examples |
|---|---|
| Security / events | SIA door supervisor, SIA security guard, steward qualification |
| Rail | PTS (Personal Track Safety), Sentinel card, drugs and alcohol test in date |
| Construction / civils | CSCS card (type), specific tickets |
| Cleaning | DBS where the site requires it |

Reasons are shown to workers in plain English ("Your SIA licence expired on 3 Oct. Renew it,
then send the new number to the office").

## Key flows

**Take an open shift**
1. Worker opens Open shifts → only eligible shifts listed (rules engine).
2. Tap "Take shift" → server re-checks rules → re-reads live source →
   `UPDATE assignments ... WHERE shift slot is unfilled` (one statement).
3. 1 row changed: confirm + event. 0 rows: "Just filled — here are similar shifts."

**Cancel**
1. Worker taps Cancel → reason → confirm.
2. Store `cancelled_at`, compute `notice_hours = starts_at - cancelled_at`, write event.
3. If inside the firm's urgent window: mark shift urgent → start offer waves.

**Offer waves (pg-boss)**
1. Rank eligible workers (fair rotation: fewest hours this week first; or first come first served).
2. Send wave 1 (3–5 people): web push + WhatsApp template ("Shift available: Sat 14:00 Gate C.
   Tap to take it"). Link opens the shift.
3. Schedule `offer-wave` job for +15 min. If still open, next wave.
4. Schedule `escalate` at start minus X hours: alert resourcer if unfilled.
5. When filled, cancel remaining jobs and tell open offers "now filled".

**Pay query**
1. Worker (after OTP) fills a structured form.
2. Code assigns grouping keys (week, site, rate code, issue type). Haiku writes a one-line
   summary per group.
3. Digest to payroll at a set time. Payroll marks groups resolved → workers notified.

**WhatsApp shifts line**
1. Twilio webhook → verify signature → store message (idempotent) → queue job → 200.
2. Known worker: keyword match (shifts, cancel, pay, help) → instant reply with the right link.
   Unclear text → Haiku classifies → reply with link or create a request for the office.
3. Unknown number → polite reply + office alert.

**Call-to-text**
1. Twilio voice webhook returns a short recorded message.
2. Immediately send WhatsApp (or SMS) with the portal link.
3. Optional voicemail → transcription → request for the office.
4. Twilio fallback URL forwards calls to the manager's mobile if our app is down.

## Notifications

Order: web push (free) → WhatsApp template → SMS fallback.
- Web push works on Android browsers. On iPhone it only works when the portal is added to the
  home screen, so prompt for it after first login.
- WhatsApp: business-initiated messages must use approved templates (utility category for
  offers and login links). From 1 October 2026 Meta charges per service message beyond the
  free tier of 1,000 per number per month, and a payment method must be on file.
- SMS costs about 4p per message in the UK via Twilio. Use it only as a fallback.
- Quiet hours per firm (urgent offers can override if the firm allows).

## Where AI is used

| Use | Model | Pilot? |
|---|---|---|
| Classify unclear WhatsApp text | Haiku | Yes |
| One-line summaries for pay query groups | Haiku | Yes |
| Classify and draft email replies (approve mode) | Haiku, Sonnet for hard cases | Stage 2 |
| AI phone agent | ElevenLabs (existing agent) | Stage 2 add-on |

- All model calls go through `src/lib/ai/` with zod-validated JSON outputs and a fallback
  ("send to office") when validation fails or confidence is low.
- Bedrock EU inference profile keeps processing in EU/UK regions. Anthropic's direct API has no
  EU option, so we use Bedrock.
- Cache system prompts (prompt caching) to cut cost.
- AI never decides eligibility, assignment or pay.

## Custom domains and branding

- Firm adds `CNAME shifts.firmname.co.uk -> portal.<our-domain>`.
- Caddy uses on-demand TLS and calls our `ask` endpoint, which only returns OK for domains in
  `firms.custom_domain` with `domain_verified = true`. This stops abuse.
- Branding per firm: name, logo, primary colour, sign-off "[Firm] Shift Team".
- Office emails can later be sent from the firm's domain via SES (they add DKIM records).

## Deployment

- Lightsail instance: 2 vCPU, 4 GB, London, static IP (~$24/month).
- Lightsail managed Postgres (~$15/month), automatic backups, not public.
- Docker Compose: `web`, `worker`, `caddy`. Deploy via GitHub Actions (SSH, pull, up -d).
- Secrets in a root-only `.env` on the server; move to AWS Secrets Manager later.
- IAM user for the app with only: `bedrock:InvokeModel`, `ses:SendEmail` (+ S3 read in Stage 2).
- Unattended security updates; snapshot before schema changes; test a restore monthly.
- AWS Budget alert at £50.

## Reliability

| Risk | Fix |
|---|---|
| Same webhook twice | Unique `provider_message_id`; `INSERT ... ON CONFLICT DO NOTHING`. |
| Two people take the same shift | Single conditional UPDATE; loser sees "just filled". |
| Stale rota copy | Re-read live source before confirming. |
| Server restart mid-wave | pg-boss jobs are stored in Postgres and resume. |
| App down on an event morning | Twilio fallback forwards calls to the manager; status alert to you. |
| AI returns junk | zod validation; fallback to office queue. |

## Security checklist

- HTTPS everywhere; HSTS.
- Verify Twilio signatures on every webhook.
- Rate limit login and OTP.
- No personal data in logs (mask phone numbers).
- Least-privilege IAM; MFA on all accounts.
- Dependency updates weekly; `npm audit` in CI.
