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
      "booking.kept",
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
      "shift.escalation_emailed",
      "shift.escalation_failed",
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
      "offer.closed",
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
      "credential.expiry_warning_failed",
      "credential.expiry_notice_sent",
      "credential.expiry_notice_failed",
      "credential.weekly_list_sent",
      "credential.weekly_list_failed",
      "push.subscribed",
      "push.unsubscribed",
      "push.forgotten",
      "message.received",
      "call.received",
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
      "worker.sms_opted_out",
      "worker.sms_opted_in",
      "worker.unavailable_added",
      "worker.unavailable_removed",
      "worker.deactivated",
      "worker.reactivated",
      "worker.unblocked",
      "worker.signed_out",
      "worker.site_blocked",
      "worker.site_unblocked",
    ],
  },
  logins: {
    label: "Logins",
    actions: [
      "auth.link_requested",
      "auth.link_sent",
      "auth.link_send_failed",
      "auth.link_rejected",
      "auth.login",
      "auth.logout",
      "auth.session_rotated",
      "auth.otp_requested",
      "auth.otp_sent",
      "auth.otp_send_failed",
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
  data: {
    label: "Data requests and deletion",
    actions: ["worker.data_exported", "worker.erased", "firm.data_exported", "retention.purged"],
  },
  firm: {
    label: "Firm settings and office team",
    actions: [
      "firm.created",
      "office_user.added",
      "office_user.disabled",
      "office_user.enabled",
      "office_user.role_changed",
      "office_user.signed_out",
      "firm.settings_changed",
      "firm.branding_changed",
      "firm.domain_changed",
      "firm.agreement_recorded",
    ],
  },
  sheet: {
    label: "Rota sheet and imports",
    actions: [
      "roster.source_connected",
      "roster.source_disabled",
      "roster.source_forgotten",
      "roster.synced",
      "roster.sync_failed",
      "roster.sheet_conflict",
      "roster.sheet_change_refused",
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
