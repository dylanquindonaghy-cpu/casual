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
