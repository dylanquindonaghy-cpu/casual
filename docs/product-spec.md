# Product spec: ShiftDesk (working name)

## Problem statement

Staffing firms that run casual workforces (event security, stewarding, rail, civils,
construction, cleaning) handle shift admin by email, phone and WhatsApp. One resourcer at a
UK event security firm handles 60+ emails and around 10 calls a day, and about 40% of emails
asking about available shifts get actioned without any reply. Staff are left hanging, chase,
and drift to other agencies. Busy weeks multiply the load, and firms cover it with overtime
or extra admin.

Nationally, casual workers face constant late changes: in TUC polling, 84% of zero-hours
workers had been offered shifts at less than a day's notice and 69% had shifts cancelled at
less than a day's notice. From 2027 the Employment Rights Act adds rights to reasonable notice
of shifts and pay for short-notice cancellations, so firms will need evidence of every offer,
change and cancellation.

## Goals

1. **Every shift query gets an instant, accurate answer.** Unanswered rate from ~40% to under 2%.
2. **Resourcer time back.** Cut shift admin by 15–20% in a normal week and 30%+ in busy weeks
   (measured against the firm's own baseline).
3. **Gaps filled faster.** Median time to refill a cancelled shift falls by half vs baseline.
4. **Evidence by default.** 100% of offers, changes and cancellations logged with timestamps
   and notice period, exportable.
5. **Business:** first paid pilot within ~17 weeks; converts to a paid plan after 4 weeks.

## Non-goals (for the pilot)

- **Replacing the firm's rota system.** We sit alongside it. (Firms already on Deputy or Parim
  are not targets.)
- **Moving staff off WhatsApp.** We meet them there with a business number that answers instantly.
- **AI answering pay disputes.** Payroll gets a grouped digest instead.
- **Native mobile app and geofencing.** Stage 3, after a DPIA.
- **AI email inbox and AI phone agent.** Stage 2, after 3 paying firms.
- **Multiple sectors at once.** One sector sold at a time; credential rules are built generic.

## Personas

- **Casual worker:** often juggles several agencies; wants shifts and certainty, fast.
- **Resourcer:** fills shifts, answers everyone, drowns on busy weeks.
- **Payroll officer:** gets bombarded when a rate isn't updated.
- **Firm owner / ops director:** margins tight; wants fewer no-shows, compliance evidence,
  no extra admin hire at peak.

## User stories (priority order)

**Casual worker**
- As a worker, I want to see my upcoming shifts with site, times and instructions so that I
  don't need to message anyone to check.
- As a worker, I want to see open shifts I'm eligible for and take one instantly so that I
  don't wait for a resourcer to reply.
- As a worker, I want to cancel a shift and get instant confirmation so that I know it's done
  and on record.
- As a worker, I want to request a time change or swap and see its status so that I'm not
  left guessing.
- As a worker, I want urgent shifts that match me to reach me straight away so that I can
  pick up extra work.
- As a worker, I want to see hours logged, rates and pay dates so that I can check my pay
  without messaging payroll.
- As a worker who messages the shifts line on WhatsApp, I want an instant reply with the
  right link so that I'm never ignored.
- Edge: as a worker whose licence has expired, I want to be told clearly why I can't take a
  shift and what to do.

**Resourcer**
- As a resourcer, I want one screen showing today's gaps, urgent shifts, cancellations and
  requests so that nothing is missed.
- As a resourcer, I want dropouts refilled automatically in waves so that I'm not phoning
  round at 6am.
- As a resourcer, I want every action logged so that disputes are settled in seconds.

**Payroll**
- As payroll, I want pay queries grouped by cause in one digest so that I fix one root problem
  instead of answering 40 people.

**Firm owner**
- As an owner, I want a notice and cancellation report so that I'm ready for the 2027 rules.
- As an owner, I want the portal in our branding on our domain so that staff trust it.

## Requirements

### P0 — must have for the pilot

| # | Requirement | Acceptance criteria |
|---|---|---|
| P0-1 | Link login via WhatsApp/SMS | Given a known mobile, when the worker requests a link, then a single-use link valid 15 min arrives; used/expired links are rejected; a session lasts 30 days. |
| P0-2 | My shifts | Shows next 30 days and last 30 days; loads in under 2 s on 4G. |
| P0-3 | Open shifts + take shift | Only eligible shifts show. Given two workers tap "take" at once, then exactly one gets it and the other sees "already filled". |
| P0-4 | Rules engine | Credential in date, qualification, no overlap, rest gap, weekly hours cap, firm "applied" allowance. Returns reasons in plain English. |
| P0-5 | Cancel with confirmation | Instant confirmation; reason captured; notice hours stored; event written; resourcer sees it on the dashboard. |
| P0-6 | Change/swap requests | Request created; office approves/declines; worker sees status. |
| P0-7 | Urgent board + offer waves | Only eligible workers notified; waves of 3–5; 15 min timeout (configurable); stops when filled; escalates to resourcer at a set time before start. |
| P0-8 | Notifications | Web push + WhatsApp template for urgent; SMS fallback; quiet hours. |
| P0-9 | Resourcer dashboard | The dashboard (counts, urgent gaps, latest cancellations and enquiries, Needs attention), requests queue, action log with filters. |
| P0-10 | Notice/cancellation report | Every offer/change/cancel with timestamps, notice hours, short-notice flag; CSV export. |
| P0-11 | Tenant isolation | Cross-tenant tests pass; RLS on all tables. |
| P0-12 | Roster source | Native mode and Google Sheets sync; CSV import. |
| P0-13 | Branding | Firm name, logo, colours; replies signed "[Firm] Shift Team". |
| P0-14 | Firm-initiated changes | Given the office cancels, moves or shortens a shift with workers assigned, then a reason is required, notice hours are logged per worker, and each worker is notified. |
| P0-15 | Credential expiry handling | Warnings at 30/14/7 days; automatic block on expiry; renewal recorded by the office restores eligibility. |

### P1 — fast follow (in this plan, cut first if time runs out)

| # | Requirement | Acceptance criteria |
|---|---|---|
| P1-1 | Pay info page (OTP) | Hours, rates, pay dates from imported data; OTP required; no free-text AI answers about pay. |
| P1-2 | Payroll digest | Queries grouped by cause; digest sent at a set time; worker sees status. |
| P1-3 | WhatsApp shifts line | Known worker gets instant reply + link; unknown number gets polite reply + office alert. |
| P1-4 | Call-to-text | Caller hears a short message and receives the link by WhatsApp/SMS within 30 s. |
| P1-5 | Custom domain | `shifts.firmname.co.uk` works with HTTPS after the firm adds one CNAME. |
| P1-6 | Fair rotation mode | Per firm: first come first served, or fewest-hours-this-week first. |
| P1-7 | Availability | Worker marks dates unavailable; those dates are excluded from eligibility and offers. |
| P1-8 | Shift reminders | 24 h and 2 h before start by push/WhatsApp; no-show count tracked. |
| P1-9 | Offline "My shifts" | Last loaded shifts open without signal; clearly marked as last updated at HH:MM. |
| P1-10 | GDPR export and delete | Office can export a worker's data and delete a worker; firm can export all its data. |

### P2 — design for, don't build yet

- AI email inbox with approve mode and 3-hourly summaries.
- AI phone line add-on (existing ElevenLabs agent).
- Sector credential packs for rail (PTS, Sentinel) and construction (CSCS).
- Compensation calculator for 2027 rules.
- Check-in/out with location; native app with geofencing.
- Per-active-worker billing and self-serve onboarding.

## Success metrics

**Leading (weeks 1–4 of pilot)**
- Portal activation: 50%+ of active workers log in at least once (stretch 75%).
- Shift queries answered instantly: 98%+.
- Urgent shifts filled via waves: 60%+ without a phone call.
- Median time from cancellation to refill: half the baseline.

**Lagging (months 2–6)**
- Resourcer shift-admin time: −15–20% normal weeks, −30%+ busy weeks.
- Inbound shift emails and calls: −50%.
- Pilot converts to paid; customer gives a referral.
- Monthly customer churn under 3%.

**How measured:** baseline week logged before go-live (emails, calls, unanswered count, time to
fill); product metrics from the events table; resourcer weekly check-in.

## Open questions

| Question | Who answers | Blocking? |
|---|---|---|
| How do this firm's staff actually cancel today: call, text or WhatsApp? | Discovery calls | Yes, before Phase 7 |
| Will firms pay £299 for a pilot and ~£3 per active worker after? | Discovery calls | Yes, Gate A |
| Where does the pilot firm keep pay data, and can we get a weekly export? | Pilot firm payroll | Before Phase 6 |
| Final 2027 notice threshold and compensation rules | Government regulations | No, keep threshold configurable |
| Does the first pilot firm want exclusivity? | Pilot firm | Before signing |
| Do Anthropic's data processing agreement and UK transfer terms fit, and where does it process requests (ADR-021)? | Dylan (with the solicitor) | Before the AI is switched on |

## Timeline considerations

- **Football season runs to May.** Stewarding firms have cancellations every week; aim for a
  pilot live by late January/February.
- **Employment Rights Act 2025** zero-hours measures (expected in force in 2027): the notice report is the sales hook.
- **WhatsApp pricing changed on 1 October 2026:** service replies beyond 1,000 per number per
  month are charged, and a payment method must be on file.
- **Meta business verification** can take days: start it during Phase 7, not at go-live.
