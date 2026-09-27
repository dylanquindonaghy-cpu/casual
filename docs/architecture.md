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
  custom domain (lookup in `firms.custom_domain`).
- The scoped DB client opens a transaction and runs `SET LOCAL app.current_firm_id = '<id>'`.
  RLS policies on every table check `firm_id = current_setting('app.current_firm_id')::uuid`.
- Jobs carry `firm_id` in their payload and use the same scoped client.
- A small number of system tasks (e.g. Caddy's domain check) use a separate, read-only role.
- Tests: for each table, a Firm A session cannot read or write Firm B rows.

## Login

**Workers (no passwords):**
1. Enter mobile number on the firm's portal.
2. If the number belongs to an active worker in this firm, send a one-time link by WhatsApp
   (template) or SMS. Same response either way, so numbers can't be probed.
3. Link token: random 32 bytes, stored as a hash, single use, 15-minute expiry.
4. Session cookie: httpOnly, secure, 30 days, rotated on use.
5. Pay pages need an OTP step-up (6 digits, 10 minutes, 5 attempts).
6. Rate limits per number and per IP.

**Office users:** email magic link; roles `admin`, `resourcer`, `payroll`. Add TOTP later.

## Roster plugs

The firm's rota can live in different places. The app talks to all of them the same way:

```ts
interface RosterPlug {
  listStaff(): Promise<Staff[]>;
  getShifts(from: Date, to: Date): Promise<Shift[]>;
  assign(shiftId: string, workerId: string): Promise<Result>;
  markCancelled(shiftId: string, workerId: string, reason: string): Promise<Result>;
  canWrite: boolean; // false: prepare the change, office taps approve
}
```

| Adapter | When | Notes |
|---|---|---|
| Native | Firm has no rota system, or wants ours | Our tables are the source of truth. |
| Google Sheets | Most target firms | Firm shares the sheet with our service account. Column mapping per firm. Sync every 1–2 min on event days, less otherwise. Batch writes. Never read the sheet per request (Google rate limits). |
| CSV/Excel | Onboarding and firms emailing spreadsheets | Import workers, credentials, shifts, pay records. |
| Approve-only | Any system we can read but not write | We prepare the change; office applies it with one tap. |

Firms already on Deputy or Parim are not targets, so no plugs for them are planned.

**Before confirming any assignment, re-read the live source** (for Sheets, re-fetch that row).

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
