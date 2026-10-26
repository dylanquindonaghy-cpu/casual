# Questions before connecting a firm's CRM and ops portal

What we need to know before building the proposals P1 to P7 in `PLAN.md` ("Proposed 2026-10-26").
Two short messages, ready to copy (one to AXLR8, one to whoever built the firm's ops portal), and
a list of questions for the firm's own office or IT. This file names no firm and holds no real data
(golden rule 7).

## Rules while asking

- No real data comes into ShiftDesk, and no one tests the connection with real logins, until the
  pilot agreement and DPA are signed (Gate B; `PLAN.md` Legal 1 and Checks 20 and 21).
- AXLR8's API Builder PDF and any field list it sends are AXLR8's own documents. Read them, but
  never put them, or copies of their field names, in this repo. Record only the answers below in
  plain words.
- Don't explore AXLR8's API with an employee's login. Ask AXLR8 for a sandbox.

## What we already know (October 2026)

From public sources:

- AXLR8 Staffing describes "a callable API with credentials and Python code examples". Its fields
  come as a standard package and can be extended and filtered in its Report Builder ("RB Admin").
  The details are in a PDF, "AXLR8_Staffing_API_Builder_V2.pdf", that isn't public
  ([AXLR8, 15 Jan 2026](https://staffing.axlr8.com/staffing-apis-for-smart-organisations/)).
- AXLR8 sends texts through Webex Interact
  ([AXLR8 FAQs](https://staffing.axlr8.com/faqs/)). Webex Interact has a send API and webhooks for
  incoming texts, delivered, failed and opt-outs, and replies need a "dedicated inbound number"
  ([Webex Interact API docs](https://docs.webexinteract.com/)).
From the firm (Dylan, 2026-10-26; not public):

- The firm's ops portal reads from AXLR8 ("Sync AXLR8 Data") and has payroll by fortnightly cycle,
  check-in and check-out, and live on-site counts.

## 1. To AXLR8 (its sales team, through the contact page on axlr8.com)

> Hello. I'm building ShiftDesk, a staff app and shifts line for casual workers, for staffing firms
> that use AXLR8. One of your customers wants to connect it to AXLR8. Before we build anything,
> could you help with these?
>
> 1. Could we have the API Builder PDF and a sandbox account with made-up data?
> 2. Is the API REST with JSON? How does it log in (a key, a token, a login per firm)?
> 3. Is it built on saved reports or on records? Does each call return everything, or can we ask
>    for only what changed since a time?
> 4. Can we read one session's bookings, and one person's bookings, on their own?
> 5. Can the API write: book a person on a shift, cancel a booking, mark a day as not available? If
>    so, can a write carry our own reference so a retry is safe? Does AXLR8 stop a shift going over
>    the number of people it needs?
> 6. Does each booking show when it was made and cancelled, and why or by whom? Are times given with
>    a time zone?
> 7. Is there a field for staff type (contracted, casual)? Do qualifications come with expiry dates?
> 8. Are there webhooks, or any way to hear about a change without asking?
> 9. Rate limits? A cost for API access? Do calls need to come from a fixed IP address?
> 10. Does a customer connecting a third-party system need your consent or a separate agreement?
>
> Thank you.

## 2. To whoever built the firm's ops portal

> Hello. The office is looking at ShiftDesk for casuals' shift queries and cancellations. Payroll,
> check-in and on-site stay in your portal. Could you tell me:
>
> 1. Does the portal have an API or webhooks? If so, can it share attendance (checked in, checked
>    out, no-show, with times) and pay lines (hours, rate, gross, pay date, cycle) per person?
> 2. If not, can it export those as a CSV file?
> 3. Is "Sync AXLR8 Data" run by hand or on a timer? How often?
> 4. Who should I talk to about connecting it, once the firm agrees?

## 3. To the firm's office or IT

1. **Texts.** Is the text system Webex Interact? Is the account the firm's own, or held through
   AXLR8? What does a text cost? Which sender name or number is used? Does anyone read replies on
   that number today, in AXLR8 or elsewhere? Which texts does AXLR8 already send to casuals
   (booking confirmations, reminders)? Later, for testing: a test key, a dedicated inbound number
   and the webhook signature setting.
2. **Email.** Is the staffing mailbox on Microsoft 365 or Google? Can it forward incoming mail
   automatically? Which address should replies come from? Roughly what share of its mail is from
   casuals, and what share from clients, venues and applicants?
3. **Pay cycles.** What date did cycle 1 start, and how are cycles numbered over the year end?
   (Two-week cycles that follow ISO weeks break at the end of a 53-week year such as 2026.) Is pay
   day always the Friday after a cycle ends?
4. **Roles.** Which role names carry a pay tier (NLW, LLW), and which sessions are for contracted
   or holiday staff rather than casuals?
5. **Bookings.** When a session shows to casuals in ShiftDesk, would the office book people for it
   from ShiftDesk rather than AXLR8? (That keeps the chance of two people booked on one place small.)

## Answers

Plain words only, no copied field lists. First answers from Dylan, 2026-10-26.

| # | Question | Answer | Date |
|---|---|---|---|
| A1–A10 | AXLR8 (all ten questions) | **On hold:** AXLR8 can't be asked for now. The ops portal's API is the way in meanwhile (O1) | 2026-10-26 |
| O1 | Ops portal: API or webhooks for attendance and pay lines | **Yes**, it has an API, and it can share attendance and pay lines per person | 2026-10-26 |
| O2 | Ops portal: CSV export | Not needed: it can send the data by its API | 2026-10-26 |
| O3 | Ops portal: how "Sync AXLR8 Data" runs | **Every hour**, so the portal's copy of AXLR8 can be up to an hour behind | 2026-10-26 |
| O4 | Ops portal: who to talk to | Dylan will sort it | 2026-10-26 |
| F1 | Texts: Webex Interact, whose account, replies, what AXLR8 sends | **Webex Interact, the firm's own account, about 20p a text, replies turned off.** Which texts AXLR8 already sends: still to ask | 2026-10-26 |
| F2 | Email: provider, forwarding, reply address, mix of mail | **Microsoft 365 (Outlook).** Forwarding, the reply address and the mix: still to ask (follow-ups below) | 2026-10-26 |
| F3 | Pay cycles: numbering, pay day | **Fortnightly, always paid on the Friday.** Cycle 1's start and the year-end numbering: still to ask | 2026-10-26 |
| F4 | Roles: pay tiers in names; contracted and holiday sessions | All of them carry it; the API will show which once there's access | 2026-10-26 |
| F5 | Bookings for showing sessions made from ShiftDesk | The office books normally (in AXLR8). Places filled overnight, out of office hours, for the next day, and urgent places, are booked through ShiftDesk; and the office can book through ShiftDesk too | 2026-10-26 |

## 4. Follow-ups (from the answers above)

For whoever gives access to the ops portal's API (O4):

1. Besides attendance and pay lines, does the API give sessions (date, times, site, role, places
   needed), staff (name, mobile, email, payroll number, roles, staff type), qualifications with
   expiry dates, and who is booked on each session?
2. Can it take writes: book a casual on a session, or cancel one, and pass that on to AXLR8? If
   not, a booking made in ShiftDesk overnight goes on the office's "Enter in AXLR8" list for the
   morning.
3. Do we fetch from it, or can it send us changes as they happen (webhooks)? How does it log in?
4. Does each booking carry when it was made and cancelled, and why or by whom? Are times given with
   a time zone?
5. A booking made in AXLR8 can take up to an hour to reach the portal (O3). Is that fine when
   ShiftDesk only fills overnight and urgent places (F5)?

For the firm's office or IT:

1. **Texts:** which texts does AXLR8 already send casuals (booking confirmations, reminders)? Could
   replies be turned on later (a dedicated inbound number), so casuals can text back?
2. **Email:** Microsoft 365 blocks automatic forwarding to outside addresses by default. Can
   IT allow it for ShiftDesk's one address? Which address should replies come from? Roughly what
   share of the mail is from casuals?
3. **Pay:** what date did cycle 1 start, and how are cycles numbered over the year end?
