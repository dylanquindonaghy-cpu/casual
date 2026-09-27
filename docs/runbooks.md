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

## WhatsApp problems

- **Template rejected:** simplify wording, remove marketing-like phrases, resubmit. Use SMS fallback meanwhile.
- **Messages not delivering:** check Meta payment method (required from 1 October 2026),
  template status, quality rating, and Twilio error codes.
- **Number quality drops:** reduce volume, check opt-outs, make sure offers only go to eligible people.

## Google Sheets sync failing

- Permission: the firm removed the service account → ask them to re-share.
- Rate limit: increase sync interval, batch writes, never per-request reads.
- Column mapping changed: settings → roster source → re-map; sync resumes.

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
