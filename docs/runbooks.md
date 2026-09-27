# Runbooks

Short, do-this-now guides. Keep them current.

## Deploy

1. CI green on `main`.
2. GitHub Action SSHes to the Lightsail instance: `docker compose pull && docker compose up -d`.
3. Migrations run on `web` start (`npm run db:migrate`), never on `worker`.
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
2. Point `DATABASE_URL` at it; restart `web` and `worker`.
3. Check counts: firms, workers, shifts, events for today.
4. Test a restore once a month even when nothing is wrong.

## Rotate a secret

Twilio auth token, session secret, AWS keys: rotate in the provider, update `.env` on the
server, `docker compose up -d`. Old sessions may need to log in again — do it after 22:00.

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
