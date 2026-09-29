// The action log's "type" filter (docs/screens.md `/office/log`): every event kind the app records,
// in one plain group. tests/unit/office.log-types.test.ts scans the code for recorded actions and
// fails if one isn't listed here (or has no words in event-words.ts).

export const LOG_TYPES = {
  bookings: {
    label: "Bookings",
    actions: [
      "shift.assigned",
      "shift.booking_held",
      "shift.booking_refused",
      "roster.sheet_booking_refused",
    ],
  },
  cancellations: {
    label: "Cancellations",
    actions: ["shift.cancelled", "shift.cancelled_by_firm"],
  },
  changes: {
    label: "Changes to shifts",
    actions: [
      "shift.created",
      "shift.changed",
      "shift.moved",
      "shift.curtailed",
      "shift.move_refused",
      "shift.status_changed",
      "shift.closed",
      "shift.reopened",
      "shift.marked_urgent",
      "shift.urgent_cleared",
      "shift.escalated",
    ],
  },
  attendance: {
    label: "Who worked",
    actions: ["shift.completed", "shift.no_show"],
  },
  offers: {
    label: "Offers",
    actions: [
      "offer.sent",
      "offer.send_failed",
      "offer.office_queued",
      "offer.office_not_sent",
      "offer.office_held",
      "offer.wave_held",
      "offer.waves_stopped",
    ],
  },
  messages: {
    label: "Messages to and from workers",
    actions: [
      "shift.change_notice",
      "shift.change_notice_sent",
      "shift.change_notice_failed",
      "shift.change_notice_held",
      "shift.change_notice_skipped",
      "shift.reminder_sent",
      "shift.reminder_failed",
      "shift.reminder_skipped",
      "request.update_notice",
      "request.update_sent",
      "request.update_failed",
      "request.update_held",
      "credential.expiry_warning",
      "credential.weekly_list_sent",
      "push.subscribed",
      "push.unsubscribed",
      "push.forgotten",
      "message.received",
      "message.replied",
      "message.reply_failed",
      "message.office_alerted",
      "message.office_alert_failed",
      "message.office_alert_skipped",
    ],
  },
  requests: {
    label: "Requests",
    actions: ["request.created", "request.approved", "request.declined"],
  },
  credentials: {
    label: "Credentials",
    actions: [
      "credential.added",
      "credential.updated",
      "credential.expired",
      "credential_pack.applied",
    ],
  },
  workers: {
    label: "Workers",
    actions: [
      "worker.added",
      "worker.linked",
      "worker.updated",
      "worker.notification_settings_changed",
      "worker.unavailable_added",
      "worker.unavailable_removed",
    ],
  },
  logins: {
    label: "Logins",
    actions: [
      "auth.link_requested",
      "auth.link_sent",
      "auth.link_rejected",
      "auth.login",
      "auth.logout",
      "auth.session_rotated",
      "auth.otp_requested",
      "auth.otp_sent",
      "auth.otp_verified",
      "auth.otp_failed",
      "auth.otp_locked",
      "auth.rate_limited",
    ],
  },
  pay: {
    // Only that a record was added or changed: never an amount (golden rule 9).
    label: "Pay records and queries",
    actions: [
      "pay_record.imported",
      "pay_record.updated",
      "pay_query.created",
      "pay_query.in_digest",
      "pay_query.back_to_open",
      "pay_query.regrouped",
      "pay_query.resolved",
      "pay_query.update_notice",
      "pay_query.update_sent",
      "pay_query.update_failed",
      "pay_query.update_held",
      "pay_digest.sending",
      "pay_digest.sent",
      "pay_digest.failed",
      "pay_digest.skipped",
    ],
  },
  pilot: {
    label: "Pilot metrics",
    actions: ["metrics.baseline_saved", "metrics.tally_saved"],
  },
  sheet: {
    label: "Rota sheet and imports",
    actions: [
      "roster.synced",
      "roster.sync_failed",
      "roster.sheet_conflict",
      "import.completed",
      "site.created",
    ],
  },
} as const satisfies Record<string, { label: string; actions: readonly string[] }>;

export type LogType = keyof typeof LOG_TYPES;
export const LOG_TYPE_KEYS = Object.keys(LOG_TYPES) as LogType[];

const TYPE_OF = new Map<string, LogType>(
  LOG_TYPE_KEYS.flatMap((key) => LOG_TYPES[key].actions.map((a) => [a, key] as const)),
);

// The group an action is in, as the list shows it ("Offers"); "Other" for one not listed.
export const logTypeLabel = (action: string): string => {
  const key = TYPE_OF.get(action);
  return key ? LOG_TYPES[key].label : "Other";
};

export const isLogType = (value: unknown): value is LogType =>
  typeof value === "string" && Object.hasOwn(LOG_TYPES, value);

export const ALL_LOGGED_ACTIONS: readonly string[] = [...TYPE_OF.keys()];
