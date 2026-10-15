# Business case

Everything researched so far, in one place. Estimates are marked. Prices checked
September 2026 ($1 ≈ £0.74), ex-VAT.

## The problem, with evidence

**Inside one UK event security firm:**
- 60+ emails and ~10 calls a day from casual staff: shift requests, availability, time changes,
  cancellations, complaints, pay queries.
- ~40% of emails asking about available shifts get actioned without a reply.
- Busy weeks multiply the load.

**Across the UK:**
- 1.24 million people on zero-hours contracts (record, 2026). 77% aren't in full-time education;
  32.8% rely on it for full-time work.
- TUC polling: 84% of zero-hours workers offered shifts at under a day's notice; 69% had shifts
  cancelled at under a day's notice.
- Over half weren't paid for their last cancelled shift (two-thirds among zero-hours workers).
- Work Foundation diaries: workers spend a substantial amount of time just finding shifts, and
  fear losing future shifts if they upset managers. (Small sample: 9 people.)

## Why firms will pay (value maths)

| | |
|---|---|
| Resourcer salary | £24,000 |
| + employer NI (15% above £5,000) | ≈ £2,850 |
| + pension (3% of qualifying earnings) | ≈ £530 |
| **Real cost** | **≈ £27,400 a year (≈ £2,280 a month)** |
| 15–20% time saved (normal weeks) | ≈ £340–£460 a month |
| 30–40% saved (busy weeks, if load doubles) | ≈ £680–£910 a month in those weeks |

On admin time alone, the saving is modest in normal weeks. The case gets strong with:
1. **Busy weeks:** "no extra admin cover for peak season" (overtime, temps, a second resourcer).
2. **Staff retention:** casuals who get no reply go to another agency.
3. **2027 compliance:** the Employment Rights Act brings reasonable notice of shifts and pay for
   short-notice cancellations; agencies pay the compensation. Every offer/change/cancel logged
   with timestamps becomes the firm's evidence.

**Pitch order:** (1) ready for the 2027 notice and cancellation rules, (2) fill urgent shifts
faster, (3) every staff query answered instantly and no extra resourcer at peak.

Measure it in every pilot: emails, calls and unanswered messages in a normal week and a busy week.

## Market size

| Segment | Count | Source quality |
|---|---|---|
| UK private security businesses | 6,572 (2026) | IBISWorld — good |
| SIA approved contractors (standard route) | 780 | SIA FOI — strong |
| UK private security revenue | £10.1bn (2026–27) | IBISWorld |
| SIA licence holders | 451,000+ (2025) | Statista/GOV.UK — good |
| Employment placement agencies | 17,110 | IBISWorld — good |
| People on zero-hours contracts | 1.24 million | Work Foundation/ONS — good |

**Estimates (not researched facts):**
- Realistic target market (events/stewarding/security firms with 20–500 casuals): ~1,000–1,500 firms.
- Solo founder, 3 years: 20–40 firms ≈ £144k–£288k a year at ~£600/firm/month average.
- Adjacent sectors with the same pain: rail, civils, construction labour, cleaning,
  hospitality staffing, care agencies.

## Competitors and gaps

| Product | What it does | Price |
|---|---|---|
| Deputy | Rota + staff app; launched Deputy AI (28 Nov 2025): finds replacements, approves timesheets | £3.25 / £4.25 / £6.50 per user per month |
| Parim | Rota, open shifts, staff app, event module | From £47/month (shift-based) |
| Liveforce | Event staffing; white-label app with custom domain on Enterprise only | From €80 / €180 per month |
| Timegate | Security rostering; no-show alerts, skill-matched filling | Not published |
| Guardhouse | Security; daily automated SIA licence checks | From $3,500 a year |
| TacDesk | Security scheduling | £1–£2.50 per guard per month |
| RotaCloud | Rota | From £10/month for 1–5 staff (~£1/employee) |
| Planday | Rota | From £2.99 per user |
| Indeed Flex | Staffing marketplace with a 24/7 AI worker assistant ("Lexi") | — |
| Meta Business Agent | AI agent inside WhatsApp Business, global since June 2026 | — |

**Gaps we fill:** none of nine vendors checked has WhatsApp built in; white-label custom domains
are rare (Liveforce Enterprise only); nobody sells to spreadsheet/WhatsApp firms as a layer on
top of what they already do.

**Threats:** incumbents are adding AI fast. Move quickly, stay focused on firms without them.

## Pricing (hypothesis — test in discovery)

- **Pilot:** £299 for the first month, paid before go-live. Baseline agreed upfront.
- **Plan:** ~£3 per active worker per month, £199 minimum.

| Firm | Active workers | Monthly |
|---|---|---|
| Small | 40 | £199 (minimum) |
| Mid | 150 | £450 |
| Peak month | 400 | £1,200 |

- **Add-on:** AI phone line £149/month (costs ~£30).
- **Annual:** 2 months free. **Terms:** monthly rolling (vs 24–60 month lock-ins elsewhere).
- **Large/multi-site or own tenant:** quoted.

## Running costs (per firm per month)

At ~60 emails and 10 calls a day, 100–200 casuals:

| Item | Monthly |
|---|---|
| Claude Haiku 4.5 through the Anthropic API ($1/$5 per million tokens in/out) | ~£8–£12 |
| Twilio SMS (~$0.056 ≈ 4.1p each; fallback only) | ~£20–£42 |
| WhatsApp (first 1,000 service messages per number per month free; templates charged) | ~£5–£20 |
| Voice in (call-to-text, short calls) | ~£6–£15 |
| Share of hosting (an estimate until a host is chosen, PLAN.md "Connect hosting": about £29 a month for the server and database together, shared) | ~£5–£29 |
| **Total** | **~£60–£110** |

- AI phone add-on adds ~£30 (ElevenLabs ~$0.08/min + Twilio).
- SMS is the swing cost. Push and WhatsApp first.
- Gross margin ~80–90% at typical prices.

## Six-month cash plan (estimates)

| Month | What happens | Spend |
|---|---|---|
| 1 | Build. AI off until "Connect the Anthropic API" (then pay as you go). Twilio test number. | ~£30–£50 |
| 2 | Build. Discovery calls. | ~£30–£50 |
| 3 | Incorporate (Companies House £100 from 1 Feb 2026). ICO fee (£52, or £47 by direct debit). | ~£200–£230 |
| 4 | First pilot. Insurance starts. Solicitor-reviewed terms + DPA (estimate £500–£1,500). | ~£700–£1,700 |
| 5 | Pilot runs. Usage ~£60–£110. | ~£200–£300 |
| 6 | Second firm. Accountant (estimate £50–£100/month). | ~£250–£400 |

Month 4 breaks a £100–£250 monthly budget unless the pilot pays upfront or legal uses templates.
**Take the £299 before go-live.** Insurance, solicitor and accountant figures are estimates — get quotes.

## Build effort

- Narrowest pilot: 150–250 hours (council estimate). This plan: ~190–270 hours.
- At 12–15 hours a week: ~16–20 weeks.
- Full scope (AI inbox, phone line, more plugs): 500–800 hours total.
- A 2025 randomised trial found experienced developers 19% slower with AI tools while feeling
  20% faster. Log real hours.

## What casual staff will think

**For**
- Late changes are normal; instant written confirmation helps.
- A timestamped log gives them proof when cancellations aren't paid.
- A rules-based shift board feels fairer than favouritism.
- Finding shifts takes real time; an open-shift board cuts it.
- A link on WhatsApp means no new app.

**Against**
- First come, first served favours people glued to their phones → offer fair rotation.
- 23% of over-65s don't have a smartphone → keep a text/phone route.
- Some distrust automated answers about pay → pay facts from data, disputes to a person.
- Location tracking later may feel like surveillance → DPIA, only during shifts, told upfront.

## What companies will think

**For:** 2027 evidence; faster urgent fills; automatic credential date checks; staff answered
instantly; no extra admin at peak; branded portal on their own domain.

**Against:** cost when margins are tight (IBISWorld notes labour cost inflation squeezing security
margins); "we already have an app" (not our target); relying on one person; changing habits.
Answers are in `docs/go-to-market.md`.

## Risks to watch

- Incumbents adding AI (Deputy AI, Indeed Flex, Meta's WhatsApp agent).
- SMB software churn: 3–7% of customers a month; ~70% of churn in the first 90 days → onboarding matters most.
- Shallow AI adoption: 35% of UK firms with 10+ staff use AI (ONS, June 2026) but only 10% of
  adopters use it extensively; DSIT found 86–90% of hotel/catering, retail and transport firms
  neither use nor plan to use AI → sell the log and the board, not "AI".
- WhatsApp pricing keeps changing.
- 2027 rules not final (consultation closed 25 August 2026; a 2025 amendment proposed limiting
  compensation to under 48 hours' notice).
- Solo founder capacity during working hours.

## Sources

- IBISWorld, Private Security Services in the UK (2026): https://www.ibisworld.com/united-kingdom/industry/private-security-services/5068/
- SIA approved contractors (GOV.UK): https://www.gov.uk/government/publications/details-of-companies-within-the-sias-approved-contractor-scheme/details-of-companies-within-the-sias-approved-contractor-scheme
- Work Foundation, 1.24m zero-hours: https://www.lancaster.ac.uk/work-foundation/news/record-124-million-people-on-zero-hours-contracts-as-workers-report-work-life-chaos
- TUC, zero-hours: https://www.tuc.org.uk/news/exploitative-zero-hours-contracts-are-endemic-tuc-says
- GQR for TUC: https://www.gqrr.com/news/tuc-abusive-use-of-zero-hours-contracts-is-increasing/
- METR 2025 AI productivity trial: https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- Deputy AI launch: https://news.deputy.com/deputy-launches-new-ai-platform-on-aws-to-transform-how-businesses-manage-shift-work-ef9g8q
- Indeed Flex help: https://indeedflex.co.uk/jobseeker-help/
- Meta Business Agent (TechCrunch): https://techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/
- Meta WhatsApp pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- Make UK, shift notices: https://www.makeuk.org/insights/publications/zero-hours-contracts-and-shift-notices-employment-rights-act-spotlight-series
- 1st Formations, zero-hours rules: https://www.1stformations.co.uk/blog/zero-hours-contracts-new-rules/
- Policy Pros, 2027 guide: https://www.policypros.co.uk/zero-hours-contracts-january-2027-employer-guide/
- Shoosmiths, zero-hours: https://www.shoosmiths.com/perspectives/stories/articles/zero-hour-contracts-a-new-era
- ICAEW, Companies House fees: https://www.icaew.com/insights/viewpoints-on-the-news/2025/nov-2025/significant-hikes-to-companies-house-fees-in-2026
- Claude API pricing (Anthropic): https://platform.claude.com/docs/en/about-claude/pricing
- Twilio UK SMS: https://textbee.dev/sms-pricing/twilio/gb and https://puresms.uk/compare/twilio
- Deputy UK pricing: https://www.deputy.com/gb/pricing
- Planday pricing: https://www.planday.com/pricing
- RotaCloud pricing: https://rotacloud.com/pricing/
- Parim pricing: https://www.parim.co/pricing
- Liveforce pricing: https://liveforce.co/pricing-event-staffing-software/
- Guardhouse pricing: https://www.guardhousehq.com/pricing
- TacDesk: https://tacdesk.co.uk/blog/security-guard-scheduling-software-uk
- SaaS churn: https://www.kalungi.com/blog/saas-churn-rate-benchmarks and https://optif.ai/learn/questions/b2b-saas-churn-rate-benchmark/
- ONS AI adoption summary: https://theaiconsultancy.ai/blog/ons-uk-business-ai-adoption-2026
- Smartphone ownership: https://www.uswitch.com/mobiles/studies/mobile-statistics/
