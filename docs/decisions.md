# Decisions (ADRs)

Short records of why things are the way they are. Add new ones at the bottom.
Status: Accepted unless noted. Date: September 2026. Decider: Dylan.

---

## ADR-001: One cloud system for all firms, sold as a subscription (not a local install)

**Context:** Idea of selling firms a licence to run it on their own PC/server.
**Decision:** Multi-tenant SaaS on our servers, sold as a subscription under a written licence
agreement + DPA.
**Options:**
- Multi-tenant SaaS — cheapest, one deploy, fix bugs once. ✅
- Single-tenant per firm — later, for big firms who pay for it (setup fee + ~£150+/month).
- Local install — fails: cancellations arrive at 5am when office PCs are off; webhooks need a
  public address; updates on every PC; backups and breaches become our problem; no rota
  competitor sells on-premise.
**Revisit when:** a 300+ staff firm asks for its own tenant.

## ADR-002: AWS London — Lightsail + managed Postgres + pg-boss + Bedrock + SES

**Context:** Want fewest sign-ups, UK data residency, low cost, low ops.
**Decision:** One AWS account (eu-west-2). Lightsail 4 GB (~$24) + managed Postgres (~$15) ≈
£29/month. Jobs and timers in pg-boss (Postgres). Claude via Bedrock EU profile. SES for email.
**Options considered:**
| Option | Verdict |
|---|---|
| Lightsail + Postgres (chosen) | Fixed monthly bill, UK region, one vendor for hosting/AI/email |
| AWS serverless (Lambda, SQS, Step Functions) | Great later; too much wiring for evenings now |
| Supabase + Vercel + Inngest | Easy, but 3 vendors and AI still separate |
| Hetzner VPS | No UK region; prices rose twice in 2026 |
| Cloudflare Workers + D1 | EU not UK; SQLite; rewrite |
**Consequences:** we run Docker ourselves on one box; single server is a risk on event mornings
(mitigated by Twilio fallback). **Revisit when:** 5+ paying firms.

## ADR-003: Twilio for numbers, SMS and WhatsApp; WhatsApp first, SMS fallback

**Context:** Staff live on WhatsApp. SMS costs ~4p each in the UK.
**Decision:** Twilio (one account covers UK numbers, SMS, WhatsApp, voice; ElevenLabs imports
Twilio numbers natively). Order: web push → WhatsApp → SMS.
**Consequences:** Meta business verification per firm; approved templates for offers and login
links; service messages beyond 1,000 per number per month are charged from 1 October 2026.
**Revisit when:** SMS volume makes Telnyx worth a look.

## ADR-004: Call-to-text by default; AI voice as a paid add-on

**Context:** ~10 calls a day per firm. An AI voice agent costs ~£30/month per firm at that volume
but adds complexity.
**Decision:** Default: short recorded message + instant WhatsApp/SMS link. AI phone line
(existing ElevenLabs agent) is a £149/month add-on in Stage 2.
**Consequences:** cuts calls instead of just answering them; pushes staff to the portal.

## ADR-005: AI reads, code decides

**Context:** Accuracy, liability, trust (only ~10% of UK AI-using firms use it heavily; many
sectors distrust AI).
**Decision:** Eligibility, credentials, assignments and pay facts are plain code over firm data.
AI only classifies text, drafts and summarises, with validated outputs and an office fallback.
**Consequences:** cheaper and more accurate; the pitch leads with the log and the shift board,
not "AI".

## ADR-006: Web portal via WhatsApp link, not a native app (yet)

**Context:** App fatigue; staff juggle several agency apps; smartphone ownership is high
but lower among over-65s.
**Decision:** Mobile-first web portal (installable), login by link on WhatsApp/SMS.
**Consequences:** iPhone push only after "add to home screen"; WhatsApp covers urgent alerts.
**Revisit when:** geofencing (Stage 3) needs a native app (Flutter).

## ADR-007: Price per active worker, with a floor

**Context:** Flat £599 overcharges small firms; a cut of payroll is unverifiable and feels like
a tax; security margins are tight.
**Decision (hypothesis to test in discovery):** £299 paid pilot month; then ~£3 per active
worker per month (anyone who worked a shift that month), £199 minimum. Add-ons: AI phone line
£149/month. Annual: 2 months free. Monthly rolling.
**Consequences:** revenue rises in busy season automatically; small firms can start cheaply.
**Revisit when:** after 10 discovery calls and the first pilot.

## ADR-008: Target firms without Deputy/Parim; native rota mode

**Context:** Firms on Deputy, Parim, Timegate or Guardhouse already have staff apps; Deputy
launched its own AI in November 2025.
**Decision:** Target spreadsheet/WhatsApp firms. Ask "what do you use to plan your rota?" on
the first call and move on politely if it's one of those. Offer native mode for firms with nothing.
**Consequences:** no Deputy/Parim plugs planned.

## ADR-009: Sell one sector at a time; credentials are generic

**Context:** Rail, civils, construction and cleaning have the same pain.
**Decision:** Sell events/security first (credibility, CSP pilot). Rules engine treats
credentials as data per sector (SIA, PTS, Sentinel, CSCS, DBS). Next sector: rail/civils via
Teamforce and Coyle contacts.
**Consequences:** references stay sector-specific; product stays reusable.

## ADR-010: AI disclosure — no banners, no fake names, legal minimum met

**Context:** Want replies to feel like the firm, without announcing AI everywhere.
**Decision:** Replies signed "[Firm] Shift Team". Never a fake human name. The firm knows (it's
the controller and signs the DPA listing sub-processors). Staff: one line in the firm's privacy
notice about automated handling. Anyone significantly affected by an automated decision can ask
for a human. Pay disputes always go to a person.
**Consequences:** low friction, no deception, compliant.
