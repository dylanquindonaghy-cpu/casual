# Messaging: policy and templates

## Notification policy

Order for every message to a worker:
1. **Web push** (free). Works on Android; on iPhone only once the portal is added to the home screen.
2. **WhatsApp template** (about 2p each incl. Twilio fee; business-initiated messages must use
   approved templates).
3. **SMS fallback** (about 4p each). Only if WhatsApp isn't delivered within 60 seconds, or the
   worker has no WhatsApp. (Built so far: the worker's own choice of text messages, and a WhatsApp
   the transport refuses goes by SMS at once, logged `fellBackFrom`. The 60-second rule needs
   Twilio's delivery reports: parked with "Connect Twilio".)

As built, the push goes alongside the WhatsApp or text, once that has gone, not instead of it:
a push can't confirm it was seen. `tests/integration/notify.policy.test.ts` holds every sender to
this order.

Rules:
- Quiet hours per firm (default 22:00–07:00). Non-urgent waits. Urgent may override if the firm
  allows it. (Built: `src/lib/rules/quiet-hours.ts`, firm setting `quiet_hours` {start, end,
  urgent_override}; offer waves are held until the quiet hours end when urgent may not override.
  Times that make no sense use the default, but an explicit `urgent_override: false` is kept. A
  start equal to the end means no quiet hours. On the night the clocks go back, an end time that
  happens twice ends at the later one if the earlier has passed.)
- Max 3 shift offers per worker per day unless urgent. (Built: `src/lib/rules/offer-cap.ts`; the
  day is the firm's calendar day; urgent offers count towards it but are never held back by it;
  failed sends don't count. Offers only ever go to workers the booking rules allow: see
  `docs/api-and-jobs.md`, "Offer-wave ranking".)
- One message per event. Never send the same template twice for the same entity on the same day
  (idempotency key).
- Every outbound message is stored in `messages` and logged in `events`.
- Replies to an inbound WhatsApp inside the 24-hour window are "service" messages: first 1,000
  per number per month free (from 1 October 2026), then charged per message.
- Workers can reply STOP to SMS; honour it and mark the channel opted-out. (Built in Phase 7,
  short of Twilio: see "STOP and START by text" below. A worker who replied STOP gets no texts from
  any sender: one who chose texts gets WhatsApp instead, and a WhatsApp refused for them isn't sent
  as a text. `sendToWorker()` takes `smsAllowed` from every sender.)

## Sign-off

Every message ends with the firm's sign-off, e.g. "— Acme Events Shift Team". Never a person's name.
In a text message's own SMS version it follows a plain hyphen (" - Acme Events Shift Team"): a
dash isn't a standard text character and would make the text cost more.

Every WhatsApp and text to a worker goes from the firm's own number, its shifts line (`from` on the
message, Phase 7), once the firm has one; `tests/unit/notify.from-line.test.ts` holds every sender to
it.

## WhatsApp templates (submission pack built in Phase 4, submitted with "Connect Twilio"; category shown is our expectation — confirm on approval)

| Name | Category | Body (variables in braces) |
|---|---|---|
| `login_link` | Utility | "Here's your {firm} shifts link: {link}. It works for 15 minutes and only for you. — {firm} Shift Team" ({link} is `https://<portal>/l#<token>`; one per login request, so it is exempt from the once-a-day rule) |
| `login_code` | Utility | "Your {firm} code is {code}. It works for 10 minutes. Don't share it with anyone. — {firm} Shift Team" (pay-page step-up; one per request, exempt from the once-a-day rule. Meta's authentication category has fixed wording without a sign-off, and Meta usually requires it for one-time codes: decide at submission) |
| `office_login_link` | Email | Subject "Your {firm} office login link". Body: "Here's your link to the {firm} office dashboard: {link}. It works for 15 minutes, once, and only for you. If you didn't ask for it, you can ignore this email. — {firm} Shift Team" (console transport in Phase 1; SES later) |
| `shift_offer` | Utility | "Shift available: {date} {start}–{end} at {site} ({role}). Tap to take it: {link}. First to accept gets it. — {firm} Shift Team" ({date} is "Sat 7 Nov"; "at {site}" left out when there's none. Sent when the office offers a shift that isn't urgent to one worker, `src/lib/offers/office-offer.ts`; an urgent shift gets `shift_urgent`) |
| `shift_urgent` | Utility | "URGENT: we need a {role} at {site} {day} {start}–{end}. Tap to take it: {link}. — {firm} Shift Team" ({day} is "today", "tomorrow" or "on Sat 7 Nov": an urgent shift isn't always today; "at {site}" is left out when the shift has no site; "an" before a vowel. Sent by the offer waves, `src/lib/offers/waves.ts`) |
| `shift_filled` | Utility | "Thanks for replying. That shift on {date} at {site} has now been filled. Open shifts: {link}. — {firm} Shift Team" |
| `shift_confirmed` | Utility | "Confirmed: {date} {start}–{end} at {site} ({role}). Details and instructions: {link}. — {firm} Shift Team" |
| `shift_reminder_24h` | Utility | "Reminder: {day} {start}–{end} at {site}. Details: {link}. Can't make it? Cancel in the app as early as you can. — {firm} Shift Team" ({day} is "tomorrow", or "today" for a reminder that went late; "at {site}" is left out when the shift has no site. Sent by `src/lib/reminders/send.ts` 24 hours before the start) |
| `shift_reminder_2h` | Utility | "Your shift at {site} starts at {start}. Meeting point and instructions: {link}. — {firm} Shift Team" ("at {site}" left out when there's no site. Sent 2 hours before the start) |
| `cancellation_ack` | Utility | "We've recorded your cancellation of {date} {start} at {site} (ref {ref}). — {firm} Shift Team" |
| `shift_changed_by_firm` | Utility | "Change to your shift on {date} at {site}: {change}. New time: {start}–{end}. Details: {link}. — {firm} Shift Team" ({date} and {site} are the shift as it was; {change} is "the times have changed", "it's now shorter", "it's now at {new site}" or "new times, and it's now at {new site}"; {start} names the day too when the shift moved to another day; "at {site}" left out when there was none. Sent to each booked worker when the office moves or shortens a shift, `src/lib/notices/firm-change.ts`) |
| `shift_cancelled_by_firm` | Utility | "Your shift on {date} {start}–{end} at {site} has been cancelled by the office. Open shifts: {link}. — {firm} Shift Team" ("at {site}" left out when there's none. Sent when the office cancels a shift, or someone's booking) |
| `request_update` | Utility | "Your request ({type}, ref {ref}) is {status}. The office says: {note} — {firm} Shift Team" ({type} is the kind in words: "time change", "swap", "availability", "question" or "review"; {status} "approved" or "declined"; {note} is the office's note on one line; "The office says: {note}" is left out when there isn't one: `request_update_no_note`. Sent when the office answers a request, `src/lib/notices/request-update.ts`) |
| `credential_expiring` | Utility | "Your {credential} expires on {date}. Renew it and send the new details to the office so you can keep taking shifts. — {firm} Shift Team" |
| `credential_expired` | Utility | "Your {credential} expired on {date}. You can't take shifts that need it until you renew it and send the new details to the office. — {firm} Shift Team" |
| (screen only: My shifts banner) | — | "Your {credential} is marked as expired. You can't take shifts that need it until you renew it and send the new details to the office. — {firm} Shift Team" (the banner otherwise uses `credential_expiring` and `credential_expired` word for word) |
| `pay_query_update` | Utility | "Update on your pay query (ref {ref}): {status}. {note} — {firm} Shift Team" ({status} is "sorted"; {note} is payroll's note on one line, always written by a person, never by AI. Sent to each worker when payroll marks their query sorted, `src/lib/notices/pay-query-update.ts`; quiet hours hold it) |
| `voicemail_received` | Utility | "Thanks for your voicemail. The office will see it and get back to you. Ref {ref}. — {firm} Shift Team" (built in Phase 7, `voicemailReceivedMessage()`: a worker's voicemail on the shifts line became a request for the office; {ref} is the request's reference. By the channel the worker chose, from the firm's line. A phone call doesn't open WhatsApp's 24-hour window, so unlike the instant replies it needs a template) |
| `unknown_number` | Service reply | "Thanks for your message. We don't recognise this number. If you work with {firm}, reply with your full name and the office will get back to you. — {firm} Shift Team" (built in Phase 7, `unknownNumberMessage()`: a WhatsApp to the shifts line from a number no worker here has; only the first from that number in 24 hours; from the firm's line. A former worker's number gets no reply: the office is alerted) |

## Submitting to Meta

WhatsApp only delivers a message a business starts if it matches an approved template exactly,
with only the variable parts filled in. The submission pack is
`src/lib/messaging/whatsapp-templates.ts`: every template the code sends by WhatsApp, with its
category, language, body in Meta's `{{1}}` style and sample values. Built so far: `login_link`,
`login_code`, `shift_offer`, `shift_urgent`, `shift_reminder_24h`, `shift_reminder_2h`,
`shift_changed_by_firm`, `shift_cancelled_by_firm`, `request_update`, `credential_expiring`,
`credential_expired`, `pay_query_update`, `voicemail_received`.
- Words that are sometimes left out need their own template: `shift_offer`, `shift_urgent`,
  `shift_reminder_24h`, `shift_reminder_2h`, `shift_changed_by_firm` and
  `shift_cancelled_by_firm` each have a `_no_site` variant, used when the shift has no site;
  `request_update_no_note` is used when the office wrote no note.
- "a" or "an" before the role is part of the role's variable ("a door supervisor").
- The sign-off is a variable, because a firm may set its own.

`tests/unit/copy.templates-doc.test.ts` holds this doc, the template functions
(`src/lib/messaging/templates.ts`) and the pack to each other. Change the wording in all three
together. Not submitted yet: PLAN.md Parking lot, "Submit the WhatsApp templates", has the steps.

## Instant replies on the shifts line (keyword first)

Built in Phase 7 (`shiftsLineReply()`; the job `src/lib/inbound/reply.ts`), short of Twilio and
Bedrock. Each reply ends "— {firm} Shift Team" and goes from the firm's shifts line, at once (free
text: within 24 hours of the worker's message WhatsApp needs no template). Keywords are whole words,
any case, checked in the order below (so "cancel my shift" is a cancel). The AI only picks a row;
the words are always these.

| Worker types | Reply |
|---|---|
| "cancel" | "To cancel a shift, tap here and choose the shift: {link}. It's recorded instantly." ({link} is My shifts) |
| "pay", "paid", "wages", "payslip" | "Your hours, rates and pay dates: {link} (you'll get a code to log in)." ({link} is the pay page) |
| "shifts", "work", "available" | "Open shifts you're eligible for: {link}" ({link} is Open shifts). Not when the message also says they can't make it or are late ("can't", "cannot", "won't", "not", "unable", "sick", "ill", "late"): that's about their own shift, so the AI or the office gets it. "shift" alone isn't a keyword for the same reason |
| "help", "office", "talk" | "The office will see this and get back to you. Ref {ref}." + a request for the office (a question, the message as its note) |
| anything else | Haiku picks one of the rows above (the worker's text only; an answer that isn't exactly one label counts as none); no AI, a failure, or no answer within 5 seconds: the office row. A photo with no text: the office row |

## SMS (fallback only, keep under 160 characters)

A message with no SMS version below goes by text in full (the WhatsApp wording). Only the urgent
offer's and the office offer's SMS versions are built so far; the others come with their messages (login by text with
"Connect Twilio", confirmations with their tasks).

- Login: "{firm} shifts link (15 min): {link}"
- Offer: "{firm}: shift {date} {start} at {site}. Take it: {link} - {firm} Shift Team" (built:
  `shiftOfferSms()`, the office's offer by text; "at {site}" left out when there's none)
- Urgent: "{firm} URGENT: {role} needed {site} {day} {start}. {link} - {firm} Shift Team" (built:
  `shiftUrgentSms()`, sent
  whenever an urgent offer goes by text, the worker's choice or the fallback; {day} as in
  `shift_urgent`; {site} left out when there's none)
- Confirmed: "{firm}: confirmed {date} {start} at {site}. {link}"

## STOP and START by text

Built in Phase 7 short of Twilio (`src/lib/inbound/opt-out.ts`). A text to the shifts line that is
only one of Twilio's standard opt-out words (any case): STOP, STOPALL, UNSUBSCRIBE, CANCEL, END or
QUIT turns texts off for that number's worker; START or UNSTOP turns them back on, and YES does too
for a number that has them off. The whole message only: "can I cancel my shift" is a cancel, not an
opt-out. When Twilio's own opt-out handling acted on the text (it says so, `OptOutType`), Twilio has
sent its own confirmation; otherwise, only when the worker's setting changed, one text (a plain
hyphen before the sign-off: text only):

- `sms_stopped`: "You won't get texts from {firm} now. Reply START to turn them back on. - {firm}
  Shift Team"
- `sms_started`: "Texts from {firm} are back on. Reply STOP to turn them off. - {firm} Shift Team"

The worker's profile says "Texts are off: you replied STOP to one of our texts. We'll send shift
messages by WhatsApp. To turn texts back on, text START to our number." Any other text to the shifts
line is answered like a WhatsApp (the instant replies above), by text.

## Push (title / body)

- Offer: "Shift available" / "{date} {start} at {site}. Tap to take it." (built: `offerPush()`, with
  the office's offer)
- Urgent: "Urgent shift" / "{Role} needed at {site} {day} {start}." (built: sent with each urgent
  offer to the worker's subscribed phones, `urgentPush()`; tapping opens the shift. Console
  transport until real web push is connected)
- Filled: "Shift filled" / "That one's gone. See other open shifts."
- Reminder: "Tomorrow: {site}" / "{start}–{end}. Tap for instructions." (24 h); "Today: {site}" /
  "Starts at {start}. Tap for instructions." (2 h). {Day} is "Tomorrow" or "Today"; no site:
  "your shift". Built: sent with each reminder, `reminderPush()`; tapping opens the shift.
- Shift changed: "Shift changed" / "{date}: {change}. Tap to see it." Shift cancelled: "Shift
  cancelled" / "{date} {start} was cancelled by the office." (built: `firmChangePush()`, with the
  office's change notices)
- Request update: "Request {status}" / "{type} — tap to view." (built: `requestUpdatePush()`, with
  the office's answer; {type} as the list names it, "Time change"; tapping opens My requests)
- Pay query update: "Pay query sorted" / "Payroll has answered. Open your pay page to see it."
  (built: `payQueryUpdatePush()`, with payroll's answer; nothing about the pay itself, since a lock
  screen shows it; tapping opens the pay page, behind the pay code)

## Call-to-text recording (voice)

"Thanks for calling {firm}. We've just sent a link to your phone where you can see your shifts,
take open shifts or cancel straight away. To leave a message for the office, speak after the tone."

Built in Phase 7 short of Twilio (`callGreeting()`, `src/lib/inbound/voice.ts`), spoken in British
English. A withheld number hears "Thanks for calling {firm}. We can't see your number, so we can't
send you a link. To leave a message for the office, speak after the tone." instead, and a number
the login page's limits have stopped for now (or when asking for the link failed): "Thanks for
calling {firm}. We can't send you a link just now. To leave a message for the office, speak after
the tone." (any number can be stopped, a worker's or not, so it says nothing about whose it is).
After the tone (up to 2 minutes): "Thank you. Goodbye." A number that isn't any firm's: "Sorry, this
number isn't in use." The link is the login page's own (`requestWorkerLoginLink()`): a worker's number gets their
login link by WhatsApp (by text too once the parked SMS fallback for login links is built), any
other number nothing, and the caller hears the same either way. A voicemail's text becomes a
request for the office (a worker gets `voicemail_received` by the channel they chose); a caller we
don't know is shown on Today and the office is alerted, with no message to them. Twilio's
placeholder numbers for a hidden caller ID count as withheld.

When our app doesn't answer a call (Phase 8: Twilio's own fallback, a TwiML Bin per firm made by
`npm run firm:call-fallback`, `callFallbackTwiml()`), the caller hears "Sorry, our system isn't
answering right now. Putting you through to {firm}." and is put through to the firm's manager (up
to 30 seconds of ringing; the manager's own voicemail usually answers first). Whenever that call
ends (answered, voicemail or no answer: the bin can't tell which), they hear "If nobody answered,
please call again in a few minutes. Goodbye." It doesn't suggest messaging: WhatsApps and texts
reach the same app, which isn't answering.

## Office notifications

- Escalation (`shift_escalation`, built for email; push comes with web push): subject "Unfilled:
  {Role} at {site}, {Sat 7 Nov, 08:00 to 16:00}"; body "The {role} shift at {site}, {when}, still
  has {n place(s)} free." / "{k offer(s)} sent, none accepted for the free place(s)." / "Open the
  office dashboard: {link}" / "— {firm} Shift Team". To active admins and resourcers.
- Unknown number message (below), failed Sheets sync, domain verified/failed, credential expiries
  (weekly), pay digest (per schedule, below).
- `unknown_number_alert` (email, to active admins and resourcers, built in Phase 7,
  `unknownNumberAlertEmail()`: the first message in 24 hours, a WhatsApp, a text or a voicemail,
  from a number that isn't one of the firm's active staff): subject "{firm}: a message from a
  number we don't know"; body "Someone messaged the shifts line from a number that isn't one of
  your active staff." / "We asked them for their full name." (when they were sent `unknown_number`:
  a WhatsApp from a number nobody here has, and the reply went; otherwise "We haven't replied to
  them.") / "See the message on the office dashboard: {link}" / "— {firm} Shift Team". Neither the number nor the message is in the email
  (previews, forwards): they're on Today, "Messages from numbers we don't know".
- `credential_weekly_list` (email, Mondays 08:00, to active admins and resourcers, only when there
  is something to list): subject "{firm}: credentials expiring soon"; body "Expiring in the next 30
  days:" then "- {name}: {credential}, expires {date}" lines; "Expired in the last week (these
  people can't take shifts that need them):" then "- {name}: {credential}, expired {date}" lines
  (an empty section is left out; at most 40 lines a section, then "- and {n} more"); "When someone
  sends you their new details, record the new expiry date so they can take shifts again."; "—
  {firm} Shift Team".
- `pay_digest` (email, at the firm's digest time, default 09:00 Monday to Friday, or when payroll
  sends it from the pay queries page; to active payroll users, or active admins when the firm has none;
  only when there are new pay queries; the list attached as a CSV file named
  `pay-queries-{yyyy-mm-dd}.csv`): subject "{firm}: {n} new pay queries"; body "{n} new pay queries
  since the last digest. {k} are about the same thing: {facts}." (all in one group: "{n} new pay
  queries since the last digest, all about the same thing: {facts}."; no two alike: "{n} new pay
  queries since the last digest, each about something different."; just one: "1 new pay query
  since the last digest: {facts}."); "Grouped by likely cause, biggest first:" then a line per
  group, "- {k queries}: {facts}." (at most 30, then "- and {n} more groups"), each with "AI
  summary: {line} (written by AI)" beneath once Bedrock is connected (the 10 biggest groups);
  "{n} queries from earlier digests are still waiting." (when some are); "{n} more new queries
  didn't fit in this digest. They're on the pay queries page and will be in the next one." (over
  1,000); "The list is attached ({filename}): each query with the worker, the day, the shift, the
  issue and what they wrote."; "Answer them on the pay queries page: {link}"; "— {firm} Shift
  Team". {facts} is what a group shares, written by code from the firm's data ("wrong rate, the
  week of Mon 7 Sep, paid at £12.50"). The body holds counts and facts only; names and what
  workers wrote are only in the attached list (columns Reference, Worker, Day worked, Shift, Issue,
  What they wrote, Sent (firm time), Group; spreadsheet-safe cells).
