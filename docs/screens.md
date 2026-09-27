# Screens

Mobile first for staff. Desktop first for the office (resourcers work on laptops), but usable
on a phone for 6am problems.

## Staff portal (firm domain, e.g. shifts.firmname.co.uk)

| Route | Screen | What's on it | Empty / error states |
|---|---|---|---|
| `/login` | Log in | Mobile number field → "Send me a link". Same message whether or not the number is known. | Rate-limited: "Try again in a minute." Unknown number never revealed. |
| `/` | My shifts | Next shift card (site, time, role, instructions, map link). List of upcoming shifts. Toggle to past 30 days. Banner if a credential expires within 30 days. | "No shifts booked yet. See open shifts." |
| `/shifts/open` | Open shifts | Only eligible shifts. Filters: date, site, role. Each card: time, site, role, pay rate if firm shows it, "Take shift". | "Nothing open right now. We'll message you when something matches." |
| `/shifts/[id]` | Shift detail | Full details, instructions, "Take shift" or "Cancel" or "Request change". Eligibility reasons if blocked, in plain English, with "Ask the office to review". | "Just filled" screen with similar shifts. |
| `/urgent` | Urgent board | Shifts starting soon with dropouts, eligible only, sorted by start time. Big "Take shift" buttons. | "No urgent gaps right now." |
| `/requests` | My requests | Time changes, swaps, availability, general questions with status (open, approved, declined). "New request" button. | "No requests yet." |
| `/requests/new` | New request | Type picker → short form. Confirmation with reference number. | Validation messages inline. |
| `/pay` | Pay (OTP) | OTP step-up. Then: last 8 weeks hours logged, rates, pay dates, "Raise a pay query" form. Status of open pay queries. | "No pay data yet for this period." |
| `/profile` | Me | Contact details, credentials and expiry dates (read-only), availability (mark dates unavailable), notification settings, "Add to home screen" prompt on iPhone. | Credential expired: red state + what to do. |
| `/help` | Help | How it works, the shifts line number, privacy notice link, "Ask the office" button. | — |

**Copy rules for staff screens**
- Short sentences. Plain words. No jargon ("roster plug", "tenant").
- Buttons say what happens: "Take shift", "Cancel this shift", "Send request".
- Every action ends with a confirmation the worker can screenshot: what, when, reference.
- All system messages signed "[Firm] Shift Team".
- Large tap targets, readable text sizes, high contrast (older workers use this too).
- "My shifts" is cached by a service worker so it opens with poor signal at venues.

## Office dashboard (`/office/...`)

| Route | Screen | What's on it |
|---|---|---|
| `/office/today` | Today | Gaps by shift (unfilled slots), urgent shifts with wave status ("wave 2 of 4, 3 offered, 0 accepted"), cancellations in the last 24 h with notice hours, pending requests count, credential expiries this week, quick actions (make urgent, offer to X, mark filled manually). |
| `/office/shifts` | Shifts | Calendar/list. Create/edit shift. Import CSV. Bulk create for an event. Firm-initiated cancel/move/curtail with reason → notice logged per assigned worker and workers notified. Mark no-show / completed. |
| `/office/shifts/[id]` | Shift detail | Slots, assigned workers, eligibility check for any worker, offer history, event trail. |
| `/office/workers` | Workers | List, search, status, credentials with expiry, import CSV, invite (sends login link). |
| `/office/workers/[id]` | Worker detail | Credentials (add/edit/verify), availability, hours this week, assignment history, notes, block/unblock, data export/delete. |
| `/office/requests` | Requests | Queue: time changes, swaps, availability, general. Approve/decline with a note → worker notified. |
| `/office/log` | Action log | Every event, filterable by worker, shift, type, date. |
| `/office/reports/notice` | Notice & cancellations | Table of offers/changes/cancellations with timestamps, initiator, notice hours, short-notice flag. Date range. CSV export. |
| `/office/reports/pilot` | Pilot metrics | Baseline vs now: messages in, unanswered, portal actions, median refill time, active workers, portal adoption. |
| `/office/pay-queries` | Pay queries | Grouped by cause with the Haiku one-liner, counts, list of workers; mark group resolved → workers notified. Digest schedule. |
| `/office/settings` | Settings | Branding (logo, colour, sign-off), roster source (native / Google Sheet + column mapping / CSV), credential rules per role, allocation mode, urgent window, wave size and minutes, escalation time, quiet hours, short-notice threshold, custom domain (with DNS instructions and verify button), office users and roles, retention. |

## Notification centre (both sides)

- Workers: push + WhatsApp/SMS per the notification policy (`docs/messaging-templates.md`).
- Office: push + email (SES) for escalations, unknown-number messages, failed syncs, domain
  verification, credential expiries.

## Later (not now)

- Client/venue view: licensed, notified, on-time staff for an event (Stage 2).
- Check-in/out on tap with location (Stage 3).
- Translations for common staff languages (P2).
