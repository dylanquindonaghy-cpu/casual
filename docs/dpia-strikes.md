# DPIA: strikes for late cancellations

A data protection impact assessment (DPIA) for ShiftDesk's strikes (Phase 12, task 12C.1;
`docs/office-v2.md` 3.5, 6.2, 6.3). It is a draft written by the build, not legal advice. It must
be reviewed and signed before strikes are used for a real firm's casuals, because a system that
scores and flags workers is the kind of worker monitoring the ICO lists as likely to be high risk
(https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/examples-of-processing-likely-to-result-in-high-risk/).

Part 1 is about how ShiftDesk builds strikes, and is the same for every firm. Part 2 is a template
each firm fills in for itself, because the firm is the controller of its casuals' data and
ShiftDesk is its processor.

Today strikes run for every firm on ShiftDesk: there's no per-firm switch. No real firm uses
ShiftDesk yet (the pilot hasn't started), so the only data is made up. **Before the first real firm
starts:** this DPIA reviewed and signed by Dylan, the firm's own Part 2 filled in and signed, the
privacy notice updated (`docs/office-v2.md` 6.3), and the solicitor's questions in
`docs/office-v2.md` 6.4 answered.

## Part 1: what ShiftDesk does

### What is processed, and why

- **When:** a casual cancels a booking themselves in the app.
- **What decides:** plain code, never AI (golden rule 1): `strikeDecision()` in
  `src/lib/strikes/decide.ts`. There is a strike only when all of these are true:
  - the casual cancelled it themselves (never when the office, the planner or the rota sheet did);
  - they gave less notice than the firm's `strikes.notice_hours` (48 by default), measured when
    they cancelled;
  - they booked it themselves in ShiftDesk (not placed by the office, and not over a rest or hours
    rule);
  - the office or the planner hasn't moved it or changed its times, role, site or pay since.
- **What is stored, only for a strike issued** (the `strikes` table): who, which booking and
  session, the notice given and the threshold, when it was issued and until when it counts, live
  or withdrawn, and a "needs a person to review" flag.
  - **Withdrawn (12C.5):** who withdrew it, when, and their reason (1–500 characters typed by a
    person in the office). The reason is on screen to admins and resourcers only (the record page),
    never in the log, the PDF, the CSV or the evidence email. Erasing the casual clears it; who and
    when stay. It is in the casual's own data export (`src/lib/gdpr/worker-export.ts`), because a
    subject access request covers what the firm wrote about them: the firm can hold part of it
    back only if an exemption applies.
  - **Kept after a review (12C.5):** who and when. "Keep strike" works on any live strike not yet
    reviewed, not only a flagged one, so its `strike.reviewed` log entry (ids only) doesn't show
    which strikes were flagged.
- **Health and caring:** when the reason was "I'm unwell" or "Family or caring", the strike is
  flagged for a person to review, and the flag's reason is stored on the strike row only.
  - "I'm unwell" is health data, a special category (UK GDPR Article 9).
  - It is never written to the action log, which keeps only ids, codes and hours.
  - It is visible on screen to the firm's admins and resourcers only, never to payroll.
- **What the casual is told:** before confirming, the cancel screen says whether cancelling now
  gives them a strike, and how many they have in the last 90 days. The wording's version and the
  time they confirmed are stored on the booking (S3). The done screen says whether a strike was
  recorded and until when, and offers "Tell us what happened", which goes to the office.
- **Purpose:** a fair, recorded way for the firm to see who cancels at short notice, so a person
  can talk to them. Nothing happens automatically: no fine, no pay deduction, no block on taking
  shifts. Pausing someone's work goes through the existing "make inactive" control, which needs a
  reason from a person and is logged.

### How long

- A strike counts for 90 days (`strikes.live_days`).
- Its row is deleted 12 months after it was issued (`strikes.keep_months`), by the nightly purge
  (`app_purge_old_strikes()`), but never while the firm has a retention hold for a dispute. A firm
  may keep strikes longer, never shorter than the time a strike counts plus 6 months (the 6-month
  tribunal time limit): `firm:settings` refuses a shorter one, and the purge itself never deletes
  a strike that stopped counting less than 6 months ago.
- The `strike.issued`, `strike.withdrawn` and `strike.reviewed` log entries (ids, codes and hours,
  no reason and no review flag) stay as long as the action log, which isn't purged yet (`PLAN.md`
  Data 2). The privacy notice and the help page must say so.
- The office's reason for withdrawing a strike goes with the strike's row (12 months), or sooner
  when the casual is erased.

### Who can see it

- The casual: on the cancel screen now, and on Profile (12C.5).
- The firm's admins and resourcers, in the office.
- The firm's strikes team by email, only once a confirmed address is set (12C.4).
- The firm's own planner by webhook, if the firm connects one (S11).
- Never payroll, and never another firm (each firm's rows are separated by row-level security and
  tested).

### Necessity and proportionality

- **Minimal data:** only an issued strike gets a row. The reason text stays on the booking, as
  before, and never leaves ShiftDesk: everything that leaves shows "Casual's own reason (see
  ShiftDesk)".
- **Exemptions protect the casual:** no strike when the office booked or changed the shift, which
  follows the future protection against detriment (ss.47H and 47I, Employment Rights Act 2025).
  No strike for refusing to break the rest rules either (s.45A ERA 1996).
- **A person decides:** a strike is a record that may lead to a conversation, never an automatic
  penalty. This fits the automated decision-making safeguards (information, the right to respond,
  human intervention, the right to challenge) and Acas's advice that review points shouldn't
  trigger action on their own (https://www.acas.org.uk/absence-trigger-points).
- **Strikes never touch pay:** s.13 ERA 1996 and the Conduct Regulations reg 12.

### Risks and what reduces them

| Risk to the casual | How likely, how bad | What ShiftDesk does |
|---|---|---|
| Treated worse for being ill or caring for someone (Equality Act 2010) | Possible, serious | Flagged for a person to review; the reason shown to admins and resourcers only; the office can withdraw the strike (12C.5); no automatic consequence |
| The log hints at a health or caring reason: offices will mostly use "Keep strike" on flagged strikes, so a `strike.reviewed` entry (ids only) suggests one, and the log outlives the strike's row | Possible, minor | "Keep strike" works on any live strike, so the entry never says it was flagged; the log is for admins and resourcers only, who see the flag on the record while the row exists; the log's purge (`PLAN.md` Data 2) should take a strike's `strike.*` entries with its row (Parking lot) |
| A strike they didn't deserve (a mis-tap, a train strike, the office's fault) | Likely now and then, moderate | The warning before confirming; exemptions for office bookings and changes; "Tell us what happened"; the office withdraws it, keeping who, when and why |
| Strikes used as a hidden blacklist | Possible, serious | Counts only 90 days; deleted at 12 months; visible to the casual; no menu badge or score; nothing automatic |
| Health details leaking (emails, files, the planner) | Possible, serious | The reason never in the log (tested now); one neutral reason for everything that leaves, with tests that "unwell" and "health" never appear in the CSV, the PDF or the email (built with them: 12C.3, 12C.4) |
| Another firm seeing it | Unlikely, serious | Row-level security per firm, with tests for every table |
| Kept too long | Possible, moderate | The nightly purge at 12 months, tested; the log entry holds no reason |

### Sign-off (ShiftDesk)

| | |
|---|---|
| Reviewed by | Dylan (not yet) |
| Date | |
| Outcome | Go / changes needed |

## Part 2: template for a firm

Fill this in before your casuals' strikes are recorded. Keep it with your own records.

1. **Your firm:** name, who is responsible for data protection.
2. **Your casuals:** roughly how many; whether they're employees, workers or agency workers (ask
   your adviser: it changes which rules apply).
3. **Your settings:** notice threshold (default 48 hours), how long a strike counts (90 days), how
   long the record is kept (12 months). If you change any, say why.
4. **Your lawful basis:** usually legitimate interests (running a reliable rota). Record your
   balancing test: your interest, why strikes are needed for it, and why it doesn't override your
   casuals' interests (the exemptions, no automatic penalty, the right to explain).
5. **Health data:** "I'm unwell" is special category data. Record your Article 9 condition
   (usually employment law obligations, with an appropriate policy document).
6. **Who in your firm sees strikes:** name the roles. Payroll never does in ShiftDesk.
7. **What you do after a strike:** who decides, how the casual is heard, and that nothing happens
   automatically.
8. **How you tell your casuals:** your privacy notice and your terms say that late cancellations
   are recorded, how long, and how to explain or challenge one.
9. **Your strikes team's email:** who receives the records, and that the address is confirmed.
10. **Sign-off:** name, role, date, and when you'll review this (at least once a year, and when the
    2027 rules come in).
