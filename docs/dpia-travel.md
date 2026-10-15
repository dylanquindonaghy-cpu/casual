# DPIA: the casual's travel area

A data protection impact assessment (DPIA) for ShiftDesk's travel area (Phase 12, task 12G.1;
`docs/office-v2.md` 4.6, 5.4, 6.3; `PLAN.md` Data 21). It is a draft written by the build, not legal
advice. It includes the legitimate-interests balancing test. Both must be reviewed and signed
before the travel area is switched on for a real firm's casuals: the ICO lists processing employees'
location data as likely to be high risk
(https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/examples-of-processing-likely-to-result-in-high-risk/),
and a DPIA has to come before the processing starts.

Part 1 is about how ShiftDesk builds the travel area, and is the same for every firm. Part 2 is a
template each firm fills in for itself, because the firm is the controller of its casuals' data and
ShiftDesk is its processor.

No real firm uses ShiftDesk yet (the pilot hasn't started), so the only data is made up (`ZZ`
postcodes, golden rule 7). Today the server runs with `TRAVEL_PROVIDER=fake`, which knows only the
made-up postcodes and sends nothing anywhere. **Before the travel area is used for a real firm:**
this DPIA and its balancing test reviewed and signed by Dylan, the firm's own Part 2 filled in and
signed, the privacy notice updated (`docs/office-v2.md` 6.3), postcodes.io and TravelTime listed as
sub-processors with their terms checked (`PLAN.md` Legal 2, Checks 14), and "Connect postcodes.io
and TravelTime" in the Parking lot done.

## Part 1: what ShiftDesk does

### What is processed, and why

- **What the casual gives:** on Profile's "Where you work" (`/profile/travel`), a start-from
  postcode (it can differ from home), how they travel (car, public transport or both) and how long
  they'll travel (30, 45, 60 or 90 minutes). Nothing is filled in for them: no area is the default.
- **What is stored** (`worker_travel`, one row per casual): the postcode, its central point (the
  middle of the postcode area, from postcodes.io: never a house number, never GPS, never movement
  history), the ways of travelling, the time limit, when it was saved, and which wording of the
  page's privacy line they saw.
- **Purpose:** to show each casual the shifts they can get to, and to offer them those (built in
  12G.2 and 12G.3: travel times, then the filter). It helps the casual (no offers they can't reach)
  and the firm (fewer late withdrawals).
- **Not used for:** tracking where a casual is, ranking casuals against each other, or any
  decision about pay, strikes or eligibility. A casual without an area sees everything, and the
  office may still offer them anything by hand (D2).

### How it's looked up

- **postcodes.io** (https://postcodes.io/docs/overview/), free and keyless, turns the postcode
  into its central point when it's saved. **Only the postcode is sent**: one request for that
  postcode, with nothing about who it belongs to (tested: `tests/unit/travel.geocoder.test.ts`).
- The answer is checked before it's used. A postcode it doesn't know is refused with words saying
  so, and nothing is saved. A look-up that fails saves nothing either.
- **TravelTime** (12G.2, built) gets the site's point and each start point under a meaningless
  id ("o1", "o2"), never a postcode, a name or a database id (tested:
  `tests/unit/travel.provider.test.ts`). Only the worker calls it; no page does (tested:
  `tests/unit/travel.boundary.test.ts`).
- Northern Ireland (BT) postcode data needs a separate licence (`PLAN.md` Checks 16).

### Lawful basis: legitimate interests (the balancing test)

Consent isn't the right basis: the ICO says it's rarely appropriate between an employer and a
worker, because of the power imbalance
(https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/when-is-consent-appropriate/).
The basis is legitimate interests (UK GDPR Article 6(1)(f)), which needs this three-part test.

1. **Purpose test (is there a legitimate interest?).** Yes. The firm needs to offer shifts to
   casuals who can get there, and to cut late withdrawals. Casuals benefit too: fewer offers they
   can't take, and travel times shown on each shift. (Brigad saw late withdrawals fall from 6% to 2%
   with travel times: https://traveltime.com/case-study/brigad-case-study.)
2. **Necessity test (is this data needed for it?).** Yes, and no more than needed. Showing whether
   a shift is reachable needs a start point. A postcode's central point is the least precise point
   that still gives a useful travel time: no address, no GPS, no history. The casual chooses the
   postcode, which needn't be home. The office never needs the full postcode, so it sees only the
   district.
3. **Balancing test (do the casual's interests override it?).** No, with these safeguards:
   - it's optional, and removable by the casual at any time ("Remove my travel area");
   - nothing happens to a casual without one: they see every shift;
   - the office sees only the district ("ZZ1"), and replies say "from your home area", because the
     office sees replies word for word;
   - it's never in the action log (append-only and never purged): `travel.profile_changed` names
     which settings changed and the time limit only;
   - it's deleted when the office makes the casual inactive as "They've left" and when they're
     erased; it's in their own data export;
   - each firm's rows are separated by row-level security (tested).

   A casual could reasonably expect their employer to use a postcode they gave for travel to
   shifts. The data is not special category. The main risk (the office learning roughly where a
   casual lives) is limited to the district, which is about the area a casual would mention in
   conversation.

### How long

- While the casual keeps it. It's deleted when they remove it, when the office makes them
  inactive with the reason "They've left" (`DEACTIVATE_REASONS.left`,
  `src/lib/office/worker-reasons.ts`), and when they're erased (`src/lib/gdpr/worker-erase.ts`).
  Made inactive for another reason (a pause), it's kept for when they come back.
- **A gap, parked:** "They've left" can only be chosen for an active casual. One a rota sheet or a
  staff file already made inactive, or one who is blocked, keeps their area until the office
  erases them, with no time limit yet. Before a real firm: either let the office mark an inactive
  casual as "They've left", or have the nightly retention job delete the areas of casuals inactive
  for a set time (`PLAN.md` Parking lot). Until then, the firm's offboarding of a leaver should
  include erasing them when they ask, or removing the area.
- The log entries (`travel.profile_changed`, `travel.profile_removed`) hold no postcode or point.
  One entry holds travel minutes (12D.2): when the shifts line answers a casual's "shifts", its
  `enquiry.checks` entry keeps their limit in minutes and the minutes by car and by public
  transport to each session the reply offered, so the office can see why each was offered
  ("Inside travel area (20 min by car, limit 45 min)" on the message's Enquiries page). Never the
  postcode or the point. Minutes to a known site can still hint at roughly where someone lives,
  so this is treated as personal data: the office sees it only on that page and in the action
  log, and it stays as long as the action log (12 months once the log is purged: `PLAN.md`
  Parking lot). Dylan to confirm this when signing this DPIA.
- Travel estimates (12G.2, `travel_estimates`) are keyed by postcode, not by person: everyone
  starting from a postcode shares them. They name no one, but a postcode only one casual uses still
  points to them, so they're treated as personal data: the office never sees their postcodes,
  they're never logged, and they're kept only as long as needed. They're deleted 7 days after the
  last session they were for (the retention purge, even during a hold: they're worked out, never
  evidence), and when a site's postcode changes. Erasing a casual doesn't delete them at once (one
  row can be several casuals'), but nothing new is worked out from a postcode nobody uses, and the
  old ones expire as above. They're left out of the firm's data export, because they hold full
  start postcodes, which the office never sees.

### Who can see it

- The casual: their own postcode, ways of travelling and limit, on Profile.
- The firm's admins and resourcers: the district, the limit and the ways of travelling, on the
  casual's page (`/office/workers/[id]`); later on the Casuals page (12H). The firm's "Download all
  your data" has the district only too (`FIRM_EXPORT_CUT`, `src/lib/gdpr/firm-export.ts`; tested).
- An admin who downloads one casual's own data for a subject access request (logged
  `worker.data_exported`) sees that casual's full postcode and its point: it's the casual's data,
  for the casual.
- Payroll: nothing. Another firm: nothing.
- postcodes.io: the postcode alone, when it's saved. TravelTime (12G.2): coordinates and
  meaningless ids.

### Risks and what reduces them

| Risk to the casual | How likely, how bad | What ShiftDesk does |
|---|---|---|
| The office learns where they live | Possible, moderate | They choose the postcode (needn't be home); the office sees the district only; no house number, GPS or history |
| It's used to judge or rank them | Unlikely, moderate | Never used for pay, strikes or eligibility; no ranking; the office may still offer anything by hand |
| They miss offers because of a wrong postcode or a limit set too low | Possible, minor | They see their own setting on Profile and can change or remove it; an unknown distance is shown and still offered (D2, 12G.3) |
| Their postcode leaks through the log | Unlikely, moderate | Never logged (the log check refuses a field named "postcode"; tested) |
| A look-up service learns who they are | Unlikely, minor | Only the postcode is sent (tested); TravelTime gets coordinates and meaningless ids |
| Kept after they leave | Possible, minor | Deleted on "They've left" and on erasure (tested). A casual already made inactive by a sheet or file, or blocked, keeps it until erased (parked: see "How long") |
| The office sees the full postcode in a download | Unlikely, moderate | The firm's export has the district only (tested); only a casual's own subject access export has more |

### Sign-off

| | |
|---|---|
| Reviewed by | Dylan (not yet) |
| Date | |
| Outcome | Go / changes needed |

## Part 2: template for a firm

Fill this in before your casuals' travel areas are used. Keep it with your own records.

1. **Your firm:** name, who is responsible for data protection.
2. **Your casuals:** roughly how many; whether they're employees, workers or agency workers (ask
   your adviser: it changes which rules apply).
3. **Your setting:** the default time limit (`travel.default_max_minutes`, 45 minutes unless you
   choose 30, 60 or 90). If you change it, say why.
4. **Your lawful basis:** legitimate interests. Record your own balancing test, using Part 1's as
   a start: your interest (offering shifts casuals can reach), why the postcode is needed for it,
   and why it doesn't override your casuals' interests (optional, removable, district only, never
   used to judge them).
5. **Who in your firm sees it:** name the roles (admins and resourcers see the district only).
6. **How you tell your casuals:** your privacy notice says what the travel area is for, who sees
   what, that only the postcode is sent to postcodes.io, and how to remove it.
7. **Northern Ireland:** if any casual uses a BT postcode, check the licence first (`PLAN.md`
   Checks 16).
8. **Sign-off:** name, role, date, and when you'll review this (at least once a year).
