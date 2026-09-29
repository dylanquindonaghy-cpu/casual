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

1. CI green on `main`.
2. GitHub Action SSHes to the Lightsail instance: `docker compose pull && docker compose up -d`.
3. Migrations run as a one-off `migrate` step before `web` and `worker` start
   (`docker compose run --rm migrate`, i.e. `npm run db:migrate`). Only that step has
   `DATABASE_ADMIN_URL` (the owner). The web and worker must never hold owner credentials.
   The migrate step also creates the app and jobs roles if missing, forces RLS, applies grants
   and installs pg-boss; the worker's pg-boss never changes the schema itself.
4. Check `/api/health` and the office Today page on a phone.
5. Post a one-line note in the Hours log.

**Never deploy** between 05:30 and 09:00 UK on an event day for any pilot firm, or during a live
event.

## Rollback

1. `docker compose pull web:<previous-tag> worker:<previous-tag>` (tags are git SHAs).
2. `docker compose up -d`.
3. If a migration must be reverted, restore the database (below) rather than hand-editing.

## Restore the database

1. Lightsail → Databases → snapshots → restore to a new instance.
2. Point `DATABASE_URL`, `DATABASE_JOBS_URL` and `DATABASE_ADMIN_URL` at it; restart `web`
   and `worker`.
3. Check counts: firms, workers, shifts, events for today.
4. Test a restore once a month even when nothing is wrong.
5. Use snapshots, not `pg_dump`: RLS is forced on every table, so `pg_dump` as the owner fails
   (or dumps no firm rows with `--enable-row-security`). Firm data exports go through the app.

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

1. Twilio fallback URL already forwards calls to the manager's mobile. Confirm it's set.
2. Text the resourcer: "Portal down, calls forwarding to you, ETA X."
3. Check: health endpoint, Docker containers, disk space, database status page, Twilio status.
4. Restart `web` and `worker`. If the database is the problem, restore.
5. When back: queued jobs resume; check the urgent shifts didn't miss escalations; re-send any
   offers marked failed.
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

A row whose mobile matches an existing worker updates that worker (mobile is who they are). On a
credential, a blank cell leaves that field as it is (a re-import never un-suspends a licence or
wipes an expiry); an expired licence given a new future expiry becomes valid. A shift with people
booked can't have its times or role changed, or its number needed lowered, by an import: use the
office shift editor (Phase 5). Shifts that have started can't be imported or changed. A shifts
file without Shift IDs matches shifts by site, role and times, so changing a time in such a file
adds a new shift and leaves the old one (and anyone booked on it) as it was.

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

- **Worker asks for their data:** office → worker detail → export (JSON + CSV), send within 30 days.
- **Worker asks for deletion:** office → delete (keeps the anonymised events needed for the
  notice report if the firm requires it; otherwise full delete). Log it.
- **Breach:** contain, note the timeline, tell the firm (controller) immediately; the firm decides
  on ICO notification within 72 hours.

## Offboarding a firm

1. Export their data (workers, shifts, events, reports) and hand it over.
2. Release the Twilio number after 30 days.
3. Delete data per retention/agreement; write the final event.
