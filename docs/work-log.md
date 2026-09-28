# Work log

This file explains, in plain English, what was built in each work session, how long it took and
what it means for you. Each row of the "Hours log" table at the bottom of `PLAN.md` points to a
section here. The newest section is at the bottom. Hours are Claude's working time, measured from
the session history. Your own reading and approval time is not included.

---

## 2026-09-27: Phase 0, repo, tooling, guardrails (1 h)

**What was set up.** Phase 0 took an empty folder to a working skeleton that can be tested:

- The web app: Next.js 16 and React 19, TypeScript in strict mode (it refuses sloppy code, such
  as the "anything goes" type `any`), Tailwind for styling, and ESLint and Prettier (tools that
  check and tidy the code). The home page is a placeholder: "ShiftDesk, Staff portal coming soon".
- A local database: Postgres 16 running in Docker (a program that runs other programs in a
  sealed box), reachable only from your own machine (127.0.0.1:5432).
- Drizzle, the tool that describes the database tables in code, with one deliberately empty
  first migration (a migration is a numbered script that changes the database's structure; they
  run in order). It proved the migration pipeline works end to end.
- Tests: Vitest runs against a real test database whose name must end in `_test`, so tests can
  never touch your dev data. Playwright (browser tests) runs on a Pixel 7 phone screen, because
  workers use the portal from a phone.
- A second program, the "worker" process (the job runner, not a casual worker), using pg-boss (a
  to-do list of background jobs kept in the database). It had one "hello" test job.
- A "console" messaging stand-in: instead of sending WhatsApp or SMS, it prints the message on
  screen with the phone number masked (`+44*******123`). It refuses to run in production.
- CI (GitHub Actions: GitHub runs the checks automatically on every push) runs the same
  `scripts/verify.sh` as your machine does, so the two can't disagree about what "verified" means.

**The safety net.** The "done" checks (`scripts/verify.sh` and its stamp, the `claims-auditor`
and `guardrails-reviewer` agents, and the hooks that block ticking a task or claiming "done"
without a stamp) came in the starter pack (commit `94c09ec`). Phase 0 connected the real project
to them and added `scripts/invariants.sh` with two checks: no skipped or "only" tests, and no
`.env` file tracked by git apart from `.env.example`.

**Why it matters.** Every later phase builds on this. Tests run against a real database, and CI
repeats the local checks on GitHub.

**Result.** 4 test files. A check on a fresh copy just before the commit showed 11 tests passing;
the files as committed contain 12, plus 1 browser test. CI passed on GitHub for the merge commit
`be3e016` (run 36320097749: the verify job succeeded; the browser-test job was skipped, because at
that point it only ran on pull requests). The estimate was 10 to 15 h; 1 h was logged.

**Commits** (a commit is a saved snapshot of the project in git):

- `d8dd8e0` Phase 0: repo, tooling, guardrails (44 files; 9,734 of its 10,477 added lines are
  `package-lock.json`, the list of exact package versions)
- `e137461` Close Phase 0 (all 8 tasks ticked)
- `d35c9a1` Log Phase 0 hours

**One thing for you:** run `./scripts/selftest.sh` once in your own terminal. It checks that the
hooks work on your machine (`docs/verification.md` says to run it after setup, and again if the
hooks ever seem silent).

---

## 2026-09-27 to 28: Phase 1, tenancy, data model, login (4.5 h)

### Time

| When (UTC) | UK time (BST) | Hours | What |
|---|---|---|---|
| 27 Sep, 13:19 to 13:58 | 14:19 to 14:58 | 0.6 | Read the Phase 1 docs and wrote the proposal: schema, RLS policies, scoped client, tests. Then waited for your OK. |
| 27 Sep, 17:19 to 21:12 | 18:19 to 22:12 | 3.9 | Built and closed all Phase 1 tasks (Claude Code showed "Cooked for 3h 53m"). This includes the guardrails reviews, the fixes, the verify runs and the audits. |
| **Total** | | **4.5** | |

The `PLAN.md` estimate for Phase 1 is 25 to 35 h, so this came in well under it. The estimates
were written for a person working by hand.

### Result

- **Verify:** `VERIFIED tree=7c0303e01c7dc68b e2e=true`. That means `scripts/verify.sh` ran the
  type check, lint, every test, the browser tests and the invariant checks on the exact files, and
  all passed. `tree` is a 16-character fingerprint of those files (the current commit plus any
  uncommitted changes). `e2e=true` means the browser tests were part of that run. Stamp time:
  2026-09-27 21:10:37 UTC.
- **Tests:** 31 test files, 595 tests passed (unit and integration). The 10 Playwright browser
  tests (in 4 files) passed in the same verify run.
- **Auditor:** `VERDICT: DONE` on the last task ("Tests: rls.every-table, tenancy.isolation,
  expired/used links rejected, events written"). All 10 Phase 1 tasks are ticked in `PLAN.md`.
- **Commits:**
  - `cef6425` Phase 1: tenancy, data model, login (164 files changed, 14,024 lines added, 220
    removed)
  - `13eab0c` Add /overnight command and decision log for the unattended build loop
- **GitHub:** the branch `build/overnight` was pushed to GitHub on 2026-09-28 (a push copies your
  commits up to GitHub). The first push failed with "could not read Username". The cause was git's
  credential setting: its path to the Windows credential helper contains "Program Files", and the
  space in it was not escaped. That was fixed, and the push then worked. **It is not merged into
  `main`.** A branch is a separate line of work; `main` is the official one. On GitHub, `main`
  still ends at `d35c9a1` (Phase 0 hours). Phase 1 lives only on `build/overnight`.
- **CI:** not checked. The GitHub command-line tool (`gh`) is not installed in WSL, so Claude
  couldn't look. Steps to check it yourself are in "Things that need you" below.
- **Phase 1 "Done when":** "a worker from Firm A can never see Firm B data (tested); login works in
  console mode."

### What was built

#### Database and firm separation

In Phase 0 the database was empty and the app logged in as an all-powerful database user.
Phase 1 turned it into a sealed, multi-firm database. There are 10 tables, and every row belongs
to one firm. Postgres itself stops one firm from reading, changing or linking to another firm's
rows. This is row level security (RLS: the database itself hides other firms' rows). It is
switched on and "forced", so even the table owner is bound by it. The app now uses three separate
database logins (Postgres calls them "roles"), each allowed only what it needs. App code can reach
firm data in exactly one way, `withFirm()`, which stamps a database transaction (a group of
changes that all happen or none do) with one firm's id. This matters because tenant isolation
(golden rule 2) is now enforced by the database and proved by tests that run as the restricted
login. A leak would have to get past the database, the linter and a test that checks every table.

- **10 tables:** `firms`, `sites`, `office_users`, `workers`, `credentials`, `events`,
  `magic_links`, `sessions`, `otp_codes`, `auth_throttle`. Each has a required `firm_id` (`firms`
  uses its own id), `created_at`, RLS switched on and the one tenant policy.
- **The database checks values itself:** firm web names ("slugs") are 2 to 20 characters and can't
  be `www`, `portal`, `api`, `app`, `admin` or start with `xn--`; mobiles must be in E.164 form (the
  international format, e.g. `+447700900123`); brand colours must be `#rrggbb`; logo addresses must
  be `https://`; emails are lower case; roles and statuses come from fixed lists. Credential types
  are free data matching `^[A-Z][A-Z0-9_]*$` (so `SIA_DS`, `PTS`, `SENTINEL`...), not a list
  hardwired to SIA (golden rule 6).
- **No secrets stored in the clear:** login tokens and codes are stored only as hashes (a hash is a
  one-way scramble: you can check a match but can't get the original back).
- **Migrations:** `0000` is the empty Phase 0 one. `0001_rls_setup.sql` (hand-written) creates
  `app_current_firm_id()`, which reads the current firm and returns "no firm" when none is set, so
  every rule fails closed. It also stops everyone creating temporary tables and sets up the job
  queue's schema. `0002_phase1_tables.sql` (generated by Drizzle) creates the tables, checks, links,
  indexes and policies. `0003_firm_directory.sql` (hand-written) creates `app_resolve_firm()`,
  described under "Firm web addresses" below.
- **Three database logins:**
  - `shiftdesk_app`: used by the website and by the job runner for firm data. No superuser, no
    "bypass RLS", can't create roles or databases, owns nothing, never gets TRUNCATE (wipe a whole
    table). A check (`assertRestrictedRole`) refuses it if it ever gains any of those powers.
  - `shiftdesk_jobs`: owns only the background-job queue.
  - `shiftdesk_owner`: owns the tables; used only by the migrate, seed and reset scripts. Locally
    it is a non-superuser role that can't log in directly: the admin connection logs in as Docker's
    superuser and switches to it (`?options=-c role=shiftdesk_owner`), so migrations behave as they
    will on the Lightsail server.
  - The settings are split three ways too: the website's settings (`appEnv`), the job runner's
    (`workerEnv`, which adds `DATABASE_JOBS_URL`) and the scripts' (`adminEnv`). The website and job
    runner never see the owner's password.
- **One rule per table:** the policy `firm_isolation` only lets a row be seen or written when its
  `firm_id` equals the current firm. The `events` table (the action log) has only "read" and "add"
  rules, no "change" or "delete", so it is append-only. `firms` has one extra read rule for the
  owner only, used by the address lookup.
- **Exact permissions, applied on every migrate:** a list in `src/lib/db/admin/access.ts`
  (`TABLE_ACCESS`) says what the app login may do: read `firms` only; read and add `events`; read,
  add, change and delete the other 8 tables. On every `db:migrate`, the script fails if any table
  is missing from the list or has no RLS rule. It then forces RLS, removes all permissions and
  grants exactly what the list says. Drizzle can't write these settings, which is why a script does.
- **7 two-column links between tables:** a foreign key is a column that points at a row in another
  table. Postgres checks these links without RLS, so a plain `worker_id` link would let Firm A
  point a row at Firm B's worker. Every link therefore includes the firm too: `(firm_id,
  worker_id)`. The 7 are `credentials_worker_fk`, `credentials_verified_by_fk`,
  `magic_links_worker_fk`, `magic_links_office_user_fk`, `sessions_worker_fk`,
  `sessions_office_user_fk` and `otp_codes_session_fk`.
- **`withFirm(firmId, fn)`:** checks the id is a valid uuid (a long random id) before connecting,
  opens a transaction and sets the firm for that transaction only. When the transaction ends, the
  setting is gone, so a reused connection never carries one firm into the next request. Calling
  `withFirm` inside another `withFirm` throws an error. Pages and buttons use `withCurrentFirm()`,
  which takes the firm from the web address, never from anything the user typed. ESLint (a tool
  that reads the code and blocks banned patterns) stops page code from calling `withFirm` directly
  or reaching the database any other way.
- **Connection safety checks:** before first use, the app refuses to run if its connection is not
  `shiftdesk_app`, is a superuser, can bypass RLS, owns tables or belongs to another role. While
  tests run, it also refuses any database whose name doesn't end in `_test`. The app's connection
  pool (a set of reusable connections) holds at most 10.
- **Background jobs are sealed per firm:**
  - Every firm job carries a checked "envelope": `{firmId, idempotencyKey}`. Idempotent means
    running it twice has the same effect as once; the key is 1 to 200 characters of letters,
    digits, `:`, `_` and `-`.
  - `sendFirmJob` adds the job inside the current firm's transaction, so the job only exists if the
    change that caused it is saved. It always takes the firm from the transaction and overwrites
    any firm id the caller passed. It also puts the firm in front of every de-duplication key, so
    one firm's job can never cancel out another's.
  - A database rule on the queue table stops the website adding a job for any firm but its own, a
    job with no firm, or a job on pg-boss's internal queues. The website can't read, change or
    delete queued jobs.
  - When the job runner picks up a job, it checks the envelope. A bad one is "dead-lettered" (set
    aside as failed, not retried) for that job only. The job then runs inside `withFirm` for its
    firm. If it fails, only a safe error code is kept, never the error text, which could contain a
    phone number.
  - Firm queues keep finished jobs for 1 day. The job runner never changes the queue's structure on
    start; only `db:migrate` installs or upgrades it. Its error logging keeps only safe fields and
    logs a repeating error at most once a minute, with a count of the repeats.
  - The Phase 0 "hello" job is still there as a smoke test.
- **Migrate, reset and seed scripts:** `runMigrations` is the one path used by `db:migrate`,
  `db:reset`, the tests and the browser tests. In order, it: checks all three database addresses
  name the same database; refuses a Phase 0 database and tells you to run `db:reset`; creates the
  logins; runs the migrations; applies forced RLS and permissions; installs the job queue; and
  finally connects as the app login to prove it is restricted. `db:reset` refuses production and
  anything not on this machine. It sets the local logins' passwords to match your `.env`, drops and
  recreates the dev database, migrates and seeds.

#### Login (workers, office, pay-page codes)

Workers now log in without a password. They type their mobile number on their firm's portal, get a
one-time link by WhatsApp, tap "Log me in" and stay logged in for 30 days. Office staff do the same
with their work email, and each has a role (admin, resourcer or payroll) that decides which office
pages they can open. The pay page is locked behind a 6-digit code sent by WhatsApp; a correct code
opens it for 30 minutes. Every step has rate limits (a cap on how many tries are allowed in a
time window), gives the same answer whether or not a number or email is known, and writes a row to
the action log. So nobody has a password to forget, nobody can use the login form to find out who
works for a firm, and every login, logout and code is on record. No real messages go out yet: the
console stand-in prints them, signed "[Firm name] Shift Team".

- **Worker login, step by step:**
  1. The worker types their number. It is tidied into E.164 form: `07700 900123`, `+44`, `0044`,
     `44` and `+44 (0)7...` all work. Other countries must be typed in full international form.
     Landlines (e.g. `01632...`) are refused.
  2. The rate limits are checked. The app looks for an active worker with that number, inside the
     firm's transaction. It always writes an `auth.link_requested` event and always queues a
     `send-portal-link` job, even for an unknown number (the job then carries no worker).
  3. The job runner creates the link there, so the link never sits in the job queue (jobs carry ids
     only). It builds the address from the firm's own slug and the app's configured domain, never
     from the incoming request. It sends it by WhatsApp and writes `auth.link_sent`.
  4. The worker opens the link and taps "Log me in". One database update uses up the link, retires
     the worker's other unused links, creates a session and writes `auth.login`.
- **The one-time link:** 32 random bytes, written as 43 characters. Only its hash is stored. It
  lasts 15 minutes and works once. It sits after a `#` in the address (`/l#<token>`); browsers never
  send that part to the server, so it never reaches server logs. The page then wipes it from the
  address bar. It needs a "Log me in" tap because link previews and email scanners open pages
  automatically and would otherwise use the link up. If ten taps land at once, exactly one gets in.
  A refused link always says "This link has expired or was already used."; the real reason
  (unknown, used, expired, wrong kind, inactive) goes only into the log. Retrying the send job is
  safe: if the link was already sent, the retry does nothing.
- **Sessions (staying logged in):** the browser keeps a cookie (a small token the browser sends
  back on each visit) holding a random 32-byte token; the database stores only its hash. Workers
  and office staff have separate cookies (`__Host-sd_session`, `__Host-sd_office`). The `__Host-`
  prefix stops another firm's subdomain from planting or overwriting them. A session lasts 30 days
  from login, however much it is used. After 24 hours the token is swapped for a new one; the old
  one keeps working for 60 seconds so pages already loading aren't logged out. A blocked worker or
  disabled office user is out at their next page load. A session from another firm simply isn't
  found. "Log out" ends the session at once and shows "You're logged out."
- **Office login:** the same flow with a work email (trimmed, lower-cased, at most 254 characters).
  The email links to `/office/l#<token>`. Two office areas so far:
  - dashboard (`/office`): admin, resourcer and payroll. It says "You're logged in as Admin" (or
    Resourcer, Payroll).
  - team (`/office/team`): admin only. Only admins see the "Office team" link. Anyone else gets a
    "not found" page, so nothing hints that it exists. The data function checks the role again, so
    the team list can't be reached another way.
- **Pay-page code (called "OTP step-up": a one-time code on top of being logged in):**
  - On `/pay` the worker taps "Send me a code". A job makes a 6-digit code and sends it by
    WhatsApp. Only one code is live per session.
  - The code lasts 10 minutes. It is stored as an HMAC (a hash made with a secret key) tied to that
    session, so it is useless anywhere else. A plain hash of a 6-digit number could be reversed in
    a moment.
  - 5 tries. Input that isn't 6 digits doesn't use a try. The fifth wrong try locks the code. Ten
    guesses at the same moment still get only 5 checks.
  - A correct code opens the pay page for 30 minutes, for that session only. Reloading the page
    keeps the code box while a sent code still works.
  - `steppedUpWorker()` is the gate that Phase 3's pay data must go through.
- **Rate limits (7 in total, each counted per firm in fixed time windows):**

  | Limit | Allowed |
  |---|---|
  | Links per mobile number | 3 per 15 minutes |
  | Link requests per IP address | 10 per 15 minutes |
  | Failed link uses per IP address | 20 per 15 minutes (successful logins don't count) |
  | Office links per email | 3 per 15 minutes |
  | Office link requests per IP address | 10 per 15 minutes |
  | Pay codes per worker | 3 per 15 minutes |
  | Pay codes per worker per day | 10 per 24 hours |

  The IP address (the internet address a request comes from) is checked first, so a blocked
  address can't use up a worker's own allowance. The counters store HMACs, never the number, email
  or IP. Counting is one database statement, so requests at the same moment can't lose a count. The
  refusal reads "Too many tries. Try again in {n} minutes" (shown in hours from 60 minutes). The
  failed-link limit is deliberately soft: a burst can let a few extra through.
- **Same answer for unknown numbers and emails:** a known and an unknown number get the same
  counting, the same event (only a "matched" flag differs), the same job and the same screen: "Check
  your phone. If {firm} has this number, we've sent a link..." A blocked worker or disabled office
  user is treated as unknown. Only input that isn't a phone number or email at all gets a
  correction ("Enter a UK mobile number, like 07700 900123.").
- **Messages:** the console stand-in checks each message (WhatsApp or SMS body 1 to 1,600
  characters; email subject 1 to 200, body 1 to 20,000), prints it with the number or email masked,
  and returns a fake message id. Three templates exist:
  - login link: "Here's your {firm} shifts link: {link}. It works for 15 minutes and only for you.
    — {sign-off}"
  - pay code: "Your {firm} code is {code}. It works for 10 minutes. Don't share it with anyone. —
    {sign-off}"
  - office email, subject "Your {firm} office login link".

  The sign-off is the firm's own setting if it has one, otherwise "{Firm name} Shift Team", never a
  person's name (golden rule 8). Only `MESSAGING_TRANSPORT=console` is accepted until Twilio arrives
  in Phase 4, and console is refused in production.
- **Action log:** 12 login events are written: `auth.link_requested`, `auth.link_sent`,
  `auth.link_rejected`, `auth.login`, `auth.session_rotated`, `auth.logout`, `auth.otp_requested`,
  `auth.otp_sent`, `auth.otp_failed`, `auth.otp_locked`, `auth.otp_verified` and
  `auth.rate_limited`. None contains the code, the token, the phone number or the IP.
- **Pages and buttons:** 8 pages (`/`, `/login`, `/l`, `/pay`, `/office`, `/office/login`,
  `/office/l`, `/office/team`) plus an error page, and 10 server actions (functions on the server
  that a button calls). Every action takes the firm from the web address, checks its input with zod
  (a library that checks data has the right shape) and returns a plain error rather than crashing.
  Actions never use Next's `redirect()`; the browser moves on by itself (see Decisions).

#### Firm web addresses, logging and the action log

Every request is now checked at the door. Each firm lives at its own address, such as
`acme.localhost:3000` in development. A small piece of code that runs first on every request (the
"proxy", which Next 16 renamed from "middleware") gives the request a fresh id and looks only at
the shape of the address. The home domain and `<slug>.<home domain>` are let through; anything else
gets a plain "Not found" before any page runs. Each page then looks up the firm through one
locked-down database function. All logs are single-line JSON, with phone numbers, emails, secrets,
names and database error details masked. The action log refuses to store anything personal. This
is the evidence trail for the Employment Rights Act, so it must be trustworthy and free of personal
data.

- **The proxy (`src/proxy.ts`):** runs on every request except static files and the favicon. It
  makes a new request id and always overwrites any id the visitor sent. It logs one line with the
  method, the path (without the `?...` part) and the firm slug, "apex" (the home domain) or
  "rejected".
- **Address rules:** anything that isn't plain printable text is refused before it is lower-cased.
  This blocks tricks such as the Kelvin sign (a symbol that looks like a K) turning into a
  normal "k". Only one label is
  allowed before the home domain, so `x.acme.<home>` is refused. The slug rules match the database
  checks, and a test keeps the two in step.
- **Firm lookup:** `getCurrentFirm()` reads only the `Host` header (the address the browser asked
  for), never `X-Forwarded-Host`, which a visitor can fake. It calls `app_resolve_firm()`. This is a
  `SECURITY DEFINER` function: it runs with its owner's rights, so it can look up a firm before the
  app knows which firm it is in. It returns only 5 fields (id, slug, name, timezone, sign-off), only
  the app login may call it, and its settings are pinned so it can't be tricked. Unknown firms get
  the "not found" page. It handles subdomains only; custom domains come in Phase 8.
- **Portal links** are built only from the firm's slug and the app's configured domain (`http` only
  for localhost), so a forged address can't point a real login link somewhere else.
- **The logger:** one JSON line per entry, starting with the time, level and message. Info goes to
  standard output, warnings and errors to standard error. Masking:
  - phone numbers in any typed format: any run of 10 or more digits becomes stars with the last 3
    kept. Ids and dates are protected from this. Over-masking is accepted as harmless.
  - emails become `***@domain`; the `?...` part of addresses is cut.
  - fields named like secrets (token, secret, password, otp, cookie...) or personal data (name,
    email, mobile, phone, address, postcode, ip...) become `[redacted]`.
  - database error details (which can contain a whole row) become `[withheld]`; the 5-character
    database error code (SQLSTATE) is kept. A digits-only "code" (which could be a pay code) is
    withheld. Numbers of 1,000,000,000 or more are masked. At most 10 stack lines are kept.
  - Next's and Node's own error output is also passed through the masker, set up at server start
    (`src/instrumentation.ts`).
- **Client IP for rate limits:** read only from `X-Real-IP`, which Caddy (the web server in front
  of the app) will set. `X-Forwarded-For` is ignored. IPv6 addresses are grouped by /64 (one home
  connection usually gets a whole /64 and could otherwise hop between addresses). With no header,
  everyone shares one "unknown" bucket, and production logs a warning once.
- **The action log (`events` table):** `recordEvent()` must run inside a firm, takes the firm from
  there (not from input) and refuses to write anything the masker would change: phones, emails,
  address query strings, big numbers, or fields named like secrets or personal data. It stores ids,
  reasons and flags only. Each event has an actor type (worker, office, system or ai) and an action
  in the form `area.thing` (e.g. `auth.login`). The app can only read and add rows.
- **Settings checks (`src/lib/env.ts`):** the website needs `DATABASE_URL` (must be the app login),
  `SESSION_SECRET` (32 or more characters; the example value is refused in production) and
  `APP_BASE_DOMAIN`. The job runner adds `DATABASE_JOBS_URL` (must be the jobs login),
  `MESSAGING_TRANSPORT` and an optional `CONSOLE_OUTBOX_FILE` (must be under `.dev/`). Only scripts
  read `DATABASE_ADMIN_URL`. `.env.example` was rewritten for the three logins, and `.gitignore` now
  ignores `.dev/`, because the console outbox holds message bodies.

#### Demo data

`npm run db:seed` loads two made-up firms (golden rule 7: fake data only). Phone numbers are in
Ofcom's drama range (`+447700900000` to `999`, numbers reserved for TV and film), emails are
`@example.com`, credential numbers start `TEST-`, and places are invented. Running the seed again
changes nothing, and it puts any changed demo row back to its seeded state. It refuses production
and any database not on this machine, before it connects. It creates the firms as the owner, then
loads everything else through `withFirm` as the app login, the same path the app uses.

- **Acme Events** (slug `acme`, event security):
  - 3 sites in "Exampleton": Acme Demo Arena, Acme Demo Racecourse, Acme Demo Shopping Centre.
  - 60 workers on `+447700900100` to `+447700900159`: 25 stewards, 20 door supervisor plus
    steward, 15 security officers.
  - 95 credentials: 45 `STEWARD_L2`, 35 `SIA_DS` or `SIA_SG`, 15 `FIRST_AID`. Of the SIA ones, 5
    are expired (workers 25 to 29) and 3 are "applied", with no number or expiry yet (workers 45
    to 47).
  - Settings: offer waves of 4, 15 minutes per wave, urgent window 24 hours, quiet hours 22:00 to
    07:00, "applied" allowance 15%.
- **Northline Rail Labour** (slug `northline`, rail):
  - 2 sites in "Sampleford": Northline Demo Depot, Northline Demo Junction.
  - 30 workers on `+447700900300` to `+447700900329`: 20 track operatives, 10 lookout plus track
    operative.
  - 90 credentials: `PTS`, `SENTINEL` and `RAIL_DA` (drugs and alcohol) for every worker. 3 PTS
    cards expire in 10, 17 and 24 days.
  - Settings: urgent window 12 hours, quiet hours 23:00 to 06:00, "applied" allowance 0%.
- **Both firms:** 3 office users each, `<slug>.admin@example.com`, `<slug>.resourcer@example.com`
  and `<slug>.payroll@example.com`. Every third worker has an `@example.com` email. Names are unique
  within each firm.

### Decisions made and why

**Database and firm separation**

| Decision | Why | What else was considered |
|---|---|---|
| Three database logins: app, jobs and owner (ADR-011) | Superusers and table owners skip RLS. In Phase 0 the dev login was a superuser, so the isolation tests would have passed without testing anything. | One login for everything, as in Phase 0 |
| RLS forced on every table; `db:migrate` applies the force and the exact permissions | Forcing binds the owner too. Drizzle never writes these settings. | RLS on but not forced: the owner would see every firm. The cost of forcing: `pg_dump` as the owner sees no firm rows, so backups use Lightsail snapshots. |
| Locally, the owner is a non-superuser role the admin connection switches to | The production owner (the Lightsail master user) isn't a superuser. This way dev, CI and production migrate the same way, and nothing fails for the first time on deploy. | Run migrations as Docker's superuser |
| Firm lookup through one locked-down function, `app_resolve_firm()` | Before a request knows its firm, the app login can't read `firms` at all. One function has fewer moving parts. | A separate read-only login, which needs role memberships the managed server may not allow |
| Links between firm tables include the firm: `(firm_id, x_id)` | Postgres checks links without RLS, so a plain link would let Firm A point at Firm B's worker. | Plain one-column links |
| The firm is set per transaction; nested `withFirm` throws | The setting ends with the transaction, so a reused connection never carries a firm into the next request. A nested call would leak its firm into the outer one. | A connection-wide setting (a test shows it leaks) |
| `app_current_firm_id()` turns an empty setting into "no firm" | A reused connection reports an empty string, not "nothing". Turning it into "nothing" makes every rule fail closed. | Read the setting directly, which could error or match nothing |
| Nobody may create temporary tables | A temporary table could stand in for a real one inside the lookup function. | Postgres's default |
| App and jobs logins are created once and never changed by later migrates | Resetting passwords on every deploy could silently lock out running processes. The login is checked instead. | Change them on every migrate. Passwords are changed by hand for now (`docs/runbooks.md`). |
| The action log's id is an identity column; the app can only read and add | No extra permission is needed; the log is append-only (golden rule 5). | An older id type needing an extra grant, and allowing edits and deletes |
| The seed makes firms as the owner, everything else through `withFirm` | The app login can't create firms; the rest then goes through the same path as the app. | Seed everything as the superuser, skipping RLS |

**Background jobs**

| Decision | Why | What else was considered |
|---|---|---|
| The jobs login owns the queue; the website may only add jobs, and only for its own firm | If the website owned the queue, it could queue work for any firm, and the job runner would run it inside that firm. | The app login owns the queue |
| `sendFirmJob` takes the firm from the transaction and prefixes every key with it | A caller can never queue for another firm. pg-boss de-duplicates across the whole queue, so an unprefixed key could let one firm's job swallow another's. | The caller passes the firm id and raw keys |
| Firm queues use pg-boss's "standard" policy and keep finished jobs 1 day | The other policies de-duplicate across the whole queue. Inside the queue the job runner isn't firm-restricted, so job data isn't kept for a week. | pg-boss's defaults (1 week) |
| A failed job keeps only a safe error code | A raw database error can contain a whole row, phone number included. | Keep the error message |
| The job runner never changes the queue's structure on start | A job runner started against an un-migrated database stops at once instead of changing it. | pg-boss's self-upgrade on start (Phase 0's behaviour) |
| Login links and codes are created inside the job, not in the web request | Payloads carry ids only, so a link or code never sits in the queue. | Create them in the web request and pass them in the job |

**Login**

| Decision | Why | What else was considered |
|---|---|---|
| Server actions never call `redirect()`; the browser moves on by itself | Next fetches a redirect target from the server's own address, which drops the firm's address, so the page would render as the home domain. ESLint blocks it. | `redirect()` inside the action |
| The link token goes after `#` in the address | Browsers never send that part to the server, so it stays out of logs, proxies and "Referer" headers. | `/l?token=...` or `/l/<token>` |
| A "Log me in" tap before the link is used | Link previews and email scanners that only open the page can't use it up. | Log in as soon as the link opens |
| The same answer, writes and job for known and unknown numbers and emails | Neither the reply nor its timing tells anyone whose number it is. | Say the number isn't registered |
| Only failed link uses count against the per-IP limit | A whole crew logging in on one venue Wi-Fi mustn't lock itself out through its own logins. | Count every use |
| Check the IP limit first and stop at the first refusal | A blocked address can't use up a worker's own allowance and lock them out. | Count every limit on every request |
| Rate-limit counters and codes stored as HMACs; codes tied to the session | The raw number, email or IP is never stored. A plain hash of a 6-digit code could be reversed in a moment. | Raw values, or a plain hash |
| Swap the session token every 24 hours, with 60 seconds' grace | Pages can't set cookies, so a small browser component asks for the swap. Pages already loading must not be logged out. | Never swap, or log out on the swap |
| `__Host-` cookies, one for workers, one for office | All firm subdomains count as the same site. The prefix stops another firm's subdomain planting or overwriting the cookie. Separate cookies mean the two kinds never stand in for each other. | One shared cookie for all subdomains |
| "First tap wins": one conditional database update for links, code tries, token swaps and logout | Parallel taps or guesses can't get extra logins or tries, and two links used at once don't jam. | Read the row, then write it (the tests show this failing) |
| A role without access gets "not found", and the data function checks the role too | No hint the page exists, and the data can't be reached another way. | A "forbidden" page, checked on the page only |
| The login code uses a clock the tests can set | Tests can check expiry exactly at the boundary without waiting. | The database's own clock, and sleeping in tests |

**Firm web addresses and logging**

| Decision | Why | What else was considered |
|---|---|---|
| Two steps: a shape check in the proxy (no database), then a firm lookup on each page (ADR-012) | Next 16's docs advise against database work in the proxy, which runs on every request, prefetches included. A check in a layout doesn't stop the page itself rendering. | A database lookup in the proxy or in a layout |
| Only the `Host` header decides the firm | `X-Forwarded-Host` can be set by the visitor when Next is reached directly. | Trust forwarded headers |
| A visitor's request id is always replaced | Request ids tie log lines together, so they must come from the server. | Reuse an incoming id |
| Portal links come from the firm record, never the request | A forged address must not be able to point a real login link elsewhere. | Build links from the request's address |
| Mask any run of 10 or more digits | A date or job number glued to a phone number must not shield it. Over-masking is harmless. | A strict UK-phone pattern that could miss odd formats |
| The action log refuses personal data instead of masking it | The log is kept and shown to firms. It should hold only ids, reasons and flags. | Mask it quietly and save anyway |
| Settings split into website, job runner and scripts | The website and job runner never read the owner's credentials. | One shared settings check, as in Phase 0 |
| Client IP from `X-Real-IP` only; IPv6 grouped by /64 | Caddy sets it and overwrites any visitor value. One connection could otherwise hop addresses to dodge limits. | `X-Forwarded-For`, or one key per IPv6 address |
| Slug rules in both the code and the database, with a test keeping them in step | Neither the app nor a direct insert can create a reserved or look-alike slug. | Check in code only |
| The seed uses fixed ids and refuses production or remote databases | Re-running changes nothing, and it can't go near real data (golden rule 7). | Random ids that duplicate rows on each run |

**Tests and process**

| Decision | Why | What else was considered |
|---|---|---|
| Tests run as the restricted `shiftdesk_app` login | A superuser skips RLS, so tests run that way would prove nothing. The migrate step checks the login, so the whole run stops if RLS would be skipped. | Phase 0's single superuser login |
| Race tests hold all requests at a gate, then release them together | Otherwise the requests quietly run one after another, and a "10 at once" test would pass even with a bug. | Start 10 requests and hope they overlap |
| Every race test first runs a deliberately naive version and checks it breaks | It proves the race really happened in that run, so the real code passing means something. | Test the real code only |
| A separate test breaks RLS on purpose and checks the isolation probe notices | A result of "0 rows" could just mean a broken probe. | Trust the zero counts |
| Every "Firm A can't" check has a "Firm B can" control | Without it, a broken test fixture looks identical to working isolation. | Only check that Firm A sees nothing |
| Login events are compared row for row, exactly | The action log is a product feature (golden rule 5), so any extra field or changed id must fail. | Partial matching on action names |
| Database locks so two test runs can't overlap: a second test run waits, a second browser-test run stops | Each run drops and rebuilds its database, so a second run would pull it out from under the first. | No locking, and random failures |
| `verify.sh` saves a JSON test report and `invariants.sh` rejects any skipped test | Vitest reports success even when tests were skipped while running. | Trust Vitest's exit code |
| Schema drift is checked by generating into a copy of `drizzle/` | Drizzle reports success even when it stops at a question. | Trust Drizzle's exit code |
| CI's browser-test job now runs on every push, with its own database | The browser tests now cover logins that need the database. | Phase 0's pull-request-only job with no database |
| Migrations will run as a one-off step on deploy, the only step with the owner's password | The website and job runner must never hold owner credentials (`docs/runbooks.md`). | Run migrations when the website starts |
| The overnight loop stops after 3 failed audit rounds; tasks needing a real outside service are marked blocked and skipped | Golden rule 13; no real accounts are allowed while unattended. | Skip a failed task and carry on |

### Tests

**Totals:** 595 tests in 31 files (232 unit tests in 11 files, 363 integration tests in 20 files),
plus 10 browser tests in 4 files. Before Phase 1 there were 4 files. Unit tests check one small
piece of code on its own. Integration tests run against a real Postgres database, as the
restricted app login. Browser tests (Playwright, also called "e2e" for end to end) drive a real
browser on a phone-sized screen, against their own web app, job runner and database on port 3100.

**What the suite now proves, by group** (number of tests in brackets):

- **Firms are sealed off from each other**
  - `tenancy.isolation` (60): for all 10 tables, Firm A can't read, change, delete, move its row to
    Firm B, or add a row stamped with Firm B, each with a control showing Firm B can do it to its
    own rows. With no firm set, nothing is visible. None of the 7 links can point at another
    firm's row. The table list must match the database, the schema and the test fixtures, so a new
    table can't slip through untested.
  - `rls.every-table` (70): reads the database's own catalogue. The app login has no special
    powers, owns nothing and can't create tables. Every table has RLS on and forced, exactly the
    one tenant rule and exactly the listed permissions (never TRUNCATE, nothing for anyone else).
    The action log is append-only. Every link includes `firm_id`. The job queue's permissions and
    rules are minimal.
  - `rls.mutation` (40): proves the isolation checks can fail. See below.
  - `scoped-client` (10), `directory` (8), `tenancy.current-firm` (7), `tenancy.firm-host` (16):
    the firm is set per transaction and gone afterwards; two firms at once each see only their own
    rows; the lookup function returns only the 5 directory fields; the firm always comes from the
    `Host` header.
  - Unit: `tenancy.host` (40) for which addresses are served; `proxy` (23) for request ids, the 404
    and the client IP.
- **Background jobs**: `jobs.envelope` (18) proves jobs run inside their own firm, a smuggled firm
  id is ignored, the database refuses another firm's job, a job in a cancelled transaction never
  exists, and the real job runner runs a job the website queued, in the same firm.
  `worker.hello` (2) is the Phase 0 smoke test, now as the jobs login.
- **Login**: `auth.login-flow` (4), `auth.magic-link` (12), `auth.session` (9), `auth.otp` (22),
  `auth.rate-limit` (12), `auth.office` (21), `auth.events` (14); unit tests `auth.mobile` (20),
  `auth.roles` (9) and `copy.wait` (7). Between them: links last exactly 15 minutes (they work 1
  millisecond before expiry and fail at it), work once and only on their own firm; sessions last
  exactly 30 days; tokens swap after 24 hours with 60 seconds' grace; pay codes last 10 minutes,
  allow 5 tries and open pay for 30 minutes; every rate limit; unknown numbers get the same
  answer; office roles; and the exact log row for every login step.
- **Logging and privacy**: `log.masking` (53), `log.console` (2), `log.real-errors` (4),
  `events.record` (17), `messaging.console` (7). Phones in any shape, emails, names, secrets, codes
  and database error details are masked; real database errors leak nothing; the action log refuses
  16 kinds of personal or secret data.
- **Setup and settings**: `db.migrate` (6), `seed` (11), `env` (18), `db.urls` (11),
  `lint.db-boundary` (42). The last one runs the real ESLint on 28 banned ways of reaching the
  database (all blocked), 11 allowed ones (all allowed) and 3 checks that server actions never
  call `redirect()`.
- **In a real browser**: `home` (1), `login.worker` (4), `login.office` (3), `pay.worker` (2). A
  worker logs in with a link and the token is wiped from the address bar; the cookie is locked to
  its own firm; reusing a link fails; an Acme link does nothing on Northline; an unknown number sees
  exactly the same screen; a resourcer gets "not found" on the team page; a wrong pay code shows
  "You have 4 tries left."

**Race tests, in plain words.** A "race" is when two things happen at the same instant, for
example a worker double-tapping a link or two phones using the same link. If the code first
reads "is this link unused?" and then writes "now it's used", both taps can read "unused" before
either writes, and both get in. The fix is to do it in one step: "mark it used, but only if it is
still unused". The race tests fire 10 identical requests at the same moment and check that exactly
one link login succeeds, exactly 5 code guesses are checked, and exactly 3 of 10 link requests get
through the 3-per-number limit. To make the moment real, every request opens a database connection
and waits at a gate until all 10 are ready, then all go together (10-second safety timeout).

**"Control" tests, in plain words.** A test that expects "nothing happened" can pass for the wrong
reason, for example because the test itself is broken. So the tests also check the opposite:

- Each race test first runs a deliberately naive read-then-write version under the same race and
  checks that it does let extras through. That proves the race really happened in that run.
- Each "Firm A can't see Firm B's row" check has a partner showing Firm B can see its own row.
- `rls.mutation` breaks the protection on purpose, inside a change that is always undone: once by
  loosening the rule to "allow everything", once by switching RLS off, and once by connecting as a
  superuser. The same probe must then see Firm B's row. 10 tables times 4 cases = 40 tests.

**The "done" gate got stricter.** `verify.sh` now saves a JSON test report. `invariants.sh` has 5
checks: (1) no skipped or focused tests, in any spelling; (2) no `.env` files in git except
`.env.example`; (3) new: the report must show more than 0 tests, with none skipped, pending or
failed; (4) new: the database schema and the migration files must match; (5) new: only
`src/lib/db/scoped.ts` and the seed may set the current firm. Vitest also now fails any test that
checks nothing (`requireAssertions`). The last run printed "595 tests: 595 passed, 0 failed, 0
skipped, 0 todo" and all 5 checks ok.

### Parked, open, and things that need Dylan

#### Things that need you

1. **Check that CI passed for Phase 1.** Nobody has looked yet.
   1. Open https://github.com/dylanquindonaghy-cpu/casual/actions in your browser (log in to
      GitHub if asked).
   2. In the list, find the newest run whose branch says `build/overnight`.
   3. A green tick means it passed. A red cross means something failed: click it, note which job
      is red ("verify" or "e2e") and tell Claude.
2. **Rebuild your dev database once**, before you next run the app: `npm run db:reset` (full steps
   in "How to see it working"). `db:migrate` refuses a database made in Phase 0 and prints the same
   instruction. Running it when it isn't needed does no harm: the dev database holds fake data
   only.
3. **Start the overnight loop when you're ready.** It has not been started yet. Its rules are in
   `.claude/commands/overnight.md`.
   1. Before you leave it: keep the computer plugged in and stop it sleeping for the night
      (Windows Settings, System, Power, set "sleep" to Never). Keep Docker Desktop open: the tests
      need the database it runs.
   2. In the Claude Code window, type `/clear` and press Enter. This empties the conversation so
      the loop starts fresh. Nothing in the project is lost.
   3. Type `/loop /overnight` and press Enter. Claude says which `PLAN.md` task it picked and
      starts work. You can walk away.
   4. If Claude stops to ask permission for something, the loop waits until you answer. Auto mode
      (on in the session that wrote this) avoids most of these prompts.
   5. To stop it: press Esc, then type `stop the loop` and press Enter.
   6. In the morning, read the "Morning summary" at the bottom of `docs/overnight-log.md`, and the
      new sections at the bottom of this file.
4. **Later, not now: merging.** Phase 1 is only on the `build/overnight` branch. The overnight
   rules forbid Claude from merging it into `main`. That will be your decision, when you want it.
5. **Before the pilot:** review the per-IP login limit (see the Parking lot below).

#### Git, in plain words

- A **commit** is a saved snapshot. A **branch** is a separate line of work; `main` is the
  official one. A **push** copies your commits to GitHub.
- The earlier push failure wasn't something you did wrong. Git's saved setting for your GitHub
  login pointed at a Windows program under "Program Files", and the space in that name wasn't
  escaped. That is fixed, and `build/overnight` is on GitHub.
- The overnight loop commits and pushes for you after each finished task. You shouldn't need to.
- To see Phase 1 on GitHub: open https://github.com/dylanquindonaghy-cpu/casual, click the branch
  menu (it says `main`) and choose `build/overnight`.
- If Claude ever tells you a push failed and asks you to push by hand:
  1. In Claude Code, type `! git push origin build/overnight` and press Enter. The `!` at the start
     runs the line as a terminal command instead of sending it to Claude. (Or, in the Ubuntu
     window, type `cd ~/shiftdesk-starter` and then `git push origin build/overnight`.)
  2. Success looks like "Everything up-to-date", or a line ending
     `build/overnight -> build/overnight`.
  3. If you see "could not read Username", "Authentication failed" or anything mentioning
     "credential", stop. Don't retry. Copy the whole message and paste it to Claude.

#### Open items (not in the Parking lot)

- **Hooks self-test:** `./scripts/selftest.sh` (left over from Phase 0) was run by Claude on
  28 Sep: 22 checks passed, "SELFTEST PASSED. The safety net works on this machine."
- **Follow-up commit on 28 Sep:** this work log, the Phase 1 row in the Hours log, the overnight
  loop's new hours-logging step, and a wording fix: `docs/data-model.md`, `docs/architecture.md`
  and a comment in `src/lib/jobs/firm-job.ts` used to say the job-queue tables have no RLS. In
  fact `pgboss.job_common` has RLS switched on (not forced), with two rules that bind only the app
  login; the jobs login owns the queue tables and isn't firm-restricted there, which is why job
  data holds ids only.
- **The verified stamp is for the Phase 1 files only.** The later commits changed the fingerprint,
  so the next task needs a fresh `verify.sh` run. That is normal.
- **No real messages yet.** Only the console stand-in is accepted until Twilio (Phase 4), and it is
  refused in production, so production can't send login links until then. Office emails also go
  through the console for now; Amazon SES comes later.
- The `/login` confirmation says "we've sent a link by WhatsApp or text", but Phase 1 only sends
  WhatsApp. SMS fallback is parked (Phase 4/7).
- Until Caddy sets `X-Real-IP` (Phase 8), visitors without it share one "unknown" rate-limit
  bucket.
- `docs/compliance.md` says events are kept for 12 months, with a nightly purge job. No purge code
  exists yet.
- `.env.example` lists the Twilio, web push, AWS/Bedrock/SES, Google Sheets and ElevenLabs
  settings, but `src/lib/env.ts` doesn't check them yet.
- **Known consequence of forced RLS:** `pg_dump` (Postgres's backup tool) run as the owner sees no
  firm rows, so backups use Lightsail snapshots and firm exports go through the app
  (`docs/runbooks.md`).
- **Questions left open in the docs:** office logins with an authenticator app ("Add TOTP later",
  `docs/architecture.md`); the pay-code wording for Meta's "authentication" template category
  (decide in Phase 7, `docs/messaging-templates.md`).
- Gates A and B in `PLAN.md` are still unticked. The overnight rules say they don't stop the build.
- **Tests for later phases not written yet** (from `docs/testing.md`): `assign.race`,
  `webhook.idempotent`, `rules.table`, `waves.timing`, `notify.policy`, `notice.report`,
  `pay.grouping`, `sheets.sync`. The pre-pilot item "All must-have tests green in CI" is unticked.
- **From Phase 0:** the hook that blocks ticking tasks watches only Claude's file-editing tools,
  so a `PLAN.md` change made through a shell command isn't checked by it. The hook that blocks
  "done" claims only pattern-matches Claude's last message.

#### Parking lot (all 26 items in `PLAN.md`)

Ideas and follow-ups that came up during the build. Not in scope until a phase includes them.

1. ~~Phase 1 blocker: the dev/CI Postgres user is a superuser, which bypasses RLS.~~ Resolved in
   Phase 1 (ADR-011): app, jobs and owner logins; tests run as `shiftdesk_app`.
2. CI security layer: `npm audit` and a secrets scan. Drizzle-kit 0.31 currently brings in 4
   moderate advisories (old esbuild, dev-only tooling).
3. From the Phase 0 guardrails review: ~~hide the raw `createDb`~~, ~~a zod job envelope~~ and
   ~~redact pg-boss error logging~~ (all done in Phase 1).
4. A check that fails if `twilio` is imported anywhere under `tests/` (when the Twilio library
   arrives, Phase 4).
5. CI's browser-test job needs a Postgres service once browser tests use the database. Moved into
   Phase 1 and done.
6. Phase 8: custom domains in the firm lookup (subdomains only today) and Caddy's `ask` check.
   The proxy 404s every address except the home domain and `<slug>.<home>`, so decide then which
   addresses health checks, Caddy and webhooks may use.
7. A short "not found" cache for unknown firm slugs, if random subdomains ever cause noticeable
   load (each costs one lookup today).
8. Phase 8, branding: the database accepts only `#rrggbb` colours and `https://` logos; still never
   put brand fields raw into CSS or HTML.
9. Phase 8: Caddy sets `X-Real-IP` and the web port is never exposed; encrypted database
   connections (`sslmode=verify-full` with the AWS certificate bundle); a one-off `migrate` step
   that alone holds `DATABASE_ADMIN_URL`.
10. Phase 4/7: SMS fallback for login links and codes, with a plain " - " before the sign-off (a
    long dash turns an SMS into a different encoding and 3 message parts).
11. Phase 3: the pay data loaders and "Raise a pay query" must each call `steppedUpWorker()`
    themselves, not rely on the pay page having shown the code box.
12. Before Twilio (Phase 4): a retried pay-code job should do nothing. Today a retry after a real
    send sends a second code that replaces the first. The fix needs a unique request id on
    `otp_codes`, which is a schema change.
13. Before Twilio (Phase 4): the login-link job sends inside its database transaction. If saving
    fails after a real send, the delivered link won't work and the retry sends a second message.
    Fix: save the unsent link first, then send, then mark it sent. Also skip login requests more
    than a few minutes old (e.g. after the job runner was down).
14. When firms can edit their sign-off: check it ends "Shift Team" and is never a person's name.
15. When an office-users admin screen exists: use one email rule for storing and for logging in
    (the database accepts `a@b`, which login's stricter check would never match).
16. Per-IP login limits are per firm (the counters table belongs to a firm). A limit across firms
    would need a table that doesn't. Revisit if abuse shows up.
17. Before the pilot: review the per-IP limit (10 per 15 minutes) against how the pilot firm
    onboards staff. A briefing on venue Wi-Fi shares one IP (see `docs/runbooks.md`, "Workers at
    one venue can't get login links"). Options: a higher limit, or a per-firm setting.
18. The rate-limit counters hold HMACs of phone numbers. With `SESSION_SECRET` these could be
    reversed (there are only about a billion UK mobiles), so treat them as pseudonymous personal
    data. The 1-day purge (Phase 8 retention job) matters.
19. The app login gets permission to change `firms` (settings, branding) only when a feature needs
    it (Phase 5/8), with event logging.
20. Sessions: notice when a swapped-out token is used again, and end all of that person's sessions.
21. Link page: show "number ending 123" before "Log me in", and ask before replacing a session
    that's already there. Otherwise a forwarded link logs the colleague into the sender's account.
22. `db:reset` and the seed accept any database on this machine. An SSH tunnel (a secure pipe) to
    production also looks like "this machine": never open one while your dev `.env` points through
    it (or add a marker table only dev databases have).
23. A `db:rotate-app-password` script (manual steps are in `docs/runbooks.md`), creating logins
    from a pre-computed password verifier so a plain password never reaches a server log.
24. Remove the app's permission to delete `office_users` (they are disabled, never deleted) once
    the isolation test's delete check is split per permission.
25. Phase 2: eligibility must work out expiry from `credentials.expires_on`, not trust the stored
    status.
26. Demo data still to add (see `docs/testing.md`): requests and Northline's mocked spreadsheet
    (Phase 2), Acme's Saturday event day with the 6am dropout and pay records (Phase 3), the
    short-notice firm cancellation (Phase 5), 12 pay queries, 9 about one rate change (Phase 6).

### How to see it working

Everything runs on your machine with the fake demo firms. No real messages are sent: they are
printed in the terminal instead.

1. Open Docker Desktop on Windows and wait until it says it is running.
2. In the Ubuntu window, go to the project: `cd ~/shiftdesk-starter`
3. Start the database: `npm run db:up`
4. **First time since Phase 1 only:** `npm run db:reset`. This wipes your local dev database (fake
   data only), recreates it with the three logins, runs the migrations and loads the demo firms. It
   should end with a line starting "Recreated", then "applied migrations and loaded the demo
   firms." After that,
   day to day, `npm run db:migrate` and then `npm run db:seed` are enough (the seed is safe to run
   again). If `db:reset` complains about a login or password, compare the three `DATABASE_...`
   lines in your `.env` with `.env.example`.
5. Start the app: `npm run dev`. This runs the website and the job runner together. Leave this
   window open: the "sent" messages appear here. Ctrl+C stops both.
6. **Worker login.** In Chrome or Edge, open http://acme.localhost:3000. You'll be sent to the
   login page.
   1. Type `07700 900100` (any number from `07700 900100` to `07700 900159` is an Acme demo
      worker) and tap "Send me a link". The screen says "Check your phone."
   2. In the terminal, find a block starting `[messaging:console] whatsapp to +44*******100`,
      followed by "Here's your Acme Events shifts link: http://acme.localhost:3000/l#...".
   3. Copy the link, up to but not including the full stop after it, and open it in the same
      browser. Tap "Log me in". You'll see "Hello" and the worker's first name.
7. **Pay-page code.** Tap "See your pay", then "Send me a code". The terminal shows "Your Acme
   Events code is ......". Type the 6 digits and tap "Check code". The page opens. (The pay figures
   themselves arrive in Phase 3.)
8. **Log out.** Go back to http://acme.localhost:3000 and tap "Log out". You'll see "You're logged
   out."
9. **Office login.** Open http://acme.localhost:3000/office/login and type
   `acme.admin@example.com`. The terminal prints an email with the subject "Your Acme Events office
   login link"; open its link and tap "Log me in". You'll see "You're logged in as Admin." and an
   "Office team" link. Try `acme.resourcer@example.com` too: no team link, and
   http://acme.localhost:3000/office/team shows "not found".
10. **Firm separation.** Open http://northline.localhost:3000. It is a separate firm. Its workers
    are `07700 900300` to `07700 900329` and its office users are `northline.admin@example.com`
    and so on. Type an Acme number there: you get the same "Check your phone." screen, but no
    message appears in the terminal, because that number isn't a Northline worker.
11. If you see "Too many tries", that's the rate limit (3 links per number per 15 minutes). Wait,
    or use another demo number.
12. When finished: Ctrl+C in the terminal. Optionally `npm run db:down` stops the database.

Optional: add the line `CONSOLE_OUTBOX_FILE=.dev/outbox.jsonl` to your `.env` and every message is
also saved as one line in that file (the `.dev/` folder is ignored by git). The browser tests use
the same mechanism, with `.dev/e2e-outbox.jsonl`.
