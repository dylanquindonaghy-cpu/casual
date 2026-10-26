# Runbooks

Short, do-this-now guides. Keep them current.

## Set up the server (once)

Creates the app server and its database at a UK or EU host that runs Docker (ADR-021; which host
is your choice: PLAN.md Deploy 9, "Connect hosting"). It costs money from then on: check the host's
monthly prices before you buy (PLAN.md Checks 2). It's mostly done by clicking in the host's control
panel (steps 2, 7 and 8 also have a few typed commands). Every host names its menus differently,
so each step says what to look for. (Once the host
is chosen, Claude adds where each thing is in its control panel.)

1. **An account, made safe first:** sign up with the host. Straight away:
   - turn on two-step login (MFA: a code from your phone), in the account's security settings;
   - a spending alert before anything costs money: look for "billing alert", "budget" or "spending
     limit", set £50 and your email. You get an email if the month's bill heads past £50. (If the
     host has none, look at its bill once a month.)
2. **The app server:** create a server (the host may call it a "server", "instance" or "VPS"):
   - Ubuntu 24.04, 2 CPUs and 4 GB of memory (the cheapest such plan);
   - a UK or EU region. Write down which: the database goes in the same one;
   - the name `shiftdesk-app`;
   - if it asks how you'll log in: an SSH key, never a password. Make one on your own computer (in
     WSL): `ssh-keygen -t ed25519`, press Enter for the file name, then type a passphrase twice
     (keep it in your password manager). `cat ~/.ssh/id_ed25519.pub` prints one line starting
     `ssh-ed25519`: paste that line into the host's box;
   - its first-boot script: the box called "user data" or "cloud-init" (often under advanced
     options). Paste the whole of `deploy/cloud-init.sh` into it. On first boot it installs the
     security updates (and keeps installing them, restarting the server at 02:30 UTC when one needs
     it), Docker, and a root-only `/opt/shiftdesk`. No such box: step 7 runs it by hand.
3. **Its firewall, straight away:** in the host's firewall settings for the server (the control
   panel's, outside the server, so nothing on the server can open a port by mistake):
   - allow incoming TCP ports 80 and 443 from everywhere (IPv4 and IPv6);
   - SSH (port 22): closed if the host has a browser console that gets you onto the server (step
     7). Otherwise allow it only from your own internet address (search "what is my IP" to see it;
     change the rule if your address changes);
   - nothing else.

   Then read the rules back: only 80 and 443 may be open to everywhere (`0.0.0.0/0` and `::/0`, or
   "All IPv4" and "All IPv6"). Anything else open to everywhere: remove it.
4. **A fixed IP address:** look for "static", "reserved" or "floating" IP and attach one to the
   server (some hosts give every server a fixed one: their help pages say so). Write it down: the
   DNS records point at it.
5. **The database:** the host's managed Postgres (often "managed database" or "databases"):
   - Postgres 16, the cheapest plan (one database, not a "high availability" pair);
   - the same region as the server;
   - a database named `shiftdesk` and, if it lets you choose the admin user's name,
     `shiftdesk_owner`. If the host picks either name itself, use its names instead, in `.env`'s
     three database addresses and in this runbook's commands;
   - **not public:** only the app server may reach it. Look for "public access" (turn it off),
     "trusted sources" or "allowed IP addresses" (add only the app server, by name or its private
     address), or a "private network" shared with the server;
   - **backups on:** nightly, and "point-in-time restore" too if it offers it. If you can choose
     when: backups around 01:00 UTC, and upkeep ("maintenance window") early on a Tuesday morning,
     away from event nights (Friday, Saturday) and event mornings.

   The control panel shows when it's ready (it can take a while). Then write down its address: in
   its connection details, the host name to connect from the server (the private one, if it shows
   two). Use that name exactly: the certificate check compares it with the name on the database's
   certificate. Write down its port too: 5432 unless the connection details say otherwise. If it
   isn't 5432, use it in place of `:5432` in `.env`'s three database addresses and in the drill's
   check.
6. **The database password:** the control panel shows the admin user's password (or you set it).
   Put it in your password manager; it goes in the server's `.env` (the deploy steps). Never in
   the repo. Inside a database address (`postgres://…`) write every character that isn't a letter
   or a digit percent-encoded: for example `#` is `%23`, `?` is `%3F`, `%` is `%25`, `@` is `%40`,
   `/` is `%2F` and `:` is `%3A` (ask Claude if unsure). In `.env` put the whole value in single
   quotes.
7. **Get onto the server:** the host's browser console (look for "console" or "web console" on
   the server's page). The runbooks call it "the server's browser console". A host without one:
   SSH from your own computer instead, `ssh <user>@<the fixed IP>` (the user name the host gives,
   often `root` or `ubuntu`), and use that wherever the runbooks say "browser console". Then:
   - if you pasted the first-boot script in step 2, check it finished: `sudo cloud-init status
     --long` says "done", and `docker --version` prints a version;
   - if the host had no "user data" box, run the script by hand once: `sudo -i`,
     `nano /root/cloud-init.sh`, paste the whole of `deploy/cloud-init.sh`, save (Ctrl+O, Enter,
     Ctrl+X), then `sh /root/cloud-init.sh` (a few minutes of install messages). Then
     `docker --version` prints a version, and `ls -ld /opt/shiftdesk` starts `drwx------` and
     shows `root root`.
8. **The database's CA certificate** (every database connection is checked against it): in the
   database's connection details, download its CA certificate. It's a text file that starts with
   `-----BEGIN CERTIFICATE-----`. Open the downloaded file in a text editor (Notepad, or
   `cat <the file>` in WSL) and copy everything, from the BEGIN line to the END line; if the host
   shows the certificate as text on the page, copy that instead. On the server, as root
   (`sudo -i`):
   `mkdir -p /opt/shiftdesk/secrets`, then `nano /opt/shiftdesk/secrets/db-ca.pem`, paste the
   whole file (from the BEGIN line to the END line), save (Ctrl+O, Enter, Ctrl+X), then
   `chmod 644 /opt/shiftdesk/secrets/db-ca.pem` (a public certificate, not a secret: the app runs
   as an ordinary user and must be able to read it). Check it:
   `openssl x509 -in /opt/shiftdesk/secrets/db-ca.pem -noout -subject -enddate` prints its name
   and the date it runs out (an error means the paste is incomplete: do it again). Docker won't
   start the app without this file, on purpose. If the host offers no CA certificate for the
   database, ask Claude before going on.
9. **DNS:** at the company where you bought the domain, add two A records pointing to the fixed
   IP: the domain itself, and `*` (every firm's subdomain).

Then the deploy steps below.

**If the host has no managed Postgres:** Postgres runs in Docker Compose on the server instead,
over a Unix socket (no TLS or CA file needed; ADR-021). The real server's compose file doesn't have
it yet: skip steps 5, 6 and 8, and ask Claude to add it, with its nightly backup, before the first
deploy (PLAN.md "Connect hosting"; `deploy/docker-compose.demo.yml` already runs Postgres that way
for a demo server, which needs no backup). Until then Deploy steps 2 and 5 below don't apply to
this case: today's compose file won't start without the CA file.

## Deploy

How it works (Phase 8): deploys **pull**, nothing pushes into the server (SSH is closed, or open
only to you: "Set up the server (once)" step 3). Merging to `main` runs CI; when CI passes,
`.github/workflows/deploy.yml` builds the image and puts it in GitHub's registry as
`ghcr.io/<owner>/<repo>:<commit SHA>` and `:main`. On the server, `deploy/deploy.sh` runs every 2
minutes (a systemd timer): if the running containers aren't on the chosen image (a new one, or a
deploy that failed and needs retrying) it runs the migration step (`migrate`, the only service with
the owner's database login: it also creates the app and jobs roles if missing, forces RLS, applies
grants and installs pg-boss), then starts the new version and waits until it's healthy. A failed
migration stops there and the old version keeps running; a new version that doesn't come up healthy
shows as a failed run in `journalctl -u shiftdesk-deploy`. When the image hasn't changed, each run
still applies any change you made to `.env` (Docker Compose recreates only the containers whose
settings changed, and starts the worker once it's turned on), printing "Applied the settings in
.env" when something changed (otherwise only Docker's own "Pulling … Pulled" lines for the image
check).
**A migration that adds an index** (like `drizzle/0048_big_firm_indexes.sql`) builds it inside
the migrations' one transaction: every pending migration runs in a single transaction, so each table
it touches stays locked against writes until the whole run commits (reads carry on). At pilot size
that's a second or two. It also waits behind any transaction already open on those tables, so a
stuck one holds up the deploy (the old version keeps serving meanwhile). Once a table holds millions
of rows, add the index without holding writes, in this order, before merging (the server pulls a
new image within minutes of the merge):
1. Declare the index in `src/lib/db/schema/` and run `npm run db:generate` (not `--custom`, whose
   snapshot leaves the index out, so the drift check in `scripts/invariants.sh` fails and the next
   generate writes it again).
2. In the generated SQL, change that one line to `CREATE INDEX IF NOT EXISTS` (a deliberate hand
   edit: say so in the commit).
3. On the server, as the owner (the `DATABASE_ADMIN_URL` login: only the tables' owner may add an
   index), run `CREATE INDEX CONCURRENTLY <name> ON …` with the same name and columns, outside any
   transaction.
4. Check it's usable: `select indisvalid from pg_index where indexrelid = '<name>'::regclass` must
   say `t`. A build that failed or was stopped leaves an invalid index that `IF NOT EXISTS` would
   skip: `DROP INDEX CONCURRENTLY <name>` and build it again.
5. Merge. The migration finds the index there and does nothing.

**It never deploys between 05:30 and 09:00 UK time on its own** (event mornings): a merge, or a
change to `.env`, then goes out at 09:00. A fix that can't wait: run `/opt/shiftdesk/deploy.sh
--now` by hand.

The job worker stays off until the Twilio sender exists: it can't start in production before then
(messages must never be printed instead of sent), so `.env` has `COMPOSE_PROFILES=` empty and only
the web app and Caddy run. After "Connect Twilio": set `COMPOSE_PROFILES=worker` and the messaging
values, then `./deploy.sh --now`: it prints the worker being created and started, waits until
it's healthy (about a minute), then "Applied the settings in .env", and `docker compose ps` shows
the worker "healthy". If it fails instead ("No new image, but the app isn't running healthily"),
`docker compose logs --tail 50 worker` shows why (usually a value missing in `.env`).

**The first time** (after "Set up the server (once)"), in the server's browser console (`sudo -i`
first):

1. Copy six files from the repo's `deploy/` folder into `/opt/shiftdesk`: `docker-compose.yml`,
   `Caddyfile`, `deploy.sh`, `env.example`, `shiftdesk-deploy.service` and `shiftdesk-deploy.timer`
   (the console has an upload button, or paste each into `nano /opt/shiftdesk/<name>`). Then
   `chmod 700 /opt/shiftdesk/deploy.sh`.
2. `cd /opt/shiftdesk && cp env.example .env && chmod 600 .env && nano .env`: fill in every value
   (the comments in the file say where each comes from). Generate new secrets with
   `openssl rand -base64 32` (the session secret, and a second one for the planner integration
   secret: "The planner integration secret" below) and `openssl rand -hex 24` (the app and jobs
   passwords). The database's address and the owner's password come from "Set up the server
   (once)" steps 5 and 6. Keep the end of the three database addresses as it is
   (`?sslmode=verify-full&sslrootcert=/app/db-ca.pem`): the connection is encrypted and the
   database's certificate checked against the host's CA certificate, `secrets/db-ca.pem` next to
   the compose file ("Set up the server (once)" step 8: `ls -l /opt/shiftdesk/secrets/db-ca.pem`
   shows it, `-rw-r--r--`; the app sees it at `/app/db-ca.pem`). The app won't start in production
   without the ending, and Docker won't start it without the file.
3. Let the server read GitHub's registry: on GitHub → your picture → Settings → Developer settings →
   Personal access tokens → Tokens (classic) → Generate new token (classic), tick only
   `read:packages`, no expiry or a long one. Then on the server:
   `echo <token> | docker login ghcr.io -u <your GitHub username> --password-stdin` (it says "Login
   Succeeded"). The token is kept in root's Docker settings; keep a copy in your password manager.
4. The image must exist: merge to `main` once and wait for "Deploy image" to finish in GitHub's
   Actions tab.
5. Start it by hand the first time: `./deploy.sh --now` (it prints "Deploying …" then "Deployed …
   (commit <the commit's 40-character SHA>)"). Then `docker compose ps` shows web ("healthy") and
   caddy "Up" (and the worker "healthy", once it's turned on after "Connect Twilio"). If the
   migration step stops with a certificate error ("self-signed certificate", "unable to verify",
   "unable to get local issuer certificate", "does not match certificate's altnames"), don't remove
   the end of the database addresses: tell Claude, with the message (the CA file, or the address
   used, may need changing). If it stops because `/opt/shiftdesk/secrets/db-ca.pem` isn't there
   ("bind source path does not exist"), save it first ("Set up the server (once)" step 8).
6. Turn on the timer: `cp /opt/shiftdesk/shiftdesk-deploy.service /opt/shiftdesk/shiftdesk-deploy.timer
   /etc/systemd/system/`, then `systemctl daemon-reload && systemctl enable --now
   shiftdesk-deploy.timer`. `systemctl list-timers shiftdesk-deploy` shows the next run.

**Every deploy after that:** merge to `main`. Within a few minutes of CI passing (outside
05:30–09:00 UK), `journalctl -u shiftdesk-deploy` shows "Deployed … (commit <its SHA>)". Then check
`https://<our domain>/api/health` says `{"ok":true}` and the office dashboard works on a phone.
Post a one-line note in the Hours log.

**Changing a setting** (in `.env`): as root, `nano /opt/shiftdesk/.env`, make every change, save
once (the timer could apply a half-done edit saved part-way), then `/opt/shiftdesk/deploy.sh
--now`. It prints "Applied the settings in .env" (or nothing, if the change didn't affect any
container). Without `--now`, the timer applies it within 2 minutes (after 09:00 on event mornings).

- **Turning the worker off again:** empty `COMPOSE_PROFILES=` in `.env`, then
  `docker compose rm --stop --force worker` (turning a profile off doesn't remove its container).
- **Stopping a container on purpose** (the worker during an incident, say): stop the timer first,
  `systemctl stop shiftdesk-deploy.timer`, or its next run starts it again within 2 minutes. Start
  the timer again afterwards: `systemctl start shiftdesk-deploy.timer`.

**Never deploy** between 05:30 and 09:00 UK on an event day for any pilot firm, or during a live
event (the script enforces the first; for the second, pin the current version, below, until the
event is over).

## A demo server

The made-up demo (Acme Events and Northline Rail Labour, from the seed) on a small server of your
own, so you, or someone you show it to, can click through the real app online (Phase 16; ADR-025).
Nothing real happens on it:

- **No texts or emails go out.** Each firm's **Demo phone** page (`https://acme.<your domain>/demo`,
  linked from the yellow demo bar on every page) shows what would have been sent, newest first.
  Tap a login link there, as you would on a phone.
- **The whole site asks for one password** (user name `demo`), and the browser remembers it for
  each address (`acme.…` and `northline.…` ask once each).
- **Made-up people only.** The demo's database refuses real phone numbers and email addresses, and
  the worker stops if one ever gets in. Names, notes and photos aren't checked, so never type,
  import or upload anything real on it (golden rule 7), and say so to whoever you show it to.
- **Loaded afresh every night** at 04:00 UK time: the demo's dates move on with the calendar and
  whatever visitors did is cleared. No backups: there's nothing to keep.

It costs the server (Hetzner CX23: about €5.49 a month, plus €0.50 for its IPv4 address) and your
domain. Nothing else: no text or email account, no database service.

The steps are done once, in this order. Where a step says "on the server", you're logged in to it
(step 3) as root.

1. **The server.** In the Hetzner Cloud console, open your project and check the server you made:
   Ubuntu 24.04, type **CX23** (Intel/AMD). A CAX server (Arm) won't run the app's image: if yours
   is CAX, delete it and make a CX23 instead. If you pasted `deploy/cloud-init.sh` into "Cloud
   config" when making it, it has already installed Docker and the security updates; if not,
   step 3 runs it. Write down its IPv4 address (on the server's page).
2. **Its firewall.** Hetzner Cloud console → **Firewalls** → **Create Firewall**. Inbound rules:
   - TCP port 22 from your own IP address only (search "what is my IP" to see it; change the rule
     if your address changes);
   - TCP port 80 and TCP port 443 from anywhere (Any IPv4 and Any IPv6);
   - nothing else.

   Under **Apply to**, pick the server, then **Create Firewall**.
3. **Log in to it**, from your computer (in WSL on Windows): `ssh root@<the server's IPv4>` (the
   SSH key you gave Hetzner; type `yes` the first time). Then:
   - if you didn't paste the cloud-init script: open `deploy/cloud-init.sh` on GitHub, copy all of
     it, then on the server `nano /root/cloud-init.sh`, paste, save (Ctrl+O, Enter, Ctrl+X) and
     run `sh /root/cloud-init.sh` (a few minutes of install messages);
   - check: `docker compose version` prints 2.24.4 or later, and `ls -ld /opt/shiftdesk` starts
     `drwx------`.
4. **Your domain's DNS.** Where you bought the domain (on Cloudflare: your domain → **DNS** →
   **Records**), add two **A** records, both to the server's IPv4 address:
   - name `@` (the domain itself);
   - name `*` (every firm's address: `acme.<your domain>`, `northline.<your domain>`).

   On Cloudflare set both to **DNS only** (the grey cloud, not the orange one): the server gets
   its own certificates. Check from your computer, after a few minutes:
   `ping acme.<your domain>` shows the server's address.
5. **The app's image.** GitHub builds it each time a change is merged to `main` (the repository's
   **Actions** tab → "Deploy image", green). It's private, so the server needs a key to download
   it: on GitHub → your picture → **Settings** → **Developer settings** → **Personal access
   tokens** → **Tokens (classic)** → **Generate new token (classic)**, tick only `read:packages`,
   no expiry or a long one, **Generate**, and copy it (keep a copy in your password manager). On
   the server: `echo <the token> | docker login ghcr.io -u <your GitHub user name> --password-stdin`
   says "Login Succeeded".
6. **The server's files**, copied out of the image itself (so they match it), on the server (the
   image's name is `ghcr.io/<owner>/<repo>` in lowercase; this repository's is
   `ghcr.io/dylanquindonaghy-cpu/casual`):

   ```
   cd /opt/shiftdesk
   docker pull ghcr.io/dylanquindonaghy-cpu/casual:main
   id=$(docker create ghcr.io/dylanquindonaghy-cpu/casual:main)
   docker cp "$id":/app/deploy/. /opt/shiftdesk/
   docker rm "$id"
   chmod 700 deploy.sh demo-reset.sh
   ```

   `ls` now shows `docker-compose.yml`, `docker-compose.demo.yml`, `Caddyfile`, `deploy.sh`,
   `demo-reset.sh`, `env.demo.example` and four `.service` and `.timer` files.
7. **The settings**, on the server: `cp env.demo.example .env && chmod 600 .env && nano .env`, then
   fill in each empty value (the comments say what each is):
   - `SHIFTDESK_IMAGE=ghcr.io/dylanquindonaghy-cpu/casual`;
   - `APP_BASE_DOMAIN` (your domain, e.g. `shiftdesk-demo.co.uk`) and `ACME_EMAIL` (your email);
   - `DEMO_SITE_PASSWORD`: the password you'll give people, 12 characters or more;
   - `SESSION_SECRET`: the output of `openssl rand -base64 32` (run it in a second window);
   - `DEMO_DB_PASSWORD`, `DEMO_DB_APP_PASSWORD`, `DEMO_DB_JOBS_PASSWORD`: three different outputs
     of `openssl rand -hex 24`.

   Leave the rest as it is (the three database addresses are made from those passwords). Save.
8. **Load the demo and start it**, on the server: `./demo-reset.sh`. The first time it downloads
   Postgres and Caddy (a few minutes), makes the database, loads the demo, starts everything and
   waits until it's healthy. It ends with "The demo is loaded afresh." Check: `docker compose ps`
   shows postgres, web and worker "healthy" and caddy "Up".
9. **Keep it fresh and up to date**, on the server:

   ```
   cp shiftdesk-deploy.service shiftdesk-deploy.timer shiftdesk-demo-reset.service shiftdesk-demo-reset.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now shiftdesk-deploy.timer shiftdesk-demo-reset.timer
   ```

   `systemctl list-timers 'shiftdesk*'` shows both. A change merged to `main` reaches the server
   within a few minutes of its image being built (never between 05:30 and 09:00 UK time; "Deploy"
   above), and the demo is loaded afresh at 04:00 every night.
10. **Try it** on your phone: `https://acme.<your domain>`. The browser asks for a user name and
    password: `demo` and your `DEMO_SITE_PASSWORD`. The yellow bar says it's a demo. (The first
    visit to each address takes a few seconds longer: the server gets its certificate then.)
    - As a casual: enter `07700 900101` (Zoe) and tap **Send me a link**, then **Demo phone** in
      the bar: the text with the link shows within a few seconds. Tap the link, then **Log me in**.
    - As the office: `https://acme.<your domain>/office/login` with `acme.admin@example.com`
      (or `acme.resourcer@…`, `acme.payroll@…`); the email shows on the Demo phone.
    - Northline: `https://northline.<your domain>` (asks for the password again, once), with
      `northline.admin@example.com`.
    - The full tour, step by step: docs/walkthrough.md (its numbers and logins are the demo's).

**Showing it to someone:** send them `https://acme.<your domain>`, the user name `demo` and the
password. **Changing the password:** on the server, `nano /opt/shiftdesk/.env`, change
`DEMO_SITE_PASSWORD`, save, then `/opt/shiftdesk/deploy.sh --now` ("Applied the settings in .env").
**Loading it afresh now** (say, before a meeting): `/opt/shiftdesk/demo-reset.sh`.
**Updating Postgres** (its security fixes; the deploy only updates the app): every month or so,
`cd /opt/shiftdesk && docker compose pull postgres && ./demo-reset.sh`.
**The database's passwords** (`DEMO_DB_PASSWORD` and the other two) are set when its volume is
first made. To change them: `cd /opt/shiftdesk && docker compose down && docker volume rm
shiftdesk_pgdata` (only the demo's database, which is made up; the certificates stay), edit `.env`,
then `./demo-reset.sh`.

**If something's wrong:**
- The site doesn't open, or the browser warns about the certificate: DNS isn't pointing at the
  server yet (`ping`, step 4), or Cloudflare's orange cloud is on. `docker compose logs --tail 50
  caddy` (in `/opt/shiftdesk`) says why.
- `https://<your domain>/api/health` says `{"ok":true}` (no password needed) when the app is up.
- `docker compose ps` shows what's running; `docker compose logs --tail 50 web worker` shows why
  one isn't.
- The worker stopped, saying "demo mode refuses to run": a firm that isn't a demo firm, or a
  person with a real number or email, got into the database. `./demo-reset.sh` loads the demo
  afresh (it refuses if a firm that isn't a demo firm is there: ask Claude).
- `journalctl -u shiftdesk-demo-reset` shows why a night's reset failed. A refused one (it isn't
  sure this is a demo server) leaves the demo as it was; one that stopped part-way (after the
  database was emptied) can leave it empty or half-loaded: run `./demo-reset.sh` again.

## Rollback

1. Find the last good version's image tag: GitHub → the repo → Packages (on the right) → the image.
   Its tags are 40-character commit SHAs, newest first, and only those commits have an image (one
   per push to `main` that passed CI, not one per commit). Copy the whole SHA of the one before the
   bad version: the short 7-character one isn't found.
2. In the server's browser console, become root first (everything in `/opt/shiftdesk` is root's):
   `sudo -i`, then `cd /opt/shiftdesk`. Stop the timer first, so a run of its own can't start the
   old version with its migration step part-way through this: `systemctl stop
   shiftdesk-deploy.timer` (if it says "Another deploy is running." below, wait a minute and run it
   again). `nano .env`, set `SHIFTDESK_TAG=<that SHA>` (Ctrl+O, Enter, Ctrl+X to save and leave),
   then `./deploy.sh --now --no-migrate`. It prints "Deploying …" then "Deployed … (commit <that
   SHA>)". `--no-migrate` because an older version's migration step can't run against a database
   a newer version has changed (and doesn't need to: migrations only add). `--now` works on event
   mornings too. Then `systemctl start shiftdesk-deploy.timer`: while pinned, merges to `main`
   aren't deployed.
3. When the fix is out: set `SHIFTDESK_TAG=main` again (as root, `nano /opt/shiftdesk/.env`); the
   next run deploys it, with its migration.
4. If a migration must be reverted, restore the database (below) rather than hand-editing.

## Restore the database

1. In the host's control panel, the database's backups (or "snapshots"): restore the newest one
   from before the problem (or, with point-in-time restore, a time just before it) to a **new**
   database, never over the live one. Give it a real name (e.g. `shiftdesk-db-2`), **never**
   `shiftdesk-db-drill`: that name is the drill's, and the drill's copy is deleted the same day.
   Set it up like the first ("Set up the server (once)" step 5): not public, only the app server
   allowed, backups on. Wait until the control panel shows it ready.
2. Point the app at it: in the server's browser console, `sudo -i`, `cd /opt/shiftdesk`,
   `nano .env`, and in `DATABASE_URL`, `DATABASE_JOBS_URL` and `DATABASE_ADMIN_URL` replace the old
   database's address (the part after `@`, before the port, `:5432`) with the new one's (its
   connection details in the control panel, as in "Set up the server (once)" step 5). The user names
   and passwords stay (a restore of the host's backup should keep them: check this the first time,
   below). Change all three, save once (the deploy timer applies a saved `.env` within 2 minutes, so
   don't save part-way), then `docker compose up -d`: it recreates `web` and `worker` with the new
   values (`docker compose restart` would **not**: it keeps the old ones). Within about a minute
   `docker compose ps` shows web "healthy". If it doesn't, and `docker compose logs --tail 50 web`
   shows a certificate error, the new database may have its own CA certificate: move the old file
   aside (`mv secrets/db-ca.pem secrets/db-ca.pem.old`), save the new database's as in "Set up the
   server (once)" step 8, then `docker compose up -d --force-recreate` (a replaced file needs this).
   Still failing: don't remove the end of the addresses; tell Claude, with the message.
3. Check it's recent: the newest event (the recency check in "Restore drill (monthly)" step 2,
   run against the new database) should be from just before the problem. (Plain counts as the
   owner show nothing: RLS is forced.)
4. Test a restore once a month even when nothing is wrong ("Restore drill (monthly)", below).
5. Use the host's backups, not `pg_dump` as the owner: RLS is forced on every table, so `pg_dump`
   as the owner fails (or dumps no firm rows with `--enable-row-security`). Firm data exports go
   through the app.

**Postgres in Compose** (a host with no managed Postgres; ADR-011 as amended): there are no host
backups to restore, so the backups are ours: a `pg_dump` run as the `postgres` superuser (the owner
sees no firm rows under forced RLS), with a copy kept off the server. A restore loads the newest
dump, as `postgres`, into a new database; then step 2 points the app at it and step 3 checks it.
Not set up yet: Claude adds the database service, its nightly dump and the exact commands here
first ("Set up the server (once)", the last paragraph).

## Restore drill (monthly)

Proves the backups can be restored, without touching the real database. It's a few clicks in the
host's control panel and one check on the server:

1. Restore the newest backup (with point-in-time restore: the latest time it offers) to a new,
   separate database named `shiftdesk-db-drill`, set up like the real one ("Set up the server
   (once)" step 5: the same region, not public, only the app server allowed). Only ever to a new
   database: never a restore that replaces the live one. Wait until the control panel shows it
   ready, and copy its address from its connection details.
2. Check it's a recent copy: in the server's browser console (not your own computer: the database
   is only reachable from the server),
   `sudo docker run --rm -it postgres:16-alpine psql "postgres://shiftdesk_owner@<drill address>:5432/shiftdesk"`
   (your admin user's name in place of `shiftdesk_owner`, if the host chose another, and its port
   in place of `5432` if it's different; it asks for
   the real owner password: a restore should keep it), then paste:

   ```sql
   select set_config('app.current_firm_id', (select id::text from firms order by created_at limit 1), false);
   select max(created_at) from events;
   ```

   The time shown should be just before the time you restored to: minutes ago with point-in-time
   restore, last night with nightly backups only (a backup that's days old shows an old time).
   `\q` leaves psql. Never point the app at the drill database.
3. Delete it today: in the control panel, delete `shiftdesk-db-drill`. Read the name twice before
   you confirm: never the real database. It costs money while it exists. Check the list of
   databases no longer shows it. Then `sudo docker image rm postgres:16-alpine` on the server to
   free the space.
4. Note the date and "restore drill OK" in the Hours log.

With Postgres in Compose, the drill loads the newest dump into a separate database on the server
(never the real one), runs step 2's check against it, then removes it. The commands come with the
database service.

## Try the runbooks for real (once, before the pilot's data)

Deploy, Rollback and Restore have never been run: Deploy and Rollback were checked only against the
scripts, and Restore is written for any host, not yet yours. Try each once on the real server
**after "Connect Twilio" and "Connect an email provider (SMTP)"** (office logins come by email, sent
by the worker, which can't run in production before Twilio) and **before any real worker's data is
imported** (Gate B): the database then holds only a test firm of your own, so a restore that goes
wrong costs nothing. Allow about two hours on a weekday, outside 05:30–09:00 UK. Write each result
in the table at the end, and tell Claude anything that was wrong or unclear so the runbook gets
fixed.

0. **A test firm** (the live database starts empty: the demo firms are only ever made on your own
   computer). On the server, through the owner service ("Onboarding a pilot firm", running an owner
   command): `docker compose run --rm owner node --import tsx scripts/firm-create.ts --slug trial
   --name "Trial Firm" --sector security --admin-email <your own email> --admin-name "<your name>"`.
   It says "Created … and its admin.". Then open `https://trial.<our domain>/office` on your phone
   (the first visit takes a few seconds while Caddy gets its certificate) and log in with the link
   emailed to you: the dashboard opens. Keep it as your own test firm afterwards (there's no
   command to delete a firm yet: "Offboarding a firm").
1. **Deploy.** After the first deploy ("Deploy", the first time), merge any small change to
   `main` (ask Claude for a harmless one). Worked if, within a few minutes of CI passing:
   `sudo journalctl -u shiftdesk-deploy --since "15 minutes ago"` shows "Deployed … (commit <the
   new commit's SHA>)"; `sudo docker compose -f /opt/shiftdesk/docker-compose.yml ps` shows web
   "healthy"; `https://<our domain>/api/health` says `{"ok":true}`; the test firm's office
   dashboard opens on your phone.
2. **Rollback.** Follow "Rollback" steps 1–2 with the SHA of the version *before* the one you just
   deployed. Worked if "Deployed …" shows that older SHA, the site still works, and it's still on
   it 5 minutes later (the timer leaves a pin alone). Then step 3 (`SHIFTDESK_TAG=main`): within a
   few minutes "Deployed …" shows the newest SHA again.
3. **Restore.** Follow "Restore the database" steps 1–3 with the newest backup, naming the new
   database `shiftdesk-db-2`. Worked if the app comes back healthy on it, the test firm's dashboard
   opens, and the newest event is from just before the backup. Also note whether the passwords
   really were kept (step 2 depends on it). Then point `.env` back at the original database and run
   `docker compose up -d` again (if step 2 moved `secrets/db-ca.pem` aside: first `mv
   secrets/db-ca.pem.old secrets/db-ca.pem`, then `docker compose up -d --force-recreate` instead),
   check the site, and delete `shiftdesk-db-2` in the host's control panel (read the name twice:
   never the original; it costs money while it exists).
4. **Restore drill.** Run "Restore drill (monthly)" once, all four steps.

| Runbook | Date | Worked? | What was wrong or unclear |
|---|---|---|---|
| A test firm | | | |
| Deploy (first time) | | | |
| Deploy (a merge) | | | |
| Rollback (pin and unpin) | | | |
| Restore the database | | | |
| Restore drill | | | |

When every row says it worked (after any fixes), the Phase 8 task "Runbooks tried once for real"
can be ticked.

## Monitoring and alerts (once)

Three things tell you when something's wrong, without you watching.

1. **The host's £50 billing alert** (from "Set up the server (once)" step 1): an email if the
   month's bill heads past £50.
2. **The host's own alerts**, which watch from outside the server: in the control panel, look for
   "monitoring", "alerts" or "alert policies" on the server's page and the database's page. Set
   each to email you (the numbers are a suggested starting point, not a rule):
   - the server down (not answering) for 10 minutes;
   - the server's CPU above 90% for 15 minutes (and, if its plan has "burstable" CPU, its credits
     running low: the server slows once they run out);
   - the server's disk over 80% full;
   - the database's storage over 80% full, or its CPU above 90%.

   Ask for an email when each is back to normal too, if it offers that. If it can send a test
   alert, send one: the email should arrive within minutes. A host that doesn't offer some of
   these: set what it has, and note the missing ones in the Hours log (the uptime check below
   still tells you when the app stops answering).
3. **An uptime check that the app itself answers**, from the internet, with a phone app: sign up
   for an uptime service (UptimeRobot, Better Stack and others have free plans: check the plan's
   terms allow business use), add a plain **HTTPS** monitor (not a keyword one) for
   `https://<our domain>/api/health` every 5 minutes (our own address: it has its certificate
   from the start, firm or no firm), alerting to your email and its phone
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
| "N jobs failed after the last retry in the last hour (queue n, …)" | A background job (an offer wave, a reminder, a notice…) gave up | `docker compose logs worker --since 1h`, look for that queue's errors (codes only, no personal data). Fix the cause; a failed offer wave or notice isn't re-run by itself: tell the firm's office if a worker wasn't told something. A failed `inbound-message` job (a shifts-line answer) has normally already been passed to a person: it's in the firm's Need a person on Enquiries, unless the log says "and so did passing it to a person" (then the message is still unanswered: fix the cause and tell the firm's office) |
| "{firm}'s rota sheet sync is failing ({code})" | The firm's Google Sheet hasn't synced for over 30 minutes and is still failing | The code says why: "Google Sheets sync failing" below. The office sees each failed sync in its action log |
| "{firm}: N of M WhatsApps and texts failed to send in the last hour (P%), mostly {code}" | Twilio refused more than 5% of at least 20 messages (offers, reminders, notices, answers, shifts-line replies; a worker who turned texts off doesn't count) | Twilio's own log shows each refusal with its number (console.twilio.com → Monitor → Logs → Errors). Often: a template not approved, the account out of credit, or a number blocked. (The code in the alert is the app's; Twilio's numbered codes come with the Twilio sender) |
| "the web app's health check is failing (…)" | The worker can't get an OK from the web app on the same server | `docker compose ps` and `docker compose logs web --since 15m`; the outside uptime check says whether the internet sees it too. "Event-morning outage" below |
| "{firm}: N login links by WhatsApp and text in the last hour…" or "…in the last 24 hours…" | The firm sent more than 100 login links in an hour, or more than 300 in a day (14.2). A crowd logging in at once (a big briefing) can do the first; otherwise someone may be asking for links to run up the firm's messages (each is paid) | Ask the firm's office whether they had a briefing or a crowd logging in then. If not, or if it comes back day after day: the firm's action log, Type "Logins", shows each link asked for and sent, and "Too many tries: logging in was paused" where a limit stopped someone (the log keeps no address, only who the link was for). If it keeps up, lower `LIMITS.loginPerIp` or `LIMITS.loginPerNumberDaily` in `src/lib/auth/throttle.ts` (tell Claude) |
| "N Twilio webhook requests with a bad signature in the last hour" | Twilio's messages to us are being refused: `TWILIO_AUTH_TOKEN` in `.env` no longer matches the account (someone rotated it), the address set in Twilio differs from the one the app checks against (http instead of https, or a firm's own domain instead of `<slug>.<our domain>`), or someone is probing | Compare the token with Twilio's console (Account → API keys & tokens), and the webhook addresses with "Connect Twilio". If both match, it's probing: nothing to do unless it keeps up |

### Checking the logs for personal data

The app masks phone numbers and emails before anything is logged; every e2e run checks it. On the
server (after the dry-run day, say): `sudo -i`, `cd /opt/shiftdesk`, then (not yet tried for real)
`docker compose logs --no-color web worker | docker compose run --rm -T --no-deps web node --import
tsx scripts/logs-scan.ts`. It prints "no phone numbers, email addresses, login tokens or keys", or
the line numbers of each one it found (the value itself masked). Anything found: tell Claude which
log line. (A login token in the logs is someone's working login for 15 minutes, or a session for 30
days: also tell them to log out on every device, from the office's Casuals or Office team page. A
"key" is a planner's API key, `shiftdesk_…`, or a `Bearer` value: it works until revoked, so ask
the firm's admin to revoke it on the office's Integrations page (`/office/settings/integrations`)
at once and make a new one for their planner.)

## Workers at one venue can't get login links

Everyone on the same Wi-Fi (or mobile carrier NAT) shares one IP, and the login limit is 60 link
requests per IP per 15 minutes per firm (13.5; enough for a briefing of about 50). For a bigger
briefing, ask people to switch Wi-Fi off and use mobile data, or wait for the window to pass.
Workers who already logged in stay logged in for 30 days, and using a link that works never
counts. If it keeps happening, raise `LIMITS.loginPerIp` in `src/lib/auth/throttle.ts`. (More than
100 login links in an hour, or 300 in a day, from a firm sends you an alert: "Alerts from the app"
above.)

## Rate limits look shared by everyone

If the log says "no X-Real-IP header: rate limits are shared by all clients", Caddy isn't setting
`X-Real-IP` (`reverse_proxy web:3000 { header_up X-Real-IP {remote_host} }`), and one busy client
can lock everyone out of login for 15 minutes. Fix the Caddyfile and reload Caddy. Never publish
the web container's port: Caddy must be the only way in. `{remote_host}` is right only while
nothing sits in front of Caddy; behind a load balancer or CDN use `trusted_proxies` and
`{client_ip}` instead.

## Rotate a secret

Twilio auth token, session secret (and, once they're connected, the SMTP password and the Anthropic
API key): after 22:00, rotate in the provider, update `.env` on the server (the deploy timer applies
a saved `.env` within 2 minutes, so make the edit itself after 22:00 too), then
`docker compose up -d`. Rotating `SESSION_SECRET` doesn't log anyone out (sessions are stored as
sha256 of their own token); it resets every rate-limit counter and cancels one-time codes that are
still live.

Database role passwords (`shiftdesk_app`, `shiftdesk_jobs`): `db:migrate` creates these roles
but never changes an existing password. Rotate by hand as the owner:
`ALTER ROLE shiftdesk_app PASSWORD '...'`, update `DATABASE_URL` (or `DATABASE_JOBS_URL`) in
`.env`, then `docker compose up -d`.

The planner integration secret: only when it may have leaked (next section).

## The planner integration secret (INTEGRATIONS_SECRET)

The planner API (`/api/v1`, 12J.1; `docs/office-v2.md` 5.3) answers only when the server has this
secret: unset or empty, every call gets 503 `not_configured` and the rest of the app works as
usual. It's a server setting, the same for every firm, and nothing to do with a firm's API keys.

- **Setting it (once):** `openssl rand -base64 32` (a new value: never the session secret's, never
  `.env.example`'s, which the app refuses in production), then as root `nano /opt/shiftdesk/.env`,
  `INTEGRATIONS_SECRET=<it>`, save, and `/opt/shiftdesk/deploy.sh --now` ("Applied the settings in
  .env"). Keep a copy in your password manager. Check: a call with a firm's key (the curl examples
  in `docs/integrations.md`) no longer answers 503.
- **What rotating it means:** API keys keep working (each is stored as the sha256 of the key
  itself, not with this secret). The secret is also what each firm's webhook signing secret and
  every event id are made from (12J.2), and the worker needs the same value as the web app
  (`deploy/docker-compose.yml` passes it to both): a new one changes both, so every
  firm with a webhook must paste its new signing secret (from the Integrations page) into its
  planner before deliveries are accepted again, and a delivery retried across the change comes
  with a new event id. So rotate only if it may have leaked, after 22:00 like the others ("Rotate a
  secret"), and tell those firms' admins first.

## A firm's planner webhook is failing

What the office sees: "Your planner's webhook is failing" in Needs attention, "Failing since …" on
Integrations, and "Couldn't reach your planner (gave up at …)" on a cancellation's record. Each
delivery is tried 7 times over about an hour; the last try logs `webhook.failed` with a code
(the action log on `/office/log`, under "Firm settings and office team", says it in words).

1. Read the code: `http_4xx`/`http_5xx` (their planner answered with an error), `timeout` (no answer
   in 10 seconds), `dns` (the name doesn't resolve), `tls` (its certificate isn't valid),
   `refused_address` (the name points at a private address: never sent), `redirect` (it answered
   with a redirect, which is never followed), `not_configured` (`INTEGRATIONS_SECRET` isn't set for
   the worker: see "The planner integration secret").
2. Their admin checks the address with whoever runs their planner (the page shows only its host and
   last 4 characters: they compare with the address in their planner). If the planner checks
   signatures, a 401 or 403 usually means an old signing secret: "New signing secret", then paste
   it in.
3. "Send test event". The page shows "Working · last delivered …" once one gets through, and the
   Needs attention item goes. What failed in between isn't sent again: their planner catches up with
   `GET /api/v1/cancellations?since=` (`docs/integrations.md`).
4. Nothing ever reaches us: the worker log has one `webhook not delivered` line per failed try with
   the firm, the host and the code (`docker compose logs worker | grep "webhook not delivered"`),
   never the address. Some catch-hook services put their key in the host name itself (a Pipedream
   address, say): treat those log lines as you would the address.
5. **Ours, not theirs:** `not_configured` means the worker has no `INTEGRATIONS_SECRET` (fix it, then
   their admin presses "Send test event"). And two cases fail the job instead of logging
   `webhook.failed`, so they come to you as a failed-job alert, not to the firm: the worker stopping
   during the last try, and a body that doesn't match its contract or a database error (a bug: the
   worker log names the error). Their planner catches up with `GET /api/v1/cancellations`.

## A planner's API key or webhook secret may have leaked

1. **An API key:** their admin revokes it on Integrations (it stops at once: the next call gets
   401), creates a new one and gives it to their planner. Every change a key made is in the action
   log with its `keyId`.
2. **A webhook signing secret:** "New signing secret" (the old one stops at once), then paste the new
   one into their planner. A leaked secret lets someone forge webhooks to their planner, not read
   anything from ShiftDesk.
3. **The webhook address itself** (some carry a key in their path): they make a new address in
   their planner or Zapier, then add it on Integrations (that also makes a new secret).
4. **`INTEGRATIONS_SECRET`:** see "The planner integration secret" above: rotate it, then every firm
   with a webhook pastes its new signing secret.

## A page or job fails with a database time limit

Since P4.2 (ADR-027) nothing waits for ever. In the logs or a failed job:
- **57014** ("canceling statement due to statement timeout"): one statement ran longer than its
  limit (15 s on a page, 60 s in a job). A job retries; a page shows its error. If the same one
  keeps failing, find the query, and either make it faster (an index, a cap) or give its
  transaction `allowLonger()` with a reason, in code.
- **25P03** ("terminating connection due to idle-in-transaction timeout") or "Client has
  encountered a connection error and is not queryable": a transaction sat idle (waiting on
  something outside the database) longer than its limit (30 s or 60 s). The connection is closed
  and the pool opens a new one. Work outside the database belongs outside the transaction.
- **"timeout exceeded when trying to connect"**: every connection in the process's pool was busy
  for 5 s (web) or 30 s (worker). Look for a slow query holding them, then at the pool sizes.

The connection budget: the web app's pool of 10, the worker's 15 and pg-boss's 5, about 30 in all,
plus a one-off migration or owner command. The database's `max_connections` must be well above
that: check the host's plan before choosing one (`show max_connections;` as the owner).

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
   outage (Events & sessions → the shift → cancel or change, with the reason), so its notice is logged like any
   other.
6. Write a 5-line post-mortem in the Hours log.

## A bad service worker (My shifts offline copy)

The service worker (`public/sw.js`) stays on workers' phones until a new one replaces it.
Browsers check for a new one each time the portal opens, at least once a day. **Never delete
`public/sw.js` from the site:** a phone that gets a 404 when it checks keeps the old one.

0. Quickest: as root, set `OFFLINE_COPY=off` in `/opt/shiftdesk/.env`, then
   `/opt/shiftdesk/deploy.sh --now` (it says "Applied the settings in .env"). Each phone removes
   the service worker and its copy the next time My shifts opens. (If My shifts itself won't open,
   use step 2.) `OFFLINE_COPY=on` puts it back.

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

## Email not arriving

Office emails (login links, escalations, the credential list, the payroll digest, strike evidence)
are sent by the worker, over SMTP, through the email provider in `.env` (docs/office-v2.md 5.8).
Each failed one is logged with its reason, and never sent twice by itself.

1. **Is the worker running?** In the server's browser console, `sudo -i`, `cd /opt/shiftdesk`,
   `docker compose ps`: `worker` should say "healthy". It's off until "Connect Twilio" (then no
   email goes at all). It refuses to start without the email settings: `docker compose logs --tail
   50 worker` says which one is missing.
2. **What happened to it:** the office's action log (Records → Action log) shows that it failed
   ("A login link to an office user couldn't be sent."). Why: `docker compose logs --since 2h
   worker | grep -E 'EmailNotSent|EmailMayHave'` shows one line per failed email, with the step
   (`step`), the provider's reply code (`responseCode`) and never the address. Which kind:
   - `EmailNotSentError`: it never left. The step says where:
     - `connect`: the provider's address or port is wrong (`SMTP_HOST`, `SMTP_PORT`: 587, or 465 if
       it says "SSL/TLS"), the server can't reach it, or it doesn't offer encryption (we never send
       without it);
     - `login`: the user name or password is wrong (`SMTP_USER`, `SMTP_PASS`);
     - `envelope`: the provider refused the sender (`SMTP_FROM` must be an address on a domain it
       has verified) or the recipient (a typo in the person's address).
   - `EmailMayHaveArrivedError`: the provider got it, or nearly. Look in its activity page before
     sending anything again.
3. **Check the settings** (never print the password): `grep -E
   '^(EMAIL_TRANSPORT|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_FROM)=' .env`. `EMAIL_TRANSPORT` must be
   `smtp`. To change one: `nano .env`, save once; the deploy timer applies it within 2 minutes.
4. **The provider's side:** its dashboard's activity or logs page shows whether each message was
   accepted, delivered, bounced or marked as spam. Ask the person to check their spam folder. If
   messages land in spam, finish the provider's domain checks (SPF, DKIM and DMARC records at your
   domain's DNS: the provider gives the exact lines).
5. **Then send it again from the app:** a login link, ask again on the login page (a new link); the
   payroll digest, "Send the digest now" on the pay queries page.

## Postcodes not found (sites or travel areas)

Settings ("We couldn't find that postcode") and a casual's "Where you work" look each postcode up
when it's saved (12G.1; `docs/office-v2.md` 5.4). Which service does that is the server's
`TRAVEL_PROVIDER`, in `.env`, for the web app and the worker:

- `fake` (the default): knows only the made-up `ZZ` postcodes (development, tests, a demo). Every
  real postcode is "not found". A real firm needs `traveltime`.
- `traveltime`: postcodes.io (free, no key; only the postcode is sent). Turned on by "Connect
  postcodes.io and TravelTime" in `PLAN.md`'s Parking lot, never in tests (refused there).

1. Check which: `grep '^TRAVEL_PROVIDER=' .env`.
2. "We couldn't look that postcode up just now": postcodes.io didn't answer in 5 seconds or sent
   something unexpected. Nothing was saved. Try again in a few minutes; if it lasts, check
   https://postcodes.io (its status) from the server: `curl -s https://api.postcodes.io/postcodes/`
   followed by a public postcode such as a council office's (never a casual's).
3. A site shows "Location not looked up yet": its postcode was saved before look-ups (or while the
   service was off). Save the same postcode again on Settings.
4. Northern Ireland (BT) postcodes need a separate licence first (`PLAN.md` Checks 16).

## Travel provider outage (travel times missing)

Each shift's travel line ("7.2 miles · 18 min by car · 41 min by public transport") comes from
travel estimates the worker works out (12G.2; `docs/office-v2.md` 5.4), never from a page. When
they're missing, a casual sees "about 7 miles (straight line) · Travel time not known yet": shifts
are never hidden because of it, and an unknown distance is still offered.

1. Which service: `grep '^TRAVEL_PROVIDER=' .env`. `fake` works the times out on the server and
   can't be down. `traveltime` asks TravelTime.
2. The worker's log: `docker compose logs worker --since 2h | grep travel.estimates`. A failed job
   says `travel.estimates` with a code: `TravelUnavailableError` means TravelTime didn't answer
   (down, too slow, or an answer we couldn't read). pg-boss tries the job again by itself, 6
   times, further apart each time (from about 5 minutes to an hour: 3 to 4 hours in all). Urgent
   shifts' offers go out anyway; `travel estimates before a wave not finished` (a warning) means
   one went without them.
3. A wrong or missing key: the worker refuses to start with `traveltime` and no
   `TRAVELTIME_APP_ID` / `TRAVELTIME_API_KEY`. A key TravelTime rejects shows as the same
   `TravelUnavailableError`: check the keys in TravelTime's developer portal, then `nano .env`,
   save once; the deploy timer applies it within 2 minutes.
4. Usage limits: TravelTime's plan has a monthly allowance (`docs/office-v2.md` 5.4). If it's used
   up, every search fails until it resets or the plan changes.
5. Once it answers again, nothing else to do: the retries above, then the nightly run (02:20
   London), fill every session in the next 29 days that's missing estimates (each run only
   searches what's missing). Saving a site's postcode again doesn't hurry it: the same postcode is
   "no change" and queues nothing.

## Google Sheets sync failing

`npm run -s firm:sheet -- --firm <slug>` shows the firm's sheet, when it last synced and why it's
failing, in plain words. `roster_sources.last_error_code` (and each `roster.sync_failed` event,
which the office sees in its action log, with the same words) has the code:

- `sheet_locale_not_uk`: the sheet's locale isn't United Kingdom, so its dates could be read the
  wrong way round; nothing was read → ask the firm to set it: in Google Sheets, File → Settings →
  Locale: United Kingdom → Save settings, then to check the sheet's dates (dates typed while it was
  set to another country can move when it's changed). The next sync goes ahead.
- `sheet_unreadable`: Google couldn't read what the sync asked for: a tab was renamed or deleted,
  or the file in Drive is an Excel file, not a Google Sheet → ask the firm to put the tab names back
  (Staff and Shifts, or the ones in its mapping), or to save the file as a Google Sheet (File → Save
  as Google Sheets) and send you the new link (then see "Replacing a firm's sheet" below).
- `sheet_not_shared`: the firm removed the service account → ask them to re-share the sheet with
  its email (Editor).
- `sheet_not_found`: wrong spreadsheet id, or the sheet was deleted → check the link the firm gave
  you. If the sheet was deleted, ask the firm to restore it from Google Drive's Bin (the link stays
  the same); otherwise see "Replacing a firm's sheet" below.
- `missing_column` / `duplicate_column`: a header the mapping names was renamed, removed or
  doubled → fix the header in the sheet; or, if the firm wants its own headings, write a mapping
  file (the shape of `DEFAULT_SHEET_MAPPING`, `src/lib/roster/sheets/mapping.ts`) and run
  `npm run firm:sheet -- --firm <slug> --sheet <link> --mapping <file.json>`. The next sync resumes.
- `sheets_rate_limited`: Google's per-minute quota → each sync makes 2 to 4 requests (the locale,
  one read, and when there's something to write, a re-read of two columns and one write); check
  nothing else is using the service account.
- `sheets_unavailable` / `sheets_auth_failed` / `sheets_bad_response`: Google side or our key →
  check Google's status page and the key file; syncs retry every tick.
- `bad_mapping`: the stored mapping doesn't parse → connect the same sheet again with a mapping that
  does (`--mapping`), or without one for the default headings; the next tick tries again.
- **Replacing a firm's sheet:** `npm run firm:sheet -- --firm <slug> --sheet <new link> --replace`.
  Shifts and staff are matched by their Shift ID and Staff ID, not by which sheet they came from, so
  the new sheet must use the same ones (a copy of the old one). While shifts ahead from the old
  sheet have people booked, it refuses unless you add `--same-ids`, which says the new sheet is
  such a copy: a new sheet that reused "S7" for another shift would cancel or move the people booked
  on S7, logged as the firm's own change.
- **Switching a sheet off:** `npm run firm:sheet -- --firm <slug> --disable`. Its shifts stay but
  freeze: workers can't book them, the office is told to change them in the sheet, and people
  already booked stay booked. **Letting one go** (connected to the wrong firm by mistake, say):
  switch it off, then `npm run firm:sheet -- --firm <slug> --forget --sheet <link>`; another firm
  can then connect it. On the server, a `--mapping` file must be inside the owner container: ask
  Claude before you need one there.
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
   On the live server (any database not on this machine), saving needs two things (Gate B): the
   firm's signing recorded (`npm run firm:agreement -- --firm <slug> --signed <date>`, onboarding
   step 1), and `--agreement-signed <slug>` on the command, repeating the firm's slug. Without
   either, nothing is saved and it says why. The office's own web imports (shifts, pay records)
   need the recorded signing too. "Live" means any database not on this machine: never import
   real data through a tunnel that makes the live database look local (localhost), or both checks
   are skipped. On the server it runs in the one-off owner service: `docker
   compose run --rm owner node --import tsx scripts/import.ts --firm acme --kind workers --as
   <office email> <file> --apply --agreement-signed acme` (the file must be inside the container:
   not yet tried for real).

Reading the file (the same rules as the Sheets sync and the office's shift editor):
- **CSV from Excel on Windows** ("CSV (Comma delimited)") is read as it is: "£" and accented names
  come through. A file it can't read as text says to save it as "CSV UTF-8" or .xlsx.
- **Dates** are day first (07/11/2026), yyyy-mm-dd, or "Sat 7 Nov 2026"; a time after a date
  (Excel's date-and-time cells) is ignored, and a date cell's time never moves its day. A weekday
  that isn't the date's, or a month that isn't a month, is refused.
- **Times:** a finish at or before the start is the next morning; a finish equal to the start, 24
  hours or more, or a time the clocks skip (01:00 to 02:00 on the March Sunday) is refused.
- **Mobiles:** UK mobiles in any usual form (a number cell that lost its 0 is put right); a UK
  landline, or a number too short to be a mobile, is refused.
- **Money:** "£12.50", "12.5", "1,234.56"; a space inside an amount ("12 50") is refused.

A row with a Staff ID updates the worker with that Staff ID, but not both their name and their
mobile at once (a Staff ID reused for a new person: give them a new Staff ID; the same person:
change one, import, then the other). A row without one is matched by mobile, and only if the name
matches too (capitals, spaces, hyphens and the kind of apostrophe aside): a row whose mobile
belongs to someone with another name is skipped ("that mobile belongs to a worker with another
name"), so a mistyped or recycled number never renames someone or hands them another person's
licences or pay. Credentials and pay files are the same: a row without a Staff ID needs the worker's
name too (First name and Last name columns, or Name). The app has no rename yet: for a worker with
no Staff ID who changed their name, import them once with a Staff ID and the name as it's held here
(that links them), then again with the new name. On a
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
   Once both are signed, record the day: `npm run -s firm:agreement -- --firm acme --signed
   04/10/2026` (after step 2, which creates the firm). It says "Recorded…", and `firm:check` shows it
   done. Until then the live server saves no import for the firm (the office's web imports and
   `npm run import`) and `firm:sheet` connects no sheet.
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
   worker is running and emails go out ("Connect Twilio", "Connect an email provider (SMTP)").
   Resourcers and payroll: `npm run -s firm:office-user -- --firm acme --role resourcer --email
   sam@acme-events.example --name "Sam Rota"` (roles: admin, resourcer, payroll). It says "Added: they can
   now log in to acme's office as resourcer." An email that already has a login is left as it is (it says its role and whether it's active).
5. **Rota source** (you and the resourcer): a Google Sheet, or none: shifts made in the office or
   imported from CSV. For a sheet (once "Connect the real Google Sheets" in PLAN.md is done): the
   firm sets its sheet's locale to United Kingdom (File → Settings → Locale) and shares it with our
   service account's email as Editor; then `npm run -s firm:sheet -- --firm acme --sheet <link>`
   (on the server, through the owner service). `npm run -s firm:sheet -- --firm acme` shows when it
   last synced, and why it's failing if it is. A sheet can be connected to one firm only.
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
   The strikes team's email isn't one of these: an admin sets it on the office's **Settings** page,
   and someone at that address opens the emailed link within 7 days and selects **Confirm this
   address** (strike evidence only ever goes to a confirmed address). If the link didn't arrive or
   ran out, the admin selects **Send the link again**. Each site's postcode is on the same page
   (it can't change while people are booked on sessions there that are still to come). A firm can
   send at most 3 links every 15 minutes and 10 a day: past that, the page says how long to wait.
9. **Shifts line** (you): after "Connect Twilio", the firm's number with `npm run firm:line`, and
   WhatsApp's approval of the display name (start early: it can take days).
10. **Privacy notice line** (you send it, the firm publishes it): `docs/privacy-notice.md` has the
    short line and the section for its privacy notice, with what to fill in.
11. **Staff briefing** (the firm): a message to its staff with the portal link.
12. **Dry-run event day** (you and the resourcer): `docs/pilot-playbook.md`.
13. **Baseline numbers** (the resourcer): the office's Pilot figures page, Baseline week.

When `firm:check` shows no `[ ]` and you've confirmed every `[?]`, the firm is ready to go live.

## Someone leaves the office, or loses a laptop

The firm's admins do this themselves on the office team page (`/office/team`): "Turn off access"
(then "Yes, turn off access"), "Turn access back on", "Change role", or "Log out on every device".
Each change is logged in the action log ("Firm settings and office team"). Turning access off logs
them out everywhere at once and spends any login link they haven't used. Turning it back on
doesn't bring back an old session: they ask for a new login link.

A lost laptop or phone: "Log out on every device" ends every session on it. But if their email is
open on that device too, whoever has it can ask for a new link. So turn their access off as well,
until their email password is changed, then turn it back on.

If the firm asks you to do it (their only admin is away, say): first check it's really them. Call
the firm's owner or an admin you already know, on a number you already have, before you act,
above all before `--enable` or `--set-role admin`. Then, on the server ("Running an owner command
on the server" above; this command doesn't need the owner's login):

```
docker compose run --rm --no-deps web node --import tsx scripts/firm-office-user.ts --firm acme --email sam@acme-events.example --disable
```

Swap `--disable` for `--enable`, `--set-role payroll` (or `resourcer`, `admin`) or `--sign-out`.
On your own computer, against your local database: `npm run -s firm:office-user -- --firm acme
--email sam@acme-events.example --disable`.

Each prints what happened, for example "Sam Rota's access is off. They've been logged out
everywhere and can't log in until it's turned back on." Nothing changed (already off, say) also
says so. A firm always keeps one admin who can log in: "Sam Rota is the only admin. Make someone
else an admin first." Add the new admin first (step 4 of "Onboarding a pilot firm"), then turn the
old one off. These are logged as done by the system.

## A worker leaves, comes back, is barred from a site, or loses their phone

The office does this on the casual's page: "Casuals" in the menu, find them by name or mobile.
Admins and resourcers can. Each change needs a reason from a list, and goes in the action log
("Workers").

- **They've left:** "Make inactive", then "Yes". They're logged out at once, can't log in or
  take shifts, get no reminders, and notifications stop on their phones. Any bookings they have
  ahead show on the dashboard under "Bookings to check": cancel each one (they're told; the reason
  "They've left, or can't work here" and the notice go in the notice report) or keep it (then
  tell them yourself: they get no reminders). A kept booking doesn't stop you moving the shift's
  time; moving it to another site asks you to cancel it first. Your rota sheet or a staff file
  can't make them active again: only the office can. With the reason "They've left", their travel
  area (their start-from postcode) is deleted too; any other reason keeps it for when they're back.
- **They're back:** "Make active again". They log in with a new link. If your rota sheet or staff
  file says they're inactive, change it there too.
- **Blocked by your rota sheet or a staff file by mistake:** "Unblock". Change the sheet or file
  too, or its next sync or import blocks them again.
- **A client doesn't want them at a site:** "Block from a site". They can't book or be offered
  shifts there (they're told "This site isn't available to you. Contact the office."), and any
  bookings they have there show on the dashboard to cancel or keep; until you keep one, no reminder goes
  for it. "Unblock from {site}" lifts it.
- **A lost phone:** "Log out on every device". Their logins and unused links end, and
  notifications stop on their phones. If someone else now has their number, change their mobile
  in your rota sheet or staff file: that logs them out too.

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
action log ("The firm's colour changed."), under "Firm settings and office team".

## A firm's own domain (shifts.firmname.co.uk)

Setting one up (owner-only, like `npm run firm:line`). **Not for a real firm yet:** the periodic
re-check of each verified domain's DNS must be built first (`docs/testing.md`, pre-pilot
checklist): login links go to a verified domain, so one that stopped pointing to us must stop
being marked verified on its own.

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
   certificate; then it's the firm's portal with its bar. Workers and office staff who log in
   there get their login link on that address and stay logged in there. Links in other messages
   (offers, reminders) still go to `<slug>.<our domain>`, where they log in once more (parked:
   links in messages on the firm's own domain).
4. To change it: `--domain <new> --replace`. To remove it: `--clear`. Logins made on the old
   domain stay valid until they run out (30 days): a session isn't tied to an address. If the
   domain was lost to someone else, that matters: see the pre-pilot checklist item in
   `docs/testing.md` (a periodic re-check, and a way to end the sessions made there, come first).

Each change is in the office action log under "Firm settings and office team".

## Custom domain not working

- `npm run firm:domain -- --firm <slug> --check`: it says what the CNAME points to. It must be
  exactly `<slug>.<our domain>` (that firm's own subdomain), as a plain, unproxied CNAME. If the CNAME has gone, `--check` marks the domain unverified and
  it stops being served (and approved for certificates) until it's back.
- Check Caddy's logs for the `ask` request (`/api/caddy/ask?domain=…`): a 404 means the name isn't
  a verified firm domain; the app logs `caddy ask` with `approved: false`.
- A certificate can take a minute after verification; Let's Encrypt limits how often it's tried.

## GDPR requests

The firm's admin does these in the office: **Data requests** in the menu's "Configuration"
group (`/office/data`). Every download and deletion goes in the action log ("Data requests and
deletion").

- **Worker asks for their data:** find them by name or mobile, open them, and press
  **Download (JSON)** or **Download (CSV, opens in Excel)**. Send the file to them within a month
  of their request (by a route the firm trusts: it holds their personal details).
- **Worker asks for deletion:** find them, open them, tick **I understand this can't be undone**,
  press **Delete {name}'s personal details**. It's refused while they're booked on a shift that
  hasn't ended: cancel those on the shift's page first (with a reason). Their shift history stays,
  without a name, as the firm's records. Then remove them from the firm's rota sheet or staff file,
  or the next sync or import adds them back as a new worker. Messages they send afterwards arrive as
  from a number we don't know. What other people wrote that names them (a colleague's swap
  request or pay query, someone else's message) isn't changed: some goes on the firm's retention
  schedule, the rest stays as the firm's records. If the worker asks for those too, tell the firm;
  it's the firm's call (and Dylan's to build, if needed). During a hold for a dispute, check with
  the firm before deleting anyone: a hold doesn't stop a deletion.
- **A dispute or tribunal (keep everything for now):** a hold stops the nightly purge deleting
  anything personal for the firm until the day after the date: `npm run -s firm:settings -- --firm
  acme --set retention.hold_until=2027-03-31`. When it's settled: `--set retention.hold_until=none`.
  Each change is in the action log (the firm's settings changed), and every night's purge says
  "a hold is on".
- **A firm's retention periods:** `npm run -s firm:settings -- --firm acme` shows them;
  `--set retention.message_days=180` or `--set retention.request_note_days=730` changes them
  (30 to 2190 days). Agree them with the firm before its pilot; the privacy notice's numbers in
  square brackets must match.
- **Breach:** contain, note the timeline, tell the firm (controller) immediately; the firm decides
  on ICO notification within 72 hours.

## Offboarding a firm

1. The firm's admin downloads their data: **Download all your data** on `/office/data` (one JSON
   file of every table, less login secrets; casuals' travel areas as their postcode district only,
   never the full postcode: `docs/dpia-travel.md`). Hand it over if they ask us instead.
2. Release the Twilio number after 30 days.
3. Delete data per retention/agreement; write the final event. (Deleting a whole firm has no
   script yet: PLAN.md Parking lot.)
