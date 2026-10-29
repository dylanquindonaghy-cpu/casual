# Blocked: what waits, and on whom

Started on 2026-10-29 (PLAN.md P1.3) from `PLAN.md`'s open boxes and the overnight log's "BLOCKED,
not ticked" entries, so `/next-task` and `/overnight` can skip these without reading the logs. Each
task here is built as far as it can be on made-up data; what's left needs a person, an account or a
signed agreement. When something here is unblocked, take it off; when a task gets blocked, add it
with what it waits for. The reasons are today's: some changed since the overnight log recorded them
(AWS was ruled out, ADR-021; Claude now comes through the Anthropic API, not Bedrock; Phase 15's
texts replace Twilio, Dylan, 2026-10-19).

| Task (in `PLAN.md`) | Waits for | On whom |
|---|---|---|
| Gate A, demand | the discovery calls | Dylan |
| Gate B, commitment (and every use of real data: golden rule 7) | a signed paid pilot: the agreement and the DPA | Dylan and the firm |
| Gate C, value | the pilot's fourth week | the pilot |
| Phase 4: web push (VAPID) | the browser makers' push services and a key of ours, tried on real phones | Dylan |
| Phase 4: WhatsApp templates via Twilio; templates submitted to Meta | replaced by Phase 15's texts (Dylan, 2026-10-19); a Meta account if WhatsApp ever comes back | Dylan |
| Phase 6: pay queries grouped, "Haiku summarises" | an Anthropic account and key (`AI_TRANSPORT=anthropic`); the grouping keys themselves are built | Dylan |
| Phase 7: the shifts line, inbound WhatsApp, unknown numbers, call-to-text, STOP | replaced by Phase 15's texts (Dylan, 2026-10-19), except STOP, which comes with Phase 15's replies | Dylan and the firm |
| Phase 8: the server, Compose deploy, backups and alerts, the Twilio fallback, the runbooks tried for real | a UK or EU Docker host and its account (ADR-021); the fallback goes with Twilio | Dylan |
| Phase 9: real data imported, the privacy notice line sent, the pre-pilot checklist, the baseline week, a dry-run day, the weekly reviews | Gate B, then the pilot itself | Dylan and the firm |
| Phase 15: texts only (15.1) | Dylan's go-ahead; the firm confirming Webex Interact | Dylan and the firm |
| Phase 15: the sender (15.2), live | the firm's Webex Interact account (built and switched off) | the firm |
| Phase 15: replies by text | the firm turning replies on, with a dedicated inbound number | the firm |
| Phase 22: every other office page on round 2's parts | the UI chat | the UI chat |
| P5: the real connector | the ops portal's API documentation and a test copy; the agreement and the DPA | the firm |
| P6: attendance and pay lines | the ops portal's API | the firm |
| P3.5: availability out | discovery: does AXLR8 keep availability? | Dylan |
| P7: the inbox live | an email provider (its ADR is Dylan's); the firm's IT allowing the Microsoft 365 forward | Dylan and the firm's IT |
| P7.4: the inbox's sorting | the office log's words for `email.received`, and Enquiries (the UI chat) | Dylan and the UI chat |
| P7.5: the office's summary email | Dylan's words | Dylan |
| Payroll's year-end rule | the firm's payroll (`docs/discovery-axlr8.md` §5.5) | the firm |
