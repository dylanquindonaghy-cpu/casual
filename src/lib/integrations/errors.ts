// The planner API's error answers (docs/office-v2.md 5.3.2 "Errors"; docs/integrations.md lists
// them all): each code's HTTP status and its one plain sentence. The body is always
// {"error": {"code", "message", "request_id"}} (src/lib/integrations/api.ts adds the request id),
// and a value sent in is never echoed back: messages are fixed words, and validation_failed names
// only the field's path and what was wrong with it.

export const API_ERRORS = {
  bad_json: { status: 400, message: "The body isn't valid JSON." },
  validation_failed: {
    status: 400,
    message: "Some fields aren't right. Each one is listed in fields, with what was wrong.",
  },
  bad_ref: {
    status: 400,
    message:
      "A ref is 1 to 200 letters, digits, dots, underscores, colons or hyphens, and starts and ends with a letter or a digit.",
  },
  bad_since: {
    status: 400,
    message:
      "Send since= as an ISO 8601 time with an offset, or cursor= from an earlier page, not both.",
  },
  bad_cursor: {
    status: 400,
    message: "That cursor isn't one ShiftDesk gave. Start again with since=.",
  },
  invalid_key: { status: 401, message: "The API key is missing, wrong or revoked." },
  agreement_not_recorded: {
    status: 403,
    message:
      "Your firm's agreement with ShiftDesk isn't recorded yet, so nothing can be saved. Ask ShiftDesk to record it.",
  },
  not_found: { status: 404, message: "There's nothing here with that ref." },
  method_not_allowed: {
    status: 405,
    message: "This address doesn't take that method. The Allow header lists the ones it does.",
  },
  session_started: {
    status: 409,
    message: "This session has started, or would start in the past, so it can't be changed.",
  },
  session_cancelled: {
    status: 409,
    message:
      "This session is cancelled and can't be opened again. Send a new ref for a new session.",
  },
  session_has_bookings: {
    status: 409,
    message:
      "Casuals are booked on this session, so its role and requirements can't change. Nothing was changed. Ask the office to cancel those bookings first.",
  },
  places_below_booked: {
    status: 409,
    message:
      "A booking holds a place above that number. Ask the office to cancel it, or send more places.",
  },
  bookings_block_change: {
    status: 409,
    message:
      "The rules say some booked casuals can't work the new time or site. Nothing was changed. Each one is listed in casuals, with the rules' codes.",
  },
  site_postcode_differs: {
    status: 409,
    message:
      "This site already has a different postcode. Change it in ShiftDesk Settings, or send a different site name.",
  },
  too_big: { status: 413, message: "The body is over 64 KB." },
  not_json: { status: 415, message: "Send JSON, with content-type: application/json." },
  change_reason_required: {
    status: 422,
    message:
      "Send a change_reason: it's needed to cancel a session, and to move one that has bookings.",
  },
  unknown_role: {
    status: 422,
    message:
      "That role isn't one of your firm's role codes. Nothing was created. They're listed under Codes your planner can use, on ShiftDesk's Integrations page.",
  },
  unknown_requirement: {
    status: 422,
    message:
      "A requirement isn't one of your firm's qualification codes. They're listed under Codes your planner can use, on ShiftDesk's Integrations page.",
  },
  unknown_postcode: {
    status: 422,
    message: "That postcode wasn't found. Check it and send it again.",
  },
  rate_limited: {
    status: 429,
    message: "Too many calls. Wait for Retry-After seconds, then try again.",
  },
  internal_error: {
    status: 500,
    message: "Something went wrong at ShiftDesk. Try again in a minute.",
  },
  lookup_failed: {
    status: 503,
    message:
      "The postcode couldn't be looked up just now. Nothing was saved. Try again in a minute.",
  },
  not_configured: {
    status: 503,
    message: "The planner API isn't switched on for this ShiftDesk yet.",
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ApiErrorCode = keyof typeof API_ERRORS;
export const API_ERROR_CODES = Object.keys(API_ERRORS) as ApiErrorCode[];
