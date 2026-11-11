// The answer library's limits (Phase 35), shared by the table's checks (src/lib/db/schema/
// answers.ts) and the office's form. Browser-safe: no imports.
export const ANSWER_NAME_MAX = 60;
export const ANSWER_BODY_MAX = 600;
export const ANSWER_EXAMPLES_MAX = 10; // lines
export const ANSWER_EXAMPLE_MAX = 100; // characters a line
// Words longer than this go by text in several parts (a text is 160 characters, fewer with an
// emoji); the form says so (Phase 35, the guardrails review, L1). Not a limit.
export const ANSWER_TEXT_PARTS_AT = 300;
