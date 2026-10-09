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

---

## 2026-09-28: Phase 2, task 1: the rota tables (0.5 h)

### Time

0.5 hours of Claude's working time (16:37 to 17:04 UTC), in the unattended overnight loop.
It covered reading the docs, building, a safety review, two full verification runs and the audit.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=75c75b23ec0d408d e2e=true`: type checks, lint, all
  733 tests (up from 595) and the 10 browser tests passed, and the project's own rule checks
  (invariants) passed.
- The independent auditor (`claims-auditor`) gave `VERDICT: DONE`.
- Committed on the `build/overnight` branch as "Phase 2: Schema: shifts, assignments, requests,
  offers, credential_rules (per sector/role)". Whether the push worked is in
  `docs/overnight-log.md`.

### What was built

Five new database tables, the place where the rota itself will live. A **table** is like one
sheet in a spreadsheet: rows and named columns. Nothing on screen changes yet; the portal pages
that use these tables come in Phase 3.

- **shifts**: one row per shift: site, role (for example `steward`), start and end time, how many
  people it needs (**headcount**), an urgent flag, a status (draft, open, filled, cancelled) and
  where it came from (our own rota, a Google Sheet or a CSV import).
- **assignments**: one row per person holding a **slot** on a shift. A shift needing 4 stewards
  has slots 1 to 4. An empty slot is a row with no worker. When someone cancels, their row stays
  (with the time, the reason and the **notice hours**, meaning how long before the start they
  cancelled) and a new empty row reopens the slot. That keeps the evidence the notice report needs.
- **requests**: time changes, swaps, availability and general questions for the office.
- **offers**: each shift offer sent to a worker in a **wave** (a batch of offers), and their answer.
  Sending them comes in Phase 4.
- **credential_rules**: which licences or cards a role needs, for example `door_supervisor` needs
  `SIA_DS`. Each rule is labelled with its sector pack (security, rail, construction, cleaning).

Key facts and numbers:

- Every new table has the firm's id on every row and the same firm-sealing rule as the Phase 1
  tables (**row level security**, or RLS: the database itself hides other firms' rows).
- 8 new links between tables (**foreign keys**, a column that must point at a real row in another
  table), all including the firm's id, so a row can never point at another firm's shift or worker.
  15 such links now exist, and each one has a test.
- 23 new database rules (**CHECK constraints**) refuse bad data even if app code gets it wrong. For
  example: a shift must end after it starts; a headcount is 1 to 1000; a cancellation must record
  when, why and the notice hours; an approved request must say which office user decided and when.
- The app can read, add and change shifts, assignments, requests and offers, but **cannot delete
  them**. They are evidence. Credential rules can be deleted (the office will edit them).
- The database also refuses two people holding the same slot, and one person holding two slots on
  the same shift. This backs up golden rule 4 ("first yes wins").
- One migration file: `drizzle/0004_phase2_roster.sql` (a **migration** is a numbered script that
  changes the database's structure).

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| A cancelled assignment keeps its row; a new empty row reopens the slot | The notice report needs who cancelled, when and with how much notice | Wiping the worker off the row (loses evidence) |
| The app can't delete shifts, assignments, requests or offers | They are the evidence behind the notice report (golden rules 5 and 12) | Full delete rights like the Phase 1 tables |
| Deleting a worker, site or office user that rota rows point at fails | History is never silently lost. Phase 8's "delete my data" will need its own careful step (parked) | Deleting the history too, or blanking the worker (a filled slot would look empty) |
| Every "must be unique" rule starts with the firm's id | Found by the safety review: without it, one firm could tell from an error message whether another firm's slot was filled. A new test now checks every table for this | Leaving the keys as they were (a small leak between firms) |
| Taking a shift only works while the shift is `open` | Found by the safety review: a cancelled shift's empty slots must not be takeable | Checking the slot only |
| No credential rule for a role means "not eligible" | A forgotten or deleted rule must never quietly drop a licence check (written into `docs/rules-and-credentials.md` for the rules engine task) | Treating "no rule" as "needs nothing" |
| Credential rules carry a sector label | A firm working in two sectors (rail and civils) keeps both packs' rules | Using the firm's single sector |
| Roles must be written `like_this` and credential codes `LIKE_THIS` | A typo would silently never match | No format rules |

The full list, with every alternative, is in `docs/overnight-log.md`.

### What the new tests prove

- `tests/integration/roster.schema.test.ts` (39 tests, new): each database rule above refuses a
  bad row, next to a **control** (the same row, fixed, is accepted), so a test can't pass by
  accident. It also proves another firm only ever gets a "no such shift" error, never a hint that
  a slot is filled, and that the "first yes wins" update fills an open slot once and does nothing
  for a second person, or when the shift isn't open.
- `tenancy.isolation`, `rls.every-table` and `rls.mutation` now cover the 5 new tables and the 8 new
  links automatically, because the test fixtures (the fake rows each test firm gets) include them.
- One isolation test was split in two ("can't update" and "can't delete"), because the new tables
  allow updating but not deleting. Every old check still runs.
- `rls.every-table` has a new check: every "must be unique" rule on a firm table starts with the
  firm's id (except random login tokens, which can't be guessed).
- `tenancy.current-firm` now compares with the real number of workers in the test firm instead of
  a fixed "1", since each test firm now has two fake workers.

### Parked, open, and things that need Dylan

- **Please read the decision table** in `docs/overnight-log.md` (this task's entry). These are
  database design choices you would normally approve.
- Not built yet (later Phase 2 tasks): the roster adapters, the rules engine, the credential packs,
  the concurrent "10 people tap at once" race test, and the Google Sheets sync.
- Parked in `PLAN.md`: GDPR worker delete and the retention purge need their own path (the app
  can't delete rota rows); retiring empty slots when a shift is cancelled or shrunk (Phase 5);
  "any of these licences" rules (for example SIA guard or door supervisor); logging credential rule
  edits; checking role spelling in `workers.roles` on import.
- One older Phase 1 rule had the same small leak (a pay-page code rule); fixed in the same
  migration.

### How to see it working

There is nothing new on screen. To look at the new tables:

1. Start the database: `npm run db:up`
2. **Once**, rebuild your local dev database (fake data only): `npm run db:reset`. It should end
   with "Recreated shiftdesk, applied migrations and loaded the demo firms."
3. Open a database prompt: `docker exec -it shiftdesk-starter-postgres-1 psql -U shiftdesk -d shiftdesk`
4. Type `\d shifts` and press Enter. You'll see the columns and the rules (`Check constraints:`).
   Try `\d assignments` too. Type `\q` to leave. The tables are empty until the demo seed adds
   Acme's Saturday event in Phase 3.

---

## 2026-09-28: Phase 2, task 2: the RosterPlug interface (0.4 h)

### Time

0.4 hours of Claude's working time (17:07 to 17:29 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=20703b1cd636b217 e2e=true`: type checks, lint, all
  802 tests (up from 733), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight` as "Phase 2: `RosterPlug` interface ..."; push result in
  `docs/overnight-log.md`.

### What was built

A firm's rota can live in different places: in our own tables ("native"), in the firm's Google
Sheet, or in CSV files (spreadsheet exports). A **RosterPlug** is one agreed way for the app to
talk to any of them, so the rest of the app never needs to know which one a firm uses. This task
wrote down that agreement, which programmers call an **interface**: a list of what every plug must
be able to do, without the code that does it. The code for each source (an **adapter**) comes in
the next tasks.

What every plug must do:

- `listStaff`: list the people in the rota.
- `getShifts(from, to)`: list the shifts starting in that time window, with who holds each place.
- `assign`: give a free place on a shift to someone. The first person to say yes wins; nobody is
  ever double-booked.
- `markCancelled`: free someone's place, recording who cancelled (the worker or the office), why,
  and how many hours' notice they gave.
- `canWrite`: say whether the app may change this rota. If not, changes wait for the office.

Key facts:

- **Checks at the door.** Every plug checks the data it gets from its source with shared rules (a
  mobile number must be in international form, a shift must end after it starts, one person holds
  at most one place on a shift), before the app uses it. This is **validation**, done with a
  library called zod.
- **Notice hours in one place.** `noticeHours()` works out the notice a worker gave, to two
  decimals, exactly as the database stores it. It counts from when the person *asked* to cancel,
  so a slow or retried background job can never make their notice look shorter.
- **A shared test suite for every plug.** 21 named checks (a **contract**) that the native, Sheets
  and CSV adapters must each pass later, the same way. Today they run against a simple plug kept
  in memory, made only for testing (a **test double**).
- **Proof the checks can fail.** 13 deliberately broken versions of the test plug (one that
  double-books, one that forgets the cancel reason, one that reaches another firm's rows...) are
  each caught by the check meant for them. A test that can't fail proves nothing.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Reads name rows by the source's own key; writes use our ids | The sheet sync matches rows by the sheet's key; the portal only knows our ids | One kind of key everywhere (breaks one side or the other) |
| A cancellation says who cancelled (worker or office) and when they asked | Golden rule 12, and a late job mustn't shrink the notice a worker gave | A reason only |
| Plugs don't decide who may take a shift | The rules engine decides, in one place (golden rule 1) | Every adapter checking licences itself |
| For our own tables, the plug works inside the caller's database transaction, and the caller writes the action-log row | The check, the booking and its log entry succeed or fail together | Each plug writing its own log entry |
| A read-only plug changes nothing and says "needs approval" | The office applies it by hand, as architecture.md describes | Failing with an error |

Full list with alternatives: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/unit/roster.contract.test.ts` (37 tests): the 21 contract checks pass on the test plug,
  and each of 15 fault cases (13 kinds of fault) is caught, with a passing control next to each.
- `tests/unit/roster.plug.test.ts` (32 tests): the door checks accept good data and refuse bad
  data; `noticeHours()` is right at every edge (half-way rounding, just after the start, the
  October clock change); the database and the door checks use one role-spelling rule.

### Parked, open, and things that need Dylan

- **Please read the decision table** in `docs/overnight-log.md` (this task's entry).
- Parked in `PLAN.md`: `assign` should require a "passed the rules" token that only the rules
  engine can create, and lock the worker while checking, so two browser tabs can't book
  overlapping shifts; read-only sources must save a pending cancellation before they go live.
- Next task: the native adapter (our own tables), which must pass the same 21 checks against the
  real database.

### How to see it working

Nothing new on screen. To run just these tests: `npx vitest run tests/unit/roster.contract.test.ts
tests/unit/roster.plug.test.ts`. You should see "69 passed".

---

## 2026-09-28: Phase 2, task 3: the native adapter (0.3 h)

### Time

0.3 hours of Claude's working time (17:32 to 17:50 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=5db71de30fa855ae e2e=true`: type checks, lint, all
  833 tests (up from 802), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

The first real **adapter**: the RosterPlug for firms whose rota lives in our own database (the
"native" source, for firms with no other system). It lives in `src/lib/roster/native.ts`.

- It lists a firm's staff and shifts straight from our tables.
- **Taking a shift.** It first **locks** the shift's row: other requests for the same shift wait
  their turn for a few milliseconds. Then it gives the person the lowest free place with one
  database statement that only succeeds if the place is still empty ("first yes wins", golden
  rule 4). When the last place goes, the shift is marked filled.
- **Places are made when needed.** If a shift was created without its empty places (rows in the
  assignments table), they are made on the spot, up to the headcount.
- **Cancelling.** Only a confirmed booking can be cancelled, not a worked or missed shift, and not
  an offer. The booking's row stays, recording when the person asked, why, who cancelled and the
  notice hours. A new empty row reopens the place, and a full shift becomes open again.
- **No transaction of its own.** It works inside the caller's database **transaction** (a group of
  changes that all happen or none do), so a future "take shift" button can check the rules, book
  and log in one go.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Lock the shift row, then the one conditional update | The lock keeps the shift's "filled/open" status right when two people take its last places together; the conditional update alone already stops double booking | The conditional update alone (status could go wrong) |
| Make missing empty places on demand | Every way of creating shifts would otherwise have to remember to make them, and a forgotten one makes a shift look full | Trust every creator |
| Only confirmed bookings can be cancelled; the cancel can't be dated before the booking | Declining an offer isn't a cancellation, and notice can't be counted from before the booking existed (found by the safety review) | Allow any status and any time |
| A lighter lock ("no key update") | Doesn't hold up other tables that point at the shift (found by the safety review) | A full row lock |

### What the new tests prove

`tests/integration/roster.native.test.ts` (31 tests), on the real database, as the same limited
database login the app uses:

- The 19 shared contract checks that apply to a source the app can always write. (The other 2
  are for sources the app may only read.)
- **10 people tapping "take" at the same moment**, for a 1-place, a 3-place and a 2-place shift
  (the last with no empty places made beforehand): exactly as many people as places get one,
  each on a different place, and the rest are told it's filled. As a check that this test can
  fail, the protections were removed for a moment: then all 10 got "assigned".
- What a cancel stores (asked time, trimmed reason, "cancelled by the firm", 26.50 hours' notice)
  and the new empty row; a cancel dated before the booking is refused; an offer or a
  worked/missed shift can't be cancelled; a lowered headcount is respected; a rollback of the
  caller's transaction undoes a booking; nonsense ids get "not found", not a database error.

### Parked, open, and things that need Dylan

- **Please read the decision table** in `docs/overnight-log.md` (this task's entry).
- **A question for you:** what should an "offered" place mean (a place held for one person
  until they accept)? For now, cancelling only works on confirmed bookings.
- Parked in `PLAN.md`: nothing may use `assign` before the rules engine and the action log for
  bookings exist (both later Phase 2 tasks); results should say when a shift became full or
  reopened (Phase 4's urgent offers need it); lowering a headcount below its booked places
  (Phase 5).

### How to see it working

Nothing new on screen yet. To run the tests yourself: `npx vitest run
tests/integration/roster.native.test.ts` (the database must be running: `npm run db:up`). You
should see "31 passed".

---

## 2026-09-28: Phase 2, task 4: the Google Sheets adapter (0.8 h)

### Time

0.8 hours of Claude's working time (17:52 to 18:41 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=b9d4915e8408d4fb e2e=true`: type checks, lint, all
  1004 tests (up from 833), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.
- **Built but not switched on:** no real Google Sheet can be synced yet. The overnight rules
  forbid creating Google accounts, and the sync mustn't run for real until the rules engine (a
  later Phase 2 task) checks the names an office types into its sheet.

### What was built

Most target firms keep their rota in a Google Sheet and will keep editing it. This task lets
ShiftDesk keep a **mirror** (a copy in our own database) of that sheet, in step both ways:

- **From the sheet in:** staff, sites and shifts are copied in, keyed by the sheet's own "Staff ID"
  and "Shift ID" columns (so sorting the sheet doesn't confuse it). Dates and times are read as
  London time, including the clock changes and night shifts that end the next morning.
- **From the portal back out:** when a worker takes or cancels a shift in the portal, the next
  sync writes their staff id into (or out of) the shift's "Assigned" cell in the sheet.
- **Both at once:** if the office and a worker change the same shift between two syncs, a
  **three-way merge** compares the sheet now, the portal now, and the sheet as it was after the
  last sync, so both sides' changes survive. A worker already told "you're booked" is never
  bumped; if the office adds a name to a shift that just filled, that name isn't booked and a
  "clash" is logged for the office.
- **Office changes are evidence too:** a name removed in the sheet counts as a cancellation by
  the firm, with notice hours; new times are logged per booked worker as moved or cut short
  (golden rule 12).
- **Gentle on Google:** a sync reads the sheet once and writes at most once (Google limits
  requests per minute). A background **job** (a task the worker process runs on a timer) syncs
  each firm every minute on event days and every 15 minutes otherwise. Page views never touch
  Google.
- **The Google login** for our "service account" (a robot Google account that firms share their
  sheet with) is written and tested with a fake network and a throwaway key made inside the test.

Key facts: 1 new table (`roster_sources`: which sheet, which columns, last sync), 3 new columns,
1 new locked-down database function (`app_firm_ids()`: firm ids only, for the timer), 2 new jobs,
a column mapping that finds columns by their header text.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Mirror the sheet and sync it, instead of reading it live | Google's limits and speed; a worker must never wait on Google | Reading the sheet on every page view |
| Three-way merge of who holds each shift | Both the office's and the workers' changes survive | Last change wins (one side's edits silently lost) |
| Started shifts are history | A sync must never book, cancel or change a shift after the fact | Treat all shifts the same (the review found this polluted the notice evidence) |
| Before writing, re-read each target row and skip it if the office just edited it | Never overwrite a change made in the same minute (found by the review) | Only check the row hadn't moved |
| A worker blocked here stays blocked; a changed mobile signs them out | Login goes by mobile number, so the sheet mustn't be a way round the office (found by the review) | Let the sheet overwrite everything |
| Leave the live switch off (`SHEETS_TRANSPORT=none`) | The sheet's names are booked without credential checks until the rules engine exists (golden rule 6; found by the review) | Report sheet names as "not booked" (the write-back would erase them from the office's sheet) |

Full list: `docs/overnight-log.md` and ADR-013 in `docs/decisions.md`.

### What the new tests prove

- `tests/integration/sheets.sync.test.ts` (49): the 19 shared contract checks for the Sheets plug;
  a seeded sheet syncs in and out; office adds, removes, re-times and cancels; portal bookings
  and cancels reach the sheet in one write; both sides at once; a failed write loses nothing; a
  row that moved or a cell edited mid-sync isn't overwritten; bad rows are reported by row number
  only; history is left alone; every change is logged; the lease stops two syncs overlapping.
- `tests/integration/sheets.jobs.test.ts` (8): the timer queues a sync only for firms that are due,
  backs off while failing, and the job runs one firm only.
- Unit tests: `sheets.parse` (44), `sheets.merge` (25, incl. the timing rules), `sheets.google`
  (15), `time.zoned` (13, incl. every quarter hour of 2026 through the clock changes).

### Parked, open, and things that need Dylan

- **To make Sheets live, later (after the rules engine task):**
  1. In Google Cloud Console, create a project, then a service account; download its JSON key.
  2. Put the key file in the project's `secrets/` folder (git ignores it; never commit it).
  3. Share a test copy of a rota sheet with the service account's email address, as Editor.
  4. Claude then adds `google` as an allowed `SHEETS_TRANSPORT`, and you set
     `SHEETS_TRANSPORT=google` and `GOOGLE_SERVICE_ACCOUNT_JSON_PATH=./secrets/<file>.json` in
     `.env`, and run one sync by hand.
- Parked in `PLAN.md`: sheet bookings must pass the credential checks first; rows or staff that
  disappear from the sheet; telling the office about sync errors and clashes (Phase 5); big-sheet
  performance; a demo sheet for Northline.
- **Please read the decision table** in `docs/overnight-log.md` (this task's entry) and ADR-013.

### How to see it working

Nothing on screen yet, and no real sheet can sync. To run the tests:
`npx vitest run tests/integration/sheets.sync.test.ts` (with `npm run db:up` running). You
should see "49 passed".

---

## 2026-09-28: Phase 2, task 5: CSV and Excel import (0.6 h)

### Time

0.6 hours of Claude's working time (18:43 to 19:18 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=d365b50cb322d78c e2e=true`: type checks, lint, all
  1064 tests (up from 1004), the 10 browser tests and the rule checks passed.
- The independent auditor said `VERDICT: NOT DONE` on round 1, only because the task wasn't ticked
  yet (every claim was PROVEN), and `VERDICT: DONE` on round 2 with the same files.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

Firms keep lists of staff, licences and shifts in spreadsheets and email them around. This task
lets ShiftDesk read those files and load them in:

- **Two file types.** A **CSV** file (plain text, one row per line, commas between cells; Excel in
  some countries uses semicolons, which also work) or an **Excel workbook** (.xlsx). An old .xls
  file gets a clear message: save it as .xlsx or .csv.
- **Columns by name.** The first row must be headers, and common names are understood ("Mobile",
  "Phone" or "Mobile number"; "Expiry" or "Expiry date"...), in any order.
- **Three kinds:** workers, credentials (licences and cards) and shifts.
- **Safe to repeat.** Importing the same file twice changes nothing the second time. A worker is
  matched by Staff ID if the file has one, otherwise by mobile number.
- **Try first.** A **dry run** does the whole import, reports what would happen, then undoes it,
  so the preview can never differ from the real thing.
- **Clear reports.** Rows that can't be used are skipped and listed by row number with a plain
  reason ("Row 4: the mobile number isn't a phone number we can read"), never by what was in them.
- **Evidence.** Every change is logged with the office user who ran the import.
- **Until the office screen exists** (Phase 5), an admin can run it from the terminal with
  `npm run import`.

Key facts: files up to 5 MB and 5,000 rows; the Excel reader is about 250 lines using Node's
built-in unzip, with limits against "zip bombs" (tiny files that unpack to gigabytes); the same
worker rules as the Google Sheets sync (one shared function).

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Our own small Excel reader, tested against files made by a well-known library (`exceljs`, used by the tests only) | No large new library parsing files people upload; the tests don't grade the reader against itself | A big spreadsheet library at runtime |
| A blank cell leaves a field as it is | A re-import must never wipe a licence's expiry or un-suspend it (found by the safety review) | Blank means "clear it" |
| A booked shift's times and role can't change by import, and its headcount can't go down | Moving a booked shift must be logged per worker with notice (golden rule 12): the office's shift editor (Phase 5) | Apply the change and log it |
| Shifts that have started can't be imported or changed | History isn't rewritten (same rule as the Sheets sync) | Allow it |
| Leading zeros Excel removed from mobiles (7700900123) are put back | Excel does that to numbers typed in a cell | Reject those rows |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/unit/imports.files.test.ts` (38): CSV quirks (quotes, line breaks inside cells, BOM,
  semicolons, tabs); Excel files made by `exceljs` with text, numbers, TRUE/FALSE, formulas,
  dates, times and the 1904 date system; size, row and column limits; hostile files (zip bombs,
  a lying size, encrypted parts, unclosed tags, a cell at column XFD, odd character codes) refused
  quickly.
- `tests/integration/imports.test.ts` (22), on the real database: workers, credentials and shifts
  created and updated; a second import changes nothing; bad rows reported by number; a dry run
  writes nothing, not even log entries; a file with no Staff IDs imports every row; a suspended
  licence stays suspended; a renewal makes an expired licence valid; booked and started shifts
  protected; another firm's data untouched; the terminal command end to end.

### Parked, open, and things that need Dylan

- **Please read the decision table** in `docs/overnight-log.md` (this task's entry).
- The office upload screen is Phase 5 (it will use the same code and wording). Pay records
  import (Phase 3/6) will add a kind to the same importer.
- `exceljs` brings two moderate warnings into `npm audit` for development tools only; the app's
  own dependencies have none.

### How to see it working

1. Start the database (`npm run db:up`) and make sure the demo data is loaded (`npm run db:seed`).
2. Make a small file, e.g. `workers.csv`, with fake data:
   ```
   First name,Last name,Mobile,Roles
   Dora,Demo,07700 900199,steward
   ```
3. Dry run: `npm run import -- --firm acme --kind workers --as acme.admin@example.com workers.csv`
   You should see "Dry run (nothing saved): would create 1, update 0, leave 0 unchanged, skip 0."
4. Add `--apply` to the same command to save it. Running it again says "leave 1 unchanged".

---

## 2026-09-28: Phase 2, task 6: the rules engine (0.4 h)

### Time

0.4 hours of Claude's working time (19:21 to 19:43 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=35f4a825346aeca7 e2e=true`: type checks, lint, all
  1122 tests (up from 1064), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

The **rules engine** decides whether a worker may take a shift. It is one **pure function**
(`checkEligibility` in `src/lib/rules/eligibility.ts`): give it the same facts and it always gives
the same answer, and it never looks anything up itself. That makes it easy to test as a table, and
it keeps golden rule 1: code decides, never an AI.

It checks, in order, and lists every reason that applies:

0. the shift hasn't started;
1. the worker's account is active;
2. the worker has the shift's role;
3. every licence or card the role needs is valid and in date for the whole shift (a night shift
   needs it until the morning); a suspended one always blocks; a role with no rule set up blocks;
4. a licence still "applied for" counts only within the firm's small allowance;
5. no clash with another booking (including travel time, if the firm sets one);
6. enough rest between shifts (11 hours by default);
7. the week's hours stay under the cap (48 by default), Monday to Sunday;
8. not on a day the worker marked unavailable;
9. not a site the worker is blocked from.

Each reason is written for the worker, e.g. "Your SIA door supervisor licence expired on 3 Oct.
Renew it, then send the new number to the office." The office may **override** rest, weekly hours,
unavailability and a started shift (with a reason it logs), but never licences. When the answer is
yes, the result includes a **pass**, a token only this function can make, which the booking code
will require (next tasks).

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| A licence must be both "valid" and in date; a suspended one always blocks | Never trust the status alone; found by the safety review: a suspended licence could slip through beside an "applied" one | Trust either |
| In date for every day the shift touches | A night shift ending at 06:00 needs the licence after midnight (found by the review) | Only the start day |
| Nonsense input (a missing number, a badly written date) stops with an error | It must never wave a worker through (found by the review) | Treat it as zero |
| A new "already started" check, which the office (not the worker) can override | The booking code would otherwise book a shift after the fact; the office may need a late replacement | Leave it to each caller |
| Weeks run Monday to Sunday in London time, counting real hours | How rotas are planned; the October clock change has a 25-hour Sunday | A rolling 7 days |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

`tests/unit/rules.table.test.ts` (58): all 19 cases in the table in
`docs/rules-and-credentials.md`, one test each, named as in the doc; night shifts and licence
expiry; suspended versus applied; the travel buffer; rest across the spring clock change; weeks
across the October clock change and Sunday-night shifts; overrides only where allowed (asking to
override a licence is refused); the pass can't be forged; the function never changes its input;
nonsense input is refused; 500 generated cases never crash.

### Parked, open, and things that need Dylan

- **A question for you:** should the office be able to book someone onto a shift that has
  already started (a late replacement)? It can now; workers can't. If not, it's a one-word change.
- Next tasks will load the facts from the database and make booking require the pass; the Sheets
  sync's bookings will go through it before Sheets can go live.
- Parked in `PLAN.md`: the "applied" allowance should be per credential type (it's an SIA rule);
  roles need display names (the "a"/"an" rule only looks at the first letter).

### How to see it working

Nothing on screen yet. To run the tests: `npx vitest run tests/unit/rules.table.test.ts` (the
database must be running: `npm run db:up`). You should see "58 passed".

---

## 2026-09-28: Phase 2, task 7: credential packs (0.3 h)

### Time

0.3 hours of Claude's working time (19:45 to 20:03 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=d747529f50a1e6ab e2e=true`: type checks, lint, all
  1154 tests (up from 1122), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

A **credential pack** is the standard list of licences and cards for one industry, and which
ones each job role needs. For security: SIA licences, the stewarding qualification and first aid;
a door supervisor needs an SIA door supervisor licence, a steward needs the stewarding
qualification. There are packs for security, rail, construction and cleaning, copied from the table
in `docs/rules-and-credentials.md`.

- When a firm is set up, it gets its own copy of its industry's pack: the licence types (with the
  name workers see, like "SIA door supervisor licence") in a new table, `credential_types`, and the
  default role rules in `credential_rules`. The firm can then change them without affecting anyone
  else, and applying the pack again never undoes its changes.
- The demo firms now have theirs: Acme (security) and Northline (rail). Construction and cleaning
  packs are ready for when a firm needs them.
- "Still being processed" licences (the SIA lets approved firms use a few staff whose licence is on
  its way) now count only for the three SIA licences, never for, say, a rail PTS card.
- A test reads the doc's tables and fails if the code and the doc ever differ.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Each firm gets its own copy of the pack | Every table stays sealed per firm; a firm can add its own site tickets | One shared list for everyone |
| Applying a pack never overwrites | Re-running the seed must not undo the office's edits | Replace every time |
| "Applied" counts only for SIA licences | It's an SIA rule; found by the last safety review | One setting for every licence |
| The doc is the source of truth, and a test holds the code to it | A person reads the doc, not the code | Keep two separate copies and hope |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/unit/credential.packs.test.ts`: the packs match the doc's two tables exactly; every role
  rule only names its own pack's types; codes are unique; the demo firms' roles are covered.
- `tests/integration/credential.packs.test.ts`: applying a pack adds the right types and rules and
  records exactly what it added; applying again adds nothing and keeps the firm's edits; a firm can
  take two packs; another firm is untouched.
- The seed test: each demo firm's workers' roles all have a rule. The table-isolation tests now
  cover `credential_types` too. Five new rules cases for "still being processed" licences.

### Parked, open, and things that need Dylan

- **Please look over** the new `credential_types` table (in `docs/data-model.md`) and this task's
  decisions in `docs/overnight-log.md` before the branch is merged.
- **To confirm with the SIA:** whether the "applied" allowance covers close protection licences
  (the doc flags it).
- Parked in `PLAN.md`: "any of" rules (a door supervisor licence also covers security guarding),
  role display names, warning on imports of licence types a firm hasn't set up.

### How to see it working

1. `npm run db:up`, then `npm run db:reset` (rebuilds your local demo database, fake data only).
2. `docker exec -it shiftdesk-starter-postgres-1 psql -U shiftdesk -d shiftdesk`
3. Type `select code, name, applied_allowed from credential_types;` and press Enter: you'll see both
   demo firms' licence types. Type `\q` to leave.

## 2026-09-28: Phase 2, task 8: credential expiry scan (0.6 h)

### Time

0.6 hours of Claude's working time (20:06 to 20:42 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=ed3035ffbc0a1821 e2e=true`: type checks, lint, all
  1185 tests (up from 1154), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

Licences run out. This task adds a **scheduled job** (a piece of work the background worker runs
by itself on a timetable, here every morning at 08:00 London time) that keeps an eye on every
licence and card with an expiry date.

- **Warnings to the worker.** 30, 14 and 7 days before a licence expires, the worker gets a
  WhatsApp message: "Your SIA door supervisor licence expires on 5 Nov. Renew it and send the new
  details to the office so you can keep taking shifts." Each warning goes once. If the job missed
  a few days, or a licence was imported only 5 days before it expires, the worker gets one
  message (the 7-day one), not three at once.
- **Expiry.** A licence is still good on its expiry date. The day after, the job marks it
  "expired" and tells the worker they can't take shifts that need it until they renew.
- **"Block on expiry".** The shift rules (built two tasks ago) already refuse a licence whose date
  has passed, from midnight, whatever the job has done. The job makes the record match, so the
  office and the worker see "expired" too. A test checks both: refused before the job runs, and
  after.
- **The office's Monday list.** On Mondays, admins and resourcers get one email: whose licences
  expire in the next 30 days and whose expired in the last week. Payroll doesn't get it, since
  they don't place staff.
- **Renewals.** When a new expiry date is recorded (today, by importing the credentials file
  again), the warnings start again for the new date. Nothing has to be reset by hand.
- **Everything is logged** in the action log: each warning, each expiry, each Monday list (counts
  only, never names or phone numbers).
- Two new columns on the `credentials` table remember which warning went out for which expiry date.
- Messages only print to the terminal (the "console transport"). Nothing real is sent.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Warn when a threshold is crossed, one message even if several were | A missed day or a late import must not skip or triple a warning | Only on the exact day |
| 08:00, not 06:00 as the old plan said | 06:00 is inside the default quiet hours (22:00 to 07:00) | 06:00 |
| People who have left get no messages; their licences still get marked expired | No messages to ex-staff; the record stays true | Message everyone |
| The Monday list goes out in a separate step from the workers' messages | Found by the safety review: one bad office email address used to undo the whole run, so workers got the same message again on every retry | One step for everything |
| A licence the worker has already replaced with a newer one gets no warning | Otherwise they'd be told "you can't take shifts" while holding a valid licence | Judge each row alone |

Full list: `docs/overnight-log.md`, this task's entry.

### Two problems the safety review found (both fixed and tested)

1. **Renewal at the wrong moment.** If the office imported a renewed licence in the same instant
   the job was marking the old one expired, the licence could end up "expired" with its new
   future date, so the worker stayed blocked. The import now waits its turn (it **locks** the
   row: the database lets only one change to it at a time). A new test sets up exactly that
   moment and checks the licence ends up valid. The test was also run without the fix, and failed.
2. **Monday rollback.** Explained in the decisions table above. The list is also capped at 40
   lines per section ("and 5 more"), so a very long list can't break the email.

### What the new tests prove

- `tests/unit/credential.expiry.test.ts` (15 tests): exactly when a warning or an expiry happens,
  including month ends, leap years, the October clock change, renewals, and "applied" or
  "suspended" licences being left alone; Mondays only for the list; the message wording.
- `tests/integration/credential.scan.test.ts` (16 tests, on the real database): warnings once per
  threshold; the next one two weeks later; expiry the day after (not on the day) with the message;
  blocked before and after the job; two runs at once still send each message once; the Monday
  list (right people, right lines, only once a day, not when empty); one firm never touches
  another's; the daily timer queues one job per firm per day; the review's problems above.

### Parked, open, and things that need Dylan

- **Please look over** the two new `credentials` columns, the new "expired" WhatsApp message and
  the Monday email wording (`docs/messaging-templates.md`), and 08:00 as the send time.
- Parked in `PLAN.md`: send these through the Phase 4 notification job (push first, per-firm quiet
  hours); flag workers already booked on shifts after their licence expires; the office renewal
  screen (Phase 5); catching up a missed 08:00 the same day.

### How to see it working

There's no screen for this yet. The tests show it:

1. `npm run db:up` (starts the local database, if it isn't running).
2. `npm test -- credential` runs just the credential tests (4 files). You should see `Tests  41 passed (41)`
   and no failures.

## 2026-09-28: Phase 2, task 9: atomic assign ("first yes wins") (0.6 h)

### Time

0.6 hours of Claude's working time (20:46 to 21:22 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=f03c073ac6b9d2fe e2e=true`: type checks, lint, all
  1222 tests (up from 1185), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

This is the heart of the product: what happens when someone says "yes" to a shift.

- **One booking path.** Every booking now goes through one function, `bookShift()`, whether a
  worker taps "Take shift" or the office places someone. (The screens that call it come in
  Phase 3 and Phase 5; this task builds and tests the engine behind them.) Inside one
  **transaction** (a group of database changes that all happen or none do), it:
  1. checks who may book whom: a worker only themselves; in the office only active admins and
     resourcers, not payroll;
  2. **locks** the shift and then the worker (a lock makes anyone else wanting the same row wait
     their turn), so two browser tabs can't both book one person onto clashing shifts;
  3. reads the latest data from the database and runs the shift rules again (licence in date,
     role, rest, weekly hours...): never trusting what the page showed a minute ago;
  4. **re-checks the live source.** For our own shifts, the database is the source, and step 3
     already read it. For a shift from a firm's Google Sheet, our copy of the sheet must have
     synced in the last 20 minutes, or the booking is not confirmed ("try again shortly"). We never
     read Google during a booking (Google limits how often we may ask);
  5. books the place with one database statement that only works if the place is still free:
     "first yes wins". If someone else got there first, the answer is "just filled";
  6. writes the action log entry: who booked, which shift, how many hours' notice. A refusal by
     the rules is logged too, with the reason codes.
- **No way around the rules.** When the rules say yes, they hand back a one-time permission slip
  (an "eligibility pass") for exactly that worker and shift. The code that books places refuses to
  do anything without one, and each slip works once. A test also checks that nothing else in the
  app can call the booking step directly.
- **The office's own sheet.** Names the office types into its Google Sheet now go through the same
  rules. The office may override rest, weekly hours and availability (it's their rota), but never a
  missing or expired licence, the wrong role, an inactive account or a double booking. A refused
  name isn't booked and is logged for the office.
- **The office's overrides.** The office may push past rest, weekly hours, availability, or a shift
  that has just started, but must give a reason, which goes into the action log. Licences can never
  be overridden.
- **"Applied" licences.** Some security firms may use a small share of staff whose SIA licence is
  still being processed. Bookings that rely on this now queue up per day, so two people can't both
  take the day's last allowed place at the same instant.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| For a Google Sheet shift, "re-check the live source" = our copy synced in the last 20 minutes | Reading Google on every booking is slow and hits its limits (an earlier decision, ADR-013) | Read the sheet on every booking |
| Lock the shift, then the worker (then the day, for "applied" bookings) | Two tabs can't double-book a person; one order means two bookings can't block each other forever | No worker lock |
| If the database has to cancel one of two clashing transactions (a "deadlock"), run it again, up to three times | Nothing outside the transaction has happened yet, so a rerun is safe | Fail the booking |
| The office's sheet may override rest and hours, never licences | Golden rule 6 (licences in date) | Book whatever the sheet says |
| Accepting an offer waits for Phase 4 | What "offered" means is still for Dylan to decide | Build it now |

Full list: `docs/overnight-log.md`, this task's entry, and the new ADR-014 in `docs/decisions.md`.

### What the safety review found (all fixed and tested)

- Some test phone numbers were outside the range Ofcom keeps for fiction; now inside it.
- Sheet bookings that overrode a rule didn't log a reason or the notice hours; now they do.
- A booking the rules refused left nothing in the action log; now it does.
- I had written that bookings and the Sheets sync could never block each other. That was wrong:
  they can, rarely. The database then stops one; both sides now retry.

### What the new tests prove

- `tests/integration/assign.race.test.ts`: 10 people tapping "Take shift" at the same moment on
  a shift with one place, on the real database: exactly one gets it. The same for 3 places. One
  person in two tabs can't book two clashing shifts, or pass a weekly-hours limit twice. Two
  "applied" workers can't both take the day's last allowed place. The two-tabs and "applied"
  tests were each run once with their lock removed, and failed, so they really test the locks.
- `tests/integration/booking.test.ts` (13 tests): the booking rules above, the office's overrides
  and reasons, who may book, the Google Sheet freshness check, retries.
- `tests/integration/eligibility-input.test.ts` (6 tests): the rules are given exactly the firm's
  current data.
- `tests/unit/booking.boundary.test.ts`: only the booking code may book.
- The shared roster contract gained a check (no pass, someone else's, or a used one: refused),
  run against all three plug types; sync tests for refused names, overrides and failures.

### Parked, open, and things that need Dylan

- **Please confirm:** (1) the 20-minute rule for Google Sheet shifts; (2) names typed into the
  office's sheet overriding the rest and weekly-hours limits.
- Parked in `PLAN.md`: accepting offers (Phase 4); availability and blocked sites have nowhere to
  be stored yet; the office's override reason is free text (use reason codes with the Phase 5
  screen); a shift row deleted from a sheet stays bookable; connect the real Google account.

### How to see it working

There's no screen yet (the "Take shift" button is Phase 3). The tests show it:

1. `npm run db:up` (starts the local database, if it isn't running).
2. `npm test -- assign.race booking` runs the race and booking tests (3 files). You should see
   `Tests  22 passed (22)` and no failures.

## 2026-09-28: Phase 2, task 10: every booking and cancellation logged with notice hours (0.4 h)

### Time

0.4 hours of Claude's working time (21:26 to 21:47 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=ca174e72e9d2ad95 e2e=true`: type checks, lint, all
  1236 tests (up from 1222), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

The new zero-hours rules (Employment Rights Act, expected 2027) are about **notice**: how many
hours before a shift someone was booked, or cancelled. Firms will need proof. This task makes sure
that proof exists for every booking and every cancellation.

- **Cancelling.** A new function, `cancelBooking()`, is the one way a person cancels: a worker
  cancelling their own shift, or the office cancelling someone's. It records who cancelled, when,
  why and the hours of notice on the booking, frees the place for someone else, and writes the
  action log entry, all at once.
- **Always recorded.** A cancellation is never refused because of what the reason says. The
  reason stays on the booking record (which can be corrected or anonymised later) and is kept out
  of the action log, which can never be changed. A typed reason might name someone or mention
  their health.
- **Rules.** A worker can't cancel once the shift has started: that's a conversation with the
  office. The office can until the shift ends, and the late (negative) notice is recorded. After
  the end, it's a no-show or a completed shift (Phase 5).
- **Nothing slips through.** A test walks through every way a booking can be made or cancelled
  (the worker, the office, the office's Google Sheet adding or removing a name). It checks that
  each one left exactly one log entry with the right notice hours. Another test makes sure no other
  code can cancel a booking directly.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| The typed reason stays on the booking, not in the action log | The log is permanent and must never hold personal details (found by the safety review) | A tidied copy in the log |
| No cancelling by the office after a shift ends | A past shift is a no-show or completed (Phase 5); reopening its place would show a false gap (found by the safety review) | Allow it |
| Notice counts from when the request reaches us | Instant for the portal; the office recording an earlier phone call comes with the Phase 5 screen | Accept an earlier time now |
| "Short notice" is flagged in the Phase 5 report, not in the log | The threshold is a firm setting and the 2027 rules aren't final | Store a flag at the time |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/integration/cancel.test.ts` (11 tests): worker and office cancellations store the
  evidence and log the notice hours (to the minute: 30 minutes before the start is 0.5 hours);
  who may cancel; started and ended shifts; the reason never reaches the log; another firm's
  bookings are out of reach; a deadlock is retried.
- `tests/integration/notice-log.test.ts`: every booking and cancellation, by every path, has
  exactly one log entry with its notice hours, matching what's stored on the booking.
- `tests/integration/assign.race.test.ts`: a double tap on "cancel" cancels once.

### Parked, open, and things that need Dylan

- **Please confirm:** sending someone home part-way through a shift counts as cutting it short
  (a Phase 5 feature, with notice logged), not a cancellation.
- Parked in `PLAN.md`: the worker's "we've recorded your cancellation" WhatsApp and starting offer
  waves after a late cancellation (Phase 3/4); the office recording when a worker actually rang
  (Phase 5); a Google Sheet shift set to Draft keeps its workers without a notice record.

### How to see it working

There's no screen yet. The tests show it:

1. `npm run db:up` (starts the local database, if it isn't running).
2. `npm test -- cancel notice-log` runs the cancellation and notice-log tests (2 files). You
   should see `Tests  12 passed (12)` and no failures.

## 2026-09-28: Phase 2, task 11: the Phase 2 tests (0.1 h). Phase 2 complete

### Time

0.1 hours of Claude's working time (21:50 to 21:56 UTC), in the unattended overnight loop.
**Phase 2 in total: 5.0 hours** against an estimate of 30–40 hours.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=85d3506cca296042 e2e=true`: type checks, lint, all
  1257 tests (up from 1236), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

The three test suites this task names already existed from earlier tasks: the rules table, the
booking race and the Google Sheets sync. This task makes sure they stay complete:

- **A "parity" test** (a test that checks two things say the same) reads the rules document's
  table of test cases and the rules test file. It fails if a case in the document has no test,
  or a test covers a case the document doesn't list. So nobody can add a rule case to the
  document and forget to test it. It was tried once with a made-up case added to the document,
  and it failed as it should.
- **The documents now match the code.** The race test's description used old names
  (`takeShift`, `shift.taken`); it now says `bookShift()` and `shift.assigned`, and lists every
  race the tests run. The Sheets test's description now says what it proves.

### What Phase 2 delivered (all 11 tasks)

Shifts and bookings in the database, sealed per firm. One booking path where tested code decides
who can take a shift ("first yes wins", proven by races on the real database). A two-way Google
Sheets sync (tested against a fake Google; the real account isn't connected). File imports.
Licence packs for four industries. Daily licence-expiry warnings. A complete notice log for every
booking and cancellation. 1257 tests in all.

### Parked, open, and things that need Dylan

Nothing new from this task. The decisions waiting for Dylan from Phase 2 are listed in
`PLAN.md` (Parking lot, "Dylan to confirm") and will be gathered in the morning summary.

### How to see it working

1. `npm run db:up` (starts the local database, if it isn't running).
2. `npm test -- rules assign.race sheets.sync` runs the three suites and the parity check (4
   files). You should see `Tests  146 passed (146)` and no failures.

## 2026-09-28: Phase 3, task 1: My shifts (0.4 h)

### Time

0.4 hours of Claude's working time (21:59 to 22:20 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=1397a185b66cb82b e2e=true`: type checks, lint, all
  1275 tests (up from 1257), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

The first screen of the staff portal (Phase 3 is the part you demo). When a worker logs in, the
home page is now **My shifts**, built for a phone:

- **Your next shift**, in a big card: the day and times in UK time ("Sat 7 Nov, 14:00 to 22:00";
  a night shift says "22:00 to 06:00 Sun"), the role, the venue and its address, an "Open in maps"
  button, and the shift's instructions ("Report to Gate C at 13:30"). Once the shift starts, the
  card says "On now".
- **Coming up**: the other booked shifts. Tapping one opens the same details, with no extra
  loading. It uses a built-in browser feature (`<details>`), so it works even on a weak signal.
- **Past 30 days**: a toggle shows recent shifts with what happened ("Worked", "Marked as not
  attended", "Booked").
- **A licence banner** when a licence the worker's jobs need expires within 30 days or has expired,
  in the same words as the WhatsApp warning. It stays quiet if they've already renewed or applied.
- **Plain empty states**: "No shifts booked yet." with a "See open shifts" button (that page is
  the next task).
- Each worker sees only their own shifts, only at their own firm.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| A shift stays on the screen until it ends, even once the office has marked it | A worker running late still needs the address and instructions | Hide it at the start time |
| Cancelled bookings don't show in the list | The list is "my shifts"; cancellations get their own confirmation | Show them crossed out |
| The banner also shows expired licences, only for the worker's jobs | Expired is what the worker most needs to see (Dylan to confirm) | Only "expiring soon" |
| "Open in maps" is just a link to Google Maps | Nothing is sent anywhere until the worker taps it | No map link |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/integration/my-shifts.test.ts` (10 tests, real database): which bookings show and in
  what order; the 30-day window; a shift in progress stays; the site and instructions come
  through; another worker's or firm's shifts and licences never show; the banner's rules.
- `tests/unit/portal.my-shifts.test.ts` (10 tests): times in UK time (including a night shift over
  the October clock change), the page rendered to HTML with fake shifts, checked for every part
  of the screen spec.
- The browser test for logging in now also checks the empty My shifts screen and the toggle.

### Parked, open, and things that need Dylan

- **Please confirm:** the banner showing expired licences, not only ones expiring soon.
- Parked in `PLAN.md`: the browser test expects demo worker 07700 900100 to have no bookings;
  the demo-seed task must keep it that way or move the check.

### How to see it working

1. `npm run db:up`, then `npm run dev` (starts the app; leave it running).
2. Open `http://acme.localhost:3000/login` on your computer and enter `07700 900100`.
3. The login link appears in the terminal where `npm run dev` runs (nothing is really sent). Open
   it and tap "Log me in".
4. You'll see "Hello" and the My shifts page. The demo data has no shifts yet (that comes with the
   demo-seed task), so it shows "No shifts booked yet."; tap "Past 30 days" to see the toggle.

## 2026-09-28: Phase 3, task 2: Open shifts with "Take shift" (0.3 h)

### Time

0.3 hours of Claude's working time (22:23 to 22:44 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=d258fad28aa6407b e2e=true`: type checks, lint, all
  1290 tests (up from 1275), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

The second portal screen, **Open shifts**, where a worker picks up work:

- **Only shifts they can take.** Every open shift in the next 28 days, in one of their jobs,
  with a place left, is checked by the rules (licence in date, rest, weekly hours...) against the
  current data. Shifts that fail aren't listed at all.
- **Filters** by day, site and role. It's a simple form that works without JavaScript.
- **Each card** shows the time, role, venue and address, and how many places are left, with a big
  "Take shift" button.
- **One tap books it.** The booking goes through the same locked booking path from Phase 2 (first
  yes wins), and the answer appears on the card:
  - "You're booked.", with the day and times, the role and venue, a reference like `3F2A9C1B` and
    the firm's sign-off. The worker can screenshot it, as the spec asks.
  - Or a plain answer: "Just filled. Someone else took this shift a moment ago." (with a button to
    see the rest), the rules' reasons, or "try again in a few minutes".
- The firm comes from the web address and the worker from their login. The browser only says
  which shift, so nobody can book for someone else.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| The next 28 days; at most 50 shifts checked per page, with a note when there are more | Each shift is checked by the rules one at a time; a faster batch check is parked for before the pilot | Every future shift (slow) |
| The confirmation appears on the card, no new page | Quick on a phone; still has what, when, a reference and the sign-off | A separate confirmation page |
| "Booked" is always shown if the booking worked, even if the details can't be read afterwards | Never tell someone "something went wrong" when they're booked (found by the safety review) | — |
| No pay rate on the cards yet | Pay data comes in Phase 6 | — |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/integration/open-shifts.test.ts` (8 tests, real database): only shifts the worker could
  take are listed (not full, not theirs, not the wrong role, not draft, cancelled, started or
  too far off, not another firm's, and not ones the rules refuse); the filters; a long list with
  the first 50 checked and a filter reaching later ones; "Take shift" books and confirms; every
  other answer; the preview of the rules never hands out a booking permission.
- `tests/unit/portal.open-shifts.test.ts` (7 tests): the page and every answer after "Take shift",
  rendered to HTML and checked against the screen spec's words.
- The browser login test now also opens Open shifts from My shifts and comes back.

### Parked, open, and things that need Dylan

- Parked in `PLAN.md`, before the pilot: a faster batch check for the list, and a limit on how
  often "Take shift" can be tapped. Later: the office looking up a booking by its reference.

### How to see it working

1. Log in as in the last task (`npm run dev`, then `http://acme.localhost:3000/login`).
2. On My shifts, tap "See open shifts". The demo data has no shifts yet (the demo-seed task adds
   them), so it says "Nothing open right now."

## 2026-09-28: Phase 3, task 3: Cancel a shift (0.3 h)

### Time

0.3 hours of Claude's working time (22:47 to 23:08 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=a3532626d7a9356c e2e=true`: type checks, lint, all
  1311 tests (up from 1290), the 10 browser tests and the rule checks passed.
- The independent auditor gave `VERDICT: DONE` on the first round (and ran a production build
  itself, which succeeded).
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

- **"Cancel this shift"** on My shifts, under every booked shift that hasn't started yet.
- **Why?** The worker picks a quick reason ("I'm unwell", "Travel problem", "Family or caring"),
  or "Something else" with a short note. Then "Confirm cancellation", or "Keep this shift" if they
  change their mind.
- **Instant confirmation** they can screenshot: "We've recorded your cancellation.", the shift, how
  much notice they gave ("You gave 2 days' notice."), when it was recorded, the booking's
  reference, and the firm's sign-off.
- It's recorded through the cancellation code from Phase 2: the reason and the notice hours go on
  the booking, and one entry goes in the action log (the typed note never does).
- Once a shift has started, the button is gone. A late cancellation is a conversation with the
  office.

### A problem the safety review caught (fixed)

The first version **broke the production build** (the version of the app a real server runs). In
Next.js, a **client component** is a piece of the page that runs in the worker's browser.
Everything it imports is sent to the browser too. The cancel button imported a helper file that
also talks to the database, so the browser bundle tried to include database code, which can't
run in a browser. The type checks and tests all passed, because they don't build the app. The
fix: the browser-safe parts moved to their own file. A new test now follows every client
component's imports and fails if any of them reaches database code. It was tried with the
mistake put back, and it failed as it should. I also ran a full build by hand, and it succeeded.

The review also caught an old confirmation that could stay on screen after the list reloaded,
and a missing "Try again" after an error. Both are fixed.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Cancel sits on My shifts, not a separate page | One tap from where the worker sees the shift: under 30 seconds | A shift detail page first |
| Quick reasons, plus "Something else" with a note | Faster on a phone; the office always gets a reason | A free-text box |
| Show the notice given and when it was recorded | "Notice period recorded": the worker sees what was kept | Say nothing about notice |
| The reference is the booking's (same as its booking confirmation) | One reference per booking, easy for the office to match | A new one per cancellation |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/integration/cancel-shift.test.ts` (3 tests, real database): a cancellation is recorded
  (reason and notice on the booking, one log entry) and confirmed; too late once started; not
  booked; another firm's booking is out of reach.
- `tests/unit/portal.cancel-shift.test.ts` (6 tests): the reasons, the notice wording ("2 days'",
  "5 hours'", "less than an hour's"), and the confirmation's words.
- `tests/unit/client-boundary.test.ts`: no browser component reaches database code.
- The My shifts tests: the cancel button shows on upcoming shifts, and not on one that's on now.

### Parked, open, and things that need Dylan

- **Please decide:** add a production build (`npm run build`) to `scripts/verify.sh`, so a broken
  build can never be marked verified. I'm not allowed to change that script.
- Parked in `PLAN.md`: tests of the server actions' own input checks (with the Playwright task);
  reason codes instead of text for cancellations; the "we've recorded your cancellation" WhatsApp
  (Phase 4).

### How to see it working

The demo data has no bookings yet (the demo-seed task adds them), so there's nothing to cancel
on screen locally. The tests show it: `npm test -- cancel` runs the cancellation tests (3 files);
you should see `Tests  20 passed (20)` and no failures.

## 2026-09-28: Phase 3, task 4: Request a time change or swap (0.4 h)

### Time

0.4 hours of Claude's working time (23:12 to 23:33 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=8c424d3ace0f9733 e2e=true`: type checks, lint, all
  1328 tests (up from 1311), the 10 browser tests and the rule checks passed. A production build
  (`npm run build`) was also run and succeeded.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

- **"Ask for a change"** on each upcoming shift in My shifts opens a short form:
  - **"Change the times"**: the new start and finish they'd like; or
  - **"Swap with someone"**: optionally, who could take it;
  - plus an optional note for the office. Then "Send request".
- **A confirmation**: "Request sent.", which shift, the times asked for, when it was sent, a
  reference, and the firm's sign-off.
- **My requests** (a new page, linked from the home page): each request with its shift and its
  status in plain words ("Waiting for the office", "Approved", "Declined", "Sorted").
- Only for their own booked shifts that haven't started, and only one open request per shift and
  kind. Asking again shows the waiting one's reference.
- The request is saved for the office (the office's queue to approve or decline comes in Phase 5),
  and the action log records that it was made. The typed note and any colleague's name stay on
  the request, never in the log.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Two kinds now: change the times, or swap | That's this task; general questions and availability come with their own tasks | All four kinds |
| "Who could take it?" is free text | Picking from a list would show other workers' names (Dylan to confirm) | A colleague picker |
| One open request per shift and kind | No accidental duplicates for the office | Allow many |
| Statuses in plain words; "escalated" reads as still waiting | Escalation is the office's own business | Show the raw status |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/integration/requests.test.ts` (7 tests, real database): a request is saved for the
  office and logged without the typed text; one open per shift and kind, even with five taps at
  the same moment; only for the worker's own upcoming bookings (not someone else's, not started,
  not cancelled, not another firm's); bad form input is refused; the list and the shifts offered.
- `tests/unit/portal.requests.test.ts` (9 tests): the form's checks, the confirmation and answers,
  My requests, and the form's first screen, rendered to HTML.
- The browser login test now also opens My requests ("No requests yet.").

### Parked, open, and things that need Dylan

- **Please confirm:** the free-text "Who could take it?" (it can hold a colleague's name).
- Parked in `PLAN.md`: what approving a request must do (Phase 5: notice hours for a time
  change; a swap goes through the rules); closing open requests when a booking is cancelled;
  telling the office and the worker (Phases 4 and 5); a database rule against duplicates (needs
  Dylan).

### How to see it working

1. Log in as in the earlier tasks (`npm run dev`, then `http://acme.localhost:3000/login`).
2. On My shifts, tap "My requests": it says "No requests yet." (the demo data has no bookings to
   ask about until the demo-seed task).

## 2026-09-28: Phase 3, task 5: Allocation mode (0.4 h)

### Time

0.4 hours of Claude's working time (23:36 to 00:01 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=0ed73be4b3e436ea e2e=true`: type checks, lint, all
  1343 tests (up from 1328), the 10 browser tests and the rule checks passed. A production build
  was also run and succeeded.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

Each firm now chooses how open shifts are shared out (a setting on the firm; the office screen to
change it comes in Phase 5):

- **First come, first served** (the default): whoever taps "Take shift" first gets the place, as
  before.
- **Fair rotation**: when a place opens (a new shift, or a place freed by a cancellation), it's
  held for **15 minutes** for the **4 workers with the fewest booked hours that week** (people tied
  with the fourth are included). Everyone else sees "Offered first to people with fewer hours that
  week. You can take it from 14:15." After that, anyone who can take it can.
  - It's never held for a shift starting within the next 24 hours (a last-minute dropout must be
    filled fast), and never past the shift's start.
  - The office is never held back, and neither are names the office types into its sheet.
  - The booking code enforces it, not just the screen, and every hold is written in the action log.

Why: the business notes say "first come, first served favours people glued to their phones", so
the firm can choose fairness. The same ranking is ready for the offer messages in Phase 4.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Fair rotation = a short priority window on new places | Keeps instant booking while giving the less-booked a head start (Dylan to confirm, ADR-015) | Collect names and decide later (no instant answer) |
| 15 minutes and 4 people come from the firm's existing wave settings | The same numbers the offer waves will use | New settings |
| Not for shifts within 24 hours, never past the start | Found by the safety review: a 6am dropout must fill fast | Hold whatever the start time |

Full list: `docs/overnight-log.md`, this task's entry, and ADR-015 in `docs/decisions.md`.

### What the new tests prove

- `tests/unit/rules.allocation.test.ts` (4 tests): who's in the fewest-hours group (with ties),
  when a place is held and when it opens, and the order the offer waves will use.
- `tests/integration/allocation.test.ts` (10 tests, real database): a new place is held for the
  fewest hours and opens to everyone after the window; the list shows the time; a cancellation
  starts a new window; the office is never held; first come, first served holds nobody; late
  shifts and starts are never held; full, draft and already-booked shifts give their own answer;
  exactly which hours count; bad settings stop the booking rather than guess.

### Parked, open, and things that need Dylan

- **Please confirm:** fair rotation working this way (15 minutes, the 4 fewest hours that week, not
  within 24 hours of the start).
- Parked in `PLAN.md`: a few edge cases in when a place counts as "opened" (a draft opened later, a
  headcount increase), and that the group is picked by job and hours rather than the full rules.

### How to see it working

The demo data has no open shifts yet (the demo-seed task adds them). The tests show it:
`npm test -- allocation` runs the allocation tests (2 files); you should see
`Tests  14 passed (14)` and no failures.

## 2026-09-29: Phase 3, task 6: Pay info page (0.4 h)

### Time

0.4 hours of Claude's working time (00:04 to 00:27 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=7602a49bc1175996 e2e=true`: type checks, lint, all
  1370 tests (up from 1343), the 10 browser tests and the rule checks passed. A production build
  was also run and succeeded.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`; push result in `docs/overnight-log.md`.

### What was built

Workers can now check their pay without messaging payroll:

- **A new table, `pay_records`**: one line per worker, pay period and rate (a week can have a day
  rate and a night rate): hours, rate, gross pay if payroll gave it, and the pay date. Like every
  table, it's sealed per firm, and the tests that try to reach another firm's data now include it.
  The app can add and correct lines but never delete them: they're what a pay question gets
  checked against.
- **Importing pay**: `npm run import -- --firm acme --kind pay --as <office email> pay.csv` reads a
  payroll file with Staff ID (or mobile), week start, week ending, hours, rate, gross pay and pay
  date. Money is stored exactly in **pence** (no rounding errors). Importing the same file again
  updates lines instead of doubling them. The action log records which fields changed, never the
  amounts.
- **The pay page**: after the worker types their 6-digit code, they see the last 8 weeks, newest
  first: "Mon 26 Oct to Sun 1 Nov", "37.5 hours at £12.50 an hour", "Gross pay: £468.75", "Pay
  date: Fri 6 Nov". We never work out a figure ourselves. If payroll didn't send a gross, none is
  shown. The code check happens twice, on the page and again in the code that reads the pay.

### Two problems the safety review found (fixed and tested)

1. **Decimal commas.** Some spreadsheets write £12.50 as "12,50". The first version read that
   as £1,250.00. Now a comma is only accepted as a thousands separator ("1,234.56"); "12,50" is
   refused with a clear message instead of a wrong number.
2. **Corrected hours.** If payroll corrected someone's hours but left gross pay blank, the old
   gross stayed, and the page showed hours and a gross that didn't match. Now the old gross is
   cleared when the hours change.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| The table follows the data model doc, one line per worker, period and rate | A week can have two rates | One row per week |
| No deleting pay records from the app | They're the evidence for pay questions (Dylan to confirm; removal comes with the Phase 6 payroll screen) | Allow deletes |
| Only show figures payroll sent | Golden rules 1 and 9: pay figures come from the firm's data | Work out a gross from hours × rate |
| "Raise a pay query" waits for Phase 6 | That's where pay queries are built | Build it now |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/integration/pay.test.ts` (4 tests, real database): importing adds, updates and leaves
  lines alone correctly, with amounts never in the log; bad rows are skipped by row number and
  reason; the page's data is the last 8 weeks, only with a code from the last 30 minutes, and
  never another firm's.
- `tests/unit/portal.pay.test.ts` (5 tests): reading money and hours exactly (including decimal
  commas refused), and the page rendered.
- The isolation and database-rule suites now cover `pay_records`. The browser pay test now expects
  "No pay data yet for this period." after the code.

### Parked, open, and things that need Dylan

- **Please look over:** the new `pay_records` table (in `docs/data-model.md`) and "no deletes".
- Parked in `PLAN.md`: how the office corrects a wrong line and how a corrected rate is handled
  (Phase 6); pay records and GDPR deletion (Phase 8); demo pay data (the demo-seed task).

### How to see it working

1. Log in (`npm run dev`, then `http://acme.localhost:3000/login`), tap "See your pay", ask for a
   code and type it in (the code appears in the `npm run dev` terminal).
2. With no pay data yet it says "No pay data yet for this period." To see figures, import a small
   file, for example a `pay.csv` with the header `Mobile,Week start,Week ending,Hours,Rate,Gross
   pay,Pay date` and a line `07700 900100,26/10/2026,01/11/2026,37.5,12.50,468.75,06/11/2026`
   (for the demo worker you logged in as), then `npm run import -- --firm acme --kind pay --as
   acme.payroll@example.com pay.csv --apply`, and open the pay page again (type a new code if 30
   minutes have passed). It shows the line you imported.

## 2026-09-29: Phase 3, task 7: Profile page (0.5 h)

### Time

0.5 hours of Claude's working time (00:31 to 01:02 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=b1f8e8b8d519a514 e2e=true`. That covers the type
  checks, lint, all 1412 tests (up from 1370), the 12 browser tests (up from 10) and the rule
  checks. A production build was also run and succeeded.
- The first verify run failed on one browser test. The cause is explained below. The second run
  passed.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

A **profile page** at `/profile`. A worker reaches it by tapping "My profile" on the home page.
It has four parts.

1. **Your details.** Name, mobile number and email, exactly as the office holds them. The page
   says "To change these, ask the office." Workers can't edit them here, because the mobile
   number is what they log in with.
2. **Licences and cards** (credentials: the licences a job needs, such as an SIA licence). Each
   one shows its status in words (Valid, Expired, Applied for, Suspended) and its expiry date.
   - An expired or suspended one is red and says what to do.
   - An old expired one is hidden once the worker has a newer valid one, or has applied to
     renew it.
3. **Days you can't work.** The worker picks a date and taps "Mark as unavailable". Each marked
   day has a "Remove" button.
   - Any day from today to 6 months ahead, with at most 60 days marked at once.
   - If they're already booked that day, the page says so. The booking isn't cancelled: a
     cancellation must be deliberate, with a reason and notice.
   - **The booking rules now use these days.** The rules engine has always had a check for
     "marked unavailable" (check 8), but until now it was always given an empty list. Now a
     worker can't take a shift that touches a marked day (a night shift touches two days).
     The office can still place them, with a reason, which is logged.
4. **How we reach you.** WhatsApp or text message, and "Tell me about open shifts" on or off.
   "Save settings" answers, for example, "Saved. We'll send shift messages by text message. We
   won't tell you about open shifts.", signed "[Firm] Shift Team". Nothing sends messages from
   these settings yet: the sender comes in Phase 4 and will read them.

Key facts:

- **The database.** There is one new table, `worker_unavailable_days`: one row per worker and
  day. A table is like a spreadsheet tab in the database. The `workers` table gets two new
  columns:
  - `notify_channel`: `whatsapp` or `sms`; the database refuses anything else.
  - `offer_alerts`: true or false.
- **The migration.** A migration is a script that changes the database's shape. This one is
  `drizzle/0010_profile.sql`, and it only adds things.
- **Tenant isolation.** The new table has the firm's id on every row. Row Level Security stops
  one firm's rows being seen from another firm's session. The app may read, add and delete rows,
  but never edit one.
- **The action log.** Every change writes a row to the log:
  - `worker.unavailable_added` and `worker.unavailable_removed`, holding the date only;
  - `worker.notification_settings_changed`, holding the two choices, and only when something
    actually changed.

### Problems found on the way (root cause first)

- A test's setup SQL put text into an id column. Postgres guessed the type of the test's
  placeholders as text inside a `union all`. Fixed in the test by saying the type
  (`$1::uuid`).
- A test expected `value="sms" checked=""`, but React writes the attributes the other way round.
  The test now checks each input's tag on its own, whatever the order.
- **The first verify run failed on the browser test.** It looked for "the confirmation message"
  and found two: the day-off confirmation stays on screen while the settings confirmation
  appears. The test now looks inside each section. What it expects is unchanged.

### What the safety review found (all fixed or parked)

The guardrails reviewer found no broken golden rule. It suggested improvements, all done except
one:

- hide replaced licences;
- red for suspended ones;
- a fuller "Saved" message with the sign-off;
- a stricter date check;
- read, add and delete only (no edits) on the new table;
- each "Remove" button named for its day, for screen readers;
- one database query instead of one per day.

Parked: the licence expiry reminders still go by WhatsApp whatever the new setting says. They
move onto the Phase 4 sender.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| One row per unavailable day, today to 180 days ahead, at most 60 | Simple to show and to check; a cap stops junk | Date ranges |
| Marking a day never cancels a booking | Cancelling must be deliberate, with a reason and notice (golden rule 12) | Cancel it automatically |
| The settings are two columns on `workers` | They're what the Phase 4 sender needs; a separate table for two values adds joins | A settings table |
| Contact details are read-only | The mobile number is the login; changing it needs a checking step | Let workers edit them |
| The office can override an unavailable day, with a reason | The rules doc already lists "unavailable" as an office override | No override |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/integration/profile.test.ts` (13 tests, real database):
  - the page's data (details, every credential state, replaced ones hidden);
  - marking and clearing days, with the log rows;
  - the date limits and the 60-day cap (past days don't count);
  - "booked that day", including a shift ending at midnight and a night shift;
  - a booking refused on a marked day, and the office override;
  - the settings saved and logged only on a real change;
  - the database refusing a third channel;
  - another firm's worker can never be seen or changed.
- `tests/integration/eligibility-input.test.ts` (1 new test): the rules get the worker's
  marked days from the day before the shift to the day after, and no one else's. I checked that
  this test and the booking one fail if the days aren't loaded.
- `tests/unit/portal.profile.test.ts` (9 tests): the page's words and colours, the answer to
  every kind of change, and that the page's channel list matches the database's.
- `tests/e2e/profile.worker.spec.ts` (2 browser tests, phone-sized):
  - a worker logs in, sees an expired licence, marks a day and removes it, and saves text
    message with no alerts; the settings are still there after a reload;
  - the page needs a login.
- The isolation suites now cover the new table.

### Parked, open, and things that need Dylan

- **Please look over:**
  - the new table and the two new columns (in `docs/data-model.md`);
  - the `/profile` row in `docs/screens.md`, which I updated to match the built page's wording.
- Parked in `PLAN.md`:
  - Phase 4's sender must honour the settings, and skip offers on marked days;
  - the office sees marked days and edits contact details (Phase 5);
  - uploading a renewed licence from the profile.
- The "Add to home screen" prompt on this page comes with the service-worker task, next in
  Phase 3.

### How to see it working

1. Start the app: `npm run dev`. Open `http://acme.localhost:3000/login` and log in as
   `07700 900125`. The login link appears in the `npm run dev` terminal. This demo worker's SIA
   licence has expired.
2. Tap **My profile**. You should see your details, then "SIA door supervisor licence" in red,
   marked "Expired", with what to do.
3. Pick a date under "Days you can't work" and tap **Mark as unavailable**. It says "Marked ... as
   unavailable." and the day appears in the list with a **Remove** button.
4. Choose **Text message**, untick **Tell me about open shifts**, and tap **Save settings**. Reload
   the page: your choices are kept.

## 2026-09-29: Phase 3, task 8: Blocked-shift screen (0.4 h)

### Time

0.4 hours of Claude's working time (01:05 to 01:31 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=8aa6427c55e0a62a e2e=true` on the first run. That
  covers the type checks, lint, all 1431 tests (up from 1412), the 14 browser tests (up from 12)
  and the rule checks. A production build was also run and succeeded.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Each shift now has its own page, at `/shifts/<the shift's id>`. It's where a worker lands from a
shared link. Later (Phase 4), the WhatsApp offers will link here too. The page shows the day,
times, role and site, then one of these, worked out from the database:

- **Booked:** the shift's instructions, "Open in maps", "Ask for a change" and "Cancel this shift".
  Only a worker booked on the shift sees its instructions, because they can include access
  details.
- **Open:** how many places are left and "Take shift".
- **Held:** under fair rotation, when the worker can take it.
- **Blocked** (the rules say no): "You can't take this shift:", then the rules' reasons in plain
  English. For example: "Your SIA door supervisor licence expired on 3 Oct. Renew it, then send
  the new number to the office." Below the reasons are an optional note box and the button **Ask
  the office to review**.
- **Filled, started, cancelled or not found:** one plain sentence and "See open shifts".

**Ask the office to review** sends a request to the office. The worker sees a confirmation they
can screenshot: "We've sent this to the office.", when it was sent, a reference and the firm's
sign-off. The request shows in My requests as "Review", "Waiting for the office". The office's
screen for handling these comes in Phase 5.

Key facts:

- **A new request type, `review`** (migration 0011; a migration is a script that changes the
  database's shape). The request stores what the worker was shown:
  - the rules' codes (short labels like `credential_missing`);
  - the reasons in words;
  - the worker's note.
- **The log entry** (in the action log) holds only ids, the type and the codes. It never holds
  the note.
- **Code decides.** Before adding a review, the server checks the rules again. It adds nothing
  if they now say yes, if the shift is full or started, or if the worker is already booked. A
  review never books anyone and never loosens a rule.
- **One waiting review per worker and shift.** Asking again gives the same reference. A test
  sends five taps at the same moment and checks that exactly one review is added. I also checked
  that this test fails if the lock that makes it safe is removed.
- **Open shifts link here.** When "Take shift" is refused there, the answer now has "Ask the
  office to review", which opens this page. On this page itself, a refusal shows the review form
  straight away.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| A new request type `review` | The office can pick reviews out of its queue by type | A "general" request with a marker (harder to filter) |
| Keep the codes, reasons and note on the request | The office sees what the worker saw at the time | Codes only |
| The rules are checked again before adding a review | Golden rule 1: code decides. A review of a shift they can take is noise | Trust the page |
| Instructions only for booked workers | They can include door codes or meeting points | Show them to everyone |
| A review only asks | The office decides and can override or fix the data | Book the worker automatically |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/integration/shift-detail.test.ts` (9 tests, real database):
  - every state of the page, and that instructions never show unless booked;
  - the review request is added with the right details and log entry;
  - asking again gives the same reference, and the review appears in My requests;
  - no review is added when there's nothing to review (7 different cases);
  - an over-long reason is cut to size rather than failing;
  - five taps at once add one review.
- `tests/unit/portal.shift-detail.test.ts` (8 tests): the page's words for every state, and every
  answer after asking for a review.
- `tests/unit/portal.open-shifts.test.ts`: the refusal's new wording and its link.
- `tests/integration/roster.schema.test.ts`: the database insists a review names its shift.
- `tests/e2e/shift.blocked.spec.ts` (2 browser tests, phone-sized):
  - a worker whose SIA licence has expired opens a door-supervisor shift, sees why, asks for a
    review, sees it's been asked after a reload, and finds it in My requests;
  - a link to a shift that doesn't exist says so.

### Parked, open, and things that need Dylan

- **Please look over:**
  - migration 0011 (the `review` request type);
  - the `/shifts/[id]` row in `docs/screens.md`, which I rewrote to match the built page.
- Parked in `PLAN.md`:
  - the office's review queue (Phase 5) and telling the worker the outcome (Phase 4);
  - similar shifts on a filled shift's page;
  - a database backstop for "one waiting request per kind";
  - using a seeded shift in the browser test once the demo seed has shifts.

### How to see it working

Nothing on screen links to a blocked shift yet. Open shifts only lists shifts you can take, the
demo seed has no shifts until the demo-seed task, and the WhatsApp offers (Phase 4) will link
here later. The browser test shows the whole flow on a phone-sized screen:

1. Stop `npm run dev` if it's running (press Ctrl+C in its terminal).
2. In the project folder, type: `npm run e2e -- tests/e2e/shift.blocked.spec.ts`
3. You should see `2 passed` at the end. It logs in as a demo worker whose SIA licence has
   expired, opens a door-supervisor shift, sees why they can't take it, and asks the office to
   review it.

## 2026-09-29: Phase 3, task 9: My shifts without signal, and "Add to home screen" on iPhone (0.6 h)

### Time

0.6 hours of Claude's working time (01:34 to 02:10 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=4435071fb786f4b5 e2e=true`. That covers the type
  checks, lint, all 1453 tests (up from 1431), the 19 browser tests (up from 14) and the rule
  checks. A production build was also run and succeeded.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

**My shifts opens with no signal.** A **service worker** is a small script the browser runs
beside the page. It can answer the page's requests itself, from a store on the phone called
the **cache**. Ours is `public/sw.js`, about 180 lines, and it does one job:

- Each time My shifts loads properly, it keeps a copy on the phone. That's the page itself plus
  the site's own style and script files, so it looks right.
- When the worker opens My shifts with no signal, or no answer comes within 4 seconds, it shows
  that copy. At the top it says: "No signal. These are your shifts from 14:05 on Sat 7 Nov. They
  may have changed. Taking or cancelling a shift needs signal."
- If there's no copy yet, it shows a plain "No signal" page instead of the browser's error.
- My shifts now always says "Updated {time}" under the greeting.

**Keeping personal data safe on the phone:**

- Only My shifts is kept. Pay, requests and the office are never kept.
- The copy is deleted when the worker logs out, when anyone logs in on that phone, and when the
  server says they're no longer logged in. It's never shown if it's more than 14 days old.
- A setting, `OFFLINE_COPY`, switches it. It's on in production and off while developing, and
  switching it off removes it from phones.

**"Add to home screen" on iPhone.** iPhones have no install button for websites, so My shifts
and Profile show iPhone and iPad users "Put your shifts on your home screen. Open your browser's
Share menu, then tap Add to Home Screen." There's a "Don't show again" button. A **web app
manifest** (a small file describing the app to the phone) names it "{Firm} shifts" on the home
screen and opens it at My shifts.

### What the safety review found

The guardrails reviewer found one real problem, now fixed. The service worker kept any style
or script path it found written in the page. The page includes text the firm types, such as
shift instructions. A crafted path like `/_next/static/../../pay` would really point at the pay
page, and the service worker would have saved that page on the phone. Now a path is kept only if
it really points at the site's style and script files, and those are fetched without the
worker's login. A test tries three tricky spellings. I checked that the test fails if the fix is
removed.

It also found gaps, all fixed:

- The copy was only kept after a full page load. Now it's also kept after logging in or going
  back to My shifts.
- If the service worker's storage failed, My shifts wouldn't open. Now it always falls back to
  the network.
- Logout now deletes the copy first, even if the logout itself fails for lack of signal.
- There's now a test that a second worker logging in on the same phone never sees the first
  worker's copy.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| A small hand-written service worker, no library | We only keep one page; easy to read and test | Workbox / next-pwa (keeps far more) |
| Network first, the copy only after 4 seconds or with no signal | Fresh whenever possible | Always show the copy first |
| The "No signal" notice is built into the page, hidden; the service worker unhides it | Works even if scripts fail offline | A script that checks for signal |
| Delete the copy on logout, login and "logged out"; not shown after 14 days | A shared or lost phone shouldn't keep it | Keep it forever |
| iPhone hint only, no icons yet | The task says iPhone; icons come with firm branding | Android install button (parked) |

Full list: `docs/overnight-log.md`, this task's entry. New decision record: ADR-016 in
`docs/decisions.md`.

### What the new tests prove

- `tests/unit/offline.sw.test.ts` (17 tests). It runs the real `public/sw.js` in a sandbox,
  with a pretend cache and network. It checks:
  - which requests it answers;
  - keeping the copy and its files, never other pages (the path trick), and with only the
    headers it needs;
  - the "keep" message and its 10-second skip;
  - forgetting the copy when logged out, and keeping it through a server error;
  - no signal, poor signal (the 4-second switch, then updating the copy), no copy, and a copy
    too old to show;
  - falling back to the network when its storage fails;
  - old caches removed by a new version;
  - the `OFFLINE_COPY` switch.
- `tests/unit/portal.home-screen.test.ts` (3 tests): the hint shows on iPhone and iPad only,
  not from the home screen, and not once dismissed.
- `tests/e2e/offline.worker.spec.ts` (5 browser tests):
  - My shifts opens offline with the notice, and logging out deletes the copy;
  - a second worker logging in on the same phone gets their own copy, never the first worker's;
  - the manifest names the firm;
  - on an iPhone the hint shows and stays hidden after "Don't show again";
  - on Android there's no hint.

### Parked, open, and things that need Dylan

- **Please check on a real iPhone (important):**
  1. Log in and add the portal to the home screen.
  2. Open it from the home screen: are you still logged in?
  3. Log out there and log in again: the WhatsApp link opens Safari. Does the home-screen app
     stay logged out?
  If it does, workers need a typed login code. Until then the hint can be taken out of
  `src/app/page.tsx` and `src/app/profile/page.tsx`. Also check the hint's wording matches what
  you see.
- **Please look over:** ADR-016 and the new paragraph in `docs/compliance.md` about what's kept
  on the phone.
- Parked in `PLAN.md`:
  - home-screen icons in the firm's branding;
  - an Android install button;
  - web push (Phase 4);
  - a line in the privacy notice about the copy on the phone.

### How to see it working

The offline copy is off while developing (a slow first page build would show an old copy). The
browser test switches it on and shows it working:

1. Stop `npm run dev` if it's running (Ctrl+C in its terminal).
2. In the project folder, type: `npm run e2e -- tests/e2e/offline.worker.spec.ts`
3. You should see `5 passed` at the end.

## 2026-09-29: Phase 3, task 10: Empty and error states in plain language (0.2 h)

### Time

0.2 hours of Claude's working time (02:13 to 02:26 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=288f758da390f1fc e2e=true` on the first run. That
  covers the type checks, lint, all 1531 tests (up from 1453), the 20 browser tests (up from 19)
  and the rule checks. A production build was also run and succeeded.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Most screens already had their "nothing here" and "that didn't work" messages from their own
tasks. This task filled the gaps and added a check that keeps every screen plain.

- **A link that goes nowhere** (an old or mistyped address, or a firm that doesn't exist). The
  framework's default said "404 | This page could not be found." Now it says "We can't find that
  page. The link may be old or mistyped." with a "Go to my shifts" button.
- **When a page breaks**, it says "Something went wrong. It's not you. Try again in a moment. If
  it keeps happening, contact the office." It has "Try again" and "Go to my shifts". If the phone
  has no network at all, it says "No signal. Check your signal and try again." instead. There's
  also a plain version for the rare case where even the page's frame breaks.
- **When a tap fails** (taking, cancelling, a request, a review, the profile, a pay code, login),
  it says "Something went wrong. Try again." or, with no network at all, "No signal. Try again
  when you have signal."
- **Open shifts with nothing open** says "We'll message you when something matches." only to
  workers who asked for open-shift messages (the profile setting). Everyone else sees "Nothing
  open right now. Check back later."

**The lasting check** is `tests/unit/copy.plain-language.test.ts`. It draws every staff screen in
every empty, error and answer state: 71 of them, plus the service worker's "No signal" page. It
fails if the text has any of these:

- jargon a worker shouldn't need ("error", "invalid", "session", "token", "credential",
  "eligible"...);
- a raw code (like `door_supervisor` instead of "Door supervisor");
- "undefined" or "null" leaking into the text;
- a sentence over 25 words.

Every existing screen passed first time. I checked that the test fails if "404 error" is put back
into the not-found page.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Use the browser's "online" flag only to choose the wording | Reliable when there's no network; with weak signal the general words are still true | Guessing from the kind of failure |
| Office screens wait for Phase 5 | This task is the staff portal's | Do both now |
| The plain-words rules are a test, not a note | Copy is product (golden rule 11); new screens stay plain | A checklist in the docs |

### What the new tests prove

- `tests/unit/copy.plain-language.test.ts` (5 tests; 71 screen states in one of them): every
  staff screen and state is plain. It also shows that the check catches what it should, and that
  "no signal" wording appears only with no network.
- `tests/e2e/home.spec.ts` (1 new browser test): a mistyped page and a firm address that doesn't
  exist both show the plain page (never "404"), with "Go to my shifts".
- `tests/integration/open-shifts.test.ts` and `tests/unit/portal.open-shifts.test.ts` (1 new each):
  the open-shift messages setting is read, and the empty page only promises a message when it's
  on.

### Parked, open, and things that need Dylan

- Parked in `PLAN.md`:
  - Phase 4 must make "We'll message you when something matches" true;
  - office screens' own states (Phase 5), added to the same test;
  - a "your login has run out" message on the login page.
- Nothing needs Dylan for this task.

### How to see it working

1. `npm run dev`, then open `http://acme.localhost:3000/no-such-page`. You should see "We can't
   find that page." with a "Go to my shifts" button.
2. Log in, turn off "Tell me about open shifts" in My profile, then open "See open shifts". With
   nothing open it says "Nothing open right now. Check back later."

## 2026-09-29: Phase 3, task 11: Demo seed with Acme's Saturday and an urgent dropout (0.5 h)

### Time

0.5 hours of Claude's working time (02:29 to 02:57 UTC), in the unattended overnight loop.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=dec40ac0860376b2 e2e=true`. That covers the type
  checks, lint, all 1545 tests (up from 1531), the 20 browser tests and the rule checks. A
  production build was also run and succeeded.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

The **demo seed** is the fake data that `npm run db:seed` (or `npm run db:reset`) loads, so
there's something to show on a call. It now includes **Acme's Saturday event day**, always the
coming Saturday:

- **40 shifts** at the three demo sites, each with instructions:
  - a match day at the arena: stewards, door supervisors and one early door supervisor;
  - a race day at the racecourse: stewards and security officers;
  - security officers at the shopping centre, early and late.
- **32 shifts are booked**, each by a worker the booking rules would allow (a test checks all
  32 against the real rules). **8 are open.**
- **The urgent dropout:** a door supervisor booked the 08:00 shift three days ago and cancelled
  at 6am ("I'm unwell"). The notice he gave is recorded, and the shift is open again and marked
  urgent. The seed prints a link to that shift's page.
- **Two open requests:** a time change and a swap.
- **Pay for 8 weeks** for every Acme worker, as payroll's file would give it. Stewards get
  £13.00 an hour, door supervisors £14.50 and security officers £13.50, all above the minimum
  wage.
- **The action log** has each shift, booking, the cancellation and the requests, as the app
  itself would log them.

Running the seed again the same week adds nothing, and never undoes what a demo did. For a
clean slate before a call, use `npm run db:reset`. Workers 07700 900100 to 900104 are never
booked, so they're free for a demo login. `docs/testing.md` now has a table of which demo
mobile numbers are good for what.

Two browser tests had assumed an empty firm. They now check the seeded day just as strictly:

- the free steward sees exactly the 4 open steward shifts;
- the pay page shows exactly that worker's seeded lines and amounts.

### What the safety review found (all fixed or parked)

The review found no broken rule. Its suggestions, all done except one parked:

- raise the steward rate above the minimum wage;
- fix a test that would fail for an hour after midnight on summer Mondays (UTC and London
  dates differ);
- date the seeded shifts before the bookings on them;
- log each shift's creation;
- stricter tests;
- doc corrections;
- only add bookings along with their own shifts.

Parked: a log entry for the "urgent" mark, for when the office can mark shifts urgent.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| The event is always the coming Saturday, and its ids include the date | A demo is always in the future; re-runs never move booked shifts | A fixed date (would go stale) |
| Re-runs only add, never reset, the event day | A re-run mid-demo mustn't undo the demo | Resetting (could leave more bookings than places) |
| The dropout happened at 6am on the day the seed runs | docs/testing.md asks for "a 6am cancellation"; the notice given is then real | Cancelling on the event morning (in the future) |
| Log the bookings, the cancellation and requests, but not the pay lines | The pay lines didn't come through an import, so an "imported" entry would be untrue | Log everything, or nothing |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/unit/seed.saturday.test.ts` (7 tests). It covers:
  - which date "next Saturday" is;
  - the counts;
  - the 6am rule, including before 6am;
  - ids staying the same all week and changing the next;
  - London times either side of the clocks going back;
  - the pay weeks and amounts.
- `tests/integration/seed.test.ts` (7 new tests, real database). It checks:
  - the day's shape;
  - the dropout's evidence;
  - every booking passing the real rules, with the free workers left free;
  - the requests, the pay and the log entries;
  - a free worker taking a shift, and a re-run leaving that booking alone.
  The "running it again changes nothing" check now covers all the new rows and log entries.
- The login and pay browser tests now check the seeded day.

### Parked, open, and things that need Dylan

- Parked in `PLAN.md`:
  - Northline's mocked sheet;
  - the firm's short-notice cancellation (Phase 5);
  - pay queries (Phase 6);
  - past shifts to match the pay lines;
  - a log entry for the urgent mark.
- Nothing needs Dylan for this task.

### How to see it working

1. `npm run db:reset` (this wipes your local database and loads the demo). Then `npm run
   db:seed`: it adds nothing, but prints the Saturday's date and a link to the urgent dropout's
   page.
2. `npm run dev`, then log in at `http://acme.localhost:3000/login` as `07700 900100`. Tap "See
   open shifts": you should see four steward shifts on Saturday with "Take shift".
3. Log in as `07700 900125` (expired SIA licence) and open the urgent dropout's link. It says
   why you can't take it, with "Ask the office to review".

## 2026-09-29: Phase 3, task 12: The whole worker journey in one browser test (0.1 h). Phase 3 complete

### Time

0.1 hours of Claude's working time (03:00 to 03:09 UTC), in the unattended overnight loop.
**Phase 3 is complete:** 4.5 hours in total against its estimate of 35 to 45 hours.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=bb6abf137a0bd7c6 e2e=true` on the first run. That
  covers the type checks, lint, all 1545 tests, the 21 browser tests (up from 20) and the rule
  checks.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

One browser test, `tests/e2e/flow.worker.spec.ts`, plays a worker on a phone-sized screen using
the demo seed's Saturday. It:

1. logs in with a link;
2. takes the racecourse shift, getting "You're booked." with a reference;
3. cancels it with "I'm unwell", getting the notice given and a reference;
4. takes the late shopping-centre shift and asks for a change of times, then sees it in My
   requests;
5. opens the pay page with a 6-digit code.

It times each step. Phase 3's "Done when" asks that logging in, taking and cancelling each take
under 30 seconds. Here they took **2.1, 1.1 and 0.5 seconds**. That's on the development server,
which builds pages as they're first opened, so a real phone should be faster still.

`docs/testing.md` now has the staff part of the demo script as numbered steps you can follow on
a call. The office part of the script ("resourcer sees it", "urgent wave fills it", "notice
report shows both") needs screens from Phases 4 and 5. The action log already records every
step the worker takes.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| The test uses a security officer (07700 900157) | Other tests count the open steward shifts; nothing counts the security ones, so this test can't upset another | A steward |
| Time each step inside the test, limit 30 seconds | That's the "Done when"; the test fails if a step gets too slow | A separate speed-testing tool |

### What the new test proves

- `tests/e2e/flow.worker.spec.ts` (1 browser test): the whole worker journey works end to end on
  a phone-sized screen, on seeded data. Logging in, taking and cancelling each take well under
  30 seconds.

### Parked, open, and things that need Dylan

- The office half of the demo script comes with Phases 4 and 5.
- Nothing needs Dylan for this task.

### How to see it working

Follow "Staff part" under "Fixtures and the demo seed" in `docs/testing.md`. Or stop `npm run
dev` and run `npm run e2e -- tests/e2e/flow.worker.spec.ts`: you should see `1 passed` and a
line with the timings.

## 2026-09-29: Phase 4, task 1: The urgent flag on shifts (0.4 h)

### Time

0.4 hours of Claude's working time (03:11 to 03:33 UTC), in the unattended overnight loop.
Phase 4 so far: 0.4 of its 27 to 37 hour estimate.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=ff55af013144d14d e2e=true`. That covers the type
  checks, lint, all 1565 tests (up from 1545), the 21 browser tests and the rule checks. A
  production build was also run and succeeded.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Every shift already had an "urgent" yes/no field. Now it has rules.

- **Automatically:** when someone drops out close to the start, the shift is marked urgent.
  "Close" means within the firm's urgent window, a setting that defaults to 24 hours. It counts
  a worker's own cancellation, the office's, and the office taking a name off its Google Sheet.
  It happens in the same database transaction as the cancellation (all or nothing), and it goes
  in the action log: "marked urgent, by the system, because of a dropout, 7 hours before the
  start".
- **Not a dropout:** a whole shift being cancelled; the office swapping one name for another on
  its sheet; the office cancelling someone after the shift has started (no place reopens).
- **By hand:** the office (admins and resourcers, not payroll) can mark a shift urgent, or clear
  the mark, and that's logged too. The button comes with the office's Today screen in Phase 5.
- A firm's window setting that makes no sense falls back to 24 hours, so a cancellation can never
  fail because of it.
- The demo seed's urgent dropout is now logged as Acme's resourcer marking it by hand. It was
  cancelled more than 24 hours before the start, so the system itself wouldn't have marked it,
  and the log never claims otherwise.

Offer waves (sending the shift to the best workers, a few at a time) are the next tasks. They'll
start from here.

### What the safety review found

The review found one real bug, now fixed. When the office **swapped** one name for another on
its sheet close to the start, the sync first removed the old name and then added the new one. In
between, the check saw a free place and marked the shift urgent, writing a false "dropout" into
the permanent log. The fix checks once, after the whole change. A new test swaps a name seven
hours before the start and expects nothing urgent; I checked it fails with the old code.

It also asked for:

- a test for a whole shift cancelled on the sheet;
- a strict check on the office's request (a real yes/no, the office user's id);
- one shared definition of the window setting;
- the log entry's `source: "sheets"`;
- letting the office clear the mark on a cancelled shift;
- a more honest seed test.

All done.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| A bad window setting falls back to 24 hours | A cancellation must always be recorded | Stop the cancellation |
| The mark stays when the shift fills | The urgent board and offer waves only look at open places; the office can clear it | Clear it automatically on fill |
| The office's own cancellations count too | The gap is the same for the workers who could fill it | Workers' only |
| No office screen yet | It belongs on the Today screen (Phase 5) | A stop-gap page |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/unit/rules.urgent.test.ts` (5 tests): the window's edges, the setting and its fallback,
  the hours to the start.
- `tests/integration/urgent.test.ts` (12 tests, real database). It checks:
  - inside and outside the window, and a firm's own window;
  - a broken setting, and the office's cancellation;
  - already urgent, and cancelling after the start;
  - the office marking and clearing, and who may;
  - which shifts, a strict request, and another firm's shift.
- `tests/integration/sheets.sync.test.ts` (3 new tests): a name removed close to the start is
  urgent; a name swapped isn't; a whole shift cancelled isn't.
- `tests/integration/seed.test.ts`: the seed's urgent mark is logged as the resourcer's.

### Parked, open, and things that need Dylan

- Parked in `PLAN.md`:
  - the Today screen's "Mark urgent" button (Phase 5);
  - optionally clearing the mark when a shift fills;
  - offer waves starting from "a place reopened close to the start".
- Nothing needs Dylan for this task.

### How to see it working

There's no screen for it yet. The tests show it: `npx vitest run tests/integration/urgent.test.ts`
should say `12 passed`.

## 2026-09-29: Phase 4, task 2: The urgent board (0.2 h)

### Time

0.2 hours of Claude's working time (03:35 to 03:46 UTC), in the unattended overnight loop.
Phase 4 so far: 0.6 of its 27 to 37 hour estimate.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=ff128133b12ecea4 e2e=true` on the first run. That
  covers the type checks, lint, all 1576 tests (up from 1565), the 23 browser tests (up from 21)
  and the rule checks. A production build was also run and succeeded.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

- **The urgent board** at `/urgent`: the shifts marked urgent (last task) that this worker could
  take right now, soonest first, each labelled "Urgent" with a big "Take shift" button. If there
  are none: "No urgent gaps right now." with "See all open shifts".
- **My shifts** now says "1 urgent shift needs someone" (or "3 urgent shifts need someone") with
  "See urgent shifts". It only shows when the worker could actually take one.
- **Open shifts** labels urgent cards "Urgent" too.

"Only shifts they're eligible for" is guaranteed by using exactly the same loader as Open shifts,
with an "urgent only" filter added. So the same checks decide both boards:

- licences in date;
- the right role;
- no clashing bookings;
- enough rest;
- the weekly hours cap;
- days they marked unavailable;
- a place left.

Nothing can appear on the urgent board and then be refused. The shift card is now one shared
piece used by both boards.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| The urgent board is Open shifts' loader with an urgent filter | One set of checks; the two boards can't disagree | A separate query |
| The banner counts urgent shifts the worker could take, including ones briefly held under fair rotation | They can take them within minutes; the card says when | Count only ones takeable this second |
| A clear "Urgent" label on each card, not a red board | Plain and readable; colour alone isn't enough for everyone | Red cards |

### What the new tests prove

- `tests/integration/open-shifts.test.ts` (1 new test, real database): the urgent filter lists
  only urgent, open shifts this worker could take, soonest first. It leaves out:
  - a full shift;
  - another role;
  - a started shift;
  - another firm's shift;
  - a worker without the licence.
- `tests/unit/portal.urgent.test.ts` (7 tests): the board with and without shifts, a held shift,
  the "Urgent" label on Open shifts, and the My shifts banner.
- The plain-language test covers the new screens.
- `tests/e2e/urgent.worker.spec.ts` (2 browser tests, demo seed):
  - a free door supervisor sees "1 urgent shift needs someone", opens the board and takes the
    urgent dropout;
  - a steward sees "No urgent gaps right now."

### Parked, open, and things that need Dylan

- Nothing new parked. Nothing needs Dylan.

### How to see it working

1. `npm run db:reset`, then `npm run dev`.
2. Log in at `http://acme.localhost:3000/login` as `07700 900138` (a door supervisor with a valid
   licence). My shifts says "1 urgent shift needs someone".
3. Tap "See urgent shifts": the early arena shift, labelled "Urgent", with "Take shift".

## 2026-09-29: Phase 4, task 3: Offer waves and escalation (0.4 h)

### Time

0.4 hours of Claude's working time (03:49 to 04:16 UTC), in the unattended overnight loop.
Phase 4 so far: 1.0 of its 27 to 37 hour estimate.

### Result

- `scripts/verify.sh` printed `VERIFIED tree=a1055ceecd143f4e e2e=true`. That covers the type
  checks, lint, all 1597 tests (up from 1576), the 23 browser tests and the rule checks. A
  production build was also run and succeeded.
- The independent auditor gave `VERDICT: DONE` on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

When someone drops out close to the start (or the office marks a shift urgent), the app now
offers the shift out by itself. It does this with **background jobs**: tasks the separate
worker process runs later, from a queue in the database (pg-boss).

1. **Wave 1** goes out at once. Under fair rotation, it goes to the firm's `wave_size` best
   workers (default 4): those with the fewest hours booked that week, then whoever was offered a
   shift longest ago. Everyone offered must be eligible:
   - the booking rules allow it (licences, role, rest, weekly hours, unavailable days);
   - they have "Tell me about open shifts" on;
   - they aren't on the shift, haven't cancelled off it, and haven't been offered it already.

   Each gets: "URGENT: we need a door supervisor at Acme Demo Arena today 19:00–03:00. Tap to
   take it: {link}. — Acme Events Shift Team", by WhatsApp or text, as their profile says.
2. **Wave 2** goes to the next group `wave_minutes` later (default 15), and so on.
3. **It stops** by itself when the shift is filled, has started, was cancelled, is no longer
   marked urgent, or there's nobody left to ask. When it fills, the person who took it has their
   offer marked "accepted", and the others "filled elsewhere".
4. **Escalation:** at the start minus `escalate_hours_before_start` (default 3), if a place is
   still free, the office's admins and resourcers get an email: "Unfilled: Door supervisor at
   Acme Demo Arena, …".

Every offer is recorded (the `offers` table and the action log). Under first come, first served
(the default mode), everyone eligible gets the offer at once, as the docs say.

**No real messages.** Everything goes through the console "transport": it prints the message
and writes a file in development, and the tests capture messages. Twilio isn't connected (a hard
limit for tonight).

### What the safety review found (all fixed)

- **A bad escalation setting could have stopped cancellations.** Waves are queued in the same
  transaction as the cancellation (all or nothing). The setting was read there and threw on
  nonsense, so a worker couldn't have cancelled. It now falls back to 3 hours; a test proves the
  cancellation still goes through.
- **Clearing the urgent mark didn't stop the waves.** It does now.
- **A false record:** a worker the office placed after offering them was marked "filled
  elsewhere". Now they're "accepted".
- **Missing tests:**
  - a second dropout starts another wave;
  - a name taken off the sheet starts waves;
  - an escalation that's already due runs at once.

  All added.
- Also: offer rows are now written before any message is sent (so a failed transaction can't
  leave messages behind). Urgent shifts are never held back by fair rotation. The escalation
  email says plainly when nobody could be offered the shift.

### Decisions made and why

| Decision | Why | What else was considered |
|---|---|---|
| Waves start whenever a place reopens close to the start, or the office marks it urgent | A second dropout still needs offers | Only when the flag first changes |
| The urgent message says "today", "tomorrow" or the date | The approved wording said "today" even for tomorrow; `{day}` is now a variable in the template list | Always "today" |
| Anyone who cancelled off the shift isn't offered it back | A cancellation is a "no" | Offer to everyone |
| Quiet hours, the 3-a-day cap, web push and SMS fallback wait for their own tasks | They're separate PLAN.md lines | Build all now |

Full list: `docs/overnight-log.md`, this task's entry.

### What the new tests prove

- `tests/integration/offers.waves.test.ts` (14 tests, real database, messages captured). It
  checks:
  - what starts waves, and what doesn't;
  - who gets wave 1 and wave 2, and who never does;
  - the message wording, the channel, and the 15-minute gap;
  - a retry sending nothing;
  - stopping when filled, started, closed, cleared or out of people;
  - first come, first served;
  - never offering it back to someone who cancelled, or to another firm's workers;
  - a second dropout, and bad settings;
  - escalation to the right people, once, and not when filled;
  - the wiring.
- `tests/unit/offers.waves.test.ts` (6 tests): the order, "today/tomorrow/on …" across the clock
  change, the settings, and both messages.
- Updated: urgency (waves start), allocation (urgent shifts aren't held), the Sheets sync (a
  removal starts waves), and the worker test (it ignores other tests' queued waves).

### Parked, open, and things that need Dylan

- **Please confirm:**
  - under first come, first served, offers go to everyone eligible at once (as the docs say),
    not "the best 3–5";
  - the new `shift_urgent` wording with `{day}`;
  - the escalation email wording.
- Parked in `PLAN.md`:
  - telling workers an offer was filled elsewhere, and a "No thanks";
  - an outbox so an offer can never be sent twice (with Twilio);
  - waves for shifts that aren't urgent;
  - escalation once per gap;
  - a freshness check for Sheets shifts;
  - the Today view's wave status.

### How to see it working

1. Stop `npm run dev` if it's running (Ctrl+C in its terminal).
2. In the project folder, type: `npx vitest run tests/integration/offers.waves.test.ts`
3. You should see `14 passed`.

With the app running, the offers print in the `npm run dev` terminal when a worker cancels a
shift within 24 hours of its start.

## 2026-09-29: Phase 4, task 4: Web push, built short of real sends (0.5 h). BLOCKED, not ticked

### Time

0.5 hours of Claude's working time (04:19 to 04:48 UTC), in the unattended overnight loop.
Phase 4 so far: 1.5 of its 27 to 37 hour estimate.

### Result

- **Blocked, not ticked.** A real push notification travels from our server, signed with a
  secret key (VAPID), to Google's, Apple's or Mozilla's push service, which delivers it to the
  phone. Tonight's rules forbid contacting outside services, and the key is a secret. So I built
  everything up to that point, and parked "connect the real web push" with exact steps.
- `scripts/verify.sh` printed `VERIFIED tree=d854ebcc1276a300 e2e=true`. That covers the type
  checks, lint, all 1649 tests (up from 1597), the 25 browser tests (up from 23) and the rule
  checks. A production build was also run and succeeded.
- No auditor round: the auditor decides whether to tick, and this can't be ticked yet.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

- **A new table, `push_subscriptions`:** a phone's push address for a worker (migration 0012).
  It has the usual protections: the firm's id on every row, Row Level Security, and deletion
  with the worker.
- **`POST` / `DELETE /api/push/subscribe`:** the logged-in worker saves or removes this phone's
  push address. It only accepts:
  - requests from the portal's own pages;
  - real push-service addresses (Google, Apple, Mozilla, Microsoft);
  - small requests (at most 4 KB).
  Each worker can have at most 10 phones. The address itself is never logged.
- **Profile, "Notifications on this phone":** "Turn on notifications" / "Turn off
  notifications", with plain words for every case (blocked in settings, browser can't, iPhone
  not on the home screen yet). Today it says "Phone notifications aren't switched on for Acme
  Events yet", because the key isn't set.
- **Pushing:** each urgent offer is also pushed ("Urgent shift" / "Door supervisor needed today
  19:00.") to the worker's phones, through a console sender that only prints. A phone the push
  service says is gone is deleted and logged. A setting, `PUSH_TRANSPORT`, must be "none" in
  production until the real sender exists.
- **The service worker** shows the notification and opens the shift when it's tapped. It only
  ever opens our own pages. It also re-saves a renewed subscription.
- **A shared phone:** logging out or logging in removes the phone's push address, so the next
  person doesn't get the last person's alerts.

### What the safety review found (all fixed)

It agreed "blocked, not ticked" was right. Its two must-fix items were logging when a gone phone
is deleted, and a production guard on the push sender. It also suggested:

- the shared-phone fix;
- the push-service allow-list and the 10-phone cap;
- checking the size before reading;
- pinning the key as unset in the browser tests;
- a relative link (for custom domains);
- a confirmation when turning off;
- the renewed-subscription handler.

All done. The review's tests also caught a real bug: a push without a link would have opened
`/undefined`. Fixed.

### What the new tests prove

- `tests/integration/push.test.ts` (6 tests, real database). It checks:
  - saving, removing, and a new login taking over the phone;
  - the 10-phone cap, and a repeat save logging nothing;
  - not for inactive workers or other firms;
  - only push-service addresses.
- `tests/unit/push.test.ts` (13 tests). It covers:
  - the profile's states and words;
  - the key conversion and the push wording;
  - the console sender never printing the phone's address;
  - the production guard;
  - turning the offline copy off keeping a service worker that carries notifications.
- `tests/unit/offline.sw.test.ts` (6 new tests): showing a push; never opening another site;
  tapping opens or brings forward the shift; renewed subscriptions.
- `tests/integration/offers.waves.test.ts` (2 new tests): offers are pushed to subscribed
  phones; a gone phone is forgotten and logged.
- `tests/e2e/push.worker.spec.ts` (2 browser tests). The route's checks: not logged in, another
  site, no Origin, too big, not a subscription, saved then removed. And the profile's message.
  The subscription posted is made up, so nothing reached Google or Apple.

### Parked, open, and things that need Dylan

- **To connect real web push** (PLAN.md Parking lot, numbered steps):
  1. install `web-push`;
  2. generate the keys on the server (never in the repo);
  3. set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`;
  4. write the small adapter;
  5. rate-limit the route;
  6. test on a real Android phone and an iPhone.
- Compliance wording for push (sub-processors, retention, lock-screen text): parked for the
  Phase 8 privacy notice.

### How to see it working

1. Run `npm run dev` and log in.
2. Open "My profile". Under "How we reach you" you'll see "Notifications on this phone" saying
   phone notifications aren't switched on yet. That's expected until the real sender is
   connected.

## 2026-09-29: Phase 4, task 5: Quiet hours and the SMS fallback, short of Twilio (0.3 h). BLOCKED, not ticked

### Time

0.3 hours of Claude's working time (04:51 to 05:09 UTC), in the unattended overnight loop.
Phase 4 so far: 1.8 of its 27 to 37 hour estimate.

### Result

- **Blocked, not ticked.** The task's headline is sending WhatsApp templates through Twilio,
  and its main fallback rule ("SMS if WhatsApp isn't delivered within 60 seconds") needs
  Twilio's delivery reports. Twilio is an outside service (an account, a number, approved
  templates, money), which tonight's rules forbid. So I built what doesn't need it, and parked
  "Connect Twilio" with numbered steps.
- `scripts/verify.sh` printed `VERIFIED tree=e6ac7939af395373 e2e=true`. That covers the type
  checks, lint, all 1664 tests (up from 1649), the 25 browser tests and the rule checks.
- No auditor round (nothing to tick). Committed on `build/overnight`; the push result is in
  `docs/overnight-log.md`.

### What was built

- **Quiet hours.** Each firm has quiet hours (default 22:00 to 07:00). Offer waves are urgent,
  so they go at once if the firm lets urgent messages through at night (the default). If it
  doesn't, the wave waits until the quiet hours end and goes then. Nothing is written or sent
  while it waits, and the log says "held until 07:00". It works across midnight, in London time,
  and on the nights the clocks change.
- **SMS fallback.** If WhatsApp refuses a message (the number isn't on WhatsApp), a text goes
  instead, straight away, and the offer records it went by text.
- **Other failures.** Any other failure (a timeout, an outage) isn't resent by text, because it
  might already have arrived. That offer is marked "failed" and logged, the rest of the wave
  still goes, and that worker is included in the next wave.

### What the safety review found (all fixed)

- **A clock-change bug.** On the night the clocks go back, a firm whose quiet hours end between
  1am and 2am could get an end time that had already passed. That would have made a waiting wave
  loop. Fixed, with tests on both clock-change nights.
- **The fallback was too eager.** It treated every error as "WhatsApp refused". If the text also
  failed, the whole wave was undone after earlier workers had been messaged. Now only a real
  refusal falls back, and failures are handled one worker at a time.

  My first fix deleted failed offers. The database refused, because offers are evidence the app
  may never delete, so they're now kept and marked "failed" (a small database change, migration
  0013).
- A firm's explicit "no urgent messages at night" is now kept even if the rest of the setting is
  wrong.

### What the new tests prove

- `tests/unit/rules.quiet-hours.test.ts` (9 tests). It covers:
  - when quiet hours end, across midnight;
  - the end moment itself, London time, and both clock-change nights;
  - bad settings, and keeping "no urgent at night".
- `tests/integration/offers.waves.test.ts` (6 new tests):
  - a wave held overnight and sent at 07:00;
  - urgent going at once when allowed;
  - the WhatsApp-to-text fallback;
  - a timeout (no text, marked failed, others still sent);
  - WhatsApp refused and the text failing too (both marked failed, both offered in the next
    wave);
  - two copies of a held wave (only one sends).

### Parked, open, and things that need Dylan

- **Connect Twilio** (PLAN.md Parking lot):
  1. the account and number;
  2. template approval;
  3. the Twilio adapter (only "not on WhatsApp" errors count as a refusal);
  4. the delivery-report webhook and the 60-second fallback;
  5. STOP replies;
  6. real-phone tests.
- Also parked:
  - checking the quiet-hours setting on the settings screen;
  - what a wave held past the shift's start should do;
  - text messages cost more because of the dashes in the urgent message.

### How to see it working

`npx vitest run tests/unit/rules.quiet-hours.test.ts tests/integration/offers.waves.test.ts`
(stop `npm run dev` first) should say all passed.

## 2026-09-29: Phase 4, task 6: Only eligible workers are notified, and at most 3 offers a day (0.4 h)

### Time

0.4 hours of Claude's working time (05:12 to 05:38 UTC), in the unattended overnight loop.
Phase 4 so far: 2.2 of its 27 to 37 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=65a6b41516cd7f59 e2e=true`. That covers:
  - the type checks and lint;
  - all 1690 tests (up from 1664);
  - the 25 browser tests;
  - the rule checks.
- The independent auditor took two rounds:
  - Round 1 said "NOT DONE" only because the PLAN.md box wasn't ticked yet. It found every
    claim proven and listed nothing to fix. The box is only ever ticked *after* the auditor says
    DONE, so I didn't tick it.
  - Round 2 had the same task text, plus one line explaining that order. It said
    **"VERDICT: DONE"**.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

- **A daily limit on offers.** A worker gets at most 3 shift offers a day. The limit doesn't
  apply when the shift is urgent: a gap that needs filling now always gets through.
  - "A day" is the firm's own calendar day: midnight to midnight, London time.
  - An offer that failed to send doesn't count.
  - Urgent offers do count. They still buzzed the worker's phone.
- **Where the limit lives.** Every shift offer picks its workers in one place, the *candidate
  list* (the code that works out who may be offered a shift). That list now does three things:
  - counts each worker's offers so far today;
  - asks the limit rule (`src/lib/rules/offer-cap.ts`, a *pure function*: it only takes numbers
    in and gives an answer back, so it's easy to test);
  - asks the booking rules about each worker, as it already did.
- **Urgency comes from the shift.** The list reads whether the shift is urgent from the
  database. No other code can tell it "this is urgent" to get round the limit.
- **"Only eligible workers" as a guarantee.** The booking rules check credentials, clashes,
  rest, hours and days off. Offers already went only to workers those rules allow. A new
  *boundary test* now keeps it that way. (A boundary test reads the source code and fails if a
  rule about *where* code may do something is broken.) It fails if any file other than the
  offer-wave job:
  - writes an offer;
  - builds the offer message or phone notification;
  - picks recipients some other way.
- **What it changes today.** Offer waves only run for urgent shifts, so the limit doesn't stop
  any message yet. It's ready for the first non-urgent offer, like the office offering a shift
  to named workers later on.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Urgent offers count towards the 3 | The limit is about how often a phone buzzes | Count only non-urgent offers |
| Failed sends don't count | The worker never got them | Count every offer row |
| The day is the firm's calendar day (London) | That's how workers and offices think of "today" | A rolling 24 hours |
| The limit is fixed at 3, not a firm setting | The docs say 3; no firm has asked otherwise | A setting per firm (parked as a question) |
| The candidate list reads urgency, role and time zone from the shift | No caller can skip the limit or shift its day by passing the wrong value | Let the caller pass them in (the first version) |

### What the safety review found

There was nothing that had to be fixed first. Its suggestions:
- **Done:** an out-of-date comment; urgency read from the shift, not passed in; a stricter
  boundary test (it now also catches `insert(schema.offers)` and `insert into public."offers"`);
  a more honest name for the other-firm test; a new test that an urgent wave still reaches
  someone already offered 3 shifts today.
- **Parked**, for when non-urgent offers arrive:
  - Two offer jobs at the same moment could both see "2 so far" and send a 3rd and a 4th. The
    fix is a per-worker lock, or deciding the limit can be a little soft.
  - Log how many workers the limit left out.

### What the new tests prove

- `tests/unit/rules.offer-cap.test.ts` (8 tests):
  - the limit is 3;
  - urgent always passes;
  - where the London day starts and ends, in winter and summer;
  - on the 23-hour and 25-hour days when the clocks change.
- `tests/integration/offers.candidates.test.ts` (9 tests, on the real database):
  - 3 offers today leaves a worker out, 2 doesn't, and urgent ignores the limit;
  - yesterday's and failed offers don't count, and answered ones do;
  - in summer, an offer at 00:30 London time counts for that day;
  - another firm's workers never appear;
  - 12 kinds of ineligible worker are never picked, and every worker who *is* picked gets a
    "yes" from the booking rules. The 12 are: no licence, expired or suspended licence, wrong
    role, inactive, blocked, messages off, a day off, a clash, already on the shift, cancelled
    off it, already offered it.
- `tests/unit/offers.boundary.test.ts` (8 tests): only the offer-wave job writes offers or builds
  their messages. The check also has tests of its own.
- `tests/integration/offers.waves.test.ts` (1 new test): an urgent wave still reaches a worker
  already offered 3 shifts today.
- Each of these was broken on purpose and seen to fail, then put back:
  - the limit switched off;
  - the rules ignored;
  - a new file writing offers;
  - the limit wrongly applied to urgent shifts.

### Parked, open, and things that need Dylan

- **Dylan to confirm:** urgent offers count towards the 3. So after 3 urgent offers in a day, a
  worker gets no non-urgent ones.
- **Parked:** the same-moment race, logging how many the limit left out, and whether a firm may
  change the 3. All are only needed once non-urgent offers exist.

### How to see it working

Stop `npm run dev` first. Then run:

`npx vitest run tests/unit/rules.offer-cap.test.ts tests/integration/offers.candidates.test.ts tests/unit/offers.boundary.test.ts`

It should say all passed.

## 2026-09-29: Phase 4, task 7: Shift reminders 24 hours and 2 hours before the start (0.6 h)

### Time

0.6 hours of Claude's working time (05:41 to 06:18 UTC), in the unattended overnight loop.
Phase 4 so far: 2.8 of its 27 to 37 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=52c63cf1faa93962 e2e=true`. That covers:
  - the type checks and lint;
  - all 1748 tests (up from 1690);
  - the 25 browser tests;
  - the rule checks.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

- **Two reminders per booking.** Every worker with a confirmed booking gets:
  - 24 hours before: "Reminder: tomorrow 08:00–16:00 at Riverside Arena. Details: (link). Can't
    make it? Cancel in the app as early as you can. — Acme Events Shift Team";
  - 2 hours before: "Your shift at Riverside Arena starts at 08:00. Meeting point and
    instructions: (link). — Acme Events Shift Team".
  - The link opens the shift's page, which shows a booked worker the instructions.
- **How they go.** By the worker's own choice of WhatsApp or text message, with the same backup
  as offers: a WhatsApp that's refused goes by text. A phone notification (*push*) goes too, if
  they turned it on. Messages still only print to the screen (the *console transport*: nothing is
  really sent until Twilio is connected).
- **Who gets them.** Only confirmed bookings on shifts that are still open or filled. Never a
  cancelled booking, an unconfirmed offer, or a cancelled or draft shift. Someone who books after
  a reminder's time doesn't get that one. For example, booking 5 hours before gets only the
  2-hour reminder.
- **Once each.** A new database table, `shift_reminders`, records every reminder: sent, failed,
  or skipped. It's written *before* the message goes, so the same reminder is never sent twice. If
  a shift moves to a new time, its bookings get fresh reminders for the new time.
- **Quiet hours** (default 10pm to 7am). Reminders aren't urgent, so they wait until the morning.
  If waiting would make one too late, it's skipped and logged instead. Example: a 2-hour reminder
  for a 6am start is skipped; the worker still got the 24-hour one the day before.
- **The timer.** A check every 5 minutes looks for reminders that are due. It starts a job only
  for firms that have one.
- **Shared sending code.** Offers and reminders now send through one piece of code
  (`src/lib/notify/send.ts`), so they behave the same way.

### What the safety review found

- **One serious problem (fixed).** In the first version, all of a firm's reminders were sent inside
  one *transaction* (a group of database changes that either all happen or none do). If anything
  failed after a message went, the "already sent" record disappeared with the rest, and a retry
  would message everyone again. With real Twilio, the reviewer worked out this would happen
  often.
- **The fix.** Each reminder now goes in three separate steps:
  1. mark it "sending" and save that;
  2. send the message;
  3. record "sent" or "failed".

  If something breaks in between, the row still says "sending", meaning "may have gone", and it's
  never sent again. A new test proves this.
- **Smaller fixes:**
  - a booking cancelled while the job runs isn't reminded;
  - a reminder can't silently vanish when quiet hours end just before its window closes;
  - cleaner code organisation;
  - a test of the shared sending code.
- **An older problem it spotted, not new tonight.** Twilio message ids can look like phone
  numbers, and the log refuses anything that looks like one. Once Twilio is connected, some
  successful sends would fail to log. Parked, with the fix, before connecting Twilio.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| A check every 5 minutes, not every hour | Hourly could make a "2 hours before" reminder arrive only 1 hour before | One timer per booking (every way of booking, moving or cancelling would have to manage them) |
| A table of reminders sent, keyed by start time | Exactly once per booking, evidence in a no-show dispute, and moved shifts get new reminders | Columns on the booking (no history), or searching the log (two jobs could both send) |
| A booking made after a reminder's time skips that reminder | They've just booked and seen the confirmation | Send it at once (two messages close together) |
| Quiet hours hold reminders; skip one that would be too late | The firm's quiet-hours policy says non-urgent messages wait | Send the 4am reminder anyway |
| "{day}" instead of "tomorrow" in the 24-hour reminder | A reminder that went late can be for today | Keep "tomorrow" (wrong then) |
| Claim, send, then record, each separately | A failure can never cause a second message | One transaction (the first version; caught in review) |

### What the new tests prove

- `tests/unit/rules.reminders.test.ts` (15 tests): when each reminder is due, who gets it,
  bookings made late, and quiet hours in winter and summer, including the 10-minute margin.
- `tests/integration/shift.reminders.test.ts` (16 tests, on the real database):
  - both reminders arrive, each once, with the exact wording and link;
  - the site name, and "today";
  - late bookings; never to cancelled bookings, offers, or cancelled or draft shifts;
  - a moved shift is reminded again;
  - two jobs at once send one message;
  - a job that breaks after sending never resends;
  - a booking cancelled mid-run isn't reminded;
  - another firm's workers are never reminded;
  - text messages, the WhatsApp-to-text backup, failures, the push, and quiet hours holding or
    skipping;
  - the 5-minute check and the worker wiring.
- `tests/unit/reminders.templates.test.ts` (4 tests): the exact wording, with and without a
  site.
- `tests/unit/notify.send.test.ts` (6 tests): the shared sending code's channels and backup.
- The tenancy tests now cover the new table (each firm sees only its own rows).
- Breaking the code on purpose made the right test fail each time:
  - ignoring when the worker booked;
  - reminding any booking status;
  - skipping the re-check at claim time.

### Parked, open, and things that need Dylan

- **Dylan to confirm:** a 2-hour reminder for a shift starting before 7am is skipped (quiet
  hours), not sent at 4am.
- **Dylan to confirm:** the 24-hour reminder says "Cancel in the app", but there's no app, just a
  link. Consider changing it before the templates go to Meta.
- **Parked:**
  - reminders to workers the office has since blocked;
  - no opt-out;
  - lapsed licences;
  - recording reminders missed during an outage;
  - the Twilio id issue;
  - making offer waves use the same claim, send, record pattern.

### How to see it working

Stop `npm run dev` first. Then run:

`npx vitest run tests/unit/rules.reminders.test.ts tests/integration/shift.reminders.test.ts`

It should say all passed.

With `npm run dev` running, the terminal prints any reminders that are due for the demo firms'
bookings, every 5 minutes.

## 2026-09-29: Phase 4, task 8: All copy from the messaging doc; templates to Meta (0.4 h). BLOCKED, not ticked

### Time

0.4 hours of Claude's working time (06:21 to 06:46 UTC), in the unattended overnight loop.
Phase 4 so far: 3.2 of its 27 to 37 hour estimate.

### Result

- **Blocked, not ticked.** Half of the task is "templates submitted to Meta for approval". Meta
  (the company behind WhatsApp) only approves templates sent from a WhatsApp Business account,
  which is set up through Twilio: an outside service that tonight's rules forbid. So I built
  everything short of the submission, and parked it with numbered steps.
- `scripts/verify.sh` printed `VERIFIED tree=d401c5ec657c9bd3 e2e=true`. That covers:
  - the type checks and lint;
  - all 1799 tests (up from 1748);
  - the 25 browser tests;
  - the rule checks.
- No auditor round (nothing to tick). Committed on `build/overnight`; the push result is in
  `docs/overnight-log.md`.

### What was built

- **A test that holds the messages to the doc.** `docs/messaging-templates.md` is where every
  message's wording is decided. A new test reads that document and checks every message the code
  can send against it: WhatsApp messages, text messages, phone notifications and office emails.
  - If someone changes a word in the code but not in the doc (or the other way round), the test
    fails.
  - A new message can't be added without the test knowing: it lists every message function.
  - The doc's messages not built yet are listed with the task that will build each one.
- **Every message to a worker is signed.** Another test checks that each one ends with the firm's
  sign-off ("— Acme Events Shift Team"), including a firm's own custom sign-off (golden rule 8).
- **Shorter text messages for urgent offers.** Before, a worker who chose text messages got the
  long WhatsApp wording. Its dashes aren't standard text characters, so it cost about 3 texts.
  - Now they get the doc's short version: "Acme Events URGENT: door supervisor needed Acme Demo
    Arena on Sat 7 Nov 08:00. (link) - Acme Events Shift Team". It usually costs 2 texts.
  - The same happens when a WhatsApp is refused and the offer falls back to text.
- **A ready-to-submit WhatsApp template pack** (`src/lib/messaging/whatsapp-templates.ts`).
  WhatsApp only delivers a message a business starts if it matches a *template* Meta has
  approved word for word. Only the marked gaps (*variables*, written `{{1}}`, `{{2}}`) can
  change. The pack has:
  - every WhatsApp message the code sends: 10 templates;
  - 4 "no site" versions, because an approved template can't have optional words and not every
    shift has a site;
  - sample values for Meta;
  - a test proving the code sends exactly the pack's words.
- **All wording in one place.** The office's weekly credentials email built its list lines in a
  different file. That wording now lives with the other messages.

### What the safety review found (both fixed)

- **The short text had no sign-off.** The doc's text-message line had none, and I had copied it.
  The golden rules come before the doc, so the text now ends with " - Acme Events Shift Team". A
  plain hyphen keeps it standard text characters. Dylan to confirm the wording.
- **A safety test didn't know about the new text builder.** Another test makes sure only the offer
  code can build an offer message, so offers can't reach workers the rules haven't checked. It now
  covers the text version too.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| A test ties the doc, the code and the pack together | They can never drift apart unnoticed | Keep them in step by hand |
| "No site" variants as separate templates | An approved template can't have optional words | Always show a site (not every shift has one) |
| Only the urgent offer gets a short text version | It's the only one the doc defines; new wording is Dylan's call | Write short versions for reminders and credentials now |
| The text's sign-off after a plain hyphen | Golden rule 8 needs a sign-off; a dash would make the text cost more | Leave it unsigned (breaks the rule) |

### What the new tests prove

- `tests/unit/copy.templates-doc.test.ts` (48 tests):
  - every message matches the doc's wording (WhatsApp, text, push, email);
  - every message to a worker ends with the sign-off;
  - the short text uses only standard characters and costs fewer texts than the WhatsApp
    wording;
  - the pack is well formed and matches both the doc and what the code sends.
- `tests/unit/notify.send.test.ts` (1 new): each channel gets its own wording, the fallback too.
- `tests/integration/offers.waves.test.ts` (1 new): a worker who chose text gets the short
  version, and so does a refused WhatsApp that falls back.
- `tests/unit/offers.boundary.test.ts` (1 new check): only the offer code builds the offer text.
- Changing one word in a message, or an email subject, made the doc test fail, as it should.

### Parked, open, and things that need Dylan

- **Submit the WhatsApp templates** (PLAN.md Parking lot, numbered steps). Needs the Twilio account
  from "Connect Twilio" first.
- **Dylan to confirm** (wording):
  - the text's sign-off;
  - "{day}" instead of "today";
  - no "at" before the site in the text;
  - whether to write short text versions of the reminders and credential messages.
- **Worth knowing:** credential expiry warnings always go by WhatsApp, even to workers who chose
  text messages (already parked, to be moved onto the shared sender).

### How to see it working

Stop `npm run dev` first. Then run:

`npx vitest run tests/unit/copy.templates-doc.test.ts`

It should say all passed.

To see the pack, open `src/lib/messaging/whatsapp-templates.ts`: each entry is what you'd paste
into Twilio's Content Template Builder.

## 2026-09-29: Phase 4, task 9: The Phase 4 tests (0.3 h)

### Time

0.3 hours of Claude's working time (06:48 to 07:07 UTC), in the unattended overnight loop.
**Phase 4 is done**, except the three tasks blocked on outside services: 3.5 hours of its 27 to 37
hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=b73e275b8c52366d e2e=true`. That covers:
  - the type checks and lint;
  - all 1827 tests (up from 1799);
  - the 25 browser tests;
  - the rule checks.
- The first verify run failed one new test. The cause was in the test itself: two jobs due at the
  same moment can run in either order, and the test had assumed one. It was fixed and re-run five
  times.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Only tests: no app code changed. Most of this behaviour was already tested one piece at a time.
These tests check it end to end.

- **A fake job worker** (`tests/helpers/fake-worker.ts`). In the real app, a background program
  (the *worker*) runs *jobs* (queued tasks, like "send wave 2 at 09:15") at their time. The fake
  worker reads the real job queue and runs each job in time order on a pretend clock. So a test
  can cancel a booking at "09:00" and watch the whole chain play out, as it would on a real day,
  in under a second.
- **Wave timing** (`tests/integration/waves.timing.test.ts`). A dropout at 09:00 for a 19:00
  shift gives:
  - offers to the first 2 workers at 09:00, the next 2 at 09:15 and the last one at 09:30;
  - an email to the office at 16:00 if it's still unfilled.
  - Also tested:
    - a firm's own wave size and gap;
    - first come, first served;
    - quiet hours holding waves until 07:00;
    - the email going only once;
    - the chain ending when the shift starts.
  - **Stop on fill:** when someone takes the shift between waves, the next wave stops, the others'
    offers are marked "filled elsewhere", the office isn't emailed, and nothing more is sent.
- **The notification policy** (`tests/integration/notify.policy.test.ts`). The same checks run for
  both kinds of message (urgent offers and shift reminders):
  - WhatsApp first, or a text if that's the worker's choice;
  - a text only if WhatsApp refuses the number, never both;
  - the phone notification after the message, and never after a failed one;
  - quiet hours;
  - the daily limit of 3 offers;
  - no double sends, even when a job runs twice or two copies run at once.
- **No messages to workers who shouldn't get them.** One test sets up 3 workers who can do the
  shift and 11 who can't or shouldn't: no licence, expired licence, suspended licence, wrong role,
  inactive, blocked, messages off, day off, already booked at that time, the worker who cancelled,
  and someone from another firm. It runs a whole chain of offers to the end, then checks that
  exactly the 3 got anything.
  - The booking rules would let the "messages off" worker take the shift themselves. They just
    don't get told about it, and the test checks both facts.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Test through the real job queue with a fake clock | Proves the timings the worker will actually use | Call each wave by hand (already done elsewhere) |
| Jobs due at the same moment are compared in name order | The job system runs them side by side, in no set order | Assume an order (the cause of the first failure) |
| The push goes alongside WhatsApp, not instead (tested as built) | A push can't confirm it was seen | Push only, to save money (parked for Dylan) |

### What the new tests prove

- **8 timing tests:** the 15-minute rhythm, custom rhythms, stop on fill (worker or office), one
  office email, quiet hours, the start ending the chain.
- **20 policy tests:** channel order (10), no double sends (4), quiet hours (3), the daily limit
  (2), and nobody ineligible messaged over a whole chain (1).
- Breaking the code on purpose made them fail each time:
  - the rules ignored;
  - the push sent first;
  - waves every 5 minutes regardless of the firm's setting.

### Parked, open, and things that need Dylan

- **Dylan to confirm:** workers get WhatsApp (or a text) *and* a phone notification. The docs'
  "push → WhatsApp → SMS" could mean "push only when they have it", to save about 2p a message.
  But a push can't confirm it was seen.

### How to see it working

Stop `npm run dev` first. Then run:

`npx vitest run tests/integration/waves.timing.test.ts tests/integration/notify.policy.test.ts`

It should say all passed.

## 2026-09-29: Phase 5, task 1: The office's Today view (1.0 h)

### Time

1.0 hour of Claude's working time (07:09 to 08:08 UTC), in the unattended overnight loop.
Phase 5 so far: 1.0 of its 23 to 33 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=7758166631a3e2e8 e2e=true`. That covers:
  - the type checks and lint;
  - all 1886 tests (up from 1827);
  - the 28 browser tests (3 new);
  - the rule checks.
- The first verify run failed one new browser test. Another browser test adds a request to the
  shared test database, so the count was 3, not 2. It also showed a real bug: the request kinds
  came out in a random order. Both were fixed.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

- **Today**, the office's home page at `/office`, for admins and resourcers. One screen, so that
  nothing is missed:
  - **Urgent shifts**, with how the automatic offers are going: "Wave 2 · 4 offered · 0 accepted",
    why they stopped ("nobody else can take it"), and whether the office was emailed.
  - **Gaps in the next 7 days**: open shifts with places free, soonest first.
  - **Cancelled in the last 24 hours**: who, which shift, how much notice they gave, and why.
  - **Requests**: how many are waiting, and what kinds.
  - **Credentials expiring this week**: whose licence or card runs out in the next 7 days.
    Someone who has already renewed isn't listed.
- **Quick actions** on each urgent shift and gap:
  - **Offer to someone.** Opens a page listing who could take the shift, with the fewest hours
    booked that week first, and a "Send offer" button for each. The list comes from the same
    checks as every automatic offer: the booking rules, whether they want offers, whether
    they've been offered it, and the 3-a-day limit unless it's urgent. The office chooses *who*,
    never *whether the rules allow it*.
  - **Mark urgent / Not urgent.** Marking starts the automatic offers.
  - **Mark as filled.** For when the office filled it another way. Nobody else is offered it, and
    "Open it again" undoes it.
- **Payroll** users keep the plain dashboard; Today isn't their job.

### What the safety review found (both fixed)

- **A misleading message.** If an office offer failed to send, trying again said "Offer on its way"
  but sent nothing. It can't be resent, because it may have arrived. The office now reads: "The
  last offer to {name} couldn't be sent, so it isn't sent again. Contact them another way."
- **The 3-a-day limit could be passed in a race.** Two offers to the same person at the same moment
  could both see "2 today". Now each person's offer count is *locked* (only one sender at a time
  can count and add) while an offer is written. A test runs two at once; without the lock it
  failed every time.
- **Smaller fixes:**
  - a broken web address shows "not found" instead of an error;
  - someone the office had placed on a shift is marked as having taken the offer;
  - reopening an urgent shift restarts its offers.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Today lives at `/office`; `/office/today` redirects there | The dashboard "becomes Today" (screens doc), and logging in already lands there | Two pages showing the same thing |
| Payroll doesn't see Today | Worker names and gaps aren't their job (least access) | Everyone in the office |
| Gaps look 7 days ahead | Covers the weekend's event and tomorrow's early shifts | Today only |
| No "wave 2 of 4" | Knowing the total means checking every worker on each page view | An estimate (could mislead) |
| "Mark as filled" sets the shift to filled and stops offers | The screens already read "filled" as "no place left, or the office closed it"; no new column needed | Lowering the number of places (loses the original) |
| Office offers stored with the office user and no wave number (a small database change) | They never clash with the automatic waves, and record who sent them | Wave number 0 as a marker |

### What the new tests prove

- `tests/integration/office.today.test.ts` (6 tests, real database):
  - each section shows the right rows, and leaves out full, started, draft and cancelled shifts,
    old cancellations, answered requests, renewed licences and inactive workers;
  - more than 50 gaps says so;
  - another firm's data never shows;
  - payroll and other firms' sessions can't see it.
- `tests/integration/office.quick-actions.test.ts` (10 tests):
  - "Mark as filled" stops bookings, offers and the office email;
  - "Open it again" works, and restarts offers for urgent shifts;
  - a Google Sheet's shifts are refused;
  - only active admins and resourcers.
- `tests/integration/office.offer.test.ts` (17 tests):
  - the exact message and push;
  - text messages and the backup;
  - never someone the rules, their settings or the daily limit leave out;
  - the checks run again when the job runs;
  - no double sends, quiet hours, the race, a failed send;
  - office offers never disturb the automatic waves.
- `tests/unit/office.today-view.test.ts` (7), `tests/unit/office.roles.test.ts` (2): the wording
  and the page, and that "who sees Today" matches "who may change shifts".
- `tests/e2e/office.today.spec.ts` (3 browser tests on the demo data): a resourcer sees every
  section and offers a gap; `/office/today` opens Today; payroll can't.
- The existing safety tests were extended on purpose. The offer boundary check now allows exactly
  two ways to send offers, both through the checks and both taking the lock. The message-wording
  test now covers the office offer.

### Parked, open, and things that need Dylan

- **Dylan to confirm:**
  - payroll doesn't see Today;
  - what "Mark as filled" means (it doesn't say how it was filled);
  - the office's text-message offer ends with the sign-off, which makes it 2 texts.
- **Parked:**
  - Today doesn't refresh by itself;
  - no link from the requests line until the requests screen exists;
  - one worker per "Send offer" click;
  - a CSV re-import can reopen a closed shift;
  - double clicks queue an extra (harmless) job;
  - Google Sheet errors on Today;
  - reopened shifts skip people offered it before.

### How to see it working

1. Run `npm run dev`.
2. Open `http://acme.localhost:3000/office/login` and log in as `acme.resourcer@example.com`. The
   login link appears in the terminal.
3. Today shows the demo Saturday: the urgent dropout, the gaps, the dropout under "Cancelled", and
   two requests.
4. Try "Offer to someone" on a gap. The offer message prints in the terminal.

## 2026-09-29: Phase 5, task 2: The office's shift screens (0.6 h)

### Time

0.6 hours of Claude's working time (08:11 to 08:46 UTC), in the unattended overnight loop.
Phase 5 so far: 1.6 of its 23 to 33 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=340269c21ae904cb e2e=true`. That covers:
  - the type checks and lint;
  - all 1924 tests (up from 1886);
  - the 31 browser tests (3 new);
  - the rule checks.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

All for admins and resourcers, from a new "Shifts" link on Today:
- **The shift list** (`/office/shifts`): 4 weeks at a time, by day, with how many are booked,
  the status and "Urgent". "Earlier" and "Later" move 4 weeks.
- **New shift**: date, site, role, start, finish, places and instructions. A finish before the
  start is the next morning (a night shift).
- **Shifts for an event**: one date and site, and up to 12 lines of role, times and places. If
  any line is wrong, *nothing* is saved and each problem names its line ("Line 3: Places must be
  a whole number from 1 to 1000.").
- **Import from a file**: a spreadsheet (.csv or .xlsx, up to 1 MB) of shifts.
  - "Check the file" shows what would happen without saving anything ("This file would add 12
    shifts…"), with each problem by row.
  - "Import these shifts" then saves it. Importing the same file again updates rather than
    duplicates.
- **Each shift's page**:
  - the details and "Edit this shift";
  - who's booked, and who cancelled with how much notice;
  - the offers sent;
  - a **history** of everything that happened, in plain words ("Sam Rota placed Ann Booker.").
- **Assign someone** on the shift's page:
  - pick a worker and press "Check" to see the rules' answer first;
  - if it's yes, "Assign {name}";
  - if the only "no"s are ones the office may allow (too little rest, over the weekly hours, a day
    off, or the shift already started), "Assign anyway" with a reason, which goes in the log;
  - anything else, like a missing licence, can't be overridden.
- **Editing a booked shift**: only the places and instructions can change. Changing the time,
  role or site of a booked shift is a "move", which by law needs notice recorded for each worker.
  That's the next task, so for now it's refused with an explanation.

### What the safety review found (fixed)

- **Editing reopened a closed shift.** If the office had marked a shift as filled, changing even
  its instructions quietly reopened it to bookings. Now it stays closed until "Open it again".
- **The import could move a booked shift to another site** without recording notice. The site
  now counts as a move too, like the time and role.
- **Smaller fixes:**
  - moving a shift nobody's booked on marks the offers already sent as expired, and the log keeps
    the old and new times;
  - clearer messages for a broken form;
  - more tests.
- **Parked for Dylan:** the override reason is typed text. A reason list plus a private note
  would stop a name ending up in the log, but it changes the booking code and the database, so it
  waits for his OK.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Booked shifts: no new times, role or site here | Those are "moves" needing notice per worker (the law, and golden rule 12): the next task | Allow and log (would skip the notice) |
| A bad line in a bulk create saves nothing | Fix the form once; no half-made event | Save the good lines |
| Web import up to 1 MB | The web framework's default limit; shift files are far smaller | Raise the limit for everything |
| Check one chosen worker at a time | The rules take several database reads per person | Check everyone on every page view (slow) |
| New shifts are open straight away | "Create" means "we need people" | A draft step first |

### What the new tests prove

- `tests/integration/office.shift-editor.test.ts` (18 tests):
  - creating one or many (times in London, overnight shifts, blank lines ignored);
  - every kind of bad input, with nothing saved;
  - editing with and without bookings;
  - a closed shift stays closed;
  - refusals change nothing;
  - other firms' sites refused;
  - offers expiring on a move;
  - importing (the check saves nothing, the real import, re-imports, a site move refused, bad
    files, too big);
  - payroll refused.
- `tests/integration/office.shift-pages.test.ts` (11 tests):
  - the list;
  - the form's sites and roles;
  - a shift's places, cancellations and history in words;
  - the rules check (yes / may override / can't override);
  - assign with and without an override;
  - a reason with a phone number refused;
  - no licence can't be overridden;
  - payroll and other firms refused.
- `tests/unit/office.shifts-copy.test.ts` (5) and the roles test: the wording and who may use it.
- `tests/e2e/office.shifts.spec.ts` (3 browser tests):
  - create a shift, check people and assign one;
  - create two for an event;
  - upload a file, check it, import it;
  - payroll can't see the screens.

### Parked, open, and things that need Dylan

- **Dylan to confirm:**
  - the override reason stays typed text for now;
  - new shifts open at once;
  - editing a booked shift's time or place waits for the move screen;
  - the web import's 1 MB limit.
- **Parked:**
  - booked workers aren't told when instructions change;
  - no search in the worker picker;
  - no filters on the list;
  - big web imports should run in the background.

### How to see it working

1. Run `npm run dev`.
2. Log in at `http://acme.localhost:3000/office/login` as `acme.resourcer@example.com`.
3. Open "Shifts", then "New shift". Create one.
4. On its page, choose someone under "Assign someone", press "Check", then "Assign".

## 2026-09-29: Phase 5, task 3: The office cancelling, moving or shortening a shift (1.1 h)

### Time

1.1 hours of Claude's working time (08:48 to 09:51 UTC), in the unattended overnight loop.
Phase 5 so far: 2.7 of its 23 to 33 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=986cd04d62f23cf6 e2e=true`. That covers:
  - the type checks and lint;
  - all 1965 tests (up from 1924);
  - the 32 browser tests (1 new);
  - the rule checks.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

This is about **firm-initiated changes**: the office (not the worker) cancelling or changing a
shift someone is booked on. The Employment Rights Act means firms will need evidence of every
such change and how much warning ("notice") each worker had. Golden rule 12 says every one is
logged with a reason and the notice hours per worker.

On each shift's page, admins and resourcers now get a **"Move, shorten or cancel"** section:
- **Why?** Every change needs a reason from a fixed list: "The event's times or place changed",
  "The event was cancelled", "The client needs fewer staff", "Weather or safety", "Another
  reason". Only these words go in the action log (the append-only record of everything that
  happened). Typed-in text never does, because it could hold personal details.
- **Cancel this shift.** Every booking on it is cancelled. For each worker the log gets a
  `shift.cancelled` entry with the reason and their **notice hours** (hours between the change
  and the shift's start). Then the shift itself is marked cancelled, and any offers still out
  expire.
- **Cancel one person's booking**, with a reason. Their place opens again.
- **Move or shorten.** A new date, new times and/or another site.
  - It's logged as **shortened** ("curtailed") when the new times sit inside the old ones at the
    same site, and as **moved** otherwise.
  - Each booked worker gets a log entry with the old and new times and site, and their notice
    hours (counted from the old start).
  - **Before anything changes**, the booking rules are run for each booked worker at the new time.
    If someone fails a rule the office can't override (a licence that runs out before the new
    day, the wrong role, a clash with another booking), **nothing moves**. The office is told who
    and why, and cancels those bookings first (with notice). The refusal is logged too
    (`shift.move_refused`).
  - Someone failing only a rule the office *may* override (too little rest, too many weekly
    hours, a day off) stays booked. They're listed for the office, and the log says the rules
    had a problem.
- **Telling each worker.** Every change queues a **job** (a small task run by the separate
  background process) called `firm-change-notice`. It sends "Change to your shift on Sat 7 Nov
  at Riverside Arena: new times, and it's now at Other Stadium. New time: Sun 8 Nov 10:00–18:00…"
  or "Your shift on Sat 7 Nov 08:00–16:00 at Riverside Arena has been cancelled by the office…",
  signed "[Firm] Shift Team", by WhatsApp or text (console only, no real messages), plus a phone
  notification.
  - **Once only.** It first writes "sending" to the log and saves that, then sends, then logs
    "sent" or "failed". A crash in the middle can't cause a second message.
  - **Quiet hours.** At night it waits for the morning, unless the shift starts soon (inside the
    firm's "urgent window") or is already under way. A held message is logged, and the history
    says "phone them" if it would arrive after the start.
  - **Stacked changes.** If the office changes the same booking again before the first message
    goes, only one message is sent. It goes from what the worker last knew to what's true now. If
    the shift is moved back to what they knew, nothing is sent (and that's logged).
- The shift's **history** shows all of it in plain words: "Sam Rota moved Ann Booker's shift,
  with 5 days' notice. Reason: Weather or safety." / "Ann Booker was told about the change."

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Reasons from a fixed list, whose words go in the log | The log never holds typed text; the coming notice report needs a reason for each change | A typed reason kept only on the booking (can't be reported on) |
| A move is refused while anyone booked fails a rule the office can't override | A worker must never stay booked on a shift their licence doesn't cover (golden rule 6) | Move anyway and warn (breaks the rule) |
| Notice hours counted from the old start | Matches cancellations and the Google Sheets sync | From the new start |
| A message is urgent when the shift starts soon or is under way | A late change must reach someone before they travel | Always wait for the morning |
| One message from "what they knew" to "now", when changes stack up | The first review found a message could lose the new day and place | One message per change (noisy and confusing) |
| No "they asked to cancel" option for the office (yet) | The review found it would record a cancellation as the worker's and tell no one | Keep it (parked for Dylan with a safer design) |
| New `shift_cancelled_by_firm` message | The change message says "New time: …", which a cancellation doesn't have | Reuse it with odd wording |
| Buttons stay disabled until the page is ready | Found by an e2e failure: a click before the page was ready did nothing | Leave it (a dead button on slow phones) |

### What the new tests prove

- `tests/integration/office.firm-change.test.ts` (27 tests, on the real database):
  - cancelling a shift: every booking cancelled with the reason and notice hours, one log entry
    and one message job per worker; empty, already cancelled, started, Google Sheet, payroll and
    another firm's shifts refused;
  - cancelling one booking: the firm's reason in the log, and the worker told;
  - a worker's own cancellation: their typed reason stays out of the log, and no office message;
  - moving and shortening: the log per worker, a site change, a licence running out before the
    new day and a clash (nothing moves, the refusal logged), a day off (stays booked, the log
    says so), another firm's shift, bad input;
  - the messages: exact words for a cancellation, a move to another day and site, a shorter
    shift; once only; quiet hours (held, sent inside the urgent window, sent when under way,
    the earlier start counts); held messages logged and queued again; stacked changes (one
    message naming the original day and place, a cancellation after an untold move, moved
    back); two copies at once send one; another firm's change sends nothing; failed and
    refused sends; the background process runs the job.
- `tests/unit/office.shifts-copy.test.ts`: the history words and screen replies.
- `tests/unit/copy.templates-doc.test.ts`: the new messages match `docs/messaging-templates.md`
  and the WhatsApp template pack (now 16 templates).
- `tests/e2e/office.changes.spec.ts` (1 browser test): create a shift, book someone, move it (a
  reason is required), see the move and the message in the history, cancel the booking.

### Parked, open, and things that need Dylan

- **Dylan to confirm** (in `PLAN.md`, Parking lot, "Firm-initiated changes follow-ups"):
  - the reason list;
  - a move refused while anyone fails a rule that can't be overridden (or ask each worker?);
  - when a change message may go at night;
  - how the office records a worker's own cancellation when they ring in (the option now: none;
    the suggested design records it as theirs and sends them the usual confirmation);
  - "The client needs fewer staff" on one booking still reopens the place;
  - notice counted from the old start.
- **Parked:** the Google Sheets sync's changes don't send these messages yet; the office's
  escalation email isn't re-timed after a move; log the reason's code too; the other office
  buttons should also wait until the page is ready.

### How to see it working

1. Run `npm run dev`.
2. Log in at `http://acme.localhost:3000/office/login` as `acme.resourcer@example.com`.
3. Open "Shifts", then "New shift". Create one a few days ahead.
4. Under "Assign someone", choose a person, press "Check", then "Assign".
5. Under "Move, shorten or cancel", change the start, choose a reason and press "Move for
   everyone booked". You should see "Moved. 1 person booked will be told…".
6. The terminal running `npm run dev` prints the message the worker would get. Reload the page:
   the history says they were told.

## 2026-09-29: Phase 5, task 4: Marking who worked a shift (0.5 h)

### Time

0.5 hours of Claude's working time (09:54 to 10:22 UTC), in the unattended overnight loop.
Phase 5 so far: 3.2 of its 23 to 33 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=10df6a00466eef70 e2e=true`. That covers:
  - the type checks and lint;
  - all 1979 tests (up from 1965);
  - the 33 browser tests (1 new);
  - the rule checks.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

A **no-show** is someone booked on a shift who doesn't turn up. Firm owners want fewer of them,
and the product spec says the count must be tracked. Until now a booking stayed "Booked" forever.
Now the office records what happened:
- **On a shift's page**, once the shift has started, each booked person gets two buttons:
  **"Mark as worked"** and **"Mark as not attended"**. Once marked, the other one says "Change to
  …", so a mistake can be put right. Each press ends with a line saying what happened ("Marked Ann
  Booker as not attended.").
- **After the shift ends**, "Mark the 12 people not marked yet as worked" does everyone left in
  one go, after a "Yes" (for a big event where only a few didn't come).
- **Every mark is logged** in the action log (the append-only record of everything that
  happened) as `shift.completed` or `shift.no_show`, with who did it and what it was before. The
  shift's history says it in words: "Sam Rota marked Ann Booker as worked (was: not attended)."
- **Today** has a new **"Who worked?"** list: shifts that ended in the last 7 days with people
  not marked yet ("3 people not marked yet."), each linking to the shift's page. So nothing is
  forgotten.
- **Rules:**
  - only admins and resourcers can mark, checked again inside the database transaction (the
    all-or-nothing unit of work);
  - not before the shift starts; there's no end limit (timesheets come days later);
  - only someone still booked (not a cancelled booking).
- **A knock-on effect:** a "not attended" shift no longer counts towards that worker's weekly
  hours limit (they didn't work those hours). A test proves it.
- Google Sheets firms can mark too: the sheet has no attendance column, and the sheet sync only
  changes bookings that are still "Booked".
- The worker isn't sent a message. They already see "Worked" or "Marked as not attended" in their
  past shifts.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Marking opens at the shift's start, with no end limit | A no-show is known once they're late; corrections come days later | Only after the end; a 7-day limit |
| Mistakes can be changed, and the log keeps both | People mis-tap; the record stays honest | Final once marked |
| Nothing is marked automatically | "Worked" is the office's statement; an automatic mark could hide a no-show | Auto-mark worked after the end (parked for Dylan) |
| No message to the worker | Not in the docs; they can see it in their past shifts | Tell them (parked for Dylan) |
| "Mark the rest" needs a "Yes" | One tap could mark 50 people | One tap (each can be undone, but one by one) |

### What the new tests prove

- `tests/integration/office.attendance.test.ts` (11 tests, on the real database):
  - marking worked and not attended, and the exact log entries;
  - putting a mistake right (logged with what it was), and "already marked";
  - not before the start, yes 20 minutes after it, yes days later;
  - not a cancelled booking or someone never booked;
  - a Google Sheet's shift can be marked;
  - payroll and disabled users refused, admins allowed, another firm's shift not found;
  - a "not attended" shift stops counting towards the weekly hours limit;
  - "mark the rest": only those not marked yet, one log line each, not before the end, not for
    payroll;
  - Today's "Who worked?": the right shifts (not too old, not fully marked, not still running,
    not another firm's), and it empties as people are marked.
- Unit tests: every new message and history line, and the Today section (including "Showing the
  first 50.").
- `tests/e2e/office.attendance.spec.ts` (1 browser test): a shift from 3 days ago with 3 people
  shows on Today; mark one not attended, the other two as worked in one go (the confirmation stays
  after the page refreshes), correct the first to worked, see it in the history, and Today no
  longer lists it.

### Parked, open, and things that need Dylan

- **Dylan to confirm** (in `PLAN.md`, Parking lot, "Marking who worked follow-ups"):
  - tell a worker when they're marked as not attended?
  - mark bookings nobody marked as worked automatically after a few days?
  - should no-shows count against a worker for offers? (Today it's the reverse: fewer hours
    worked puts them higher in the queue.)
- **Parked:** each worker's no-show count on their record; a past event in the demo seed; the
  worker's "On now" card doesn't show a mark; the cancel-booking confirmation also vanishes on
  refresh; a few Google Sheets edge cases.

### How to see it working

The demo data has no shifts in the past yet (parked), so in the app this shows after the demo
Saturday has passed:
1. Run `npm run dev`.
2. Log in at `http://acme.localhost:3000/office/login` as `acme.resourcer@example.com`.
3. On Today, look for "Who worked?", then open a shift and use "Mark as worked" / "Mark as not
   attended".

Or watch the browser test do it: stop `npm run dev`, then run
`npx playwright test tests/e2e/office.attendance.spec.ts --headed`.

## 2026-09-29: Phase 5, task 5: Answering workers' requests (0.5 h)

### Time

0.5 hours of Claude's working time (10:25 to 10:55 UTC), in the unattended overnight loop.
Phase 5 so far: 3.7 of its 23 to 33 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=cc24f2e47c9699a3 e2e=true`. That covers:
  - the type checks and lint;
  - all 2005 tests (up from 1979);
  - the 34 browser tests (1 new);
  - the rule checks.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Workers could already ask for a time change or a swap (and ask the office to look again at a
shift the rules refused), but nobody could answer. Now:
- **A Requests page for the office** (`/office/requests`, for admins and resourcers, linked from
  the office menu and from Today):
  - **"Waiting for an answer"**, oldest first: who asked, the shift (a link to its page), what
    they asked ("Asks for 13:00 to 18:30.", "Could swap with: Cal Jones.", or the rules' reasons
    for a review), their note, when, and the reference.
  - A **note** box and two buttons: **"Approve and tell Ann"** and **"Decline and tell Ann"**. A
    note is needed to decline (a "no" needs a reason). The page then says "Declined. Ann will be
    told."
  - The page says plainly that approving doesn't change the shift: the office makes the change on
    the shift's page.
  - **"Answered in the last 7 days"**: who answered, when, the note, and whether the worker has
    been told yet.
- **Only one answer counts.** The request row is locked while it's answered (a database lock
  makes a second person wait, then see "This request was already answered."). A test sends two
  answers at the same moment.
- **The worker is told** by a background job (a small task run by the separate worker process),
  by WhatsApp or text, as they chose: "Your request (swap, ref 3F2A9C1B) is declined. The office
  says: Sorry, we need you there. — Acme Events Shift Team", plus a phone notification. (Console
  only: no real messages.)
  - **Once only**, the same way as the other messages: "sending" is saved first, then the message
    goes, then "sent" or "failed" is saved.
  - **Quiet hours**: at night it waits for the morning, unless the shift starts soon or is under
    way.
  - The note is put on one line, because WhatsApp can't take line breaks in the filled-in parts
    of an approved message.
- **The worker's "My requests"** now shows "The office says: …" under the answer.
- **One database change:** a new `resolution_note` column on requests, holding the office's note.
  The note is free text, so it's kept on the request and in the message, never in the action log
  (the log only holds ids and fixed words). A test checks the log never contains it.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The note lives on the request row, not in the log | Free text can hold personal details; the log refuses them | Put it in the log (blocked by its safety check) |
| A note is required to decline, optional to approve | A "no" needs a reason the worker can act on | Always optional; always required |
| Approving doesn't change the shift | The spec asks for a decision and a status; changing a shared shift needs the office's judgement | Apply time changes and swaps automatically (parked for Dylan) |
| Replies wait for the morning unless the shift is soon or under way | The same rule as the other messages | Always send at once |
| "The office says:" before the note | Clear to the worker, matches My requests, and helps WhatsApp's template approval | The note alone |

### What the new tests prove

- `tests/integration/office.requests.test.ts` (12 tests, on the real database):
  - the page: waiting oldest first, what each asked, answered ones from the last 7 days with who
    and the note, and never another firm's;
  - answering: the row, the log line (without the note), the job; the shift unchanged;
  - the note rules (needed to decline, 500 characters at most);
  - only once: already answered, already sorted, two people at the same moment;
  - payroll and disabled users refused, another firm's request not found;
  - the worker's My requests shows the note;
  - the message: exact words with and without a note, the note on one line, once only, the office
    sees "was told";
  - quiet hours: held for next week, for a question and for a finished shift; sent for a shift
    soon or under way;
  - failed sends logged and never repeated, WhatsApp refused → text;
  - nothing for an unanswered request or another firm's; the worker process runs the job.
- Unit tests: the page's words, the office roles, the worker's list, and every new message
  checked against `docs/messaging-templates.md` and the WhatsApp template pack (now 18
  templates).
- `tests/e2e/office.requests.spec.ts` (1 browser test): from Today to Requests, decline without a
  note (asked for one), decline with one, see the confirmation, then see it answered with the note
  and "was told" (or "waits for quiet hours" at night).

### Parked, open, and things that need Dylan

- **Dylan to confirm** (in `PLAN.md`, Parking lot, "Answering requests follow-ups"):
  - note needed to decline, optional to approve;
  - approving doesn't change the shift (or apply safe changes automatically?);
  - the message's "approved" could be read as "you're booked" or "the times changed": reword per
    kind?
- **Parked:** requests about cancelled or finished shifts should sort themselves; workers can't
  send "availability" or "question" requests yet (Phase 7); check Meta accepts the note as a
  template variable; a 500-character note costs about 9 texts; words for these events in the
  action log (next task).

### How to see it working

1. Run `npm run dev`.
2. Log in at `http://acme.localhost:3000/office/login` as `acme.resourcer@example.com`.
3. Click "Requests". The demo has a time change and a swap waiting.
4. Write a note and press "Decline and tell …". The terminal running `npm run dev` prints the
   message the worker would get.
5. Reload: it's under "Answered in the last 7 days", with "… was told."

## 2026-09-29: Phase 5, task 6: The action log with filters (0.5 h)

### Time

0.5 hours of Claude's working time (10:57 to 11:29 UTC), in the unattended overnight loop.
Phase 5 so far: 4.2 of its 23 to 33 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=1f692d0c0c16699d e2e=true`. That covers:
  - the type checks and lint;
  - all 2093 tests (up from 2005);
  - the 35 browser tests (1 new);
  - the rule checks.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Since the start, the app has written an **event** (one row in an append-only table: rows are only
ever added, never changed) for every offer, booking, cancellation, message and login. Until now,
only a shift's own history showed any of it. Now the office has the whole **action log** at
`/office/log` (admins and resourcers; "Action log" in the office menu):
- **Every event, newest first, in plain words**: "Ann Booker cancelled, with 4 days' notice.",
  "Sam Rota logged in.", "A pay record was added for Ann Booker (Mon 20 Oct to Sun 26 Oct).". Each
  line has the time, its type, and a link to the shift it's about.
- **Filters** (a simple form; the choices go in the web address, so a search can be bookmarked or
  shared):
  - **Worker**: everything about that person, including events that don't name them directly (a
    reminder about their booking, the office answering their request, a login link sent to them);
  - **Shift**: everything about that shift and its bookings. Each shift's page now has "See this
    shift in the action log", which shows the shift's whole story;
  - **Type**: 12 plain groups (Bookings, Cancellations, Changes to shifts, Who worked, Offers,
    Messages to workers, Requests, Credentials, Workers, Logins, Pay records, Rota sheet and
    imports);
  - **From / To**: whole days in the firm's time zone (the UK's clock changes are handled). The
    default is the last 7 days, and one search covers at most 92 days.
- **100 lines at a time**, with "Older" for the next 100.
- **Pay records** show only that a record was added or changed, never an amount.
- **A safety net**: a test reads the code for every kind of event it records and fails if one has
  no group or no plain words, so a new kind of event can't slip past the office.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Plain groups, not raw event names | The office thinks in "cancellations", not `shift.change_notice_held` | A list of every event name |
| Last 7 days by default; all of a shift from its page | Quick to load; a dispute needs a shift's whole story | Everything since the start |
| At most 92 days per search | Keeps each search quick | No limit |
| Admins and resourcers only | It's the resourcing log; payroll has its own screen next phase | Payroll too (parked for Dylan) |
| No export here | The notice and cancellation report (next task) has the CSV file | Export every search |

### What the new tests prove

- `tests/integration/office.action-log.test.ts` (8 tests, on the real database):
  - newest first, the default 7 days, the words, the shift link (with its year when it isn't this
    year);
  - the worker filter, through every route (named, did it, about them, their booking, request,
    credential, pay record, login link), and upper-case ids in the address;
  - the shift filter, with and without dates;
  - the type filter; whole London days, including a summer-time night; back-to-front dates; the
    92-day limit; the shifts offered in the form;
  - 100 at a time and "Older";
  - never another firm's events, whatever the filters say; nonsense filters ignored;
  - payroll and logged-out people refused.
- `tests/unit/office.log-types.test.ts`: every event the code records has exactly one group and
  plain words, no group lists an event that no longer exists, and examples of the words.
- `tests/e2e/office.log.spec.ts` (1 browser test): open the log from the menu, see your own login,
  filter to Cancellations, then to the worker who cancelled, follow their shift, and come back to
  that shift's log.

### Parked, open, and things that need Dylan

- **Dylan to confirm** (in `PLAN.md`, Parking lot, "Action log follow-ups"):
  - payroll doesn't see the log, and resourcers see that pay records changed (no amounts);
  - the office's typed override reason when placing someone is stored in the log: keep it, or a
    fixed list?
- **Parked:** faster worker and shift searches for big firms (database indexes); maybe hide the
  frequent "stayed logged in" lines; a worker search box.

### How to see it working

1. Run `npm run dev`.
2. Log in at `http://acme.localhost:3000/office/login` as `acme.resourcer@example.com`.
3. Click "Action log". You should see today's demo events, newest first.
4. Choose "Cancellations" under Type and press "Show": the demo's dropout is there.
5. Click its shift, then "See this shift in the action log".

## 2026-09-29: Phase 5, task 7: The notice and cancellation report (0.5 h)

### Time

0.5 hours of Claude's working time (11:32 to 12:00 UTC), in the unattended overnight loop.
Phase 5 so far: 4.7 of its 23 to 33 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=16aee8452687c53a e2e=true`. That covers:
  - the type checks and lint;
  - all 2103 tests (up from 2093);
  - the 36 browser tests (1 new);
  - the rule checks.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

From 2027 the Employment Rights Act is expected to give zero-hours workers a right to reasonable
notice of shifts, and pay when shifts are cancelled, moved or cut short at short notice. Firms will
need evidence. This report is that evidence, and the main selling point in the business plan.
- **The page** (`/office/reports/notice`, "Notice report" in the office menu, admins and
  resourcers) lists every **offer, booking, move, shortening and cancellation**, one row per worker
  affected, newest first:
  - **when** it happened;
  - **who started it**: the worker, the office, the rota sheet (the Google Sheets sync), or an
    offer wave;
  - the worker and the shift (a link to its page); for a move or shortening, the times before and
    after, and whether the site changed;
  - the **notice** the worker had, in words and exact hours ("2 days' notice (71.99 hours)"), or
    "After the start";
  - **short notice**: "Yes" when the notice was under the firm's threshold;
  - the firm's **reason** (its fixed reasons, the rota sheet's, or the office's override reason).
- **The threshold**: each firm's own `short_notice_threshold_hours` setting, or 48 hours (the
  placeholder in the docs until the 2027 rules are final). The page says which it's using.
- **Filters**: dates (London days; default the last 28), what (offers, bookings, moves and
  shortenings, cancellations), who started it (the firm or the worker), and short notice only.
- **CSV download**: the same rows as a spreadsheet file (CSV means "comma-separated values", a
  plain file Excel opens). Times in UK time and in UTC (the world standard time, for evidence).
  Safe to open: a name starting with "=" can't run as a spreadsheet formula. All rows or none: over
  20,000 rows it asks for fewer days, so a file that looks complete always is.
- **Where the numbers come from**: every row's notice hours were recorded in the action log when
  the thing happened, so a later change to the shift can't alter them. Offers didn't record this
  before; now they do.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Built from the action log | The log keeps every step, even after later changes | Read today's bookings (loses moves and history) |
| Offers now record their notice | Each row's notice comes from its own record, whatever happens to the shift later | Count offers from the shift's current start |
| The threshold is read from the firm's settings; no screen to change it yet | Changing a firm's settings in the app needs write access to the firms table (the root of tenant isolation), best done with a settings screen, which no phase has yet | A field on this page (parked for Dylan) |
| Every row gets the flag; filters narrow it | The 2027 rules aren't final, so the office decides what matters | Flag only the firm's changes |
| A file is all rows or none | A cut-off evidence file that looks complete would mislead | Cut at 20,000 silently |

### What the new tests prove

- `tests/integration/office.notice-report.test.ts` (7 tests, on the real database):
  - every kind of row with who started it, its notice from the record, the flag and the reason;
  - an older rota-sheet shortening that only names the booking still shows the worker and the
    shift; a shortening shows its new end time;
  - the threshold at exactly 72 against 71.99 hours, and settings that aren't valid;
  - each filter; London day boundaries (summer time too); the one-year limit;
  - only this firm's rows, and another firm's ids name nobody;
  - the real cancellation and move paths produce the right rows, and a worker's typed reason
    never appears;
  - the CSV line by line (a name starting "=" made harmless, a negative notice kept as a number);
  - payroll and logged-out people refused.
- `tests/unit/office.notice-report.test.ts`: the spreadsheet-safety rules, the threshold rules and
  the words.
- The offer and Sheets sync tests now check offers record their notice and the sync's moves name
  the shift and worker.
- `tests/e2e/office.reports.spec.ts` (1 browser test): open the report, see the demo's bookings,
  filter to cancellations, download the CSV and check it matches the page.

### Parked, open, and things that need Dylan

- **Dylan to confirm** (in `PLAN.md`, Parking lot, "Notice report follow-ups"):
  - an office settings screen to change the threshold (and the other firm settings)?
  - should payroll see the report?
- **Parked:** the demo's short-notice firm cancellation; recording the shift's start in booking
  and cancellation events (the page shows the start as it is now); logging each CSV download.

### How to see it working

1. Run `npm run dev`.
2. Log in at `http://acme.localhost:3000/office/login` as `acme.resourcer@example.com`.
3. Click "Notice report". The demo's bookings and the 06:00 dropout are there, with their notice.
4. Choose "Cancellations" under "What", press "Show", then "Download as a spreadsheet (CSV)".

## 2026-09-29: Phase 5, task 8: The pilot metrics page and nightly figures (0.6 h)

### Time

0.6 hours of Claude's working time (12:03 to 12:40 UTC), in the unattended overnight loop.
Phase 5 so far: 5.3 of its 23 to 33 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=e23644a533c5889c e2e=true`. That covers:
  - the type checks and lint;
  - all 2139 tests (up from 2103);
  - the 37 browser tests (1 new);
  - the rule checks.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

The pilot's job is to produce numbers a second firm will believe (docs/pilot-playbook.md): the
office's workload before the app (the "baseline") against after. Now:
- **A pilot metrics page** (`/office/reports/pilot`, "Pilot metrics" in the office menu, admins and
  resourcers) with a table: each measure, its baseline, its figure now, and the playbook's target
  for week 4. The measures:
  - messages in per day (emails, calls, WhatsApp);
  - shift queries unanswered after 24 hours;
  - portal actions (staff doing it themselves), and the share answered straight away;
  - the median time to refill a cancellation;
  - active workers, and how many of them have logged in (portal adoption);
  - urgent shifts filled from offers;
  - no-shows and short-notice cancellations per week;
  - resourcer hours on staff admin per week.
- **The baseline form**: the playbook's 8 week-0 figures, and the week they were counted.
- **The weekly tally form**: what the app can't see (the office's emails, calls, WhatsApp messages
  and admin hours), entered each week of the pilot.
- **Nightly figures**: a background job at 00:30 UK time works out each firm's daily counts from the
  action log and the database, for the last 7 days and today. Recomputing a week each night means
  a late fact still counts: a no-show marked on Monday for Saturday, a request answered late. An
  "Update the figures now" button does the same straight away.
- Figures that can't be added up day by day (a median, distinct workers, an urgent shift filled
  the next day) are worked out live for the chosen dates.
- **One new table**, `metrics_daily`: one number per firm, kind (baseline, tally, daily), day and
  metric. Every firm sees only its own rows (row-level security, tested like every other table).
  No names or personal data; rows can be corrected but not deleted.
- Saving the baseline or a tally is logged in the action log (numbers only).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| One table for baseline, tallies and nightly counts | The docs name one table; they're the same shape | Three tables |
| Recompute the last 7 days every night | Late facts count without a second pass | Count each day once |
| Medians, distinct workers and the urgent fill rate worked out live | They can't be added up from daily rows | Store daily medians (wrong over a week) |
| The default is the 7 complete days to yesterday | Today is only partly counted, which would make weekly figures look better than they are | Include today |
| Requests aren't "portal actions" | Someone in the office has to answer them; the playbook counts them apart | Count them as self-service |
| "Answered straight away" without WhatsApp replies for now | Inbound WhatsApp comes in Phase 7 | Leave the figure out until then |

### What the new tests prove

- `tests/integration/pilot.metrics.test.ts` (11 tests, on the real database):
  - one day's 11 counts from real rows and events (who counts and who doesn't: office logins,
    office bookings, an office offer, Sunday night's login, Tuesday's no-show);
  - London days, summer time too, and the firm's own short-notice line;
  - the 7-day recompute, running it twice changes nothing, and a late no-show is counted;
  - the nightly tick queues one job per firm per day, and the job rolls up that date only;
  - the worker process runs the job and schedules the tick for 00:30 UK time;
  - saving the baseline (a blank keeps what's there), the log entry with numbers only, figures
    refused when they aren't numbers in range, an empty form, payroll refused;
  - a weekly tally kept against that week's Monday;
  - the page's figures: the latest baseline, the tally, the daily sums, the live refill median,
    adoption and urgent fill rate (a shift marked on two days counted once);
  - only this firm's figures; payroll and logged-out people get nothing;
  - "Update the figures now".
- `tests/unit/office.pilot-copy.test.ts`: the table's words and numbers, durations, each save's
  message, and the figure check.
- The isolation tests now include `metrics_daily`, and the action log's scan covers the new events.
- `tests/e2e/office.pilot.spec.ts` (1 browser test): enter part of the baseline, see a wrong figure
  refused, update the figures, and see baseline against now.

### Parked, open, and things that need Dylan

- **Dylan to confirm** (in `PLAN.md`, Parking lot, "Pilot metrics follow-ups"): the definitions
  (what counts as a portal action, adoption, refill time, "answered straight away", the default
  dates).
- **Parked:** counting inbound WhatsApp messages (Phase 7); facts older than 7 days; a CSV of the
  table; pairing refills one to one; logging who pressed "Update the figures now".

### How to see it working

1. Run `npm run dev`.
2. Log in at `http://acme.localhost:3000/office/login` as `acme.resourcer@example.com`.
3. Click "Pilot metrics". Fill in a few baseline figures and press "Save the baseline".
4. Press "Update the figures now", then set "To" to today and press "Show": the demo's bookings
   appear as portal actions.

## 2026-09-29: Phase 5, task 9: Tests for the notice report (0.2 h)

### Time

0.2 hours of Claude's working time (12:43 to 12:55 UTC), in the unattended overnight loop.
**Phase 5 is done: 5.5 hours against its 23 to 33 hour estimate.**

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=efb7db49014ac169 e2e=true`. That covers:
  - the type checks and lint;
  - all 2146 tests (up from 2139);
  - the 37 browser tests;
  - the rule checks.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

The notice and cancellation report (task 7) already had tests that fed it hand-made records. This
task adds `tests/integration/notice.report.test.ts`, which proves the report against the **real
code that writes those records**, end to end:
- a worker takes a shift on the portal and then cancels it: two rows started by the worker, with
  the notice from the moment they did it;
- the office cancels one booking, then the whole shift: each worker's row with the notice they had
  and the firm's reason;
- the office moves a shift, then shortens it: notice counted from the old start, and the times
  before and after;
- the Google Sheets sync (against a pretend sheet) books someone, shortens their shift, moves it
  and removes them: four rows started by "The rota sheet";
- the short-notice flag exactly at the line: 48.00 hours isn't short notice, 47.99 is (36 seconds
  make the difference); a firm's own threshold (96 hours) changes the flag;
- the office sending someone home during the shift: negative notice, flagged, and "After the
  start" in the file;
- the CSV file's lines match the page, and a worker's typed reason ("flu") never appears.

No product code needed changing: every path already wrote what the report needs (after the fixes
the report's own review asked for in task 7).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Drive the real code, not hand-made records | That's what proves the evidence is right; the hand-made case is already covered | Only hand-made records |
| Include the Google Sheets path | Firms on a sheet make their changes there; those rows are the firm's too | Office screens only |
| Test exactly at the threshold | "Under 48 hours" must not flag 48.00 | Round numbers only |

### What the new tests prove

See "What was built": 7 tests, each on the real database, each checking the row's kind, who
started it, the notice hours, the flag and the reason, and two checking the CSV lines.

### Parked, open, and things that need Dylan

Nothing new. Phase 5's open questions are in `PLAN.md`'s Parking lot (firm-initiated changes,
marking who worked, answering requests, the action log, the notice report and pilot metrics
follow-ups), each with its "Dylan to confirm" items.

### How to see it working

Run the tests: `npx vitest run tests/integration/notice.report.test.ts` (with the database
started: `npm run db:up`). You should see 7 tests pass.

## 2026-09-29: Phase 6, task 1: The pay query form (0.5 h)

### Time

0.5 hours of Claude's working time (12:58 to 13:26 UTC), in the unattended overnight loop.
Phase 6 so far: 0.5 of its 12 to 18 hour estimate.

### Result

- **Done and ticked.**
- `scripts/verify.sh` printed `VERIFIED tree=f690b2dd6638e514 e2e=true`. That covers:
  - the type checks and lint;
  - all 2177 tests (up from 2146);
  - the 38 browser tests (1 new);
  - the rule checks.
- The independent auditor said **"VERDICT: DONE"** on the first round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Phase 6 is about pay queries: instead of the whole workforce messaging payroll, each worker raises
a structured question, and payroll later gets them grouped by cause. This first task is the
worker's side:
- **"Raise a pay query"** (`/pay/query`), behind the same 6-digit pay code as the pay page (pay is
  private):
  - **Which shift?** Their shifts from the last 8 weeks, or "A day not in the list" with a date
    (back to 90 days).
  - **What's wrong?** Hours missing, Wrong rate, Paid late or not paid, Something else.
  - **Tell payroll more** (optional, needed for "Something else"; "Don't include bank details.").
  - **"Send pay query"** → "Pay query sent." with the reference and the firm's sign-off.
- **The pay page** now says "If something looks wrong, raise a pay query." and lists "Your pay
  queries" with each one's status ("With payroll" or "Sorted").
- **Rules:**
  - only the worker's own shifts;
  - no future days;
  - one open query per question (asking again gives the same reference);
  - the pay code is checked again on the server every time, not just on the page.
- **Privacy:** the worker's typed note is stored with the query, never in the action log (the log
  only records the issue, the shift and the day).
- **No AI** reads or answers anything about pay (golden rule 9). Grouping for payroll (next task)
  will be done by code, with AI only writing a one-line summary per group.
- **One new table**, `pay_queries`, isolated per firm like every other table.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Behind the pay code | Pay is personal; the architecture puts the form after the code | Any logged-in worker |
| A day is always stored | The grouping keys on the week; some questions are about a day with no shift in the app | Only shifts |
| Details required only for "Something else" | The other choices say what's wrong | Always required |
| One open query per worker, day, shift and issue | Two taps, or asking again, shouldn't make two queries | Allow duplicates |

### What the new tests prove

- `tests/integration/pay.queries.test.ts` (7 tests, on the real database):
  - the shift list: only the worker's own, started, from the last 8 weeks, newest first;
  - raising one about a shift: the stored row, the log entry without the note, the confirmation;
  - about a day: today back to exactly 90 days, not tomorrow, not 91 days ago;
  - refused: a shift ahead, too old, cancelled, someone else's, another firm's;
  - the same question again, a different issue, after it's sorted, and two taps at once;
  - no pay code, an expired one, someone else's session, an office session: refused everywhere;
  - the worker's own list from the last 90 days with each status.
- Unit tests: the form's check, the words, and the pay page's list.
- Isolation tests now include `pay_queries`.
- `tests/e2e/pay.query.spec.ts` (1 browser test): the form refuses without a code; with one,
  "Something else" needs a note; a query about a day is sent, confirmed, and listed on the pay
  page "With payroll".

### Parked, open, and things that need Dylan

- **Dylan to confirm** (in `PLAN.md`, Parking lot, "Pay query follow-ups"): behind the pay code,
  8 weeks of shifts or 90 days back, details only for "Something else"; how long pay queries are
  kept.
- **Parked:** firm-cancelled shifts in the list; adding a note to an open query; a database
  backstop for duplicates; a "which pay line?" choice.

### How to see it working

1. Run `npm run dev`.
2. Open `http://acme.localhost:3000/login` and log in as `07700 900103` (the link appears in the
   `npm run dev` terminal).
3. "See your pay" → "Send me a code" (the code is in the terminal) → "Check code".
4. "Raise a pay query" → choose a day, "Paid late or not paid" → "Send pay query".
5. "Back to your pay": it's listed under "Your pay queries" as "With payroll".

## 2026-09-29: Phase 6, task 2: Grouping pay queries by likely cause (0.4 h, BLOCKED)

### Time

0.4 hours of Claude's working time (13:28 to 13:53 UTC), in the unattended overnight loop.
Phase 6 so far: 0.9 of its 12 to 18 hour estimate.

### Result

- **Blocked, not ticked.** The task says "Haiku summarises": that needs Claude on Amazon Bedrock,
  an outside service with an AWS account and money, which tonight's rules don't allow. Everything
  short of it is built, verified and committed; "Connect Bedrock" in `PLAN.md`'s Parking lot has
  the steps.
- `scripts/verify.sh` printed `VERIFIED tree=44d6498836690d17 e2e=true`. That covers:
  - the type checks and lint;
  - all 2191 tests (up from 2177);
  - the 38 browser tests;
  - the rule checks.
- The guardrails review found nothing to fix first. No auditor round: the auditor decides a tick,
  and this task can't be ticked until Bedrock is connected (the same rule as the earlier blocked
  tasks).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

When a pay rate isn't updated, dozens of workers ask the same question. Payroll should see one
group ("37 queries: wrong rate, the week of Mon 7 Sep, paid at £12.50") instead of 37 separate
messages.
- **Grouping keys, worked out by code** (never by AI: golden rules 1 and 9). Each query gets a
  "key": queries with the same key share a likely cause.
  - **Wrong rate**: the week and the rate the worker's imported pay line was paid at (a rate
    change not applied).
  - **Hours missing**: the week and the site (one site's timesheet).
  - **Paid late**: the week (one pay run).
  - **Something else**: the week.
  The week is the Monday of the day worked. The key is set when the query is raised. It's worked
  out again if a pay line arrives later ("regrouping").
- **Payroll's "Pay queries" page** (payroll and admins): waiting queries grouped, biggest group
  first. Each group has a plain line written by the app from its facts, and each worker's query
  (their shift or day, their note, when). It's read only for now: answering, the digest email and
  telling workers are the next tasks.
- **The AI summary, ready but not connected:**
  - The AI will get only a group's facts (how many, the issue, the week, the site, the rate). It
    never gets names or the workers' own words.
  - Its one line is used only if it passes a check: one line, short, no numbers that aren't in the
    facts, no advice or blame. It's shown under the app's own line and labelled "written by AI".
  - Until Bedrock is connected, the app's line is used everywhere.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | "Haiku summarises" can only be proven with Bedrock | Tick with the app's line (would claim something untested) |
| Only the key parts that point at one cause | Every part for every issue would split one cause into many groups | Week + site + rate + issue for all |
| The AI sees facts only; its line is checked; the app's line is always the heading | AI reads, code decides; less personal data leaves the app; a bad line never misleads payroll | Trust the AI's line |
| AI calls happen outside database transactions | An AI call can take seconds; a transaction shouldn't wait | Call it while loading |

### What the new tests prove

- `tests/unit/pay.group-keys.test.ts`: every issue's key rule, the same cause gives the same key
  (Monday and Sunday of one week, rates in any order), different weeks, rates or sites don't, and
  every key reads back into its parts.
- `tests/unit/ai.pay-summary.test.ts`: the app's line for each kind of group; with no AI, the
  app's line; a good AI line is used and the AI gets the facts only; bad lines (too short, too
  long, two lines, invented numbers, advice, blame) and an AI failure fall back to the app's line.
- `tests/integration/pay.query-groups.test.ts` (4 tests, on the real database): keys set when
  raised, one cause per group; a pay line imported later moves a query when regrouped (sorted
  ones stay put; running it twice changes nothing); payroll's grouped view, with an AI line added
  beneath afterwards; only this firm's queries; payroll and admins yes, resourcers no.
- The browser test now also has payroll finding the worker's query in its group.

### Parked, open, and things that need Dylan

- **Connect Bedrock** (Parking lot, with steps): an AWS account, Bedrock model access for Claude
  Haiku in the EU, a least-privilege role, the client behind the interface built tonight, and the
  compliance note. Then this task can be ticked.
- **Dylan to confirm** (Parking lot, "Pay query grouping follow-ups"): the grouping rules
  (including workers with two pay rates in a week).
- **Parked:** freezing keys once in a digest; a stricter count check before the AI line is shown.

### How to see it working

1. Raise a pay query as a worker (see the previous task's steps).
2. Log in at `http://acme.localhost:3000/office/login` as `acme.payroll@example.com`.
3. Click "Pay queries": the query is in its group, under the app's line.

## 2026-09-29: Phase 6, task 3: The payroll digest email (0.8 h)

### Time

0.8 hours of Claude's working time (13:56 to 14:46 UTC), in the unattended overnight loop.
Phase 6 so far: 1.7 of its 12 to 18 hour estimate.

### Result

- **Ticked.** The independent auditor (the `claims-auditor`, which checks the work from the files
  on disk only) said "VERDICT: DONE" in its first round.
- `scripts/verify.sh` printed `VERIFIED tree=c1e55edcd477155d e2e=true`. That covers:
  - the type checks and lint;
  - all 2231 tests (up from 2191);
  - the 38 browser tests;
  - the rule checks.
- The guardrails review found 3 things to fix first. All 3 are fixed and tested (below).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.
- **Email isn't really sent yet.** Like every office email so far, the digest goes through the
  "console transport": in development it prints the email and saves it to a file instead of
  sending it. Connecting Amazon SES (Amazon's email-sending service) is parked with steps.

### What was built

A **digest** is one email that gathers many things into a summary. Instead of payroll getting 42
separate pay questions, they get one email at a set time.
- **When it goes.** Each firm has a new setting, `pay_digest`: a time and the days of the week.
  The default is 09:00, Monday to Friday, London time. A check runs every 5 minutes (a "cron
  job": a task the computer runs on a timetable). When a firm's time has come, it queues that
  firm's digest, once a day.
- **What it says.** The first line is the one the task asked for, for example: "42 new pay queries
  since the last digest. 37 are about the same thing: wrong rate, the week of Mon 7 Sep, paid at
  £12.50." Then one line per group (biggest first, at most 30 lines). It also says how many
  older queries are still waiting. It ends with a link to payroll's page and "— {firm} Shift
  Team".
- **The list attached.** A CSV file (a simple spreadsheet file Excel opens) called
  `pay-queries-{date}.csv`, with one row per query: reference, worker, day worked, shift, issue,
  what they wrote, when it was sent and its group. Workers' names and their own words are only
  in this file, never in the email's text (email previews and forwards show the text).
- **Each query goes once.** A query included in a digest is marked "In a digest", so the next
  digest has only new ones. If no email gets through at all, the queries go back to waiting for
  the next digest.
- **Who gets it.** Active payroll users. If a firm has no payroll user, its admins (someone must).
  An address the email can't go to is skipped and counted.
- **Payroll's page** (`/office/pay-queries`) has a new "Payroll digest" box: when it goes, the
  last one sent ("Last digest: 09:02 on Mon 2 Nov, 42 queries to 2 people."), a line if one
  didn't go, and a **"Send the digest now"** button (payroll and admins only).
- **AI.** The job can add an AI summary line under each of the 10 biggest groups, labelled
  "(written by AI)". Until Bedrock is connected (parked earlier) there's no AI, and the app's own
  line is used. The AI never decides anything here.
- **The log.** Every step is written to the action log: the digest starting, each query going
  into it, the digest sent (or failed, or skipped because there was nothing new or no one to send
  to), and each query going back if nothing was sent.

Key numbers: at most 1,000 queries per digest (the oldest first); an attachment of at most
6,000,000 bytes; at most 3 attachments per email; "Send the digest now" at most once a minute.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Not blocked: email through the console transport, SES parked | Every office email so far works this way; the task names email, not SES | Block the task on SES |
| Default 09:00, Monday to Friday, firm-local | Payroll works office days; a morning digest lands before the day's work | Every day; a time only |
| Each digest has the new queries, plus a count of older ones | "42 queries" reads as what's new; the page has the rest | Every waiting query every time |
| Payroll only; admins when there's no payroll user | The task says "to payroll"; someone must get it | Payroll and admins always |
| Mark queries before sending; put them back if nothing went | Two digests at once (the schedule and the button) can't send the same queries; nothing is lost when every send fails | Mark after sending |
| Any failed send counts as not sent, even a timeout that might have gone | A query listed twice is better than one payroll never sees | Only definite failures |
| Names and workers' words only in the attachment | Email text shows in previews and forwards | Everything in the text |
| At most 1,000 queries per digest | Keeps the attached file under the size limit even in the worst case (proved by a test) | 2,000, as on the page |
| "Send the digest now" queues the same job | One path for the schedule and the button; work happens in jobs | Send from the web page's own request |

### What the guardrails review caught (and what was done)

- **Log entries in the wrong place.** Queries were marked "in a digest" in one step, but logged in
  a later step, and not logged at all when they went back. Now each query is logged in the same
  database transaction (a group of changes saved all together or not at all) as its change, both
  ways.
- **The last step could fail silently.** The step that records the outcome had no lock and no
  retry. If the database cancelled it to break a "deadlock" (two jobs each waiting for the other),
  the digest could be lost. Now it waits its turn and runs again if cancelled.
- **A lost digest was invisible.** If a digest stopped part way, the page stopped mentioning it
  after 30 minutes. Now it says "The digest at {time} may not have gone: it stopped part way."
- Smaller ones: a second press within a minute now says "Wait a minute, then try again." instead
  of pretending to send; the file size limit is in bytes; the page says when some addresses
  failed.

### What the new tests prove

- `tests/unit/pay.digest-schedule.test.ts` (8 tests): the setting and its defaults (a broken part
  gets the default; "no days" is kept); when a digest is due, including British Summer Time, the
  night the clocks go back and another time zone; the schedule in words.
- `tests/unit/pay.digest-copy.test.ts` (7 tests): the task's exact example email; each kind of
  first line; the AI line under its group; older and left-over queries; the 30-line cap; the
  attached list (spreadsheet-safe cells, accented names, a formula turned into plain text); the
  biggest possible list fits the size limit; every message on payroll's page.
- `tests/unit/copy.templates-doc.test.ts`: the email matches `docs/messaging-templates.md` word for
  word.
- `tests/unit/messaging.console.test.ts`: attachments are printed as name and size only, kept whole
  in the dev outbox file, and bad ones are refused (a path in the name, another type, too many,
  too big).
- `tests/integration/pay.digest.test.ts` (15 tests, on the real database): the whole email, the
  attachment, the marks and every log entry; once per day; the next digest has only new ones; a
  pay line imported late moves a query to its group first; no one to send to; admins when there's
  no payroll; every send failing puts queries back (logged); one of two addresses failing still
  counts; a deadlock on the last step (sent once, logged once); a digest that stops part way (the
  page says so); the AI line, what the AI sees (no names), and the AI failing; other firms
  untouched; two digests at once (one sends); the timetable; bad job data refused; the worker's
  wiring; "Send the digest now" roles, once a minute, and nothing to send.
- The browser test (`tests/e2e/pay.query.spec.ts`) now goes on: payroll presses "Send the digest
  now", the email arrives in the outbox with the worker's note only in the attached list, and the
  page then shows the last digest and the query "In a digest".

### Parked, open, and things that need Dylan

- **Connect Amazon SES** (Parking lot, with 6 steps): verify the sending domain, leave the SES
  "sandbox", give the server permission to send only, write the SES sender (attachments as
  email parts), handle bounces, and send yourself a test digest.
- **Dylan to confirm** (Parking lot, "Payroll digest follow-ups"): the 09:00 weekday default;
  payroll only; new queries only; and that the pilot firm is happy for the list (names and what
  workers wrote) to go to payroll's mailbox.
- **Parked:** the digest time on a settings screen (set in the database until then); sending again
  a digest that stopped part way; recording SES message ids; hiding the daily "nothing new" line
  from the log if it's noisy.

### How to see it working

1. Start the app: `npm run dev` (with the database up and seeded).
2. Raise a pay query as a worker (see the pay query form task's steps).
3. Log in at `http://acme.localhost:3000/office/login` as `acme.payroll@example.com` and open
   "Pay queries".
4. In the "Payroll digest" box, click **"Send the digest now"**. You should see "Sending the
   digest now: 1 new query to 1 person…".
5. In the terminal running `npm run dev`, the email is printed with "Attached:
   pay-queries-{date}.csv" (the file's name and size only). If your `.env` sets
   `CONSOLE_OUTBOX_FILE` (a path starting `.dev/`), the whole email, attachment included, is also
   saved in that file.
6. Refresh the page: "Last digest: …" appears and the query says "In a digest".

## 2026-09-29: Phase 6, task 4: Workers see their pay query answered; AI never answers (0.6 h)

### Time

0.6 hours of Claude's working time (14:50 to 15:28 UTC), in the unattended overnight loop.
Phase 6 so far: 2.3 of its 12 to 18 hour estimate.

### Result

- **Ticked.** The independent auditor said "VERDICT: DONE" in its first round.
- `scripts/verify.sh` printed `VERIFIED tree=747ac438704f6c19 e2e=true`. That covers:
  - the type checks and lint;
  - all 2264 tests (up from 2231);
  - the 38 browser tests;
  - the rule checks.
- The guardrails review found 1 thing to fix first. It's fixed and tested (below).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Before this task, a worker's pay query just said "With payroll" forever. Now payroll can answer it,
and the worker hears back.
- **Payroll marks a group sorted.** On payroll's "Pay queries" page, each group has a box, "Tell
  them what payroll did", and a button, "Mark as sorted and tell them". The note is required (a
  pay question answered with no explanation isn't an answer) and at most 500 characters.
  - It sorts only the queries payroll can see in that group, so nothing they didn't read is sorted.
  - If two payroll people click at once, each query is sorted once. The second person is told
    "These were already sorted by someone else."
  - The database now remembers who sorted each query, when, and the note (three new columns, a
    "migration": a script that changes the database's shape).
  - The action log gets one line per query ("Office Person sorted Ann Booker's pay query and wrote
    them a note."). The note itself is never written to the log.
- **The worker is told.** Each worker gets one WhatsApp (or text) message: "Update on your pay
  query (ref 3F2A9C1B): sorted. {payroll's note} — {firm} Shift Team".
  - It goes once only, even if the job runs twice.
  - It waits for quiet hours to end (22:00 to 07:00 by default): pay answers are never urgent.
  - Their phone also gets a push notification, "Pay query sorted", which says nothing about the
    pay itself, because lock screens show notifications.
- **The worker sees it on their pay page** (behind the pay code): "Sorted on Tue 3 Nov" and
  "Payroll says: “…”". Queries not yet answered still say "With payroll".
- **AI never answers a pay dispute.** The note is always a person's words. A new test,
  `tests/unit/ai.boundary.test.ts`, is a "tripwire": it reads how the code files import each
  other and fails if:
  - the AI is given any job other than payroll's summary line;
  - any file other than the two payroll-facing ones starts using the AI code, or anything new
    starts using those two;
  - an AI company's code library is used outside `src/lib/ai/`;
  - anything that builds what a worker sees or receives can reach AI code;
  - payroll's sorting path can reach AI code, from the note box to the database.
  It can't prove every possible path, and the docs now say exactly what it checks.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Sort the queries payroll saw, not "the group" by its key | A query can move group between loading the page and clicking | Sort by the group's key |
| A note is required | The worker needs to know what payroll did | Optional, like approving a request |
| The note goes in the message itself, as the doc's template says; the push stays generic | The doc's wording; a lock screen shouldn't show pay details | Keep the note behind the pay code (Dylan to confirm) |
| One "sorted" status | Payroll's note says whether anything changed | A separate "answered, no change" |
| No message when a query goes into a digest | It's still with payroll; one message when it's answered | Tell them at each step |
| The sort path has its own small files | So the test can prove nothing there reaches AI code | Keep it with the other office actions |

### What the reviews and test runs caught

- **The guardrails review:** the no-AI test didn't cover the office side, where payroll types the
  note. The sort path reached AI code indirectly (through a shared office file), so someone could
  have added an "AI draft note" there without failing it. Fixed by giving the sort path its own
  files and protecting them. I then made the reviewer's example breach on purpose: the test
  failed as it should, and I removed it.
- **Two older test problems**, found by the first full run (root causes found before changing
  anything):
  - The tenant-isolation test (it checks one firm can never link to another firm's rows) wants a
    cross-firm case for every link between tables. The new "sorted by" link needed one; added.
  - An older test sorted event numbers as text, so "1000003" came before "999998". The test
    database's event numbers have just grown past a million, so it started failing now and then.
    Fixed to sort by the number; what it checks is unchanged.
- Smaller ones: the note box now warns that everyone in the group gets the same note; the action
  log's worker filter finds these entries; a group can hold up to 2,000 queries (the page's own
  limit); the helper that builds id lists refuses anything that isn't an id.

### What the new tests prove

- `tests/integration/pay.resolve.test.ts` (11 tests, on the real database): sorting marks only the
  queries given, with the note, who and when, logs each without the note and queues one message
  each; payroll and admins only (not resourcers, disabled users or another firm's payroll); a note
  is needed and a short one; only waiting ones, two people at once sort each once, and ones
  already sorted are counted; another firm's queries can't be sorted; the worker's pay page shows
  the day and note; the action log finds it under the worker; the message is payroll's note in the
  doc's exact words, once only, with a push to the pay page; text when WhatsApp refuses or the
  worker chose text; quiet hours hold it until 07:00; a failed send is logged and never resent; an
  unsorted query sends nothing; the worker wiring.
- `tests/unit/ai.boundary.test.ts` (7 tests): the rules listed above.
- `tests/unit/portal.pay.test.ts`: the "Sorted on…" and "Payroll says…" lines.
- `tests/unit/copy.templates-doc.test.ts`: the message and push match the docs word for word, and
  the WhatsApp template pack now has `pay_query_update`.
- `tests/unit/pay.digest-copy.test.ts` and `tests/unit/db.arrays.test.ts`: payroll's result
  messages; the id-list helper refusing bad input.
- The browser test now goes on: payroll sorts the group with a note, the worker's message reaches
  the outbox, and the worker's pay page shows "Sorted on {today}" and the note.

### Parked, open, and things that need Dylan

- **Dylan to confirm** (Parking lot, "Pay query status follow-ups"): payroll's note goes in the
  WhatsApp/text message itself, as the doc's template says. The pay page is behind a code, but the
  message isn't. If it should stay behind the code, the message would say "See it on your pay page"
  instead (a template change for Meta).
- **Parked:** sorting one query on its own inside a bigger group; a "sorted recently" list for
  payroll; a stricter database check (a sorted query must always name who, when and the note);
  queueing the messages in one batch; and, for the Phase 7 WhatsApp line, pay messages must only
  ever get the "raise a pay query" link, never an answer.

### How to see it working

1. Start the app (`npm run dev`) and raise a pay query as a worker (see the pay query form task).
2. Log in at `http://acme.localhost:3000/office/login` as `acme.payroll@example.com` and open "Pay
   queries".
3. Under the query's group, type a note in "Tell them what payroll did" and click "Mark as sorted
   and tell them". You should see "Marked as sorted: 1 query. Each person will get your note by
   message."
4. In the terminal running `npm run dev`, the worker's WhatsApp message is printed ("Update on your
   pay query …: sorted. …"), unless it's quiet hours (22:00 to 07:00), when it waits.
5. As the worker, open "Your pay" (with the pay code): the query says "Sorted on {today}" and
   "Payroll says: …".

## 2026-09-29: Phase 6, task 5: The pay records import screen (0.5 h)

### Time

0.5 hours of Claude's working time (15:30 to 15:57 UTC), in the unattended overnight loop.
Phase 6 so far: 2.8 of its 12 to 18 hour estimate.

### Result

- **Ticked.** The independent auditor said "VERDICT: DONE" in its first round.
- `scripts/verify.sh` printed `VERIFIED tree=2cad81e465cea0ad e2e=true`. That covers:
  - the type checks and lint;
  - all 2275 tests (up from 2264);
  - the 39 browser tests (up from 38);
  - the rule checks.
- The guardrails review said "safe to commit" with nothing to fix first; its suggestions were done.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

The part that reads a payroll file was already built in Phase 3, and could only be run from the
terminal (`npm run import --kind pay`). Payroll can now do it themselves in the office app.
- **The screen, "Import pay records"** (`/office/pay/import`), for payroll and admins:
  1. Choose the file your payroll produces (.csv or .xlsx), with one line per person, pay period
     and rate. Columns: Staff ID (or Mobile), Period start, Period end, Hours and Rate, and Gross
     pay and Pay date if you have them.
  2. "Check the file" says what it would do ("This file would add 3 pay lines, change 1, leave 0
     as they are and skip 1.") and lists problems by row ("Row 5: an amount isn't money we can
     read (use 12.50)."). Nothing is saved or logged by a check.
  3. "Import these pay records" does it for real ("Imported: 3 pay lines added, …").
  Importing the same file again updates lines instead of adding them twice. Each worker then sees
  their own lines on their pay page, behind their pay code.
- **Pay queries follow the new lines.** A "wrong rate" pay query is grouped by the rate on the
  worker's pay line for that day. After a real import, waiting queries are regrouped straight away
  (in the same database transaction), and the screen says how many moved. The action log records
  it too.
- **Links**: "Import pay records" in the office dashboard's menu and on the pay queries page.
- **One upload path for both screens**: the shifts import screen's code is now shared
  (`src/lib/office/office-import.ts`), with each screen saying who may use it and what happens
  after a real import.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Payroll and admins import pay, not resourcers | Pay figures are payroll's | Everyone who can import shifts |
| Regroup waiting queries in the import itself | Payroll's page is right straight after an import; the digest only regroups at its time | Leave it to the digest |
| Correcting or removing a wrong line: still for Dylan | The importer updates a line by worker, period and rate; a wrong rate needs a decision first | Build a delete now |
| `/office/pay/import` | Pay records aren't queries: the start of a pay area | Under the pay queries page |

### What the review suggested (and what was done)

- The "after a real import" step also ran during a check, outside the check's rollback. Pay was
  safe (it checked for itself), but a future screen could have saved something during a check.
  Now it only ever runs on a real import.
- More tests: a check logs nothing at all; another firm's payroll user can't import here; an
  import never regroups another firm's queries.
- The no-AI tripwire test now also covers the pay import, where pay figures come in (golden rule 1:
  code reads them, never AI).
- If two imports clash in the database, it tries again by itself instead of saying "Something
  went wrong".
- The log now says "imported a pay file" rather than "imported a file", and "2 waiting pay queries
  moved to the group that matches the pay records now."
- The "may this person use the pay area?" check was written three times; it's one helper now.

### What the new tests prove

- `tests/integration/office.pay-import.test.ts` (6 tests, on the real database): the check saves
  and logs nothing; the import adds the lines exactly as given (hours, rate and gross in pence, pay
  date), logged by who without any amounts; the same file again changes nothing and a corrected
  line updates; the worker then sees the line on their pay page; only payroll and admins (not
  resourcers, disabled users, another firm's payroll or an unknown id); a waiting wrong-rate query
  moves group after an import but not after a check, and it's logged; another firm's queries are
  never regrouped; too-big files, a missing column and a non-spreadsheet are refused, and another
  firm's staff are unknown here.
- `tests/unit/office.pay-import-copy.test.ts` (3 tests): every message on the screen.
- `tests/unit/office.log-types.test.ts`: the new log words.
- `tests/unit/ai.boundary.test.ts`: the import path can't reach AI code.
- A new browser test (`tests/e2e/office.pay-import.spec.ts`): payroll logs in, opens "Import pay
  records", checks a two-line file (one row for nobody, so "Row 3: …"), imports it, then the worker
  logs in with their pay code and sees "12.5 hours at £19.87 an hour" and "Gross pay: £248.38".

### Parked, open, and things that need Dylan

- **Dylan to decide** (Parking lot, "Pay records"): how payroll corrects or removes a wrongly
  imported line. Today nothing can delete one, a corrected rate comes in as a second line, and an
  update overwrites the old hours (the log keeps only which fields changed).
- A CSV saved in the old Windows format with a £ sign is refused as "not text" (use UTF-8 or .xlsx).
- A large file is one database transaction on the web (up to 5,000 rows): fine for a pilot.

### How to see it working

1. Start the app (`npm run dev`) with the demo data (`npm run db:seed`).
2. Log in at `http://acme.localhost:3000/office/login` as `acme.payroll@example.com`.
3. Click "Import pay records". Make a small CSV in a spreadsheet with the columns Mobile, Period
   start, Period end, Hours, Rate, Gross pay, Pay date, and one line for a demo worker (for example
   `07700 900111`, last week's dates like `19/10/2026` and `25/10/2026`, `12.5`, `19.87`, `248.38`).
4. Click "Check the file": it says it would add 1 pay line. Click "Import these pay records".
5. Log in as that worker at `http://acme.localhost:3000/login` and open "Your pay" with the code:
   the line shows "12.5 hours at £19.87 an hour".

## 2026-09-29: Phase 6, task 6: Tests for pay query grouping (0.3 h)

### Time

0.3 hours of Claude's working time (16:00 to 16:19 UTC), in the unattended overnight loop.
**Phase 6 is done** apart from the blocked grouping task (it waits for Bedrock): 3.1 hours of its
12 to 18 hour estimate.

### Result

- **Ticked.** The independent auditor said "VERDICT: DONE" in its first round.
- `scripts/verify.sh` printed `VERIFIED tree=d6fc474c3ea95332 e2e=true`. That covers:
  - the type checks and lint;
  - all 2285 tests (up from 2275);
  - the 39 browser tests;
  - the rule checks.
- The guardrails review said "safe to commit"; its suggestions were done.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### Why this wasn't blocked

The grouping task stays blocked because it says "Haiku summarises", and only a real AI model can
show that. This task is about what the app does when the AI **fails**, and a pretend AI (a "fake":
a stand-in the tests control) can act out every kind of failure. No outside service is needed.

### What was built

- **A real gap, found while planning.** The payroll digest asks the AI for a summary line for each
  group and waited for as long as it took. An AI that never answered (a stuck connection) would have
  held the digest up for ever. Now the app stops waiting after 5 seconds per group and uses its own
  line; a late answer is ignored. An answer that isn't text, or a pretend AI that breaks its rules,
  counts as a failure too.
- **The test file docs/testing.md asked for**: `tests/integration/pay.grouping.test.ts`, 9 tests on
  the real database.
  - **Stable keys** (a "key" is the label that puts queries with the same likely cause in one
    group):
    - the same facts give the same key, whoever raises the query, whatever they write, whenever and
      in whatever order;
    - the week is the firm's own week: a Monday just after midnight in summer time, and a Sunday
      night after the clocks went back, land in the right weeks;
    - regrouping again and again, or importing the same pay file again, changes nothing (and it's
      logged once);
    - a key changes only when its facts do: a new or corrected pay line moves open queries and ones
      already in a digest, but never sorted ones;
    - two firms with the same facts get the same key text but never share a group.
  - **AI failure falls back cleanly**: the digest runs again and again with a different pretend AI
    each time, and for all 12 kinds of failure the email and its attached list are word for word the
    same as with no AI at all, and still sent and logged. The 12 are:
    - not connected; an error; failing a moment later; never answering; a good answer that comes
      too late;
    - an empty answer; something that isn't text;
    - too long; two lines; a made-up number; advice.
    Each case checks the AI really was asked (once per group). When the AI fails for some groups
    only, just those lose their AI line.
- **Unit tests** (small tests with no database): no timer is left running after an answer, or
  after giving up; a pretend AI that answers without waiting, or fails at once, is handled.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Not blocked | The fallback is ours to prove with a fake; only the real summary needs Bedrock | Block it with the grouping task |
| The time limit is in our code, not only in the future Bedrock client | A stuck call must never hold up the digest, whichever client is plugged in | Trust each client's own time limit |
| A new file beside the existing small tests | docs/testing.md names it; the small tests stay as they are | Merge them |

### What the review suggested (and what was done)

- docs/testing.md claimed the digest was tested with an AI that answers late; only the summary
  was. Now a good answer arriving after the time limit is one of the digest's failure cases.
- The failure cases now check the AI was actually asked, so none can pass without it.
- One test only restated how the page is built; it's renamed and points at the test that holds the
  real guarantee.
- For the real Bedrock connection (parked under "Connect Bedrock"): cancel a request the app has
  stopped waiting for (so it isn't still running and billed), stop asking after the first failure
  in a digest, and count how often the AI fails (never logging what it wrote).

### Parked, open, and things that need Dylan

- Nothing new for Dylan. The Bedrock follow-ups above join "Connect Bedrock" in the Parking lot.

### How to see it working

There's nothing new on screen: this task proves behaviour. To run just these tests:
`npx vitest run tests/integration/pay.grouping.test.ts` (with the database up: `npm run db:up`).
You should see "9 passed".

## 2026-09-29: Phase 7, task 1: Each firm's own WhatsApp number, the "shifts line" (0.6 h, BLOCKED)

### Time

0.6 hours of Claude's working time (16:22 to 16:58 UTC), in the unattended overnight loop.
Phase 7 so far: 0.6 of its 15 to 20 hour estimate.

### Result

- **Blocked, not ticked.** The task needs a real business number with a WhatsApp sender, bought in
  Twilio and approved by Meta: an outside service with an account and money, which tonight's rules
  don't allow. Everything short of it is built, verified and committed; "Connect Twilio" in
  `PLAN.md`'s Parking lot now has the steps for each firm's number.
- `scripts/verify.sh` printed `VERIFIED tree=edebd694047771f2 e2e=true`. That covers:
  - the type checks and lint;
  - all 2299 tests (up from 2285);
  - the 39 browser tests;
  - the rule checks.
- The guardrails review found 2 things to fix first; both are fixed (below). No auditor round: the
  auditor decides a tick, and this task can't be ticked until the real number exists (the same rule
  as the earlier blocked tasks).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

The "shifts line" is the firm's own phone number that staff message on WhatsApp (or by text, or
call). This task gets the app ready for it:
- **Each firm can have one number.** A new column on the firm's record (`firms.shifts_line_e164`)
  holds it in the international format ("E.164": +44 then the number without its first 0). A
  number can belong to only one firm; the database refuses a second.
- **Messages come from it.** Every WhatsApp and text the app sends a worker (offers, reminders, the
  office's changes, answers to requests and pay queries, login links and codes, licence warnings)
  now says which number it's from: the firm's line. A new "tripwire" test (it fails if someone
  breaks the rule later) checks that every place that sends passes it.
- **Incoming messages can find their firm.** When someone messages a firm's number, the app will
  need to know which firm it is before anything else. A small database function
  (`app_firm_by_line`) answers that from the number, giving only the firm's public details, like
  the one that already finds a firm from its web address.
- **The office dashboard shows it**: "Your shifts line: +44 7700 900000 (WhatsApp, text and
  calls)." or "No shifts line yet."
- **Setting it**: `npm run firm:line -- --firm acme --number "+44 7700 900123"`. Changing a number
  a firm already has needs `--replace`, so a typo can't quietly lose the real one.
- **The demo firm Acme** has a fake number from Ofcom's drama range (numbers set aside for films and
  TV, so they never reach a real person).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | The number only exists in Twilio | Tick with a fake number |
| One column on the firm, not a new table | One number per firm, as the task says | A table allowing several numbers per firm |
| One number for WhatsApp, texts and calls | Twilio numbers do all three; staff remember one number | A number per channel |
| Each message says its `from`, set by whoever sends it | The part that talks to Twilio stays simple (no database look-ups) | That part looking the firm up |
| A firm without a number still builds messages, with no `from` | What Twilio should do then is Dylan's call (a shared ShiftDesk number, or no messages) | Stop sending now |
| We set the number with a script, the firm can't type it in | We buy and own the numbers | A field on the settings screen |
| Not shown to workers yet | Until incoming messages get a reply (the next task), a message to it would go unanswered | Show it on the home page now |

### What the review and the test runs caught

- **Invariant 5** (a rule check in `scripts/verify.sh`: inside the app's code, only one place may set
  "which firm am I working for" in the database, besides the demo data's setup). My "set the number"
  code did it too, so the check failed. I'm not allowed to change the rule checks, and the one
  allowed place refuses the owner's connection. So the code moved out of the app into the
  operations script folder (`scripts/`), which the rule doesn't cover because it isn't the app.
  Dylan can move it back and add it to the rule's list if he prefers.
- **A pinned list of database functions**: a security test lists exactly which functions the app
  may run. The new look-up is a deliberate addition, so it was added to the list, with the same
  security checks as the others.
- **A real bug in reading numbers**: "+44 (0)7700 900123" came out as a number that looks valid but
  isn't. Now the "(0)" is dropped, as people mean it.
- **A test that could clash with the demo data**: test numbers could collide with Acme's demo
  number. They now come from a separate part of the fake range.

### What the new tests prove

- `tests/integration/shifts-line.test.ts` (7 tests, on the real database): the column only takes
  proper numbers, one firm each; the look-up finds the right firm with public details only, and
  unknown or badly written numbers find nobody; the look-up function is locked down (runs as the
  owner, a fixed search path, only the app may call it); a login code, a licence warning and a pay
  query answer come from the firm's number, and from a firm without one there's no `from`; the
  script sets, refuses a number another firm has, asks before replacing, and clears.
- `tests/unit/notify.from-line.test.ts`: every place that sends a WhatsApp or text passes the firm's
  number.
- `tests/unit/messaging.console.test.ts`, `notify.send.test.ts`, `tenancy.shifts-line.test.ts`: the
  number printed in development (the worker's number still hidden), both tries (WhatsApp, then the
  text fallback) carry it, and the dashboard's words.
- The seed's fake-data test now checks the firms' numbers are fake too; the office login browser
  test checks Acme's dashboard shows its number.

### Parked, open, and things that need Dylan

- **Connect Twilio, steps 7 and 8** (Parking lot): buy a number for each firm with SMS, voice and
  WhatsApp, register it as the firm's WhatsApp sender, set it with `npm run firm:line`, then tick
  this task. **Dylan to decide**: what a firm with no number yet should do (use a shared ShiftDesk
  number, or no WhatsApp/text until its own is live).
- Show the number to workers once incoming messages are answered (the next task).
- Record setting or clearing a number in the action log; make the "from" rule a hard type rule
  (today a pattern test checks it).
- CLAUDE.md lists the ways app code may reach the database; the new look-up could be added there
  (Dylan's file, so I didn't edit it).

### How to see it working

1. With the demo data loaded (`npm run db:seed`), start the app (`npm run dev`).
2. Log in at `http://acme.localhost:3000/office/login` as `acme.admin@example.com`: the dashboard
   says "Your shifts line: +44 7700 900000 (WhatsApp, text and calls)." Northline's dashboard says
   "No shifts line yet."
3. Log in as a worker (see earlier tasks): the WhatsApp message printed in the `npm run dev` terminal
   now shows "from +447700900000".

## 2026-09-29: Phase 7, task 2: Answering WhatsApps on the shifts line (0.7 h, BLOCKED)

### Time

0.7 hours of Claude's working time (17:02 to 17:42 UTC), in the unattended overnight loop.
Phase 7 so far: 1.3 of its 15 to 20 hour estimate.

### Result

- **Blocked, not ticked.** The task says "Haiku only for unclear text": that needs Claude on Amazon
  Bedrock, and real WhatsApps need Twilio. Both are outside services tonight's rules don't allow.
  Everything short of them is built, verified and committed. "Connect Bedrock" and "Connect Twilio"
  (step 9) in `PLAN.md`'s Parking lot have the steps; the task is ticked after both.
- `scripts/verify.sh` printed `VERIFIED tree=774604c4e49d992e e2e=true`. That covers:
  - the type checks and lint;
  - all 2344 tests (up from 2299);
  - the 40 browser tests (up from 39);
  - the rule checks.
- The guardrails review found 3 things to fix first; all are fixed (below). No auditor round (a
  blocked task can't be ticked).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

A worker messages their firm's WhatsApp number ("the shifts line") and gets the right link back
straight away, without waiting for the office.
- **A place to keep messages**: a new `messages` table holds each WhatsApp that arrives and each
  reply sent, per firm like every other table (one firm never sees another's).
- **The webhook** (the web address Twilio calls when a message arrives):
  - It checks Twilio's signature: a code Twilio makes from the message with a secret key, so
    nobody else can pretend to be Twilio. My check reproduces the example in Twilio's own
    documentation exactly.
  - It finds the firm from the number the message was sent to (the shifts line, from the last
    task), stores the message once (Twilio sometimes sends the same one twice) and hands it to a
    background job. It answers Twilio at once.
  - Without the secret key set (as now), it answers "not configured" and stores nothing.
- **The reply job**:
  - It finds the worker by the number the message came from.
  - Keywords decide first: "cancel" → the link to cancel a shift; "pay", "wages", "payslip" → the
    pay page (behind the pay code); "shifts", "work", "available" → open shifts; "help",
    "office", "talk" → a request for the office, and the reply gives its reference.
  - If none matches, the AI would pick one of those four replies (it can't write its own words).
    Until Bedrock is connected, those messages go to the office.
  - Replies come from the firm's own number, signed "{firm} Shift Team", at most once.
  - Someone who isn't one of the firm's workers gets no reply yet (that's the next task).
- **Pay is safe**: a pay question only ever gets the pay link, never an answer (golden rule 9).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | "Haiku only for unclear text" needs Bedrock (like the grouping task) | Tick on the keywords alone |
| The webhook is built now, with its signature check | Without the check anyone could make the app send messages; the later task covers the other Twilio webhooks | Wait for the signature task |
| Replies go from the job, not in the webhook's answer | The webhook stays quick; one path for every reply | Answer inside the webhook |
| The AI picks a reply, never writes one | AI reads, code decides; nothing the AI writes reaches a worker | Let the AI draft replies |
| Unclear messages go to the office | Nothing a worker asks is lost | Reply "I didn't understand" |
| Message ids are unique within a firm | A key unique across firms could tell one firm about another's rows | Unique across all firms |

### What the review and the test runs caught

- **A message could be lost.** The job marked a message as handled before doing anything. If it
  then failed (or the server restarted while waiting for the AI), a retry would skip the message:
  no reply, no office request, nothing in the log. Now nothing is written until the moment just
  before sending, so an earlier failure is simply retried. A test proves it.
- **Dropouts got the wrong link.** "Can't make my shift tomorrow" matched "shift" and got the open
  shifts link. Now "shift" isn't a keyword, and open shifts keywords don't count when the message
  says "can't", "not", "sick", "late" and the like: those go to the AI or the office.
- **A log entry that could fail.** A real Twilio message id can contain a long run of digits,
  which the log's privacy filter would mistake for a phone number, and the log entry would be
  refused after the reply had gone. The id is now kept on the stored reply instead. The same risk in
  the other senders is noted for when Twilio is connected.
- **A rule test**: every unique key must start with the firm, so message ids are now unique per
  firm. My own test helper also picked the wrong job once (fixed).

### What the new tests prove

- `tests/integration/inbound.whatsapp.test.ts` (13 tests, on the real database): a signed message
  is stored once with one job (a repeat stores nothing); no key, a missing or wrong signature, a
  wrong address, the wrong type, too big (declared or real) and bad fields are refused with nothing
  stored; a long message is kept, cut to size; nothing from a message is logged; a number no firm
  has is ignored; each keyword gets its link from the firm's number, signed, stored as a reply and
  logged without the text; "help" makes an office request with the message as its note and gives its
  reference; the AI's label picks the reply and anything else it says goes nowhere (a pay answer
  like "£40 extra" is never sent); a photo goes to the office; strangers and ex-workers get no reply
  here; at most one reply, a failed one logged and not retried; a failure before the reply is retried
  and answered once; one number at two firms reaches the right firm; another firm's message can't be
  touched.
- `tests/unit/inbound.signature.test.ts`: Twilio's documented example, and every kind of tampering.
- `tests/unit/inbound.keywords.test.ts`: each keyword, the order, dropouts, and the AI's label
  (only one of four words counts; failures and slow answers count as none).
- `tests/unit/ai.boundary.test.ts` (updated on purpose): the AI's new job is listed, only the
  reply job may use it, the webhook can't reach AI code, and the reply is always the fixed text.
- A new browser test posts a signed WhatsApp as Twilio would; the real app answers with the open
  shifts link from Acme's number. An unsigned post is refused.

### Parked, open, and things that need Dylan

- **Connect Twilio, step 9**: point each WhatsApp sender at the webhook and set the secret key.
  **Connect Bedrock**: pass the AI to the reply job. Then tick this task.
- **Dylan to confirm the keywords** ("work" and "available").
- Limits against reply loops with other bots, folding repeated "ok"/"thanks" messages, telling the
  office when a reply fails, deleting messages (and the office request's copy) after 90 days, and
  keeping Twilio ids out of all log entries.

### How to see it working

Real WhatsApps need Twilio. The browser test shows the whole path:
`npx playwright test tests/e2e/whatsapp.inbound.spec.ts` (stop `npm run dev` first). It posts a
signed message to the webhook and checks the reply in `.dev/e2e-outbox.jsonl`: "Open shifts you're
eligible for: http://acme.localhost:3100/shifts/open — Acme Events Shift Team".

## 2026-09-29: Phase 7, task 3: Messages from numbers we don't know (0.5 h, BLOCKED)

### Time

0.5 hours of Claude's working time (17:45 to 18:14 UTC), in the unattended overnight loop.
Phase 7 so far: 1.8 of its 15 to 20 hour estimate.

### Result

- **Blocked, not ticked.** What sets this off is a real WhatsApp arriving, and the reply goes from
  the firm's own number: both need Twilio, an outside service tonight's rules don't allow. The last
  two tasks were recorded the same way, so this one is too. Everything short of Twilio is built,
  verified and committed. "Connect Twilio" step 9 says how to check it and to tick it then.
- `scripts/verify.sh` printed `VERIFIED tree=0f57d531044375ba e2e=true`. That covers:
  - the type checks and lint;
  - all 2356 tests (up from 2344);
  - the 41 browser tests (up from 40);
  - the rule checks.
- The guardrails review found 4 things to fix first; all are done (below). No auditor round (a
  blocked task can't be ticked).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

When someone messages a firm's shifts line from a number that isn't one of its active workers:
- **A stranger** (a number nobody at the firm has) gets the reply the message doc sets out:
  "Thanks for your message. We don't recognise this number. If you work with {firm}, reply with
  your full name and the office will get back to you. — {firm} Shift Team", from the firm's number.
- **A former worker** (their number is on file, but they're not active) gets no reply: "we don't
  recognise this number" wouldn't be true. The office decides what to say.
- **The office is told.** Its active admins and resourcers get an email: "{firm}: a message from a
  number we don't know", pointing to the office dashboard. The email doesn't contain the number or
  the message (email previews and forwards spread personal data); those are on Today.
- **Today** has a new list, "Messages from numbers we don't know": the number, what they wrote (the
  first 300 characters), when, and the name if it was a former worker's number.
- **No loops.** A number gets at most one reply and one office email in any 24 hours. Without this,
  an automatic "away" reply or another bot could bounce messages back and forth for ever, and the
  office would get an email for every one. Later messages are still kept and shown on Today.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | Set off by a real WhatsApp, replies from the firm's number: both need Twilio (like the last two tasks) | Tick with the console messenger |
| One reply and one email per number in any 24 hours | Stops loops with other bots; one email for the office, not one per message | Reply to every message |
| No number or message in the email | Email previews and forwards; the office sees them on Today | Put the message in the email |
| A former worker gets no "we don't recognise this number" | It isn't true; the office decides | The same reply as a stranger |
| Admins and resourcers are told | They handle staff; payroll doesn't | Everyone in the office |

### What the review caught

- **Two messages at the same moment.** If one stranger sent two messages that were handled at the
  same time, both could have been treated as "the first", so both would get a reply and the office
  two emails. It only worked because the queue happens to run one job at a time. Now a lock (a
  database "one at a time" rule for that number) makes the second wait for the first. I checked the
  new test really catches it: with the lock removed it fails, with it it passes.
- **A false log line.** With nobody in the office to email, the log said "The office was emailed …
  (0 people)". Now it says nobody could be emailed.
- **Tests across firms**: a worker at one firm writing to another firm's number is a stranger
  there; a stranger's message at one firm doesn't count at another; Today never shows another
  firm's messages.
- **Smaller fixes**: the 24 hours now count from the last message that was answered (so someone
  writing every day gets one reply a day, not none); a worker made active again isn't called "not
  active" on Today; long messages are shortened on Today; the browser test uses a different number
  each try.

### What the new tests prove

- `tests/integration/inbound.whatsapp.test.ts` (6 new tests, 19 in all, on the real database): the
  polite reply from the firm's number and the office's emails (to admins and resourcers, not payroll
  or disabled users; no number or message in them); the log holds labels and counts only; Today
  shows the message; a second message within 24 hours gets no reply or email but shows on Today; a
  former worker gets no reply, the office is told, Today names them; failed sends are logged and not
  retried; nobody to email is logged as such; two messages at once get one reply; the 24 hours count
  from the last answered message; other firms don't mix.
- `tests/unit/office.today-view.test.ts`: the new Today list, a former worker, someone active again,
  a long message, and "None in the last 7 days."
- `tests/unit/copy.templates-doc.test.ts`: the reply and the email match the message doc.
- The browser test: a WhatsApp from an unknown number gets the polite reply; the office's email
  arrives; an admin logs in and sees the message on Today.

### Parked, open, and things that need Dylan

- **Connect Twilio step 9** (now also checks this), then tick this task.
- **Dylan to confirm**: no reply to former workers; the doc's "reply with your full name" for
  strangers; one reply and one email per number per 24 hours.
- From Today, adding the number to a worker (a new phone) or marking it done; a cap when many
  different numbers write at once.

### How to see it working

`npx playwright test tests/e2e/whatsapp.inbound.spec.ts` (stop `npm run dev` first): the second test
posts a WhatsApp from a made-up number, checks the polite reply and the office email in
`.dev/e2e-outbox.jsonl`, and logs in as an admin to see the message on Today.

## 2026-09-29: Phase 7, task 4: Ringing the shifts line (call-to-text) (0.8 h, BLOCKED)

### Time

0.8 hours of Claude's working time (18:18 to 19:06 UTC), in the unattended overnight loop.
Phase 7 so far: 2.6 of its 15 to 20 hour estimate.

### Result

- **Blocked, not ticked.** Phone calls, the spoken message and turning a voicemail into text only
  exist in Twilio (the phone company service), and tonight's rules don't allow using outside
  services. Everything short of Twilio is built, verified and committed. "Connect Twilio" step 10
  in `PLAN.md` says how to connect and check it, and to tick the task then.
- `scripts/verify.sh` printed `VERIFIED tree=9980c3d3845ea86e e2e=true`. That covers:
  - the type checks and lint;
  - all 2383 tests (up from 2356);
  - the 42 browser tests (up from 41);
  - the rule checks.
- The guardrails review found 4 things to fix first; all are done (below). No auditor round (a
  blocked task can't be ticked).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Some workers ring the office instead of messaging. Now, when someone rings a firm's shifts line:

- **They hear a short message**, spoken by Twilio's computer voice in British English: "Thanks for
  calling {firm}. We've just sent a link to your phone where you can see your shifts, take open
  shifts or cancel straight away. To leave a message for the office, speak after the tone."
- **A worker's number gets their login link** at once. It goes through exactly the same steps as
  the login page, so it has the same limits (3 links per number every 15 minutes) and gives the
  same answer for any number. A number that isn't a worker's gets nothing, and the caller can't
  tell the difference, so a call can't be used to find out whose number is whose.
- **No false promises.** A withheld number hears "We can't see your number, so we can't send you a
  link." A number that has hit the login limits (or when asking for the link fails) hears "We
  can't send you a link just now."
- **After the tone, a voicemail** of up to 2 minutes. Twilio turns it into text and sends it to a
  second webhook (an address on our app that Twilio calls). The text is stored once and handed to
  the same reply job as WhatsApps:
  - a worker's voicemail always becomes a request for the office (no keywords, no AI: a person
    rang to talk to the office). The worker gets "Thanks for your voicemail. The office will see
    it and get back to you. Ref {ref}." by the channel they chose (WhatsApp or text), from the
    firm's own number;
  - a caller we don't know, or a withheld number, gets no message. The voicemail shows on Today
    ("Number withheld · Voicemail") and the office's admins and resourcers get an email.
- **Every call is stored once** (by Twilio's id for the call), so if Twilio sends the same call
  twice, nothing happens twice. The office log says "Someone rang the shifts line", and a
  voicemail is logged as a voicemail, never as a WhatsApp.
- **One place checks every Twilio webhook** (`src/lib/inbound/twilio-request.ts`): no key set up
  (503), not a form (415), too big (413), a field sent twice (400), a signature (Twilio's proof the
  request is really from Twilio) that isn't for this address (403). The WhatsApp webhook now uses
  it too.
- **The requests page** adds "From a voicemail on the shifts line. A caller's number can be
  faked: check anything unusual with them." A phone number shown on a call can be faked; a
  WhatsApp's can't, easily.

Key facts:
- New files: `src/lib/inbound/voice.ts`, `src/lib/inbound/twilio-request.ts`, and three routes under
  `src/app/api/webhooks/twilio/voice/`.
- Database change (migration 0023): the `messages` table accepts `voice`, and the sender's number
  may be empty only on an incoming voice row from a withheld number. A database check (a rule the
  database enforces itself) refuses an empty sender anywhere else.
- A new WhatsApp template, `voicemail_received`, is in the submission pack (19 templates now).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | Calls and transcription only exist in Twilio | Tick with signed sample requests |
| The caller's link goes through the login page's own request | Same limits and the same answer for any number: a call can't tell anyone whose number it is | A separate link path for calls |
| A voicemail always goes to the office | Someone who rings wants a person; keywords and AI are for WhatsApp's quick answers | Sort voicemails like WhatsApps |
| Unknown and withheld callers get no message | Spam and robocalls would cost texts; they can leave a voicemail, which the office sees | Text every caller the portal address |
| The voicemail answer is a WhatsApp template (`voicemail_received`) | A call doesn't open WhatsApp's 24-hour window for free text, so a plain reply would be refused once Twilio is live | Always answer by text |
| Twilio's placeholder numbers for a hidden caller ID count as withheld | Otherwise every withheld caller would look like one "number", and after the first their voicemails wouldn't alert the office | Trust any number-shaped value |
| The link still goes by WhatsApp only | Sending login links by text is its own parked item (with a plain-hyphen sign-off so a text stays short) | Build it inside this task |

### What the review caught

- **A reply WhatsApp wouldn't have allowed.** The answer to a voicemail went as a free-text
  WhatsApp. WhatsApp only allows free text within 24 hours of the worker's own WhatsApp, and a
  phone call doesn't count. Once Twilio was live, it would have been refused and the worker
  would never get their reference. Now it's a proper template, checked word for word against the
  message doc and the submission pack.
- **A database check with a hole.** The rule "the sender must be a phone number, unless it's an
  incoming voicemail from a withheld number" let an empty sender through on any row. That's
  because a check that comes out "unknown" (as comparisons with an empty value do) counts as a
  pass. Fixed by saying "is not empty" explicitly, with a test that tries each wrong kind of row.
- **Voicemails logged as WhatsApps.** The office log said "Ann sent a WhatsApp to the shifts line"
  for a voicemail. It now says "Ann left a voicemail on the shifts line (for the office)". This
  log is the firm's evidence record, so it has to be right.
- **Withheld calls weren't stored once.** If Twilio sent a withheld call twice, it was logged
  twice. Now every call is stored by Twilio's call id, withheld or not.
- **Smaller fixes**: the caller isn't promised a link when the limits stop it or asking fails (and
  the call is still answered); the log entry points to the stored call; the requests page notes a
  voicemail's number can be faked; two more webhook checks tested; a wrong size in the docs.

### What the new tests prove

27 new tests.
- `tests/integration/inbound.voice.test.ts` (16 tests, on the real database):
  - a worker's call gets the spoken message, is stored once and gets their login link, and a
    repeat does nothing;
  - a stranger's call sounds exactly the same and nobody is sent anything;
  - withheld numbers (including Twilio's placeholders) aren't promised a link and are stored once;
  - the fourth call in 15 minutes hears "We can't send you a link just now", and a failed request
    still answers the call;
  - a number no firm has hears "Sorry, this number isn't in use.";
  - unsigned, wrongly signed, unconfigured and malformed requests are refused and store nothing;
  - other firms never see each other's calls;
  - the database refuses an empty sender except on an incoming voice row;
  - a voicemail's text is stored once, with no text when Twilio couldn't make any;
  - a worker's voicemail becomes a request and the answer goes by WhatsApp, or by text for a
    worker who chose texts;
  - a stranger's or a withheld voicemail alerts the office and shows on Today.
- `tests/unit/inbound.voice.test.ts` (5 tests): what the caller hears, word for word, and that a
  firm's name with "&" or "<" can't break it.
- `tests/unit/copy.templates-doc.test.ts`, `office.log-types.test.ts`, `office.requests-copy.test.ts`,
  `office.today-view.test.ts`: the words match the message doc, the log and the requests page say
  "voicemail", and Today shows "Number withheld · Voicemail".
- The browser test (`tests/e2e/voice.inbound.spec.ts`): a signed call to the demo firm's line gets
  the spoken message; the worker's login link arrives and logs them in; their voicemail gets the
  office's reference back; unsigned posts are refused.

### Parked, open, and things that need Dylan

- **Connect Twilio step 10** (new): point each number's calls at the voice webhook, set a
  fallback that forwards calls to the manager's mobile if the app is down, then ring it to check.
  Then tick this task.
- **Before going live**: delete each voicemail's recording at Twilio once its text is stored
  (the compliance doc says call audio isn't kept by default).
- **Build the parked "SMS fallback for login links"** first, so a worker without WhatsApp gets the
  link by text when they ring.
- **Submit `voicemail_received`** with the other WhatsApp templates (Connect Twilio step 2).
- **Dylan to decide**: Twilio's transcription is basic (names often come out wrong); a better one
  is a later option.

### How to see it working

`npx playwright test tests/e2e/voice.inbound.spec.ts` (stop `npm run dev` first). It posts a signed
"call" to the demo firm's line, checks what the caller would hear, finds the worker's login link in
`.dev/e2e-outbox.jsonl` and logs in with it, then posts the voicemail's text and checks the
worker's "Thanks for your voicemail…" reply.

## 2026-09-29: Phase 7, task 5: STOP by text, and respecting it everywhere (0.8 h, BLOCKED)

### Time

0.8 hours of Claude's working time (19:09 to 19:57 UTC), in the unattended overnight loop.
Phase 7 so far: 3.4 of its 15 to 20 hour estimate.

### Result

- **Blocked, not ticked.** A STOP only arrives as a real text through Twilio (the phone company
  service), which tonight's rules don't allow. Everything short of Twilio is built, verified and
  committed. "Connect Twilio" step 5 in `PLAN.md` says how to connect and check it, and to tick it
  then.
- `scripts/verify.sh` printed `VERIFIED tree=c9f081989204efdd e2e=true`. That covers:
  - the type checks and lint;
  - all 2418 tests (up from 2383);
  - the 43 browser tests (up from 42);
  - the rule checks.
- The guardrails review found 1 thing to fix first; it's done, with its other suggestions (below).
  No auditor round (a blocked task can't be ticked).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

UK rules and good manners say a person who replies STOP to a text should get no more texts. Now:

- **Texts to the shifts line are received.** A new webhook (an address on our app that Twilio
  calls when a text arrives) checks it's really from Twilio, stores the text once and hands it to
  the same reply job as WhatsApps.
- **STOP turns texts off.** If the whole text is one of Twilio's standard opt-out words (STOP,
  STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, and the newer OPTOUT and REVOKE), in any case, even with
  a full stop or "!", that worker's texts are turned off. They get one text back: "You won't get
  texts from {firm} now. Reply START to turn them back on. - {firm} Shift Team".
- **START turns them back on** (so do UNSTOP, and YES for someone whose texts are off): "Texts from
  {firm} are back on. Reply STOP to turn them off."
- **No double messages.** The confirmation only goes when the setting actually changed, and not
  when Twilio has already sent its own. A second STOP gets nothing. If a STOP and a START are
  handled out of order (a retried job), the later one wins.
- **Every sender respects it.** The seven places that message workers (offer waves, office offers,
  reminders, three kinds of notice, the shifts line's replies) all go through one sender,
  `sendToWorker()`. It now requires an `smsAllowed` value, so the code won't build without it.
  A worker who replied STOP never gets a text: if they chose texts, they get WhatsApp instead; if
  their WhatsApp fails, nothing is sent as a text (the failure is logged).
- **The worker can see it.** Their profile says "Texts are off: you replied STOP to one of our
  texts. We'll send shift messages by WhatsApp. To turn texts back on, text START to our number."
  If they choose "Text message" and save, the confirmation says texts are off, rather than
  pretending.
- **The office can see it** in the action log: "Ann Booker turned off texts (replied STOP)."
- **Other texts** to the shifts line get the same instant replies as WhatsApps ("shifts", "pay"
  and so on), by text.

Key facts:
- Database change (migration 0024): `workers.sms_opted_out_at` (when they replied STOP; empty means
  texts are fine), and on `messages`, `twilio_opt_out` (Twilio said it handled a STOP or START).
- New files: `src/lib/inbound/opt-out.ts` (the words and the handling), `src/lib/inbound/claim.ts`
  (a small shared helper), `src/app/api/webhooks/twilio/sms/route.ts` (the webhook).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | A STOP only arrives through Twilio | Tick with signed sample requests |
| The setting lives on the worker's row | One row per firm and number, and every sender already reads it | A separate table of opted-out numbers |
| Twilio's standard words, whole message only, CANCEL included | Our record should match what Twilio does; "can I cancel my shift" isn't an opt-out, only "cancel" alone | Our own shorter list (would disagree with Twilio) |
| Texts off means WhatsApp instead | STOP turns off a channel, not work contact; offers are their income | No messages at all |
| One confirmation, only when the setting changed and Twilio didn't confirm | Every action ends with a confirmation, without loops or doubles | Always confirm |
| The later word wins when STOP and START are handled out of order | What the person said last is what they want | Whichever job runs last |

### What the review caught

- **A false "Saved" message.** A worker whose texts were off could choose "Text message", save,
  and be told "We'll send shift messages by text message", which wasn't true. Now it says "Texts
  are off, so we'll send shift messages by WhatsApp until you text START."
- **Out of order.** If a START's job failed once and ran again after a later STOP, texts would
  have come back on. Now a STOP or START handled after a later one changes nothing (tested, and
  the test fails without the fix).
- **"Stop."** with a full stop or "!" wasn't recognised; now it is. OPTOUT and REVOKE were added.
- **A swallowed "Yes".** If Twilio counted a plain "Yes" as START for someone whose texts were
  already on, the message would have vanished. Now it's handled as an ordinary message.
- **An office email that wasn't true.** The alert about a message from an unknown number said "we
  asked them for their full name", but only WhatsApps from strangers get that reply (not texts,
  voicemails or former workers). It now says "We asked them for their full name." or "We haven't
  replied to them.", whichever happened.
- **A gap in a guard test.** The test that holds every message to "send from the firm's number"
  only spotted messages written over several lines. It now spots one-line ones too, and a new
  check makes sure only the STOP confirmation sends a text directly (everything else must go
  through the sender that respects STOP).

### What the new tests prove

35 new tests.
- `tests/integration/inbound.sms.test.ts` (14 tests, on the real database):
  - the webhook stores a text once, keeps Twilio's STOP or START, and refuses fakes;
  - STOP turns texts off with one confirmation, and the log holds no phone numbers;
  - which words count, in which forms, and which don't;
  - a second STOP changes nothing, and START turns texts back on;
  - YES only counts when texts are off, and a Twilio "START" on a plain "Yes" isn't swallowed;
  - the later word wins;
  - when Twilio handled it, no second confirmation goes;
  - a former worker's number is marked, and a stranger gets nothing;
  - after STOP, the shifts line answers by WhatsApp;
  - other firms are untouched;
  - a failed confirmation is logged and not retried.
- `tests/integration/notify.policy.test.ts` (4 new): for offer waves and reminders, run through their
  real jobs, a worker who replied STOP gets WhatsApp, never a text.
- `tests/unit/notify.send.test.ts` (3 new), `inbound.opt-out.test.ts` (3), `notify.from-line.test.ts`
  (2 new), `ai.boundary.test.ts` (1 new): the sender's rules, the words, the guards above, and that
  STOP only ever gets the two fixed texts.
- `tests/unit/portal.profile.test.ts`, `copy.templates-doc.test.ts`, `copy.plain-language.test.ts`:
  the profile note and the honest "Saved" message, and every new text matches the message doc.
- I also checked the key tests really catch mistakes: with the rule broken on purpose (texts sent
  to opted-out workers), 7 tests failed; with the ordering fix removed, its test failed.
- The browser test (`tests/e2e/sms.stop.spec.ts`): a signed STOP to the demo firm's line brings the
  confirmation text; the worker logs in and their profile says texts are off; START brings the
  other confirmation and the note goes.

### Parked, open, and things that need Dylan

- **Connect Twilio step 5** (updated): point each number's incoming texts at the SMS webhook, check
  whether Twilio's own opt-out handling is on (and keep its word list the same as ours), then text
  STOP from a worker's phone to check. Then tick this task.
- **Dylan to decide**: drop CANCEL from the opt-out words (Twilio's and ours), so "cancel" alone by
  text means cancelling a shift, not stopping texts.
- Left for later (in the Parking lot): a worker whose number changes keeps "texts off"; a HELP text
  Twilio answers also gets our reply; the parked SMS login links must respect STOP.

### How to see it working

`npx playwright test tests/e2e/sms.stop.spec.ts` (stop `npm run dev` first). It texts STOP to the
demo firm's line, finds the confirmation in `.dev/e2e-outbox.jsonl`, logs in as that worker, shows
the "Texts are off" note on the profile, then texts START.

## 2026-09-29: Phase 7, task 6: Every Twilio webhook checked and stored once (0.3 h, DONE)

### Time

0.3 hours of Claude's working time (20:01 to 20:19 UTC), in the unattended overnight loop.
Phase 7 so far: 3.7 of its 15 to 20 hour estimate.

### Result

- **Done and ticked.** The independent auditor returned DONE (its verdict is in
  `docs/overnight-log.md`).
- `scripts/verify.sh` printed `VERIFIED tree=9ed52ebe9192a916 e2e=true`. That covers:
  - the type checks and lint;
  - all 2434 tests (up from 2418);
  - the 43 browser tests;
  - the rule checks.
- No guardrails review: only tests and docs changed, no app code.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

A webhook is an address on our app that Twilio (the phone company service) calls when a message
or call arrives. Anyone on the internet could call that address too, so each request has to prove
it came from Twilio. Twilio does this with a signature: a code worked out from the request and a
secret key only Twilio and we know.

The five Twilio webhooks built over the last few tasks (WhatsApp, texts, calls, voicemail text,
and the goodbye after a voicemail) already:
- checked the signature first, against the webhook's own address as we configured it (so a
  request signed for one webhook doesn't work at another);
- stored each message, call or voicemail once, by Twilio's own id for it, so a repeat (Twilio
  trying again, or someone replaying a captured request) changes nothing.

This task made sure that stays true:
- **A guard test** (`tests/unit/twilio.webhooks.test.ts`) reads the code. It fails if:
  - a new Twilio webhook appears that isn't on its list;
  - a webhook doesn't check the signature before anything else, or checks it against the address
    the request claims instead of our configured one;
  - anything else in the app checks Twilio signatures its own way;
  - any incoming message is stored without the "only once" guard, or its job runs without it.
- **I checked the guard really catches mistakes**: a new unchecked "status" webhook made it fail,
  and so did removing the "only once" guard from the storage code. Both were undone.
- **The API doc** has a new "Twilio webhooks" section: the checks in order, what each webhook
  stores once, and what a repeat does.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Not blocked | Signatures and storing once are our own code, and the signature maths reproduces Twilio's published example | Blocked, like the flows that need a real message |
| The delivery-status webhook isn't built here | It only matters once the real Twilio sender exists (it tells Twilio where to report) and the 60-second text fallback, both parked | Build it now with nothing calling it |
| A guard test that reads the code | Keeps the promise true as new webhooks are added, like the other guard tests | Rely on each webhook's own tests |

### What the new tests prove

16 new tests, in `tests/unit/twilio.webhooks.test.ts`:
- every Twilio webhook route is listed, accepts POST only, gets the configured key, and checks
  its own configured address;
- each handler's first step is Twilio's checks, and a refusal returns at once;
- the shared checks run in the right order (key, size, repeated fields, then the signature);
- nothing else in the app checks a Twilio signature;
- every incoming message is stored with the "only once" guard, and nothing follows unless it's new.

The behaviour itself (fakes refused with nothing stored, repeats doing nothing) is proven by the
WhatsApp, text and call tests from the earlier tasks.

### Parked, open, and things that need Dylan

- The delivery-status webhook: with the Twilio sender (Connect Twilio step 4). The guard test will
  hold it to the same rules.
- Nothing new for Dylan.

### How to see it working

`npx vitest run tests/unit/twilio.webhooks.test.ts` runs the guard test (a second or two, no
database needed).

## 2026-09-29: Phase 7, task 7: Tests for repeats and Twilio's signatures (0.5 h, DONE)

### Time

0.5 hours of Claude's working time (20:22 to 20:54 UTC), in the unattended overnight loop.
Phase 7 so far: 4.2 of its 15 to 20 hour estimate. Phase 7 is now finished as far as it can be
without Twilio: 2 tasks done and ticked, 5 blocked on Twilio (built and verified short of it).

### Result

- **Done and ticked.** The independent auditor returned DONE (its verdict is in
  `docs/overnight-log.md`).
- `scripts/verify.sh` printed `VERIFIED tree=5a57fef8a835da97 e2e=true` on the second run. That
  covers the type checks, lint, all 2451 tests (up from 2434), the 43 browser tests and the rule
  checks. The first run failed on one older test (below).
- No guardrails review: only tests and docs changed.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Two new test files:

- **`webhook.idempotent`** ("idempotent" means doing something twice has the same effect as doing
  it once). Twilio sends a webhook again if it thinks the first try failed, and someone who
  captured a request could send it again. For each webhook that stores something (WhatsApp, text,
  call, withheld call, voicemail text), the test sends the same Twilio id twice in a row, then ten
  copies at exactly the same moment. Each time: one row, one job, and every copy gets a normal
  answer. Then it runs the reply job ten times at once for one message: exactly one reply goes.
- **Signature contract tests.** A "contract" test checks that our code and Twilio agree on the
  rules. The test has its own few lines that work out Twilio's signature from Twilio's published
  instructions (not our code), and those lines reproduce Twilio's own worked example exactly.
  Then it builds requests the way Twilio sends them, with every field Twilio documents (not only
  the ones we use) and awkward text ("+", "£", "&", emoji, new lines, spaces written two
  different ways). Each is accepted and stored exactly as written. Requests signed the wrong way
  (over the encoded text, for http instead of https, for another webhook, or with a field removed
  afterwards) are refused.

**Checking the tests really catch mistakes.** I broke the code on purpose:
- removing the "store once" guard made the repeat tests fail;
- removing the database lock that stops two copies of the reply job both replying did *not* make
  the ten-at-once test fail at first. The reason: with a freshly started connection pool, the
  first copy finished before the other nine had even connected, so they never really ran at the
  same time. The tests now open all their connections first. After that, removing the lock made
  the test fail every time (3 out of 3), and with the lock it passed every time.

### The older test that failed

The first full check failed on `auth.magic-link` "two of one worker's links used at the same moment
both work". It had failed once earlier tonight too.

- **Why:** logging in with a link cancels the worker's other unused links, by design. The test
  started two logins "at the same moment" but didn't make sure they overlapped. When one finished
  first, it had already cancelled the other's link, so the second was correctly refused. The app
  was right; the test was wrong.
- **Fix:** the test now holds both links until both logins are waiting on them, then lets them go
  together. It still requires both to work, so it's no weaker. It passed 5 times out of 5 on its
  own and in the full run.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| "Real Twilio sample payloads" = Twilio's published signature example plus requests shaped exactly as Twilio documents them | There's no Twilio account tonight to capture real traffic; the published example is Twilio's own output | Wait for captured requests (now "Connect Twilio" step 11) |
| A signer written in the test, not Twilio's code library | No new dependency overnight; the published example pins the maths | Install Twilio's library |
| Fix the login race test by forcing the overlap | Keeps the strict check; the failure was the test's timing | Loosen it to accept one refusal |

### What the new tests prove

17 new tests: 8 in `tests/integration/webhook.idempotent.test.ts` and 9 in
`tests/integration/twilio.contract.test.ts`, as described above.

### Parked, open, and things that need Dylan

- **Connect Twilio step 11** (new): once Twilio is live, capture one real request to each webhook
  (with the key and any real numbers changed) and add them to the contract tests.

### How to see it working

`npx vitest run tests/integration/webhook.idempotent.test.ts tests/integration/twilio.contract.test.ts`
(needs the test database: `npm run db:up` first).

## 2026-09-29: Phase 8, task 1: Each firm's own name, colour and logo (0.7 h, DONE)

### Time

0.7 hours of Claude's working time (20:56 to 21:38 UTC), in the unattended overnight loop.
Phase 8 so far: 0.7 of its 18 to 28 hour estimate.

### Result

- **Done and ticked.** The independent auditor returned DONE (its verdict is in
  `docs/overnight-log.md`).
- `scripts/verify.sh` printed `VERIFIED tree=4ef3174113c319d3 e2e=true`. That covers:
  - the type checks and lint;
  - all 2469 tests (up from 2451);
  - the 45 browser tests (up from 43);
  - the rule checks.
- The guardrails review found 2 things to fix first; both are done, with most of its suggestions
  (below).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

Staffing firms want the portal to look like theirs, so their staff trust it. Now:

- **A bar at the top of every firm page**, on the staff portal and the office dashboard: the firm's
  logo (if it has one) and its name, on the firm's colour. The text on the bar is black or white,
  whichever is easier to read on that colour. For any colour at all, that gives at least 4.5 to 1
  contrast (the WCAG accessibility standard for normal text); a test checks this across thousands
  of colours.
- **The browser tab** says "Acme Events shifts", and a phone's top bar takes the firm's colour when
  the portal is saved to the home screen.
- **Setting it** is the owner's job (like the shifts line), with a new command:
  - `npm run firm:brand -- --firm acme --colour "#1d4ed8"`
  - `npm run firm:brand -- --firm acme --logo "https://…"` (an address of the logo on the firm's
    own website)
  - `--name "…"` and `--sign-off "Acme Shift Team"`
  Every value is checked before it's saved, and each change goes in the office's action log under
  "Firm settings" ("The firm's colour changed."), without the values themselves.
- **Messages stay signed "[Firm] Shift Team"** (golden rule 8). A firm can shorten the name part
  ("Acme Shift Team" for "Acme Events Ltd"), but the sign-off always ends "Shift Team", so it can
  never be a person's name.
- **Safety**: a logo is only ever an https:// address, shown as a picture; a colour is only ever a
  checked "#rrggbb" value. Neither is ever pasted into the page's code as text, so a bad value
  can't change how the page works. The logo is fetched with no "referrer", so the firm's website
  isn't told which page the worker was on.
- **Demo firms**: Acme is blue (#1d4ed8) and Northline is teal (#0f766e).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Set by the owner's command, not an office screen yet | The app isn't allowed to change the firms table; allowing it is a security change best made with the settings screen | Build the settings screen now |
| A logo is an address on the firm's own website | That's how the database was designed, and uploading needs storage (an outside service) | Upload logos to our own storage (later) |
| Text colour worked out automatically, any brand colour accepted | Every colour then stays readable; firms keep their real colour | Refuse light colours |
| The sign-off always ends "Shift Team" | Golden rule 8; the review found a firm could otherwise be signed "Sarah" | Any team name |
| The bar on every firm page, from one place (the root layout) | One change instead of editing every page | A bar on each page |

### What the review caught

- **The sign-off could break golden rule 8.** The first version accepted any team name, even a
  person's ("Sarah"). Now it must end "Shift Team".
- **Empty values slipped through.** `--logo ""` (for example from a typo in a script) would have
  quietly removed the logo. Empty values are now refused, and "no logo" must be asked for with
  `--no-logo`.
- **Smaller fixes**:
  - renaming a firm now also updates a sign-off that was just the old name;
  - the page no longer breaks if the brand can't be read (the database briefly down);
  - the brand is read and changed in one locked step;
  - a logo address that's too long once stored is refused;
  - the home-screen colour is tested;
  - the tab title is the firm's;
  - a mistyped option prints the usage instead of crashing (`--color` works too);
  - re-seeding the demo clears any logo;
  - the docs' log filter list is up to date;
  - the command no longer loads the app's database code.

### What the new tests prove

18 new tests, plus 2 browser tests:
- `tests/unit/tenancy.brand.test.ts` (8): which logo addresses are allowed; colours; the contrast
  maths (checked against the published values) and the whole-colour-cube check; the bar's picture
  and colours.
- `tests/integration/brand.test.ts` (9, on the real database): each firm sees only its own brand;
  the database refuses bad values; the command sets, refuses, clears and logs; every message's
  sign-off follows it; renaming.
- `tests/e2e/brand.spec.ts` (2): Acme's and Northline's pages show their own bars and colours, and
  the tab title; a logo set with the command shows up. The manifest test now checks the colour too.

### Parked, open, and things that need Dylan

- Later (in the Parking lot): a Branding section on the office settings screen; uploading logos to
  our own storage; home-screen icons made from the logo; the brand colour on buttons too.
- **To try it**: `npm run firm:brand -- --firm acme --colour "#b91c1c"` on your computer, then open
  http://acme.localhost:3000 (with `npm run dev` running): the bar is red with white text.

### How to see it working

`npm run db:seed` then `npm run dev`, and open http://acme.localhost:3000 (blue bar) and
http://northline.localhost:3000 (teal bar).

## 2026-09-29: Phase 8, task 2: A firm's own web address (0.8 h, DONE)

### Time

0.8 hours of Claude's working time (21:40 to 22:28 UTC), in the unattended overnight loop.
Phase 8 so far: 1.5 of its 18 to 28 hour estimate.

### Result

- **Done and ticked.** The independent auditor returned DONE (its verdict is in
  `docs/overnight-log.md`).
- `scripts/verify.sh` printed `VERIFIED tree=c22cd521a0074ffb e2e=true` on the second run (the first
  failed only because one file hadn't been through the formatter). That covers:
  - the type checks and lint;
  - all 2503 tests (up from 2469);
  - the 47 browser tests (up from 45);
  - the rule checks.
- The guardrails review found 2 things to fix first; both are done, with most of its suggestions
  (below).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

A firm can now have its staff portal on its own web address, like `shifts.acme.co.uk`, instead of
`acme.<our domain>`:

- **The firm adds one DNS record** (a CNAME: "this name is another name for that one") from
  `shifts.acme.co.uk` to its own subdomain with us, `acme.<our domain>`.
- **The owner saves it** with a new command: `npm run firm:domain -- --firm acme --domain
  shifts.acme.co.uk`. The command looks up the record in DNS (the internet's address book). The
  address only works once it's **verified**: the record points to that same firm's subdomain. So a
  typo, or someone asking to put Acme's address on another firm, can't work.
  - `--check` looks again (for example after the firm adds the record, or to catch a removed one);
  - `--clear` removes it; `--replace` changes it.
- **HTTPS certificates** (what makes the padlock appear) come from Caddy, the program in front of
  our app. Caddy gets a certificate the first time someone visits a new name, but only after asking
  our app "is this one of yours?" at `/api/caddy/ask`. The app says yes only to a firm's verified
  address or an existing firm's subdomain. So nobody can make us fetch certificates for other
  people's names, and we don't need a "wildcard" certificate (which would need a DNS provider
  account).
- **Caddy's settings** are in `deploy/Caddyfile`. It also passes each visitor's real IP address to
  the app (for the login rate limits) and blocks the "is this one of yours?" check from outside.
  It hasn't been run yet: there's no Caddy on this computer, and I didn't download one overnight.
  A test checks its key lines; it gets tried for real with the deploy task.
- **Before verification, the address shows nothing** (a "not found" page); after, it's the firm's
  portal with its own bar.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The CNAME points to the firm's own subdomain | Ties the address to that firm; the review found a shared target let a mistyped firm take another's address | One shared target (`portal.<our domain>`), as the docs first said |
| The owner sets and checks it with a command | The app isn't allowed to change the firms table (like the shifts line and brand) | An office screen and a background job (later) |
| Firm subdomains also get certificates on demand | No wildcard certificate, so no DNS provider account needed | A wildcard certificate |
| Only verified addresses are served | A mistyped or not-yet-pointed address must not get a certificate or show a portal | Serve as soon as it's saved |
| Links in messages stay on `acme.<our domain>` for now | Both addresses work; changing every link is its own step | Switch links now (parked) |

### What the review caught

- **My shifts didn't show on a custom address.** The home page only knew about subdomains, so a
  worker on `shifts.acme.co.uk` saw a "coming soon" page. Fixed, and the browser test now checks the
  home page too (it goes to the firm's login page; before verification, "not found").
- **A lock held during a DNS lookup.** The command held the firm's row locked while asking DNS; a
  slow answer would have stalled every write for that firm (incoming messages, logins). DNS is now
  looked up first, and the lock is a lighter kind that doesn't block other writes. (The branding
  command got the lighter lock too.)
- **Smaller fixes**:
  - the certificate check is blocked from outside (Caddy answers it with "not found");
  - the office log says which address was set, replaced or removed;
  - a test pins exactly what the new database function returns;
  - a test tidies up even if it fails;
  - the runbook says to use a plain CNAME, not a proxied or "flattened" one;
  - the Parking lot notes that health checks need deciding with the deploy.

### What the new tests prove

34 new tests and 2 browser tests:
- **host tests (updated)**: which web addresses might be a firm's own, and which are always
  refused (IP addresses, wrong ports, names under our own domain, malformed names).
- `tests/integration/custom-domain.test.ts` (11, real database):
  - only a verified address finds its firm, and only exactly;
  - the database refuses badly formed addresses and duplicates;
  - the certificate check says yes and no correctly;
  - the command saves, verifies, re-checks, unverifies, replaces, refuses and clears, and logs each
    change;
  - an address pointing at another firm's subdomain can't be verified.
- `tests/unit/deploy.caddyfile.test.ts` (4): Caddy asks the right address before any certificate,
  passes the real IP, and blocks the check from outside.
- `tests/e2e/custom-domain.spec.ts` (2): the browser visits `shifts.acme-events.test` (a made-up
  name mapped to this computer): "not found" before verification, Acme's portal with its bar
  after; the certificate check answers yes and no over the web.

### Parked, open, and things that need Dylan

- Later (in the Parking lot):
  - links in messages on the firm's own address;
  - a regular automatic re-check of each address;
  - an office settings section for it;
  - running `caddy validate` with the deploy;
  - deciding the health check's address.
- **To set one up for a real firm**: the runbook's new section, "A firm's own domain", has the steps.

### How to see it working

`npx playwright test tests/e2e/custom-domain.spec.ts` (stop `npm run dev` first).

## 2026-09-29: Phase 8, task 3: The AWS servers, ready to create (0.5 h, BLOCKED)

### Time

0.5 hours of Claude's working time (22:31 to 23:01 UTC), in the unattended overnight loop.
Phase 8 so far: 2.0 of its 18 to 28 hour estimate.

### Result

- **Blocked, not ticked.** Creating servers needs a real AWS account and costs money, which
  tonight's rules don't allow. Everything short of it is written, checked and committed; "Connect
  AWS" in the Parking lot and the runbook say how to do it.
- `scripts/verify.sh` printed `VERIFIED tree=ba39c0207f744985 e2e=true`. That covers:
  - the type checks and lint;
  - all 2516 tests (up from 2503);
  - the 47 browser tests;
  - the rule checks.
- The guardrails review found 3 things to fix first; all are done, with most of its suggestions
  (below). No auditor round (a blocked task can't be ticked).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

- **`deploy/lightsail.sh`**, one script Dylan runs once to create everything ShiftDesk needs in
  AWS Lightsail (Amazon's simple hosting), all in London:
  - **The app server**: Ubuntu 24.04, the cheapest plan with 2 processors and 4 GB of memory. It
    looks the plan up rather than trusting a fixed name, because Amazon renames them.
  - **Its firewall** (the rules for which connections are allowed in):
    - only ports 80 and 443 (web traffic) are open to the internet;
    - SSH, the remote login, works only from Lightsail's own browser console.
    It sets this the moment the server starts, then reads the rules back and stops if anything
    else is open.
  - **A static IP**: a fixed address for the domain's DNS records to point at.
  - **The database**: managed Postgres 16, not reachable from the internet, backed up every night.
    Its password is made by Amazon and never written into any file. The script also checks the
    database really is private and backed up.
  - **Before creating anything**, it shows the two monthly prices and waits for you to type `yes`.
  - **Running it again is safe**: it skips what already exists.
- **`deploy/cloud-init.sh`**, what the server does the first time it starts:
  - installs security updates, and then keeps installing them automatically;
  - restarts at 02:30 UTC when an update needs it;
  - installs Docker (which runs the app) from Docker's own website;
  - makes a folder only the administrator can read, for the app's settings and secrets.
- **The runbook** has a new section, "Set up AWS (once)", with 9 numbered steps:
  1. making the account safe (two-step login, a £50 spending alert, an everyday login that isn't
     the main one);
  2. a key that can only touch Lightsail in London;
  3. installing and 4. logging in the AWS command-line tool;
  5. running the script;
  6. adding the DNS records;
  7. keeping the database password safe;
  8. getting onto the server and checking the first boot finished;
  9. switching the key off afterwards.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | Needs a real AWS account and money | Tick with the script unrun |
| A script, not clicking through Amazon's website | The same result every time, and it can be checked | Console steps only (kept as a fallback) |
| SSH only from Lightsail's browser console | "Only 80 and 443 open" to the internet, while Dylan can still get in | SSH open to everyone |
| Show prices and ask for yes first | It costs money the moment it runs | Create straight away |
| The key only allows Lightsail in London | If it leaked, the damage is limited | Full admin rights |

### What the review caught

- **The first-boot script would have stopped at its first line.** Lightsail runs it with Ubuntu's
  basic shell, which doesn't understand one setting it used (`pipefail`). The server would have
  started without Docker or automatic updates, and nothing would have said so. The script is now
  written for the basic shell, and a test checks it with that shell.
- **Nothing checked what Amazon actually did.** The script now reads back the firewall and the
  database's settings, and stops if they're not right. It also applies the database settings
  straight away instead of at the next weekly maintenance.
- **The password command showed two values** (a date and the password) side by side, easy to
  copy wrongly. It now shows the password alone. The runbook also explains how to write a password
  with symbols in it into a database address.
- **Smaller fixes**:
  - the runbook's safety steps above (spending alert, everyday login, a key limited to Lightsail in
    London, switching it off afterwards);
  - installing the AWS tool outside the project folder;
  - waiting for the system's update lock on first boot instead of failing;
  - weekly database maintenance on a Tuesday, not Saturday night;
  - shell scripts always saved with Linux line endings.
- **For the deploy task**: SSH is closed to the internet, so the plan's "GitHub Actions logs in by
  SSH" won't work as written. This is noted in the Parking lot to decide there.

### What the new tests prove

13 new tests in `tests/unit/deploy.lightsail.test.ts`:
- **Both scripts**: they are valid, including under the basic shell for the first-boot one.
- **The main script**:
  - every call is pinned to London;
  - only 80 and 443 are open to the internet, and SSH only to the browser console;
  - the firewall is set first and read back;
  - the database is private and backed up, and checked;
  - the plans and prices come before a typed yes;
  - the password command shows the password alone.
- **No secret** (key, password, private key) is in either file.

### Parked, open, and things that need Dylan

- **Connect AWS** (Parking lot): follow the runbook's 9 steps, check the prices the script shows,
  then tick the task.
- For the deploy task: how deploys reach the server with SSH closed; every service must restart on
  its own after the nightly reboot.

### How to see it working

Nothing to see until it's run with a real account. `npx vitest run tests/unit/deploy.lightsail.test.ts`
runs its checks.

## 2026-09-29: Phase 8, task 4: Packaging the app and deploying it (0.6 h, BLOCKED)

### Time

0.6 hours of Claude's working time (23:03 to 23:41 UTC), in the unattended overnight loop.
Phase 8 so far: 2.6 of its 18 to 28 hour estimate.

### Result

- **Blocked, not ticked.** A deploy needs the server (the AWS task, blocked on an account), and the
  workflow that builds the image only runs on `main`, which the overnight rules never touch. I also
  didn't download the base images to build locally; a new CI job builds the image on GitHub on the
  next push, so you'll see there whether it builds.
- `scripts/verify.sh` printed `VERIFIED tree=714a804035bdfb86 e2e=true`. That covers:
  - the type checks and lint;
  - all 2542 tests (up from 2516);
  - the 47 browser tests;
  - the rule checks.
- The guardrails review found 5 things to fix first; all are done, with most of its suggestions
  (below). No auditor round (a blocked task can't be ticked).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

- **The image** (`Dockerfile`): a packaged copy of the app (a "container image") that runs the same
  way anywhere Docker runs. One image does three jobs:
  - the web app;
  - the job worker (it sends messages and runs timers);
  - the one-off "migrate" step, which updates the database's structure.
  It runs as an ordinary user, not the administrator. Its code belongs to the administrator, so the
  app can't change itself. It contains no passwords.
- **The server's services** (`deploy/docker-compose.yml`), which says how the pieces run together:
  - **Caddy** is the only thing reachable from the internet (ports 80 and 443). The web app is
    only reachable through it.
  - **Each piece gets only the secrets it needs.** The database's owner password goes only to the
    migrate step; the web app and worker never have it.
  - **Everything restarts by itself**, for example after the server's nightly security reboot.
  - **The worker stays switched off for now.** In production it refuses to start until the real
    Twilio sender exists, by design, so that messages are never quietly printed instead of sent.
    You switch it on after "Connect Twilio" (one setting).
- **A health check** (`/api/health`): says "ok" when the web app can reach its database. Docker
  uses it to know the app is really up. It says nothing else (it's public). Its answer is reused
  for 5 seconds, so repeated calls can't slow the app down.
- **Deploys "pull" rather than "push".** The remote login (SSH) is closed to the internet, so
  nothing logs into the server:
  1. When you merge to `main` and the checks pass, GitHub builds the image and stores it in
     GitHub's own image registry.
  2. Every 2 minutes, a small script on the server (`deploy/deploy.sh`) checks for a new image.
     If there is one, it updates the database, starts the new version and waits until it's
     healthy.
  3. It never deploys between 05:30 and 09:00 UK time, because that's event mornings. A fix that
     can't wait can be run by hand with `--now`.
  4. If the database update fails, the old version keeps running.
- **Rolling back**: set the version to an older one in the server's settings file and run
  `deploy.sh --now --no-migrate`.
- **`deploy/env.example`**: a list of every setting the server needs, with where each comes from.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | No server yet, and deploys only happen from `main` | Tick with nothing deployed |
| The server pulls new versions (a timer) | SSH is closed to the internet; nothing needs opening | GitHub logging in by SSH (needs thousands of addresses opened); a VPN service (another account) |
| One image for all three jobs | They need the same code | Separate slimmer images (later, if size matters) |
| One settings file, each piece given only its part | Secrets live in one protected file; the web app still never sees the owner's password | A file per piece |
| No automatic deploys 05:30–09:00 UK | The runbook's rule, enforced instead of remembered | Deploy any time |
| The worker off until Twilio | It can't start in production before then, and would otherwise restart for ever | Let it keep crashing |

### What the review caught

- **Someone else's pull request could have been deployed.** GitHub runs the checks on pull
  requests too, including from other people's copies of the repo. A branch there named "main"
  would have passed the first version's filter and been published to the server, with production
  passwords. Now only a push to this repository's own `main` counts.
- **An older version could overwrite a newer one.** If two merges' checks finished in the wrong
  order, the older one would have been deployed last. Now the "latest" label only moves to the tip
  of `main`.
- **A failed deploy was never tried again**, and it left the new, not-yet-migrated version waiting
  to start by accident. Now the script compares what's actually running with the chosen version,
  so it retries.
- **Following the settings list, nothing would have deployed.** The empty messaging setting made
  the whole file invalid. Now the worker is switched off properly until Twilio, and the web app
  and Caddy run.
- **The documented rollback couldn't work.** An older version's database step fails against a
  newer database, and it was blocked on event mornings. Now there's `--no-migrate` and `--now`.
- **Smaller fixes**:
  - it waits for the new version to be healthy before saying "Deployed";
  - a stuck deploy times out after 20 minutes;
  - the worker gets 45 seconds to finish jobs (a job cut short could send a message twice);
  - the health answer is reused briefly;
  - no manual trigger that skips the checks;
  - secret files in any folder are kept out of the image;
  - only the app image is fetched each time.
- **Parked for you**: whether the database needs encrypted connections (TLS), to check on first
  connection, and pinning the build's exact versions.

### What the new tests prove

26 new tests:
- `tests/unit/deploy.compose.test.ts` (22), using Docker's own reader of the compose file (nothing
  is downloaded or built):
  - who gets which secret, and that only Caddy is reachable;
  - restarts after a reboot;
  - the worker is off until switched on;
  - missing settings are refused, and the settings list covers everything;
  - the image's user and ownership, and no secrets in it;
  - the deploy script's quiet hours, `--now`, retries, migrate-first and health wait;
  - the timer, and the GitHub workflow's conditions.
- `tests/integration/health.test.ts` (3): healthy with the database; not healthy (quickly) without
  it; the answer reused and never checked twice at once.
- The proxy test: `/api/health` is let through for Docker's check, nothing else.

### Parked, open, and things that need Dylan

- **Connect the deploy** (Parking lot):
  - check the new "docker" CI job is green;
  - merge `build/overnight` into `main` when you're happy (the overnight rules never touch `main`);
  - follow the runbook's "Deploy" steps once the server exists;
  - decide the database's TLS.
- **The worker in production** waits for "Connect Twilio".

### How to see it working

`npx vitest run tests/unit/deploy.compose.test.ts` runs the checks. The real thing happens after
"Connect AWS" and "Connect the deploy".

## 2026-09-30: Phase 8, task 5: Backups, alarms and the restore drill (0.5 h, BLOCKED)

### Time

0.5 hours of Claude's working time (23:44 to 00:15 UTC), in the unattended overnight loop.
Phase 8 so far: 3.1 of its 18 to 28 hour estimate.

### Result

- **Blocked, not ticked.** Backups, restores, budgets, alarms and uptime checks all live in AWS or
  an outside service, which tonight's rules don't allow. Everything short of them is written,
  checked and committed; "Connect monitoring" in the Parking lot says what to do.
- `scripts/verify.sh` printed `VERIFIED tree=04d69b486eb67773 e2e=true`. That covers:
  - the type checks and lint;
  - all 2557 tests (up from 2542);
  - the 47 browser tests;
  - the rule checks.
- The guardrails review found 3 things to fix first; all are done, with its suggestions (below).
  No auditor round (a blocked task can't be ticked).
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

- **Backups** were already switched on by the AWS script (every night), which also checks they are.
  The £50 spending alert is already step 1 of "Set up AWS (once)".
- **`deploy/alarms.sh`**: Amazon's own alarms for the server and database. They email you when
  something is wrong, and again when it's fixed:
  - the server stops responding for 10 minutes;
  - the server's processor is over 90% busy for 15 minutes;
  - the server has used up its "burst" allowance. Cheaper plans run fast in short bursts, then
    slow down, so this is the one that catches a server crawling on a busy night;
  - the database has less than 8 GB of space left;
  - the database's processor is over 90% busy.
  Because they watch from outside, "the server is down" still gets through. If you miss the
  confirmation email, running it again resends it.
- **`deploy/restore-drill.sh`**: the monthly check that the backups actually work:
  - it restores the latest backup into a separate practice database (`shiftdesk-db-drill`) without
    touching the real one;
  - you check it's recent (the runbook gives the exact check: the newest logged event should be
    minutes old), then delete it;
  - deleting asks you to type its name, and it will only ever delete the practice database.
- **An uptime check**: the runbook explains setting up a free outside service that visits
  `/api/health` every 5 minutes and alerts your phone if the app stops answering.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | All of it is AWS or an outside service | Tick with scripts unrun |
| Amazon's alarms for "down" and resources | They watch from outside the server, and email for free | Something on the server itself (it can't alert when the server is down) |
| An outside uptime check as well | It checks the app itself answers, from the internet, with a phone app | Only Amazon's alarms (they see the machine, not the app) |
| The drill restores to a separate database | Tests the backup without touching the real one | Restoring over the real database (never) |

### What the review caught

- **An old practice copy could be reused.** If last month's practice database hadn't been deleted,
  the script would have "used" it: checking an old copy (and paying for it all month). Worse, if
  someone ever restored a real emergency under the practice name, a later run could have deleted
  production. Now:
  - it only reuses a copy made in the last 3 hours;
  - deleting needs the name typed;
  - the runbook says never to use the practice name for a real restore.
- **Every error looked like "not there".** With the command-line key switched off (as the runbook
  recommends between uses), "delete the practice database" would have said "there's nothing to
  delete" while it kept costing money. Now both scripts check they're logged in first, and only
  Amazon's "not found" counts as not there; anything else stops with the real error.
- **A runbook command needed `sudo`** to work on the server.
- **Smaller fixes**:
  - the restore check looks at how recent the data is, not a count that rarely changes;
  - the burst-capacity alarm was added;
  - the storage warning comes earlier (8 GB);
  - the confirmation email is resent until it's clicked;
  - a plain HTTPS uptime monitor (simpler than a keyword one);
  - the test puts a fake `aws` command in place, so it can never reach Amazon even on your laptop.

### What the new tests prove

15 new tests in `tests/unit/deploy.monitoring.test.ts`:
- both scripts are valid, work only in London, and check the login;
- only "not found" counts as not there;
- the alarms and their thresholds;
- the drill restores to a private separate database, reuses only a fresh one, and deletes only the
  practice database after its name is typed;
- no secrets in either file;
- running the scripts in the test never reaches the real `aws` command.

### Parked, open, and things that need Dylan

- **Connect monitoring** (Parking lot), after "Connect AWS":
  1. run `deploy/alarms.sh` and click the confirmation email;
  2. set up the uptime check;
  3. do a first restore drill;
  4. then tick the task.
- The app's own error alerts (jobs that keep failing, and similar) come with the next "alerts" task.

### How to see it working

`npx vitest run tests/unit/deploy.monitoring.test.ts`. The real thing needs AWS.

## 2026-09-30: Phase 8, task 6: When the app doesn't answer, calls go to the manager (0.5 h, BLOCKED)

### Time

0.5 hours of Claude's working time (00:18 to 00:46 UTC), in the unattended overnight loop.
Phase 8 so far: 3.6 of its 18 to 28 hour estimate.

### Result

- **Blocked, not ticked.** It's a setting on each number in Twilio's website, which tonight's rules
  don't allow. Everything short of it is built, checked and committed; "Connect Twilio" step 10
  explains setting and checking it.
- `scripts/verify.sh` printed `VERIFIED tree=1857eab3f497508c e2e=true`. That covers:
  - the type checks and lint;
  - all 2562 tests (up from 2557);
  - the 47 browser tests;
  - the rule checks.
- The guardrails review found 2 things to fix first; both are done, with its suggestions (below).
  No auditor round.
- Committed on `build/overnight`. The push result is in `docs/overnight-log.md`.

### What was built

If our app is down or too slow when someone rings a firm's shifts line, Twilio can play a fallback
by itself. We give it a small set of instructions (a "TwiML Bin") for each firm. The caller hears:

1. "Sorry, our system isn't answering right now. Putting you through to Acme Events."
2. The manager's phone rings, for up to 30 seconds. Their own voicemail usually answers first.
3. When that call ends: "If nobody answered, please call again in a few minutes. Goodbye."

A new command makes the instructions for a firm: `npm run -s firm:call-fallback -- --name "Acme
Events" --phone "07700 900123"`. It prints one line to paste into Twilio. It checks the number, and
warns if a UK number is the wrong length. The words are in the message doc and tests hold the code
to them.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | It's a Twilio setting | Tick with nothing set |
| Twilio plays it itself (a bin per firm) | It must work when our app doesn't, so it can't depend on the app | Anything served by our app |
| The name is typed into the command | It runs on your computer; the live database is only reachable from the server | Reading the name from the database |
| A closing line true however the call went | Twilio can't tell a finished call from an unanswered one here | "Nobody could take your call" |

### What the review caught

- **The closing line could be untrue.** It said "Sorry, nobody could take your call" even after the
  manager had answered and hung up, or after their voicemail took a message, because Twilio plays
  the next line whenever the call ends. It also said "or message us on this number", but messages
  go to the same app that isn't answering. Now it says "If nobody answered, please call again in a
  few minutes. Goodbye."
- **A safer check.** Step 10 now says:
  - do the check at a quiet time, and tell the manager first;
  - ring from a phone that isn't the manager's;
  - let it ring out once;
  - expect a Twilio error notice during the test;
  - put the setting back exactly afterwards, and check that too.
- **During an outage**, the runbook now says to enter any cancellations the manager took by phone
  once the app is back (so their notice is recorded), to re-make the instructions when the manager
  changes, and to tell the resourcers that messages aren't being answered.
- **Smaller fixes**:
  - curly brackets in the name are refused (Twilio would fill them in);
  - a warning for UK numbers of the wrong length;
  - a tidier type.

### What the new tests prove

5 new tests:
- **The instructions**: exactly what's played, safe with any firm name, and only a proper number
  dialled.
- **The command**: it prints them, and refuses a bad number, a missing value, an unknown option or
  a name with curly brackets.
- **The words**: they match the message doc.

### Parked, open, and things that need Dylan

- **Connect Twilio step 10**: set a fallback bin for each firm's number, check it as the step
  describes, then tick the task.

### How to see it working

`npm run -s firm:call-fallback -- --name "Acme Events" --phone "07700 900123"` prints the line.

## 2026-09-30: Phase 8, task 7: GDPR: a worker's data, deleting a worker, the firm's data, the nightly purge (1.3 h)

### Time

1.3 hours of Claude's working time (00:48 to 02:07 UTC), in the unattended overnight loop.
Phase 8 so far: 4.9 of its 18 to 28 hour estimate.

### Result

- **Ticked.** The independent auditor (the `claims-auditor` agent, which checks the work only
  from what's on disk) said `VERDICT: DONE`.
- `scripts/verify.sh` printed `VERIFIED tree=53648885b0073fdf e2e=true`: typecheck, lint, 2611 tests
  (153 files), 48 browser tests (e2e) and the invariants all passed. The first run failed two
  tests; the causes and fixes are below.
- The commit and push are recorded in `docs/overnight-log.md`.

### What was built, in plain words

GDPR (the UK's data protection law) gives workers two rights this task covers: to get a copy of
their data, and to have it deleted. Firms also need to be able to take all their data away.

- **A "Data requests" page** for the firm's admins (not resourcers or payroll). The office
  dashboard links to it as "Data requests (download or delete)".
  - **Find a worker** by part of their name or their mobile number (written any UK way).
  - **Download their data** as JSON (a structured file for computers) or CSV (a spreadsheet that
    opens in Excel). It holds everything the firm keeps about them: their details, licences, days
    off, bookings, offers, requests, reminders, pay lines, pay queries, messages to the shifts line
    (including ones from their number before we knew it was them), the action log's rows about
    them, and when they logged in. It never includes login secrets or anyone else's data.
  - **Delete their personal details.** You tick "I understand this can't be undone", then press
    the button. The worker's name, mobile, email, licences, days off, messages, logins and phones
    go, and so does anything typed about them (their notes, a colleague they'd swap with, the
    office's replies, pay query details, a typed cancellation reason). What stays is their shift
    history (bookings, offers, cancellations with notice hours, pay lines), attached to an
    anonymous "Deleted worker" record. That history is the firm's evidence for the notice report
    and payroll, and it holds no name or number. The delete is refused while they're booked on a
    shift that hasn't ended: cancel those first, with a reason.
- **"Download all your data"** for the firm: one JSON file with every table, minus login secrets.
- **A nightly clean-up** (a "purge", at 03:30 UK time for each firm). It deletes messages to and
  from the shifts line after 90 days, removes words typed into requests after 90 days, and clears
  old login links, codes and sessions. It writes one line in the action log each night saying how
  much it removed.
- Every download, deletion and purge is in the action log, under a new "Data requests and
  deletion" group.

Key facts:
- The app's database login still can't delete messages directly. Two small database functions
  (run as the database's owner, but only inside the current firm) are the only ways: one erases a
  worker and deletes their messages, the other only deletes messages over 90 days old.
  (Corrected in Phase 10 task 18: at the time it also deleted a newer reply to an old message;
  since task 13 a reply keeps its own age, and the keep-time is each firm's setting, 90 days unless
  changed.)
- A database rule (a "check") makes an erased worker's record exactly "Deleted worker" with no
  mobile, email or staff id, so nothing can half-erase a record. (Corrected in Phase 10 task 18:
  this said "or bring back a record". The check doesn't stop that: setting the deleted mark back
  to empty, with a new mobile, would pass it, as the app's database login may still change worker
  records. No app code does it.)
- New migration: `drizzle/0026_gdpr.sql`. New code: `src/lib/gdpr/`, `src/app/office/data/`.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| "Delete" erases the person and keeps an anonymous record | Shift history is legal evidence, and the database protects it on purpose | Deleting everything (would break the notice report) |
| Admins only | Deleting people and downloading everything is the owner's call | Resourcers too |
| Refused while booked on a future shift | Someone has to cancel it properly (with a reason and the notice logged) | Cancelling it automatically |
| Messages deleted only through two narrow database functions | A mistake elsewhere in the app can't delete messages | Letting the app delete messages |
| The 12-month deletion of the action log is **not built** | The log is deliberately append-only (a test forbids deleting from it). Changing that is Dylan's decision, and nothing is a year old until a year after the pilot starts | Changing the log's protection tonight |
| Login leftovers kept 7 days (links, codes) and 30 days (sessions) | Those periods were already in `docs/data-model.md` | Shorter periods (my first draft) |

### What the review caught

The `guardrails-reviewer` (a read-only agent that checks the golden rules) found 3 things that had
to be fixed first:
- **Typed text survived a delete**: a worker's "Something else: …" cancellation note, and a
  colleague's name in a swap request. Now "Something else: …" becomes "Something else", other typed
  reasons are replaced, and the swap name is removed (also after 90 days).
- **One database function trusted a phone number handed to it**, so a bug could have deleted
  other people's messages. It now reads the number from the worker's own record while erasing it,
  and works only once per worker.
- **The worker's download missed some action-log rows** about them (for example, the office
  answering their request). It now uses the same search as the action log's worker filter.

Also done from its suggestions: an offer being sent at the moment someone is deleted is now
skipped; a change notice queued for a deleted worker is logged as skipped; two wordings fixed.
The rest is parked (below).

### Why the first verify failed

- A pinned test says offer candidates come from exactly one database query in one file. The new
  "skip anyone just deleted" check added a second query there. It only removes people, never adds
  any, so it moved to its own file. The test is unchanged.
- An older browser test (marking who worked) sometimes found its text twice: in the confirmation
  and in the shift's history, which appears when the page refreshes. It depended on timing. The
  test now looks for the confirmation's exact words.

### What the new tests prove

49 new tests, plus one browser test:
- **Worker download**: a row from every table about them, and nothing about a colleague, another
  firm or any login secret. The CSV has a byte order mark (so Excel reads accents), and formulas
  can't run. Admins only. Logged.
- **Delete**: refused while booked; removes everything personal and keeps the anonymous history;
  a second go says "already"; a notice queued before the delete is never sent; the database refuses
  a half-erased record; the database function refuses another firm's worker, no firm, and a second
  go.
- **Firm download**: every table's rows for this firm only, no secrets; a new table must be added
  to the download or listed as left out.
- **Nightly purge**: each kind goes only once it's old enough (tested a day either side), only in
  its own firm, logged every night, and nothing more the second time.
- **Browser**: an admin finds a worker, downloads both files, deletes them (only after ticking the
  box), and the firm's download shows the anonymous record.

### Parked, open, and things that need Dylan

In PLAN.md, "GDPR follow-ups":
- **Dylan to decide**: when (and whether) to delete action-log rows, requests and offers after 12
  months. It needs the log's protection changed on purpose.
- **Dylan to confirm**:
  - only admins can delete;
  - a deleted worker's pay lines are kept as payroll evidence;
  - security firms may have to keep licence-check records after someone leaves (BS 7858, SIA rules).
    If so, the delete should keep them.
- Before connecting Twilio: Twilio keeps its own copy of messages; add a step to delete a worker's
  messages there too.
- Smaller items: two short timing windows, skipped-notice logging for request and pay answers,
  streaming very large firm downloads, and a firm-wide delete script.

### How to see it working

1. Start the app: `npm run dev`.
2. Go to `http://acme.localhost:3000/office/login`, type `acme.admin@example.com` and press
   **Send me a link**. The login link is printed in the terminal running `npm run dev` (messages
   are printed, not sent, in development). Open it and press **Log me in**.
3. On the dashboard, click **Data requests (download or delete)**.
4. Type part of a worker's name and press **Find**, then open them.
5. Try **Download (JSON)** and **Download (CSV, opens in Excel)**.
6. Deleting a seeded worker changes your local demo data: `npm run db:reset` then
   `npm run db:seed` puts it back.

## 2026-09-30: Phase 8, task 8: Alerts to your phone (0.5 h, BLOCKED)

### Time

0.5 hours of Claude's working time (02:10 to 02:43 UTC), in the unattended overnight loop.
Phase 8 so far: 5.4 of its 18 to 28 hour estimate.

### Result

- **Blocked, not ticked.** Getting a message to your phone needs an outside service (a text
  through Twilio, or a phone app), which tonight's rules don't allow. Every check is built and
  tested; today each alert is a line in the server's log.
- `scripts/verify.sh` printed `VERIFIED tree=c4b97c61a8d49bfe e2e=true`: typecheck, lint, 2638
  tests (155 files), 48 browser tests and the invariants all passed.
- No auditor round (blocked tasks aren't audited). The commit is recorded in
  `docs/overnight-log.md`.

### What was built, in plain words

The app now watches itself and writes "ShiftDesk alert: …" when something needs you. It never puts
a name, phone number or message in an alert: only counts, queue names, a firm's short name and error
codes.

- **Every 5 minutes, the worker** (the background process) looks back over the last hour for:
  - **jobs that failed** after their last retry (a "job" is a background task: sending an offer,
    a reminder, a notice…). Example: "3 jobs failed after the last retry in the last hour
    (offer-wave 2, shift-reminders 1)."
  - **a firm's rota sheet sync failing** for over 30 minutes (one hiccup doesn't count).
  - **a firm's WhatsApps and texts failing to send**: more than 5% of at least 20 in the hour.
  - **the web app's health check** failing, asked from inside the server (three tries, 5 seconds
    apart).
- **The web app counts bad Twilio signatures** (a "signature" proves a request really came from
  Twilio). 20 in an hour means the Twilio key changed, or someone is probing.
- **Each problem alerts at most once in any hour**, so an ongoing problem doesn't flood you.
- **`npm run -s ops:test-alert`** sends a test alert, to check alerts reach you.
- The runbook has a new table, "Alerts from the app": what each alert means and what to do.

Key facts:
- New code: `src/lib/ops/` (the checks, the words, where alerts go, the bad-signature counter),
  and two background queues, `ops-alerts-tick` and `ops-alert`.
- New settings: `ALERTS_TRANSPORT` (`console`, the default; `none` in tests, refused in
  production) and `HEALTH_CHECK_URL` for the worker (set in `deploy/docker-compose.yml`).
- The server being down altogether can't be reported by the server itself: that's the outside
  uptime check's job (the "Monitoring and alerts (once)" runbook).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | A phone alert needs an outside service | Tick with log lines |
| No personal data in alerts | They'll leave the system as texts | Showing which worker was affected |
| No new database table; "once an hour" via the job queue | Every table must belong to a firm, and alerts are about the whole platform | A new table |
| Bad signatures counted in the web app's memory | The web can only queue jobs for a firm, and a database row per bad request would let anyone fill the database | Writing each one down |
| "Twilio errors" means sends Twilio refused | That's what's recorded until Twilio's delivery receipts are connected | Waiting for receipts |

### What the review caught

The `guardrails-reviewer` found 4 things to fix first:
- **One failure stopped every alert.** If the app couldn't list the firms (a database problem),
  the whole check stopped, every 5 minutes, so nothing was ever reported. Now the other checks
  still run.
- **A long alert was dropped.** With many queues failing, the text was too long and the alert
  wasn't sent. Now it names the 5 worst and says how many more.
- **"Once an hour" was really "once per clock hour".** A problem at 10:50 alerted again at 11:00.
  Now it checks the last 60 minutes.
- **The failure rate was diluted.** Login codes counted as sends, but their failures are never
  recorded as failures, so hundreds of them could hide real problems. Now only senders that record
  their failures count.

Also done:
- one sync hiccup no longer alerts;
- production can't switch alerts off;
- the web doesn't wait for an alert to go;
- a firm name that looks like a phone number doesn't block its alerts;
- a worker who turned texts off doesn't count as a Twilio failure;
- the test-alert command;
- runbook corrections.

### What the new tests prove

27 new tests:
- **The rules**: each threshold exactly at its edge (5% of 20 isn't an alert; 10% is), the
  words, and that an alert containing a phone number or email is refused.
- **The bad-signature counter**: the 20th in an hour alerts, then not again for an hour; old
  counts are forgotten; a broken sender is logged, not crashed.
- **The health check**: three tries, the reason given, a wrong answer counts as failing.
- **On the real database**: a firm's counts only ever include its own messages, and only the
  right kinds; the sync rule; failed jobs by queue; no repeat within an hour, even across the
  clock hour; one part failing never stops the rest.
- **Settings**: alerts can't be switched off in production.

### Parked, open, and things that need Dylan

- **Connect alerts to your phone** (PLAN.md Parking lot, 6 steps): after "Connect Twilio", a small
  text sender, one more Twilio number for the platform, two settings, then the test command.
- Ops alerts follow-ups: checking the worker itself is alive, a queue backlog alert, Twilio's
  delivery receipts and numbered error codes, a command to retry failed jobs, and the weekly job
  summary.

### How to see it working

`npm run -s ops:test-alert` prints the alert line the app writes:
`{"level":"error","msg":"ops alert","alert":"test",…,"text":"ShiftDesk alert: a test alert. If you can read this, alerts reach you."}`

## 2026-09-30: Phase 8, task 9: Trying the deploy, rollback and restore runbooks (0.2 h, BLOCKED)

### Time

0.2 hours of Claude's working time (02:45 to 03:00 UTC), in the unattended overnight loop.
Phase 8 finished at 5.6 of its 18 to 28 hour estimate: 3 tasks done, 6 blocked on outside
services.

### Result

- **Blocked, not ticked.** "Tried once for real" needs the real server, the database's snapshots
  and GitHub's image registry, which tonight's rules don't allow.
- `scripts/verify.sh` printed `VERIFIED tree=a8127bff4223303e e2e=true` (2638 tests, 48 browser
  tests). Only documents changed.
- No auditor round (blocked). The commit is recorded in `docs/overnight-log.md`.

### What was done, in plain words

A "runbook" is a step-by-step guide for a job you don't do often. These three (deploying a new
version, going back to an older one, and restoring the database from a backup) had only ever been
written, never run. So:

- **An independent check.** A separate agent (the `doc-fact-checker`, which only reads) compared
  every command and claim in them with the scripts they drive. It checked 19 claims and found two
  mistakes a beginner would have hit:
  - **Rollback** gave commands without becoming the server's administrator first ("root"), so
    they would have failed with "Permission denied". It now starts with `sudo -i`.
  - **Restore** said to "restart" the app after changing the database address. A restart keeps the
    old settings, so the app would have quietly stayed on the old database. It now says
    `docker compose up -d`, which reads the new ones, and explains which part of each address to
    change.
- **A trial plan.** A new runbook section, "Try the runbooks for real (once, before the pilot's
  data)": the four tries in order, what "worked" looks like for each, and a table to fill in. It's
  meant for before the pilot firm's real data arrives, when the database holds only demo firms, so
  a restore that goes wrong costs nothing.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | It literally means running them on the real server | Ticking after a paper check |
| Try them before the pilot's real data | A restore trial points the app at a restored copy; safest with nothing real in it | Trying them after go-live |

### Parked, open, and things that need Dylan

- **Try the runbooks for real** (PLAN.md Parking lot): after "Connect AWS" and "Connect the
  deploy", follow the new section, fill in its table, tell Claude what went wrong, then tick.
- On the first restore, check that Lightsail kept the database's user names and passwords (the
  restore steps rely on it; it couldn't be checked from here).

### How to see it

`docs/runbooks.md`: "Rollback", "Restore the database", and the new "Try the runbooks for real".

## 2026-09-30: Phase 9, task 1: The pilot onboarding checklist, made usable (0.6 h)

### Time

0.6 hours of Claude's working time (03:02 to 03:37 UTC), in the unattended overnight loop.
Phase 9 so far: 0.6 of its 10 to 15 hour estimate.

### Result

- **Ticked.** The independent auditor said `VERDICT: DONE`.
- `scripts/verify.sh` printed `VERIFIED tree=beacf347bff0b106 e2e=true`: 2653 tests (156 files),
  48 browser tests, all passing.
- The commit is recorded in `docs/overnight-log.md`.

### What was built, in plain words

The onboarding checklist (the steps to get a pilot firm going) was just a list. Nothing in the app
could actually create a real firm (only the demo data could), add office staff, or change a firm's
settings. Now four commands do, for you (the "owner" of the platform):

- **`npm run firm:create`** sets up a new firm: its web address name (`acme` becomes
  `acme.<our domain>`), its name, its sector (security, rail, construction or cleaning, which
  brings the usual licence rules), and its first admin. If it stops half-way, running it again
  finishes the job.
- **`npm run firm:office-user`** gives someone office access: a resourcer, payroll, or another
  admin.
- **`npm run firm:settings`** shows the settings the firm agrees during onboarding (who gets open
  shifts first, how soon a shift counts as urgent, when the office is emailed about a gap, what
  counts as short notice, quiet hours) and changes them. A value is only accepted if the app would
  really use it; anything else is refused and nothing changes.
- **`npm run firm:check`** prints the checklist for a firm from its own data: `[x]` done, `[ ]` to
  do, `[?]` confirm yourself (things the app can't see, like the signed agreement). It warns when a
  role has no licence rule, because then nobody can take those shifts. It only shows counts and
  settings, never anyone's name, number or email.

And:
- A new runbook section, "Onboarding a pilot firm", goes through all 13 steps in order: who does
  each, the exact command or page, and what "done" looks like.
- A one-off "owner" service in the server's setup (Docker Compose), so these commands can run on
  the live server without typing the database password on a command line.
- Every change they make is in the office's action log.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Commands for you, not office pages | Creating firms is the platform owner's job, and the app's own database login can't change firms (by design) | A sign-up page (much later: "self-serve onboarding") |
| Settings checked by reading them back through the app's own code | Each part of the app has its own limits and quietly uses a default if a value is wrong; reading back is the only sure check | A separate list of limits (could drift) |
| Only the settings the checklist names | Keep to onboarding | Every setting |
| The check prints counts only | Terminal output gets pasted anywhere | Listing workers by name |

### What the review caught

The `guardrails-reviewer` found 2 things to fix first:
- **The firm was saved without its log entry.** The "firm created" line was written in a later
  step; if that step failed and nobody re-ran it, a live firm had no log at all. Now they're saved
  together.
- **The server command put the database password on the command line**, where other programs on
  the server could see it while it ran, and it broke if the settings file used quotes. Now the
  one-off "owner" service reads the settings file itself.

Also done:
- two setups finishing the same half-made firm at once give only one admin;
- the settings log keeps the old and new values (to settle a dispute about what applied on a given
  day);
- slugs are lowercased everywhere;
- the two database logins are checked to be the same database;
- old or cancelled shifts no longer make a role look "in use";
- no emails are echoed;
- a test that could fail by chance (2 in 1,000) was fixed.

### What the new tests prove

15 new tests:
- **Creating a firm**: what's created and logged, every bad input, a taken name, finishing a
  stopped setup, and two at once.
- **Office users**: adding them, logging, an existing email left alone.
- **Settings**: what the app reads, good values saved with old and new values logged, and every
  kind of bad value refused with nothing saved.
- **The check**: a brand-new firm, a firm with real-looking data (including a role with no rule),
  another firm's data never counted, and no personal details printed.
- **The server setup**: the owner service only runs when asked, has only the logins it needs, and
  opens no ports.

### Parked, open, and things that need Dylan

In PLAN.md, "Onboarding follow-ups":
- a shorter way to run owner commands on the server;
- office screens for users and settings;
- the rest of the settings;
- a place to tick the agreement and dry run;
- more explanation in `firm:settings`.

The runbook's server command hasn't been tried yet: it's part of "Try the runbooks for real".

### How to see it working

On your computer, after `npm run db:seed`:
1. `npm run -s firm:check -- --firm acme` prints Acme's checklist.
2. `npm run -s firm:settings -- --firm acme` shows its settings.
3. `npm run -s firm:create -- --slug trial --name "Trial Events" --sector security --admin-email
   trial.admin@example.com --admin-name "Trial Admin"` makes a test firm in your local database
   (`npm run db:reset` then `npm run db:seed` removes it again).

## 2026-09-30: Phase 9, task 2: Importing real data only after Gate B (0.2 h, BLOCKED)

### Time

0.2 hours of Claude's working time (03:40 to 03:51 UTC), in the unattended overnight loop.
Phase 9 so far: 0.8 of its 10 to 15 hour estimate.

### Result

- **Blocked, not ticked.** The task is to import a real firm's workers, licences and shifts,
  which can only happen once a firm has signed its agreement and data protection agreement
  ("Gate B"), and tonight's rules forbid real personal data.
- `scripts/verify.sh` printed `VERIFIED tree=2a7f44229830d260 e2e=true` (2655 tests, 48 browser
  tests).
- No auditor round (blocked). The commit is recorded in `docs/overnight-log.md`.

### What was built, in plain words

The import command (`npm run import`) now enforces the rule itself. Against any database that
isn't on your own computer (so, the live one), saving (`--apply`) is refused unless you add
`--agreement-signed <slug>` and type the firm's short name again. That's you saying, on the
record, that the agreement and data protection agreement are signed for that firm. A test run
(without `--apply`), and anything on your own computer (fake data only), work as before.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | It needs a signed firm and real data | Importing fake data and ticking |
| A typed confirmation, not a record in the database | The paperwork lives outside the app; a record would only be as true as whoever typed it, and it would need a database change | A "date the agreement was signed" field (parked) |

### What the new tests prove

2 new tests: a test run or your own computer's database is never asked; saving to a live database
needs exactly the firm's short name (any capitals, spaces around ignored), and anything else
(nothing, another firm's name, an empty value) is refused.

### Parked, open, and things that need Dylan

- **Import the pilot firm's real data** (PLAN.md Parking lot): only after the paperwork is signed;
  a dry run first, then `--apply --agreement-signed <slug>`; then `firm:check` shows the result.
- To decide on the first real import: how to get the spreadsheet onto the server, and deleting it
  afterwards.

### How to see it

`docs/runbooks.md` "Importing workers, credentials or shifts from a spreadsheet", step 3.

## 2026-09-30: Phase 9, task 3: The privacy notice wording for the firm (0.3 h, BLOCKED)

### Time

0.3 hours of Claude's working time (03:53 to 04:09 UTC), in the unattended overnight loop.
Phase 9 so far: 1.1 of its 10 to 15 hour estimate.

### Result

- **Blocked, not ticked.** The task says "supplied to the firm", and there's no firm yet. The
  wording is written and checked, ready to send.
- `scripts/verify.sh` printed `VERIFIED tree=23a747cc4a87bd59 e2e=true` (2655 tests, 48 browser
  tests).
- No auditor round (blocked). The commit is recorded in `docs/overnight-log.md`.

### What was built, in plain words

A "privacy notice" is what an employer publishes to tell staff how their information is used. The
firm is responsible for its own (in data protection terms it's the "controller"; we're its
"processor"). So `docs/privacy-notice.md` is what you send the firm to adapt:

- **A short line** for its staff handbook or contract: messages may be handled by automated
  systems, and anyone can ask for a person to review a decision about their shifts.
- **A section for its privacy notice**, covering:
  - what the app keeps about each worker, and why;
  - that messages to the shifts line are kept 90 days (strangers' too);
  - what the AI does (sorts a message's topic, and writes payroll a one-line summary) and doesn't
    do (decide anything about shifts, licences or pay);
  - the copy of My shifts kept on the phone;
  - the firm's logo loading from its own website;
  - who else handles the data, and where;
  - how long things are kept;
  - staff rights, including exactly what a deletion keeps.
- **Notes for you** on each blank to fill in, and the lines to keep only if they apply.

It says it's not legal advice: a solicitor should read it once with the terms and DPA.

Because a privacy notice that promises more than the app does is worse than none, a separate
agent (the `doc-fact-checker`) compared about 36 claims with the code. It found 4 that said too
much, all fixed:
- the deletion wording now names the one thing that stays in the permanent log (a reason the
  office typed when placing someone despite a rule);
- it says pay records stay (without the name);
- the AI is described as "once it's switched on" (it isn't connected yet);
- the payroll summary's list of facts includes the rate paid.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked | "Supplied to the firm" needs a firm | Ticking once the text exists |
| A suggestion for the firm to adapt, not a page in the app | The notice is the firm's to publish | A privacy page in the app (the `/help` page, later) |

### Parked, open, and things that need Dylan

- **Send the pilot firm its privacy notice wording** (PLAN.md Parking lot, 4 steps): a solicitor
  reads it once, you fill in the blanks, send it, and tick when the firm has published it.

### How to see it

`docs/privacy-notice.md`.

## 2026-09-30: Phase 9, task 4: The pre-pilot checklist (0.9 h, BLOCKED)

### Time

0.9 hours of Claude's working time (04:11 to 05:07 UTC), in the unattended overnight loop.
Phase 9 so far: 2.0 of its 10 to 15 hour estimate.

### Result

- **Blocked, not ticked.** Five of the checklist's seven items need outside services: the tests
  green on GitHub's CI, a real backup restore, a real phone call, real phones and WhatsApp
  approval, and alerts reaching your phone. The other two were done for real, and are ticked in
  `docs/testing.md`.
- `scripts/verify.sh` printed `VERIFIED tree=fc4c70157bbd8459 e2e=true`: 2665 tests, 49 browser
  tests.
- No auditor round (blocked). The commit is recorded in `docs/overnight-log.md`.

### What was done, in plain words

**1. The load smoke found a real problem, now fixed.** A new browser test sends 200 WhatsApps to
the shifts line in about 5 seconds, signed as Twilio signs them, through the real app. Every one
was answered "received" at once. But the worker (the background process that sends the replies)
only got through 31 of them in the next minute. It was waiting 2 seconds after every single job,
however much work was queued: 200 messages would have taken about 7 minutes, and a cancelled shift
with 50 people booked would have taken over a minute and a half to tell them all. Now, while
there's a queue, it takes 5 at a time and goes straight on to the next 5. All 200 replies were
stored about a second after the last message arrived. *(Corrected in Phase 10: one run, with no
network delay; the test then only promised a minute. With a real provider's delay the tested bound
is 20 seconds for 200 workers; see "Phase 10, task 5".)*

**2. Checking the logs for phone numbers found two leaks, now fixed.** Every browser test run now
keeps everything the app and the worker printed, and fails if it finds anything that looks like a
phone number or an email address. The scan uses its own rules, not the ones the app uses to hide
numbers, so it doesn't just agree with them. It found:
- a mobile number typed into the office's "Find a worker" search, printed as part of the web
  address. The search no longer puts what you type in the address (it's sent like a form);
- Next's development mode printing every server action with what was passed to it, including that
  mobile and a login link's secret token. Switched off.
Both logs are now clean on every run.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Blocked, not ticked; the two local items ticked in the checklist | They were really checked, on the real app; the rest need outside services | Ticking nothing until the server exists |
| Jobs 5 at a time, but each batch one after another in order | The wait was the problem, not doing one at a time; running them side by side (my first fix) could send a text after someone replied STOP | Side by side; a shorter wait (still too slow) |
| A firm's own shifts line is allowed in the log | It's a business number, printed on purpose by the development message printer | Hiding it too |

### What the review caught

The `guardrails-reviewer` found 4 things to fix first:
- my first fix ran up to 5 jobs side by side: a worker's text could be answered by SMS after
  their STOP in the same batch, and offer waves could hold several shifts locked (making people
  wait to take them);
- the log check would have failed on GitHub's fresh copy (a folder that didn't exist yet);
- the scan missed the search's mobile (written with a `+` for a space);
- some comments and docs said things that weren't true.

All fixed. The next check run then caught Next's development logging, which the review hadn't.

### What the new tests prove

10 new tests, plus one browser test:
- **The load smoke**: 200 messages answered "received" quickly, and every reply stored within a
  minute.
- **The log scan**: phone numbers written every way (spaces, dashes, brackets, in web addresses)
  and emails are found; ids, times, versions, decimals and already-hidden values aren't; the
  report never shows the value itself.
- **The worker**: 5 jobs per fetch, run strictly one after another in order, one failure leaving
  the rest alone.

### Parked, open, and things that need Dylan

**Pre-pilot checks on the server** (PLAN.md Parking lot): CI green on GitHub, the restore, the
Twilio fallback call, WhatsApp on 3 real phones, alerts to your phone, and the load smoke and log
check once on the real server. Tick the remaining boxes in `docs/testing.md` as each is done.

### How to see it

`npm run e2e -- tests/e2e/load.smoke.spec.ts` prints the timings; `docs/testing.md` "Pre-pilot
checklist".

## 2026-09-30: Phase 9, task 5: The baseline week (0.1 h, BLOCKED)

### Time

0.1 hours of Claude's working time (05:10 to 05:19 UTC), in the unattended overnight loop.
Phase 9 so far: 2.1 of its 10 to 15 hour estimate.

### Result

- **Blocked, not ticked.** The "baseline" is the pilot firm's own numbers for a normal week before
  go-live (emails, calls, cancellations, time spent), so the pilot can be compared with it. It
  needs a real firm.
- `scripts/verify.sh` printed `VERIFIED tree=7bbbaea2c12b0b86 e2e=true` (2665 tests, 49 browser
  tests). Documents only.
- No auditor round (blocked).

### What was done, in plain words

The office already has a page to enter the baseline (Pilot figures, "Baseline (week 0)"). What was
missing was an easy way for the resourcer to collect the numbers. `docs/baseline-tally.md` is a
sheet to fill in each day (emails by kind, calls, WhatsApp messages, unanswered shift queries,
no-shows, minutes on staff admin) and for each cancellation (when it came in, when it was covered,
how much notice), then step-by-step how to turn it into the 8 figures the page asks for. Counts
only, no names.

### Parked, open, and things that need Dylan

- **Record the baseline week** (PLAN.md Parking lot, 4 steps): after Gate B, send the sheet, the
  resourcer fills it in, you enter the 8 figures, `firm:check` shows it done.

### How to see it

`docs/baseline-tally.md`.

## 2026-09-30: Phase 9, task 6: The dry-run event day (0.2 h, BLOCKED)

### Time

0.2 hours of Claude's working time (05:21 to 05:30 UTC), in the unattended overnight loop.
Phase 9 so far: 2.3 of its 10 to 15 hour estimate.

### Result

- **Blocked, not ticked.** A dry run needs the pilot firm's resourcer, volunteers with real phones,
  and Twilio connected so the messages really arrive.
- `scripts/verify.sh` printed `VERIFIED tree=4b6f3f565e21607c e2e=true` (2665 tests, 49 browser
  tests). Documents only.
- No auditor round (blocked).

### What was done, in plain words

The onboarding runbook said "dry-run event day: see the pilot playbook", but the playbook didn't
say how. It now has a "Dry-run event day" section: a rehearsal of a real event day on the firm's
own setup, with a pretend event and three volunteers (the resourcer, you, and a friendly worker, on
their own phones), before the staff are told about it. Twelve steps, each saying who does it and
what "worked" looks like:
1. logging in;
2. taking a shift;
3. two people tapping the same shift at once;
4. a shift the rules refuse;
5. a cancellation starting an urgent offer;
6. the office moving and cancelling;
7. a request;
8. pay;
9. messages to the shifts line;
10. reminders;
11. the notice report and action log;
12. tidying up.

Then a table to fill in. The pretend event is dated before go-live, so it never counts in the
pilot's figures.

### Parked, open, and things that need Dylan

- **Run the dry-run event day** (PLAN.md Parking lot): after onboarding steps 1 to 11 and Connect
  Twilio, with the resourcer, about two hours.

### How to see it

`docs/pilot-playbook.md` "Dry-run event day".

## 2026-09-30: Phase 9, task 7: The weekly pilot reviews and the week-4 report (0.2 h, BLOCKED)

### Time

0.2 hours of Claude's working time (05:32 to 05:41 UTC), in the unattended overnight loop.
Phase 9 finished at 2.5 of its 10 to 15 hour estimate: 1 task done, 6 blocked (they all need a real
pilot firm, real phones or outside services).

### Result

- **Blocked, not ticked.** The task is to review a real four-week pilot and send its report.
- `scripts/verify.sh` printed `VERIFIED tree=47ffad267d7b09a9 e2e=true` (2665 tests, 49 browser
  tests). Documents only.
- No auditor round (blocked).

### What was done, in plain words

The office's Pilot metrics page already works out the numbers (with the baseline and each target).
`docs/pilot-report.md` says what to do with them:
- **every Friday**: the resourcer's tally first, then the page for that week, a table to fill in
  week by week, and a short update email to the firm (the wording, with blanks);
- **after week 4**: the report, section by section, with where each number comes from (including
  how to work out "resourcer hours a week back"), attaching the notice report's download, taking
  staff quotes only with their permission, and then the "Gate C" check (the pilot worked:
  unanswered queries near 0%, time saved, at least half the staff using it).

### Parked, open, and things that need Dylan

- **Run the pilot's weekly reviews and send the week-4 report** (PLAN.md Parking lot).

### How to see it

`docs/pilot-report.md`.

## 2026-10-03: Phase 10, task 1: offer waves never hold the shift while sending (0.8 h)

### Time

0.8 hours of Claude's working time (16:20 to 17:05 UTC), in the overnight loop Dylan restarted
after the audit. Phase 10 so far: 0.8 of its 30 to 45 hour estimate.

### Result

- **Done and ticked.** `scripts/verify.sh` printed `VERIFIED tree=ee25ef9016a1bbff e2e=true`
  (2678 tests, 49 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M18, M19, M20, L17, L19, L72, L77 (`docs/audit-2026-09-30.md`).

### What was built, in plain words

When a shift becomes urgent (someone drops out), the app sends an **offer wave**: a WhatsApp or text
to the workers allowed to do it, saying "tap to take it".

Before, the whole wave ran inside **one database transaction** (a bundle of changes that all happen
together or not at all). That transaction **locked** the shift (a lock makes everyone else wanting
that shift wait their turn) until the very last message had gone. With a real provider each message
takes a few hundred milliseconds. So with 300 workers, the first person to tap "Take shift" would
have been stuck waiting for minutes. A test proved it: with just 60 workers, "Take shift" waited
2.6 seconds.

Now a wave works like the shift reminders already did: **claim, then send, then record**.
- **Claim**: for one worker at a time, a tiny transaction locks the shift for a few milliseconds and
  checks that it's still open, still urgent, still has a place and is still the same shift. It
  checks the worker too: still active and wanting offers, not offered or booked it since the wave
  started, and still allowed by the rules (their licence, for example). Then it writes their offer
  and lets go.
- **Send**: the message goes out with nothing locked.
- **Record**: a second tiny transaction saves "sent" (or "couldn't send") in the action log.

So a worker who taps "Take shift", or the office pressing "Assign", waits for one claim at most.
If the shift fills part-way through, the rest of the workers aren't messaged. If the office changes
the shift's time, role or site part-way through, the wave starts again with the new details.

If the worker process crashes (stops unexpectedly) just after a claim, that message may or may not
have gone. Like a reminder, it's never sent again: nobody gets the same offer twice. The retry
carries on with whoever is left.

The "still unfilled" email to the office (**escalation**) works the same way, one office user at a
time. One email address that fails no longer stops the others.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| One claim per worker, no new database column | The existing rule "one offer per worker per wave" already makes a claim happen only once. No schema change, and nothing else that reads offers has to change. | A new "sending" status on offers: about 20 places in the code would need to learn it. |
| Check the rules again for each worker when they're claimed | A licence can be suspended part-way through a wave. "Only eligible workers are ever notified." | Trust the list read at the start, which can be minutes old by the end. |
| Start the wave again if the office edits the shift mid-wave | The message would carry the old time or place. | Rebuild just the message: workers who fit only the new role would be missed. |
| A wave stops sending once the shift fills | Telling more people about a full shift is noise. | Keep going with the list. |

### What the review caught (all fixed)

The safety reviewer and two other reviewers found one serious problem in the first version. Because
the worker list is read once at the start, a worker the office offered the shift to by hand, or who
booked it, *while the wave was going out* could still get the wave's message. The fix is the
worker check in the claim (above). They also found that a retried wave ignored quiet hours (now
honoured), that the escalation could lose emails after a crash (now one claim per office user), and
that the action log said "The office" instead of the person's name (fixed).

### What the new tests prove

`tests/integration/offers.waves.lock.test.ts`, on the real database, with a slow pretend provider:
- With 300 workers, "Take shift" and the office's "Assign" each finish within 2 seconds mid-wave,
  and the wave then stops without messaging the rest.
- A worker replying STOP (or being deleted) isn't held up by a wave.
- A crash just after a claim never messages that worker twice, and the retry finishes the rest.
- Two copies of the same wave still send to exactly its 2 workers, and start one next wave.
- An office offer, a booking, a suspended licence and offers turned off, all mid-wave, each keep
  that worker out of the rest of the wave.
- Moving the shift mid-wave restarts it: the rest hear the new time.
- A retry during quiet hours waits until they end.
- Escalation: emails go with the shift unlocked, one failed address doesn't stop the rest, and a
  crash after one email emails the rest on retry and nobody twice.
- The worker process runs the real wave and escalation jobs (before, no test would notice if they
  were unplugged).

Each new check was also tried in reverse. With it removed, its test fails.

### Parked, open, and things that need Dylan

- The office's single "Offer to someone", login links and the other senders still send inside their
  transaction: that's Phase 10 task 3.
- An alert when office emails fail: parked with "Connect Amazon SES".
- Pushes to phones happen in the short record step: moving them out is parked for when the real web
  push is connected.

### How to see it working

Nothing new on screen. Run `npx vitest run tests/integration/offers.waves.lock.test.ts` to see the
11 checks pass.

## 2026-10-03: Phase 10, task 2: offers close the moment a shift fills (0.6 h)

### Time

0.6 hours of Claude's working time (17:07 to 17:40 UTC). Phase 10 so far: 1.4 of its 30 to 45
hour estimate.

### Result

- **Done and ticked.** `scripts/verify.sh` printed `VERIFIED tree=22abcaa93c318078 e2e=true`
  (2693 tests, 49 browser tests).
- The independent auditor said `VERDICT: DONE`: every mode PROVEN, no fakes found.
- Audit finding fixed: M5.

### What was built, in plain words

When an urgent shift is offered to several workers, each offer is recorded with an answer: still
waiting, accepted, or "filled by someone else". The office sees these on the shift's page. They
are also part of the firm's evidence of every offer it made.

Before, the "waiting" offers were only closed when a later offer wave happened to notice the shift
was full. Under "first come, first served" (the default) there is no later wave, so they said
"waiting" for ever, even after the shift was filled.

Now they close at the moment the shift fills, whatever fills it:
- a worker tapping Take shift;
- the office pressing Assign or "Mark as filled";
- the office cutting the number of places;
- the rota sheet naming people.

The person who took it has their offer marked **accepted**, and everyone else's **filled by someone
else**. One line goes in the action log: "Offers still waiting were closed: 3 filled by someone
else."

Two follow-on fixes came out of the review:
- **A shift that reopens:** if someone drops out and a worker who was told "filled by someone else"
  takes it after all, their offer now becomes "accepted".
- **The pilot figure "urgent shifts filled from offers"** now counts only shifts a worker took
  themselves after being offered them. The office placing someone, or the rota sheet naming them,
  doesn't count. That matches what the figure is meant to show.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| One shared piece of code, called from every route that can fill a shift | One place to get right; a new route only has to call it. | Fixing each route separately (that's how the gap happened). |
| An offered worker the office places is marked "accepted" | The audit asked for it, and fair rotation already did this. | Leave it "waiting". |
| The pilot figure counts only workers who took it themselves | Otherwise office placements would inflate "filled from offers". | Count every accepted offer. |
| One log line per fill, with counts | The action log stays readable; each offer keeps its own answer and time. | A line per offer: hundreds for one big wave. |

### What the new tests prove

`tests/integration/offers.close.test.ts` (13 checks) and one new check in
`tests/integration/sheets.sync.test.ts`:
- Each way a shift can fill closes the waiting offers at once, with the right answers:
  - first come, first served;
  - after the last fair-rotation wave (and over two waves);
  - the office placing an offered worker, or someone else;
  - "Mark as filled";
  - fewer places;
  - the rota sheet.
- A first booking on a 2-place shift closes nothing yet.
- A reopened shift retaken by an earlier offeree: "accepted", with the shift full again or with a
  place still free.
- A message that fails while the shift fills is recorded as failed, not "filled by someone else"
  (it never arrived).
- A later wave finding the shift full adds no second log line.
- Updated `tests/integration/pilot.metrics.test.ts`: an office placement doesn't count as "filled
  from offers".

Each fix was also tried in reverse (removed). Its test then failed.

### Parked, open, and things that need Dylan

- When the *rota sheet* cancels a whole shift, its waiting offers still say "waiting" (the office's
  own cancellation already marks them expired). Parked in `PLAN.md`.

### How to see it working

On your computer (`npm run dev`):
1. As the office, mark a shift urgent.
2. As a worker, take it.
3. Open the shift's page in the office: the other offers now say "filled by someone else".

## 2026-10-03: Phase 10, task 3: no message is sent twice when a job retries (1.0 h)

### Time

1.0 hour of Claude's working time (17:43 to 18:45 UTC). Phase 10 so far: 2.4 of its 30 to 45
hour estimate.

### Result

- **Done and ticked.** `scripts/verify.sh` printed `VERIFIED tree=3ebf558d79588104 e2e=true`
  (2713 tests, 49 browser tests).
- The independent auditor said `VERDICT: DONE`: every sender PROVEN, no fakes found.
- Audit findings fixed: M10, L33.

### What was built, in plain words

The app's background jobs send messages: login links, pay-page codes, offers, licence reminders.
If a job fails, the job queue (pg-boss) runs it again. That's good, unless the message had
already gone before the failure. Then the worker got it twice, or, worse, got a login link that
no longer worked. Before this task, several jobs did all their work in one database transaction
(an all-or-nothing bundle of changes) with the message sent in the middle. A failure after the
message rolled back the record that it had gone.

Now every job that sends works in three steps, like the shift reminders already did:
1. **claim**: save "this message is going out" and commit it;
2. **send** the message, with nothing locked;
3. **record** what happened.

If the job fails after the message has gone and runs again, it finds the claim and sends
nothing. Changed this way:
- **login links** (a link marked sent before it goes, so the link the worker got always works);
- **pay-page codes**;
- **the office's "Offer to someone"**;
- **the daily licence scan**, including the Monday list to the office.

There's one more fix from the review. If a job stopped between sending and recording, its next
run now logs the message as sent, marked "not confirmed: it may not have arrived". That way the
action log, and the notice report the firm uses as evidence, never lose an offer that went.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| A new column, `otp_codes.request_id` | So a re-run of the pay-page code job can find the code it already made. Old rows are unaffected. | No column: the job couldn't tell its code had gone. |
| A failed send is logged and not tried again | It may have arrived; a second copy is worse, and the worker can just ask again. | Retry: double messages, or a dead link. |
| Login and licence messages count in the "too many failures" alert | Their failures are now logged, not failed jobs, so the alert would otherwise miss them. | Leave them out: a broken provider would go unnoticed. |
| "Not confirmed" sends are logged on the next run | The notice report counts sent offers; one that may have gone must still be there. | Leave the gap. |

### What the new tests prove

`tests/integration/jobs.no-resend.test.ts` (14 checks):
- **Every sender, failed during or right after its message and run again, never sends twice.**
  The ones that log a catch-up (offers, licence messages, login links and codes) log the send
  exactly once, marked "not confirmed". The login link and code that went still work.
- **Escalation and the Monday list**, which record before they send, run twice and send once.
- **Two copies of the pay-code job at once** send one code, and it works.
- **Every sender's failed send** is logged and not tried again.

Also:
- updated `credential.scan.test.ts` (a licence renewal no longer waits for a message to go
  out; a failed list email is logged rather than failing the whole scan);
- updated `ops.alerts.test.ts` (login codes count in the failure alert);
- updated `offers.waves.lock.test.ts` (a wave's "may have gone" offer is in the log).

Each fix was also tried in reverse (removed). Its test then failed.

### Parked, open, and things that need Dylan

- **Confirm** the new database column and the "send at most once" choice for login links and
  codes (in the decision table in `docs/overnight-log.md`).
- **An alert for office emails that fail** (escalation, the Monday list, office login links):
  parked with "Connect Amazon SES".

### How to see it working

Nothing new on screen. Run `npx vitest run tests/integration/jobs.no-resend.test.ts`.

## 2026-10-03: Phase 10, task 4: Twilio message ids never make the action log refuse an event (0.5 h)

### Time

0.5 hours of Claude's working time (18:47 to 19:17 UTC). Phase 10 so far: 2.9 of its 30 to 45
hour estimate.

### Result

- **Done and ticked.** `scripts/verify.sh` printed `VERIFIED tree=2457f1e0e727e45a e2e=true`
  (2723 tests, 49 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M12, L46.

### What was built, in plain words

The app hides personal data in its logs: a **masker** (code that blanks out phone numbers, emails
and the like) runs on everything it writes. The action log is stricter still. It refuses any
entry the masker would change, so a phone number can never get into it by mistake.

The masker treats any run of 10 or more digits as a phone number. When Twilio sends a message, it
returns an id like `SM1234567890cdef0123456789abcdef01`: two capital letters and 32 hex
characters (0–9 and a–f). About one id in twelve has 10 digits in a row. Once Twilio was
connected, the action log would have refused to record about one message in twelve, after the
message had already gone.

Now the masker recognises a Twilio id by its exact shape and leaves it alone, the same way it
already left dates and other ids alone. A phone number next to one is still hidden, and anything
not quite that shape is still masked.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Teach the masker the exact Twilio id shape | One place fixes every event and every log line, and keeps the ids readable for matching against Twilio's records. | Skip the check for that one field: log lines would still mangle the ids. |

### What the new tests prove

- **`tests/integration/events.twilio-ids.test.ts`:** each of the nine senders that records a
  message id was run with Twilio-shaped ids containing 10 digits in a row, and each id is
  recorded exactly:
  - offer waves and the office's offer;
  - login links and pay-page codes;
  - licence warnings and expiry notices;
  - shift reminders;
  - change notices, request answers and pay-query answers.
- **`tests/unit/log.masking.test.ts`:**
  - 1,000 evenly spread ids pass unchanged (about 1 in 12 with a long digit run, as the audit
    worked out);
  - a phone number next to an id is still masked;
  - near-misses are still masked.
- **The tests catch both versions of the bug:** with the old masker, every one of the new tests
  fails. A deliberately half-fixed masker fails too. That second check came from the review,
  which found my first test's random ids were nearly all zeros.

### Parked, open, and things that need Dylan

- **An older gap in the masker**, found in the review and not caused by this change: a date with
  a time-zone offset written right next to a phone number can hide part of the number. Parked
  for Phase 10 task 16 (logs are safe and checked).

### How to see it working

Nothing to see on screen: it matters once Twilio is connected.

## 2026-10-03: Phase 10, task 5: speed at pilot size (1.3 h)

### Time

1.3 hours of Claude's working time (19:20 to 20:37 UTC). Phase 10 so far: 4.2 of its 30 to 45
hour estimate.

### Result

- **Done and ticked.** `scripts/verify.sh` printed `VERIFIED tree=0d9c30fce4166352 e2e=true`
  (2,735 tests, 49 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M14, L42, L51, L55, L63, L73, L74, L75, L76.
- Commit `0429ef0`, pushed to `build/overnight`.

### What was built, in plain words

**Answering the shifts line when sends are slow.** Each WhatsApp answer waits for the provider
(Twilio) to accept the message. Without a network, a send takes almost nothing. With a real one,
it takes about 300 milliseconds. The worker used to answer one message at a time, so 200 messages
took a minute or more. It now runs 8 answers at once.

A **group** (pg-boss's way of keeping some jobs one after another) stops it running two of one
worker's messages at the same time. Before answering a message, a job first answers any older
unanswered one from the same number. So a STOP is always handled before the text that came after
it. If an older message fails, it is logged and retried on its own, and the newer one is still
answered.

**A crashed worker.** The worker takes up to 5 jobs at a time. If it was killed mid-batch (out of
memory, a reboot), the jobs it held used to wait 15 minutes before anyone retried them. Now the
worker sends a **heartbeat** (a regular "still working on it" note) for each job it holds. Every 15
seconds, pg-boss's **supervisor** (its housekeeping pass) puts back any job whose heartbeat has
stopped for 30 seconds. So nothing waits more than about a minute.

**Open shifts and the urgent board.** These pages checked the booking rules one shift at a time,
and each check ran several database queries: hundreds of queries for one page. Now one batched
read loads what the rules need for all the shifts at once. The rules themselves are unchanged.
The offer list does the same for many workers.

**Indexes** (lookup tables that make a database search fast) were added for a worker's licences,
a worker's phones and messages from a number.

**Docs.** They said the queue drains "in about a second". That is only true with no network.
They now give the tested numbers.

Key numbers:
- 200 workers' messages, with a fake provider taking 300 ms a send, are all answered within the
  written bound of 20 seconds of the last one arriving.
- A worker killed mid-batch has its jobs back within about a minute (45 seconds in the test).
- Open shifts makes the same number of queries for 5 shifts as for 40. The offer list makes the
  same number for 5 workers as for 60.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| 8 answers at once, one per worker at a time | Different workers are answered side by side; one worker's messages stay in order | One at a time (too slow); many at once with no grouping (a STOP could be overtaken) |
| Answer a worker's older unanswered messages first, best effort | Keeps the order even when two jobs start at the same moment; one bad message never blocks a worker | Failing the whole job (one bad message would block that worker for good) |
| 30-second heartbeat; supervisor every 15 seconds | Back within about a minute, at the cost of a few small queries | pg-boss's default once a minute (up to about two minutes) |
| Batched rules reads, checked against the one-at-a-time version | A fixed number of queries; the rules aren't touched | Caching (still one query set per pair) |

### What the new tests prove

- **`tests/integration/inbound.load.test.ts`:** the real job, set up as the worker sets it up,
  answers 207 messages through a 300 ms fake provider within 20 seconds of the last one.
  - One worker's burst of messages is answered in the order sent.
  - A STOP is handled before the text after it.
  - No number ever gets two sends at the same time.
  - Job groups hold only ids, never a phone number.
- **`tests/integration/jobs.crash.test.ts`:**
  - A real worker process is killed mid-batch, and its jobs are back within about a minute, with
    production's own settings.
  - A queue made before heartbeats existed gets one when the worker starts.
- **`tests/integration/eligibility.batch.test.ts`:**
  - The batched reads give exactly the same answers as the one-at-a-time ones for every shift and
    worker of a deliberately mixed firm, with the allowance off, and in summer time around
    midnight.
  - The fair-rotation hold gives the same answers too.
  - The query counts stay the same as the page grows.
  - The three indexes exist.
- **`tests/integration/inbound.sms.test.ts`, `inbound.whatsapp.test.ts`:**
  - An older message that fails doesn't stop a newer one.
  - A late START after a STOP changes nothing.
  - Two messages at once from an unknown number get one reply and one alert email.
- **The tests catch the bugs:** each new test was checked by deliberately breaking the code it
  guards (the lock, the best-effort catch, the fair-rotation reopen and holders, the offer
  filter). Each broken version failed.

### Parked, open, and things that need Dylan

- Nothing parked. The 20-second bound is on this laptop. Run the load smoke once on the server
  too (already in PLAN.md "Pre-pilot checks on the server").

### How to see it working

Nothing new on screen. The pages are the same, just with far fewer database queries behind them.

## 2026-10-03: Phase 10, task 6: office access can be taken away (0.8 h)

### Time

0.8 hours of Claude's working time (20:39 to 21:24 UTC). Phase 10 so far: 5.0 of its 30 to 45
hour estimate.

### Result

- **Done and ticked.** `scripts/verify.sh` printed `VERIFIED tree=bcb5f653d2fe553c e2e=true`
  (2,759 tests, 50 browser tests).
- The independent auditor said `VERDICT: DONE` on its second round. The first round proved
  every claim but answered "NOT DONE" only because the box wasn't ticked yet, which happens
  after the audit.
- Audit findings fixed: M21, L80 (with a few leftovers parked, below).
- Commit `5964a26`, pushed to `build/overnight`.

### What was built, in plain words

Before this, nobody could take office access away. If a resourcer left, they kept a 30-day
**session** (the "stay logged in" the browser remembers) and could keep asking for new login
links. The only fix was you typing database commands on the live server.

Now the firm's admins do it themselves on the **office team page** (`/office/team`). For each
person there are four buttons:

- **Turn off access:** it asks "Yes?" first. They're logged out on every device at once. Any login
  link they haven't used stops working.
- **Turn access back on:** they log in afresh with a new link. Nothing old comes back.
- **Change role** (Admin, Resourcer, Payroll): this applies from their next page. Making someone
  an admin asks "Yes?" first.
- **Log out on every device:** for a lost laptop, without taking access away.

You can do the same from the terminal with `firm:office-user` (`--disable`, `--enable`,
`--set-role`, `--sign-out`). This is in the runbook's new section "Someone leaves the office, or
loses a laptop".

Every change goes in the action log, for example "Ann Admin turned off Sam Rota's office access."
The log holds ids and counts only, never a name or an email. Two guards apply:
- A firm can never be left without an admin who can log in.
- Nobody can change their own access on the page; another admin does.

**Workers too:** if a worker is made inactive by an import or the rota sheet, they're now logged
out everywhere. Before, making them active again brought their old sessions back.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Turning access off ends every session and link at once | The leaver is out the moment the admin presses the button | Checking at their next page only: making them active again brought old sessions back |
| Turning access back on also ends anything left over | Nothing old can come back, however the access was turned off | Trusting nothing was left: one rare timing left a session |
| The firm's admins take turns (a **lock**: the database makes two changes wait for each other) | Two admins turning each other off at the same moment can't leave the firm with no admin | No lock: the test showed both could win |
| No changing your own access; "Yes?" before making someone an admin | No accidental lock-out; admin can see and delete workers' data | Allowing it |

### What the new tests prove

- **`tests/integration/office.team.test.ts`** (14 tests):
  - Off: every session and unused link ends at once. Back on: the old ones stay dead, and a new
    link works.
  - A role change shows at the next page.
  - "Log out on every device" works, and someone not logged in anywhere is told so.
  - Nothing changed means nothing logged.
  - Only an active admin of the same firm can make changes. Another firm's person is "not found".
  - The last admin can't be turned off or demoted.
  - Two admins turning each other off at the same moment: one wins, and the firm keeps an admin.
  - A login finishing at the same instant as a turn-off or log-out: no **deadlock** (two database
    jobs each waiting for the other forever), and its session is ended too.
  - A session renewed a moment before is ended too, including the old token's 60 seconds.
  - A worker made inactive, then active, gets nothing old back.
- **`tests/unit/office.team-copy.test.ts`:** every message on the page and in the action log,
  word for word as in `docs/screens.md`.
- **`tests/e2e/office.team.spec.ts`:** in a real browser, an admin turns a resourcer off while
  the resourcer is logged in on another phone. The resourcer is out. Access goes back on, and the
  old session stays out. Their role is changed and shows when they log in again.
- **The tests catch the bugs:** each guard was deliberately broken in turn:
  - the session ending;
  - the admin lock;
  - the last-admin check;
  - the lock's strength;
  - the order links and sessions are ended in;
  - counting expired sessions;
  - renewing an ended session;
  - the worker status change.
  The matching test failed every time.

### Parked, open, and things that need Dylan

Parked in PLAN.md's Parking lot, with reasons:
- A worker's lost phone: "Log out on every device" for one worker needs an office page for a
  worker, which task 7 builds.
- An admin logging out their own other devices.
- Two rare timing cases that are milliseconds wide and fail safely.

### How to see it working

1. `npm run dev`, then log in at `http://acme.localhost:3000/office` as `acme.admin@example.com`.
   The login link prints in the terminal.
2. Click "Office team".
3. Next to Acme's resourcer, press "Turn off access", then "Yes, turn off access". You should see
   "… access is off. They've been logged out everywhere …".
4. Press "Turn access back on", or pick a role and press "Change role".
5. Then open the "Action log" to see each change.

## 2026-10-03: Phase 10, task 7: worker leavers and blocks (1.1 h)

### Time

1.1 hours of Claude's working time (21:26 to 22:34 UTC). Phase 10 so far: 6.1 of its 30 to 45
hour estimate.

### Result

- **Done and ticked.** `scripts/verify.sh` printed `VERIFIED tree=f07a756cb31e4ba1 e2e=true`
  (2,816 tests, 51 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M22, M23, L24, L81.
- Commit `0b5bad8`, pushed to `build/overnight`.

### What was built, in plain words

Before this, the office had no way to deal with a worker who left. Only you could change a
worker's status, by running an import. Someone who left could still log in and book shifts, and
kept getting reminders they couldn't act on.

There's now a **Workers** page in the office, for admins and resourcers. Find someone by name or
mobile, then on their page:

- **Make inactive** (they've left): a reason, then "Yes". They're logged out at once, can't log
  in or take shifts, get no reminders, and notifications stop on their phones.
  - Your rota sheet can't undo this. A sheet with no status column reads every row as "active",
    which would otherwise have made them active again at the next sync. Only the office can.
- **Make active again**, and **Unblock** (for someone a sheet or file blocked), each with a reason.
- **Block from a site**: for a client who doesn't want someone at their venue. The rules already
  had a check for this (rule 9), but nothing fed it. Now the person can't book or be offered
  shifts at that site, and is told "This site isn't available to you. Contact the office."
- **Log out on every device**: for a lost phone.

Every change needs a reason from a short list. The **action log** (the office's record of
everything that happened) shows who did what and why.

**Today** has a new list, **"Bookings to check"**. It shows any booking ahead whose worker is no
longer active, or is blocked from that site, whoever made the change: the office, the rota sheet
or a file. For each one the office can:
- **Cancel it.** The worker is told. The reason ("They've left, or can't work here") and the
  notice they had go in the notice report, as golden rule 12 requires.
- **Keep it.** It stays off the list until something changes again.

A new mobile from the sheet or a file now also turns off the old phone's notifications.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The office's "make inactive" beats the rota sheet | Otherwise every sheet sync would undo it | Letting the sheet always win |
| Reasons from fixed lists | The log never holds free text | A typed note |
| "Bookings to check" worked out fresh each time | Nothing can go stale | Storing a flag |
| No reminders for an inactive or blocked worker, or at a site they're blocked from until kept | They can't act on a reminder, or shouldn't turn up | Reminding until the office decides |
| A kept booking doesn't stop moving the shift's time | The office already chose to keep that person | Refusing every move |

### What the new tests prove

- **`tests/integration/office.workers.test.ts`** (22 tests):
  - Each change, with its reason and log entry.
  - Each refusal (the wrong status, another firm, payroll, a deleted worker).
  - The sheet not undoing the office.
  - Reminders stopping by any path, including in the instant between the list and the send.
  - Today's cancel and keep, and kept bookings coming back when something changes.
  - The site block refusing booking, offers and the office's own assign.
  - A login, or a sheet sync, happening at the same instant as a change.
  - The mobile change.
- **`tests/integration/eligibility.batch.test.ts`:** the batched rules give the same answers as
  the single ones with a blocked site.
- **`tests/unit/office.worker-copy.test.ts`:** every message, word for word.
- **`tests/e2e/office.workers.spec.ts`:** in a real browser, a resourcer:
  1. makes a booked worker inactive;
  2. blocks another from a site;
  3. cancels one booking and keeps the other on Today;
  4. sees both changes in the action log.
- **The tests catch the bugs:** each new guard was deliberately broken in turn, and its test
  failed.

### Parked, open, and things that need Dylan

Parked in PLAN.md's Parking lot:
- A cancellation notice to someone who has left still includes the portal link. A version without
  it needs a new WhatsApp template, which Meta has to approve.
- Offers waiting when someone leaves stay open until they time out. Taking one is refused anyway.
- Nothing chases a "Bookings to check" item nobody answers.
- The office blocking a whole worker (only the sheet or a file can today).

### How to see it working

1. `npm run dev`, then log in at `http://acme.localhost:3000/office` as
   `acme.resourcer@example.com`. The login link prints in the terminal.
2. Click "Workers" and find one of the seeded workers.
3. Choose a reason and press "Make inactive", then "Yes".
4. If they had a booking ahead, it's now on Today under "Bookings to check".

## 2026-10-03: Phase 10, task 8: notice for a moved shift counts from the earlier start (0.5 h)

### Time

0.5 hours of Claude's working time (22:36 to 23:05 UTC). Phase 10 so far: 6.6 of its 30 to 45
hour estimate.

### Result

- **Done and ticked.** `scripts/verify.sh` printed `VERIFIED tree=a1ddf286acdd2877 e2e=true`
  (2,822 tests, 51 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M6, M25, L21.
- Commit `9e1d7f9`, pushed to `build/overnight`.

### What was built, in plain words

The **notice report** lists every cancellation and change, with how much warning the worker had.
It flags anything under the firm's threshold (48 hours by default) as **short notice**. It's the
firm's evidence under the Employment Rights Act.

When the office moved a shift, the warning was counted from the shift's **old** start. Move a
Saturday shift to Tuesday on Monday morning, and the report said "4 days' notice, not short",
when the worker really had 23 hours.

Now a move or shortening counts from whichever start is **earlier**, the old or the new. That
example now reads 23 hours, flagged short. The rota sheet's moves count the same way.

A move or shortening that keeps the start, or moves it later, still counts from the old start, as
before.

Two timing gaps in moving a shift are closed too:
- **The worker:** the move now holds each booked worker's record before re-checking them. So if
  that worker is booking another shift at that exact moment, the move sees it and won't
  double-book them.
- **The "applied" allowance:** a firm can let a small share of staff work while their licence
  application is in progress. The move now also takes that day's lock for this allowance, so a
  move and a booking can't both take the last place.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Earlier of the old and new start | The worker's real warning; a move later doesn't read as more notice than the shift they planned around | The new start only; the old start (hid short notice) |
| Old log entries left as they are | The action log is never rewritten; both starts are recorded | Rewriting history |

### What the new tests prove

- **`tests/integration/notice.report.test.ts`:** the audit's own example records 23 hours. It is
  flagged short, found by the "short notice only" filter, and the CSV says `23.00,Yes`. The rota
  sheet's move an hour earlier records the hour less. Later moves and shortenings are unchanged.
- **`tests/unit/roster.change-notice.test.ts`:** the rule on its own.
- **`tests/integration/office.firm-change.test.ts`:**
  - A booking that holds the worker while the office moves their other shift onto it: the move
    waits, sees it and is refused for the overlap.
  - A booking holding the day's "applied" lock: the move waits its turn.
- **The tests catch the bugs:** each fix was deliberately broken in turn, and its test failed.

### Parked, open, and things that need Dylan

Parked for task 9 (making the rota sheet follow the office's rules):
- A site change made on the sheet isn't logged per worker.
- A sheet re-timing a shift that has already started isn't logged.

### How to see it working

1. Log in to the office.
2. Open a booked shift a few days ahead, and choose "Move, shorten or cancel".
3. Move it to tomorrow. The confirmation now says the real notice.
4. The Notice report shows the change as short notice.

## 2026-10-04 — Phase 10, task 9: the rota sheet follows the office's rules

- **Time spent:** 1.2 hours (started 23:07 UTC on 3 October).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=25f4e382795d4b67 e2e=true`
  (2,843 tests, 51 browser tests). The first run failed on one older test that is flaky (it
  sometimes fails for timing reasons, not because the code is wrong; see "Parked" below). The
  second run passed with that test unchanged.
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M1, M2, L12.
- Commit `0c7d9b3`, pushed to `build/overnight`.

### What was built, in plain words

A firm can keep its rota in a **Google Sheet** (a spreadsheet the office already uses). Every
minute, the **sync** (a background job that copies the sheet into our database and writes our
bookings back) reads it.

Before this task, the sheet could do things the office's own screens refuse:
- **Change a booked shift** (its role, times or site) without checking the people already booked.
  A worker could end up on a shift their licence doesn't cover, or with too little rest.
- **Re-time or cancel a shift that had already started.**
- **Quietly erase names** the office typed in when the rules refused them.

Now:
- **A change to a booked shift is checked first.** The sync tries the change, then runs the same
  rules check the office's "Move" button uses, for everyone booked. If anyone can't work the shift
  as changed, the change is undone and the shift stays as it was. The office is told on Today, and
  it's logged once (not every minute).
- **A started shift is left alone.** The sheet can't move it, shorten it or cancel it. The attempt
  is logged and shown on Today. Headcount and instructions still follow the sheet.
- **Refused names stay on the sheet.** If the rules refuse a name the office typed, the name stays
  in its cell, and Today says why. Each sync tries again, so the person is booked as soon as they
  can work it. A refused name no longer uses up a place someone else could have had.
- **One case where a name does leave the sheet:** when there are more names than places, the extra
  name can't stay in the cell (the next read couldn't make sense of it). It's taken out, shown on
  Today and logged.
- **Today has a new section, "From your rota sheet".** It lists sheet changes that weren't made and
  names that weren't booked, with the reason in plain words. It clears itself when the office fixes
  the sheet.
- **A site change made on the sheet is now logged for each booked worker**, with notice hours, like
  a move.

Key facts:
- One shared re-check (`src/lib/roster/recheck.ts`) is used by both the office's move and the
  sheet, so the two can't drift apart.
- A new database column, `shifts.sheet_issues` (migration 0030), holds what Today shows. It is
  rewritten only when something actually changes.
- New log entries: `roster.sheet_change_refused`, and `roster.sheet_booking_refused` now also says
  when a name was taken out of the sheet.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| One re-check for both the office and the sheet | They can't disagree on who may work a changed shift | Copying the office's code into the sync |
| Try the change inside a **savepoint** (a checkpoint in the database you can roll back to), undo it if anyone fails | The rules see the shift exactly as it would be; nothing half-made is left behind | Building "the shift as it would be" by hand |
| Removals first, then the change, then the rest, then new names | Someone the office swapped out can't block the edit; a raised headcount is seen by new names | One pass (the reviews found false refusals) |
| Refused names stay in the cell and are retried every sync | The office's typing isn't erased; they're booked as soon as they can be | Never retrying them; erasing them (the old bug) |
| A role change on a booked shift is allowed when everyone booked can do the new role | The firm's sheet is its own; only what the rules refuse is refused | Refuse every role change, as the office editor does. **Dylan to confirm** (in `PLAN.md`) |

### What the new tests prove

- **`tests/integration/sheets.sync.test.ts`**, new cases:
  - A role change a booked worker can't do is refused, logged once, and not rewritten on the next
    identical sync.
  - A time change past a booked worker's licence expiry is refused.
  - A site change is applied and logged per worker.
  - A started shift isn't re-timed or cancelled; a change into the past is refused.
  - A refused name doesn't use a place, stays in the sheet and is booked once it can be.
  - Today shows the issues and clears them when fixed.
  - Broken rules settings refuse just that change; the rest of the sync goes through.
  - A swap plus a role change, a raised headcount plus a new name, a cancel plus a move (notice
    counted from the old start), a draft shift published later, and a change that passes only by
    the sheet's allowed overrides (recorded).
- **`tests/unit/office.sheet-issues-copy.test.ts`** and **`tests/unit/office.today-view.test.ts`:**
  Today's wording and the new section.
- **The tests catch the bugs:** each fix was deliberately broken in turn, and its test failed.

### Parked, open, and things that need Dylan

- **Dylan to confirm** (in `PLAN.md`): should the sheet be allowed to change a booked shift's role
  when everyone booked can do it? The office's own editor never changes a role.
- **A flaky test** (`sheets.jobs.test.ts`): it can fail when two checks happen either side of a
  50-second boundary on the real clock. Not caused by this task. The fix is parked in `PLAN.md`.

### How to see it working

There's no real Google Sheet connected locally yet (that needs a Google account, which is on the
accounts-to-create list). Until then, the tests show it:

1. Run `npx vitest run tests/integration/sheets.sync.test.ts` (with the database up:
   `npm run db:up`).
2. You should see every case listed above pass, including "a role Ada can't do isn't made" and "a
   started shift is never re-timed or cancelled by a sync".
3. Once a sheet is connected, the office's Today page shows "From your rota sheet" with any change
   that wasn't made, and why.

## 2026-10-04 — Phase 10, task 10: the Google Sheets setup, said honestly

- **Time spent:** 0.9 hours (started 00:19 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=9e917f199bbba895 e2e=true` (2,911 tests, 51 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M3, M17, L45.
- Commit `051f918`, pushed to `build/overnight`.

### What was built, in plain words

A firm can keep its rota in a **Google Sheet**. The app reads it through a **service account**: a
robot Google login that belongs to us. Each firm shares its sheet with it.

The audit found three problems:
- **It couldn't be switched on (M3).** The setting only accepted "none", the setup steps in
  `PLAN.md` would have failed, and Google was missing from your list of accounts to create.
- **Dates could be read the wrong way round (M17).** The app reads a date as day/month/year. A sheet
  set to the United States shows 12 June as "6/12", which would have been read as 6 December, with
  no error.
- **Nothing tied a sheet to its firm (L45).** Every firm shares with the same robot login, so if
  one firm had been able to type in another firm's sheet link, the app would have read and written
  that other firm's rota.

Now:
- **It can be switched on.** `SHEETS_TRANSPORT=google`, plus the path to the robot login's **key
  file** (its password, kept in the never-committed `secrets/` folder), switches the sync on. Off is
  still the default. Nothing called Google tonight: the tests use a fake Google.
- **Only a United Kingdom sheet is read.** Each sync first asks Google for the sheet's **locale**
  (its country setting). Anything but United Kingdom is refused before a single cell is read. The
  office's action log says why and how to fix it: File → Settings → Locale.
- **A new owner command, `npm run firm:sheet`, connects a firm's sheet.** It takes the sheet's link.
  It can also replace a sheet, switch one off, let one go (`--forget`), or show where a firm's sheet
  stands, in plain words.
- **One sheet, one firm.** The database refuses the same sheet for a second firm. The app itself
  can't add a sheet or change which one a firm uses. It may only update the sync's four "how did
  it go" columns (a **column-level grant**: permission for some columns of a table, not all).
- **Replacing a sheet is guarded.** Shifts are matched by their Shift ID. If a new sheet reused
  "S7" for a different shift, the first sync would cancel the people booked on S7. So while sheet
  shifts ahead have people booked, the command refuses another sheet unless you say it's a copy
  (`--same-ids`).
- **Plain words for every sync failure**, in the action log, `firm:check` and `firm:sheet`. A sheet
  Google can't read (a renamed tab, or an Excel file) now says so, instead of "try again later".
- **The setup steps match the code.** "Connect the real Google Sheets" in the `PLAN.md` Parking lot
  is now numbered steps, checked line by line against the code by two reviewers. Google is now in
  your accounts list and in the "what's blocked" table.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Refuse any sheet not set to United Kingdom | One small request; nothing else changes | Reading dates as Google's own numbers (would also turn staff IDs like "000123" into "123"; parked as the fuller fix for the date column only) |
| Make it switchable now | The old reason it was off (sheet names skipped the rules) was fixed earlier; only the account is missing | Leave it off until the account exists (the steps would need code changes then) |
| Only the owner connects a sheet; one sheet, one firm | Doesn't depend on any screen being careful | Making the firm prove it owns the sheet (parked, for if an office screen is ever built) |
| Replacing needs `--same-ids` while sheet shifts ahead are booked | A reused Shift ID would cancel real bookings and log it as the firm's own change | Refuse every replace; match rows by sheet too (parked: bigger change) |

### What the new tests prove

- **`tests/integration/sheets.connect.test.ts`:** connecting, the same sheet refused for a second
  firm (even switched off), replacing, `--same-ids`, switching off, letting go, the default columns
  put back, and the app unable to add, remove or re-point a sheet (it can still update the sync's
  status).
- **`tests/integration/sheets.sync.test.ts`:**
  - a US sheet isn't read at all; the office is told once, in plain words; once it's set to UK,
    syncing works again;
  - a sheet switched to US after syncing well changes nothing;
  - the locale request refused fails like any read;
  - one locale request per sync.
- **`tests/unit/sheets.transport.test.ts`, `env.test.ts`, `sheets.google.test.ts`:** the switch, the
  key file (errors never quote it), the locale request, and Google's 400.
- **`tests/integration/rls.every-table.test.ts`, `tenancy.isolation.test.ts`:** the app's exact
  rights on every table and column. The one cross-firm index has its own check that the app can't
  write it.
- **`tests/integration/onboarding.test.ts`:** `firm:check`'s rota line for a sheet never synced,
  failing, and synced. **This found an older bug:** `firm:check` crashed for any firm whose sheet
  had ever synced. The cause: a raw database read got the time back as text, not a date. Fixed.
- **The tests catch the bugs:** the locale check, the app's limited rights, the key-file rule and
  the replace guard were each broken on purpose, and their tests failed.

### Parked, open, and things that need Dylan

- **Your step:** "Connect the real Google Sheets" in the `PLAN.md` Parking lot. It needs a Google
  Cloud account (free for this). Step 7 tries it on your computer with a test sheet and Northline's
  demo workers. On the server it also needs Twilio first, because the worker that runs the sync
  only starts there once Twilio is connected.
- **Dylan to confirm (in `PLAN.md`):**
  - what switching a firm's sheet off should do to its shifts ahead (today they freeze);
  - the Google line added to the sub-processor list in `docs/compliance.md` (for the solicitor).
- **Parked:**
  - dates in a UK sheet with their own month-first format, or typed before the locale was changed;
  - US-format dates in CSV imports;
  - matching sheet rows by which sheet they came from;
  - proof of ownership, if an office screen for the sheet is ever built;
  - the Google quota at about 20 or more Sheets firms.

### How to see it working

Without a Google account, the tests show it:
`npx vitest run tests/integration/sheets.connect.test.ts tests/integration/sheets.sync.test.ts`
(with the database up: `npm run db:up`). With one, follow step 7 of "Connect the real Google
Sheets" in `PLAN.md`.

## 2026-10-04 — Phase 10, task 11: imports read what the file says

- **Time spent:** 1.1 hours (started 01:13 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=85a25dcf7c005571 e2e=true`
  (2,988 tests, 51 browser tests). The first run failed on the same older flaky test as in task 9
  (it sometimes fails for timing reasons, not because of this task's code). The second run passed
  with that test unchanged. Its fix is parked, now marked "fix it soon".
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M11, M15, M16, L39, L67, L68, L69, L70, L71, L78.
- Commit `2dcbf52`, pushed to `build/overnight`.

### What was built, in plain words

Firms send spreadsheets of workers, licences, shifts and pay. The **import** reads them into the
app. The audit found ten ways a file could be read wrongly. Now:

- **An Excel date keeps its day.** A licence expiring "12/06/2027 23:59:59" used to be read as the
  13th, one day too long. The day is now taken before the time is rounded.
- **Pay amounts with a space are refused.** "12 50" used to become £1,250.00. Now it's refused, and
  the row is reported.
- **"Marked as filled" stays filled.** If the office marked a shift filled with a place still free,
  a re-import used to open it again. Now it doesn't. When a re-import rightly opens a shift (more
  places than people booked), the action log says so.
- **Windows Excel CSV files work.** Excel on Windows saves CSV files in an older text format,
  **Windows-1252**, where "£" and accented letters are single bytes. Those files used to be refused
  outright. Now they're read. A file that would come out garbled (a Mac CSV, or a broken file) is
  refused with a message saying how to save it.
- **No more identity swaps.** Without a **Staff ID** (the firm's own number for each worker), rows
  are matched by mobile. A mistyped or recycled number used to rename someone else and hand them
  that person's licences and pay. Now:
  - a worker row matched by mobile must have the same name, or it's refused;
  - a licence or pay row without a Staff ID must give the worker's name too, and it must match;
  - a Staff ID whose name and mobile both change at once is refused (a Staff ID reused for a new
    person never gets the old person's record).
- **One set of rules everywhere.** Dates, shift times and mobiles are now read by the same code in
  the office's shift editor, the Google Sheets sync and every import:
  - **dates:** "Sat 7 Nov 2026" works everywhere; a wrong weekday or a made-up month is refused;
  - **shift times:** a finish equal to the start, 24 hours or more, or a time the clocks skip in
    March is refused, instead of becoming a day-long shift;
  - **mobiles:** a UK landline written as +44 20… is refused; a mobile cell that lost its 0 is put
    right on the sheet too.
- **Gate B, recorded.** Gate B is the rule that no real staff data goes in before a firm's
  agreement and data processing agreement are signed. A new owner command, `npm run firm:agreement`,
  records the day they were signed. On the live server, nothing is imported for a firm until that
  date is recorded: not through the office's import pages, not through `npm run import`, and no rota
  sheet is connected. Your computer's database is unaffected. `firm:check` shows it, and a date
  recorded on the wrong firm can be removed (`--clear`).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| A match by mobile alone needs the same name | Stops the swap; a real name change still has a route | A warning only; refusing every row without a Staff ID |
| Read Windows-1252 when a file isn't UTF-8, unless it looks garbled | That's what Excel on Windows writes | Refusing the file with a message (refused on day one) |
| Gate B as a recorded date per firm, checked inside the import | One check for the web and the terminal, with evidence | Typing the firm's name each time (no record) |
| Refuse equal, 24h+ and clock-skipped shift times | They were typos or clock-change accidents | Allowing 24-hour shifts |

### What the new tests prove

- **`tests/unit/imports.files.test.ts`:** a Windows CSV's "£" and accents; garbled files refused;
  23:59:59 keeps its day (in a real Excel file too).
- **`tests/unit/roster.shift-window.test.ts`, `sheets.parse.test.ts`:** the shift-time rule on both
  clock-change nights; the date reader; the sheet's mobiles.
- **`tests/integration/imports.test.ts`:**
  - a rename by mobile refused;
  - a moved number never hands one worker's record to another;
  - a reused Staff ID refused;
  - licence rows must name the worker;
  - "marked as filled" stays filled (using the office's own button);
  - a real reopen is logged;
  - an expiry date with a time.
- **`tests/integration/imports.gate-b.test.ts`:** on a live database the office's import, the
  terminal import and `firm:sheet` refuse to save until the agreement is recorded, then work;
  `firm:agreement` records, shows and clears, all logged.
- **`tests/integration/sheets.sync.test.ts`:** a sheet row that would rename someone isn't linked,
  and the office's action log says so.
- **The tests catch the bugs:** each fix was broken on purpose, and its test failed.

### Parked, open, and things that need Dylan

- **Dylan to confirm (in `PLAN.md`):**
  - checking (not saving) a real staff file on the live server before the agreement is recorded;
  - how to demo the web import on the live server (use a local copy).
- **Parked:**
  - an office "Change name" button;
  - a worker who changed number without a Staff ID still arrives as a second worker, and their old
    record keeps the old number;
  - a re-import's reopen doesn't restart offers;
  - US-format dates in CSV files;
  - the flaky test, now marked to fix soon.

### How to see it working

1. `npm run db:reset`, then `npm run db:seed`, then `npm run dev`.
2. Log in to `http://acme.localhost:3000/office` as `acme.admin@example.com`.
3. Shifts → "Import from a file": a CSV with "Sat 7 Nov 2026" in the Date column imports; one with
   09:00 to 09:00 says the times can't be the same.
4. `npm run -s firm:check -- --firm acme`: "Agreement + DPA signed" is still to do, with the command
   that records it.

## 2026-10-04 — Phase 10, task 12: the phone's copy of My shifts is gone after logout

- **Time spent:** 0.8 hours (started 02:24 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=b2b6735938795fc2 e2e=true`
  (3,004 tests, 53 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M27, L90, L91, L92, L93.
- Commit `ac37fe6`, pushed to `build/overnight`.

### What was built, in plain words

So that My shifts opens with no signal at a venue, the phone keeps a copy of that one page. A
small background script in the browser, the **service worker** (`public/sw.js`), keeps it and
shows it when there's no signal. The audit found five problems with it. Now:

- **Logging out mid-load leaves no copy.** On poor signal, My shifts could still be loading when
  the worker tapped Log out. The late answer then put their page back on the phone, for up to 14
  days. Now logging out (or in) first writes down the time. The service worker never keeps an
  answer to a load that started before then. Once the server confirms the logout, the copy is
  deleted a second time, to catch anything that started in between.
- **Slow signal shows the fresh page.** On slow but working signal, the old copy showed after 4
  seconds, wrongly labelled "No signal", and stayed there. Now the page watches for the fresh answer
  and swaps itself for it as soon as it arrives. The swap stops as soon as the worker taps anything
  or logs out, so it never throws away something they're doing.
- **Log out no longer depends on the build.** Log out used a "server action", whose hidden id
  changes every time the app is rebuilt. A copy saved before an update couldn't log out. Now it's a
  plain address (`/api/logout`) that never changes, so copies saved from now on keep working.
  ("Cancel this shift" still uses an action. Making its id stable needs a secret in the deploy, so
  it's a step in "Connect the deploy".)
- **No signal is said plainly.** Logging out with no signal used to fall into the general error page
  and leave the phone logged in, without saying so. Now the button stays and says: "No signal. You
  may still be logged in. Your shifts are no longer kept on this phone. Try again when you have
  signal." The copy is deleted either way. The logout gives up after 10 seconds instead of spinning
  forever on weak signal.
- **The privacy wording is complete.** When a worker is deleted or blocked, the copy on their own
  phone goes the next time that phone opens My shifts with signal. The erase notes, the privacy
  notice and the compliance notes now say so.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| A "forgotten at" time the service worker checks | Survives the service worker restarting; no messages to lose | A counter in the service worker's memory (lost on restart) |
| Delete the copy again after the server confirms the logout | Closes the gap where the session was still live | Only the first delete (the reviews showed the gap) |
| The page swaps to the fresh copy by itself, but stops at the first tap | Shows the truth without losing what the worker is doing | A banner with a button (the stale copy would stay unless tapped) |
| Log out as a plain route | It works across builds; same-origin only, like the push route | A stable action key alone (needs a deploy secret; parked) |

### What the new tests prove

- **`tests/unit/offline.sw.test.ts`:** the real service worker in a sandbox with a slow network,
  next to the page's real logout and login code:
  - a logout or login mid-load leaves no copy;
  - an answer being written as the logout comes is removed;
  - the fresh page replaces the stale copy, and "logged out" sends the page to the network;
  - a logout from the stale copy stops the swap and keeps nothing;
  - a tap stops it;
  - `/?fresh` with no signal shows the kept copy.
- **`tests/unit/portal.logout-client.test.ts`:** the order (copy, alerts, session, copy again), the
  10-second limit, and the wording.
- **`tests/e2e/offline.worker.spec.ts`:**
  - logging out with no signal shows the message, keeps it, and deletes the copy;
  - with signal it logs out and the session cookie is gone;
  - the logout address refuses other sites and other firms.
- **The tests catch the bugs:** each fix was broken on purpose, and its test failed.

### Parked, open, and things that need Dylan

- **"Connect the deploy" step (4):** a stable key for server actions (a GitHub secret), so "Cancel
  this shift" also works on a copy saved before an update.
- **Browser tests in production mode on your computer:** `verify.sh` runs them against the
  development server. There, a saved copy can't become interactive offline. So logging out from the
  copy itself is tested in the sandbox, and in GitHub's checks (which use a production build).

### How to see it working

1. The copy is off while developing: in `.env`, set `OFFLINE_COPY=on`. Then `npm run dev`, and log
   in at `http://acme.localhost:3000` as a demo worker (mobile 07700 900113, say; the login link is
   printed in the terminal).
2. In the browser's developer tools (Network tab), choose "Offline", and reload: My shifts shows,
   with "No signal."
3. Set it back to "No throttling" and reload. Then choose "Offline" again (don't reload) and tap
   "Log out". It says "No signal. You may still be logged in. …", and the copy is gone (reload
   while offline: the plain "No signal" page).
4. Back to "No throttling": reload, tap "Log out", and you're on the login page.

## 2026-10-04 — Phase 10, task 13: how long things are kept, and what a deletion removes

- **Time spent:** 0.8 hours (started 03:12 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=48b139963414f72a e2e=true`
  (3,020 tests, 53 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M24, L23, L30, L41, L85, L86, L87.
- Commit `a3c62e3`, pushed to `build/overnight`.

### What was built, in plain words

Every night a job, the **retention purge**, deletes personal data the firm has kept long enough. The
audit found it deleted more than your spec allowed, and that some of the words we show firms about
deleting a worker weren't true. Now:

- **Each firm has its own retention settings.** Three new firm settings, set by you with
  `npm run firm:settings` (the app itself can't change them):
  - `retention.message_days`: how long the shifts line's messages are kept (default 90, as in your
    spec);
  - `retention.request_note_days`: how long a request's words are kept after it's closed (default
    365, the "12 months" in your spec; the earlier build had quietly made it 90);
  - `retention.hold_until`: a **hold**, a date until which nothing personal is deleted, for a
    dispute or a tribunal.
- **An open request keeps its words.** The words go only from requests that are closed, and only
  once they've been closed for the set time.
- **Replies are kept with their own age.** A reply newer than the limit is kept, even when the old
  message it answered goes.
- **The office's override reason is out of the permanent log.** When the office places someone
  despite a rule, it types a reason ("Rang in, she can do it"). That used to go into the **action
  log**, which can never be edited, so a deletion couldn't clear it. Now:
  - it's kept on the booking itself, and the log only says a reason was given;
  - the shift's page and the notice report show it;
  - deleting the worker replaces it, and the nightly purge clears it after the set time.
- **The words about deleting a worker are exact.** The data page, the privacy notice and the
  compliance notes now say exactly what goes and what stays. That includes one thing they used to
  leave out: words other people wrote that name the worker (a colleague's swap request, say) aren't
  changed by deleting that worker. The data page shows the firm's real keep-times and any hold.
- **Twilio's copies are flagged.** Once Twilio is connected, it keeps its own copy of messages. The
  privacy notice's notes now say the "90 days" wording mustn't go to a firm until the job that
  deletes Twilio's copies exists.
- **A correction:** an earlier work-log entry (Phase 8, "GDPR") said the history kept after a
  deletion "holds no name or number". That wasn't true while the override reason was in the log.
  It is now for the reason; for other people's words, see above.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Defaults from your spec: 90 days for messages, 12 months for request words | The spec said so; the 90 for request words was never asked | Keeping 90 |
| Only you set retention (not a screen) | The app can't change firm settings; a hold matters legally | An office settings screen |
| A hold covers the whole firm | Simple and safe while there's one pilot firm | A hold per worker |
| The override reason kept on the booking | A deletion and the purge can clear it there | Keeping it in the log (can't be cleared); fixed reason codes (still an option) |

### What the new tests prove

- **`tests/integration/gdpr.retention.test.ts`:**
  - each setting is followed, by the database's own purge too;
  - unreadable settings fall back to the defaults;
  - a hold keeps everything personal, and the database agrees when it ends;
  - open requests keep their words, and a newer reply stays;
  - the override reason counts from when the person was booked;
  - one firm's settings never touch another's rows.
- **`tests/unit/gdpr.retention-settings.test.ts`:** the settings, and `firm:settings` refusing what
  the purge wouldn't use.
- **`tests/integration/booking.test.ts`, `office.shift-pages.test.ts`, `notice.report.test.ts`:**
  the override reason is on the booking, never in any log entry, and shows on the shift's page and
  in the notice report.
- **`tests/integration/gdpr.worker.test.ts`:** a deletion replaces the override reason and takes
  the staff ID out of the sheet record for shifts that have ended. A shift still ahead keeps it, so
  the next sync merges correctly.
- **`tests/unit/gdpr.copy.test.ts`:** the data page's exact words.
- **The tests catch the bugs:** each fix was broken on purpose, and its test failed.

### Parked, open, and things that need Dylan

- **Dylan to confirm (all in `PLAN.md`):**
  - the default keep-times, the 30-day minimum, and a firm-wide hold;
  - whether a hold should also stop an admin deleting a worker (today it doesn't; the runbook says
    to check first);
  - whether pay query text, cancellation notes and the office's answers should also go on a
    schedule (today they're only cleared when that worker is deleted);
  - the override reason as free text, or fixed reasons.
- **Before sending the privacy notice:** fill in the firm's own keep-times (the numbers in square
  brackets), and don't promise "90 days" for messages until Twilio's copies are deleted too.

### How to see it working

1. `npm run -s firm:settings -- --firm acme`: three `retention.*` lines (90, 365, none).
2. `npm run -s firm:settings -- --firm acme --set retention.hold_until=2026-12-31`, then open
   `http://acme.localhost:3000/office/data` as `acme.admin@example.com`: "How long we keep things"
   shows the hold. `--set retention.hold_until=none` ends it.
3. On a shift's page, assign someone the rules refuse for a day off, with a reason: the reason
   shows next to their name, and the History says only that a reason was given.

## 2026-10-04 — Phase 10, task 14: "Try again" on the error screens really tries again

- **Time spent:** 0.6 hours (started 04:02 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=a9acf6bcc3db0a8c e2e=true`
  (3,034 tests, 58 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit finding fixed: M4.
- Commit `a82e3a9`, pushed to `build/overnight`.

### What was built, in plain words

When a page fails (the database is slow for a moment, say), the worker sees "Something went
wrong" with a **Try again** button. The audit found that button didn't really try again. It
redrew the failure the phone already had, so the error stayed until the worker reloaded the page
themselves. Now:

- **"Try again" fetches the page again.** Next.js (the framework the app is built on) gives the
  error screen two functions: `reset()`, which only redraws, and `retry()`, which asks the server
  for the page again first. The button now uses `retry()`.
- **"Go to my shifts" always works.** It was a link that moves inside the app without loading a
  new page. On My shifts itself that did nothing, because the address didn't change. Now it loads
  the page afresh.
- **With no signal**, the screen says "No signal" and "Try again" is greyed out. When the signal
  comes back, the screen changes back to "Something went wrong" and the button works again.
  Without this, tapping it with no signal would have swapped our screen for the browser's own
  "no internet" page.
- **When the whole page fails** (its frame, not just its middle), "Try again" loads the page
  again. It works even if the page's code hasn't loaded, the same way Next.js's own error page
  does.
- **Test-only failures.** To prove all this in a real browser, the app has to fail on purpose,
  once. A setting, `E2E_TEST_PAGES`, switches that on. Only the browser-test run sets it, and the
  app refuses to start with it unless its address is `localhost` (your own computer). So it can't
  be switched on in a real deployment by mistake. With it off, the test page says "We can't find
  that page." and nothing fails.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The page's error screen uses `retry()` | Next.js's own docs say so; it asks the server again | `reset()` (the bug) |
| The whole-page error reloads the page | The frame failed, so nothing on it is worth keeping; Next.js's own whole-page error does the same; it works before the page's code loads | `retry()` there too (needs the page's code running) |
| "Try again" greyed out with no signal | Otherwise the browser's "no internet" page replaces ours | Leaving it on |
| The test-only switch refused off `localhost` | A test switch must never work on a real address | Trusting the setting alone |

### What the new tests prove

- **`tests/e2e/error-page.spec.ts`**, in a real browser:
  - a page fails once, and "Try again" brings it back;
  - "Go to my shifts" loads a fresh page;
  - with no signal the button waits, then works;
  - the whole page's frame fails once, and "Try again" brings it back;
  - a bad test address gives "We can't find that page."
- **`tests/unit/error-pages.test.ts`:**
  - each button is wired to the right thing;
  - the whole-page button works without the page's code;
  - the test switch is refused off `localhost`;
  - with the switch off, nothing fails;
  - no deploy or CI file sets the switch.
- **The tests catch the bugs:** each fix was broken on purpose, and its test failed.

### Parked, open, and things that need Dylan

- Nothing new to decide.
- One limit: the browser test shows "Go to my shifts" loads a fresh page, but not My shifts itself
  failing (that would need a test hook inside My shifts). Next.js's own code shows why a fresh load
  is enough.

### How to see it working

1. `npm run e2e -- tests/e2e/error-page.spec.ts` (stop `npm run dev` first): five tests pass.
2. Or by hand:
   1. Add the line `E2E_TEST_PAGES=on` to your `.env`. Your `APP_BASE_DOMAIN` must be
      `localhost:3000`, or the app refuses to start.
   2. Run `npm run dev`, and open `http://acme.localhost:3000/e2e/fails-once?id=try1`. You see
      "Something went wrong". In development, Next.js's own error box also opens over it: press Esc.
   3. Tap "Try again": "It worked this time".
   4. Take the line out of `.env` again afterwards.

## 2026-10-04 — Phase 10, task 15: a firm's own web address can hold a login

- **Time spent:** 0.7 hours (started 04:42 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=67c20d065ed86402 e2e=true`
  (3,045 tests, 60 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M7, L84.
- Commit `822ad34`, pushed to `build/overnight`.

### What was built, in plain words

A firm can have its own web address for the portal (`shifts.acme.co.uk`) instead of ours
(`acme.<our domain>`). The audit found that nobody could stay logged in on it. Whoever asked for a
login link there was sent a link to our address, so they ended up logged in on ours. The reason is
the **session cookie**, the small file the browser keeps to remember you're logged in. On purpose,
it belongs to exactly one web address, so one firm's address can never plant or read another's.

Now:

- **The login link goes back to where you asked.** Ask on the firm's own address, and your link
  is on that address. Ask on ours, and it's on ours. The same goes for workers (WhatsApp) and the
  office (email).
- **Safe against tricks.** The app never copies the address from the request. It only notes
  *which* of the firm's two addresses the request came in on, then takes the actual domain from the
  firm's own record. It uses that domain only while it's still marked verified, and otherwise uses
  ours.
- **The action log says so.** When a link went to the firm's own address, its log entry says
  `ownDomain`.
- **A real browser test logs in there**, as a worker and as an office user, and checks they stay
  logged in. That needed real https (the padlock), as a browser refuses to keep a secure session
  cookie on plain http for any name but `localhost`. So the browser tests now run a small https
  front for the made-up test address. It does the same job as Caddy, the web server that gives
  real addresses their padlock in production.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The link goes back to the address you started on | Sessions belong to one address on purpose | Every link on the firm's address once verified (parked: every message's links would have to move too) |
| The job is told only "portal" or "own domain", never an address | A forged request can't point a real link anywhere | Passing the address itself |
| Old queued jobs get our address | They still run after an update | Failing them |
| An https front in the browser tests | The only way a browser keeps the cookie there, and it matches production | A browser flag (tried: it doesn't let the cookie through) |

### What the new tests prove

- **`tests/integration/auth.own-domain.test.ts`:**
  - asked on the firm's address, the link is on it, for a worker and an office user, and it logs
    them in;
  - asked on ours, it's ours;
  - a domain no longer verified, or taken off, gets ours;
  - an old job gets ours;
  - the job refuses anything but the two words;
  - the log entry says `ownDomain` only when it went there.
- **`tests/e2e/custom-domain.spec.ts`:** a worker and an office user log in on
  `https://shifts.acme-events.test`. They stay logged in on other pages and a fresh visit, and
  the cookie is on that address only.
- **The tests catch the bug:** each fix was broken on purpose, and its test failed.

### Parked, open, and things that need Dylan

- **Before any real firm uses its own address** (a new item on the pre-pilot checklist in
  `docs/testing.md`): a daily re-check that the firm's address still points to us. Today it's
  checked only when you run `npm run firm:domain -- --check`. If a firm let its domain lapse and
  someone else bought it, the app would still send login links there until someone re-checked.
  The guardrails review caught this. Nothing is live and no real address is verified, so it's
  written down rather than built tonight.
- **Two logins:** links in other messages (offers, reminders) still go to our address. Someone
  logged in on the firm's address who taps one logs in once more there. Moving those links is
  parked.
- **Browser tests need `openssl`** (already on your machine and on GitHub's runners). They also
  now use port 3443 besides 3100.

### How to see it working

`npm run e2e -- tests/e2e/custom-domain.spec.ts` (stop `npm run dev` first): four tests pass. Two
of them log in on the made-up firm address.

## 2026-10-04 — Phase 10, task 16: the logs are safe and checked

- **Time spent:** 0.9 hours (started 05:27 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=eb9c4e444e29b60e e2e=true`
  (3,103 tests, 60 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M13, L11, L52, L53, L54, L64.
- Commit `bdaaa19`, pushed to `build/overnight`.

### What was built, in plain words

The **logs** are the lines the app writes about what it's doing, for you to read when something
goes wrong. Before anything goes in them, a **masker** hides phone numbers, emails and anything
after a `?` or `#` in an address (where login links carry their secret part).

- **The masker can't be used to slow the app down.** It uses **patterns** (rules for spotting a
  phone number or email). Two of them got much slower on very long text: a 16,000-character web
  address took the app about 0.3 seconds to mask. Anyone could send a few of those a second and
  stall the portal for every firm. Now:
  - every piece of text is cut to 2,000 characters before masking, and web addresses to 512;
  - the cut never leaves half a phone number or email behind;
  - every pattern reads the text once. On a 200,000-character string, the old email and URL
    patterns took 30 to 60 seconds; now 31 different attack strings each take a fraction of a
    second.
- **Every browser test run checks the servers' whole output**, and the run fails if it finds:
  - a phone number (now also before a full stop, glued to a word, or written with dots);
  - an email;
  - a **login token**, the secret part of a login link. The test console still prints login links
    on purpose (that's how you log in while developing), so each printed message now ends with its
    own line, and the check leaves exactly those out. Every token the run sent is looked for
    everywhere else too;
  - **any server error** the tests didn't expect. Before, errors were printed but the run still
    passed. The only errors allowed are the error-page tests' deliberate failures (task 14). Two
    kinds of failure used to leave no log line at all, and now log one: a web app error nobody
    caught, and a failed timed job in the worker.
- **The error seen on every run, "The destination stream closed early", is explained.** It means
  the connection closed before the page had finished sending. In the tests, a test ended while its
  page was still loading. In real life it's someone closing a tab or tapping away. It isn't the
  server failing, so it's now a warning, not an error.
- **Two old fixes now have tests:**
  - the setting that stops Next.js printing login tokens in its own logs;
  - the office search, which keeps what you type (a mobile number) out of the address bar.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Cut to 2,000 characters (paths 512) before masking | Plenty for any real message; a huge one costs nothing | Masking whole strings |
| The cut walks back over any half word or number | Half a phone number has too few digits to look like one | A fixed-size trim (the review showed it leaking) |
| Console prints keep login links | That's how you log in while developing; production refuses this transport | Hiding them (you'd lose the link) |
| A closed connection is a warning | It's a person leaving, not the server failing | Leaving it an error (failed every run) |
| A number glued to a word counts as a finding | It catches "Mob07700900123"; a rare false alarm is checked by hand | Skipping glued numbers (the old gap) |

### What the new tests prove

- **`tests/unit/log.masking-speed.test.ts`:**
  - 31 attack strings of 200,000 characters, each masked in well under a second;
  - a sweep putting the cut at every position inside phone numbers, emails, login links and
    encoded text, which never leaves anything unmasked;
  - login links glued to a word are still hidden.
- **`tests/unit/logs-scan.test.ts`:** the scan finds the new number shapes, glued emails and
  tokens, leaves IP addresses and decimals alone, and reads a 200,000-character line in one go.
- **`tests/unit/e2e.server-output.test.ts`:** the end-of-run check fails on a stray token, number
  or error, and passes a clean run.
- **`tests/unit/next-config.logging.test.ts`**, and the two browser search tests: the old fixes
  stay fixed.
- **The tests catch the bugs:** each fix was broken on purpose, and its test failed.

### Parked, open, and things that need Dylan

- **Nothing new to decide.**
- **Moved to task 19:** one more masker fix, found earlier and meant for this task, that I missed.
  A date with a time zone glued to a phone number (`…09:00:00+447700900123`) leaves part of the
  number showing.
- **Changed for you:** `npm run -s logs:scan` (your check of the server's logs after the dry run)
  now also reports login tokens. The runbook says what to do if it finds one.

### How to see it working

- Run `npm run e2e`. At the end it prints, for each server: "no phone numbers, email addresses or
  login tokens".
- While developing, each message the app "sends" is printed in the terminal and ends with
  `[messaging:console] end of message`.

## 2026-10-04 — Phase 10, task 17: the deploy and the runbooks work as written

- **Time spent:** 0.9 hours (started 06:23 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=59463b9885d76828 e2e=true`
  (3,126 tests, 60 browser tests).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M8, M9, L29, L38, L43, L50.
- Commit `5ea4711`, pushed to `build/overnight`.

### What was built, in plain words

The **deploy** is how a new version reaches the server. On the server, a small script
(`deploy.sh`) runs every 2 minutes, pulls the newest version and starts it. The **runbooks** are
your step-by-step instructions for the server. The audit found both had gaps you'd have hit on
your first go. Now:

- **Changing a setting works.** The server's settings live in a file called `.env`. Before, after
  you changed it (say, turning the worker on after "Connect Twilio"), the script saw no new version
  and did nothing, while telling you all was well. Now it applies the change. It says "Applied the
  settings in .env", and stays quiet when nothing changed.
- **A broken worker can't look fine.** The **worker** is the part that sends messages and runs the
  timed jobs. It now writes a "still alive" mark every 15 seconds, and the server checks it. A
  worker that keeps crashing never passes, so the deploy fails loudly instead of saying it worked.
- **"Deployed …" names the version.** Each version now carries the code change (the **commit**) it
  was built from, and the script prints it. The runbook's checks read that.
- **The web server's settings are checked by the real thing.** **Caddy** is the program in front of
  the app that handles the padlock (HTTPS). A test now runs the real Caddy on our settings file. It
  also checks a new **HSTS** header, which tells browsers to always use the padlock for a year,
  even if someone types the address without it.
- **The database connection is encrypted and checked.** In production the app talks to Amazon's
  database server over the internet. It now insists on an encrypted connection, and checks the
  server really is Amazon's, using Amazon's certificates built into the app's image. A production
  setting without this stops the app from starting, rather than quietly sending data in the clear.
- **The runbooks match the scripts:**
  - the trial run comes after Twilio and email are connected (its checks need an emailed office
    login), with a first step that creates a test firm;
  - rollback takes the version from the list of versions that actually exist, and pauses the
    every-2-minutes run while you do it;
  - the "first deploy" copies all six files;
  - notes on changing settings, turning the worker off, and when to rotate a secret;
  - the plan's count of AWS steps (9).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Same version: apply `.env` anyway (no database change) | Docker only changes what changed; quiet otherwise | Comparing settings by hand |
| A "still alive" mark for the worker | A crashing worker otherwise looked healthy | Watching restart counts |
| HSTS for a year, this address only | Each firm's address gets its own; "all subdomains" or the browsers' preload list are hard to undo | Longer, or preloaded |
| Encrypted and checked (`verify-full`) | Encrypting without checking lets an impostor answer | `require` (encrypt only) |
| The trial after Twilio and email | Its checks need an emailed login | Weaker checks |

### What the new tests prove

- **`tests/unit/deploy.script.test.ts`:** the real deploy script, with a stand-in for Docker:
  - a new version: database step first;
  - same version with a settings change: applied, no database step;
  - the worker turned on: started;
  - nothing changed: silent;
  - failures: loud;
  - event mornings: nothing touched.
- **`tests/integration/deploy.caddy.test.ts`:** Caddy reads our file, and its own configuration has
  HSTS, our certificate check, and the real IP passed on.
- **`tests/unit/deploy.database-tls.test.ts`:**
  - the server's settings ask for checked encryption;
  - production refuses an address without it;
  - the image's build settings pass that check (they didn't at first: the review caught a broken
    image build).
- **`tests/unit/deploy.compose.test.ts`, `tests/unit/worker.heartbeat.test.ts`:** the worker's
  health check passes only while its "still alive" mark is fresh.
- **The tests catch the bugs:** each fix was broken on purpose, and its test failed.

### Parked, open, and things that need Dylan

- **Dylan to check on the first deploy:** that the database step connects with the encrypted,
  checked connection. If it stops with a certificate error, don't remove the setting: tell
  Claude. Amazon says Lightsail uses these certificates, but it can't be tried from here.
- **Later:** pin the checksum of Amazon's certificate file once the first real image is built.

### How to see it working

`npx vitest run tests/unit/deploy.script.test.ts tests/integration/deploy.caddy.test.ts`: the deploy
script's cases, and Caddy reading the settings file (it needs Docker running, as the tests' database
does).

## 2026-10-04 — Phase 10, task 18: every decision waiting for you, in one place

- **Time spent:** 0.7 hours (started 07:16 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=39c7a3e1964edc01 e2e=true`
  (3,126 tests, 60 browser tests). Documentation only.
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: M26, L13, L36, L37, L59, L60, L89.
- Commit `94d475c`, pushed to `build/overnight`.

### What was built, in plain words

While building at night, I made many choices that would normally have waited for you. They were
written down wherever they came up, in different words, and the handover told you to find them by
searching for "Dylan to", which finds only some. Now there's one list:

- **`PLAN.md`, "Decisions waiting for Dylan"** (just above the Parking lot). 130 decisions in 10
  groups (legal, data, rules, messages, rota sheets, pay, office, deploy, how the build is run,
  product), each listed once. For each:
  - what to decide;
  - **what the app does now**, checked against the code (you can leave most as they are);
  - where to read more.
- **"When each one matters"** at the top: the ones you must settle by a given point, by stage:
  - before any real data;
  - when you create the accounts;
  - before submitting the WhatsApp templates;
  - before the first real import;
  - before a pilot;
  - before any Sheets firm;
  - when you deploy;
  - before any firm uses its own address;
  - before the pilot's data is a year old.
- **A short table of checks and to-dos** that aren't choices (pay the ICO fee, check prices, MFA,
  and Claude's few must-dos).
- **Who does each step** in "Connect Twilio", the WhatsApp templates, web push, Bedrock and SES:
  **You** (an account, a console, a phone) or **Claude** (code to write after you). Each also says
  plainly that the real sender for that service doesn't exist yet. Once your account is set up,
  expect a build round from Claude, not a switch to flip.
- **Out-of-date statements fixed:** the plan, the design decisions (ADRs), the rules and compliance
  docs and the work log had several things that were no longer true (for example "nothing, not even
  the owner, can delete the log" and "only 19 templates"). Each is now corrected, saying when and
  why.

### Worth knowing now

- **Two defaults nobody had flagged before:**
  - urgent messages go out during quiet hours (22:00–07:00) unless a firm turns that off, though
    the spec reads as "only if the firm allows it";
  - a worker who cancels gets only the on-screen confirmation, never a message.
- **Before any real data:** a real staff file can be checked (a dry run, nothing saved) on the live
  server before the agreement is recorded. The first pilot firm is your employer. Until you
  decide, don't check a real file there.
- **Before the pilot agreement:** check your own employment contract (who owns what you make
  outside work), since the first pilot firm is your employer.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| One section, grouped by subject, each decision once | Easy to work through; no repeats | One long list in date order |
| Every deadline as one exact tag, and a "when" list made from them | You can see what's due at each stage; a script checked they match | Free-text urgency notes |
| Checks and to-dos in their own table | They aren't choices | Mixing them in |

### What checked it

- **A fact-checker** checked about 140 statements in the section against the code. It found 3 to
  fix (one row mixed up two things; the "when" list didn't match the tags; one figure couldn't be
  checked). All fixed.
- **A completeness critic** confirmed every "Dylan to" line in the plan is in the list. It found
  14 smaller decisions missing, a few repeats, and rows that were really to-dos. All fixed.

### How to see it

Open `PLAN.md` and find "## Decisions waiting for Dylan". Start with "When each one matters".

## 2026-10-04 — Phase 10, task 19: walkthrough polish

- **Time spent:** 2.0 hours (started 08:03 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=7f05cb5e2e839a03 e2e=true`
  (3,243 tests, 60 browser tests).
- The independent auditor said `VERDICT: DONE`: all 17 findings PROVEN, no fakes found. It also
  ran `npm run build` itself: no brand errors.
- Audit findings fixed: L7, L8, L10, L15, L18, L20, L22, L28, L31, L32, L40, L44, L47, L49, L79,
  L82, L83, and the log masker's date problem moved here from task 16.
- Three review rounds before the check: two reviewers side by side, then a focused second look
  at the fixes. Every finding was fixed or put to you.
- Commit `11db2e3`, pushed to `build/overnight`.

### What was built, in plain words

These are the small things you'd have tripped over on your walkthrough.

- **A worker the office books is told.** Before, when someone in the office pressed "Assign", the
  worker heard nothing until the 24-hour reminder. Now they get a WhatsApp (or text): "Confirmed:
  Sat 7 Nov 08:00–16:00 at Riverside Arena (steward). Details and instructions: …". The office
  sees "They'll get a message to say so." It goes through a **job** (a task the background worker
  runs): it is sent at most once, waits for the morning if it's night and the shift isn't soon, and
  is logged. A worker who books themselves sees it on screen and gets no message.
- **It never crosses the office's other messages.** If the office books someone at night and
  then cancels or moves the shift, the worker gets one message that's true, not "you're booked"
  plus "your shift was cancelled" for a booking they never heard about.
- **Login links survive punctuation.** A phone can take the full stop after a link into the link,
  and the link then "expired". The message now has a space after the link, and the link page
  ignores anything after the code.
- **"The client needs fewer staff" means one place fewer.** Before, cancelling someone for that
  reason opened the place up again and, close to the start, offered it to others. Now the shift
  needs one person fewer and nobody is offered it. On a shift's only place it's refused: the
  office is told to cancel the whole shift instead. On a rota-sheet shift it's refused too: the
  places are set in the sheet.
- **A repeated phone call hears the same answer.** If Twilio sends the same call twice, the second
  time used to say "We've just sent a link" even if the first said "not now". It now says what the
  first said.
- **The sign-off is checked every time.** Messages end "{Firm} Shift Team". A sign-off that breaks
  that rule (a person's first name typed straight into the database, say) is never used, and the
  onboarding check (`firm:check`) shows it as still to do.
- **The baseline counts all 8 figures.** The onboarding check marked "Baseline numbers recorded"
  done after one figure. Now it needs all 8, and names the missing ones.
- **No firm can count other firms' activity.** Every action-log entry has a number from one counter
  shared by all firms. Seeing those numbers would let a firm guess how busy its competitors are. They
  no longer appear anywhere a firm sees: not in the log's "Older" link (that's now a scrambled code),
  not in the page's hidden data, and not in the data downloads (each file numbers its own entries
  1, 2, 3…).
- **The AI's pay line can only restate facts.** Payroll's email can carry one line written by AI
  per group of pay queries (no AI is connected yet). Golden rule 9 says pay disputes never get an AI
  answer. The check now allows only the facts and a short list of plain words, so "paid correctly",
  "underpaid" or "no hours missing" can't get through; the code's own line is used instead.
- **At most 10 login links a day per number** (and per office email). Before, someone could make
  the system send one number 288 messages a day, each one billed to the firm.
- **Smaller ones:**
  - `.gitignore` covers every `.env…` file;
  - `.env.example` lists every setting, with a test that keeps it that way;
  - "that week" wording on held shifts;
  - fair rotation's tie-break shuffles per shift (before, the same worker always won a tie);
  - `npm run firm:line` logs each change and accepts the firm name in any case;
  - `npm run build` no longer prints false "brand" errors;
  - a test's misleading name was fixed;
  - the log **masker** (it hides phone numbers in the server's logs) no longer mistakes a phone
    number written like a date, or glued to one, for a date.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Only office bookings send "Confirmed" | A worker's own booking is on their screen; each message costs | Message every booking |
| "Fewer staff" refused on the last place or a sheet shift | Leaving the place open let anyone take it | Leave it open but not offered |
| Daily cap of 10 links | Bounds cost; a login lasts 30 days | No cap; 5 a day |
| The AI pay line: an allow-list | A block list can't list every way to judge | No AI line at all |
| A scrambled "Older" code, and downloads numbered per file | The shared numbers must never reach a firm | Paging by time |

### What the new tests prove

- **`tests/integration/office.booked-notice.test.ts`:** the "Confirmed" message:
  - exact words, sent once;
  - a push to their phone;
  - held at night unless the shift is soon;
  - skipped and logged when cancelled first, the shift is over or the worker was deleted;
  - never crossing a move or cancellation;
  - a rota-sheet booking still told of a cancellation;
  - no other firm's booking.
- **`tests/integration/office.firm-change.test.ts`, `tests/integration/allocation.test.ts`:** "fewer
  staff":
  - one place fewer;
  - no offers;
  - the refusals;
  - the logged move of a booking;
  - fair rotation's hold isn't restarted.
- **`tests/unit/auth.link-fragment.test.ts`, `tests/unit/proxy.test.ts`:** links with punctuation
  after them still work.
- **`tests/integration/office.action-log.test.ts`, `tests/unit/office.log-cursor.test.ts`,
  `tests/unit/gdpr.event-numbers.test.ts`:** no shared numbers reach a firm; another firm's or an
  altered "Older" code is ignored.
- **Others:**
  - the AI pay line refuses 24 verdicts (23 in one list, plus "No hours missing"), and the code's
    own line passes for every kind of group;
  - the daily caps;
  - the repeated call;
  - the sign-off and the baseline;
  - `firm:line` run for real.
- **The tests catch the bugs:** each fix was broken on purpose, and its test failed.

### Parked, open, and things that need Dylan

- **Decide (in PLAN.md, "Decisions waiting for Dylan"):**
  - Office 10: the daily cap's trade-off. Someone who knows a worker's number can use up its 10
    links for the day, and that worker then can't get a new link until midnight (UTC). A phone
    already logged in keeps working.
  - Messages 27: confirmation messages.
  - Pay 9: the AI line.
- **Parked:**
  - an alert when someone keeps hitting the login limits;
  - an office "send them a login link" button;
  - a CSV re-import that puts back a place the office took away.

### How to see it working

With `npm run dev` running: log in to the office at `http://acme.localhost:3000/office`, open a
shift, choose someone under "Assign someone", then "Assign". The terminal where `npm run dev` runs
prints the "Confirmed: …" message within a few seconds (at night it waits for the morning unless
the shift is within 24 hours), and the shift's History says "{name} was told they're booked."

## 2026-10-04 — Phase 10, task 20: the local walkthrough pack

- **Time spent:** 1.4 hours (started 10:08 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=5abc35e06b8df306 e2e=true`
  (3,264 tests; browser tests: 60, then the walkthrough's 3 on a production build).
- The independent auditor said `VERDICT: DONE`: every claim PROVEN, no fakes found.
- Audit findings fixed: L16, L25, L58, L66, L88.
- Three reviews (guardrails, a fact-checker for the guide, an adversarial reviewer); every finding
  fixed.
- Commit `1173ded`, pushed to `build/overnight`.

### What was built, in plain words

This is everything you need to try the whole app on your own computer before you create any
accounts.

- **The guide, `docs/walkthrough.md`.** 43 numbered steps:
  - setting up on Windows with Ubuntu (WSL), Docker Desktop and Chrome or Edge;
  - every screen as a worker (four made-up people, each showing something different: taking and
    cancelling a shift, pay, a time change, an expired licence, the urgent shift);
  - then the office as resourcer, payroll and admin, and Northline's notice report;
  - the shifts line with the fake phone;
  - the app as the server will run it (the **production-mode run**: built once, faster);
  - a "found a bug" template to fill in for each problem;
  - a list of things that can go wrong, and what to do.
- **A fake phone.** `npm run sim:whatsapp`, `sim:sms` and `sim:call` play the part of a worker's
  phone. They send a WhatsApp, a text or a call (with a voicemail) to the app on your computer,
  signed the way Twilio signs, so the app treats them as real. The replies print in the terminal,
  as every message does locally. It refuses to talk to anything but your own computer.
- **More of the demo.**
  - Yesterday's event at Acme, with 5 bookings nobody has marked yet (so you can try "Who
    worked?").
  - 10 pay queries, 7 of them about one rate change (so payroll sees real groups).
  - Northline's night shift tomorrow, where the office cancelled someone at short notice (so the
    notice report flags it).
  - `npm run db:reset` now prints the urgent shift's link at the end, which step 18 uses.
- **Sample files for the imports.** `npm run walkthrough:files` writes a shifts file and a pay file,
  dated from today, so they're never out of date.
- **A browser test of the whole guide.** `walkthrough.spec.ts` does steps 10 to 40 in order, the
  office at desktop size and the worker at phone size. It runs on its own fresh demo (exactly
  what you have after `npm run db:reset`) and against a **production build**. So whenever the check
  runs with the browser tests, it now proves the production build works too, without changing
  `verify.sh`.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The walkthrough test in its own run, on its own fresh database | Other tests use up demo state it needs (the urgent shift, the office logins) | Sharing one run |
| That run serves a production build | Proves the build without editing `verify.sh` | Every browser test on a production build |
| The fake phone signs like Twilio and only talks to localhost | Same way in as the real thing; can't reach a real server | A test-only shortcut into the app |
| Sample files made by a command, dated today | The imports care about dates | Fixed files in the repo |
| Yesterday's event, not last Saturday's | "Who worked?" looks back 7 days; on a Saturday evening, last Saturday dropped out | Last Saturday |

### What the new tests prove

- **`tests/e2e/walkthrough.spec.ts`:** every step of the guide works as written, on a production
  build, day or night.
- **`tests/unit/fake-phone.test.ts`:**
  - the fake phone's messages are accepted by the real webhook code;
  - a wrong key is refused;
  - a call, its voicemail and its end are each signed for their own address;
  - it never talks to anything but a local server;
  - the command explains itself when given the wrong options.
- **`tests/integration/seed.test.ts`:**
  - the new demo rows, as the app would record them;
  - the notice report flags Northline's short-notice cancellation;
  - running the seed again a week later never books anyone twice at the same time (this failed
    before the fix).
- **The tests catch the bugs:** the fixes were broken on purpose, and their tests failed.

### Parked, open, and things that need Dylan

- **Try the walkthrough.** Open `docs/walkthrough.md` and follow it from step 1. Each step says
  what you should see. Use the template at the end for anything that doesn't match.
- **Decide (PLAN.md, "Decisions waiting for Dylan"):** make `verify.sh` build the app on every run,
  not only with the browser tests (`RUN_E2E=1`).
- **Still parked:** Northline's mocked rota sheet (it needs a Google account).

### How to see it working

Follow `docs/walkthrough.md`. Or, to watch the test do it: stop `npm run dev`, then run
`npm run e2e:walkthrough`. It takes a few minutes: it builds the app first.

## 2026-10-06 — Phase 11, task 1: closing "Design tokens and shared components"

- **Time spent:** 0.8 hours (started 14:19 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=c9c8f11123521d3f e2e=true`
  (201 test files, 3,395 tests, 0 skipped; browser tests: 60, then the walkthrough's 3 on a
  production build).
- The independent auditor said `VERDICT: DONE` on its second round. Every claim was PROVEN, and
  it found no fakes.
- Committed and pushed to `build/overnight` (the commit is named in `docs/overnight-log.md`).

### What this task was

Phase 11 was built in your desktop session (commit b3f3627). This run only had to **close** its
first task: prove it with the full check, then have the independent auditor agree. Nothing was
rebuilt.

The task covers the app's **design tokens** and **shared pieces**:
- A **design token** is one named colour, such as `urgent` (red, "act now") or `ink` (the main
  text colour). Pages use the name, never the colour code, so the look can change in one place.
- The **focus ring** is the outline that shows where you are when you move round a page with the
  keyboard.
- The **shared pieces** are small building blocks every page uses: button and field styles, the
  coloured status "chips" (such as "Open" or "Filled"), the page header and the menu icons.

### What happened

1. **The first check failed for a reason outside the code.** Every step said `'tsc' is not
   recognized`. The shell this session runs in skips the part of your setup that loads the Linux
   Node.js (through a tool called **nvm**), so Windows' own npm answered instead, and Windows
   can't run the project from the Ubuntu folder. Fix: each command now puts the Linux Node first.
   No project file changed for it.
2. **The check then passed, but the auditor said NOT DONE.** Everything was there and in use, but
   no test proved the colours, the focus ring, the file button, the chip colours or that the
   shared pieces stay simple (no **hooks**: React features that only work in the browser).
3. **One new test file fixed that.** Then the check failed once more, on two things:
   - the new file's layout wasn't in the project's standard format (fixed by the formatter);
   - an older test failed **at random** (explained below).
4. **The third check passed and the auditor said DONE.**

### The test that failed at random

`tests/integration/shifts-line.test.ts` makes sure a firm's WhatsApp number never lands in the
action log. It searched the logged rows for "44" or "7700". But each row also holds the firm's
**UUID**, a random id like `8ed173dc-…-7cf44beb3828`, and about one random id in nine contains
"44". So the test failed now and then for no real reason. The fix keeps the search on everything
except that id (the test already checks the id is the firm's own). It also searches the whole
rows, id included, for both test numbers in both ways of writing them. It's at least as strict as
before, and it no longer fails by chance.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Check the colours against `docs/ui-design.md`'s table both ways | Task 12A.1 will change the colours (dark mode); this way the doc and the code must change together | Writing every colour code into the test |
| Fix the random failure at its cause | Re-running until it passes hides a fault | Re-running the check |
| Put the Linux Node first in each command | Your setup is right for a normal terminal; only this kind of session misses it | Changing your `.bashrc` (not mine to change) |

### What the new tests prove

`tests/unit/ui.design-system.test.ts` (8 tests):
- the colours in `src/app/globals.css` are exactly the ones in the doc's table;
- the keyboard focus ring and the file-input button exist as described;
- every colour a shared piece uses really exists, so a misspelt name can't quietly show no
  colour;
- office buttons and fields are at least 44 pixels tall, and staff ones at least 56 (easy to tap);
- each of the four status chip tones has its own colours and its own icon;
- every menu icon draws something and is hidden from screen readers (the words beside it are
  what gets read out);
- the shared pieces have no hooks and use no outside code.

Before relying on it, I broke three things on purpose (a misspelt colour name, a changed colour
code and a planted hook). The test failed on each, and then the files were put back.

### What needs you

Phase 11's finish line says "every existing test passes unchanged". The random-failure fix
changed one existing test (above). The auditor called it a fix at the cause, not a weakening, but
said you should know about it when the phase closes.

## 2026-10-06 — Fixing GitHub's automatic checks (CI)

- **Time spent:** 0.9 hours (15:06 to 16:00 UTC), in the same run as Phase 11 task 1.
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=f420a29b18fd8877 e2e=true`
  (201 test files, 3,396 tests; browser tests: 60, then the walkthrough's 3).
- The `guardrails-reviewer` found one thing to fix first (below), now fixed. It found no golden
  rule broken and no test weakened.
- Not a PLAN.md task, so there's no tick and no auditor. The overnight rules say a red CI is fixed
  before the next task.

### What CI is, and what was wrong

**CI** ("continuous integration") is GitHub running the same full check on its own computers
every time the branch is pushed. It's a second opinion on a clean machine.

This session could read GitHub's results for the first time, using the Windows GitHub tool with
the repository's name. They showed that **16 of the last 23 runs had failed** since early on
4 October, even though the check on your computer passed every time.

GitHub keeps the check's logs from each failed run. Six tests were to blame, and they failed only
**at random**: often on GitHub's slower, busier machines, almost never on yours. That kind of test
is called **flaky**.

### What each one was, in plain words

1. **The licence-expiry scan (failed in 13 runs). A real fault, now fixed.** Each morning a
   "scan" warns workers whose licence is about to expire. Phase 10 split it into small steps
   (claim, send, record), so that nothing is undone after a message has gone. In doing so it
   accidentally dropped a **lock**: the rule that only one scan per firm runs at a time. If a scan
   was ever retried while the first was still running, the second could record the first's
   message as "sent, not confirmed" and lose the real result. A message that failed could even be
   logged as sent. The lock is back. It's held in a way that writes nothing, so Phase 10's point
   still stands. A scan now waits at most 5 minutes for another, then gives up and retries later.
2. **The Google Sheets sync timer (2 runs). A real fault, but asleep until Sheets is
   connected.** "Only one sync per firm per minute" was really "per 50-second window of the
   database's clock". So two checks a moment apart could fall either side of a window edge and
   both start a sync. Now the minute itself decides. This was already in the Parking lot as "fix
   it soon".
3. **Two "control" tests for logging out and refreshing a login (6 runs).** They show the *wrong*
   way to do it fails, by racing two requests. On a slow machine the two didn't always overlap,
   so the wrong way sometimes looked right. Now the test forces them to overlap every time.
4. **"A number no firm has" (2 runs).** Three tests use 07700 900499 as a number nobody has. Another
   test sometimes gave a firm exactly that number at random. Now it's a reserved number: those
   tests free it first, and the random ones stay off it.
5. **Two "nothing private in the log" checks (3 runs).** They searched for digits such as "44" or
   "468" and found them inside random ids, not phone numbers or pay. They now skip the id (which
   another line already checks exactly) and search the whole row for the real number or amount.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Fix the scan in the product, and put its test back to the stricter pre-Phase-10 version | It's a real fault that could make the log say a worker was warned when they weren't | Only making the test pass |
| Keep the lock in a separate step that writes nothing | Restores what the code promised, with no database change | A new "claimed at" column |
| Give up waiting after 5 minutes | A stuck scan can't tie up the worker's database connections | Skip silently if another scan is running |
| Fix the Sheets timer now | Parked as "fix it soon", and it turned CI red | Leave it parked |

### What the tests prove now

- I broke each fix on purpose and checked the test caught it:
  - with the scan's lock removed, its test failed 5 runs out of 5 (before: almost never on your
    computer); with the lock, it passed 8 of 8;
  - the old Sheets timer fails the new test;
  - a firm forced onto the reserved number makes the old version fail and the new one pass.
- The login race tests passed 6 runs in a row.
- On the database itself, a scan waiting for the lock really is stopped after its time limit.

### Parked (one line each in PLAN.md's Parking lot)

- The shift reminders' timer has the same fault as the Sheets one.
- Four other senders (login codes, login links, offer waves, the office's offer) may have the
  same "two runs at once" weakness as the scan. Each needs a two-at-once test.
- A note for when the server is chosen: the scan's lock is held for the whole scan, so don't set
  the database's idle-transaction timeout below that.

### How to see it

Open https://github.com/dylanquindonaghy-cpu/casual/actions while logged in to GitHub. The newest
run on `build/overnight` should be green (a tick).

## 2026-10-06 — Phase 11, task 2: closing "Office shell and menu"

- **Time spent:** 0.6 hours (started 16:02 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=6b73024cb4dd294c e2e=true`
  (203 test files, 3,399 tests; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its second round. Every claim was PROVEN, and
  it found no fakes.

### What this task was

The **office shell** is the frame around every office page once someone has logged in:
- the menu, grouped, showing only the pages your role can open, with the current page marked;
- on a phone, the menu is one row you scroll sideways;
- the footer, with your name, your role, the one "Log out" and the **session keeper** (a hidden
  piece that renews your login once a day while you use the office).

Phase 11 built it in your desktop session. This run had to prove it and get the auditor to agree.

### What happened

The first audit said NOT DONE. Most of it was proven, but four claims had no test:
1. a "page not found" in the office still shows the menu;
2. each browser tab reads "{page} · {firm} shifts", for example "Shifts · Acme Events shifts";
3. on a phone the menu row scrolls sideways;
4. the session keeper is in the footer.

I added tests for each, with no change to the product:
- **Two existing browser tests check more.** One checks the tab title and that the menu row is
  wider than the phone's screen and scrolls. The other checks that the not-found page still has
  the menu and one "Log out". I added to tests that already log in on purpose: each office email
  can only get 3 login links every 15 minutes, so new logins could trip that limit.
- **A new test checks every office page's title** against the list in `docs/screens.md`. A page
  can't lose its title, or get one the doc doesn't list, without the test failing.
- **A new test checks the footer.** It swaps the invisible session keeper for a visible marker,
  then checks the marker sits in the footer, once, after "Log out". I took the keeper out on
  purpose and the test failed, then put it back.

The second audit said DONE.

### What needs you

Nothing new for this task.

Separately, GitHub's check on the previous run's log commit failed on one more test that fails
at random (a login race test). That's next, in its own commit (see the next entry).

## 2026-10-06 — GitHub's checks again: four more race tests

- **Time spent:** 0.3 hours (16:36 to 16:52 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=8953bec54d3a0cdf e2e=true`.
- **Why:** GitHub's check on the earlier log commit failed on one more test that fails at random:
  a login-link race test.

Some tests prove a safety rule by also running the *wrong* way on purpose. This one sends ten
taps of the same login link at once, and expects the wrong way to let more than one person in.
That only shows if the ten taps really overlap. On GitHub's slower machines they sometimes
didn't, so the wrong way looked right and the test failed. It's the same fault as the session
tests fixed earlier today.

Four tests had this shape (login links, office login links, pay-page codes and the rate limit).
Each now makes all ten requests read first and only then write, every time. The halves that test
the real code are unchanged.

## 2026-10-06 — Phase 11, task 3: closing "Today"

- **Time spent:** 0.2 hours (16:54 to 17:08 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=77366fb18fe3408a e2e=true`
  (3,399 tests; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its **first** round. Every claim was PROVEN,
  and it found no fakes. Nothing needed fixing.

### What this task was

**Today** is the office's first page. It now opens with a row of **tiles**, one per section, each
showing a count (red while urgent things wait, amber when someone needs to act, calm with a tick
at 0). Each tile is a link down to its section. The nine sections come in the order things need
doing: urgent shifts first, as full cards with their buttons, then the shorter jobs; long lists
are compact rows.

### What proves it

`tests/unit/office.today-summary.test.ts` (12 tests) renders the real Today page with made-up
data. It checks that each tile links to its own section and uses the same words, the tile
colours and icons, the "50+" when a list stops at 50, and the order of the sections. The browser
test `tests/e2e/office.today.spec.ts` goes through Today in Chrome.

The auditor suggested one optional extra (a check of the card and row styles by name). It's not
needed for DONE, so I didn't add it.

## 2026-10-06 — Phase 11, task 4: closing "Office screens restyled"

- **Time spent:** 0.5 hours (17:10 to 17:42 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=f0a1ef023e547486 e2e=true`
  (204 test files, 3,401 tests; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its second round. Every claim was PROVEN, and
  it found no fakes.

### What this task was

Every office screen (shifts, requests, workers, the action log, the reports, pay queries, the
pay import, the office team, data requests and the office login) was restyled in your desktop
session to the rules in `docs/ui-design.md`. Each opens with the same page header, uses the
shared buttons and fields, and shows status words in their colour with an icon.

### What happened

The first audit found one real slip and one gap:
- **Four lists missed a small accessibility label.** A list with its bullets styled away needs
  `role="list"` in the code, or Safari's screen reader stops saying "list, 5 items". The action
  log, pay queries, the find-a-worker results and a worker's site blocks didn't have it. Added;
  nothing looks different.
- **No test checked the pages themselves**, only the shared pieces they use. A new test,
  `tests/unit/ui.office-pages.test.ts`, reads every office page's code. It checks that each one
  opens with the shared page header, and that every bare list has the label. With one label
  removed on purpose, it failed and named the file; then I put it back.

The second audit said DONE.

### Notes

The auditor made two small notes; neither is needed for DONE:
- the "Pay queries" page has its own "Import pay records" button, the same words as a menu link.
  `docs/screens.md` already records that as on purpose.
- a comment in the new test names a design-doc section by the wrong title. It will be corrected
  in the next run, inside that run's verify.

## 2026-10-06 — Phase 11, task 5: closing "Staff screens restyled"

- **Time spent:** 0.5 hours (17:44 to 18:16 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=dafb7e66ae2532a1 e2e=true`
  (205 test files, 3,404 tests; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its second round. Every claim was PROVEN, and
  it found no fakes.

### What this task was

The workers' screens (My shifts, open shifts, the urgent board, one shift, cancelling, requests,
pay, a pay query, the profile, logging in and the error pages) were restyled in your desktop
session. My shifts always shows "See open shifts" and a "Help" link, and its "Upcoming / Past 30
days" control looks like a two-sided switch.

### What happened

The first audit found the same thing as for the office screens:
- **Five lists missed the `role="list"` label** that Safari's screen reader needs (requests, two on
  pay, two on the profile). A sixth, the pay query's list of problems, had been marked as an
  "alert" instead, which hides that it's a list. Now the alert is a box around the list, so a
  screen reader still reads the problems out at once, *and* knows it's a list.
- **No test checked the staff pages themselves.** A new test,
  `tests/unit/ui.staff-pages.test.ts`, checks every staff page opens with the shared header (or,
  for logging in and the error pages, one main heading) and that every bare list has its label.
  It failed when I took one label off on purpose, then passed when I put it back.

Nothing a worker sees changed.

### Notes for later (not needed for DONE)

- "Log out" on My shifts and "Show shifts" on Open shifts use the office's 44-pixel buttons, not
  the bigger 56-pixel staff ones.
- Two places still name a red colour directly instead of the "urgent" colour token.
- Phase 12 redoes these screens (12A.1 removes every directly named colour; 12H.1 to 12H.3 build
  the casual app), so they'll be handled there.

## 2026-10-06 — Phase 11, task 6: closing the office how-to guide

- **Time spent:** 0.2 hours (18:19 to 18:33 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=30fa6a8c9c095cd0 e2e=true`
  (3,404 tests; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its **first** round. Every claim was PROVEN, and
  it found no fakes. Nothing needed fixing.

### What this task was

`/office/guide`, "How-to guide" in the office menu, walks through the everyday jobs step by step,
in the order of a working day: getting around, Today, filling a gap, adding shifts, changes and
cancellations, after a shift, requests, workers, records, pay, admin, and what workers see. Each
person sees only the parts their role can open: payroll gets getting around, pay and what
workers see.

### What proves it

`tests/unit/guides.test.ts` draws the real guide for each role. It checks the order of the parts,
which parts each role gets, one main heading, contents links that land on their parts, and no
sentence over 25 words. The auditor also checked by hand that every button name the guide
mentions really exists on a screen (all 79 do).

The auditor noted, without needing it for DONE, that no browser test opens the guide itself. The
unit tests draw the real page, which is a thin wrapper.

## 2026-10-06 — Phase 11, task 7: closing `/help` for workers

- **Time spent:** 0.2 hours (18:35 to 18:49 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=35884488b896e888 e2e=true`
  (3,404 tests; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its **first** round. Every claim was PROVEN, and
  it found no fakes. Nothing needed fixing.

### What this task was

`/help` explains the app to workers in plain words, in 11 short topics: how it works, your
shifts, taking a shift, urgent shifts, when you can't make it, changes, pay, your profile, no
signal, a lost phone, and your details. Anyone can read it without logging in. As planned, it
doesn't show the shifts-line number or a privacy notice link yet. Both wait in the Parking lot
until they exist.

### What proves it

- `tests/unit/copy.plain-language.test.ts` reads the page and fails on jargon, codes or any
  sentence over 25 words.
- `tests/unit/guides.test.ts` checks the page header, the contents links, that the page needs no
  login, and that there's no phone number, no privacy link and no buttons.
- The auditor checked by hand that every button the page names exists on a real screen, and that
  every time it states matches the code (the 15-minute link, the 10-minute code, 30 minutes on
  pay, the last 8 weeks of pay, and pay queries up to 90 days back).

The auditor noted, without needing it for DONE, that no browser test loads `/help` with no
login; the unit test checks the page's code instead.

## 2026-10-07 — Phase 11, task 8: closing the docs

- **Time spent:** 0.6 hours (10:12 to 10:50 UTC). Most of it went on setting up a new place to run
  the build (below). The 8 minutes the PC spent on this task before it stopped are not counted.
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=ed9c4f6cfc509e33 e2e=true`
  (3,404 tests; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its **first** round. Every claim was PROVEN, and
  it found no fakes. Nothing needed fixing.

### Why this ran somewhere new

The build loop runs inside a Claude Code session. Last night that session was on Dylan's PC, and
at 18:59 UTC the program on the PC stopped (the log says `host_exit`). That ended the loop, so
nothing ran overnight. This morning the work carried on in a **cloud session**: a temporary
Linux computer (a "container") that Claude Code runs on.

A new computer has to match the old one, or tests fail for reasons that have nothing to do with
the code. Four things were different, and each was fixed on the container only (no file in the
repo changed):

| What was different | What it broke | What was done |
|---|---|---|
| An older Node (the program that runs JavaScript): v22.22.0 | One test: a Mac CSV file wasn't refused, because that Node reads one byte (0x8E) wrongly | Installed v22.23.3, the same as the PC |
| No Docker (the tool that runs the test database and Caddy in boxes) | Four Caddy tests were skipped | Started Docker; Postgres runs on the container itself |
| An older test browser than Playwright (the browser-test tool) expects | Every browser test failed to start | Pointed Playwright at the browser that's there |
| Network rules: a "proxy" (a middleman for web traffic), and no automatic answer for names ending `.localhost` | The made-up firm domain and three tests that call `acme.localhost` failed | Kept `.test` names off the proxy; listed the firm names as "this computer" |

### What this task was

Phase 11's last task: the three docs that describe the new look had to match the code.
`docs/ui-design.md` explains the design system and the office menu. `docs/screens.md` describes
the office shell (the menu around every office page), Today, both guides and the new words.
`docs/walkthrough.md` says where the office's "Log out" is now: at the bottom of the menu.

### What proves it

The auditor read each doc against the code. It checked sizes, menu groups, the order of Today's
sections, about 60 quoted words from the two guides, and where "Log out" sits. Tests that read the
docs also passed: `ui.design-system.test.ts` checks the colour table both ways, and
`office.titles.test.ts` holds every office page's tab title to the doc.

The auditor noted, without needing it for DONE, that the doc's table of status words lists the
existing words, not every one ("Can log in", "Access off", "In a digest", "Offered" and "You're
booked on this shift" aren't in it).

### Phase 11 in total

All 8 tasks are ticked. Phase 11 took 4.8 hours over 10 rows of the Hours log. PLAN.md gave it no
estimate, so there's nothing to compare it with.

## 2026-10-07 — Phase 12, task 12A.0: the mock-up in the repo, and the made-up-data test

- **Time spent:** 0.3 hours (10:51 to 11:10 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=19b05e1debda6435 e2e=true`
  (3,409 tests in 206 files; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its **first** round, and found no fakes.

### What was built, in plain words

The approved design for Phase 12 (the "mock-up": one web page with made-up data that shows how
the new office should look) now lives in the repo at `docs/mockups/office-v2.html`. Dylan added
the file. This task did two things with it:

- **Labelled the role switch "mock-up only".** The page has a button that flips between the
  Resourcer, Payroll and Admin menus. That isn't a real feature, so the button now says
  "mock-up only" in its words, in the name a screen reader reads out, and in a tooltip. On a
  phone the words are hidden, so the screen-reader name and tooltip matter there.
- **Added a test that keeps the repo's data made up** (golden rule 7: no real people, no real
  employer data). `tests/unit/repo.made-up-data.test.ts` reads every file in `src/`, `drizzle/`,
  `tests/`, `docs/` and the seed, and fails if it finds an email address that isn't on a
  "reserved" domain. Reserved domains, like `.example` and `example.com`, can never belong to a
  real person; the internet standards set them aside for examples. It also fails on a UK postcode
  in the mock-up unless it starts `ZZ` (an area that doesn't exist).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| A short "allow-list" of 4 strings that only look like email addresses | Two are the `password@host` part of made-up database web addresses; two are a made-up Google service account in the format Google's key files use | Skipping every database address by a rule. Not taken: the task asks for a reviewed list, and 12X.1 removes the two database ones anyway |
| The test fails if an allow-list entry is no longer found | So the list can't quietly grow stale | Leaving old entries in |
| Version tags (`pg-boss@12.35.0`) and IP addresses don't count as emails | A real email's last part (`.com`, `.uk`) is letters only | Listing them on the allow-list |
| One test's address moved from a real-looking `.co.uk` domain to `a.b@mail.firm.example` | Same check (an email inside nested data is refused), on a reserved domain | Allow-listing it. Not taken: it really is an email address |
| The test file never holds a flagged address whole | It scans itself too, so its examples are built from two halves | — |

### What the new tests prove

Five checks, all passing: (1) every email address in the scanned folders is on a reserved domain
or on the allow-list; (2) every allow-list entry is still needed; (3) the mock-up's postcodes are
all `ZZ` (it has none today); (4) the role switch says "mock-up only"; (5) the checks themselves
catch a planted real-looking address and real postcodes, and let reserved ones through. Before
the verify, each of these was broken on purpose (an address added to a doc, a postcode added to
the mock-up, the label removed, an allow-listed address deleted) and the test failed, naming the
file. Each file was then put back.

### What needs Dylan

An employer's name can't be tested for without writing it into the repo. The task leaves that to a
person, once. Dylan removed one comment naming the tool the mock-up was modelled on when he
committed it. Please confirm nothing else in `docs/mockups/office-v2.html` (venue names, staff
names, wording) comes from your employer.

### How to see it

Open `docs/mockups/office-v2.html` in a browser. Tap the account button (top right) to switch
between the three menus.

## 2026-10-07 — Phase 12, task 12X.1: removing AWS from the image and deploy

- **Time spent:** 0.7 hours (11:11 to 11:55 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=304a53bc86b0760f e2e=true`
  (3,391 tests; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its **first** round, and found no fakes.
- Dylan said yes, in this session, to deleting the tests that only tested the removed scripts (the
  task asked for that to happen with him around, not overnight).

### What was built, in plain words

On 2026-10-06 Dylan decided against Amazon Web Services (AWS: Amazon's cloud, where the plan
was to rent the server, the database, the AI and the email sending). Nothing on AWS had ever run.
This task took every trace of it out of the code and the server setup, so the app can run at any
UK or EU company that rents servers able to run Docker (Docker: a tool that runs the app in
sealed boxes called "containers").

- **Deleted:** three scripts that would have created the servers, the alarms and the monthly
  backup check on Amazon's "Lightsail" service, and the two test files that only tested them.
  The four tests for the server's first-boot script (`deploy/cloud-init.sh`, which we keep) moved
  to their own file, checking the same things.
- **The database's certificate:** every connection to the database is encrypted, and the app
  checks it's talking to the real database by checking its certificate (a small public file that
  proves who the server is). The image used to download Amazon's certificates when it was built.
  Now the server keeps the host's certificate at `/opt/shiftdesk/secrets/db-ca.pem` (the place
  PLAN.md's "Connect hosting" already told Dylan to put it), and Docker hands it to the app,
  read-only. If the file is missing, Docker refuses to start, rather than starting with a check
  that can't work.
- **Settings:** the AWS settings in `.env.example` (the list of settings with safe example values)
  became the email (SMTP) and AI (Anthropic) settings that the next two tasks read.
- **Words:** comments in 9 source files, the setup guides (`docs/runbooks.md`), the architecture
  description and 7 other docs now describe "any UK or EU Docker host", "an SMTP email provider"
  and "the Anthropic API", without naming a company we haven't chosen.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The certificate lives in `secrets/` next to the compose file | It's where PLAN.md "Connect hosting" tells Dylan to put it | Beside the compose file; changed after the review found the plan said `secrets/` |
| Docker must refuse to start without the certificate | Otherwise Docker quietly makes an empty folder in its place, and the app fails later with a confusing error | Letting Docker create it |
| The guides name no hosting or email company | None is chosen yet (PLAN.md Deploy 8 and 9); each step says what to look for instead | Writing them for one provider |
| The privacy notice gets bracketed blanks for the host, the email company and where Anthropic processes data | They're filled in when the accounts exist, after checking Anthropic's terms (ADR-021) | Guessing names now |
| "Postgres in Docker" gets the principle only, not commands | That setup doesn't exist yet; commands for a service that isn't there would mislead | Writing them anyway |
| The new no-AWS test also checks `scripts/` and `.github/workflows/` | The phase's "Done when" covers "the code" and "the deploy files"; both are clean today | Only the task's list |

### What the new tests prove

- `tests/unit/no-aws.test.ts`: no AWS name, setting, web address, package or command anywhere in
  the code, the image, the deploy files, the setting examples or CLAUDE.md; the three scripts are
  gone; and its own patterns catch planted AWS lines (checked by planting one in each kind of file:
  each failed the test, naming the line, and was removed).
- `tests/unit/deploy.database-tls.test.ts`: every database address ends with the certificate check;
  the four services that talk to the database get the certificate read-only, and Caddy doesn't; the
  image downloads nothing and copies in no certificate.
- `tests/unit/deploy.compose.test.ts`: the exact list of files each service sees now includes the
  certificate (still exact, still read-only).

### What's parked or needs Dylan

- Your own `.env` (not in git) still has the old AWS lines. Copy the new email and AI lines from
  `.env.example` into it.
- `docs/business.md`'s monthly cost total doesn't add up from its rows; that was so before this
  task, so it's in the Parking lot.

## 2026-10-07 — Phase 12, task 12X.2: email over SMTP

- **Time spent:** 0.8 hours (11:56 to 12:43 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=352aa266fa01cf4a e2e=true`
  (3,424 tests; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its **first** round, re-ran the email tests
  itself (33 of 33), and found no fakes.

### What was built, in plain words

The app can now send real email. Until today it could only print emails on the screen (the
"console" sender, for development and tests). The new sender uses SMTP, the standard way programs
hand email to an email company (the "provider": Gmail, Microsoft and the email services all
accept it). It sends every office email: login links, the payroll digest, alerts and, later, strike
evidence. It's switched off until you choose an email company and put its details in the server's
settings ("Connect an email provider (SMTP)" in PLAN.md).

- **Encrypted, always.** Port 465 starts encrypted; any other port must switch to encryption
  (STARTTLS) before anything else is said. A server that can't encrypt gets nothing.
- **Not sent, or maybe sent?** When sending fails, the app needs to know which: if the email never
  left, it's safe to try again; if it may have arrived, it must never be sent twice. The line is
  the moment the app says `DATA` ("here comes the message"). The library used (nodemailer) gives
  every timeout the same label, so it can't tell; the new sender watches for `DATA` itself.
- **Settings:** `EMAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (a password,
  given only to the worker, never the website), `SMTP_FROM`. Production refuses the printing
  sender; tests refuse the real one.
- **Attachments:** the payroll list (CSV) and, later, PDFs, within limits that keep the whole email
  under providers' size caps.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Watch for `DATA` on the connection | nodemailer's labels can't say whether a timeout came before or after the message started (checked in its code) | Trusting its labels: would call a maybe-delivered email "not sent" |
| Pin nodemailer to exactly 10.0.15 | The watch relies on how it writes to the connection; the tests prove it for this version | A range of versions |
| One log line per failed email: the step and codes, never the address | The action log only says "couldn't be sent"; the runbook needs the reason | Logging nodemailer's own message (it can contain the address) |
| Keep nodemailer out of the website's bundle | The website sends no email | Letting it be bundled |

### What the new tests prove

A fake email server runs on the test computer itself (never a real one), with encryption and a
certificate made for the run. The tests make it stall, refuse or hang up at every step, and check
each failure is "not sent" before `DATA` and "may have arrived" from `DATA` on, within the time
limit. With the `DATA` watch switched off on purpose, exactly those "may have arrived" tests
failed; switched back on, all pass. Other tests pin every setting, the encryption rules, the email
as built (from, to, subject, body, a CSV and a PDF), the routing (email to SMTP, texts unchanged),
and that only the worker gets the password.

### What needs Dylan

Nothing now. When you pick an email company: follow `deploy/env.example`'s email lines and
`docs/runbooks.md` "Email not arriving" if something doesn't arrive.

## 2026-10-07 — Fixing CI after 12X.1

- **Time spent:** 0.2 hours (12:44 to 12:57 UTC).
- **Result:** `VERIFIED tree=ff1818814a9e8947 e2e=true`.

GitHub's automatic checks ("CI") failed on one test added in 12X.1. The test asked Docker Compose
to print the final setup and looked for the setting that stops Docker from creating a missing
certificate file. Different versions of Compose print that setting differently: GitHub's leaves it
out when it has its normal value. The app's setup was right all along (GitHub's Docker build and
browser tests passed); the test was reading the wrong thing. It now reads the setup file itself,
and was checked by breaking the file in the two ways that matter (both made it fail).

## 2026-10-07 — Phase 12, task 12X.3: Claude through the Anthropic API

- **Time spent:** 0.8 hours (13:03 to 13:52 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=b0d6a148d1b5719d e2e=true`
  (3,447 tests; browser tests: 60, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its **second** round. On the first it found
  everything proven except one thing: the safety review's result wasn't written in the log yet.
  It is now, and verify was run again.

### What was built, in plain words

The app can now ask Claude (Anthropic's AI) for its two small jobs: sorting an unclear WhatsApp
message into one of four labels, and writing a one-line summary for each group of pay queries. It
uses Anthropic's own library. It's switched off until you create an Anthropic account and key
("Connect the Anthropic API" in PLAN.md). Off or on, nothing the AI writes ever reaches a worker:
the label only picks one of the app's own fixed replies, and the pay line is checked and shown to
payroll under the app's own line.

- **Never stuck waiting.** Each question is asked once, never retried, and dropped after 5 seconds.
  If the AI fails, refuses, says nothing, or answers late, the app does what it does today without
  AI: unclear messages go to the office, and payroll sees the app's own line.
- **The key stays put.** The key goes only to the worker (the background program), never the
  website. Anthropic's library also looks at some settings on the computer by itself, one of which
  could send the key somewhere else or swap it. The app now fixes each of those itself: it only
  ever talks to Anthropic's own address, with a fixed set of headers and the key from the settings.
- **Logs without private words.** Each question writes one log line: what it was for, the model,
  how many tokens it used (which is what Anthropic charges for), and why it stopped. Never the
  worker's message, the answer or the key.
- **Settings:** `AI_TRANSPORT` (`none` until you switch it on, then `anthropic`),
  `ANTHROPIC_API_KEY` (a secret), `AI_MODEL` (Claude Haiku 4.5, `claude-haiku-4-5`, the cheapest
  and fastest). Tests refuse the real thing, and both test setups pin AI off.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The app's own `fetch` sends only Anthropic's address, fixed headers and the key | The library always reads `ANTHROPIC_CUSTOM_HEADERS` and adds them after the key header (found by the safety review) | Trusting the server's settings never to set it (they don't today) |
| Token counts logged as `usage` | The log hides any field with "token" in its name, to protect login tokens | Loosening that rule |
| No prompt caching | The instructions are a few dozen tokens; Haiku 4.5 only caches 4,096 or more, so it would do nothing | Adding cache markers anyway |
| Pin the library to exactly 0.131.0 | The tests prove the headers and settings for this version | A range of versions |

### What the new tests prove

A fake Anthropic answers inside the test (no internet). The tests check: an answer comes back; a
"too many requests" (429), a server error (500, 529), no reply in time, a reply that stalls
halfway, a refusal, an empty answer and a garbled reply each end in "AI unavailable" after exactly
one try; the model, instructions, message and limit are what's sent, to Anthropic's own address
with the settings' key, even when the computer's settings say otherwise; the log has only the
allowed fields; and when the AI is unavailable, the sorter and the pay summary fall back as
before. Each protection was switched off on purpose to check a test then fails.

### What needs Dylan

Nothing now. When you're ready for AI: follow "Connect the Anthropic API" in PLAN.md (an account,
a key in a workspace with a monthly spend limit, and the data-processing checks before switching
it on). One follow-up is parked there: before switching it on, make the shifts line stop asking
the AI for a while after a few failures in a row.

## 2026-10-07 — Phase 12, task 12A.1: colours and theme

- **Time spent:** 0.6 hours (13:58 to 14:29 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=4496138f8e10a157 e2e=true`
  (3,466 tests; browser tests: 63, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its **first** round and found no weakened
  test.

### What was built, in plain words

The app now has a dark mode, a new font and one set of text sizes. Nothing about how it works
changed.

- **Dark mode (navy).** Every colour now comes from a named "token", with a light value and a dark
  value. The dark one is the navy you chose (D7). A phone or computer set to dark mode gets it
  automatically. In the office, a moon/sun button will let people pick (that button comes in the
  next task); the choice is kept in a cookie and read by the server, so the page arrives in the
  right colours with no white flash. Light mode looks the same as before.
- **Readable in both.** A test measures every text-on-background pair in both themes against the
  accessibility rules (4.5:1 for text, 3:1 for borders and buttons). All pass.
- **No stray colours.** The 29 places that said "white", and the few that named a fixed grey or red,
  now use tokens. A test fails if anyone writes a fixed colour again (the firm's own brand colour
  is the only exception, and the brand bar looks exactly as before).
- **The font: Plus Jakarta Sans.** It's served from the app itself, so nothing is fetched from
  Google, and it includes the letters in names like Łukasz or Ștefan.
- **One set of sizes:** 12, 13, 15, 18, 24 and 30 pixels, and nothing else. Every number lines up
  (fixed-width digits), which helps with times and pay.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Keep today's light colours, add navy dark values | Light already passed its checks in Phase 11; D7 picked navy | Switching light to the mock-up's palette too (a bigger visual change, not asked for) |
| Font from its npm package, not Google's loader | Google's loader downloads the font during every build (a network need for each Docker build) | `next/font/google` |
| Office fields 18px on touch screens | iPhones zoom into any field under 16px; 18 is on the scale | 15px everywhere (zooms), 16px (not on the scale) |
| Fixed-width digits on the whole page | "Every time, rate and count" is safest as one rule | Adding it to each number by hand |
| Staff result messages at 24px, headings at 18px | 20px isn't on the scale; results ("You're booked.") are a page's main message | 18px for everything |

### What the new tests prove

The contrast test checks every colour pair in both themes, that every colour has a dark value,
and that the dark values match your navy choice. A theme test checks the cookie is read correctly
(only "light" or "dark"), that no page uses a fixed colour or a size outside the scale, and that no
Google font is used. A browser test checks a dark cookie gives a navy page in the very first HTML
the server sends, a dark phone gets navy without a cookie, and a "light" cookie wins over a dark
phone. Screenshots at 375px and 390px in both themes were checked by eye.

### What needs Dylan

Nothing. Have a look in dark mode on your phone if you like: the casual pages follow your phone's
setting.

## 2026-10-07 — Phase 12, task 12A.2: office shell and menu

- **Time spent:** 0.8 hours (14:34 to 15:21 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=9d3423194bb3ef8c e2e=true`
  (3,477 tests; browser tests: 69, then the walkthrough's 3). The first full run failed 3 browser
  checks, all from this change (a test helper and an old phone-row check); fixed and re-run.
- The independent auditor said `VERDICT: DONE` on its **first** round and found no weakened
  test.

### What was built, in plain words

The office has its new frame, as in the approved mock-up's layout:

- **A top bar** on every office page: ShiftDesk's own mark with the firm's name under it, the
  moon/sun button (light or dark, remembered), and the person's initials. Tapping the initials
  opens a small menu with their name and role, the How-to guide and Log out. On logged-in office
  pages this bar replaces the firm's coloured bar (staff pages and the office login keep it).
- **The menu in five groups:** Operations (Today, Shifts, Requests), Pay, Records, Configuration
  and Help. Each role sees only what it can open. Later tasks add their pages here (Events,
  Cancellations, Enquiries, the pay dashboard, Strikes, Settings).
- **On a computer** the menu sits on the left. **On a phone** a "Menu" button opens it as a
  drawer from the side; tapping outside it, the cross, the phone's back gesture (Escape) or a link
  closes it. Keyboard users land back on "Menu", and nothing in a closed drawer can be reached by
  mistake.
- "Data requests (download or delete)" is now just "Data requests".
- Menu links can show a count (a red badge) without changing the link's name. The first real count
  (Pay queries) comes with the pay dashboard task.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| One menu that moves into the phone drawer while it's open | A drawer that is also the desktop sidebar is announced as a "dialog" to screen readers (checked in the browser) | Two copies of the menu; the drawer always holding the menu |
| The account menu as a native popover | It adds no extra role to every page (a `<details>` would break other tests), closes with Escape or a tap outside, and works before the page's scripts load | A `<details>` element; a custom script menu |
| "Home" for payroll at the top of the Pay group | Payroll has no Operations pages; the pay dashboard (next task) becomes their home there | Keeping it in a group of its own |
| Hide the firm's bar on logged-in office pages | The spec keeps it on staff pages and the office login; the top bar names the firm | Showing both bars |

### What the new tests prove

A new browser test, run with the phone set to light and again to dark, opens and closes the
drawer every way, checks the focus goes back to "Menu", presses Tab twelve times to prove nothing
in the closed drawer is reachable, switches the theme and reloads to prove it's kept with no
flash, and opens the account menu. The unit tests pin each role's menu, the current page marking,
the badge, the top bar and the account menu. Every browser test that used the old menu now opens
it the new way, and the checks that a link is missing open the menu first, so they can't pass by
accident. Screenshots at 375, 390 and 1280px in both themes were checked by eye, with no sideways
scrolling.

### What needs Dylan

Nothing. Have a look at the office on your phone: the "Menu" button is top left.

## 2026-10-07 — Phase 12, task 12A.3: pay dashboard

- **Time spent:** 0.7 hours (15:23 to 16:05 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=332b172e7f3b7c64 e2e=true`
  (3,490 tests; browser tests: 71, then the walkthrough's 3). The first full run failed 2 browser
  tests, both because payroll now lands on a different page; fixed and re-run.
- The independent auditor said `VERDICT: DONE` on its **first** round and found no weakened
  test.

### What was built, in plain words

Payroll now has a home page, the **Pay dashboard** (`/office/pay`). It's where payroll lands after
logging in (admins can open it from the menu too; resourcers can't).

- At the top: the firm's shifts-line number, "Import pay records" and "Send the digest now".
- **Four counts:** how many pay queries are waiting (and since when), when the next payroll
  digest email goes (and the last one sent, or any problem), how many were sorted this week, and
  the next pay date (from the imported pay records, or else the Friday after this week).
- **Waiting, grouped by likely cause:** the biggest groups, each opening Pay queries. "Pay
  questions never get an AI answer: they come here."
- **Recently sorted:** the last 7 days, one line per "Mark as sorted", with who did it, when, and
  the note the workers got.
- **In the top bar** (on a computer): "Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct", the pay week
  (Monday to Sunday, paid the Friday after), the same rule for every firm.
- **In the menu:** "Pay queries" shows a red number when queries are waiting.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| "Pay dashboard" replaces payroll's "Home" in the menu | It is their home now; admins get it too | Keeping "Home" |
| The pay-week pill only from 1024px wide | On tablets there's no room beside Menu, the name and the account button | Showing it on tablets and squeezing the bar |
| One row per sorting in "Recently sorted" | "Mark as sorted" handles a whole group at once, with one note | One row per query |
| Next pay date: imported pay dates first, then the rule | The firm's own dates are the truth when they exist | The rule only |

### What the new tests prove

Unit tests pin the pay week (week 41's label, a 53-week year running into January, today's week
across the clock change) and the next digest time (later today or the next digest day, 09:00 local
on both sides of the clock change, none when no day is chosen). An integration test on the real
database checks every count and section with made-up queries and pay lines, that another firm's
queries never show, that resourcers get nothing, and the menu badge. A new browser test logs in as
payroll and lands on the dashboard (with the shifts-line number, the counts and sections, the
badge, a group opening Pay queries), and checks a resourcer gets "not found".

### What needs Dylan

Nothing for this task. The next one (events and session fields) adds a database migration, so it
waits for you to see its plan first (CLAUDE.md).

## 2026-10-08 — Phase 12, task 12B.1: events and session fields

- **Time spent:** 1.2 hours (22:32 to 23:42 UTC), plus about 40 minutes earlier in the day for the
  planning research (four read-only readers, two draft plans, a merge and two reviews).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=3c827d74879f000f e2e=true`
  (3,548 tests; browser tests: 71, then the walkthrough's 3). It also passed once before the
  review's small changes.
- The independent auditor said `VERDICT: DONE` on its **first** round, found no fakes and no
  weakened test.
- Built at Dylan's request to work through the night without questions, so the schema choices
  below were made here and written down for him to confirm (normally he sees the plan first).

### What was built, in plain words

Shifts now belong to **events**. An event is a job, like "Cup final" or "Acme Demo Arena · Sat 10
Oct", and its shifts are its **sessions**. Each event and each session has a "show to casuals"
switch, on by default. (What the switches do for casuals comes in task 12B.4.)

- **A database migration** (a numbered script that changes the database's tables, run once on
  every database) adds the events table and seven new columns to each shift. It is the first
  migration that also changes existing data: it puts every shift that's already there into an
  **automatic event** for its site and day. The day is the shift's start in the firm's own time
  zone, so a 23:00 night shift belongs to the day it starts.
- **New rows from the Google Sheet or a file** join the same kind of automatic event. Nothing new
  is needed in the sheet or the file.
- **"New shift"** joins the automatic event too. **"Shifts for an event"** now asks for the
  event's name and makes a new event with it.
- **Each session's own details:** pay rate (in pounds an hour, saved as whole pence: "12 50" is
  refused, never read as £1,250, and so is anything over £1,000 an hour), post, meeting point,
  uniform and **extra requirements** (qualifications needed on top of the role's, picked from the
  firm's list). On "Shifts for an event", pay rate, post and requirements are per line; the meeting
  point and uniform are entered once for everyone.
- **A "Session details" form** on every shift's page sets them, on sheet and file shifts too. The
  sync and the import never change them. Once someone is booked, the extra requirements are
  locked (that person was checked against the old list); the other details can still change.
- **The log** records which details changed, by name: "requirements", never a name with
  "credential" in it (the log's privacy filter refuses those).

Key facts: on the demo data the migration put 48 shifts into 6 events, the biggest "Acme Demo
Arena · Sat 10 Oct" with 23. Events can't be deleted by the app, and only their switch can be
changed.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| An automatic event is found again by a key in its `planner_ref` ("auto:{site}:{day}"), with a database rule allowing one per site and day | The approved column list has no date column; the database rule holds for every writer, even two imports at once | A new date column (beyond what was approved); a lock in the code only |
| Every shift *must* have an event (the database refuses one without) | "Every session has an event" can't be broken by a later code path | Allowing empty and filling it in every writer |
| A shift whose date or site changes stays in its first event | The task says "for new rows"; moving it could change what casuals see without anyone touching a switch | Moving it (parked) |
| One automatic event per site and day, whatever the source | The spec groups by date and site only | One per source |
| "Shifts for an event" always makes a new event, its name required | The task says it "creates the event row" | An optional name |
| Pay, post and requirements per session; meeting point and uniform per event on that form | The mock-up: each session keeps its own pay, post and requirements | Every field on every line (a long form on a phone) |
| Requirements lock once someone is booked | The booked person was checked against the old list | Allowing it |
| Pay over £1,000 an hour is refused | A rate typed in pence ("1250") would show casuals £1,250 an hour | No upper limit |

### What the new tests prove

A new test builds a throwaway database at the version before this task, fills it with made-up
shifts (two firms, one in New York; a night shift; a shift at 00:30 on a summer night; the night
the clocks go back; a shift with no site; a site with a 200-character name; mixed sources; a firm
with no shifts), runs the new migration and checks every shift landed in the right event with the
right name. Breaking the migration on purpose made it fail. Other tests prove: the sheet sync and
the file import put new rows into automatic events, make none on a "check" run or a second run,
and never change a switch, a session detail or the event even when every column of the row
changes; two imports making the same event at once end up sharing it; the database refuses a shift
with no event, a duplicate automatic event, negative pay and over-long text; "Shifts for an event"
makes a named event; the session details save on native, file and sheet shifts and are logged by
field name; every new log entry passes the privacy filter; another firm's shifts and events stay
invisible (the isolation tests now include the events table). The browser tests fill in the event
name and save a pay rate and post.

### What's parked or needs Dylan

- **Please confirm** the schema choices in the table above (they're in `docs/overnight-log.md` too).
- **Don't put this on a live server without the next task (12B.3):** extra requirements are saved
  now but the rules only start checking them in 12B.3, which is next in this run.
- Parked: moving a session to its new day's event, an "event created" log entry, renaming automatic
  events with their site, an index for the events pages if needed.

### How to see it

On the demo (`npm run db:reset`, then `npm run dev`), log in to the office as the resourcer, open
Shifts → "Shifts for an event": there's an "Event name" box and, on each line, Post, Pay rate and
"Extra requirements". On any shift's page, "Session details" is below "Edit this shift".

## 2026-10-09 — Phase 12, task 12B.3: session requirements and CSAS

- **Time spent:** 0.6 hours (23:52 to 00:29 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=327a40223db14ea6 e2e=true`
  (3,565 tests; browser tests: 71, then the walkthrough's 3). The first full run had one browser
  test fail on a timing problem in the test itself (explained below); fixed and re-run.
- The independent auditor said `VERDICT: DONE` on its **first** round, found no fakes and nothing
  weakened.

### What was built, in plain words

The **rules engine** (the code that decides whether someone may take a shift) now checks a
session's **extra requirements**, the ones set in the last task, on top of what the role needs.
They're checked exactly like a licence: held, valid and in date until the session ends (a night
session needs it in date until the morning), suspended means no, and "applied for" counts only for
the SIA licences and only within the firm's allowance. Nobody in the office can override them.
This is what makes the extra requirements real: until now they were only saved.

The **security qualification list** (the "pack" a security firm starts with) gains **CSAS
accreditation** (police-granted community safety powers), a **manual handling certificate** and a
**CSAS officer** role that needs CSAS. CSAS only counts under the firm's own police scheme: the
office records it, and the rules doc now says why (Police Reform Act 2002, section 41).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| A CSAS officer needs CSAS only | A session that also needs an SIA licence adds it as an extra requirement | CSAS plus an SIA licence by default |
| CSAS and manual handling never count "applied for" | An accreditation in progress isn't one; only SIA licences may | Allowing it |
| No made-up expiry periods | Neither has a fixed national period; the date on the card is what counts | Inventing "3 years" |
| Offers already sent aren't cancelled when requirements change | Taking an offer runs the rules again with the new list, so nobody is booked wrongly | Cancelling them |

### What the review found and what was fixed

The safety review found a real gap: the firm's cap on how many people may work on an "applied for"
licence each day is protected by a lock, so two people booking at the same moment can't both slip
under it. That lock only looked at the role's requirements, not a session's extra ones. It now
looks at both, and a new test that makes two such bookings at exactly the same time proves only
one gets through (with the old code, both did).

The one browser test that failed was a timing problem in the test: payroll logs in, lands on the
office home page and is then moved on to the pay dashboard; the test opened the menu during that
move, and the menu closes when the page changes, so the link it looked for vanished. It now waits
for the pay dashboard first. (The same problem was fixed in two other tests in an earlier task.)

### What the new tests prove

Rules tests: an extra requirement refuses someone without it and lets through someone with it; one
that expires in the middle of a night session refuses; both lists are checked with a reason each; a
type needed twice is checked once; no rule for the role still refuses; a suspended or expired one
refuses and can't be overridden; "applied for" works only where allowed. Database tests: both ways
the app loads the rules (one booking, and the lists for Open shifts, urgent shifts and offers) pass
the extra requirements and agree; booking refuses, the office can't override, a holder books; the
day's "applied for" count includes them; the same-moment race described above.

### What's parked or needs Dylan

- Please confirm the decisions above.
- Parked: CSAS-specific wording when a casual is missing it (today: "Send it to the office to be
  checked"), and fair rotation holding a place for people who lack a session's requirement (only a
  delay, never a wrong booking).
- Existing firms get the new qualification types only when their pack is applied again; the demo
  gets them on `npm run db:seed`.

## 2026-10-09 — Phase 12, task 12B.4: what casuals see (the event and session switches)

- **Time spent:** 2.2 hours (00:31 to 02:44 UTC), including a pause while this session's
  container restarted (the database and Docker had to be started again).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=a251f05687384e0f e2e=true`
  (3,604 tests; browser tests: 71, then the walkthrough's 3), on the first full run.
- The independent auditor said `VERDICT: DONE` on its **first** round, found no fakes and nothing
  weakened.
- Committed as "Phase 12: What casuals see (12B.4)" and pushed to `build/overnight`. A checkpoint commit (`8e92424`, marked WIP) went first,
  before the safety review, so the work was saved; CI passed on it.

### What was built, in plain words

Since the last task, every shift (a **session**) belongs to an **event**, and both have a switch:
"show to casuals". This task makes those switches actually do something. A **casual** (a worker
on the staff portal) now sees a session only while **both** switches are on.

There is **one check** for this, in one file (`src/lib/roster/visibility.ts`), and every place a
casual can meet a shift uses it:

- **Open shifts**, the **urgent board** and the **count on the Home page** leave hidden sessions out.
- The **shift page** says "This shift isn't available." (Someone already booked still sees their
  booking; someone whose place was cancelled still sees "This shift was cancelled.")
- **Taking the shift** is refused (it reads as "gone"), and so is **"Ask the office to review"**.
- **Offers** stop: no automatic offers start (not after a dropout, not when marked urgent), one
  already queued stops itself, and the office's own "Offer to someone" is refused with a reason.

The office still sees hidden sessions and can still **assign** someone. **People already booked
keep their place.** Hiding is only about what casuals see, so it is kept out of the rules engine.

A new action, **`setShowing()`**, flips either switch. Only active admins and resourcers may use it.
Each change goes in the **action log** (the office's record of everything that happened) as
`event.shown`, `event.hidden`, `session.shown` or `session.hidden`, with who did it, in plain words
("Sam Rota hid the event from casuals. Anyone booked keeps their shift."). The switches themselves
appear on screen in the next task (12B.5); this task builds what they do.

### Key facts and numbers

- Showing a session again restarts offers for it if it is urgent, open, not started and has a place
  free. Nobody already offered it gets a second offer.
- **Locks** (a database's way of making two things happening at once take turns): a booking, a
  review request, an offer and an urgent mark each take a shared lock on the event, after the
  shift's lock. So switching an event off waits a moment for one that is mid-way, and anything after
  it sees the switch off. Only `setShowing()` takes the event's lock for itself, and it waits on
  nothing after that, which is why this can't deadlock (two things each waiting for the other
  forever).
- No database change: 12B.1 added both switches.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The office's "Offer to someone" is refused for a hidden session, and one queued before it was hidden isn't sent | An offer shows the session to a casual, and taking it would be refused anyway | Letting the office offer it |
| A casual's booking of a hidden session reads as "not found" | The shift page already treats it as missing | A new "hidden" reason |
| Showing a session or event again restarts offers for its urgent gaps with a place free | Otherwise an urgent gap shown again sits with no offers, and "Mark urgent" can't restart them (it's already urgent) | Leaving it to the office |
| The office's "still unfilled" escalation email still goes for a hidden session | It's for the office, which chose to hide it | Skipping it |
| The shift page heading for a missing shift is now "This shift isn't available." | The task asks for these words; it fits every missing case | Keeping "We can't find that shift." |

### What the review found and what was fixed

The safety review (the `guardrails-reviewer`) found no data leak between firms and no deadlock.
It did find two things to fix first. One: this log wrongly said showing again doesn't restart
offers (corrected). Two: "Ask the office to review" didn't check the switches, so a casual with the
page already open could still send a review for a hidden session (now refused). It also found three
should-fix items. Marking a session urgent at the same moment its event was being shown could leave
it with no offers (now each waits for the other). Showing a session inside a hidden event said
"Showing to casuals." (now it says casuals still can't see it). And no test proved the real paths
take the lock (now one does). All were fixed, plus the small ones. Three ideas went to the Parking
lot.

### What the new tests prove

`tests/integration/showing.test.ts` (31 tests, on a real database as the app's own user):

- Every path, run twice (with the event hidden, then with only the session hidden inside a showing
  event): open shifts, the urgent board and the Home count, the shift page, a former booker's view,
  taking the shift, the office assigning, a booked casual keeping the shift, review requests, no
  offers, and the office's offers.
- "A switch in progress": while an event is being hidden (not yet saved), a booking, an offer wave,
  an office offer, a review and an urgent mark all wait, then all see it hidden. Taking out any one
  of the locks makes this test fail (each was tried).
- `setShowing()`: logs who did what (nothing when nothing changes), only admins and resourcers,
  never another firm's event or session, and showing again restarts offers.

Unit tests cover the new log words, the result messages, the offer page's "hidden" message, and
that the new log entries pass the log's privacy check. Separately, each of the casual-facing checks
was removed one at a time to confirm a test fails without it.

### What's parked or needs Dylan

- Please confirm the decisions above.
- Parked: fair rotation's head start counts from when the session was made, not from when it was
  shown again; offers already sent stay waiting while a session is hidden (taking one is refused); a
  session's history page doesn't show its event's hide/show entries.
- Personal enquiry replies (12D.2) must use the same check when they're built.

### How to see it working

Nothing to click yet: the switches arrive on the events page in 12B.5. The tests above are the proof
for now (`npx vitest run tests/integration/showing.test.ts`).

## 2026-10-09 — Phase 12, task 12B.5: Events & sessions pages

- **Time spent:** 0.7 hours (02:47 to 03:31 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=e01fa339dae4a6e9 e2e=true`
  (3,625 tests; browser tests: 72, then the walkthrough's 3), on the first full run.
- The independent auditor said `VERDICT: DONE` on its **first** round, found no fakes and nothing
  weakened.
- Committed as "Phase 12: Events & sessions pages (12B.5)" and pushed to `build/overnight`. A
  checkpoint commit (`5e09708`, marked WIP) went first, before the safety review.

### What was built, in plain words

The office has a new page, **Events & sessions** (`/office/events`), in the menu where "Shifts"
used to be. Every **event** (a group of shifts, like "Raceday" or "Acme Demo Arena · Sat 10 Oct")
that still has a shift to come gets a **card**. A shift inside an event is called a **session**.

Each card shows:

- the event's name (a link to its own page), the place and the date;
- the event's **switch**: a toggle the office taps to show or hide the whole event from casuals
  (the previous task made hiding actually work);
- one tag, "Showing to casuals" or "Hidden from casuals", plus "Urgent, not filled" when a session
  is urgent and still has a gap;
- a line like "2 sessions · 3 places free" (or "Full");
- each session: the role, the times, "Urgent" on an urgent gap, a small chip per requirement
  ("SIA DS", "CSAS", "First aid"), "3/4 filled", then the pay per hour, post, meeting point and
  uniform when they're set, and a **"…" menu**: Offer a place, Assign someone, Mark urgent or Not
  urgent, Change or cancel. A session from a Google Sheet says to change it in the sheet.

**Tabs** across the top (All, Showing, Hidden, Urgent, not filled) are plain links, so the browser's
back button and sharing a link work.

An **event's own page** lists every session, past and cancelled ones too. Each has its own switch
with a name no other switch on the page has ("Show Door supervisor 08:00–16:00 to casuals"), who is
booked, and once it has started, the "Mark as worked" buttons.

Firms without a Google Sheet also get **"Add shifts"** and **"Import shifts"** at the top. The old
day-by-day shift list is still there, as **"All shifts by day"**.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| "Has a planner" means an enabled Google Sheet today | It's the only planner the app has now; the planner API comes later | Showing the buttons to every firm |
| "Add shifts" opens "Shifts for an event"; one shift on its own is under "All shifts by day" | The page is about events | A third button |
| The "…" menu is on each session, not one per card | Its actions are per session | One card menu asking which session |
| Requirement chips show the role's and the session's own, with short names for the known ones | That's what the rules check | Only the session's own |
| "Mark who worked" reuses the shift page's buttons | Same actions and checks, no new code paths | A link to the shift page only |
| At most 50 events, and 30 sessions a card ("+ N more sessions") | Keeps the page quick; the tabs narrow it | No limit |
| "Full" only when every session is booked to its places; otherwise "No places to offer" | A started or draft session isn't "full" | Always "Full" with nothing free |

### What the review found and what was fixed

The safety review found nothing that had to be fixed first: no data leak between firms, only
admins and resourcers can open the pages, and no pay record is ever read. Its eight "should fix"
points were all fixed. Among them: a test that could fail by chance about once in a hundred runs (a
number it looked for could appear inside a random id); browser checks that ran before a tab had
loaded; a draft session wrongly saying "Showing to casuals"; two sessions with the same role and
times sharing button names; and the "…" menu, which now lies over the row instead of making a
phone's page wider.

### What the new tests prove

- Unit tests (`tests/unit/office.events.test.ts`): the card's words, tags and summary; each switch
  label unique, even for two sessions alike; a session row with every field; a sheet's session
  can't be changed or cancelled as a whole; a hidden session isn't offered from its menu.
- Database tests (`tests/integration/office.events.test.ts`): each tab lists the right events; a
  card holds only sessions still to come; who is booked; only admins and resourcers (payroll and a
  disabled resourcer are refused); another firm's events and qualification names never appear;
  and a resourcer sees a session's pay per hour but never a pay record's figures.
- Browser test (`tests/e2e/office.events.spec.ts`): a resourcer switches an event off on its card;
  the casual's Open shifts no longer has it and its page says "This shift isn't available";
  switched back on from the event's page, it's back.
- The specs that clicked "Shifts" in the menu now click "Events & sessions".
- Checked by eye at 375, 390 and 1280 pixels wide, light and dark, with the "…" menu open: no
  sideways scrolling.

### What's parked or needs Dylan

- Please confirm the decisions above.
- Still parked: an index on `shifts (firm_id, event_id)` if the page slows down with many events.

### How to see it working

Run the app (`npm run dev`), log in to the office as `acme.admin@example.com` and click **Events &
sessions**. Switch an event off, then log in as a casual: its shifts are gone from Open shifts.

## 2026-10-09 — Phase 12, task 12B.7: Settings

- **Time spent:** 1.1 hours (03:33 to 04:37 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=25de968d6b219146 e2e=true`
  (3,674 tests; browser tests: 74, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its **first** round and found no fakes.
- Committed as "Phase 12: Settings (12B.7)" and pushed to `build/overnight`. A checkpoint commit
  (`7f32b90`, marked WIP) went first, before the safety review.

### What was built, in plain words

The office has a new **Settings** page (`/office/settings`), for **admins** only. Other office
people don't see it in the menu, and the server refuses them even if they type the address. It has
two sections.

**The strikes team's email.** Later in Phase 12, when a casual cancels late, a record of it (the
"evidence") is emailed to the firm's strikes team. This page is where an admin types that team's
address. An address someone mistyped mustn't get those records, so the address has to be
**confirmed** first:

1. The admin types the address and selects "Save and send a link".
2. A background **job** (work the app does a moment later, outside the web page) emails that address
   a link. The link works for 7 days.
3. Someone at that address opens the link and selects **"Confirm this address"**. Only then does
   the page say "Confirmed", and only a confirmed address can ever receive evidence.

The link is **signed**: it carries a code made with a secret key (an **HMAC**, a kind of tamper-proof
stamp). The code covers the firm, the address, which save of the address it was sent for, and the
expiry date. So a link that was changed, is out of date, belongs to another firm, or was sent for an
older address doesn't work. Opening the link alone confirms nothing (email scanners open links), so
it needs the button.

**The sites.** Each site (venue) is listed with its **postcode**, which an admin can change. A
change is refused while people are booked on sessions there that are still to come ("2 booked
sessions use this site: move them first"), because it would move their venue without telling them.

**One safe way to change settings.** A firm's settings also hold things only the owner may change,
like how long messages are kept. So the app's database login still can't change the settings
directly. Instead there's one **database function** (a small program kept inside the database),
`app_set_firm_setting`, which accepts only the strikes team's address and its confirmed time and
refuses everything else.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| A worker job emails the link, not the web page | Only the job runner holds the email password | Sending from the page |
| The link's key comes from the existing session secret, used only for this | One less secret to manage | A new secret |
| The address isn't in the link; it's checked against the firm's address when the link is used | A link for an old address can't confirm a new one, and the address never sits in a web address | Putting the address in the link |
| Anyone with the link may confirm (no login) | The strikes team needn't have office logins | Requiring a login |
| At most 3 links every 15 minutes and 10 a day per firm | Each link is an email to an outside address; same limits as login emails | No limit |
| A link that fails counts against the visitor's IP address (20 every 15 minutes, shared with login links) | Stops someone hammering the page with guesses | A separate limit |
| A postcode must be a UK postcode, stored like "LS1 4AP"; empty clears it | The travel task (12G.1) needs a real one | Free text |
| Only sessions that haven't started block a postcode change | The task's words; **a question for Dylan** in the Parking lot | Sessions under way too |

### What the review found and what was fixed

The safety review found one thing to fix first. A postcode change and a booking made at the same
moment could both go through: the change counted 0 bookings, a booking landed, then the postcode
changed under the new booking. The cause: the change locked the site, but bookings lock the
session, not the site. Now the change locks the site and its sessions still to come before
counting, so a booking in progress finishes first and a later one waits.

It also asked for, and got: the link checked for shape before the database is touched; the limits on
links and failed tries above; a test proving saving and confirming take turns; and a browser test
that can't trip on a retry. Smaller extras: a new migration (0037) makes the function stricter (a
confirmed time must be a real date and time, never a word like "now"); a link sent before the address
was removed and added back no longer confirms it; and the address box no longer fills in the
admin's own email.

### What the new tests prove

- Database tests (`tests/integration/settings.test.ts`, 28): the app's login can't change the
  settings directly, and the function refuses retention and every key outside its list; only active
  admins can save (a resourcer, payroll or a disabled admin can't); saving logs the key and never the
  address; the job emails the link once, and a second run sends nothing; a changed, expired, other
  firm's or old-address link is refused; the link limits and the failed-try limit work; two
  "same moment" tests with real database locks for the postcode and one for saving and confirming;
  only sessions still to come block a postcode change; another firm's sites never appear.
- Unit tests (`tests/unit/office.settings.test.ts`): the link's format and each way it can be
  refused, and the page's words.
- Browser test (`tests/e2e/office.settings.spec.ts`): an admin saves the address, the link arrives in
  the test outbox, someone confirms it, and the page says "Confirmed"; a site's postcode changes; a
  resourcer can't open the page.
- Breaking each fix on purpose made its test fail (5 checks).

### What's parked or needs Dylan

- Please confirm the decisions above, and answer the Parking lot question: should a session already
  under way also block a postcode change?

### How to see it working

Run `npm run dev`, log in at `http://acme.localhost:3000/office` as an admin, open **Settings**, type
an address and select "Save and send a link". The link appears in the terminal (the console outbox):
open it and select "Confirm this address".

## 2026-10-09 — Phase 12, task 12C.1: Strikes on cancel

- **Time spent:** 1.6 hours (04:40 to 06:14 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=cd9946580807a39e e2e=true`
  (3,741 tests; browser tests: 75, then the walkthrough's 3).
- The independent auditor said `VERDICT: NOT DONE` on its first round (a rule added after the
  safety review made one sentence of the task untrue, and five documents still described the old
  rule), then `VERDICT: DONE` on its second, after the fix. It found no fakes.
- Committed as "Phase 12: Strikes on cancel (12C.1)" and pushed to `build/overnight`. Two
  checkpoint commits (`774780a`, `2e44a6d`, marked WIP) went first, before the safety review.

### What was built, in plain words

A **strike** is a note against a casual who cancelled a shift late. Now, when a casual cancels a
shift **themselves** with **less than 48 hours' notice**, they get a strike. They don't get one
when:

- the office cancelled it (or the firm's rota sheet did);
- they gave 48 hours' notice or more;
- the office booked them onto it ("Assign"), even over a rest or hours rule;
- the office moved it, shortened it, or changed its role, site or pay after they booked.

The rule is one small **pure function** (code that only takes facts in and gives an answer back,
touching nothing else), `strikeDecision()`. It runs inside the same **transaction** as the
cancellation (a database unit of work that either all happens or none of it does), so a
cancellation that fails halfway can never leave a strike behind.

**What the casual sees.** When they tap "Cancel this shift", a box says what will happen, worked
out by the same rule, for example: "This shift starts in 26 hours. Cancelling with less than 48
hours' notice gives you a strike. Acme Events' strikes team gets a record of it. You have 0
strikes in the last 90 days." Then the four reasons, as before, and "Confirm cancellation" or
"Keep this shift". If the answer changes while they read it (the 48-hour mark passes, say),
nothing is cancelled and they see the new box. Afterwards: "Cancelled. Reference 4F2A9C1B. A
strike has been recorded. It counts until Sun 31 Jan." (or "No strike."), and "If something
stopped you, tell us what happened.", which sends their words to the office as a request.

**Health and caring.** When the reason was "I'm unwell" or "Family or caring", the strike is
flagged for a person to look at. Being unwell is **health data**, which the law protects more
strictly, so that flag lives only on the strike's own row. It is never written to the **action
log** (the permanent record of everything that happens), which only gets ids and hours.

**How long.** A strike counts for 90 days. Its record is deleted after 12 months by the nightly
clean-up, never while the firm has a "hold" for a dispute. The database login the app uses
can't delete strikes itself: only one small database function can, and it reads the firm's own
settings.

**Nothing happens automatically.** No fine, no block, no message. A person decides.

**Paperwork.** `docs/dpia-strikes.md` is a **DPIA** (data protection impact assessment: a
written check of the privacy risks and what reduces them), with a template each firm fills in.
It must be reviewed and signed before a real firm uses strikes.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| A booking with no record of who made it counts as the office's: no strike | A strike needs proof the casual took the shift | Counting it as theirs |
| "Changed after booking" is read from the action log by order of entries, not by clock times | The app's and the database's clocks can differ; the log's numbers only go up | Comparing times |
| A strike is only given against a warning that said so, of the current version | What the casual is told must be what happens | Trusting the page |
| The warning's stored time is when they confirmed with it on screen | The server can't know when someone looked at a screen | A time sent by the browser |
| The review flag and its reason stay on the strike row only | Health data mustn't sit in a log that's never deleted | Logging a "review" flag |
| The record goes at 12 months, and the owner can't set it shorter than the time a strike counts plus 6 months | The 6-month tribunal time limit | Only the clean-up checking |
| "Tell us what happened" is the existing "review" request, marked with the booking's reference | The task says no new columns or types | A new request type |
| Strikes are in the casual's data export | They're personal data about them | Leaving them out |

### What the review and the audit found

The safety review found one thing to fix first: a casual's "Tell us what happened" was mistaken for
a request to look again at a shift the rules refused, so the shift page could say "You asked the
office to review this" when they hadn't. Fixed and tested. It also asked for, and got: only the
current warning accepted; no strike without a warning that said so; strike records never deleted
while they still count; and no review flag in the log. Smaller extras: every cancellation by the
firm (one booking, a whole session, the rota sheet) now says "no strike" in its log entry, and the
warning now comes before the reasons.

The first audit round then found that the "kept 6 months past the end" rule made the task's
"deleted at 12 months" untrue for unusual settings. Now the settings themselves refuse a record
time that's too short, so the record always goes at the setting, and the documents say so.

### What the new tests prove

- Unit tests (`tests/unit/strikes.test.ts`, 26): every case of the rule and its edges (exactly 48
  hours is no strike, 47.99 is one), each warning sentence word for word, the done screen's words,
  the settings and their limits, and the log entry's words.
- Database tests (`tests/integration/strikes.test.ts`, 15): a real casual taking and cancelling a
  shift gets a strike with the right dates; the log holds no reason; the office's cancellations
  give none; office bookings and office changes are exempt; a stale or missing warning cancels
  nothing; a failed cancellation leaves no strike; one strike per booking; the app can't delete or
  rewrite one; the clean-up at 12 months, never during a hold, never another firm's; "Tell us what
  happened" once per booking; strikes in the data export.
- Browser test (`tests/e2e/strikes.worker.spec.ts`): on a phone, a casual cancels a shift 20 hours
  away (the strike warning, then a strike) and one 4 days away (no strike).
- Breaking each part of the rule on purpose made a test fail (6 checks).

### What's parked or needs Dylan

- Sign the DPIA before a real firm uses strikes, and have the firm fill in its part.
- The office's answer to "Tell us what happened" uses the usual "Your request … is approved/declined"
  message, which reads oddly here: a better wording needs a new WhatsApp template (Parking lot).
- There's no per-firm switch to turn strikes off (Parking lot).

### How to see it working

Run `npm run dev`, log in as a casual at `http://acme.localhost:3000`, take a shift that starts
within 48 hours from "See open shifts", then on "See my shifts" tap "Cancel this shift".

## 2026-10-09 — Phase 12, task 12C.3: Cancellation records

- **Time spent:** 1.4 hours (06:16 to 07:38 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=5e29fcfe183673f4 e2e=true`
  (3,761 tests; browser tests: 76, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its first round and found no fakes.
- Committed as "Phase 12: Cancellation records (12C.3)" and pushed to `build/overnight`. Two
  checkpoint commits (`330a680` before the safety review, `4ce9c60` with its fixes, marked WIP)
  went first. CI passed on both.

### What was built, in plain words

The office now has a **Cancellations** page (in the menu under Operations, for admins and
resourcers). It shows this week's numbers ("2 by casuals · 0 by the office", "0 strikes issued"),
three views as links (All, Under 48 hours, By the office), and the latest 100 cancellations, each
a link to its **record**.

A record is one cancellation with everything about it: who, which event and session (role, day,
times), the site, post, pay rate, requirements, meeting point, uniform, when it was booked and
cancelled, how (in the app, by the office, on the rota sheet), the notice, the reason, the strike,
and a **"Then"** line saying what happened next ("Place reopened and marked urgent · offered to 5
casuals · filled again by Ben Fraser at 22:02"). Nothing on these pages approves anything: a
cancellation is final when it's made.

Two **downloads**: the record as a **PDF** (a printable document) and the chosen view as a
**CSV** (a spreadsheet file). Neither ever carries a casual's own reason: it reads "Casual's own
reason (see ShiftDesk)", because "I'm unwell" is **health data** (information the law protects
more strictly) and these files leave ShiftDesk. The real reason stays on screen, for admins and
resourcers only. Every download is written to the **action log** (the permanent record of what
happens) as `export.downloaded`, with ids and counts only.

Key facts and numbers:

- The record has 23 fields; the CSV has §3.4's 22 columns and at most 20,000 rows (a bigger view
  is refused with a plain message, never cut short).
- The PDF uses **Noto Sans**, a free font with Latin, Greek and Cyrillic letters, so names such
  as Łukasz Ştefan, Олена or Δήμητρα print. The font files are cut down beforehand (about 196 KB
  each) and put in whole, because the PDF library's own trimming lost letters. A tiny second font
  (6 KB) has the "✓". A record's PDF is about 230 KB, in plain black.
- A record's **reference** is the first 8 characters of the booking's id. Two cancellations can
  share one (about 1 in 90 by 10,000 cancellations), so a shared reference lists both to choose
  from, and the PDF link always uses the booking's full id.
- Every cancellation now **records what became of its place** in its log entry, at the moment
  it happens: reopened (and which new row), not reopened because the session had started or the
  place was above the session's places, removed because the client needs fewer staff, or the
  whole session cancelled. "Then" reads that, instead of guessing later.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Noto Sans, cut down beforehand and put in whole; "✓" from a second tiny font | The library's own trimming drew blanks; Plus Jakarta Sans has no Greek and only some Cyrillic | Trimming at run time; Plus Jakarta Sans |
| The PDF is black only | No colours outside the app's design tokens (a test checks), and it photocopies well | Adding the PDF to the test's exceptions |
| Office reasons go out only if they're from the fixed list; other office words read "Office's own reason (see ShiftDesk)" | Older office reasons are free text and can hold health details | Every office reason as written |
| "Under 48 hours" uses the firm's strike notice setting | The view and the strikes agree | A fixed 48 |
| What became of the place is recorded by the cancellation itself | Guessing later from today's state could say false things (the safety review's main finding) | Guessing from slots and statuses |
| "Offered to" counts casuals offered the session until the session's next cancellation | Offers belong to a session, so a later dropout's offers go on its own record | Counting every later offer |
| A shared reference lists its cancellations; the PDF link uses the full id | Never hand over the wrong person's record | Showing the newest |
| Downloads only start from ShiftDesk's own pages | Another site mustn't make someone download, and be logged downloading, a file | No check |

### What the review and the audit found

The safety review found one thing to fix first: "The whole session was cancelled" was worked out
from the session as it is today, so a booking the office cancelled on Monday would read that way
if the whole event was cancelled on Tuesday. That would be false, in the PDF too. Fixed at the
source: each cancellation now writes down what happened to its place when it happens (see above).
It also asked for, and got: no "(the session had started)" without checking it; the right
replacement even when a booking moves to another place; downloads refused when another site starts
them; browser tests proving each download is logged and that payroll can't open them. Smaller
extras: the CSV counted first and built before it's logged, nothing cached, and a line on the
record saying the session's details are as they are now. The audit found nothing to fix.

### What the new tests prove

- Unit tests (`tests/unit/office.cancellations.test.ts`, 8): every field word for word; the export
  reasons (a casual's never leaves, the office's fixed words do); the "Then" line for all five
  outcomes; the CSV's columns, its escaping (a cell starting "=" can't run as a formula) and no
  "unwell" or "health"; the PDF read back as text: "Łukasz Ştefan", "✓ Yes", every session detail,
  the footer, the fonts put in whole; Greek and Cyrillic names; the log entry's words.
- Database tests (`tests/integration/cancellations.test.ts`, 11): the list, its counts and views;
  one record's every field and "Then"; a whole session, a place removed, one booking then the
  whole session, a session that had started, a place above the session's places, a booking moved
  to another place, a rota-sheet sync's removals, a later dropout; a shared reference; only admins
  and resourcers, only their own firm; downloads logged, no reason in the CSV or PDF.
- Six existing tests (cancelling, the office's changes, the rota-sheet sync) now also check what
  each cancellation recorded about its place.
- Browser test (`tests/e2e/office.cancellations.spec.ts`): on a phone, a resourcer opens
  Cancellations from the menu, a record, downloads its PDF and the CSV (each logged once), sees
  no Approve, Decline or Deny anywhere; a shared reference asks which one; another site's start is
  refused (403) and logs nothing; payroll gets "not found".
- Breaking things on purpose made a test fail each time (6 checks): the font trimming, the offer
  window, the same-transaction window, the shared-reference choice, the two "not reopened"
  reasons, and the other-site refusal.
- Checked by eye: both pages at 375px, 390px and 1280px, no sideways scrolling; the PDF rendered
  to an image.

### What's parked or needs Dylan

- `npm audit` reports 3 high advisories in Next.js, sharp and source-map-js (there before this
  task); updating Next.js needs its own task (Parking lot).
- The three older downloads (data export, a worker's export, the notice report) don't refuse
  another site's start yet (Parking lot).
- The production image carries the test-only packages (Parking lot).
- "Your planner" reads "No webhook set up" until the planner webhooks (12J), which also add "By
  your planner".

### How to see it working

Run `npm run dev`, log in as the resourcer (`docs/walkthrough.md` step 20:
`http://acme.localhost:3000/office/login`, `acme.resourcer@example.com`), then open Menu →
Cancellations. Click a cancellation for its record, and "Download PDF" or "Download CSV".
Cancellations from before this change read "Not recorded" on the "Then" line.

## 2026-10-09 — Phase 12, task 12C.4: Evidence email to the strikes team

- **Time spent:** 1.2 hours (07:41 to 08:55 UTC).
- **Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=73fed1b819424494 e2e=true`
  (3,800 tests; browser tests: 77, then the walkthrough's 3).
- The independent auditor said `VERDICT: DONE` on its first round and found no fakes.
- Committed as "Phase 12: Evidence email to the strikes team (12C.4)" and pushed to
  `build/overnight`. Two checkpoint commits (`32322d2` before the safety review, `e1901ef` with its
  fixes, marked WIP) went first. CI passed on both.

### What was built, in plain words

When a casual gets a **strike** (a note against them for cancelling late), ShiftDesk now emails
the firm's **strikes team** about it, with the cancellation record attached as a PDF. For example:

> **Strike: Kieran Doyle cancelled Steward at Acme Demo Racecourse with 15 hours' notice (ref
> B71E0C42)**
>
> Kieran Doyle (staff id N042) cancelled Steward · Raceday · Wed 7 Oct 10:30–18:30 at 19:05 on Tue
> 6 Oct, 15 hours before the start. That is under your 48-hour rule, so a strike was recorded
> automatically. It is their strike 2 in the last 90 days.

The email goes **only** to the address an admin saved on Settings **and confirmed** through the
link sent to it (built in 12B.7). Until then nothing is sent, and the strike waits. Once the address
is confirmed, the strikes that waited (and still count) are sent.

It never carries health details. The subject and body give no reason at all, and the PDF gives any
reason a casual picked as "Casual's own reason (see ShiftDesk)". The PDF also doesn't name whoever
filled the place afterwards.

**How it's sent safely.** The work is a **job** (a task the background worker runs, holding only
ids). It follows the same three steps as the app's other messages:

1. It writes down a **claim** ("I'm sending this").
2. It sends.
3. It writes down what happened.

So the same email is never sent twice by accident. If the email server provably got nothing (it
couldn't be reached), it tries again later: after 5 minutes, 30 minutes and 2 hours, 4 tries in
all. If anything else goes wrong, the email may have arrived, so it is **never** resent
automatically. Instead:

- Today shows it under **"Strike evidence"**, along with a reminder when the strikes team's
  address isn't confirmed.
- The cancellation's record shows **"Resend evidence"**, which an admin or resourcer can press
  after checking with the team. Every resend is written to the action log.

Key facts and numbers: 4 attempts at most; "held up" means nothing has happened for 4 hours; the
subject is at most 200 characters and always keeps the reference; 5 new kinds of log entry
(`strike.evidence_queued`, `_sending`, `_sent`, `_failed`, `_resend`), none holding the address.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| Each retry is a new job with its own claim | A plain retry would find its own claim and send nothing | The job runner's own retries |
| Strikes recorded before the address is confirmed are sent once it is | Otherwise the team never hears about them | Only new strikes |
| No full stop after the link | A full stop can end up in the link a phone opens (an older audit finding) | The spec's text to the letter |
| No reason in the email's words; the PDF has the neutral one | Nothing about health leaves ShiftDesk | A "Reason:" line |
| The PDF doesn't name who filled the place | The strike is about one casual; another's name has no part in it | Keeping the name (Dylan can choose this) |
| Only the newest series of attempts can send | A resend and an old attempt can't both go | Allowing both |
| The "Strike evidence" to-do lives on Today for now | Today's to-dos move to the dashboard in 12E.1 | Waiting for 12E.1 |

### What the review and the audit found

The safety review's main finding was about a test, not the code: the test meant to prove "nothing
goes to an unconfirmed address" ran a job that had already finished, so it never reached the
address check. Two new tests now prove it properly, including an address that was confirmed and
then changed. It also found ways an email could stay "Sending" forever; those now show on Today and
can be resent. Withdrawn strikes are never emailed. The wording says "Nothing was sent" only when
that's proven. The audit found nothing to fix.

### What the new tests prove

- Unit tests (`tests/unit/strikes.evidence.test.ts`, 15): §5.6's example word for word; the
  200-character subject keeps its reference and never cuts a character in half; the job's ids and
  key rules; the retry waits; every log entry passes the log check and reads in plain words; the
  record's evidence wording; the PDF's line without the replacement's name; the Today to-do (admins
  get a link to Settings, resourcers are told who can).
- Database tests (`tests/integration/strikes.evidence.test.ts`, 16), with a pretend email sender:
  - nothing goes before the address is confirmed (three ways); it goes once it's confirmed, once;
  - the subject, body and PDF for each of the four reasons, with no "unwell" or "health";
  - which of their strikes it is ("strike 2");
  - retries only when nothing reached the server; an unclear failure is never resent; a job that
    stopped part-way is never resent;
  - "Resend evidence": once, logged, admins and resourcers only, never another firm's;
  - only one series at a time; held-up and withdrawn strikes; another firm's strikes and to-dos
    stay apart.
- The email template is checked against `docs/messaging-templates.md` by the existing test.
- Browser test (`tests/e2e/office.strike-evidence.spec.ts`): on a phone, a failed email shows on
  Today, its record opens from there, and "Resend evidence" works; no sideways scrolling.
- Breaking each important rule on purpose made a test fail: 12 checks.

### What's parked or needs Dylan

- Real sending waits for "Connect an email provider (SMTP)" (Parking lot). Until then emails print
  to the developer console.
- Choose whether the emailed PDF should name who filled the place again (today: no).

### How to see it working

Run `npm run dev`. Log in as the admin and save a strikes team email on Settings, then open the
link printed in the dev window and confirm it. Log in as a casual, take a shift starting within 48
hours and cancel it: the email (with "Attached: cancellation-….pdf") appears in the dev window. On
Today, "Strike evidence" shows while the address isn't confirmed.

## 2026-10-09 — Phase 12, task 12C.5: Strikes page and the casual's strikes

**Time spent:** 1.2 hours (08:58 to 10:12 UTC).

**Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=61664385543570c8 e2e=true`.
That covers 3824 unit and database tests, 78 browser tests ("e2e": a real browser clicking
through the app) and the walkthrough's 3, all passing. The independent auditor said **DONE** in
round 1. The commit is "Phase 12: Strikes page and the casual's strikes (12C.5)", pushed to
`build/overnight`.

### What was built, in plain words

A "strike" is the record the app makes when a casual cancels a shift at short notice (built in
12C.1). This task gives the office a page to see them and act on them, and shows casuals their own.

- **The Strikes page** (`/office/strikes`). Only admins and resourcers can open it: payroll gets
  "not found". It has three views as links: Live (strikes still counting), Needs review (a strike
  still counting that the app flagged for a person to look at) and All. Each casual with a strike
  gets one card, with the most live strikes first. The card shows their live count, their latest
  strike (which session, how much notice they gave, until when it counts, and whether the evidence
  email went) and links to every one of their strikes. On a phone the cards stack. There's no badge
  on the menu.
- **Withdraw and Keep**, on each strike's cancellation record (the page from 12C.3, where all the
  details already are):
  - "Withdraw strike…" asks why (1 to 500 characters). The reason stays with the strike, visible
    only to admins and resourcers on that page. It never goes into the log (the app's permanent
    history), the PDF or the CSV. The strike stops counting at once, and the casual sees it as
    "Withdrawn by the office".
  - "Keep strike" marks a strike as looked at. If it was flagged, the flag goes.
- **The casual's Strikes**, on their Profile page. It says how many strikes count in the last 90
  days and what the rule is ("A strike is given when you cancel less than 48 hours before a shift
  starts."). Then it lists each strike: the session, when they cancelled and with how much notice,
  and a status ("Counts until Thu 4 Feb", "Withdrawn by the office" or "No longer counts"). Under
  one that still counts, "Tell us what happened" lets them explain. They never see the office's
  reason for withdrawing, or the review flag.
- **Deleting a casual's details** (erasure, a GDPR right) now also deletes the office's typed
  reasons for withdrawing their strikes. Who withdrew it, and when, stay.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The buttons sit on the strike's cancellation record, not on the list | Each strike is one record, so the person sees the full story before acting | Buttons on the list, which would still need choosing which strike |
| "Keep strike" works on any live strike not reviewed yet | If only flagged strikes could be kept, every "kept" entry in the log would quietly say "this person gave a health or caring reason". The log must never hold that | Leaving "kept" out of the log (but every change must be logged) |
| Withdrawing locks the casual's row first, and is refused once their details are deleted | Erasure works the same way, so the two take turns. Without this, a withdrawal running at the same moment as an erasure could save a new reason after the erasure | Dropping the reason quietly |
| Needs review only lists strikes still counting | An expired strike needs nothing done | Listing it until someone clicks |
| A casual's own data download includes the office's reasons for withdrawing their strikes | A subject access request (a person asking for their data) covers what the firm wrote about them | Leaving it out |
| When a withdrawn strike's evidence email had already gone, the record says to tell the strikes team | One line now. An automatic email needs its own template, so it's parked | Building that email now |

### What the new tests prove

- **Unit tests** (`tests/unit/strikes.page.test.ts`, 8 tests: small checks of one piece of code at
  a time) check every word on the page, the buttons' answers, the record's Strike lines (including
  the evidence reminders) and the Profile section drawn as real HTML. "Tell us what happened"
  appears once per session.
- **Database tests** (`tests/integration/strikes.page.test.ts`, 12 tests, on a real database as
  the app's own restricted user) check that:
  - the list's views and order are right, and nothing counts 90 days on;
  - a withdrawal needs a reason, keeps it off the log and lowers the live count;
  - Keep clears the flag, works once, and logs ids only;
  - erasure clears the reason, and a withdrawal after erasure is refused;
  - two people clicking at once can't both withdraw or both keep;
  - an erasure and a withdrawal at the same moment never leave a reason behind. Without the new
    lock this test failed 2 times in 3; with it, it passed 6 times in 6;
  - payroll and disabled users can't see or change a strike anywhere;
  - each firm only sees its own strikes.
- **Browser test** (`tests/e2e/office.strikes.spec.ts`), on a phone-sized screen: a resourcer
  opens Strikes from the menu, opens a strike's record, keeps it, then withdraws it with a reason,
  and the page shows it as withdrawn. Nothing scrolls sideways.
- **Mutation checks:** removing the erased check, removing the lock, or making Keep flagged-only
  again each made a test fail.

### What's parked or needs Dylan

- An automatic "this strike was withdrawn" email to the strikes team (Parking lot).
- When the action log's clean-up is built (Data 2), it should delete a strike's log entries along
  with the strike (Parking lot).
- The privacy assessment (`docs/dpia-strikes.md`) now covers the withdrawal reason and the "kept"
  entry. Dylan still needs to read and sign it before a real firm uses strikes.

### How to see it working

Run `npm run dev`. Log in as a casual, take a shift starting within 48 hours and cancel it (you'll
see the strike warning). Then log in to the office as an admin or resourcer and open **Strikes**
in the menu's Records group: the casual is there. Click their latest strike to open its record,
and try "Keep strike" or "Withdraw strike…". Back as the casual, open **Profile** to see the
Strikes section.

## 2026-10-09 — Phase 12, task 12G.1: Postcode look-ups and the casual's travel area

**Time spent:** 1.5 hours (10:15 to 11:47 UTC; about 5 minutes of it went on Dylan's TikTok check, below).

**Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=bedd0cf46cec94b7 e2e=true`. That covers 3884 unit and database tests, 79 browser tests and the walkthrough's 3, all passing. The independent
auditor said **DONE** in round 2. Round 1 asked for one thing: the planner API (task 12J.1, not built yet) must use this look-up too, so that is now written into 12J.1's task. The commit is "Phase 12: Postcode look-ups and the casual's travel
area (12G.1)", pushed to `build/overnight`.

### What was built, in plain words

A **postcode look-up** turns a postcode (like "ZZ1 1AA") into the map point at the middle of that
postcode's area (a latitude and longitude). Later tasks use those points to work out travel times
(12G.2) and to show casuals only the shifts they can reach (12G.3). This task builds the look-up and
lets casuals say where they travel from.

- **The look-up** (`src/lib/travel/geocoder.ts`). There are two versions:
  - **The fake**, used tonight and in every test. It knows only the made-up "ZZ" postcodes and
    gives each one a fixed point. For a real postcode it says "look-ups aren't switched on" rather
    than pretending the postcode is wrong.
  - **postcodes.io**, a free public service, for real use later. It sends the postcode and nothing
    else, waits at most 5 seconds, and checks the answer's shape before using it. Nothing was sent
    to it tonight. Its tests use answers written by hand in the shape its documentation shows.
  - A server setting, `TRAVEL_PROVIDER`, picks which one runs (`fake` or `traveltime`). Tests are
    locked to `fake`, and `traveltime` is refused whenever tests run.
- **Sites on Settings.** Saving a site's postcode now looks it up first and stores the point with
  it. An unknown postcode, or a look-up that fails, saves nothing and says why. Each site shows
  whether its location is known.
- **The casual's "Where you work"** (`/profile/travel`). They give:
  - a start-from postcode (it needn't be home);
  - how they travel: car, public transport or both;
  - how long they'll travel: 30, 45, 60 or 90 minutes.

  It's saved after the look-up. Profile shows a summary, and they can remove it. The page says the
  office only sees the first part of the postcode.
- **What the office sees:** only the district, like "Travel area: ZZ1 · 60 min, car", on the
  casual's page. The full postcode never reaches an office page or the firm's data download.
- **The action log** (the app's permanent history) records which settings changed and the time
  limit, never the postcode.
- **Deleting it:** the travel area is deleted when the office marks a casual "They've left", and
  when a casual's details are erased. It's included when a casual asks for a copy of their data.
- **A privacy assessment** (`docs/dpia-travel.md`) explains why this is fair to casuals (the
  "legitimate interests" test) and gives firms a template to fill in.

### Key facts and numbers

- A new database table, `worker_travel`, with one row per casual (migration 0040). It has
  row-level security, so each firm sees only its own rows.
- The app may only change the travel columns of a row. It can never move a row to another casual
  or firm.
- The look-up happens before the database is touched, never while rows are locked. A slow network
  can't hold anyone else up.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| No call to the real postcodes.io tonight; hand-written sample answers | The overnight rules forbid outside services; made-up data only | Fetching real answers |
| A postcode is checked as it's saved; an unknown one is refused | The person sees at once if they made a typo; nothing half-saved | Checking later in a background job |
| The fake says "switched off" for real postcodes, and Settings still saves them (without a point) | Calling a real postcode "unknown" would be false, and would have broken saving real site postcodes | Refusing them |
| The firm's data download has the district only | The office never sees more than the district | Leaving the table out of the download |
| Casuals can remove their own travel area | It's their postcode; with none, they see every shift | Only the office removes it |

### What the new tests prove

- **Unit tests** (`tests/unit/travel.geocoder.test.ts`, `tests/unit/travel.words.test.ts`) prove:
  - postcodes are tidied and their district is found;
  - the fake gives fixed points, and says "off" for real postcodes;
  - the postcodes.io code sends only the postcode;
  - it reads each kind of answer correctly, and treats anything odd, slow or too big as
    "unavailable";
  - `traveltime` is refused in tests;
  - every message ends as a plain sentence, and log entries never hold a postcode;
  - the owner's default time limit is accepted only as 30, 45, 60 or 90.
- **Database tests** (`tests/integration/travel.test.ts`) prove:
  - saving, changing (no look-up when only the limit changes), refusing an unknown postcode, and
    removing;
  - the office sees only the district;
  - deletion on "They've left" and on erasure;
  - a save that's mid-look-up when the casual is erased, or marked "They've left", never brings
    the area back;
  - another firm sees nothing;
  - site postcodes are saved with their point, including a site that a file import created.
- **Other updated tests:** the firm data download has the district only; the casual's own download
  has the full area; erasure deletes it.
- **Browser test** (`tests/e2e/profile.travel.spec.ts`, on a phone-sized screen):
  - a casual tries an unknown postcode (nothing saved), saves a real one, and reloads;
  - the office's page for them shows "ZZ1 · 60 min, car" and never "ZZ1 1AA";
  - the casual then removes it.

  The Settings browser test now checks an unknown postcode, and "Location found." after a save.
- **Break checks:** breaking each important rule on purpose (10 checks) made a test fail.

### What's parked or needs Dylan

- **Connect postcodes.io and TravelTime** (Parking lot, with numbered steps). Until then, real
  postcodes can't be placed.
- **Decide** whether each firm switches travel areas on for itself.
- A casual already made inactive by a sheet, or blocked, keeps their area until erased (parked,
  with two ways to fix it).
- **Sign** `docs/dpia-travel.md` before a real firm uses travel areas.

### Also this session: the TikTok check Dylan asked for

Read-only, nothing changed. The Velora shop's TikTok connection is live: an active ad account
(GBP, UK), the Shopify pixel (active, tracking views, cart, checkout and purchases) and a catalogue
with 2 approved products. Two things to fix before ads: the only TikTok profile linked to the
Velora ad account is @sottaband1 (the Sotta account), and the account has no funds or payment
method. Smaller: the product description holds drafting notes, the product's web address has "™"
in it, no product category is set, and business verification isn't submitted. The Shopify side
couldn't be checked: its connector needs signing in again.

### How to see it working

Run `npm run dev` and log in as a casual. Open **My profile**, then **Set your travel area**. Enter
`ZZ1 1AA`, choose how you travel and how long, and save. Try `ZZ0 0AA` to see an unknown postcode
refused. Then log in to the office, open **Workers**, find that casual: the page shows "Travel area:
ZZ1 · …". On **Settings**, save `ZZ9 9ZZ` for a site and it says "Location found."

## 2026-10-09 — Phase 12, task 12G.2: Travel estimates

**Time spent:** 1.6 hours (11:49 to 13:25 UTC).

**Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=bd2d1c019b2e1bc0 e2e=true`.
That covers 4,126 unit and database tests, 79 browser tests and the walkthrough's 3, all passing.
The independent auditor said **DONE** in round 1. The commit is "Phase 12: Travel estimates (12G.2)",
pushed to `build/overnight`.

### What was built, in plain words

A **travel estimate** is how long it takes to get from a postcode to a site: by car (with the
distance) and by public transport, arriving 30 minutes before a shift starts. Casuals will see
these on every shift ("7.2 miles · 18 min by car · 41 min by public transport"), and the next task
(12G.3) uses them to show casuals only the shifts they can reach. This task works them out and
stores them. Showing them on pages is 12G.3.

- **The travel provider** (`src/lib/travel/provider.ts`): the code that answers "how long from
  these points to this site?". There are two versions:
  - **The fake**, used tonight and in every test. It works a time out from the straight-line
    distance (roads are taken as 1.3 times longer than the straight line).
  - **TravelTime**, a paid service, for real use later. One request asks about up to 2,000 start
    points at once, gives up after 90 minutes of travel, and asks for the distance by car. It
    sends only map points under made-up labels ("o1", "o2"), never a postcode or a name. Its
    answer is checked before use (with zod, a library that checks data has the expected shape),
    with a 10-second time limit and a size cap. Nothing was sent to TravelTime tonight: its tests
    use answers written by hand in the shape its documentation shows.
- **A new table**, `travel_estimates` (migration 0041). Each row is one postcode, one site, one way
  of travelling and one arrive-by time. It is keyed by postcode, not by person: casuals who start
  from the same postcode share it.
- **The travel job** (`src/lib/travel/estimates.ts`): a background job (it runs in the worker, the
  separate program that does work away from the web pages). It finds the sessions that need
  estimates, groups those sharing a site and start time, and asks the provider only for the
  estimates that are missing.
- **What starts the job:** a new, imported, synced, moved or urgent session; a site's postcode
  changing (its old estimates are deleted at once); a casual changing their postcode or ways of
  travelling; and a nightly run at 02:20 for every session in the next 29 days (the 28 days casuals
  can see, plus one).
- **If the provider is down:** the job stops (no hammering), keeps what it saved, and tries again
  later, waiting longer each time (3 to 4 hours of tries), then the nightly run catches up. Until
  then the casual sees "about 7 miles (straight line) · Travel time not known yet". Shifts are
  never hidden because of it.
- **Urgent shifts:** before the first offers go out, the offer job fills in the shift's missing
  estimates itself, waiting at most 5 seconds. If the provider is slow or down, the offers go
  anyway.
- **Clearing up:** each estimate is deleted 7 days after the last session it was for.

### Key facts and numbers

- One provider request per site, start time, way of travelling and batch of up to 2,000 start
  points. 2,001 casuals with different postcodes means 2 requests per way.
- A job run has a 10-minute budget. If it runs out with work left, and it saved something, it
  queues the rest as a fresh run.
- Casuals' changes wait 5 minutes and share one run per firm, so ten casuals saving their postcodes
  cost one run, not ten.
- The worker takes travel jobs one at a time, because pg-boss (the job queue, which lives in the
  database) gives a whole batch of jobs one shared time limit.
- No database transaction (a group of database changes that succeed or fail together) is open
  while the provider is asked. An answer is saved only if the site hasn't moved meanwhile.

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| No call to TravelTime tonight; hand-written sample answers, checked live in the "Connect" step | Overnight rules: no outside services | Using the free key |
| Both ways are worked out for every postcode, whichever ways the casual chose | The spec says both times always show; the choice only drives the filter | Only the chosen ways (fewer requests) |
| A provider that doesn't answer stops the run, and pg-boss tries again later | No hammering a service that's down | Carrying on with every request |
| The first wave fills its own shift's estimates, for at most 5 seconds | The task asks for estimates before the first wave; a slow service must never hold offers back | Making the wave wait for the job |
| Only the worker can reach the provider and holds TravelTime's keys | Pages never call the provider (a test checks every page's imports) | The provider in the web app too |
| Estimates are left out of the firm's data download and expire after 7 days, even during a hold | They hold full postcodes the office never sees; they're worked out, never evidence | Exporting them; keeping them during a hold |
| Every run covers 29 days ahead, not further | Far-off sessions get theirs as they come closer; fewer paid requests | Every future session |

### What the guardrails reviewer found

The `guardrails-reviewer` (a checking agent that reads the change against the project's golden
rules) ran twice:

- **Round 1** found one must-fix problem: two casuals with the same postcode but slightly different
  map points made the save fail. Fixed: one point per postcode (the latest). It also asked for
  shorter database transactions, a time budget, retries that back off, casuals' changes sharing one
  run, every run limited to 29 days, and a size cap that stops reading a too-big answer early. All
  done, each with a test.
- **Round 2** found nothing must-fix and two follow-ups, both done: travel jobs are taken one at a
  time, and a run that saved nothing doesn't re-queue itself.

### What the new tests prove

- **Unit tests** (`tests/unit/travel.provider.test.ts`, `tests/unit/travel.body.test.ts`,
  `tests/unit/travel.boundary.test.ts`) prove:
  - the fake's times, the 90-minute ceiling and the 2,000 limit;
  - a TravelTime request holds only points and made-up labels, and each kind of answer is read
    correctly (anything odd, slow or too big is "unavailable");
  - an answer is never read past its size cap, however it's sent;
  - the travel line's words, including across the clock change;
  - no page's code can reach the provider.
- **Database tests** (`tests/integration/travel.estimates.test.ts`, 23 tests) prove:
  - who is searched from (active casuals with the role, one point per postcode), batching, and
    sessions sharing searches;
  - a site that moves mid-search gets nothing saved;
  - the provider down: the job fails to be tried again, and the line falls back to the straight
    line;
  - running out of time: what's done is kept, and the rest is queued only after progress;
  - an urgent shift has its estimates before its first offer, and a slow or broken provider never
    holds offers back;
  - the nightly run covers the window, once a day;
  - the purge; each change that queues the job; one firm's casuals never searched for another.
- **Sheet sync tests** prove a synced session gets its estimates without the nightly run, and a
  session brought back from draft or cancelled gets them too.

### What's parked or needs Dylan

- **Connect postcodes.io and TravelTime** (PLAN.md Parking lot): sign the DPIA, get TravelTime's
  production quote, then put the keys in the server's settings. Claude then checks the sample
  answers against one live request between two public places, and TravelTime's limits.
- **A cap per casual** on how often their area changes (each new postcode costs requests).

### How to see it working

Nothing new is on screen yet: 12G.3 adds the travel lines and the filter. The tests above run it
end to end with the fake provider: `npm test -- tests/integration/travel.estimates.test.ts`.

## 2026-10-09 — Phase 12, task 12G.3: The travel filter and travel lines

**Time spent:** 0.8 hours (13:27 to 14:14 UTC).

**Result:** `RUN_E2E=1 ./scripts/verify.sh` printed `VERIFIED tree=63d457ebc306ad3c e2e=true`.
That covers 4,160 unit and database tests, 80 browser tests and the walkthrough's 3, all passing.
The independent auditor said **DONE** in round 1. The commit is "Phase 12: The travel filter and travel
lines (12G.3)", pushed to `build/overnight`.

### What was built, in plain words

Casuals who set a travel area (12G.1: a start-from postcode, how they travel, and how long they'll
travel) now only see and get offered shifts they can reach. Every shift also shows how far it is.

- **The rule** (`src/lib/travel/area.ts`). A shift is:
  - **in** her area if any way she chose gets there within her limit (with car 40 minutes, public
    transport 50 and a 45-minute limit: in for "both" and "car", out for "public transport");
  - **out** only when every way she chose has a travel time and none is within;
  - **unknown** otherwise, for example when the time hasn't been worked out yet or the site has no
    location. An unknown shift is still shown, labelled, and still offered. Nothing is hidden just
    because a distance isn't known.
- **Where it applies:** Open shifts, the urgent board, the urgent count on Home, and offer waves
  (the automatic messages offering a shift). The office's own "Offer to someone" is not limited by
  it: the office may offer anyone by hand.
- **Before the cap:** Open shifts checks at most 50 shifts. The area filter runs inside the
  database query (the request to the database), before those 50 are picked, so a nearby shift is
  never pushed off the list by far-away ones.
- **The order:** urgent shifts first, then the nearest (her quickest chosen way), then by date.
- **The travel line** on every Open and urgent card and every upcoming booking: "7.2 miles · 18 min
  by car · 41 min by public transport". Both times always show, whichever ways she chose.
- **No travel area:** everything is shown, with "Add your home area to see how far each shift is and
  only see shifts you can get to." and a link to set one.
- **"2 more shifts are further than you travel. Change how far"** under the list, counting the
  shifts she could otherwise take.
- **Never blocked:** a shift opened from a direct link can still be booked, whatever her area. The
  area is a preference, not one of the booking rules.

### Key facts and numbers

- One copy of the rule is plain TypeScript (`areaVerdict()`); the other is SQL (database code), so
  the filter can run inside the query. A test checks the two agree on 25 combinations for each of
  the three ways of travelling.
- No new tables and no new jobs. Everything is read inside the firm's own data (row-level security,
  the database rule that keeps each firm's rows separate).

### Decisions made

| Decision | Why | What else was considered |
|---|---|---|
| The office's offer by hand ignores the travel area | The decision on travel areas (D2) says the office may offer outside it | Filtering the office's list too |
| A shift is "out" only when every chosen way has a time and none is within | An unknown distance must still be shown and offered (D2) | Treating "not worked out yet" as out |
| No travel line on past bookings | The trip is done, and travel times expire 7 days after the shift | A line on every past row |
| The "further" count uses the same booking rules as the list, on up to 50 shifts | It should count shifts she could really take; it stays quick | Counting every far shift |
| The shift page's "Getting there" waits for task 12H.2 | That task's text covers the shift page | Adding it now |

### Problems found and fixed

- **The "further" count counted a full shift.** The database code library (Drizzle) leaves the
  table name off columns in a query with no join. A small count inside the query then compared a
  booking's id with itself instead of with the shift's id, so every shift looked empty. Fixed by
  writing the query the same way as the list's (with a join), with a comment explaining why. No
  other query in the app has the same pattern.
- **The browser test's reset tried to delete bookings,** which the app is never allowed to do
  (bookings are evidence). It now cancels its own earlier sessions instead; bookings on cancelled
  sessions don't count anywhere.

### What the guardrails reviewer found

The `guardrails-reviewer` (a checking agent that reads changes against the project's golden rules)
said it was safe to commit. It confirmed the SQL matches the plain rule, that "first yes wins" and
the daily offer limit are untouched, and that nothing personal leaks. Its suggestions were done: a
test at exactly the limit (45 minutes), singular wording for "At least 1 more shift", a check that
only the office's offer can skip the area, and an ordering test for a casual with one way. Two
points went to the Parking lot (below).

### What the new tests prove

- **Unit tests** (`tests/unit/travel.area.test.ts`, 12 tests): the rule's table (the 40/50/45
  example, the exact limit, the 90-minute ceiling, ways she didn't choose, unknown), the words, and
  the pages: the travel line on each card and booking, the prompt with no area, and the "further"
  line. `tests/unit/copy.plain-language.test.ts` checks the new screens are in plain words.
- **Database tests** (`tests/integration/travel.filter.test.ts`, 16 tests): a near shift is never
  cut off by the cap; the database agrees with the plain rule; unknown distances are shown and
  offered; no area means no filter; the order; the "further" count; the urgent board; waves skip
  out-of-area casuals but the office's offer doesn't; a direct link still books; booked rows' travel
  lines.
- **Browser test** (`tests/e2e/travel.filter.spec.ts`): a casual sees one of two urgent shifts on
  Home and the urgent board (with its travel line and "1 more urgent shift is further than you
  travel"), and still books the far one from a direct link.
- Break checks: removing the list filter, the order, the wave filter or the office's exception, or
  moving the limit by one minute, each made a test fail.

### What's parked or needs Dylan

- **The per-firm switch** (already waiting for Dylan): the "Add your home area" prompt now shows at
  every firm, including where real postcode look-ups are off.
- **Before TravelTime goes live:** confirm that "unreachable" in its answer means over 90 minutes,
  never "no timetable data", or casuals who only use public transport could miss offers.

### How to see it working

Run `npm run dev`, log in as a casual (see `docs/walkthrough.md`), set "Where you work" on Profile
with a ZZ postcode, then open "See open shifts": the prompt is gone and each card shows its travel
line. At first it's the straight-line distance ("Travel time not known yet"); the times appear
within about 5 minutes, once the worker's travel job has run (`npm run dev` starts the worker too).
