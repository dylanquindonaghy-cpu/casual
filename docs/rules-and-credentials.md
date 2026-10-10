# Rules engine and credentials

Pure functions in `src/lib/rules/`. No database access inside the rules — callers load data,
rules decide. This makes them easy to test in tables. The loader is
`loadEligibilityInput()` (`src/lib/roster/eligibility-input.ts`): the role's credential rule (none:
`null`), the session's extra requirements (`shifts.required_credentials`, 12B.1), the worker's credentials, their `confirmed` and `completed` bookings on shifts that aren't
cancelled from 8 days before to 8 days after the shift (never the shift itself), credential names
and `applied_allowed` types from `credential_types`, the day's deployed and applied counts (others
booked on shifts starting that local day; "applied" = working on an application in progress for a
type their role or that session needs), and the settings below from `firms.settings`. Availability (the worker's
days off) and blocked sites are loaded too (checks 8 and 9). A pass (`EligibilityPass`) is single-use and names one
worker and one shift; roster plugs refuse to book without it (`consumeEligibilityPass()`).

Settings keys (`firms.settings`, defaults in brackets): `min_rest_hours` (11),
`weekly_hours_cap` (48), `travel_buffer_minutes` (0), `credential_applied_allowance_pct` (0). A
value that makes no sense fails the booking rather than loosening a rule. Nothing can change these
yet (`npm run firm:settings` doesn't offer them, and there's no settings screen), so every firm runs
on the defaults; only the demo seed sets others (PLAN.md, "Decisions waiting for Dylan").

## Function shape

`checkEligibility(input)` in `src/lib/rules/eligibility.ts`:

```ts
type EligibilityInput = {
  now: Date;                            // passed in: the rules never read a clock
  timeZone: string;                     // the firm's: dates and weeks are local (Europe/London)
  worker: { id: string; status: 'active' | 'inactive' | 'blocked'; roles: string[] };
  credentials: { type: string; status: 'valid' | 'expired' | 'applied' | 'suspended';
                 expiresOn: string | null }[];            // yyyy-mm-dd; null = no expiry
  shift: { id: string; role: string; startsAt: Date; endsAt: Date; siteId: string | null;
           requiredTypes: string[] | null;               // from credential_rules; null = no rule
           extraTypes: string[] };                        // the session's extra requirements ([] for none)
  otherAssignments: { startsAt: Date; endsAt: Date }[];  // confirmed, same week ± a day
  unavailableDates: string[];           // firm-local yyyy-mm-dd, from worker_unavailable_days (the profile page)
  settings: {
    minRestHours: number;               // default 11
    weeklyHoursCap: number;             // default 48 (firm may set lower)
    travelBufferMinutes: number;        // default 0
    appliedAllowancePct: number;        // e.g. 15 (SIA ACS), else 0
    appliedAllowedTypes: string[];      // types where "applied" may count (credential_types.applied_allowed)
    appliedInUseCount: number;          // how many "applied" workers are already deployed that day
    deployedCount: number;              // total deployed that day (for the % check)
    blockedSites: string[];
  };
  names?: Record<string, string>;       // credential type -> the name workers know it by
  overrides?: ('started' | 'rest' | 'weekly_hours' | 'unavailable')[];  // office only, logged
};
// Input that doesn't make sense (a NaN setting, a date not written yyyy-mm-dd, a shift or booking
// that ends before it starts, an unknown time zone, an override of anything else) throws: it can
// never let a worker through. appliedInUseCount and deployedCount must not count this worker.

type EligibilityResult = {
  ok: boolean;
  reasons: string[];                    // plain English, in check order
  codes: RuleCode[];                    // one per reason ('credential_expired', 'overlap', ...)
  overridden: ('started' | 'rest' | 'weekly_hours' | 'unavailable')[];
  checks: RuleCheck[];                  // every check it ran, passed or not, with its figures (12D.2)
  pass?: EligibilityPass;               // only when ok; isEligibilityPass() tells a real one
};

type RuleCheck = {
  code: CheckCode;                      // see "Checks made by code" below
  passed: boolean;
  detail: Record<string, string | number | boolean | null | string[]>;
};
```

## Checks, in order (stop at first hard fail, but collect all reasons for the UI)

| # | Check | Reason shown to worker |
|---|---|---|
| 0 | The shift hasn't started (`startsAt > now`) | "This shift has already started." |
| 1 | Worker status is `active` | "Your account isn't active. Contact the office." |
| 2 | Role match (worker.roles includes shift.role) | "This shift needs a [role]." |
| 3 | Each required credential present, `valid`, and `expiresOn >= shift date`. The required list comes from the firm's `credential_rules` row for the shift's role, plus the session's own extra requirements (`shifts.required_credentials`: CSAS, first aid… set on the session, 12B.3), each checked exactly like the role's, valid until the session ends; **no row for the role means not eligible** (fail closed: a deleted or forgotten rule must never drop a licence check), whatever the session adds. A row with an empty list means the role needs no credential. | "Your SIA licence expired on 3 Oct. Renew it, then send the new number to the office." / no rule: "This shift isn't ready to take yet. Ask the office." |
| 4 | If credential is `applied`: allowed only if firm allowance > 0 and adding this worker keeps applied share ≤ allowance % | "Your licence is still being processed. The office can only deploy a limited number of staff in that position today." |
| 5 | No overlap with other assignments (± travel buffer) | "You're already booked at [time] that day." (or "on Fri 6 Nov" for another day) |
| 6 | Rest gap ≥ `minRestHours` from the previous and the next assignment | "This is too close to your previous shift (11 hours' rest needed)." / "...your next shift..." |
| 7 | Weekly hours (confirmed + this shift) ≤ cap, in **every** week the shift touches. A week is Monday 00:00 to Monday 00:00 local, so a Sunday-night shift is checked against both weeks (`src/lib/rules/eligibility.ts`); every booking counts only its hours inside each week, in real elapsed time | "This would take you over your weekly hours limit." |
| 8 | Not marked unavailable for any calendar day the shift touches (a night shift touches two) | "You've marked yourself unavailable that day. Change it in your profile to take this shift." |
| 9 | Site not in worker's blocked list (`worker_site_blocks`, set by the office on the worker's page: Phase 10) | "This site isn't available to you. Contact the office." |

**Not a check: the travel area** (12G.3; D2, Rules 14). A casual's travel area is a preference,
not a rule. It narrows what she sees (Open shifts, the urgent board, Home) and what offer waves send
her (`src/lib/travel/area.ts`), but the rules engine never reads it: a shift opened from a direct
link stays bookable, the office may offer or assign outside it, and an unknown distance is never a
reason to refuse.

Office users can **override** checks 6–8, and check 0 (booking a late replacement onto a shift
that has started), with a logged reason (`overrides`; the result lists what was overridden).
Checks 3–4 (credentials) and all the others can never be overridden in the app: asking to throws.

A credential counts only when its status is `valid` **and** its expiry is on or after **every**
local calendar day the shift touches (a night shift needs it in date until the morning), or it has
no expiry. A `suspended` credential of the type fails whatever else is held. An `expired` status
fails whatever the date, and a `valid` status with a past date is expired. An `applied` credential
is used only when there is no valid one of that type. Every required type gets its own reason:
missing: "This shift needs a valid [name]. Send it to the office to be checked."; suspended:
"Your [name] is suspended. Contact the office."; out of date before the shift ends: "Your [name]
expires on [date], before this shift. Renew it, then send the new number to the office." (or
"expired on [date]" once past); marked expired with no earlier date: "Your [name] is marked as
expired. Renew it, then send the new number to the office."; applied over the allowance: "Your
[name] is still being processed. Only a few people waiting for theirs can work each day, and
today's places are taken." A booking that clashes only because of the travel buffer: "This is too
close to your booking at [time] to travel between them."

## Checks made by code (what each check records, 12D.2)

`checkEligibility()` also returns `checks`: one entry for every check it ran, in the order above,
passed or failed, with the figures it used. They never change the decision: `ok`, `reasons` and
`codes` are worked out exactly as before, and `ok` is "every check passed" (overrides aside;
`tests/unit/rules.checks.test.ts`). The shifts line's personal replies log them in `enquiry.checks`
for the office's Enquiries page ("Checks made by code", `docs/screens.md`), lists written as text.
Dates are firm-local `yyyy-mm-dd`, times ISO, hours rounded to one decimal.

| Code | Check | Detail |
|---|---|---|
| `started` | 0 | `startsAt` |
| `active` | 1 | `status` (`active`, `inactive` or `blocked`) |
| `role` | 2 | `role` (the shift's) |
| `qualification` | 3–4, one per required type | `type`; `neededBy`: `role`, `session` or `both`; `held`: the record used (`valid`, `expired`, `applied`, `suspended`, or `none`); `expiresOn` (null: no expiry or none held); `until`: the last local day the shift touches. No rule for the role: one failed entry, `{ rule: "none", role }` |
| `overlap` | 5 | `withStart`, `withEnd`: the booking it clashes with (null: none); `bufferMinutes` |
| `rest` | 6 | `hoursBefore`, `hoursAfter`: the gaps to the nearest bookings either side (null: none loaded on that side); `minimumHours` |
| `weekly_hours` | 7 | `hours`: the busiest week the shift touches, with it; `capHours` |
| `days_off` | 8 | `dates`: the days off it touches (none: `[]`) |
| `site` | 9 | `siteId` |

Why a session wasn't offered (the Enquiries page's "Considered but not offered") comes from the
same result: each failed rule's code, with the qualification's `type` for a credential code and
the clashing booking's times for `overlap` (`ruleReasons()`, `src/lib/portal/open-shifts.ts`), plus
the casual app's own filters, which aren't rules: `hidden` (the session or its event isn't showing
to casuals), `outside_area` (her travel area), `full`, and `held` (fair rotation holds it for
others until a time).

## Credential packs (data, per sector)

The packs are data in `src/lib/rules/packs.ts`. `tests/unit/credential.packs.test.ts` reads both
tables below and fails if the code and this doc differ in any column except Notes and the formal
Name. A firm gets its sector's pack when it is set up: `applyCredentialPack()` copies the types into
the firm's own `credential_types` (code, the name workers see, whether "applied" may count) and adds
the pack's default role rules to `credential_rules` (per firm and role, each rule labelled with its
sector pack; a role name belongs to one pack in a firm). Anything the firm already has is left
exactly as it is, and the event records exactly what was added. Every sector's pack exists; only
security is live, and a firm only ever gets the packs it needs (the demo's Northline gets rail).
Typical validity is a guide only: the expiry on the card/certificate is what we store and use.

| Sector | Type code | Name | Shown to workers as | Applied may count | Typical validity (confirm per firm) | Notes |
|---|---|---|---|---|---|---|
| Security/events | `SIA_DS` | SIA Door Supervisor licence | SIA door supervisor licence | yes | 3 years | Check on the SIA register at onboarding and monthly. |
| Security/events | `SIA_SG` | SIA Security Guard licence | SIA security guard licence | yes | 3 years | |
| Security/events | `SIA_CP` | SIA Close Protection | SIA close protection licence | yes | 3 years | Confirm the SIA allowance covers close protection before a firm uses it. |
| Security/events | `STEWARD_L2` | NVQ Level 2 Spectator Safety | Level 2 spectator safety qualification | no | No expiry | Firm may require refresher. |
| Security/events | `FIRST_AID` | First aid at work | first aid at work certificate | no | 3 years | |
| Security/events | `CSAS` | Community Safety Accreditation Scheme | CSAS accreditation | no | Set by the police force; ends when the person leaves the firm | Recorded by the office only, under this firm's own scheme (below). |
| Security/events | `MANUAL_HANDLING` | Manual handling training | manual handling certificate | no | No fixed expiry; firm policy | Usually a session's extra requirement, not a role's. |
| Rail | `PTS` | Personal Track Safety | PTS card | no | Renewal typically every 2 years | |
| Rail | `SENTINEL` | Sentinel card / sponsorship | Sentinel card | no | Ongoing | Primary sponsor recorded. |
| Rail | `RAIL_DA` | Drugs & alcohol screening | drugs and alcohol test | no | Recent test required (e.g. within 3 months for new sponsorship) | Random tests thereafter. |
| Rail | `RAIL_MEDICAL` | Safety-critical medical | rail safety-critical medical | no | Varies | |
| Construction/civils | `CSCS` | CSCS card (type: labourer/skilled/etc.) | CSCS card | no | Typically 5 years | Card type matters for the role. |
| Construction/civils | `CPCS_NPORS` | Plant operator cards | plant operator card (CPCS or NPORS) | no | Varies | |
| Construction/civils | `SMSTS_SSSTS` | Site supervision | site supervision certificate (SMSTS or SSSTS) | no | 5 years | |
| Cleaning/various | `DBS` | DBS check | DBS check | no | No fixed expiry; firm policy (or update service) | Site-dependent. |
| Any | `RTW` | Right to work | right to work check | no | Per document | Firm-level requirement, not per shift. |

Default role rules (every listed type is needed; `RTW`, `FIRST_AID` and `MANUAL_HANDLING` are types
but no role's default rule, often a session's extra requirement instead; cleaning needs DBS per
site, not per role):

| Pack | Role | Needs |
|---|---|---|
| security | `steward` | `STEWARD_L2` |
| security | `door_supervisor` | `SIA_DS` |
| security | `security_officer` | `SIA_SG` |
| security | `close_protection_officer` | `SIA_CP` |
| security | `csas_officer` | `CSAS` |
| rail | `track_operative` | `PTS`, `SENTINEL`, `RAIL_DA` |
| rail | `lookout` | `PTS`, `SENTINEL`, `RAIL_DA` |
| construction | `labourer` | `CSCS` |
| construction | `plant_operator` | `CSCS`, `CPCS_NPORS` |
| construction | `site_supervisor` | `CSCS`, `SMSTS_SSSTS` |
| cleaning | `cleaner` | none |

**CSAS belongs to the firm's own scheme.** Under the Police Reform Act 2002 s.41 a chief constable
accredits people employed by an organisation that has a Community Safety Accreditation Scheme
agreement, so an accreditation held through another employer doesn't cover this firm's CSAS
shifts. The office records CSAS itself (a casual can't upload it, `docs/office-v2.md` §3.7), and
recording it confirms it is under this firm's own scheme. It is never "applied": an application
in progress isn't an accreditation. Whether a firm may deploy someone accredited through another
employer is on the solicitor's list (`docs/office-v2.md` §6.4, `PLAN.md` Checks 15).

**Applied/in progress allowance:** SIA approved contractors have been able to deploy a capped
share of staff whose licence application is in progress (reported as up to 15%). Model it as a
firm setting `credential_applied_allowance_pct` (above: no command sets it yet); default 0; and it
counts only for credential types marked
`applied_allowed` (the three SIA licences). Any other type in progress: "Your [name] is still
being processed. This shift needs a valid one. Send it to the office when you have it." Confirm
the current SIA rule before enabling.

## Expiry warnings

- Daily scan (`credential-scan`, 08:00 London time): warn worker at 30, 14 and 7 days; office gets
  a weekly list (Mondays: expiring in the next 30 days, expired in the last 7).
- A warning goes out when a threshold is **crossed**, once per threshold per expiry date. If
  several were crossed at once (a late import, a day the scan didn't run), one message goes, for
  the nearest. Only `valid` credentials with an expiry date, and only active workers, are warned.
  A row the worker has already replaced (another valid row of the same type that lasts longer or
  never expires) gets no warning or message and isn't on the office list; it is still marked
  expired when its date passes.
- The day **after** the expiry date: status → `expired` (a credential is in date on its expiry day)
  and the worker gets `credential_expired`; worker sees a red banner; offers stop automatically.
  Blocking never waits for the scan: rule 3 already fails a `valid` credential with a past date.
- Office can record a renewal (new number + expiry) → status `valid` → offers resume. Since 12F.2
  the casual can also upload her renewed card (`/profile/upload/{type}`, where both messages link):
  it counts once a named office person approves it (below).
- **Only checked records count** (12F.2, S6, D3). `credentials.check_state` is `verified` for the
  office's own records (imported, recorded, or an upload approved: `verified_at` and `verified_by`
  filled), `waiting` or `rejected` for a casual's upload. Every reader filters on `verified`: rule
  3's two loaders and check 4's SQL (`src/lib/roster/eligibility-input.ts`), the expiry scan (and its
  "already replaced" test), the dashboard's "Qualifications out of date on a booking", the import's "latest record" (a file never
  updates a casual's upload) and readiness. And the database stores an unchecked record as
  `expired` with its upload (`credentials_unchecked_never_valid`), so a reader that ever missed the
  filter still couldn't count it. Tested in `tests/integration/uploads.test.ts`.
- **What a casual can't upload** (`officeRecorded` in `src/lib/rules/packs.ts`): CSAS (only the
  firm's own scheme covers its shifts, Police Reform Act 2002 s.41: the office records it on the
  casual's page after confirming that), right to work (Rules 15), and documents holding health or
  criminal record details (`RAIL_DA`, `RAIL_MEDICAL`, `DBS`). It's the firm's own data too
  (`credential_types.office_recorded`, from the pack, migration 0043): a firm may mark its own types
  so, and the packs' list always holds. The expiry reminders for one she can't upload (the office
  records it, or none of her roles needs it) keep the words "send the new details to the office",
  with no upload link (`credential_expiring_to_office`, `credential_expired_to_office`).
- **Approving one** takes the expiry date as the person reads it from the card: a date already gone
  is refused (reject it as expired), as is one more than 10 years ahead; no date only when they
  tick "It has no expiry date". The casual's row is locked first, as saving one, erasure and
  recording CSAS do, so a resend never deletes one just checked.

## Qualification statuses (what casuals and the office see, 12F.1)

`src/lib/credentials/status.ts` (pure; `tests/unit/credentials.status.test.ts`) turns a type's
records into one status, reading them the same way as rule 3 above. Staff-facing words say
"qualification" (or the item's own name), never "credential".

| Status | When |
|---|---|
| Suspended | any record of the type is `suspended` (it fails whatever else is held) |
| Valid | a `valid` record in date (no expiry, or expiring after the next 30 days); the longest-lasting counts |
| Expiring soon | that record expires within `EXPIRING_SOON_DAYS` (30: the scan's first warning, `src/lib/credentials/expiry.ts`); one window for the scan, the office's Casuals pages and the casual's My shifts and Profile |
| Applied for | no record in date, but one `applied` (an application in progress). It counts towards booking only as check 4 allows: a type with `applied_allowed`, at a firm whose `credential_applied_allowance_pct` is above 0 (`appliedCounts`) |
| Expired | records, none in date or applied (marked `expired`, or `valid` with a past date) |
| Being checked | no record in date, and her upload of it waits for the office (12F.2). It never counts until approved |
| Not accepted | no record in date, and the office turned down her latest upload, with a reason ("Not accepted: too blurry to read", …); it goes 30 days after the check, with the image |
| Missing | no record of a type one of her roles needs |

An upload never hides a suspension, and a renewal sent while hers is still in date leaves that one
showing ("renewing"), with the new one waiting for the office.

- **Which are listed:** every type a rule for one of her roles requires (`credential_rules`), with
  the roles that need it, worst first (suspended, expired, not accepted, missing, being checked,
  expiring soon, applied for, valid). A type nothing she does needs isn't listed. A session's own extra requirements
  (`shifts.required_credentials`) show on that shift's page (12H.2).
- **Right to work** (`RTW`) is a status only (Rules 15): "Checked by the office on {date}" (a check
  in date; its `verified_at`), "The office's check has run out: ask the office" (a time-limited
  check past its date) or "Not checked yet: ask the office". It's never in the list and never
  enforced: no role's rule requires it, so the rules engine can book a casual without one.
- **A role with no rule** (`credential_rules` has no row for it): check 3 refuses its shifts (fail
  closed), so the pages say so ("… shifts aren't set up yet, so you can't take them. Ask the
  office."), never that her roles "need none".
- **Needs updating** (`needsUpdating()`), in four levels: (1) it stops a booked shift (expired,
  suspended, missing, not accepted or still being checked; applied for where check 4 won't accept
  it; or in date only until before the shift's last day, as rule 3 reads it); (2) expired,
  suspended or not accepted; (3) expiring soon, unless an application or her new card is on its
  way; (4) missing. Otherwise applied for and being checked aren't listed (nothing for her to do
  yet). Within a level: the shift it stops soonest, the worst status, the soonest date, then the
  name. The staff photo has its own status (`src/lib/uploads/photo.ts`: Up to date, Due soon 30
  days before `photo.renewal_months`, Overdue, Missing, Waiting for check), not a level.

## Test cases (table-driven, all must pass)

| Case | Setup | Expected |
|---|---|---|
| Valid licence, free day | SIA_DS valid to next year | ok |
| Licence expires the day before the shift | expiresOn = shift date − 1 | fail: expired reason |
| Licence expires on the shift date | expiresOn = shift date | ok (in date on the day) |
| Missing required credential | no SIA at all | fail |
| Applied, allowance 15%, 10 deployed, 1 applied in use | this would make 2/11 = 18% | fail |
| Applied, allowance 15%, 20 deployed, 1 in use | 2/21 = 9.5% | ok |
| Applied, allowance 0 | — | fail |
| Overlap by 1 minute | other 08:00–14:00, shift 13:59–20:00 | fail |
| Back-to-back with 11 h rest | other ends 22:00, shift starts 09:00 next day | ok |
| Back-to-back with 10 h rest | shift starts 08:00 | fail |
| Weekly cap 48, has 40 h, shift 8 h | 48 | ok |
| Weekly cap 48, has 41 h, shift 8 h | 49 | fail |
| Marked unavailable | date in unavailableDates | fail |
| Blocked site | siteId in blockedSites | fail |
| Wrong role | roles = ['steward'], shift role 'door_supervisor' | fail |
| Multiple failures | expired + overlap | ok=false, both reasons listed |
| No credential rule for the role | firm has no `credential_rules` row for the shift's role | fail: "This shift isn't ready to take yet. Ask the office." |
| Shift already started | `now` at or after `startsAt` | fail: "This shift has already started." |
| Rule needs no credential | rule row with an empty list, worker has no credentials | ok |
| Session needs an extra requirement the worker lacks | role needs SIA_DS (held); session adds CSAS, not held | fail: missing CSAS |
| Session needs an extra requirement the worker holds | session adds CSAS, held and in date | ok |
| Extra requirement expires mid-session | night session 22:00–06:00; CSAS expires on its first day | fail: expired reason |

## Race test (integration)

`tests/integration/assign.race.test.ts`: ten eligible workers call `bookShift()` for the last
slot at the same moment (each in its own transaction, released together from a barrier): exactly
one is booked, the other nine get `filled` ("just filled"), and exactly one `shift.assigned` event
exists. The same for 3 places among 10. Also raced: one worker in two tabs on overlapping shifts,
on the same shift, and past a weekly cap; two applicants for the day's last "applied" place; a
double tap on cancel. `tests/unit/rules.doc-parity.test.ts` fails if a case in the table above has
no test in `rules.table.test.ts`, or that file tests a case the table doesn't list.
