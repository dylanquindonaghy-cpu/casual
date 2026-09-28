# Rules engine and credentials

Pure functions in `src/lib/rules/`. No database access inside the rules — callers load data,
rules decide. This makes them easy to test in tables.

## Function shape

```ts
type EligibilityInput = {
  worker: { id: string; status: 'active' | 'inactive' | 'blocked'; roles: string[] };
  credentials: { type: string; status: string; expiresOn?: Date; verifiedAt?: Date }[];
  shift: { id: string; role: string; startsAt: Date; endsAt: Date; siteId?: string; requiredTypes: string[] };
  otherAssignments: { startsAt: Date; endsAt: Date }[];   // confirmed, same week ± buffer
  unavailableDates: Date[];
  settings: {
    minRestHours: number;               // default 11
    weeklyHoursCap: number;             // default 48 (firm may set lower)
    travelBufferMinutes: number;        // default 0
    appliedAllowancePct: number;        // e.g. 15 (SIA ACS), else 0
    appliedInUseCount: number;          // how many "applied" workers are already deployed that day
    deployedCount: number;              // total deployed that day (for the % check)
    blockedSites: string[];
  };
};

type EligibilityResult = { ok: boolean; reasons: string[] };   // reasons in plain English
```

## Checks, in order (stop at first hard fail, but collect all reasons for the UI)

| # | Check | Reason shown to worker |
|---|---|---|
| 1 | Worker status is `active` | "Your account isn't active. Contact the office." |
| 2 | Role match (worker.roles includes shift.role) | "This shift needs a [role]." |
| 3 | Each required credential present, `valid`, and `expiresOn >= shift date`. The required list comes from the firm's `credential_rules` row for the shift's role; **no row for the role means not eligible** (fail closed: a deleted or forgotten rule must never drop a licence check). A row with an empty list means the role needs no credential. | "Your SIA licence expired on 3 Oct. Renew it, then send the new number to the office." / no rule: "This shift isn't ready to take yet. Ask the office." |
| 4 | If credential is `applied`: allowed only if firm allowance > 0 and adding this worker keeps applied share ≤ allowance % | "Your licence is still being processed. The office can only deploy a limited number of staff in that position today." |
| 5 | No overlap with other assignments (± travel buffer) | "You're already booked at [time] that day." |
| 6 | Rest gap ≥ `minRestHours` from previous/next assignment | "This is too close to your previous shift (11 hours' rest needed)." |
| 7 | Weekly hours (confirmed + this shift) ≤ cap | "This would take you over your weekly hours limit." |
| 8 | Not marked unavailable for the date | "You've marked yourself unavailable that day. Change it in your profile to take this shift." |
| 9 | Site not in worker's blocked list | "This site isn't available to you. Contact the office." |

Office users can **override** checks 6–8 with a logged reason. Checks 3–4 (credentials) can
never be overridden in the app.

## Credential packs (data, per sector)

Stored in `credential_types` (seeded) and `credential_rules` (per firm and role, each rule
labelled with its sector pack; a role name belongs to one pack in a firm). Typical validity
is a guide only: the expiry on the card/certificate is what we store and use.

| Sector | Type code | Name | Typical validity (confirm per firm) | Notes |
|---|---|---|---|---|
| Security/events | `SIA_DS` | SIA Door Supervisor licence | 3 years | Check on the SIA register at onboarding and monthly. |
| Security/events | `SIA_SG` | SIA Security Guard licence | 3 years | |
| Security/events | `SIA_CP` | SIA Close Protection | 3 years | |
| Security/events | `STEWARD_L2` | NVQ Level 2 Spectator Safety | No expiry | Firm may require refresher. |
| Security/events | `FIRST_AID` | First aid at work | 3 years | |
| Rail | `PTS` | Personal Track Safety | Renewal typically every 2 years | |
| Rail | `SENTINEL` | Sentinel card / sponsorship | Ongoing | Primary sponsor recorded. |
| Rail | `RAIL_DA` | Drugs & alcohol screening | Recent test required (e.g. within 3 months for new sponsorship) | Random tests thereafter. |
| Rail | `RAIL_MEDICAL` | Safety-critical medical | Varies | |
| Construction/civils | `CSCS` | CSCS card (type: labourer/skilled/etc.) | Typically 5 years | Card type matters for the role. |
| Construction/civils | `CPCS_NPORS` | Plant operator cards | Varies | |
| Construction/civils | `SMSTS_SSSTS` | Site supervision | 5 years | |
| Cleaning/various | `DBS` | DBS check | No fixed expiry; firm policy (or update service) | Site-dependent. |
| Any | `RTW` | Right to work | Per document | Firm-level requirement, not per shift. |

**Applied/in progress allowance:** SIA approved contractors have been able to deploy a capped
share of staff whose licence application is in progress (reported as up to 15%). Model it as a
firm setting `appliedAllowancePct`; default 0. Confirm the current SIA rule before enabling.

## Expiry warnings

- Daily scan: warn worker at 30, 14 and 7 days; office gets a weekly list.
- On expiry day: status → `expired`; worker sees a red banner; offers stop automatically.
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
| Rule needs no credential | rule row with an empty list, worker has no credentials | ok |

## Race test (integration)

Two workers call `takeShift` for the last slot at the same time: exactly one succeeds, the
other gets "just filled", and only one `events` row of type `shift.taken` exists.
