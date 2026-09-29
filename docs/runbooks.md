# Runbooks

Short, do-this-now guides. Keep them current.

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

## Custom domain not working

- Check the CNAME points to `portal.<our-domain>`.
- Run `domain-verify` from settings; check Caddy logs for the `ask` response.
- TLS issuance can take a minute after verification.

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
