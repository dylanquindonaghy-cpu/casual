# Round 8: the office, held up against Haulix (proposal P10; go-ahead 2026-11-02, Phase 26)

Dylan, 2026-11-02, after the office review: "i like these changes but what about the actual look
compared to the link i sent you i dont think its screaming high end professional dashboard yet". He
then sent a 12-second screen recording of the Haulix shot (Phenomenon's "UI/UX Design for Logistics
Dashboard – Haulix" on Dribbble). The recording isn't kept in the repo: it's Phenomenon's design.
The published page shows two of its frames beside the office for comparison:
https://claude.ai/artifact/2cHizkZcrYG7C8U8C1H3cF (`round-8.html` here; opened from this folder it
shows a note where those two frames go).

| File | What it shows |
|---|---|
| `round-8.html` | The comparison, why the office doesn't read as high-end, and the round 8 mock-up of two screens (the dashboard; an event's page) at 1280px and 390px, with four decisions |
| `now/shiftdesk-dashboard-dark.jpg`, `now/shiftdesk-event-dark.jpg` | The live demo's dashboard and the Arena's event page in dark mode, Mon 2 Nov 2026, 1280px |
| `spec.html` | **The exact changes (Phase 26):** every office screen that changes, before and after at 1280px and 390px, and the list of changes under each, which Dylan marks Build, Change or Drop, rewords or adds to (85 changes since the audit added 16; published: https://claude.ai/artifact/EqgPhrjHXB2XMJGFofH6WU; his edits are in that page's database, collection `edits`, keyed by each change's id; opened from this folder it's read-only) |
| `audit.html` | **The pre-build audit (2026-11-02):** how the map and every chart get real data (each one's source in the code and what has to be built), today's office against round 8 measured with the ux-ui-audit probes (7 screens at 1280px and 390px), Parim compared, and the 16 changes it recommends, now the spec page's last section (published: https://claude.ai/artifact/4DRBzVM5k6BLCmfin7Zgff; Parim's help-centre pictures are on the published page only, as with Haulix's frames, so opened from this folder it shows a note where they go) |
| `screens.html` | Every round 8 office screen, one at a time (`screens.html#casuals-phone` and so on: dashboard, event, casuals, cancellations, session, updates, offer, customise): the source of the after pictures |
| `before/*.jpg`, `after/*.jpg` | The pictures on the spec page: the live demo (light, as the admin, Mon 2 Nov 2026) and round 8, `{screen}-{laptop,phone}.jpg` (laptop 1280px; phone 390px at 2x) |
| `built/*.jpg` | What's been built of Phase 26, task by task, from the local app with the demo seed: `26.1-dashboard-{dark,light}-{laptop,phone}.jpg` (the look and the shell; laptop 1280px, phone 390px at 2x); `26.2-dashboard-{dark,light}-{laptop,phone}.jpg` (the whole dashboard page: the venue map without a street map, the card, To offer, Updates and Who worked?) and `26.2-dashboard-streets-{laptop,phone}.jpg` (the venue map with real streets, from Protomaps' public build in a local check: `docs/runbooks.md` "The street map"); `26.3-customise-{laptop,phone}.jpg` (Customise open), `26.3-dashboard-mine-{laptop,phone}.jpg` (the dashboard narrowed to a contract, with the four extra cards) and `26.3-settings-contracts-{laptop,phone}.jpg`; `26.4-updates-{laptop,phone}.jpg` (Updates: Needs action, "Mark all as seen" and "Tell me about"; the demo has no web push key, so "Notifications on this device" says it isn't set up) and `26.4-updates-everything-{laptop,phone}.jpg` (the Everything view); `26.5-event-{laptop,phone}.jpg` (an event's page: the staffing layout and the open places); `26.6-session-{laptop,phone}.jpg` (a session's page: "Casuals for this session" with four asks, the rules' reasons where someone can't be booked, and "This session" with "Casuals ask, you choose" on) and `26.6-session-panel-{laptop,phone}.jpg` (its "Session details" panel); `26.7-casuals-{laptop,phone}.jpg` (Casuals: the four counts, the tabs, reliability on every row), `26.7-casuals-needs-{laptop,phone}.jpg` (Need updating: Remind, Remind all, the "…" menus) and `26.7-casual-page-{laptop,phone}.jpg` (a casual's page: Reliability and Notes); `26.8-cancellations-{laptop,phone}.jpg` (Cancellations: the four counts, the tabs with Every day and Today, Notice and Strike in their own columns, short notice in red), `26.8-cancellations-strikes-{laptop,phone}.jpg` (the Strikes tab) and `26.8-record-{laptop,phone}.jpg` (a record: notice, strike and reason first); `26.9-offer-{laptop,phone}.jpg` (an urgent session's offer page: how each person would be reached, and "Not offered, and why"); `26.10-pay-{laptop,phone}.jpg` (the pay dashboard: "Fri 6 Nov", the week it pays and this week's later pay day; no shifts line), `26.10-log-{laptop,phone}.jpg` (the action log, logins hidden), `26.10-notice-{laptop,phone}.jpg` (the notice report: "4 days' notice", 12px column labels, the demo's history in time order) and `26.10-pilot-{laptop,phone}.jpg` (Pilot metrics, its figures worked out after the reload) |

## What Haulix does (from the recording)

- Near-black, neutral ground (about `#141414`); panels one shade lighter (`#1a1a1a`–`#222`), tiles
  and chips `#252525`; a fine edge, no blur, no coloured glow.
- One accent, a pale lime (`#f3fca8`): the main button ("Activate Route"), the switches, the logo,
  the selected truck's halo. Red, amber, green and blue only on status pills, one code everywhere
  (Critical, High, Normal, Low).
- An icon rail of dark circles, the current page a solid white circle; a top bar of small figure
  chips ("Active: 6/10"), search with a shortcut, alerts with a count, the person.
- The job itself as the hero: a dark map of the fleet with a floating vehicle card (ID, status,
  route progress, speed and fuel gauges, an amber warning, actions); on a vehicle's page, its cargo
  laid out slot by slot beside the package list, one package opened with its facts and actions.
- A detail page: breadcrumb, the ID as the title with a status pill, an action row with one lime
  primary, underline tabs with counts.

## What round 8 proposes

The office only (every page, label and action stays; the casual app keeps its look):

- **The system:** dark by default, neutral charcoal with translucent, sharp glass on the panels and
  the cards in them: see-through over a faint street map behind every page, a light blur, one 1px
  hairline, 12px and 8px corners, no gloss or sheen (Dylan, 2026-11-02: "a bit more glass looking",
  then "by glass i mean translucent and sharp"); shadows only on what floats; one accent, hi-vis yellow (`#e9f86f`, from the stewards' vests) on the main
  button, switches and what's selected; status in one code (Urgent red, Open amber, Booked green,
  Offered blue, Hidden grey); Geist kept, references in Geist Mono; no glass, no wash.
- **The dashboard:** a map of the firm's venues, each pin showing its places to fill (33 across 7
  venues on the demo; red where a session is urgent), the selected session in a floating card
  (time, booked bar and gauge, who can take it, a warning, Offer); To offer, Updates (P9 C) and Who
  worked (P9 D) below.
- **An event's page:** breadcrumb, the event as the title with "Showing to casuals", actions with one
  primary ("Offer 5 open places"), tabs with counts; a "Staffing layout" of every place by role, each
  booked (with who), open or urgent; "Open places" beside it, the urgent one opened (Chloe Quigley's
  cancellation, its facts, "Offer to the best 5").

Every figure and name in the mock-up is the live demo's (made-up people): 51 sessions, 75 places,
42 booked, 33 to fill; the Arena on Sat 7 Nov 18 of 23 booked, with the booked casuals' names; the
five people under Who worked. The map's streets are drawn for the mock-up, not a real place.

## Decisions (in `docs/plan/decisions-waiting.md`, "Office review" 6 to 9; all taken as recommended, 2026-11-02)

Move the office away from glass (round 7, approved 26 Oct); dark by default; hi-vis or the firm's
colour as the accent; a map service for the venue map (MapLibre with a UK or EU tile host, or a
self-hosted map file; without one the dashboard falls back to a cover grid by venue and day).

## How it was made

`design-taste-frontend` (`--app`): the dealt style was `framed-sheet` (light); Dylan's reference is
dark, so its rules were applied to a dark ground instead (his words win over a dealt style). Three
look-and-fix rounds on screenshots at 1280px and 390px. The skill's `inspect.mjs` wasn't run: it
measures a whole page, and these screens are scaled frames inside a review page.
