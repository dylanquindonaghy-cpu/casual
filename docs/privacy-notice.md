# Privacy notice wording for a firm

What to send a pilot firm so it can tell its staff how their information is used when it uses
ShiftDesk (onboarding step 10, `docs/runbooks.md` "Onboarding a pilot firm"). The firm is the
controller: the notice is its own, so this is a suggestion for it to adapt, not ours to publish.
**Not legal advice:** have it read by a solicitor with the terms and DPA before the first pilot
(`docs/compliance.md`). Every statement below is what the app does today; if the app changes,
change this too.

Replace the parts in [brackets]. Send both parts.

## 1. The short line (for the staff handbook, contract or onboarding pack)

> Shift messages, requests and enquiries may be handled by automated systems on our behalf. You
> can ask for any decision about your shifts to be reviewed by a member of our team.

## 2. The section for the firm's privacy notice

> **Our shifts portal and shifts line**
>
> We use ShiftDesk, a service run for us by [our supplier's legal name], to offer you shifts,
> book and change them, remind you about them, answer your questions and show you your pay
> details. [Our supplier] acts only on our instructions (it is our processor). We decide how your
> information is used.
>
> **What it holds about you:** your name, mobile number, email address (if we have it), the roles
> you work and our staff ID for you; your licences and cards (such as SIA or CSCS: type, number,
> expiry and whether we've checked them); the days you've told us you can't work; the shifts you're
> offered, take, work, miss or cancel, with the notice given and the reason; requests you send us
> and our answers; your hours, pay rates and pay dates as our payroll records them, and any pay
> questions you raise; how you want to hear from us (WhatsApp or text); when you log in; and, if you
> turn on notifications on a phone, that phone's notification address.
>
> **Why:** to run your shifts with you (our contract with you), to check you hold the licences a
> shift needs (a legal requirement for some roles), and to keep a record of every offer, change
> and cancellation, and the notice you were given (our legitimate interest, and the notice rules
> for zero-hours work).
>
> **Messages to our shifts line:** texts, WhatsApps and calls to our shifts line [number], and the
> text of any voicemail, are kept for [90] days, then deleted. This includes messages from people who
> aren't our staff (we keep the number and the message so we can reply). Automatic replies are
> signed "[Our firm name] Shift Team"; they are never from a named person.
>
> **Automation:** the app decides nothing about you using AI. Who can take a shift, whether your
> licences are in date and what you're paid all come from our own records by fixed rules. An AI
> service may be used for two things only: to sort the topic of a message you send to our shifts
> line (so it gets the right link or goes to our office), and to write a one-line summary of a
> group of pay questions for our payroll team (from the facts only: how many, the issue, the week,
> the site and the rate paid, never your name). Every reply you get is fixed wording, and a pay question is always
> answered by a person. You can ask for any decision about your shifts to be reviewed by a member
> of our team.
>
> **On your phone:** so that My shifts opens without signal, your phone's browser keeps a copy of
> that one page (your first name, your upcoming shifts with times, sites and instructions, and any
> licence expiry notice). It's needed for the service you asked for. It's deleted when you log
> out, when you log in again on that phone, or when the app finds you're no longer logged in; a
> copy more than 14 days old is never shown. [If we show our logo:] Our logo is loaded from our own
> website, so our website sees your phone's internet address, as it would for any visit.
>
> **Who else handles it:** [Our supplier] stores it in [the UK / the EU] ([hosting company], which
> runs its servers and database). It uses [email company] to send emails, Twilio (texts, WhatsApp
> and calls) and Meta (WhatsApp) to send and receive messages[, and Google, as we keep our rota in
> a Google Sheet], and, once the AI service above is switched on, Anthropic [where Anthropic
> processes it, and the safeguard for any transfer outside the UK: confirmed before the AI is
> switched on]. Twilio and Meta may handle your number and messages in the United States, under
> their data transfer terms.
>
> **How long:** messages to the shifts line, [90] days. The words typed into a request (a note, a
> colleague's name) and the reason our office gave for placing you on a shift a rule would have
> stopped, [12 months] after the request closed or the booking was made. Login links and codes, 7
> days after they run out; login sessions, 30 days after they end. If there's a dispute, we may keep
> things longer, until it's settled. Your details, shifts, requests, pay records and the
> record of offers, changes and cancellations are kept as our records [for as long as you work with
> us and then for [period]].
>
> **Your rights:** you can ask us for a copy of your information (we'll send it within a month),
> ask us to correct it, or ask us to delete it. If you ask us to delete it, your name, number,
> email, staff number, licences, days off, messages and logins are deleted, and so are the notes on your own
> requests, pay questions and cancellations, and the reasons our office typed when it placed you
> on a shift. The record of the shifts you were offered, worked or cancelled, and your pay records,
> stay without your name, because we must be able to show the notice we gave and what we paid.
> What other people wrote that mentions you (a colleague's swap request or pay question naming you,
> say, or a message someone else sent us) isn't changed by your request: some of it is deleted on
> the schedule above, and the rest is kept as our records.
> The copy of My shifts on your own phone goes the next time your phone opens My shifts with
> signal, and is never shown once it's 14 days old. You can also object, and ask for a decision to
> be reviewed by a person. Contact [our contact]. You can complain to the Information
> Commissioner's Office (ico.org.uk).

## Notes for you (not for the firm to publish)

- **The retention periods** in square brackets are this firm's own settings (`npm run -s
  firm:settings -- --firm <slug>` shows them: `retention.message_days`, default 90;
  `retention.request_note_days`, default 365). Put the firm's own numbers in before it publishes.
  A hold (`retention.hold_until`) pauses the deletions for a dispute; the notice says so in general
  terms.
- **Before sending this to a firm, once Twilio is connected (audit L41):** Twilio keeps its own copy
  of messages, call recordings and transcriptions in our account until they're deleted there. The
  app's 90 days are only true when the job that deletes them from Twilio exists ("Connect Twilio",
  PLAN.md Parking lot, "Before going live"). Until then, don't send the "kept for 90 days" wording,
  or add "and our messaging provider's copy for [period]".

- **The [period]** for keeping records after someone leaves is the firm's call. The app doesn't
  yet delete the action log, requests or offers after 12 months (PLAN.md, "GDPR follow-ups": for
  you to decide once the 2027 notice rules are final), so until then don't let the firm promise a
  shorter period than it actually keeps.
- **"Deleted when you ask"** is done by an admin on the office's Data requests page
  (`docs/runbooks.md` "GDPR requests"). A firm that must keep licence-check records after someone
  leaves (BS 7858, SIA rules) should say so here: today a deletion removes them (parked in "GDPR
  follow-ups", for you to confirm).
- **The Google line** only if the firm's rota is a Google Sheet (onboarding step 5).
- **The logo line** only if the firm sets a logo (`npm run firm:brand -- --logo …`).
- **The AI** isn't connected yet ("Connect the Anthropic API"). The "Automation" paragraph says it
  "may be used" and the sub-processor line says "once it's switched on", so the notice is true now.
  Before it's switched on, fill in where Anthropic processes requests and the transfer safeguard,
  after checking its data processing agreement and UK transfer terms (ADR-021): Anthropic's API may
  process requests outside the UK.
- **The hosting and email companies** aren't chosen yet ("Connect hosting", "Connect an email
  provider (SMTP)"). Fill in their names, and the UK or the EU, when the accounts are created.
- **Deletion keeps pay records** (said in "Your rights"): for you to confirm (PLAN.md "GDPR
  follow-ups"). The office's typed override reasons are deleted with the worker since Phase 10
  (they're on the booking now, not in the append-only log). Some of what colleagues typed (pay
  questions, cancellation notes) is never deleted on a schedule: "Dylan to confirm" in PLAN.md.
- **Our supplier's legal name** is yours: the business you sign the pilot agreement as.
