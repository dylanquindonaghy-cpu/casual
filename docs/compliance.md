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
  in the firm's own Google account), postcodes.io (turns a postcode into its central point: only the
  postcode is sent, never who it's for) and TravelTime (travel times, from 12G.2: coordinates and
  meaningless ids only), both only once `TRAVEL_PROVIDER=traveltime` (`docs/dpia-travel.md`), and
  the browser makers' push services (Google's for Android and Chrome, Apple's for iPhones, Mozilla's,
  Microsoft's), only once web push is switched on (`PUSH_TRANSPORT=webpush`, 13.3) and only for a
  phone whose owner turned notifications on: each push is encrypted for that phone alone (RFC 8291),
  so the push service sees where to deliver it, its size and its timing, never its words. List
  them in the DPA. Twilio, Meta, ElevenLabs and Google are US-linked: check each one's DPA and UK
  transfer terms. **Dylan to confirm** the Google line with
  the solicitor (added in Phase 10 task 10).

## The firm's planner (12J.2)

A firm's admin can connect its planner: the planner sends sessions with an API key and hears about
bookings, cancellations and withdrawn strikes by signed webhook (`docs/integrations.md`). The firm
is the controller and its admin chooses where the data goes; the planner is the firm's own
recipient.
- **Phone notifications (web push, 13.3):** a phone's notification address (`push_subscriptions`:
  the push service's address and the phone's keys) is kept until notifications are turned off on
  that phone, the casual logs out or logs in again on it, the push service says it no longer works
  (it's then deleted and `push.forgotten` logged), an eleventh phone replaces the oldest, or the
  casual's details are erased. The action log never holds the address. A notification can show on
  a locked phone: its words name the shift (the role, the place, the day and time) or say a request
  or pay question was answered, never pay figures, a reason or anyone's details
  (`docs/messaging-templates.md` "Push").
- **Sent:** the session's facts (event, site name and postcode, role, times, pay rate, post,
  meeting point, uniform, requirements), the booking's facts (status, who booked it, times), the
  casual's first and last name and staff ref, and the cancellation and strike result (notice hours,
  a reason code, the strike's status and how many count). A casual's own reason is always
  `casual_own_reason`: "I'm unwell" is health data and never leaves ShiftDesk.
- **Never sent:** a mobile number, an email address, a casual's postcode or travel data, health,
  free text (anyone's typed reason or note), review flags or withdrawal reasons. Each webhook type
  is a strict schema, so nothing can be added without the schema changing and its tests.
- **Built when sent:** the queue holds ids only, so an erasure needs no extra work: after it the
  casual is `null` with `"erased": true`. The runbook tells the firm to remove the person from its
  planner too.
- **Only to public https addresses** the admin added; the address is treated as a secret and never
  logged. `api_keys` is left out of the firm's data export, and the export shows the webhook address
  as its hint only.
- The strikes DPIA lists the firm's planner as a recipient of strike status.

## Health reasons: the Article 9 condition (12C.1)

A casual can cancel with "I'm unwell". That is health data, a special category under UK GDPR
Article 9, and so is a label saying someone cancelled for a "health reason"
(https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/information-about-workers-health/data-protection-and-workers-health-information/).
- **The condition firms rely on:** employment, social security and social protection (Article
  9(2)(b)), with DPA 2018 Schedule 1 paragraph 1. It needs the firm to have an **appropriate policy
  document**: how it meets the data protection principles for this data, and how long it keeps it.
  The firm writes it before it uses ShiftDesk with real casuals and keeps it while it processes
  the data (a template for firms is in the Parking lot: "Appropriate policy document template").
- **Kept inside ShiftDesk:** admins and resourcers see the reason on screen. Everything that
  leaves (the evidence email, the record PDF, the cancellations CSV, the webhooks and the API) shows
  one neutral value for all four quick reasons, "Casual's own reason (see ShiftDesk)" or
  `casual_own_reason`; tests check "unwell" and "health" never appear in them.

## Strikes: the cautions (12C.1; `docs/office-v2.md` §6.2)

A strike is a casual's own cancellation less than 48 hours before the shift (`strikes.notice_hours`,
the firm's own setting, kept apart from the legal notice threshold). Summary of public sources, not
legal advice; `docs/dpia-strikes.md` comes first for a real firm.
- **A record, never an automatic penalty.** Nothing happens automatically; a named person decides
  anything that follows (the automated-decision safeguards in the Employment Rights Act 2025, and
  Acas: review points shouldn't trigger disciplinary action automatically).
- **Told up front, and heard:** the cancel screen shows the warning before they confirm, and the
  version they saw is stored with the cancellation (S3); the help page explains the rule; a casual
  can tap "Tell us what happened"; the office can withdraw a strike.
- **No strike** when the office, the planner or the sheet cancelled, on a booking the office made,
  or after the office or the planner changed the session (the future protection against detriment).
- **Health and caring reasons are flagged** for a person to review (Equality Act 2010; Acas).
- **Never linked to money:** no fines, no deductions (s.13 ERA 1996). Payroll never sees strikes.
- **Evidence goes only to a confirmed strikes-team address** (12B.7), never "unwell" or "health".
- **Kept:** it counts 90 days; its row is deleted at 12 months (past the 6-month tribunal limit),
  never during a hold; its log entries stay as long as the action log (the retention table below).

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
  `retention.message_days`, 90 by default, with the retention job), shown to the firm's admins and resourcers on Enquiries (and among the dashboard's latest enquiries), and never put in the log, an email or
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
change them, and since 12B.7 still can't: its only way into `firms.settings` is
`app_set_firm_setting()`, which accepts the strikes team's email and its confirmed time and refuses
`retention.*` and every other key, tested in `tests/integration/settings.test.ts`): `retention.message_days` and `retention.request_note_days` (30 to 2190 days), and a
hold, `retention.hold_until` (a date): until then the purge deletes nothing personal, for a dispute
or tribunal (logged as a settings change). **Dylan to confirm** the defaults below, the 30-day
floor, and that a hold covers the whole firm (not one worker).

| Data | Keep |
|---|---|
| Raw messages and transcripts | 90 days by default (built: the nightly purge). A reply newer than that stays, even when the message it answered goes |
| The words typed into a request (a note, a colleague's name) | 12 months by default, counted from when the request closed (built: removed, the request stays). An open or escalated request keeps them. (Phase 8 built 90 days from creation, with no "Dylan to confirm"; Phase 10 put back the spec's 12 months) |
| The office's typed reason for placing someone despite a rule | On the booking, not in the log; the same 12 months from the booking (built) |
| Strikes (a casual's own late cancellations, 12C.1) | The strike counts 90 days (`strikes.live_days`); its row is deleted 12 months after it was issued (`strikes.keep_months`, which must cover the time a strike counts plus 6 months, the tribunal limit; the purge never deletes a strike that stopped counting less than 6 months ago), nothing during a hold (built: the nightly purge). The office's reason for withdrawing one (12C.5) goes with its row, or when the casual is erased. Its `strike.issued`, `strike.withdrawn` and `strike.reviewed` log entries (ids and hours, never a reason or the review flag) stay with the action log. A DPIA comes first: `docs/dpia-strikes.md` |
| Travel estimates (12G.2: minutes and distance from a postcode to a site, keyed by postcode, not by person) | 7 days after the last session they were for, by the nightly purge (even during a hold: not about anyone in particular), and when a site's postcode changes (built). Not in the firm's data export |
| A casual's travel area (12G.1: their start-from postcode and its central point, how they travel, their limit) | While they keep it: deleted when they remove it, when the office makes them inactive as "They've left", and on erasure (built). Never in the action log, with one exception: a personal shifts-line reply's `enquiry.checks` entry (12D.2) keeps their limit in minutes and the minutes to each session it offered (never the postcode or the point), and stays with the action log. A DPIA and the legitimate-interests balancing test come first: `docs/dpia-travel.md` |
| Staff photos and certificate images (12F.2) | One the office turned down: 30 days after the check. A staff photo replaced by a newer approved one: 30 days after that one was approved. The current photo and the image behind a current certificate stay while they're current, then follow the firm's retention (a later task); all of them go on erasure (built: the nightly purge, nothing during a hold). In the exports as details only (kind, date, status, fingerprint); each image is its own download |
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
- Third-party check APIs exist, but the SIA doesn't endorse them. **Don't build a scraper.** The
  office's check page links the GOV.UK register for a person to look the licence up by hand.
- **Only checked records count** (12F.2; D3). A casual may upload a photo of her card; it counts for
  nothing (the rules, the expiry scan and the dashboard all ignore it, and the database stores it as
  expired) until a named admin or resourcer approves it, typing the expiry date and number as they
  read them from the card. Rejecting takes a reason from a fixed list. Every check is logged
  (`upload.approved`, `upload.rejected`: ids and codes only).
- **What casuals never upload:** CSAS accreditation (only this firm's own scheme covers its shifts,
  Police Reform Act 2002 s.41: the office records it, confirming that), right-to-work documents
  (they stay with the office, Rules 15), and anything holding health or criminal record details
  (drugs and alcohol tests, rail medicals, DBS certificates): the office records those itself, so
  we never keep a copy of special-category or criminal-offence data
  (`src/lib/rules/packs.ts` `officeRecorded`).

## Photos and certificate images (12F.2; docs/office-v2.md 5.5)

- **No biometrics.** No face matching, no AI and no reading of the text on a card, ever. Matching a
  face would make staff photos biometric data, special-category data under UK GDPR Article 9
  (https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/biometric-data-guidance-biometric-recognition/biometric-recognition/).
  A photo is looked at by a person, as the SIA's own checks are.
- **Stored in Postgres** (row-level security, erasure and export cover them), 1 MB at most. The
  server reads each file's real type from its first bytes (JPEG, PNG or WebP only) and re-encodes
  it with `sharp`, which keeps only the pixels: location (GPS), camera details and every other
  hidden tag are dropped.
- **Seen only by** the casual (her own) and her firm's active admins and resourcers, through one
  access-checked address (`/files/{id}`), never cached and never in the phone's offline copy.
- **Retention:** above ("Retention defaults").
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
- Written agreement with the pilot firm before any real data: you own the software, they license it.
