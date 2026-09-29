# Compliance

Plain-English guide to what the product must respect. Not legal advice — get the terms and DPA
reviewed once by a solicitor before the first pilot.

## UK GDPR roles

- **Each firm is the controller.** It decides why staff data is used.
- **We are the processor.** We only process data on the firm's instructions.
- **Our sub-processors:** AWS (hosting, database, Bedrock AI, SES email), Twilio (numbers, SMS,
  WhatsApp, voice), Meta (WhatsApp), ElevenLabs (only if the AI phone add-on is used).
  List them in the DPA. Twilio, Meta and ElevenLabs are US-linked: check each one's DPA and
  UK transfer terms.

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
- Staff get one line in the firm's privacy notice. Suggested wording:
  > "Shift messages, requests and enquiries may be handled by automated systems on our behalf.
  > You can ask for any decision about your shifts to be reviewed by a member of our team."
- Anyone significantly affected by an automated decision (e.g. refused a shift) can ask for a
  human review. Build a "Ask the office to review" button on refusal screens.
- People who aren't staff (Phase 7): a message to the shifts line from a number that isn't an
  active worker's is kept in `messages` (the number and their words, 90 days with the retention
  job), shown to the firm's admins and resourcers on Today, and never put in the log, an email or
  the AI. The firm's privacy notice should cover messages to its shifts line.
- The shifts line (Phase 7): a WhatsApp no keyword matches is sorted by AI (once Bedrock is
  connected) into one of four labels, from the worker's text alone; the reply is always the app's own
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

| Data | Keep |
|---|---|
| Raw messages and transcripts | 90 days |
| Call audio | Not stored by default (30 days if enabled) |
| Requests, events, notice report | 12 months (review once 2027 rules are final) |
| Workers and credentials | Until the firm deletes them |

Nightly purge job. Firms can export their data any time.

## Security baseline

HTTPS everywhere · encryption at rest (managed Postgres) · MFA on every account · least-privilege
IAM · tested backups · per-firm access control · no personal data in logs · verified webhooks ·
rate-limited login. Breach plan: one page, who to tell, within 72 hours.

**On the worker's phone:** so My shifts opens without signal, the browser keeps the last copy
of that one page (ADR-016): the worker's first name, their upcoming shifts with times, sites and
instructions, and any licence expiry banner (type and date). It never holds pay, requests or
anyone else's data; only the page itself and the site's own style and script files are kept.
It is deleted when the worker logs out or logs in on that browser, and when the server answers
"not logged in" the next time My shifts loads. A copy older than 14 days is never shown, and is
deleted the next time My shifts opens; until then it stays in the browser's storage. On iPhone,
Safari and a home-screen app keep separate storage, so logging out in one doesn't clear the
other. It's off unless switched on (`OFFLINE_COPY`; on in production). The "don't show the home
screen hint again" choice is a flag in the phone's browser storage, with no personal data. The
privacy notice should say the copy is stored on the device (storage that's strictly necessary
for the service the worker asked for): parked in PLAN.md.

## Credential checks

- Store each worker's credential number and expiry; the rules engine blocks offers after expiry.
- **SIA:** check the official Register of Licence Holders at onboarding and monthly. Employers can
  also use the SIA Company Licence Checker to track lists of their staff. The register is the
  definitive check, not the card. Deploying someone without a valid licence is a criminal offence
  and can land on the business.
- SIA approved contractors may deploy a limited share of staff whose licence application is in
  progress (reported as up to 15%) — keep this as a firm setting and confirm current SIA rules.
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
