# Connecting your planner

How a firm's planner or CRM sends its sessions to ShiftDesk and reads back what happened to
them (12J.1; the design is `docs/office-v2.md` §5.3, ADR-022 in `docs/decisions.md`). Every value
on this page is made up.

The API is small: one call to send a session, one to read it back, and one to read cancellations.
It never books anyone, never decides who may work a session, and never uses AI. Changes to a
session people are booked on go through the same rules, notice hours and messages to casuals as
the office's own changes.

A planner that can't call an API itself can go through Zapier, Make or n8n: their plain HTTP steps
send these calls.

## Connecting in three steps

1. **Make a key.** An admin opens **Integrations** (in the office menu, under Configuration:
   `/office/settings/integrations`), presses "Create a key" and gives it a name ("Planner"). The
   key is shown once: "Copy this key now. You won't see it again." Only its last 4 characters stay
   on the page.
2. **Give the key to your planner.** It goes in the `Authorization` header of every call, as
   `Authorization: Bearer <key>`. Never in an address, a log or an email.
3. **Send your sessions.** Your planner sends each session with `PUT /api/v1/sessions/{ref}`, by
   its own id, and reads cancellations with `GET /api/v1/cancellations`. The role and requirement
   codes it may use are listed under "Codes your planner can use" on the same page.

## Where and how

- **Address:** the ShiftDesk platform address, not your firm's own one:
  `https://{ShiftDesk's address}/api/v1/…` (locally, `http://localhost:3000/api/v1/…`). On a firm's
  subdomain or own domain every `/api/v1` address answers 404.
- **Server to server.** No cookies are read and no browser (CORS) headers are sent.
- **JSON only:** `content-type: application/json` (else 415), at most 64 KB (else 413).
- **Field names** are `snake_case`. **Times** are ISO 8601 with an offset in requests
  (`2026-11-07T10:30:00+01:00` or `…Z`), in whole minutes, and UTC (`…Z`) in answers. **Money** is
  whole pence.
- **Every body is checked strictly:** a field ShiftDesk doesn't know is a 400, so a typo never
  fails silently.
- **Answers never hold** a casual's mobile number, email address, postcode or travel times, their
  health, or anything anyone typed about a booking.

The examples below use a key kept in an environment variable:

```sh
export SHIFTDESK_KEY="<the key you copied>"
export SHIFTDESK="https://shiftdesk.example/api/v1"
```

## Keys

- A key is `shiftdesk_` followed by 43 random letters, digits, `-` and `_`. ShiftDesk keeps only a
  fingerprint of it (a sha256) and its last 4 characters.
- The key decides the firm: never the address, the path or the body. Another firm's session
  looks like one that doesn't exist (404).
- At most 10 live keys per firm. Revoking a key on the Integrations page works at once: its next
  call gets 401.
- Each key may make 300 calls a minute. Over that: 429 with `Retry-After` (seconds).
- A wrong key and a revoked key get the same answer (401 `invalid_key`). One address that sends 30
  refused keys in a minute gets 429 for the rest of that minute, before its keys are even looked
  at.
- Until ShiftDesk has recorded your firm's agreement, a live ShiftDesk refuses every change (403
  `agreement_not_recorded`). Reading still works.

## Send a session: `PUT /api/v1/sessions/{ref}`

Creates the session the first time, and updates it after that. `{ref}` is your planner's own id
for the session: 1 to 200 letters, digits, `.`, `_`, `:` and `-`, starting and ending with a letter
or a digit (else 400 `bad_ref`). A ref belongs to your firm, so another firm's same ref is a
different session.

```sh
curl -X PUT "$SHIFTDESK/sessions/RACEDAY-STW-0710" \
  -H "Authorization: Bearer $SHIFTDESK_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event": { "ref": "RACEDAY-2026", "name": "Raceday" },
    "site": { "name": "Acme Demo Racecourse", "postcode": "ZZ9 9ZZ" },
    "role": "steward",
    "starts_at": "2026-11-07T10:30:00+00:00",
    "ends_at": "2026-11-07T18:30:00+00:00",
    "places": 6,
    "status": "open",
    "pay_rate_pence": 1260,
    "post": "Gate B",
    "meeting_point": "Staff entrance, Gate B",
    "uniform": "Black trousers, boots. Hi-vis provided.",
    "requirements": ["STEWARD_L2"],
    "instructions": "Ask for the steward lead on arrival."
  }'
```

The answer (201 the first time):

```json
{
  "result": "created",
  "session": {
    "id": "0b9e8a52-2b7a-4b1e-9c55-6c1d7f3e2a10",
    "ref": "RACEDAY-STW-0710",
    "source": "api",
    "event": { "id": "41d2c7e0-5a3b-4c8d-9e1f-2a3b4c5d6e7f", "ref": "RACEDAY-2026", "name": "Raceday" },
    "site": { "name": "Acme Demo Racecourse", "postcode": "ZZ9 9ZZ" },
    "role": "steward",
    "starts_at": "2026-11-07T10:30:00Z",
    "ends_at": "2026-11-07T18:30:00Z",
    "status": "open",
    "places": 6,
    "booked": 0,
    "pay_rate_pence": 1260,
    "post": "Gate B",
    "meeting_point": "Staff entrance, Gate B",
    "uniform": "Black trousers, boots. Hi-vis provided.",
    "requirements": ["STEWARD_L2"],
    "instructions": "Ask for the steward lead on arrival."
  }
}
```

`result` is `created` (201), `updated`, `unchanged` or `cancelled` (200). A move or cancellation of
a session people are booked on also gives `casuals_told`: how many booked casuals ShiftDesk is
telling. The session's `status` is `open`, `filled` (every place booked, or closed by the office)
or `cancelled`.

### The fields

| Field | Rules |
|---|---|
| `role` | Required to create. Read the way the rota sheet is, so "Door supervisor" becomes `door_supervisor`, and it must then be one of your firm's role codes, else 422 `unknown_role` and nothing is created. Up to 100 characters. |
| `starts_at`, `ends_at` | Required to create. ISO 8601 with an offset, whole minutes. The finish after the start and less than 24 hours later. |
| `site` | Required to create: `{"name", "postcode"}`. The site is found by its name (up to 200 characters), or made if it's new. A `postcode` only fills a site that has none, and is looked up then: an unknown postcode is 422 `unknown_postcode`, a look-up that fails is 503 `lookup_failed` and saves nothing. A different postcode for a site that already has one is 409 `site_postcode_differs`: change it in ShiftDesk Settings, or send a different site name. `null` or no postcode leaves the site's alone. |
| `event` | `{"ref", "name"}`: your planner's event, found by its ref (same rules as a session's, but not starting `auto:`) or made if it's new; a different name renames it. Name up to 200 characters. Left out when creating, the session joins an automatic event for its site and day; `null` puts it back in that one. |
| `places` | 1 to 1000. 1 when left out on create. |
| `status` | `open` or `cancelled`. `cancelled` needs a `change_reason`, and the other fields of that PUT aren't applied (no site or event is made, no postcode filled). |
| `pay_rate_pence` | 0 to 100,000 (pence an hour). |
| `post` | Up to 200 characters. |
| `meeting_point`, `uniform` | Up to 300 characters each. |
| `instructions` | Up to 2,000 characters. Only booked casuals see them. |
| `requirements` | At most 20 of your firm's qualification codes, on top of what the role needs (else 422 `unknown_requirement`). |
| `change_reason` | `event_changed`, `event_cancelled`, `fewer_staff`, `weather` or `other`. Needed to cancel a session, and to move one people are booked on. |

A field left out stays as it is; `null` (or an empty string) clears it. Whether casuals can see a
session and whether it's urgent are never read from the API: they're the office's (sending
`showing_to_casuals` or `urgent` is a 400).

### What a PUT does, in order

1. **A new ref.** One that starts in the past: 409 `session_started`. `"status": "cancelled"`: 200
   `unchanged`, nothing created. Otherwise the session is created with its event and site: 201.
2. **Nothing different:** 200 `unchanged`, nothing logged.
3. **Already started, or already cancelled:** 409 `session_started` or `session_cancelled`. A
   cancelled session is never opened again: send a new ref. Its site is never given a postcode by
   such a PUT.
4. **Nobody booked:** the change is applied.
5. **People booked:**
   - places, pay, post, meeting point, uniform, instructions and the event are applied. Places can
     only go down as far as the highest place someone holds (else 409 `places_below_booked`: ask
     the office to cancel that booking, or send more places);
   - new times or a new site need a `change_reason` (else 422 `change_reason_required`). The rules
     run for each booked casual at the new time and place, and any failure (including too little
     rest or too many hours in the week) gives 409 `bookings_block_change` with each casual's id
     and the rules' codes, and nothing changes. Otherwise each casual's notice is recorded and they
     are told;
   - a new role or requirements: 409 `session_has_bookings`. The office cancels those bookings
     first;
   - `"status": "cancelled"` with a `change_reason`: each booking becomes your firm's cancellation,
     with its notice hours, each casual is told, and nobody ever gets a strike for it.
6. A refused change to a booked session (`bookings_block_change`, `session_has_bookings`,
   `places_below_booked`, or a move with no `change_reason`) also shows in the office's Needs
   attention, in case your planner ignores the answer. A booking the office chose to keep (a
   casual no longer active, or blocked from the site) still blocks your move: only the office
   can move a session past it.

The status follows the number of places, as with the office's editor: more places than
bookings opens the session again, unless the office closed it.

### The order of PUTs

Nothing orders two PUTs for one ref, so an old PUT retried after a newer one succeeded would undo
it, and tell booked casuals twice. So:

- send a ref's PUTs **one at a time**: wait for the answer before sending the next;
- **never retry an older PUT** after a newer one for the same ref succeeded;
- **switch off automatic replays** of old steps for these calls (Zapier's Autoreplay, Make's
  automatic retries of old runs).

The same PUT twice is safe: the second changes nothing.

## Read a session: `GET /api/v1/sessions/{ref}`

The session as ShiftDesk holds it, with every booking, live and cancelled, oldest first.

```sh
curl "$SHIFTDESK/sessions/RACEDAY-STW-0710" -H "Authorization: Bearer $SHIFTDESK_KEY"
```

```json
{
  "session": { "id": "0b9e8a52-2b7a-4b1e-9c55-6c1d7f3e2a10", "ref": "RACEDAY-STW-0710", "…": "as above" },
  "bookings": [
    {
      "id": "b71e0c42-7d1a-4e2b-8c3d-4e5f6a7b8c9d",
      "ref": "B71E0C42",
      "status": "booked",
      "casual": { "id": "9a0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f", "staff_ref": "ST-0042", "first_name": "Kieran", "last_name": "Doyle" },
      "booked_at": "2026-11-01T12:00:00Z",
      "booked_by": "casual"
    }
  ]
}
```

A booking's `status` is `booked`, `cancelled`, `worked` or `no_show`; `booked_by` is `casual`,
`office` or `sheet`. A cancelled booking also has its `cancellation` (below). After a casual's
details are erased (a GDPR request), `casual` is `null` and `"erased": true`.

## Read cancellations: `GET /api/v1/cancellations`

Every cancelled booking of your firm, by anyone (the casual, the office, your planner or the rota
sheet), oldest first, by cancellation time and then booking id, at most 100 a page.

```sh
curl "$SHIFTDESK/cancellations?since=2026-11-01T00:00:00Z" -H "Authorization: Bearer $SHIFTDESK_KEY"
```

```json
{
  "records": [
    {
      "session": { "id": "0b9e8a52-2b7a-4b1e-9c55-6c1d7f3e2a10", "ref": "RACEDAY-STW-0710", "…": "as above, without instructions" },
      "booking": {
        "id": "b71e0c42-7d1a-4e2b-8c3d-4e5f6a7b8c9d",
        "ref": "B71E0C42",
        "status": "cancelled",
        "casual": { "id": "9a0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f", "staff_ref": "ST-0042", "first_name": "Kieran", "last_name": "Doyle" },
        "booked_at": "2026-11-01T12:00:00Z",
        "booked_by": "casual",
        "cancellation": {
          "at": "2026-11-06T18:05:12Z",
          "by": "casual",
          "via": "app",
          "notice_hours": 15.42,
          "reason_code": "casual_own_reason",
          "strike": { "status": "issued", "live_strikes": 2 }
        }
      }
    }
  ],
  "next_cursor": null
}
```

- Ask with `since=` (an ISO 8601 time with an offset; that time included) or with `cursor=` (the
  `next_cursor` of the page before), not both: else 400 `bad_since` or `bad_cursor`.
- `next_cursor` is there while a page is full (100 records); `null` means you've caught up. One
  whole-session cancellation stamps every booking with the same time, so page with the cursor,
  not by adding a second to the last time.
- A cancellation can be saved a moment after a later one. So start each new poll from `since=` a
  few minutes before the last record you have. Repeats are safe: each record carries the booking's
  `id`.
- **`cancellation.by`:** `casual`, `office`, `planner` or `sheet`. **`via`:** `app`, `office`,
  `sheet`, `import` or `api` (`null` for cancellations from before this was recorded).
- **`reason_code`:** a casual's own reason is always `casual_own_reason` (their words can be about
  their health, so they never leave ShiftDesk). The office's and your planner's keep their code
  (`event_changed`, `event_cancelled`, `fewer_staff`, `weather`, `not_available`, `other`). The rota
  sheet's are `sheet_change`.
- **`strike.status`:** `issued`, `exempt` (with `exempt_reason`: `booked_by_office`,
  `rules_override` or `office_changed_it`), `none` or `withdrawn`. `live_strikes` is how many of the
  casual's strikes count now. A cancellation by the office, your planner or the sheet is never a
  strike.

## Errors

Every error answer is:

```json
{ "error": { "code": "unknown_role", "message": "That role isn't one of your firm's role codes. …", "request_id": "4f1c0e2a-1b2c-4d3e-8f90-0a1b2c3d4e5f" } }
```

The message is one plain sentence (or two). Nothing you sent is ever repeated back. Quote the
`request_id` when you ask ShiftDesk about a call.

| Status | Code | When |
|---|---|---|
| 400 | `bad_json` | The body isn't JSON. |
| 400 | `validation_failed` | A field isn't right. `fields` lists each one: `[{"path": "site.postcode", "code": "bad_postcode"}]`. |
| 400 | `bad_ref` | The ref in the address isn't one (above). |
| 400 | `bad_since` | `since=` isn't an ISO 8601 time with an offset, or neither (or both) of `since=` and `cursor=` was sent. |
| 400 | `bad_cursor` | The cursor isn't one ShiftDesk gave. |
| 401 | `invalid_key` | The key is missing, wrong or revoked. |
| 403 | `agreement_not_recorded` | Your firm's agreement isn't recorded yet, so nothing can be saved. |
| 404 | `not_found` | No session with that ref, or not the platform address, or not an API address. |
| 409 | `session_started` | The session has started, or would start in the past. |
| 409 | `session_cancelled` | The session is cancelled: send a new ref. |
| 409 | `session_has_bookings` | People are booked, so the role and requirements can't change. |
| 409 | `places_below_booked` | A booking holds a place above that number. |
| 409 | `bookings_block_change` | The rules say booked casuals can't work the new time or site. `casuals` lists each one: `[{"id": "…", "codes": ["rest"]}]`. |
| 409 | `site_postcode_differs` | The site already has a different postcode. |
| 413 | `too_big` | The body is over 64 KB. |
| 415 | `not_json` | The body isn't sent as `application/json`. |
| 422 | `change_reason_required` | A cancellation, or a move of a booked session, without a `change_reason`. |
| 422 | `unknown_role` | The role isn't one of your firm's role codes. Nothing is created. |
| 422 | `unknown_requirement` | A requirement isn't one of your firm's qualification codes. |
| 422 | `unknown_postcode` | The site's postcode wasn't found. |
| 429 | `rate_limited` | Too many calls: wait `Retry-After` seconds. |
| 500 | `internal_error` | Something went wrong at ShiftDesk. Try again in a minute. |
| 503 | `lookup_failed` | The site's postcode couldn't be looked up just now. Nothing was saved. |
| 503 | `not_configured` | The API isn't switched on for this ShiftDesk yet. |

**`fields` codes:** `required`, `invalid_type`, `too_small`, `too_big`, `invalid_value`,
`invalid_format`, `unrecognized_key` (a field ShiftDesk doesn't know), `whole_minutes`,
`not_after_start`, `over_24_hours`, `bad_role`, `bad_code`, `bad_postcode`, `bad_ref`,
`reserved_ref` (an event ref starting `auto:`).

**The rules' codes** in `bookings_block_change`: `not_active`, `wrong_role`, `no_rule`,
`credential_missing`, `credential_expired`, `credential_suspended`, `applied_over_allowance`,
`overlap`, `rest`, `weekly_hours`, `unavailable`, `blocked_site`, `started`
(`docs/rules-and-credentials.md`). An empty list means the casual's record couldn't be checked.

## Limits

| What | Limit |
|---|---|
| Calls | 300 a minute per key |
| Refused keys | 30 a minute from one address, then 429 until the minute ends |
| Body | 64 KB, JSON |
| Refs (sessions and events) | 200 characters |
| Places | 1 to 1000 |
| Pay | 0 to 100,000 pence an hour |
| Post / meeting point and uniform / instructions / names | 200 / 300 / 2,000 / 200 characters |
| Requirements | 20 codes |
| Cancellations | 100 a page |
| Live keys | 10 per firm |

## Versioning

`/api/v1` only ever gains things: new optional fields, calls, error codes or webhook types. A
change that would break a planner becomes `/api/v2`.
