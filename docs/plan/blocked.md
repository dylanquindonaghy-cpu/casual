# Blocked: what waits, and on whom

Started on 2026-10-29 (PLAN.md P1.3) from `PLAN.md`'s open boxes and items, and the overnight log's
"BLOCKED, not ticked" entries, so `/next-task` and `/overnight` skip these without reading the logs.
Each is built as far as it can be on made-up data, or can't start yet; what's left needs a person,
an account, a signed agreement or a decision. When something here is unblocked, take it off; when
a task gets blocked, add it with what it waits for. The reasons are today's: some changed since the
overnight log recorded them (AWS was ruled out, ADR-021; Claude now comes through the Anthropic API,
not Bedrock; Phase 15's texts replace the WhatsApp and Twilio items of Phases 4 and 7, Dylan,
2026-10-19). The DPA is the data processing agreement signed with the agreement (Gate B).

| Task (in `PLAN.md`) | Waits for | On whom |
|---|---|---|
| Gate A, demand | the discovery calls | Dylan |
| Gate B, commitment (and every use of real data: golden rule 7) | a signed paid pilot: the agreement and the DPA | Dylan and the firm |
| Gate C, value | the pilot's fourth week | the pilot |
| Phase 4: web push (VAPID) | the browser makers' push services and a key of ours, tried on real phones | Dylan |
| Phase 4: WhatsApp templates via Twilio; templates submitted to Meta | nothing: replaced by Phase 15's texts (a Meta account only if WhatsApp ever comes back) | Dylan |
| Phase 6: pay queries grouped, "Haiku summarises" | an Anthropic account and key (`AI_TRANSPORT=anthropic`); the grouping keys themselves are built | Dylan |
| Phase 7: the shifts line, inbound WhatsApp, unknown numbers, call-to-text | nothing: replaced by Phase 15's texts | Dylan |
| Phase 7: STOP handling for SMS | Phase 15's replies by text (the third task) | the firm |
| Phase 8: the server, Compose deploy, backups and alerts, the runbooks tried for real | a UK or EU Docker host and its account (ADR-021) | Dylan |
| Phase 8: the Twilio fallback (calls forward to the manager's phone) | Twilio; whether it stays now texts go through Phase 15 is Dylan's call (`docs/architecture.md` still relies on it) | Dylan |
| Phase 9: real data imported, the privacy notice line sent, the pre-pilot checklist, the baseline week, a dry-run day, the weekly reviews | Gate B, then the pilot itself | Dylan and the firm |
| Phase 15: texts only (15.1) | Dylan's go-ahead; the text system's details (how a text is sent, the sending number or name; Webex Interact itself confirmed 2026-10-26); a mock-up first, as it changes screens | Dylan and the firm |
| Phase 15: the sender (15.2), live | the firm's Webex Interact account (built and switched off) | the firm |
| Phase 15: replies by text (the third task) | the firm turning replies on, with a dedicated inbound number | the firm |
| Phase 22: every other office page on round 2's parts (22.4) | nothing: Phase 23 replaced round 2's look (left open on purpose, 2026-10-23) | nobody |
| P3: availability out (the proposal's fifth item) | discovery: does AXLR8 keep availability? | Dylan |
| P5: the real connector | the ops portal's API documentation and a test copy; the agreement and the DPA | Dylan (arranging access) and the firm |
| P6: attendance and pay lines | the ops portal's API documentation and a test copy (the API exists: answer O1); its "Still coming?" button, a mock-up first | Dylan (arranging access) and the firm |
| P7: the inbox live | an email provider (its ADR is Dylan's); the firm's IT allowing the Microsoft 365 forward | Dylan and the firm's IT |
| P7.4: the inbox's sorting | the office log's words for `email.received` (the UI chat's, for now) | the UI chat |
| P7.5: the casual's answer by a link, the office's summary email | Dylan's words; the screens (Enquiries showing emails, the AI-drafted reply), a mock-up first | Dylan and the UI chat |
| The screens and words after the UI chat's Phase 24: P2.7, P3's readers and "who asked", P4's office half, P5's sync card and words, P8 | a mock-up at Dylan's real sizes, then his approval (CLAUDE.md, "How to work each task") | Dylan |
| Payroll's year-end rule | the firm's payroll (`docs/discovery-axlr8.md` §5, item 5) | the firm |
