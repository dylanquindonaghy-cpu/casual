# Messaging: policy and templates

## Notification policy

**Automatic replies on the shifts line are off unless the firm switches them on** (P4.7; `PLAN.md`
"Connecting the firm's systems" 11 and 12). Off, a WhatsApp, text or voicemail that comes in is
stored, sorted and logged, and every casual's message becomes a question for the office in Need a
person, but nothing goes back by WhatsApp or text: none of the shifts line's replies below, no
unknown-number reply, no STOP or START confirmation (a STOP still turns texts off). A call still
gets the caller's login link by message, as the login page does: the caller asked for it (Dylan,
2026-10-27). Casuals reach the office in the app (proposal P8). The owner switches them on with
`npm run firm:settings -- --firm <slug> --set auto_replies=true`. The office is emailed about at
most 5 unknown numbers per firm an hour; the rest wait in Need a person, and go in one email at
the end of that hour (`unknown_numbers_combined`, below; Phase 25.3).

**How a message reaches a casual** (P2.4; the words approved by Dylan on 2026-10-28;
`PLAN.md` "Connecting the firm's systems" 15; Messages 2): a push to the phones they turned
notifications on for; if no phone takes it, a WhatsApp or text (once a text sender exists: Phase
15); if no text can go, an email to the address the firm holds for them ("Email to casuals" below);
if none of those, nothing goes and the miss is logged. The shifts line's own replies and the STOP
or START answers go only by text (decision 11).

**Who sends what** (P2.3; decisions 9 and 17): ShiftDesk tells casuals about the bookings made in
ShiftDesk. With the firm's `firm_system_sends` on, it sends no reminder for a booking the firm's own
system made (its rota sheet; its CRM through the API, P5), which that system sends. A booking
confirmation (`shift_confirmed`) only ever goes for the office's own booking in ShiftDesk. Offers
and the office's change and cancellation notices still go.

Order for every message to a worker:
1. **Web push** (free). Works on Android; on iPhone only once the portal is added to the home screen.
2. **WhatsApp template** (about 2p each incl. Twilio fee; business-initiated messages must use
   approved templates).
3. **SMS fallback** (about 4p each). Only if WhatsApp isn't delivered within 60 seconds, or the
   worker has no WhatsApp. (Built so far: the worker's own choice of text messages, and a WhatsApp
   the transport refuses goes by SMS at once, logged `fellBackFrom`. The 60-second rule needs
   Twilio's delivery reports: parked with "Connect Twilio".)
4. **Email** (P2.4). Only when no text can go at all (no text sender yet), to the address the firm
   holds for them, with the subject from "Email to casuals" below.

As built (P2.4, `deliverToWorker()` in `src/lib/notify/send.ts`): a push that one of their phones
takes is the message, and no WhatsApp or text goes with it (before P2.4 the push went alongside).
"Takes" means the push service accepted it for the phone, not that the casual saw it; a push that
fails (a time-out, an outage) goes on to the WhatsApp or text, even though it may have arrived, so a
casual may now and then get both (PLAN.md P2.4: "a push gone or failed falls to a text").
The licence messages have no push words, so they start at the WhatsApp or text. The office's change
and cancellation notices (`shift_changed_by_firm`, `shift_cancelled_by_firm`) are the proof of the
notice given, so they go by the WhatsApp, text or email as well as the push, never instead of it
(Dylan, 2026-10-29); one whose WhatsApp, text or email can't go while a phone took the push counts
as told by push, and the log says why the rest didn't go. A WhatsApp or text
that fails, or might have arrived, isn't sent again by email: it could reach them twice. The office's
reply on Enquiries goes only by WhatsApp or text: it answers a message to the shifts line, so a text
sender exists. `tests/integration/notify.policy.test.ts` holds every sender to this order.

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
| `login_link` | Utility | "Here's your {firm} shifts link. It works for 15 minutes and only for you: {link} — {firm} Shift Team" (the link last, with a space after it, never a full stop, which a phone can take into the link: Phase 10 task 19; {link} is `https://<portal>/l#<token>`; one per login request, so it is exempt from the once-a-day rule) |
| `login_code` | Utility | "Your {firm} code is {code}. It works for 10 minutes. Don't share it with anyone. — {firm} Shift Team" (pay-page step-up; one per request, exempt from the once-a-day rule. Meta's authentication category has fixed wording without a sign-off, and Meta usually requires it for one-time codes: decide at submission) |
| `office_login_link` | Email | Subject "Your {firm} office login link". Body: "Here's your link to the {firm} office dashboard: {link}. It works for 15 minutes, once, and only for you. If you didn't ask for it, you can ignore this email. — {firm} Shift Team" (console transport in Phase 1; SMTP later) |
| `shift_offer` | Utility | "Shift available: {date} {start}–{end} at {site} ({role}). Tap to take it: {link}. First to accept gets it. — {firm} Shift Team" ({date} is "Sat 7 Nov"; "at {site}" left out when there's none. Sent when the office offers a shift that isn't urgent to one worker, `src/lib/offers/office-offer.ts`; an urgent shift gets `shift_urgent`) |
| `shift_urgent` | Utility | "URGENT: we need a {role} at {site} {day} {start}–{end}. Tap to take it: {link}. — {firm} Shift Team" ({day} is "today", "tomorrow" or "on Sat 7 Nov": an urgent shift isn't always today; "at {site}" is left out when the shift has no site; "an" before a vowel. Sent by the offer waves, `src/lib/offers/waves.ts`) |
| `shift_filled` | Utility | "Thanks for replying. That shift on {date} at {site} has now been filled. Open shifts: {link}. — {firm} Shift Team" |
| `shift_confirmed` | Utility | "Confirmed: {date} {start}–{end} at {site} ({role}). Details and instructions: {link}. — {firm} Shift Team" ("at {site}" left out when there's none. Sent when the office books a worker onto a shift ("Assign"), `src/lib/notices/shift-confirmed.ts`, Phase 10 task 19; a worker who takes a shift themselves sees it on screen instead. Quiet hours hold it unless the shift starts within the urgent window) |
| `shift_reminder_24h` | Utility | "Reminder: {day} {start}–{end} at {site}. Details: {link}. Can't make it? Cancel with the link as early as you can. — {firm} Shift Team" ({day} is "tomorrow", or "today" for a reminder that went late; "at {site}" is left out when the shift has no site. "Cancel with the link", not "in the app": there's no app to download (Dylan, 2026-10-16; 13.5). Sent by `src/lib/reminders/send.ts` 24 hours before the start) |
| `shift_reminder_2h` | Utility | "Your shift at {site} starts at {start}. Meeting point and instructions: {link}. — {firm} Shift Team" ("at {site}" left out when there's no site. Sent 2 hours before the start) |
| `cancellation_ack` | Utility | "We've recorded your cancellation of {date} {start} at {site} (ref {ref}). — {firm} Shift Team" |
| `shift_changed_by_firm` | Utility | "Change to your shift on {date} at {site}: {change}. New time: {start}–{end}. Details: {link}. — {firm} Shift Team" ({date} and {site} are the shift as it was; {change} is "the times have changed", "it's now shorter", "it's now at {new site}" or "new times, and it's now at {new site}"; {start} names the day too when the shift moved to another day; "at {site}" left out when there was none. Sent to each booked worker when the office moves or shortens a shift, `src/lib/notices/firm-change.ts`) |
| `shift_cancelled_by_firm` | Utility | "Your shift on {date} {start}–{end} at {site} has been cancelled by the office. Open shifts: {link}. — {firm} Shift Team" ("at {site}" left out when there's none. Sent when the office cancels a shift, or someone's booking) |
| `request_update` | Utility | "Your request ({type}, ref {ref}) is {status}. The office says: {note} — {firm} Shift Team" ({type} is the kind in words: "time change", "swap", "availability", "question" or "review"; {status} "approved" or "declined", and "answered" for a question the office answered ("approved" can read as "booked"); {note} is the office's note on one line; "The office says: {note}" is left out when there isn't one: `request_update_no_note`. Sent when the office answers a request, `src/lib/notices/request-update.ts`, and as the office's reply on Enquiries outside WhatsApp's 24-hour window, below) |
| `credential_expiring` | Utility | "Your {credential} expires on {date}. Upload your renewed card so you can keep taking shifts that need it: {link} — {firm} Shift Team" ({link}: her upload page for it, `/profile/upload/{type}`; 12F.2). One she can't upload (the office records it, or none of her roles needs it), `credential_expiring_to_office`: "Your {credential} expires on {date}. Renew it and send the new details to the office so you can keep taking shifts. — {firm} Shift Team" |
| `credential_expired` | Utility | "Your {credential} expired on {date}. You can't take shifts that need it until you upload your renewed card and the office checks it: {link} — {firm} Shift Team". One she can't upload, `credential_expired_to_office`: "Your {credential} expired on {date}. You can't take shifts that need it until you renew it and send the new details to the office. — {firm} Shift Team" |
| (screen only: My shifts' "Needs updating") | — | One row per qualification to sort out (12F.1; the words are `needsText()` in `src/lib/portal/qualification-copy.ts`, in `docs/screens.md`). A row she can sort herself ends "Upload it", linking to the same upload page (12F.2) |
| `pay_query_update` | Utility | "Payroll has answered your pay query (ref {ref}). See their answer on your pay page: {link} — {firm} Shift Team" ({link}: the pay page, `/pay`. Payroll's note stays behind the pay code: it's on the pay page only, never in the message (Dylan, 2026-10-16; 13.4). Sent to each worker when payroll marks their query sorted, `src/lib/notices/pay-query-update.ts`; quiet hours hold it) |
| `voicemail_received` | Utility | "Thanks for your voicemail. The office will see it and get back to you. Ref {ref}. Automatic reply. Send OFFICE to reach a person. — {firm} Shift Team" (built in Phase 7, `voicemailReceivedMessage()`: a worker's voicemail on the shifts line became a request for the office; {ref} is the request's reference. By the channel the worker chose, from the firm's line. A phone call doesn't open WhatsApp's 24-hour window, so unlike the instant replies it needs a template) |
| `unknown_number` | Service reply | "Thanks for your message. We don't recognise this number. If you work with {firm}, reply with your full name and the office will get back to you. Automatic reply. Send OFFICE to reach a person. — {firm} Shift Team" (built in Phase 7, `unknownNumberMessage()`: a WhatsApp to the shifts line from a number no worker here has; only the first from that number in 24 hours; from the firm's line. A former worker's number gets no reply: the office is alerted) |

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
  `request_update_no_note` is used when the office wrote no note; `credential_expiring_to_office`
  and `credential_expired_to_office` (no upload link) for a qualification she can't upload.
- "a" or "an" before the role is part of the role's variable ("a door supervisor").
- The sign-off is a variable, because a firm may set its own.

`tests/unit/copy.templates-doc.test.ts` holds this doc, the template functions
(`src/lib/messaging/templates.ts`) and the pack to each other. Change the wording in all three
together. Not submitted yet: PLAN.md Parking lot, "Submit the WhatsApp templates", has the steps.

## Instant replies on the shifts line (keyword first)

Built in Phase 7 (`shiftsLineReply()`; the job `src/lib/inbound/reply.ts`), short of Twilio and
the Anthropic API. Each reply ends "— {firm} Shift Team" and goes from the firm's shifts line, at once (free
text: within 24 hours of the worker's message WhatsApp needs no template). Keywords are whole words,
any case, checked in the order below (so "cancel my shift" is a cancel). The AI only picks a row;
the words are always these.

| Worker types | Reply |
|---|---|
| "cancel" | The personal cancel reply (below, 12D.2: their next booking, with its link) |
| "pay", "paid", "wages", "payslip" | "Your hours, rates and pay dates: {link} (you'll get a code to log in). Automatic reply. Send OFFICE to reach a person." ({link} is the pay page; never a list or an answer about pay) |
| "shifts", "work", "available" | The personal shift list (below, 12D.2). Not when the message also says they can't make it or are late ("can't", "cannot", "won't", "not", "unable", "sick", "ill", "late"): that's about their own shift, so the AI or the office gets it. "shift" alone isn't a keyword for the same reason |
| "help", "office", "talk" | "The office will see this and get back to you. Ref {ref}. Automatic reply. Send OFFICE to reach a person." + a request for the office (a question, the message as its note) |
| anything else | Haiku picks one of the rows above (the worker's text only; an answer that isn't exactly one label counts as none); no AI, a failure, or no answer within 5 seconds: the office row. A photo with no text: the office row |

## Personal replies on the shifts line

Built in 12D.2 (`src/lib/inbound/personal-reply.ts`; docs/office-v2.md 5.7 items 1 and 2): the
answer to "shifts" and "cancel", by keyword or the AI's label, built by code from the firm's data
(the AI only picks the label). Every automatic reply the shifts line sends (these, pay, the
office's, `unknown_number`, `voicemail_received`, `sms_stopped` and `sms_started`) ends
"Automatic reply. Send OFFICE to reach a person." before the sign-off (docs/office-v2.md 5.7 item
3: WhatsApp's escalation rule; "office" is a keyword).

**The shift list.** The casual app's own Open shifts for them (the rules, the showing switches and
their travel area), urgent first, then the nearest. For a casual asking about the weekend, booked
on Sunday:

```
Hi Zoe, you're booked on Sun 11 Oct (Steward · Riverside Food Festival · 10:00–18:00). For the weekend you can take:
1. Door supervisor · Northern Lights Live, Acme Demo Arena · Sat 10 Oct 08:00–16:00 · £15.50/h · Gate A · urgent
   3.1 miles · 12 min by car · 24 min by public transport
2. CSAS officer · Night patrols, Northgate Town Centre · Sat 10 Oct 17:00–23:00 · £15.00/h · town centre patrol · you hold CSAS
   8.4 miles · 21 min by car · 38 min by public transport
Take one here: {link}
Automatic reply. Send OFFICE to reach a person.
— Acme Events Shift Team
```

- The booked line only when they have a booking on a day they named (at most two named, then
  "and N more"); the day words ("For
  Saturday", "For the weekend", "For today", "For tomorrow") only when code recognises a weekday,
  "weekend", "today" or "tomorrow" in their message, and then only that day's shifts are listed.
  No day named: "Hi Zoe, shifts you can take:".
- Each shift: role · event, site · date and times · £/h (left out when the session has no rate) ·
  post · "urgent" · "you hold CSAS" (a session needing CSAS, which they hold: never for one only
  applied for), then the travel line as the app
  shows it ("… · no public transport by 07:30", "Distance not known yet"). Never a postcode: "your
  home area".
- At most 5 (3 by text), then "+ N more: {link}"; never over 1,600 characters: names (and the
  booked line's) are cut to set lengths, then fewer shifts are listed, and if nothing else would
  fit, only "Shifts you can take: {link}". A text's cut names end "..." (not "…", which would
  take the whole text out of the plain text alphabet). Always "Take one here: {link}" (Open
  shifts; no booking by reply number: D6 deferred).
- No home area: the travel lines are left out and "Add your home area to see how far each one is:
  {profile link}" goes before "Take one here".
- A firm with travel areas off (`travel.enabled`, 13.4): no travel lines, no "Add your home area"
  line, and no "within N minutes of your home area", whether or not a home area is saved (by
  WhatsApp and by text).
- Nothing they can take: "Hi Zoe, there's nothing you can take on Saturday within 45 minutes of
  your home area right now. We'll message you if something comes up. All open shifts: {link}"
  (the day and the area only when known; "We'll message you…" only when they get shift alerts).
- By text: "Acme Events: shifts for you: 1) Sat 10 Oct 08:00-16:00 Door supervisor, Acme Demo Arena, £15.50/h, 3.1 miles, 12 min by car, 24 min by public transport. 2) Sat 10 Oct 17:00-23:00 CSAS officer, Northgate Town Centre, £15.00/h, 8.4 miles, 21 min by car, 38 min by public transport. Take one: {link} Automatic reply. Send OFFICE to reach a person. - Acme Events Shift Team" (the same travel facts as the app's line, with commas instead of "·",
  which isn't in the plain text alphabet: "distance not known yet", "about 7 miles (straight
  line), travel time not known yet", "over 90 min by car")

**The cancel reply.** Their next booking, named, with its link:

- "Hi Kieran, you're booked on Steward · Raceday, Acme Demo Racecourse · Wed 7 Oct 10:30–18:30 · parade ring. To cancel, open it and tap Cancel this shift: {link}. It starts in less than 48 hours, so cancelling now gives you a strike. Automatic reply. Send OFFICE to reach a person. — Acme Events Shift Team"
- The strike sentence only when a strike would apply (`strikeDecision()`, as the cancel step's
  warning); with two or more bookings ahead, "Your other shifts: {Booked link}" before "Automatic
  reply". No booking ahead: "Hi Kieran, you have no shifts booked, so there's nothing to cancel."

What each reply was built from goes in the `enquiry.checks` log entry (docs/office-v2.md 3.6, 6.1):
ids, codes, dates and minutes only, for the words that went (a text lists fewer than a WhatsApp,
and when WhatsApp refuses one, the text version goes instead). The office reads it on the
message's Enquiries page.

## The office's reply on Enquiries

Built in 12D.1 (`officeReplyMessage()`; `src/lib/office/enquiry-actions.ts`, sent by the
`enquiry-reply` job). Someone in the office answers a message that needs a person, in their own
words on one line (500 characters at most). The page says which way it will go before it's sent:

- Inside WhatsApp's 24-hour window (their last WhatsApp to the shifts line was under 24 hours ago),
  or by text: their words as they are, signed: "{words} — {firm} Shift Team" on WhatsApp,
  "{words} - {firm} Shift Team" by text.
- Outside the window: the `request_update` template, as a question answered: "Your request
  (question, ref {ref}) is answered. The office says: {words} — {firm} Shift Team". {ref} is the
  question's reference, or the message's when it has none (an unknown number).
- It always goes from the firm's shifts line as it is now, and the window runs from their last
  WhatsApp to that line.
- A text never goes to someone whose last word to the line was STOP (a casual's setting, or a
  stranger's own STOP). A voicemail from a number that isn't a casual's gets no message: the office
  phones back. A withheld number can't be answered. In those cases the office closes it instead.

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

## Email to casuals (approved: Dylan, 2026-10-28; built in P2.4 and P2.6)

When a casual's phones take no push and no text can go (decision 15), a message goes by email to the
address the firm holds for them. Each email's body is the message's own words, as in the WhatsApp
templates above, the same in an email; only the subject is new. Signed like every message. As built
it comes from the app's one sending address (`SMTP_FROM`: a bare address with no display name, so
never a person's name), not one per firm (PLAN.md Parking lot, P2.4).

- Offer (`shift_offer`): subject "Shift available: {date} {start}–{end}"
- Urgent offer (`shift_urgent`): subject "URGENT: a {role} needed {day}" ({role} with its "a" or
  "an" in the message, plain here: "URGENT: a door supervisor needed today")
- Booking confirmation (`shift_confirmed`): subject "Confirmed: your shift on {date}"
- Reminder, the day before (`shift_reminder_24h`): subject "Reminder: your shift {day}"
- Reminder, 2 hours before (`shift_reminder_2h`): subject "Your shift starts at {start}"
- The office's change (`shift_changed_by_firm`): subject "Change to your shift on {date}"
- The office's cancellation (`shift_cancelled_by_firm`): subject "Your shift on {date} is cancelled"
- A request's answer (`request_update`): subject "Your request (ref {ref}) is {status}"
- A pay query's answer (`pay_query_update`): subject "Payroll has answered your pay query"
- The office's reply on Enquiries: subject "A reply from {firm}"; body "{words} — {firm} Shift Team"
  (not built for a message to the shifts line: its reply goes by text; PLAN.md Parking lot, P2.4. An
  email to the staffing inbox is answered by email: "The staffing inbox's emails" below)
- A licence running out (`credential_expiring`): subject "Your {credential} expires on {date}"
- A licence that has run out (`credential_expired`): subject "Your {credential} has expired"
- Login link (P2.6, only where the firm has switched it on): subject "Your {firm} shifts link";
  body "Here's your {firm} shifts link. It works for 15 minutes and only for you. If you didn't ask
  for it, you can ignore this email: {link} — {firm} Shift Team" (the link last, as in
  `login_link`, never followed by a full stop a phone could take into it; Dylan, 2026-10-29)
- Pay code (P2.6, the same): subject "Your {firm} code"; body "Your {firm} code is {code}. It works
  for 10 minutes. Don't share it with anyone. If you didn't ask for it, you can ignore this email.
  — {firm} Shift Team"

## The staffing inbox's emails (P7.5; Phase 25.5)

Built in Phase 25.5 (`src/lib/email/sort.ts`, `src/lib/office/enquiry-actions.ts`; words in
`src/lib/messaging/templates.ts`), as recommended (Dylan, 2026-10-30: "just do what you would
recommend stop prompting me and build it"). A casual's email to the firm's staffing inbox is
sorted as the shifts line sorts a message (P7.4). Every email below goes only to the address the
firm holds for the casual (never to the one the email came from: a sender can be faked), from the
app's one sending address with the firm's inbox as its Reply-To, so their reply comes back to
Enquiries. Its subject is "Re: {their subject}" ("Your email to {firm}" when it had none). Each
ends with the sign-off; every link is the last thing on its line, never followed by a full stop.

- With the firm's automatic replies on (P4.7), a shifts, cancel or pay email gets its link at once,
  never an answer in words (golden rules 1 and 9; nothing the AI writes reaches the casual):
  - Shifts (`email_answer_shifts`): "Hi {first name}," / "The shifts you can take are here:" /
    "{link to Open shifts}" / "You'll get a code to log in." / "This is an automatic reply. To
    reach a person, reply to this email." / "— {firm} Shift Team"
  - Cancel (`email_answer_cancel`): "Hi {first name}," / "To cancel a shift, open it here:" /
    "{link to My shifts}" / "You'll see what cancelling means for you before you confirm, and it's
    recorded the moment you do." / the automatic line / the sign-off
  - Pay (`email_answer_pay`): "Hi {first name}," / "Your hours, rates and pay dates are here:" /
    "{link to Pay}" / "You'll get a code to log in. If something looks wrong, tap \"Raise a pay
    query\" there, so payroll sees it." / the automatic line / the sign-off
  - At most 3 automatic replies to one casual in 24 hours (an out-of-office reply can't start a
    loop): past that, the email waits for a person.
  - With automatic replies off, nothing goes: the email waits for a person.
- An email for the office (they asked for a person, or nothing sorted it) gets no automatic reply.
  The office answers it on Enquiries in their own words, from a draft the AI may write first (never
  for a pay email: golden rule 9), which they check and change before sending. 2,000 characters at
  most: "Hi {first name}," / "{their words}" / "— {firm} Shift Team".
- The AI's draft (`draft_reply`, Haiku): from the casual's subject and words only (no shifts, pay,
  names or data of the firm's), a short, polite reply in plain words that promises nothing (no
  shift, time, pay or decision), offers no facts it wasn't given, and leaves out any greeting and
  sign-off (the email adds them). At most 1,200 characters; anything else, or no AI: no draft. Code
  decides when there's one: never for an email sorted as pay, nor for one whose words mention pay
  or money ("pay", "wages", "salary", "money", "owed", "overtime", "tax", "£" and the like).

## STOP and START by text

Built in Phase 7 short of Twilio (`src/lib/inbound/opt-out.ts`). A text to the shifts line that is
only one of Twilio's standard opt-out words (any case): STOP, STOPALL, UNSUBSCRIBE, CANCEL, END or
QUIT turns texts off for that number's worker; START or UNSTOP turns them back on, and YES does too
for a number that has them off. The whole message only: "can I cancel my shift" is a cancel, not an
opt-out. When Twilio's own opt-out handling acted on the text (it says so, `OptOutType`), Twilio has
sent its own confirmation; otherwise, only when the worker's setting changed, one text (a plain
hyphen before the sign-off: text only):

- `sms_stopped`: "You won't get texts from {firm} now. Reply START to turn them back on. Automatic
  reply. Send OFFICE to reach a person. - {firm} Shift Team"
- `sms_started`: "Texts from {firm} are back on. Reply STOP to turn them off. Automatic reply. Send
  OFFICE to reach a person. - {firm} Shift Team"

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
- Booked: "Shift booked" / "{date} {start} at {site}. Tap for details." (built: `bookedPush()`, with
  `shift_confirmed` when the office books a worker; tapping opens the shift)
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
don't know is shown on Enquiries and the office is alerted, with no message to them. Twilio's
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
- Strikes team confirmation (`strikes_email_confirm`, email, built in 12B.7,
  `strikesEmailConfirmEmail()`: to the address an admin saves on Settings, and to nobody else; the
  link is signed for that address and works for 7 days): subject "Confirm {firm}'s strikes team
  email"; body "{firm} uses ShiftDesk to record late cancellations, and asked to send these
  records to this address." / "If that's right, open this link within 7 days and select Confirm
  this address:" / "{link}" / "If you weren't expecting this, you can ignore this email: nothing is
  sent here until the address is confirmed." / "— {firm} Shift Team".
- Strike evidence (`strike_evidence`, email, built in 12C.4, `strikeEvidenceEmail()`: to the strikes
  team's confirmed address only, when a strike is recorded, with the cancellation record as a PDF;
  docs/office-v2.md 5.6): subject "Strike: {casual} cancelled {role} at {site} with {notice} (ref
  {ref})" (" at {site}" left out when there's none; at most 200 characters, the name and site
  shortened first); body "{casual} (staff id {staff id}) cancelled {session} at {when}, {hours}
  before the start. That is under your {threshold}-hour rule, so a strike was recorded
  automatically. It is their strike {n} in the last {days} days." / "The record is attached (PDF)
  and is also here:" / "{link}" / "— {firm} Shift Team" (" (staff id …)" left out when there's
  none). No reason in the subject or body; the PDF gives a casual's as "Casual's own reason (see
  ShiftDesk)", and doesn't name who filled the place again.
- Unknown number message (below), failed Sheets sync, domain verified/failed, credential expiries
  (weekly), pay digest (per schedule, below).
- `unknown_number_alert` (email, to active admins and resourcers, built in Phase 7,
  `unknownNumberAlertEmail()`: the first message in 24 hours, a WhatsApp, a text or a voicemail,
  from a number that isn't one of the firm's active staff): subject "{firm}: a message from a
  number we don't know"; body "Someone messaged the shifts line from a number that isn't one of
  your active staff." / "We asked them for their full name." (when they were sent `unknown_number`:
  a WhatsApp from a number nobody here has, and the reply went; otherwise "We haven't replied to
  them.") / "See it in Enquiries, under Need a person: {link}" / "— {firm} Shift Team". Neither the
  number nor the message is in the email (previews, forwards): they're on Enquiries, "Need a
  person", which the link opens (`/office/enquiries?view=person`).
- `unknown_numbers_combined` (email, to active admins and resourcers, Phase 25.3; the mock-up
  approved by Dylan on 2026-10-30, `unknownNumbersCombinedEmail()`): once, at the end of a clock
  hour in which the firm's 5 `unknown_number_alert` emails were used up, for the messages that
  hour that got no email: subject "{firm}: {2 more messages} from numbers we don't know" ("1 more
  message"); body "{2 more messages} came to the shifts line between {18:00} and {19:00} from
  numbers that aren't your active staff." / "We send at most 5 of these emails an hour, so this one
  covers the rest." / "See them in Enquiries, under Need a person: {link}" ("See it" for 1) /
  "— {firm} Shift Team". Like the alert, no number and no message (the hour in the firm's time
  zone).
- `inbox_summary` (email, to active admins and resourcers, Phase 25.5; P7.5's "a summary every 3
  hours"): at the end of each 3 hours of the firm's day (00:00, 03:00 … 21:00, its time zone) in
  which the staffing inbox got an email, once: subject "{firm}: {12 emails} to the staffing inbox"
  ("1 email"); body "Between {09:00} and {12:00}, the staffing inbox got {12 emails}:" / "{5}
  answered with a link" / "{4} waiting for a person" / "{1} already answered by your office" / "{2}
  pay questions" ("1 pay question") / "{1} not from your casuals (in your own inbox)" (each line
  only when it isn't 0; pay questions are counted there only, whatever came of them) / "See them in Enquiries: {link}"
  / "— {firm} Shift Team". No names, addresses or words (previews, forwards); "waiting for a
  person" counts those still waiting when it's sent.
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
  summary: {line} (written by AI)" beneath once the Anthropic API is connected (the 10 biggest groups);
  "{n} queries from earlier digests are still waiting." (when some are); "{n} more new queries
  didn't fit in this digest. They're on the pay queries page and will be in the next one." (over
  1,000); "The list is attached ({filename}): each query with the worker, the day, the shift, the
  issue and what they wrote."; "Answer them on the pay queries page: {link}"; "— {firm} Shift
  Team". {facts} is what a group shares, written by code from the firm's data ("wrong rate, the
  week of Mon 7 Sep, paid at £12.50"; on a fortnightly pay calendar, in the firm's word for its
  period: "wrong rate, the cycle of Mon 12 Oct, paid at £13.00", Phase 25.2). The body holds counts and facts only; names and what
  workers wrote are only in the attached list (columns Reference, Worker, Day worked, Shift, Issue,
  What they wrote, Sent (firm time), Group; spreadsheet-safe cells).
