# Runbooks

Short, do-this-now guides. Keep them current.

## Set up AWS (once)

Creates the app server and the database in London (`deploy/lightsail.sh`). It costs money from
then on (about $24 + $15 a month at the time of writing). On your own computer (in WSL):

1. **An AWS account, made safe first:** sign up at aws.amazon.com. Straight away:
   - turn on MFA (a code from your phone) for the account's main ("root") login: AWS → your name
     (top right) → Security credentials → Assign MFA device;
   - a spending alert before anything costs money: search "Budgets" → Create budget → "Monthly
     cost budget" → £50 → your email. You get an email if the month's bill heads past £50;
   - an everyday admin login, so the root login stays in the drawer: IAM (search "IAM") → Users →
     Create user (e.g. `dylan`) → "Provide user access to the AWS Management Console" → attach
     `AdministratorAccess` → then open it → Security credentials → Assign MFA device. Log in as that
     from now on.
2. **A key for the command line, allowed only Lightsail in London:** IAM → Users → Create user
   `dylan-cli` (no console access) → "Attach policies directly" → Create policy → the JSON tab →
   paste this, name it `shiftdesk-lightsail-london`, and attach it:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "lightsail:*",
         "Resource": "*",
         "Condition": { "StringEquals": { "aws:RequestedRegion": "eu-west-2" } }
       }
     ]
   }
   ```

   Then open `dylan-cli` → Security credentials → Create access key → "Command Line Interface" →
   tick "I understand the above recommendation" → Next → Create. Keep both values in your password
   manager: you can't see the second one again. (Or skip the key entirely: open AWS CloudShell, in
   London, from the console's top bar, upload the two `deploy/` files, and run the script there.)
3. **The AWS CLI** (outside the project folder, so nothing lands in the repo):
   `sudo apt install -y unzip && cd /tmp && curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip && unzip -q awscliv2.zip && sudo ./aws/install && rm -rf awscliv2.zip aws && cd -`
   then `aws --version` should print "aws-cli/2…".
4. **Log it in:** `aws configure`, paste the two values, region `eu-west-2`, output `json`. Then
   `aws sts get-caller-identity` should print your account number.
5. **Create everything:** from the project folder, `bash deploy/lightsail.sh`. It first shows the
   two plans and their monthly prices and waits for you to type `yes`. Then it prints each step
   ("== The app server …", "Created.", "Done, and checked.") and waits for the database, which
   takes 10 to 20 minutes. At the end it prints the static IP, the database's address and what to
   do next. Run it again any time: it skips what's already there (but it resets the firewall to
   its own rules).
6. **DNS:** at the company where you bought the domain, add two A records pointing to the static
   IP: the domain itself, and `*` (every firm's subdomain).
7. **The database password:** the script prints the command that shows it. Put it in your
   password manager; it goes in the server's `.env` (the deploy steps). Never in the repo. AWS may
   put characters like `#`, `?`, `%` or `$` in it: inside a database address (`postgres://…`) write
   it percent-encoded (`#` is `%23`, `?` is `%3F`, `%` is `%25`), and in `.env` put the whole value
   in single quotes.
8. **Get onto the server:** Lightsail → Instances → `shiftdesk-app` → "Connect using SSH" (a
   terminal in your browser). SSH from the internet is closed on purpose: only this browser console
   gets in. Check the first boot finished: `sudo cloud-init status --long` says "done", and
   `docker --version` prints a version. Then the deploy steps below.
9. **Put the key away:** once the script has run, IAM → `dylan-cli` → Security credentials →
   the access key → Deactivate (make it active again next time you need the script). Anyone with
   that key could change the firewall.

If you'd rather click: the same can be done in the Lightsail console (London, Ubuntu 24.04, the
4 GB plan, a static IP, the Networking tab's firewall with only HTTP and HTTPS, and a Postgres 16
database with public mode off), but the script is the checked version.

## Deploy

How it works (Phase 8): deploys **pull**, nothing pushes into the server (SSH is closed to the
internet). Merging to `main` runs CI; when CI passes, `.github/workflows/deploy.yml` builds the
image and puts it in GitHub's registry as `ghcr.io/<owner>/<repo>:<commit SHA>` and `:main`. On the
server, `deploy/deploy.sh` runs every 2 minutes (a systemd timer): if the running containers aren't
on the chosen image (a new one, or a deploy that failed and needs retrying) it runs the migration
step (`migrate`, the only service with the owner's database login: it also creates the app and
jobs roles if missing, forces RLS, applies grants and installs pg-boss), then starts the new version
and waits until it's healthy. A failed migration stops there and the old version keeps running; a
new version that doesn't come up healthy shows as a failed run in `journalctl -u shiftdesk-deploy`.
**It never deploys between 05:30 and 09:00 UK time on its own** (event mornings): a merge then goes
out at 09:00. A fix that can't wait: run `/opt/shiftdesk/deploy.sh --now` by hand.

The job worker stays off until the Twilio sender exists: it can't start in production before then
(messages must never be printed instead of sent), so `.env` has `COMPOSE_PROFILES=` empty and only
the web app and Caddy run. After "Connect Twilio": set `COMPOSE_PROFILES=worker` and the messaging
values, then `./deploy.sh --now`.

**The first time** (after "Set up AWS (once)"), in the server's browser console (`sudo -i` first):

1. Copy the four files from the repo's `deploy/` folder into `/opt/shiftdesk`:
   `docker-compose.yml`, `Caddyfile`, `deploy.sh` and `env.example` (the console has an upload
   button, or paste each into `nano /opt/shiftdesk/<name>`). Then `chmod 700 /opt/shiftdesk/deploy.sh`.
2. `cd /opt/shiftdesk && cp env.example .env && chmod 600 .env && nano .env`: fill in every value
   (the comments in the file say where each comes from). Generate new secrets with
   `openssl rand -base64 32` (the session secret) and `openssl rand -hex 24` (the app and jobs
   passwords).
3. Let the server read GitHub's registry: on GitHub → your picture → Settings → Developer settings →
   Personal access tokens → Tokens (classic) → Generate new token (classic), tick only
   `read:packages`, no expiry or a long one. Then on the server:
   `echo <token> | docker login ghcr.io -u <your GitHub username> --password-stdin` (it says "Login
   Succeeded"). The token is kept in root's Docker settings; keep a copy in your password manager.
4. The image must exist: merge to `main` once and wait for "Deploy image" to finish in GitHub's
   Actions tab.
5. Start it by hand the first time: `./deploy.sh --now` (it prints "Deploying …" then "Deployed …").
   Then `docker compose ps` shows web ("healthy") and caddy "Up" (and the worker, once it's turned
   on after "Connect Twilio").
6. Turn on the timer: copy `shiftdesk-deploy.service` and `shiftdesk-deploy.timer` from `deploy/`
   into `/etc/systemd/system/`, then `systemctl daemon-reload && systemctl enable --now
   shiftdesk-deploy.timer`. `systemctl list-timers shiftdesk-deploy` shows the next run.

**Every deploy after that:** merge to `main`. Within a few minutes of CI passing (outside
05:30–09:00 UK), `journalctl -u shiftdesk-deploy` shows "Deployed …". Then check
`https://<a firm>.<our domain>/api/health` says `{"ok":true}` and the office Today page works on a
phone. Post a one-line note in the Hours log.

**Never deploy** between 05:30 and 09:00 UK on an event day for any pilot firm, or during a live
event (the script enforces the first; for the second, pin the current version, below, until the
event is over).

## Rollback

1. Find the last good version's commit SHA (GitHub → the repo → Actions → "Deploy image" runs, or
   `git log`).
2. In the server's browser console, become root first (everything in `/opt/shiftdesk` is root's):
   `sudo -i`, then `cd /opt/shiftdesk`. `nano .env`, set `SHIFTDESK_TAG=<that SHA>` (Ctrl+O, Enter,
   Ctrl+X to save and leave), then `./deploy.sh --now --no-migrate`. It prints "Deploying …" then
   "Deployed …" with that SHA. `--no-migrate` because an older version's
   migration step can't run against a database a newer version has changed (and doesn't need to:
   migrations only add). `--now` works on event mornings too. While pinned, merges to `main` aren't
   deployed.
3. When the fix is out: set `SHIFTDESK_TAG=main` again (as root, `nano /opt/shiftdesk/.env`); the
   next run deploys it, with its migration.
4. If a migration must be reverted, restore the database (below) rather than hand-editing.

## Restore the database

1. Lightsail → Databases → snapshots → restore to a new instance. Give it a real name (e.g.
   `shiftdesk-db-2`), **never** a `…-db-drill` one: the drill script deletes drill databases.
2. Point the app at it: in the server's browser console, `sudo -i`, `cd /opt/shiftdesk`,
   `nano .env`, and in `DATABASE_URL`, `DATABASE_JOBS_URL` and `DATABASE_ADMIN_URL` replace the old
   database's address (the part after `@`, before `:5432`) with the new one's (Lightsail →
   Databases → the new one → "Endpoint"). The user names and passwords stay (a restore keeps them:
   check this the first time, below). Then `docker compose up -d`: it recreates `web` and `worker`
   with the new values (`docker compose restart` would **not**: it keeps the old ones).
3. Check it's recent: the newest event (the recency check in "Restore drill (monthly)" step 2,
   run against the new database) should be from just before the problem. (Plain counts as the
   owner show nothing: RLS is forced.)
4. Test a restore once a month even when nothing is wrong ("Restore drill (monthly)", below).
5. Use snapshots, not `pg_dump`: RLS is forced on every table, so `pg_dump` as the owner fails
   (or dumps no firm rows with `--enable-row-security`). Firm data exports go through the app.

## Restore drill (monthly)

Proves the backups can be restored, without touching the real database (`deploy/restore-drill.sh`).
On your own computer, with the AWS CLI logged in (reactivate the key from "Set up AWS (once)" step
9, then deactivate it again after):

1. `bash deploy/restore-drill.sh`. It restores the latest backup to a separate private database,
   `shiftdesk-db-drill`, waits (10 to 20 minutes) and prints its address.
2. Check it's a recent copy: in the server's browser console (not your own computer: the database
   is only reachable from the server),
   `sudo docker run --rm -it postgres:16-alpine psql "postgres://shiftdesk_owner@<drill address>:5432/shiftdesk"`
   (it asks for the real owner password: a restore keeps it), then paste:

   ```sql
   select set_config('app.current_firm_id', (select id::text from firms order by created_at limit 1), false);
   select max(created_at) from events;
   ```

   The time shown should be minutes before the restore (a backup that's days old shows an old
   time). `\q` leaves psql. Never point the app at the drill database.
3. Delete it today: `bash deploy/restore-drill.sh --delete` (it shows when it was made and asks you
   to type its name; it only ever deletes the drill database). Check Lightsail → Databases shows
   it "Deleting", then gone. Then `sudo docker image rm postgres:16-alpine` on the server to free the
   space.
4. Note the date and "restore drill OK" in the Hours log.

## Try the runbooks for real (once, before the pilot's data)

Deploy, Rollback and Restore have only been checked against the scripts, never run. Try each once
on the real server **before any real worker's data is imported** (Gate B): the database then holds
only the demo firms, so a restore that goes wrong costs nothing. Allow about two hours on a weekday,
outside 05:30–09:00 UK. Write each result in the table at the end, and tell Claude anything that
was wrong or unclear so the runbook gets fixed.

1. **Deploy.** After the first deploy ("Deploy", the first time), merge any small change to
   `main` (ask Claude for a harmless one). Worked if, within a few minutes of CI passing:
   `sudo journalctl -u shiftdesk-deploy --since "15 minutes ago"` shows "Deployed …" with the new
   commit's SHA; `sudo docker compose -f /opt/shiftdesk/docker-compose.yml ps` shows web
   "healthy"; `https://<a firm>.<our domain>/api/health` says `{"ok":true}`; the office Today page
   opens on your phone.
2. **Rollback.** Follow "Rollback" steps 1–2 with the SHA of the version *before* the one you just
   deployed. Worked if "Deployed …" shows that older SHA, the site still works, and it's still on
   it 5 minutes later (the timer leaves a pin alone). Then step 3 (`SHIFTDESK_TAG=main`): within a
   few minutes "Deployed …" shows the newest SHA again.
3. **Restore.** Follow "Restore the database" steps 1–3 with the latest snapshot, naming the new
   database `shiftdesk-db-2`. Worked if the app comes back healthy on it, the demo firm's Today page
   opens, and the newest event is from just before the snapshot. Also note whether the passwords
   really were kept (step 2 depends on it). Then point `.env` back at the original database,
   `docker compose up -d` again, check the site, and delete `shiftdesk-db-2` in Lightsail (it costs
   money while it exists).
4. **Restore drill.** Run "Restore drill (monthly)" once, all four steps.

| Runbook | Date | Worked? | What was wrong or unclear |
|---|---|---|---|
| Deploy (first time) | | | |
| Deploy (a merge) | | | |
| Rollback (pin and unpin) | | | |
| Restore the database | | | |
| Restore drill | | | |

When every row says it worked (after any fixes), the Phase 8 task "Runbooks tried once for real"
can be ticked.

## Monitoring and alerts (once)

Three things tell you when something's wrong, without you watching. First reactivate the CLI key
("Set up AWS (once)" step 9: IAM → `dylan-cli` → the key → Activate), and deactivate it after.

1. **The £50 AWS budget** (from "Set up AWS (once)" step 1): an email if the month's bill heads
   past £50.
2. **Lightsail's alarms**, which watch from outside the server:
   `bash deploy/alarms.sh you@example.com` (your own address). AWS emails you a confirmation
   first: click its link (run the script again if the email doesn't come: it resends it). Then you
   get an email when the server is down for 10 minutes, its CPU is above 90% or its burst capacity
   under 20% for 15 minutes (the plan slows the server once that runs out), the database has
   under 8 GB free or its CPU is above 90%, and again when each is back to normal.
3. **An uptime check that the app itself answers**, from the internet, with a phone app: sign up
   for an uptime service (UptimeRobot, Better Stack and others have free plans: check the plan's
   terms allow business use), add a plain **HTTPS** monitor (not a keyword one) for
   `https://<a firm>.<our domain>/api/health` every 5 minutes, alerting to your email and its phone
   app. `/api/health` answers with an error when the app can't reach its database, so "anything
   but OK" means down. You should get a "down" alert within minutes if the app stops answering,
   and an "up" when it's back.

The app's own alerts are below ("Alerts from the app").

## Alerts from the app

The app watches itself and sends you a short "ShiftDesk alert: …" (no names, numbers or messages
in it). Until the phone sender is connected (PLAN.md Parking lot, "Connect alerts to your phone"),
each one is a line in the log: `docker compose logs web worker | grep "ops alert"`. The same
problem alerts at most once an hour. The worker checks every 5 minutes. Until "Connect Twilio"
nothing fires in production (the worker is off, and the webhooks don't check signatures until
Twilio's token is set). To check alerts reach you: `docker compose exec worker npm run -s
ops:test-alert` (or on your computer, `npm run -s ops:test-alert`): a "ShiftDesk alert: a test
alert…" line (a text, once the phone sender is connected).

| Alert says | What it means | What to do |
|---|---|---|
| "N jobs failed after the last retry in the last hour (queue n, …)" | A background job (an offer wave, a reminder, a notice…) gave up | `docker compose logs worker --since 1h`, look for that queue's errors (codes only, no personal data). Fix the cause; a failed offer wave or notice isn't re-run by itself: tell the firm's office if a worker wasn't told something |
| "{firm}'s rota sheet sync is failing ({code})" | The firm's Google Sheet hasn't synced for over 30 minutes and is still failing | The code says why: "Google Sheets sync failing" below. The office sees the same on Today |
| "{firm}: N of M WhatsApps and texts failed to send in the last hour (P%), mostly {code}" | Twilio refused more than 5% of at least 20 messages (offers, reminders, notices, answers, shifts-line replies; a worker who turned texts off doesn't count) | Twilio's own log shows each refusal with its number (console.twilio.com → Monitor → Logs → Errors). Often: a template not approved, the account out of credit, or a number blocked. (The code in the alert is the app's; Twilio's numbered codes come with the Twilio sender) |
| "the web app's health check is failing (…)" | The worker can't get an OK from the web app on the same server | `docker compose ps` and `docker compose logs web --since 15m`; the outside uptime check says whether the internet sees it too. "Event-morning outage" below |
| "N Twilio webhook requests with a bad signature in the last hour" | Twilio's messages to us are being refused: `TWILIO_AUTH_TOKEN` in `.env` no longer matches the account (someone rotated it), the address set in Twilio differs from the one the app checks against (http instead of https, or a firm's own domain instead of `<slug>.<our domain>`), or someone is probing | Compare the token with Twilio's console (Account → API keys & tokens), and the webhook addresses with "Connect Twilio". If both match, it's probing: nothing to do unless it keeps up |

## Workers at one venue can't get login links

Everyone on the same Wi-Fi (or mobile carrier NAT) shares one IP, and the login limit is 10 link
requests per IP per 15 minutes per firm. At a briefing, ask people to switch Wi-Fi off and use
mobile data, or wait for the window to pass. Workers who already logged in stay logged in for
30 days, and using a link that works never counts. If it keeps happening, raise
`LIMITS.loginPerIp` in `src/lib/auth/throttle.ts`.

## Rate limits look shared by everyone

If the log says "no X-Real-IP header: rate limits are shared by all clients", Caddy isn't setting
`X-Real-IP` (`reverse_proxy web:3000 { header_up X-Real-IP {remote_host} }`), and one busy client
can lock everyone out of login for 15 minutes. Fix the Caddyfile and reload Caddy. Never publish
the web container's port: Caddy must be the only way in. `{remote_host}` is right only while
nothing sits in front of Caddy; behind a load balancer or CDN use `trusted_proxies` and
`{client_ip}` instead.

## Rotate a secret

Twilio auth token, session secret, AWS keys: rotate in the provider, update `.env` on the
server, `docker compose up -d`, after 22:00. Rotating `SESSION_SECRET` doesn't log anyone out
(sessions are stored as sha256 of their own token); it resets every rate-limit counter and
cancels one-time codes that are still live.

Database role passwords (`shiftdesk_app`, `shiftdesk_jobs`): `db:migrate` creates these roles
but never changes an existing password. Rotate by hand as the owner:
`ALTER ROLE shiftdesk_app PASSWORD '...'`, update `DATABASE_URL` (or `DATABASE_JOBS_URL`) in
`.env`, then `docker compose up -d`.

## Event-morning outage (the one that matters)

1. Twilio's fallback already puts calls through to the manager's mobile when the app doesn't
   answer (a TwiML Bin per firm from `npm run firm:call-fallback`; PLAN.md "Connect Twilio" step
   10). Confirm it's set: Twilio → Phone Numbers → the number → "Primary handler fails" names the
   firm's bin, and the bin has the current manager's number.
2. Text the manager: "Portal down, calls to the shifts line are coming to you, ETA X." Text the
   resourcers too: WhatsApps and texts to the line aren't being answered meanwhile.
3. Check: health endpoint, Docker containers, disk space, database status page, Twilio status.
4. Restart `web` and `worker`. If the database is the problem, restore.
5. When back: queued jobs resume; check the urgent shifts didn't miss escalations; re-send any
   offers marked failed. Enter every cancellation or change the manager took by phone during the
   outage (Today → the shift → cancel or change, with the reason), so its notice is logged like any
   other.
6. Write a 5-line post-mortem in the Hours log.

## A bad service worker (My shifts offline copy)

The service worker (`public/sw.js`) stays on workers' phones until a new one replaces it.
Browsers check for a new one each time the portal opens, at least once a day. **Never delete
`public/sw.js` from the site:** a phone that gets a 404 when it checks keeps the old one.

0. Quickest: set `OFFLINE_COPY=off` and redeploy. Each phone removes the service worker and its
   copy the next time My shifts opens. (If My shifts itself won't open, use step 2.)

1. To fix a bug, deploy a corrected `public/sw.js`. Phones pick it up the next time the portal
   opens. If the stored copy's format changed, change `CACHE` in `public/sw.js` and
   `OFFLINE_CACHE` in `src/lib/portal/offline.ts` together; a unit test checks they match. The new
   worker deletes the old caches.
2. To switch it off completely, replace `public/sw.js` with just:
   `self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.registration.unregister())));`
   and set `OFFLINE_COPY=off`.
3. One worker's phone: logging out deletes the copy. Clearing the browser's data for the portal
   removes the service worker too.

## WhatsApp problems

- **Template rejected:** simplify wording, remove marketing-like phrases, resubmit. Use SMS fallback meanwhile.
- **Messages not delivering:** check Meta payment method (required from 1 October 2026),
  template status, quality rating, and Twilio error codes.
- **Number quality drops:** reduce volume, check opt-outs, make sure offers only go to eligible people.

## Google Sheets sync failing

`roster_sources.last_error_code` (and each `roster.sync_failed` event) says why:

- `sheet_not_shared`: the firm removed the service account → ask them to re-share the sheet with
  its email (Editor).
- `sheet_not_found`: wrong spreadsheet id, or the sheet was deleted → check the id in settings.
- `missing_column` / `duplicate_column`: a header the mapping names was renamed, removed or
  doubled → fix the header in the sheet, or re-map in settings; the next sync resumes.
- `sheets_rate_limited`: Google's per-minute quota → the sync already reads once and writes at most
  once; check nothing else is using the service account.
- `sheets_unavailable` / `sheets_auth_failed` / `sheets_bad_response`: Google side or our key →
  check Google's status page and the key file; syncs retry every tick.
- `bad_mapping`: the stored mapping doesn't parse → fix it in settings.
- While a firm's syncs fail, retries back off to every 5 minutes on event days (30 otherwise), and
  `roster.sync_failed` is logged only when the code changes.
- Nothing booked in the portal is lost while syncs fail: the next successful sync writes it.
- A `holder_not_in_sheet` problem: someone with no staff id in the sheet holds that shift. Add them
  to the staff tab (with a staff id); the shift's holders sync again after that.
- A clash (`roster.sheet_conflict`): the office added a name to a shift the portal had already
  filled. The portal booking stands; tell the office.
- Bad rows are listed by row number and code in the `roster.synced` outcome (never their contents).

## Importing workers, credentials or shifts from a spreadsheet

Until the office import screen exists (Phase 5), from the project folder (real data only after
Gate B's paperwork is signed):

1. Save the spreadsheet as .xlsx or .csv. Row 1 must be the headers. Accepted headers:
   - workers: First name, Last name, Mobile (required); Staff ID, Email, Roles, Status.
   - credentials: Type (e.g. SIA DS), plus Staff ID or Mobile to find the worker; Number,
     Expires (07/11/2027), Status.
   - shifts: Date, Start, End, Role (required); Shift ID, Site, Needed, Instructions.
2. Dry run: `npm run import -- --firm <slug> --kind workers --as <office email> <file>`. It prints
   what it would create, update and skip, and why each skipped row was skipped.
3. Fix the rows it names in the spreadsheet if you like, then run the same command with `--apply`.
   On the live server (any database not on this machine), `--apply` also needs
   `--agreement-signed <slug>`, repeating the firm's slug: it's you saying the firm's agreement and
   DPA are signed (Gate B). Without it, or with another slug, nothing is saved and it says why. On
   the server it runs in the one-off owner service: `docker compose run --rm owner node --import
   tsx scripts/import.ts --firm acme --kind workers --as <office email> <file> --apply
   --agreement-signed acme` (the file must be inside the container: not yet tried for real).

A row whose mobile matches an existing worker updates that worker (mobile is who they are). On a
credential, a blank cell leaves that field as it is (a re-import never un-suspends a licence or
wipes an expiry); an expired licence given a new future expiry becomes valid. A shift with people
booked can't have its times or role changed, or its number needed lowered, by an import: use the
office shift editor (Phase 5). Shifts that have started can't be imported or changed. A shifts
file without Shift IDs matches shifts by site, role and times, so changing a time in such a file
adds a new shift and leaves the old one (and anyone booked on it) as it was.

## Onboarding a pilot firm

The checklist is in `docs/go-to-market.md` ("Pilot onboarding checklist"). At any point,
`npm run -s firm:check -- --firm <slug>` prints it for that firm from its data: `[x]` done, `[ ]`
to do, `[?]` confirm yourself (things the app can't see, such as the paperwork). Counts and
settings only, never a person's details.

**Running an owner command on the server.** The live database is only reachable from the server,
so `firm:create`, `firm:office-user`, `firm:settings`, `firm:check`, `firm:brand`, `firm:line` and
`firm:domain` run there, in a one-off copy of the app: the `owner` service in
`docker-compose.yml`, which reads `.env` itself (so no password goes on the command line). In the
server's browser console: `sudo -i`, `cd /opt/shiftdesk`, then (not yet tried for real: part of
"Try the runbooks for real"):

```
docker compose run --rm owner node --import tsx scripts/firm-check.ts --firm acme
```

Swap `scripts/firm-check.ts --firm acme` for the command's own file and options (the file is the
command's name: `firm:create` is `scripts/firm-create.ts`). `firm:check` and `firm:office-user`
don't need the owner's login: `docker compose run --rm --no-deps web node --import tsx
scripts/firm-check.ts --firm acme` works too. On your own computer the same commands run against
your local database as `npm run -s …`.

In order (who does it, how, and what done looks like):

1. **Agreement and DPA signed** (you and the firm). Nothing real goes in before this (Gate B).
2. **Create the firm** (you): `npm run -s firm:create -- --slug acme --name "Acme Events"
   --sector security --admin-email jo@acme-events.example --admin-name "Jo Bloggs"`. The slug
   becomes `acme.<our domain>`; the sector (security, rail, construction or cleaning) brings its
   credential types and default rules. It says "Created … and its admin." (and "Next: …
   firm:check"). A slug that's taken, or a value it can't use, is refused with the reason. If it
   stops half-way, run the same command again: it finishes the setup (and says when the firm was
   first created).
3. **Branding and sign-off** (you, with the firm's logo address and colour): "Setting a firm's
   brand" below. Its own domain, if it wants one: "A firm's own domain" below.
4. **Office users** (you): the admin from step 2 can log in at `acme.<our domain>/office` once the
   worker is running and emails go out ("Connect Twilio", "Connect Amazon SES"). Resourcers and
   payroll: `npm run -s firm:office-user -- --firm acme --role resourcer --email
   sam@acme-events.example --name "Sam Rota"` (roles: admin, resourcer, payroll). It says "Added: they can
   now log in to acme's office as resourcer." An email that already has a login is left as it is (it says its role and whether it's active).
5. **Rota source** (you and the resourcer): a Google Sheet ("Connect the real Google Sheets" in
   PLAN.md), or none: shifts made in the office or imported from CSV.
6. **Workers and credentials** (you, from the firm's spreadsheets, **only after Gate B**): "Importing
   workers, credentials or shifts from a spreadsheet" below. `firm:check` then shows how many
   active workers have no credential on file.
7. **Credential rules for every role** (you and the firm): the pack gives the sector's usual roles.
   `firm:check` names any role in use with no rule: the rules refuse that role's shifts to everyone
   until it has one.
8. **Settings agreed** (the firm decides; you set them): `npm run -s firm:settings -- --firm acme`
   shows who gets open shifts (first come first served, or fair rotation with its wave size and
   minutes), the urgent window, when the office is emailed about an unfilled shift, the
   short-notice threshold and quiet hours, as the app reads them. Change any with `--set`, e.g.
   `--set urgent_window_hours=12 --set quiet_hours.start=21:30`. A value the app wouldn't use is
   refused and nothing changes; each change is in the office action log.
9. **Shifts line** (you): after "Connect Twilio", the firm's number with `npm run firm:line`, and
   WhatsApp's approval of the display name (start early: it can take days).
10. **Privacy notice line** (you send it, the firm publishes it): `docs/privacy-notice.md` has the
    short line and the section for its privacy notice, with what to fill in.
11. **Staff briefing** (the firm): a message to its staff with the portal link.
12. **Dry-run event day** (you and the resourcer): `docs/pilot-playbook.md`.
13. **Baseline numbers** (the resourcer): the office's Pilot figures page, Baseline week.

When `firm:check` shows no `[ ]` and you've confirmed every `[?]`, the firm is ready to go live.

## Setting a firm's brand (name, colour, logo, sign-off)

Owner-only (it uses `DATABASE_ADMIN_URL`), like `npm run firm:line`. Give only what changes:

1. Colour: `npm run firm:brand -- --firm acme --colour "#1d4ed8"`. It should say "Saved colour for
   acme, in …". Any colour works: the bar's text turns black or white to stay readable.
2. Logo: an https:// address of the logo on the firm's own website (ask them for it), e.g.
   `npm run firm:brand -- --firm acme --logo "https://www.acme-events.example/logo.png"`. Open the
   firm's login page: the logo shows at the top left. `--no-logo` removes it.
3. Sign-off (the end of every message) always ends "Shift Team" (golden rule 8); only the name
   part can be shorter: `npm run firm:brand -- --firm acme --sign-off "Acme Shift Team"`.
   `--default-sign-off` goes back to "[Firm name] Shift Team".
4. Name: `--name "Acme Events Ltd"` (it's on every page and in every message). If the sign-off
   stored was the old name's default ("Acme Events Shift Team"), it goes too, so messages are
   signed with the new name.

A value it can't use is refused with the reason, and nothing changes. Each change is in the office
action log ("The firm's colour changed."), under "Firm settings".

## A firm's own domain (shifts.firmname.co.uk)

Setting one up (owner-only, like `npm run firm:line`):

1. Ask the firm to add a DNS record at their domain provider: type **CNAME**, name `shifts` (or
   whatever they want before their domain), value **their own subdomain with us**, e.g.
   `acme.<our domain>` for Acme (the command prints it). A plain CNAME, "DNS only": not flattened,
   not an ALIAS, not proxied (Cloudflare's orange cloud off), or it can't be verified and HTTPS
   won't reach us. Not their bare domain (`firmname.co.uk` itself can't be a CNAME): a name under
   it. Pointing at their own subdomain ties the domain to them: it can't be verified for another
   firm.
2. Save it: `npm run firm:domain -- --firm acme --domain shifts.acme.co.uk`. If their record is
   already there it says "… is verified for acme"; otherwise "saved … but not verified" and what
   DNS said.
3. Once they've added it (DNS can take up to an hour or so):
   `npm run firm:domain -- --firm acme --check`. When it says verified, open
   `https://shifts.acme.co.uk`: the first visit takes a few seconds while Caddy gets its
   certificate; then it's the firm's portal with its bar.
4. To change it: `--domain <new> --replace`. To remove it: `--clear`.

Each change is in the office action log under "Firm settings".

## Custom domain not working

- `npm run firm:domain -- --firm <slug> --check`: it says what the CNAME points to. It must be
  exactly `<slug>.<our domain>` (that firm's own subdomain), as a plain, unproxied CNAME. If the CNAME has gone, `--check` marks the domain unverified and
  it stops being served (and approved for certificates) until it's back.
- Check Caddy's logs for the `ask` request (`/api/caddy/ask?domain=…`): a 404 means the name isn't
  a verified firm domain; the app logs `caddy ask` with `approved: false`.
- A certificate can take a minute after verification; Let's Encrypt limits how often it's tried.

## GDPR requests

The firm's admin does these on the office dashboard: **Data requests (download or delete)**
(`/office/data`). Every download and deletion goes in the action log ("Data requests and
deletion").

- **Worker asks for their data:** find them by name or mobile, open them, and press
  **Download (JSON)** or **Download (CSV, opens in Excel)**. Send the file to them within a month
  of their request (by a route the firm trusts: it holds their personal details).
- **Worker asks for deletion:** find them, open them, tick **I understand this can't be undone**,
  press **Delete {name}'s personal details**. It's refused while they're booked on a shift that
  hasn't ended: cancel those on the shift's page first (with a reason). Their shift history stays,
  without a name, as the firm's records. Then remove them from the firm's rota sheet or staff file,
  or the next sync or import adds them back as a new worker. Messages they send afterwards arrive as
  from a number we don't know.
- **Breach:** contain, note the timeline, tell the firm (controller) immediately; the firm decides
  on ICO notification within 72 hours.

## Offboarding a firm

1. The firm's admin downloads their data: **Download all your data** on `/office/data` (one JSON
   file of every table, less login secrets). Hand it over if they ask us instead.
2. Release the Twilio number after 30 days.
3. Delete data per retention/agreement; write the final event. (Deleting a whole firm has no
   script yet: PLAN.md Parking lot.)
