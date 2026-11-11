// Where a pay question that's really a dispute goes: a pay query, which reaches payroll's digest
// (golden rule 9; docs/messaging-templates.md). Browser-safe, no imports: the office's answer form
// shows the library's hint in its preview (src/lib/answers/render.ts).

// After the built-in pay reply's link to the pay page ("there").
export const PAY_QUERY_HINT =
  "If something looks wrong, tap 'Raise a pay query' there, so payroll sees it.";

// After one of the firm's own answers that tells a casual about her pay (Phase 35: its words use a
// pay fill-in, {next_pay_day}, {pay_cycle} or {pay_link}; the guardrails review, M1). Added by code,
// on texts, the app and email; its words stand alone, since the answer may hold no link.
export const ANSWER_PAY_HINT =
  "If your pay looks wrong, tap 'Raise a pay query' on your pay page, so payroll sees it.";
