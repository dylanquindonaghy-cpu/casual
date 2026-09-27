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
- Pay disputes always go to a person.

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
- Flags short-notice changes against a **configurable** threshold.
- Exports a notice and cancellation report (CSV).
- Stage 2: a compensation calculator once the rules are final.

## WhatsApp rules

- Business-initiated messages need approved templates (utility for offers and login links).
- Staff must have given the firm their number for work contact; include opt-out handling.
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
