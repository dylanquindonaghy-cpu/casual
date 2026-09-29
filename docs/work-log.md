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
