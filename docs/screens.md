# Screens

Mobile first for staff. Desktop first for the office (resourcers work on laptops), but usable
on a phone for 6am problems.

## Staff portal (firm domain, e.g. shifts.firmname.co.uk)

| Route | Screen | What's on it | Empty / error states |
|---|---|---|---|
| `/login` | Log in | "Log in to {firm}". Field "Your mobile number" (phone keypad) → "Send me a link". Then: "Check your phone. If {firm} has this number, we've sent a link by WhatsApp or text. It works for 15 minutes." + sign-off, and "Use a different number". Same message whether or not the number is known. After logout: "You're logged out." | Not a number: "Enter a UK mobile number, like 07700 900123." Rate-limited: "Too many tries. Try again in {n} minutes." Unknown number never revealed. |
| `/l#<token>` | Link login | "Log in to {firm}". "Tap the button to log in to {firm} on this phone." → "Log me in", then My shifts. The token is read from the fragment and cleared from the address bar. | Expired, used, wrong firm or broken: "This link has expired or was already used." → "Send me a new link". |
| `/` | My shifts ("Hello {first name}"; `src/app/my-shifts-view.tsx`, data from `src/lib/portal/my-shifts.ts`) | Next shift card ("Your next shift", or "On now" once it has started): day and times ("Sat 7 Nov, 14:00 to 22:00"), role, site and address, "Open in maps", instructions. "Coming up": the other upcoming bookings, each opening (no JavaScript) to the same site, address, maps button and instructions. "Ask for a change" (→ `/requests/new?shift=`) and "Cancel this shift" on every booking that hasn't started (`src/app/shifts/cancel-shift.tsx`): "Why can't you make it?" ("I'm unwell", "Travel problem", "Family or caring", "Something else" + "Tell the office why") → "Confirm cancellation" / "Keep this shift" → "We've recorded your cancellation.", the shift, "You gave {n hours'/n days'} notice.", "Recorded at {09:14 on Mon 2 Nov}.", "Reference: {the booking's 8 characters}", the sign-off → "Back to my shifts". Or: "This shift has already started. Contact the office." / "You're not booked on this shift any more. If you've just cancelled it, it's recorded." / "Something went wrong. Try again." → "Try again" (sends the same reason). Toggle "Upcoming" / "Past 30 days" ("Worked", "Marked as not attended", or "Booked"). Banner for a credential the worker's roles need that expires within 30 days or has expired, unless they've replaced it or are renewing it (the WhatsApp warning's words). "My requests", "See your pay", "Log out". | "No shifts booked yet." → "See open shifts". Past: "No shifts in the last 30 days." |
| `/shifts/open` | Open shifts (`src/app/shifts/open/`, data from `src/lib/portal/open-shifts.ts`) | Only eligible shifts (the rules on the current rows), next 28 days. Filters: day, site, role (a plain form, "Show shifts"). Each card: time, role, site and address, places left, pay rate if firm shows it (Phase 6), "Take shift". After tapping: "You're booked." with day and times, role at site, "Reference: {8 characters}", the sign-off and "See my shifts"; or "Just filled. Someone else took this shift a moment ago." → "See other open shifts"; "You're already booked on this shift."; "This shift isn't open any more."; the rules' reasons under "You can't take this shift:" + "If you think this is wrong, ask the office."; "We can't confirm this shift right now. Try again in a few minutes." → "Try again". "Back to my shifts". At most 50 shifts are checked; when there were more: "These are the first open shifts. Choose a day, site or role to see others." | "Nothing open right now. We'll message you when something matches." With filters: "No open shifts match." → "Show all open shifts". |
| `/shifts/[id]` | Shift detail | Full details, instructions, "Take shift" or "Cancel" or "Request change". Eligibility reasons if blocked, in plain English, with "Ask the office to review". | "Just filled" screen with similar shifts. |
| `/urgent` | Urgent board | Shifts starting soon with dropouts, eligible only, sorted by start time. Big "Take shift" buttons. | "No urgent gaps right now." |
| `/requests` | My requests (`src/app/requests/`, data from `src/lib/portal/requests.ts`) | The last 90 days, newest first: kind and shift ("Time change: Sat 7 Nov, 14:00 to 22:00", role at site), status in words ("Waiting for the office", "Approved", "Declined", "Sorted"), "Sent {day} · Reference {8 characters}". "New request". "Back to my shifts". | "No requests yet." |
| `/requests/new` | New request (`?shift=` preselects one of the worker's upcoming bookings; also "Ask for a change" on My shifts) | "Which shift?" → "What would you like?": "Change the times" ("New start", "New finish") or "Swap with someone" ("Who could take it? (optional)") → "Anything else the office should know? (optional)" → "Send request" → "Request sent.", kind and shift, "You asked for {15:00 to 23:00}." (time change), "Sent at {09:14 on Mon 2 Nov}.", "Reference: {8 characters}", "The office will reply. You'll see the answer in My requests.", the sign-off → "See my requests". "Back to my requests". | "You have no upcoming shifts to ask about." Already asked: "You've already asked about this shift. Reference: {ref}." Not theirs or started: "You can only ask about your own shifts that haven't started." Inline: "Choose a shift.", "Choose what you'd like to change.", "Enter the start and finish times you'd like.", "The new start and finish must be different.", "Check the times and try again." After sending: "Check the form and try again." / "Something went wrong. Try again." |
| `/pay` | Pay (code) | Step-up first: "To see your pay, we'll send you a 6-digit code." → "Send me a code" → "We've sent a 6-digit code by WhatsApp. It works for 10 minutes." field "Your code" (numeric keypad, fills from the message) → "Check code". Open for 30 minutes after a correct code. Then (Phase 3): last 8 weeks hours logged, rates, pay dates, "Raise a pay query" form. Status of open pay queries. | Wrong: "That code isn't right. You have {n} tries left." Not 6 digits: "Enter the 6-digit code from your message." Expired, used or 5 wrong: "This code has stopped working." → "Send me a new code". Rate-limited: "Too many tries. Try again in {n} minutes." (an hour or more reads in hours: "Try again in 15 hours"). "No pay data yet for this period." |
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
| `/office/login` | Office login | "Office login for {firm}". Field "Your work email" → "Send me a link". Then: "Check your email. If {firm} has this address, we've sent a login link. It works for 15 minutes." + sign-off. Same answer whether or not the address is known. Not an address: "Enter your work email address, like name@example.com." Rate-limited: "Too many tries. Try again in {n} minutes." After logout: "You're logged out." |
| `/office/l#<token>` | Office link login | "Log in to the {firm} office" → "Log me in" → the dashboard. Expired, used or wrong: "This link has expired or was already used." → "Send me a new link". |
| `/office` | Dashboard (Phase 1) | "Hello {name}", "You're logged in as {Admin/Resourcer/Payroll}." Admins: "Office team". "Log out". Becomes Today in Phase 5. |
| `/office/team` | Office team (admin only) | Name, email, role, status of everyone with office access. Other roles get the not-found page. |
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
