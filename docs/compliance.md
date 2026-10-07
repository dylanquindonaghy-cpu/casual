# Compliance

Plain-English guide to what the product must respect. Not legal advice — get the terms and DPA
reviewed once by a solicitor before the first pilot.

## UK GDPR roles

- **Each firm is the controller.** It decides why staff data is used.
- **We are the processor.** We only process data on the firm's instructions.
- **Our sub-processors:** the hosting company (servers and the database, in the UK or the EU; chosen
  when the account is created), the email company (SMTP; chosen when its account is created:
  "Connect an email provider (SMTP)"), Anthropic (the AI, only once it's switched on; its API may
  process requests outside the UK, so its data processing agreement and UK transfer terms are
  checked first: ADR-021), Twilio (numbers, SMS, WhatsApp, voice), Meta (WhatsApp), ElevenLabs (only
  if the AI phone add-on is used), Google (only for a firm whose rota is a Google Sheet: our Google
  Cloud service account reads and writes the sheet the firm shares with it; the sheet itself stays
  in the firm's own Google account). List them in the DPA. Twilio, Meta, ElevenLabs and Google are
  US-linked: check each one's DPA and UK transfer terms. **Dylan to confirm** the Google line with
  the solicitor (added in Phase 10 task 10).

## Data processing agreement (must cover)

Instructions only · confidentiality · security measures · sub-processors and notice of changes ·
helping with rights requests · breach notice · deleting or returning data at the end ·
audits. Base it on the ICO's controller/processor contract guidance.

## ICO data protection fee

Tier 1: £52 a year (£47 by direct debit) for small organisations. Pay before handling real data.

## Being open about automation (our stance)

- Don't label every message "AI". Replies are signed **"[Firm] Shift Team"**.
- **Never** sign automated replies with a made-up person's name.
- The firm knows — it's the controller and signs a DPA that lists the AI provider.
- Staff get one line in the firm's privacy notice, and the firm's notice gets a section on the
  portal and shifts line: both, ready to send, in `docs/privacy-notice.md`. The line:
  > "Shift messages, requests and enquiries may be handled by automated systems on our behalf.
  > You can ask for any decision about your shifts to be reviewed by a member of our team."
- Anyone significantly affected by an automated decision (e.g. refused a shift) can ask for a
  human review. (Built: "Ask the office to review" on a refused shift, `src/lib/portal/review.ts`.)
- People who aren't staff (Phase 7): a message to the shifts line from a number that isn't an
  active worker's is kept in `messages` (the number and their words, the firm's
  `retention.message_days`, 90 by default, with the retention job), shown to the firm's admins and resourcers on Today, and never put in the log, an email or
  the AI. The firm's privacy notice should cover messages to its shifts line.
- The shifts line (Phase 7): a WhatsApp no keyword matches is sorted by AI (once the Anthropic
  API is connected) into one of four labels, from the worker's text alone; the reply is always the app's own
  fixed words, so the AI never writes to a worker, and a pay question gets the pay link, never an
  answer. The text is kept in `messages` (90 days, with the retention job) and never in the log.
- Pay disputes always go to a person. Built that way: payroll answers each group of pay queries in
  its own words; the only AI use is a summary line for payroll. A test (`tests/unit/ai.boundary.test.ts`)
  fails if the code that builds what a worker sees or receives (the staff pages, portal, notices,
  notify and message templates), or payroll's sorting path from the note box to the database, can
  import AI code, if any other file starts importing the AI modules or their two payroll-facing
  users, or if an AI SDK is imported outside `src/lib/ai/`. It catches the likely mistakes; it
  can't prove every possible path.

- A firm's logo (Phase 8) is an address on the firm's own website: a worker's browser fetches it
  from there, so the firm's site sees the worker's IP address, as it would for any visit. It's
  fetched with no referrer (the firm's site isn't told which page), and only from https://
  addresses. Worth a line in the firm's privacy notice; uploading logos to our own storage would
  avoid it (later, with the office settings screen).

## Retention defaults (per firm, adjustable)

Each firm's own settings, set by us with `npm run firm:settings` (Phase 10, audit M24; the app can't
change them): `retention.message_days` and `retention.request_note_days` (30 to 2190 days), and a
hold, `retention.hold_until` (a date): until then the purge deletes nothing personal, for a dispute
or tribunal (logged as a settings change). **Dylan to confirm** the defaults below, the 30-day
floor, and that a hold covers the whole firm (not one worker).

| Data | Keep |
|---|---|
| Raw messages and transcripts | 90 days by default (built: the nightly purge). A reply newer than that stays, even when the message it answered goes |
| The words typed into a request (a note, a colleague's name) | 12 months by default, counted from when the request closed (built: removed, the request stays). An open or escalated request keeps them. (Phase 8 built 90 days from creation, with no "Dylan to confirm"; Phase 10 put back the spec's 12 months) |
| The office's typed reason for placing someone despite a rule | On the booking, not in the log; the same 12 months from the booking (built) |
| Call audio | We store none: only a voicemail's text. But Twilio records every voicemail (up to 2 minutes) to transcribe it, and keeps the recording until it's deleted there: a deletion job comes with the Twilio sender ("Connect Twilio", "Before going live") |
| Requests, events, notice report | 12 months (review once 2027 rules are final). **Not purged yet**: the log is append-only by design, so deleting it needs a deliberate change (PLAN.md Parking lot). Nothing can be 12 months old until a year after the pilot starts |
| Workers and credentials | Until the firm deletes them |
| Login links, codes, sessions, rate-limit counters | 1 to 30 days after they stop working (built; docs/data-model.md "Retention") |

Nightly purge job (built, Phase 8: `retention-purge`, one `retention.purged` event per firm per
run, saying `held` during a hold). Twilio's own copies of messages and recordings need their own
deletion job before the 90 days is true there ("Connect Twilio", "Before going live"). Firms can export their data any time (built: an admin's "Download all your data" on
`/office/data`).

## GDPR requests (built, Phase 8)

An admin handles them on `/office/data` (docs/runbooks.md "GDPR requests"):
- **Access:** a worker's data as JSON or CSV: their details, licences and cards, days off,
  bookings, offers, requests, reminders, pay lines and queries, shifts-line messages (with any from
  their number before it was known), the action log's rows about them, the shifts those were
  about, and when they logged in. Login secrets (hashes, a phone's push keys) are left out. Each
  download is logged (`worker.data_exported`), which evidences the one-month deadline.
- **Erasure:** the worker's personal details are deleted: name, mobile, email, staff id (also
  out of our copy of the rota sheet's names, `shifts.synced_holders`), licences and cards, days
  off, messages, logins and phones, and the text anyone typed on the worker's own records: their
  requests (their note, a colleague they'd swap with, the office's answer), pay queries (their
  details, payroll's note), cancellations (a typed reason; "Something else: …" becomes "Something
  else") and bookings (the office's reason for placing them despite a rule becomes "Reason deleted
  with the worker's details"). Their bookings, offers, cancellations (with notice hours and the
  app's fixed reason words), reminders and pay lines stay, attached to an anonymous "Deleted
  worker" row, as the firm's evidence (Employment Rights Act notice records, payroll). The log holds
  ids and fixed words, never names, numbers or messages (from Phase 10 the office's override reason
  is on the booking, not the log). **Not changed by an erasure:** what other people wrote that
  names them (a colleague's swap request, pay query or cancellation note, someone else's
  message): a colleague's request words and messages go on the firm's retention schedule above;
  pay query text, cancellation notes and the office's answers on requests are never purged on a
  schedule ("Dylan to confirm" in PLAN.md). The data page and the privacy notice say "aren't
  changed". The staff id leaves our copy of the rota sheet's names only on shifts that have ended
  (and comes back on any row the firm's sheet still names them on). A hold doesn't stop a
  deletion ("Dylan to confirm").
  Once Twilio is connected, Twilio keeps its own copy of messages (the log holds their ids):
  deleting those there is a step still to write (PLAN.md Parking lot, "GDPR follow-ups"). Refused while they are booked on a shift that hasn't
  ended (the office cancels it first, with a reason). Logged (`worker.erased`, counts only). The firm
  must remove them from its own rota sheet or staff file too, or the next sync or import adds them
  back.
- **The firm's own data:** one JSON file of every firm table (less login secrets), logged
  (`firm.data_exported`).

## Security baseline

HTTPS everywhere · encryption at rest (the host's managed Postgres; with Postgres in Compose, check
the server's disk is encrypted) · MFA on every account · least-privilege access on every account
and key · tested backups · per-firm access control · no personal data in logs · verified webhooks ·
rate-limited login. Breach plan: one page, who to tell, within 72 hours.

**On the worker's phone:** so My shifts opens without signal, the browser keeps the last copy
of that one page (ADR-016): the worker's first name, their upcoming shifts with times, sites and
instructions, and any licence expiry banner (type and date). It never holds pay, requests or
anyone else's data; only the page itself and the site's own style and script files are kept.
It is deleted when the worker logs out or logs in on that browser (also when My shifts was still
loading on poor signal: the late answer is never kept, Phase 10), and when the server answers
"not logged in" the next time My shifts loads. Logging out with no signal deletes the copy but
can't end the session if the server can't be reached: the button says the worker may still be
logged in. A worker blocked, made inactive or deleted loses their session at once, but their phone's
copy goes only when that phone next opens My shifts with signal (up to 14 days; the deletion
notes in `src/lib/gdpr/worker-erase.ts` and the privacy notice say so). A copy older than 14 days is never shown, and is
deleted the next time My shifts opens; until then it stays in the browser's storage. On iPhone,
Safari and a home-screen app keep separate storage, so logging out in one doesn't clear the
other. It's off unless switched on (`OFFLINE_COPY`; on in production). The "don't show the home
screen hint again" choice is a flag in the phone's browser storage, with no personal data. The
privacy notice should say the copy is stored on the device (storage that's strictly necessary
for the service the worker asked for): `docs/privacy-notice.md`, "On your phone".

## Credential checks

- Store each worker's credential number and expiry; the rules engine blocks offers after expiry.
- **SIA:** check the official Register of Licence Holders at onboarding and monthly. Employers can
  also use the SIA Company Licence Checker to track lists of their staff. The register is the
  definitive check, not the card. Deploying someone without a valid licence is a criminal offence
  and can land on the business.
- SIA approved contractors may deploy a limited share of staff whose licence application is in
  progress (reported as up to 15%) — kept as a firm setting (default 0, and no command sets it
  yet) until the current SIA rules are confirmed.
- Third-party check APIs exist, but the SIA doesn't endorse them. **Don't build a scraper.**
- **Rail:** PTS, Sentinel, drugs and alcohol test dates. **Construction:** CSCS card type/expiry.
  **Cleaning:** DBS where the site requires it.

## Employment Rights Act — zero-hours measures (expected 2027)

What's coming (details still being set in regulations):
- Right to reasonable notice of shifts.
- Payment when shifts are cancelled, moved or cut short at short notice.
- Right to guaranteed hours.
- For agency workers, hirer and agency share responsibility for notice; the agency pays the
  compensation. Claims can go to an employment tribunal.
- Consultation on the notice period (options of one to four weeks) closed 25 August 2026. A 2025
  amendment proposed limiting compensation to cancellations with under 48 hours' notice.

What the product does about it:
- Timestamps every offer, acceptance, change and cancellation, and who initiated it.
- Computes notice hours for each change.
- Flags short-notice changes against a **configurable** threshold (the firm's
  `short_notice_threshold_hours`, default 48).
- Exports a notice and cancellation report (CSV). Built (Phase 5): `/office/reports/notice`, from
  the append-only action log; each row's notice hours were recorded when it happened.
- Stage 2: a compensation calculator once the rules are final.

## WhatsApp rules

- Business-initiated messages need approved templates (utility for offers and login links).
- Staff must have given the firm their number for work contact; include opt-out handling. (Built
  in Phase 7 short of Twilio: STOP to the shifts line by text turns texts off for that worker
  until START, and no sender texts them meanwhile: docs/messaging-templates.md.)
- From 1 October 2026 Meta charges per service message beyond 1,000 free per number per month,
  and a payment method must be on file or service messages stop.

## Location tracking (Stage 3)

- Check-in by tap with location first; background geofencing needs a native app.
- The ICO expects a DPIA where monitoring workers is likely to be high risk, and workers should
  normally be told about monitoring before it starts. Track only during shifts, only on site.

## Company setup (when a pilot says yes)

- Limited company: Companies House digital incorporation £100 (from 1 February 2026); yearly
  confirmation statement £50.
- ICO fee (above).
- Professional indemnity + cyber insurance (get quotes).
- Terms of service + DPA (solicitor review once).
- Written agreement with CSP before any real data: you own the software, they license it.
