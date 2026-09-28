# Rules engine and credentials

Pure functions in `src/lib/rules/`. No database access inside the rules — callers load data,
rules decide. This makes them easy to test in tables. The loader is
`loadEligibilityInput()` (`src/lib/roster/eligibility-input.ts`): the role's credential rule (none:
`null`), the worker's credentials, their `confirmed` and `completed` bookings on shifts that aren't
cancelled from 8 days before to 8 days after the shift (never the shift itself), credential names
and `applied_allowed` types from `credential_types`, the day's deployed and applied counts (others
booked on shifts starting that local day; "applied" = working on an application in progress for a
type their role needs), and the settings below from `firms.settings`. Availability and blocked
sites are empty until their stores exist. A pass (`EligibilityPass`) is single-use and names one
worker and one shift; roster plugs refuse to book without it (`consumeEligibilityPass()`).

Settings keys (`firms.settings`, defaults in brackets): `min_rest_hours` (11),
`weekly_hours_cap` (48), `travel_buffer_minutes` (0), `credential_applied_allowance_pct` (0). A
value that makes no sense fails the booking rather than loosening a rule.

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
           requiredTypes: string[] | null };              // from credential_rules; null = no rule
  otherAssignments: { startsAt: Date; endsAt: Date }[];  // confirmed, same week ± a day
  unavailableDates: string[];           // firm-local yyyy-mm-dd
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
  pass?: EligibilityPass;               // only when ok; isEligibilityPass() tells a real one
};
```

## Checks, in order (stop at first hard fail, but collect all reasons for the UI)

| # | Check | Reason shown to worker |
|---|---|---|
| 0 | The shift hasn't started (`startsAt > now`) | "This shift has already started." |
| 1 | Worker status is `active` | "Your account isn't active. Contact the office." |
| 2 | Role match (worker.roles includes shift.role) | "This shift needs a [role]." |
| 3 | Each required credential present, `valid`, and `expiresOn >= shift date`. The required list comes from the firm's `credential_rules` row for the shift's role; **no row for the role means not eligible** (fail closed: a deleted or forgotten rule must never drop a licence check). A row with an empty list means the role needs no credential. | "Your SIA licence expired on 3 Oct. Renew it, then send the new number to the office." / no rule: "This shift isn't ready to take yet. Ask the office." |
| 4 | If credential is `applied`: allowed only if firm allowance > 0 and adding this worker keeps applied share ≤ allowance % | "Your licence is still being processed. The office can only deploy a limited number of staff in that position today." |
| 5 | No overlap with other assignments (± travel buffer) | "You're already booked at [time] that day." (or "on Fri 6 Nov" for another day) |
| 6 | Rest gap ≥ `minRestHours` from the previous and the next assignment | "This is too close to your previous shift (11 hours' rest needed)." / "...your next shift..." |
| 7 | Weekly hours (confirmed + this shift) ≤ cap. The week is Monday 00:00 to Monday 00:00 local, the one the shift starts in; every booking counts only its hours inside that week, in real elapsed time | "This would take you over your weekly hours limit." |
| 8 | Not marked unavailable for any calendar day the shift touches (a night shift touches two) | "You've marked yourself unavailable that day. Change it in your profile to take this shift." |
| 9 | Site not in worker's blocked list | "This site isn't available to you. Contact the office." |

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
| Rail | `PTS` | Personal Track Safety | PTS card | no | Renewal typically every 2 years | |
| Rail | `SENTINEL` | Sentinel card / sponsorship | Sentinel card | no | Ongoing | Primary sponsor recorded. |
| Rail | `RAIL_DA` | Drugs & alcohol screening | drugs and alcohol test | no | Recent test required (e.g. within 3 months for new sponsorship) | Random tests thereafter. |
| Rail | `RAIL_MEDICAL` | Safety-critical medical | rail safety-critical medical | no | Varies | |
| Construction/civils | `CSCS` | CSCS card (type: labourer/skilled/etc.) | CSCS card | no | Typically 5 years | Card type matters for the role. |
| Construction/civils | `CPCS_NPORS` | Plant operator cards | plant operator card (CPCS or NPORS) | no | Varies | |
| Construction/civils | `SMSTS_SSSTS` | Site supervision | site supervision certificate (SMSTS or SSSTS) | no | 5 years | |
| Cleaning/various | `DBS` | DBS check | DBS check | no | No fixed expiry; firm policy (or update service) | Site-dependent. |
| Any | `RTW` | Right to work | right to work check | no | Per document | Firm-level requirement, not per shift. |

Default role rules (every listed type is needed; `RTW` and `FIRST_AID` are types but no role's
default rule; cleaning needs DBS per site, not per role):

| Pack | Role | Needs |
|---|---|---|
| security | `steward` | `STEWARD_L2` |
| security | `door_supervisor` | `SIA_DS` |
| security | `security_officer` | `SIA_SG` |
| security | `close_protection_officer` | `SIA_CP` |
| rail | `track_operative` | `PTS`, `SENTINEL`, `RAIL_DA` |
| rail | `lookout` | `PTS`, `SENTINEL`, `RAIL_DA` |
| construction | `labourer` | `CSCS` |
| construction | `plant_operator` | `CSCS`, `CPCS_NPORS` |
| construction | `site_supervisor` | `CSCS`, `SMSTS_SSSTS` |
| cleaning | `cleaner` | none |

**Applied/in progress allowance:** SIA approved contractors have been able to deploy a capped
share of staff whose licence application is in progress (reported as up to 15%). Model it as a
firm setting `appliedAllowancePct`; default 0; and it counts only for credential types marked
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
- Office can record a renewal (new number + expiry) → status `valid` → offers resume.

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

## Race test (integration)

`tests/integration/assign.race.test.ts`: ten eligible workers call `bookShift()` for the last
slot at the same moment (each in its own transaction, released together from a barrier): exactly
one is booked, the other nine get `filled` ("just filled"), and exactly one `shift.assigned` event
exists. The same for 3 places among 10. Also raced: one worker in two tabs on overlapping shifts,
on the same shift, and past a weekly cap; two applicants for the day's last "applied" place; a
double tap on cancel. `tests/unit/rules.doc-parity.test.ts` fails if a case in the table above has
no test in `rules.table.test.ts`, or that file tests a case the table doesn't list.
