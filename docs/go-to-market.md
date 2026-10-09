# Go-to-market

Goal right now: **one paid pilot**, not £1,000 a month. Talk before you build.

## Warm network

| Company | What they do | Role for us |
|---|---|---|
| **CSP — The Combined Services Provider** (Watford) — your employer | Car parking, traffic management, HVM, security and stewarding at stadia, racecourses, shopping centres and major events. SIA approved contractor; joined the ACS Pacesetters (top 15% of ACS scores) in 2024. Acquired by Norland Equity Partners in 2023. | **First pilot.** You already know the numbers (60+ emails/day, 40% unanswered). "Our own firm uses it" is the best reference for other event firms. |
| **Teamforce Labour** (Borehamwood) — ex-employer | Family-run labour supplier to construction, civils, rail/safety-critical, power & utilities, tunnelling. 21–50 staff. Has a Director of Digital Strategy & Compliance. Rail roles need CSCS, PTS and a recent drugs and alcohol test. | **Second sector (rail/civils).** Small, family-run, credential-heavy. |
| **Coyle Personnel / Coyle Rail** (Harrow HQ) — ex-employer | Recruitment since 1988, multi-sector; Coyle Rail works in safety-critical rail with PTS-qualified staff. Much bigger. | **Later**, once you have references. |
| **Careys** (Wembley) — your mum is Head of Talent and Acquisitions | Family-owned civils/construction group, £400m+ turnover, 800+ staff in the main business. | **Insight and introductions**, not a buyer: how a big contractor judges labour suppliers, and which agencies they use. |

Evidence the pain exists in rail too: a rail recruiter advertised a coordinator whose job is
scheduling workers, booking accommodation, chasing orders and payroll — the work this product takes on.

## CSP: how to do it cleanly

- Tell them upfront it's your own side project, built on your own time.
- Build and demo on **fake data only** until an agreement is signed.
- Written agreement before any real data:
  - [ ] You own the software; CSP gets a licence to use it
  - [ ] Price (pilot £299, then the plan) and term (monthly rolling)
  - [ ] Data processing agreement (CSP controller, you processor)
  - [ ] No exclusivity (you can sell to other firms), or a short, paid exclusivity if they insist
  - [ ] Permission to name them as a reference if the pilot succeeds
- Don't pitch CSP's own clients or use CSP data for anything else.

## Target list (first 30 firms)

**Who:** event security, stewarding and crowd management firms with 20–500 casuals, running on
spreadsheets + WhatsApp. Football stewarding first (season runs to May).

**Where to find them:** SIA Approved Contractor register, ESSA member directory, UKCMA members,
BSIA directory, LinkedIn, people you've worked alongside (event security subcontracts heavily).

**Qualifying question on every call:** "What do you use to plan your rota?"
If Deputy, Parim, Timegate or Guardhouse → thank them and move on.

## Discovery call script (15–20 minutes)

Ask, don't pitch. Write down numbers.

1. "Walk me through what happens when someone cancels a shift at 6am."
2. "How do staff usually contact you: call, text, WhatsApp or email?" ← decides what we build first
3. "Roughly how many staff emails and calls a day? And on your busiest week?"
4. "How many of those get answered the same day?" (share your 40% if they hesitate)
5. "What do you do in peak weeks: overtime, temps, extra resourcer?"
6. "Who handles pay queries? What happens when a rate isn't updated?"
7. "How do you check licences are in date before someone works?"
8. "Have you looked at the 2027 notice and cancellation-pay rules yet?"
9. "If this worked, how would you judge it after a month?"
10. "Would you pay £299 for a one-month pilot if it did what we've discussed?"

Aim: 10 calls → 2 verbal yeses (Gate A).

## The pilot offer

- **£299 for the first month, paid before go-live.**
- Week 0: record the baseline (emails, calls, unanswered messages, time to refill a cancellation;
  one normal week, and a busy week if possible).
- Weeks 1–4: portal + urgent board + shifts line + resourcer dashboard + notice report.
- Success: unanswered shift queries near 0%; measurable resourcer time saved; 50%+ of active
  workers used the portal.
- Then: ~£3 per active worker per month (£199 minimum), monthly rolling.

## Pilot onboarding checklist

How to do each step, in order, is in `docs/runbooks.md` ("Onboarding a pilot firm"); `npm run -s
firm:check -- --firm <slug>` shows where a firm is.

- [ ] Agreement + DPA signed
- [ ] Firm branding (logo, colour, name) and sign-off wording
- [ ] Rota source connected (Google Sheet shared with our service account, or native)
- [ ] Workers + credentials imported from CSV
- [ ] Credential rules set per role
- [ ] Settings agreed: urgent window, wave size, escalation time, quiet hours, allocation mode
- [ ] Twilio number live; WhatsApp display name approved (start early — can take days)
- [ ] Privacy notice line added by the firm (see compliance)
- [ ] Staff briefing message sent from the firm with the portal link
- [ ] Dry-run event day with the resourcer
- [ ] Baseline numbers recorded

## Objections and answers

| They say | You say |
|---|---|
| "We already use an app." | (If Deputy/Parim etc.) "Then you're sorted — thanks for your time." |
| "AI will tell staff the wrong thing." | "It doesn't decide anything. Shifts, licences and pay come straight from your data. It only sorts messages." |
| "You're one person." | "Month-to-month, your data exportable any time, and if it goes down calls forward straight to your phone." |
| "GDPR?" | "Hosted in London, DPA signed, you control the data, retention limits built in." |
| "Too expensive." | "What does a peak week cost you in overtime or a temp resourcer? And from 2027, what does a short-notice cancellation claim cost?" |
| "Staff won't use it." | "They don't have to change anything. They message the same number and get an instant reply with a link. Most switch within weeks." |

## Your mum (Careys) — 20-minute chat

- How does Careys manage agency labour day to day?
- What do they expect from labour suppliers on compliance and attendance evidence?
- Which agencies do they use, and would any be open to a chat?
- Would contractors value a report showing licensed, notified, on-time staff from suppliers?

## Sources (company facts)

- CSP website: https://gotocsp.com/
- CSP joins ACS Pacesetters: https://www.acspacesetters.co.uk/the-latest-company-to-join-the-acs-pacesetters-csp-the-combined-services-provider/
- CSP acquired by NEP: https://www.transportxtra.com/publications/new-transit/news/74600/event-parking-company-csp-acquired-by-nep/
- Teamforce Labour profile: https://prospeo.io/c/teamforce-labour-limited
- Teamforce rail role requirements: https://findajob.dwp.gov.uk/details/17583547
- Coyle Rail: https://www.railstaff.co.uk/2012/02/16/candidates-for-coyle-rail/
- Coyle Personnel: https://www.harrowtowncentre.co.uk/?p=2917
- Careys (Glenigan): https://insights.dev.glenigan.com/?p=904
- Rail coordinator role example: https://findajob.dwp.gov.uk/details/18118622
