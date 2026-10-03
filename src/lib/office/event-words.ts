import { noticeText } from "../portal/cancel-reasons";
import { ISSUE_LABELS, type PayIssue } from "../portal/pay-query-kinds";
import { KIND_NAMES } from "../portal/request-kinds";
import { dayLabel } from "../rules/reasons";

// The action log in plain words for the office (docs/screens.md: short sentences, plain words): a
// shift's history on its page, and the action log (`/office/log`). Pure: the caller passes the
// names of the people, office users and credential types the events mention. Every action the app
// records has words here (tests/unit/office.log-types.test.ts).

export interface LoggedEvent {
  action: string;
  actorType: string;
  actorId: string | null;
  data: Record<string, unknown>;
}

export interface Names {
  worker: (id: unknown) => string;
  office: (id: unknown) => string;
  credential?: (code: unknown) => string; // a credential type's name ("SIA door supervisor licence")
}

const LINK_REFUSED: Record<string, string> = {
  expired: "it had run out",
  used: "it had been used already",
};

const FIELD_WORDS: Record<string, string> = {
  startsAt: "start",
  endsAt: "finish",
  role: "role",
  siteId: "site",
  headcount: "places",
  instructions: "instructions",
};

const CODE_WORDS: Record<string, string> = {
  started: "it had started",
  rest: "too little rest",
  weekly_hours: "over the weekly hours",
  unavailable: "marked as a day off",
};

const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

const hours = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? noticeText(n) : null;
};

const INTENT_WORDS: Record<string, string> = {
  shifts: "open shifts",
  cancel: "cancelling",
  pay: "pay",
  office: "for the office",
};

const IMPORT_KIND_WORDS: Record<string, string> = {
  workers: "a file of staff",
  credentials: "a file of licences and cards",
  shifts: "a file of shifts",
  pay: "a pay file",
};

const queryCount = (n: unknown) => (Number(n ?? 0) === 1 ? "1 query" : `${Number(n ?? 0)} queries`);

export function eventWords(e: LoggedEvent, names: Names): string {
  const d = e.data;
  const byOffice = d.by === "firm" || e.actorType === "office";
  const officeName = e.actorType === "office" ? names.office(e.actorId) : "The office";
  const worker = names.worker(d.workerId);
  // Whoever did it: a worker or an office user logging in, say.
  const who =
    e.actorType === "worker"
      ? names.worker(e.actorId)
      : e.actorType === "office"
        ? names.office(e.actorId)
        : "Someone";
  const credential = (code: unknown) =>
    names.credential?.(code) ?? String(code ?? "credential").replace(/_/g, " ");
  const kind = (type: unknown) => (KIND_NAMES[String(type)] ?? "a request").toLowerCase();
  const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const day = (v: unknown) => (isDay(v) ? ` (${dayLabel(v)})` : "");
  const period = (from: unknown, to: unknown) =>
    isDay(from) && isDay(to) ? ` (${dayLabel(from)} to ${dayLabel(to)})` : "";
  switch (e.action) {
    case "shift.created":
      return e.actorType === "office" ? `Created by ${officeName}.` : "Shift created.";
    case "shift.changed": {
      const fields = Array.isArray(d.fields)
        ? d.fields.map((f) => FIELD_WORDS[String(f)] ?? String(f))
        : [];
      const what = fields.length > 0 ? `Changed the ${list(fields)}.` : "Changed.";
      return e.actorType === "office" ? `${officeName}: ${what}` : what;
    }
    case "shift.assigned": {
      const overridden = Array.isArray(d.overridden)
        ? d.overridden.map((c) => CODE_WORDS[String(c)] ?? String(c))
        : [];
      if (!byOffice) return `${worker} took it.`;
      const override =
        overridden.length > 0
          ? ` Allowed despite: ${list(overridden)}.${typeof d.reason === "string" ? ` Reason: ${d.reason}` : ""}`
          : "";
      return `${officeName} placed ${worker}.${override}`;
    }
    case "shift.booking_refused":
      return `${worker} couldn't be booked (the rules said no).`;
    case "shift.booking_held":
      return `${worker} tried before the place opened to them (fair rotation).`;
    case "shift.cancelled": {
      const notice = hours(d.noticeHours);
      const who = byOffice ? `${officeName} cancelled ${worker}` : `${worker} cancelled`;
      const reason = byOffice && typeof d.reason === "string" ? ` Reason: ${d.reason}.` : "";
      return `${who}${notice ? `, with ${notice}` : ""}.${reason}`;
    }
    case "shift.moved":
    case "shift.curtailed": {
      const notice = hours(d.noticeHours);
      const what = e.action === "shift.moved" ? "moved" : "shortened";
      const reason = typeof d.reason === "string" ? ` Reason: ${d.reason}.` : "";
      const rules =
        d.rulesOk === false ? " The rules said they may not be able to work the new time." : "";
      return `${officeName} ${what} ${worker}'s shift${notice ? `, with ${notice}` : ""}.${reason}${rules}`;
    }
    case "shift.completed":
    case "shift.no_show": {
      const what = e.action === "shift.completed" ? "worked" : "not attended";
      const was =
        d.from === "completed"
          ? " (was: worked)"
          : d.from === "no_show"
            ? " (was: not attended)"
            : "";
      return `${officeName} marked ${worker} as ${what}${was}.`;
    }
    case "shift.move_refused":
      return `${officeName} tried to move the shift. Not moved: someone booked can't work the new time.`;
    case "shift.cancelled_by_firm":
      return `${officeName} cancelled the shift.${typeof d.reason === "string" ? ` Reason: ${d.reason}.` : ""}`;
    case "shift.change_notice":
      return `Telling ${worker} about the change.`;
    case "shift.change_notice_sent":
      return `${worker} was told about the change.`;
    case "shift.change_notice_failed":
      return `Telling ${worker} about the change failed.`;
    case "shift.change_notice_held":
      return d.afterStart
        ? `Telling ${worker} waits for quiet hours to end, after the start: phone them.`
        : `Telling ${worker} waits for quiet hours to end.`;
    case "shift.change_notice_skipped":
      if (d.reason === "erased") return "A deleted worker wasn't told about a change (no number).";
      return d.reason === "unchanged"
        ? `${worker} wasn't told: the shift is back to what they knew.`
        : `${worker} wasn't told about an older change (there's a newer one, or they're not booked).`;
    case "shift.marked_urgent":
      return d.cause === "office"
        ? `${officeName} marked it urgent.`
        : "Marked urgent after a dropout.";
    case "shift.urgent_cleared":
      return `${officeName} marked it not urgent.`;
    case "shift.closed":
      return `${officeName} marked it as filled.`;
    case "shift.reopened":
      return `${officeName} opened it again.`;
    case "shift.escalated":
      return "Still unfilled: the office was emailed.";
    case "shift.escalation_emailed":
      return `Emailed ${names.office(d.officeUserId)} that it's still unfilled.`;
    case "shift.escalation_failed":
      return `The "still unfilled" email to ${names.office(d.officeUserId)} couldn't be sent.`;
    case "offer.sent":
      return d.offeredBy
        ? `${names.office(d.offeredBy)} offered it to ${worker}.`
        : `Offered to ${worker}${d.wave ? ` (wave ${String(d.wave)})` : ""}.`;
    case "offer.send_failed":
      return `The offer to ${worker} couldn't be sent.`;
    case "offer.office_queued":
      return `${officeName} asked to offer it to ${worker}.`;
    case "offer.office_not_sent":
      return `The offer to ${worker} wasn't sent.`;
    case "offer.office_held":
    case "offer.wave_held":
      return "Offers waiting for quiet hours to end.";
    case "offer.waves_stopped":
      return "Offers stopped.";
    case "offer.closed":
      return `Offers still waiting were closed: ${String(d.filledElsewhere ?? 0)} filled by someone else${
        Number(d.accepted ?? 0) > 0 ? `, ${String(d.accepted)} taken by the people placed` : ""
      }.`;
    case "shift.reminder_sent":
      return `Reminder sent to ${worker}.`;
    case "shift.reminder_failed":
      return `The reminder to ${worker} couldn't be sent.`;
    case "shift.reminder_skipped":
      return `No reminder for ${worker} (quiet hours).`;
    case "shift.status_changed":
      return `The rota sheet changed it from ${String(d.from ?? "?")} to ${String(d.to ?? "?")}.`;

    // Requests.
    case "message.received": {
      const voicemail = d.channel === "voice";
      const kind = d.channel === "sms" ? "text" : "WhatsApp";
      if (d.handledAs === "opt_out") {
        const word = d.optOut === "start" ? "START" : "STOP";
        return d.workerId
          ? `${worker} texted ${word} to the shifts line.`
          : `Someone texted ${word} to the shifts line from a number that isn't one of your staff's.`;
      }
      const what = voicemail ? "A voicemail was left on" : `A ${kind} came to`;
      if (d.handledAs === "unknown") {
        return d.formerWorker
          ? `${what} the shifts line from someone who isn't active any more.`
          : `${what} the shifts line from a number that isn't one of your staff.`;
      }
      return voicemail
        ? `${who} left a voicemail on the shifts line (for the office).`
        : `${who} sent a ${kind} to the shifts line (${INTENT_WORDS[String(d.intent)] ?? "a message"}${d.handledAs === "ai" ? ", sorted by AI" : ""}).`;
    }
    case "call.received":
      return d.withheld
        ? "Someone rang the shifts line from a withheld number."
        : "Someone rang the shifts line. A login link was asked for (it goes only to your staff's numbers).";
    case "message.replied":
      if (d.reply === "sms_stopped") return `${worker} was told by text that texts are off.`;
      if (d.reply === "sms_started") return `${worker} was told by text that texts are back on.`;
      return d.reply === "unknown_number"
        ? "The shifts line asked a number we don't know for their full name."
        : `${worker} got the shifts line's reply (${INTENT_WORDS[String(d.intent)] ?? "a message"}).`;
    case "message.reply_failed":
      if (d.reply === "sms_stopped" || d.reply === "sms_started") {
        return `The text telling ${worker} texts are ${d.reply === "sms_stopped" ? "off" : "back on"} couldn't be sent.`;
      }
      return d.reply === "unknown_number"
        ? "The shifts line's reply to a number we don't know couldn't be sent."
        : `The shifts line's reply to ${worker} couldn't be sent.`;
    case "message.office_alerted": {
      const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);
      const failed = Number(d.failed ?? 0);
      return `The office was emailed about a message from ${d.reason === "former_worker" ? "someone who isn't active any more" : "a number we don't know"} (${people(Number(d.recipients ?? 0))}${failed > 0 ? `; ${failed} couldn't be emailed` : ""}).`;
    }
    case "message.office_alert_failed":
      return "Emailing the office about a message from a number we don't know failed.";
    case "message.office_alert_skipped":
      return "Nobody in the office could be emailed about a message from a number we don't know (no active admin or resourcer with an email address). It's on Today.";
    case "request.created":
      return `${worker} sent a request (${kind(d.type)}).`;
    case "request.approved":
    case "request.declined": {
      const what = e.action === "request.approved" ? "approved" : "declined";
      return `${officeName} ${what} ${worker}'s request (${kind(d.type)})${d.withNote ? ", with a note" : ""}.`;
    }
    case "request.update_notice":
      return `Telling ${worker} the answer to their request.`;
    case "request.update_sent":
      return `${worker} was told the answer to their request.`;
    case "request.update_failed":
      return `Telling ${worker} the answer to their request failed.`;
    case "request.update_held":
      return `Telling ${worker} the answer waits for quiet hours to end.`;

    // Credentials.
    case "credential.added":
      return `${credential(d.type)} added for ${worker}.`;
    case "credential.updated":
      return `${worker}'s ${credential(d.type)} was updated.`;
    case "credential.expired":
      return `${worker}'s ${credential(d.type)} has expired${d.notified ? ": they were told" : ""}.`;
    case "credential.expiry_warning":
      return `${worker} was told their ${credential(d.type)} expires soon.`;
    case "credential.weekly_list_sent":
      return "The weekly list of expiring credentials was emailed to the office.";
    case "firm.branding_changed": {
      const FIELD_WORDS: Record<string, string> = {
        name: "name",
        colour: "colour",
        logo: "logo",
        signOff: "sign-off",
      };
      const fields = Array.isArray(d.fields)
        ? d.fields.map((f) => FIELD_WORDS[String(f)] ?? "brand")
        : [];
      const list =
        fields.length > 1
          ? `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`
          : (fields[0] ?? "brand");
      return `The firm's ${list} changed.`;
    }
    case "firm.created":
      return "The firm was set up on ShiftDesk.";
    case "office_user.added": {
      const ROLE: Record<string, string> = {
        admin: "an admin",
        resourcer: "a resourcer",
        payroll: "a payroll user",
      };
      return `Office access was given to ${ROLE[String(d.role)] ?? "someone"}.`;
    }
    case "firm.settings_changed": {
      const n = Array.isArray(d.keys) ? d.keys.length : 0;
      return `The firm's settings changed (${n === 1 ? "1 setting" : `${n} settings`}).`;
    }
    case "firm.domain_changed":
      switch (d.change) {
        case "set":
          return d.verified
            ? "The firm's own web address was set and verified: it works now."
            : "The firm's own web address was set. It works once its DNS points to us.";
        case "verified":
          return "The firm's own web address was verified: it works now.";
        case "unverified":
          return "The firm's own web address no longer points to us: it doesn't work until it does again.";
        default:
          return "The firm's own web address was removed.";
      }
    case "worker.data_exported":
      return `${officeName} downloaded ${worker}'s data (${d.format === "csv" ? "CSV" : "JSON"}).`;
    case "worker.erased":
      return `${officeName} deleted a worker's personal details. Their shift history stays, without a name.`;
    case "firm.data_exported":
      return `${officeName} downloaded all the firm's data (${Number(d.rows ?? 0)} rows).`;
    case "retention.purged": {
      const n = (key: string) => Number(d[key] ?? 0);
      const logins = n("throttle") + n("loginLinks") + n("sessions") + n("codes");
      return `Old data was deleted on schedule: ${n("messages")} messages and ${n("requestNotes")} request notes over 90 days old, ${logins} old login records.`;
    }
    case "credential_pack.applied":
      return "The credential rules for the firm's sector were set up.";

    // Workers.
    case "worker.added":
      return `${worker} was added.`;
    case "worker.linked":
      return `${worker} was matched to the rota sheet.`;
    case "worker.updated":
      return `${worker}'s details were updated.`;
    case "worker.notification_settings_changed":
      return `${worker} changed how we reach them.`;
    case "worker.sms_opted_out":
      return `${who} turned off texts (replied STOP). No texts go to them until they reply START.`;
    case "worker.sms_opted_in":
      return `${who} turned texts back on (replied START).`;
    case "worker.unavailable_added":
      return `${worker} marked a day off${day(d.day)}.`;
    case "worker.unavailable_removed":
      return `${worker} removed a day off${day(d.day)}.`;
    case "push.subscribed":
      return `${worker} switched on notifications on a phone.`;
    case "push.unsubscribed":
      return `${worker} switched off notifications on a phone.`;
    case "push.forgotten":
      return `A phone of ${worker}'s stopped taking notifications.`;

    // Logins.
    case "auth.link_requested":
      if (d.kind === "office") {
        return `An office login link was asked for${d.matched ? "" : " (an address we don't know)"}.`;
      }
      if (!d.matched) return "A login link was asked for (a number we don't know).";
      return d.workerId ? `${worker} asked for a login link.` : "A worker asked for a login link.";
    case "auth.link_sent":
      if (d.purpose === "office_login") return "Login link sent to an office user.";
      return d.workerId ? `Login link sent to ${worker}.` : "Login link sent to a worker.";
    case "auth.link_rejected":
      return `A login link was refused: ${LINK_REFUSED[String(d.reason)] ?? "it wasn't valid"}.`;
    case "auth.login":
      return `${who} logged in.`;
    case "auth.logout":
      return `${who} logged out.`;
    case "auth.session_rotated":
      return `${who} stayed logged in (session renewed).`;
    case "auth.otp_requested":
      return `${who} asked for a code to see their pay.`;
    case "auth.otp_sent":
      return d.workerId ? `A pay-page code was sent to ${worker}.` : "A pay-page code was sent.";
    case "auth.otp_verified":
      return `${who} opened their pay page.`;
    case "auth.otp_failed":
      return `${who} typed a wrong code${typeof d.attemptsLeft === "number" ? ` (${d.attemptsLeft} tries left)` : ""}.`;
    case "auth.otp_locked":
      return `${who}'s code stopped working after too many wrong tries.`;
    case "auth.rate_limited":
      return "Too many tries: logging in was paused for a while.";

    // The rota sheet and imports.
    case "roster.synced":
      return `The rota sheet was read${typeof d.shifts === "number" ? ` (${d.shifts} shifts)` : ""}.`;
    case "roster.sync_failed":
      return "Reading the rota sheet failed.";
    case "roster.sheet_conflict":
      return d.holderNotInSheet
        ? "Someone booked on this shift in the app isn't in the rota sheet's staff list."
        : "The rota sheet names someone the app couldn't book on this shift.";
    case "roster.sheet_booking_refused":
      return `${worker} is in the rota sheet but couldn't be booked (the rules said no).`;
    case "import.completed":
      return `${officeName} imported ${IMPORT_KIND_WORDS[String(d.kind)] ?? "a file"}: ${Number(d.created ?? 0)} added, ${Number(d.updated ?? 0)} changed, ${Number(d.skipped ?? 0)} skipped.`;
    case "pay_record.imported":
      return `A pay record was added for ${worker}${period(d.periodStart, d.periodEnd)}.`;
    case "pay_query.created": {
      const issue = (ISSUE_LABELS[String(d.issueType) as PayIssue] ?? "pay").toLowerCase();
      return `${worker} raised a pay query (${issue}${isDay(d.workDate) ? `, ${dayLabel(d.workDate)}` : ""}).`;
    }
    case "pay_record.updated":
      return `${worker}'s pay record was updated.`;
    case "pay_query.in_digest":
      return "A pay query was added to the pay digest.";
    case "pay_query.resolved":
      return `${officeName} sorted ${worker}'s pay query and wrote them a note.`;
    case "pay_query.update_notice":
      return `Telling ${worker} their pay query is sorted.`;
    case "pay_query.update_sent":
      return `${worker} was told their pay query is sorted.`;
    case "pay_query.update_failed":
      return `Couldn't tell ${worker} their pay query is sorted: the message failed.`;
    case "pay_query.update_held":
      return `${worker} will be told their pay query is sorted when quiet hours end.`;
    case "pay_query.regrouped":
      return `${Number(d.changed ?? 0) === 1 ? "1 waiting pay query" : `${Number(d.changed ?? 0)} waiting pay queries`} moved to the group that matches the pay records now.`;
    case "pay_query.back_to_open":
      return "A pay query went back to wait for the next pay digest (the email couldn't be sent).";
    case "pay_digest.sending":
      return `${e.actorType === "office" ? `${officeName} asked for the pay digest. ` : ""}Sending the pay digest to payroll (${queryCount(d.queries)}).`;
    case "pay_digest.sent":
      return `The pay digest went to payroll: ${queryCount(d.queries)} to ${Number(d.recipients ?? 0) === 1 ? "1 person" : `${Number(d.recipients ?? 0)} people`}.`;
    case "pay_digest.failed":
      return `The pay digest couldn't be sent. Its ${queryCount(d.queries)} will be in the next one.`;
    case "pay_digest.skipped":
      return d.reason === "no_recipients"
        ? `No pay digest: there's no one in payroll with an email address (${queryCount(d.queries)} waiting).`
        : "No pay digest: no new pay queries.";
    case "metrics.baseline_saved":
      return `${officeName} saved the pilot baseline${isDay(d.weekStart) ? ` (the week of ${dayLabel(d.weekStart)})` : ""}.`;
    case "metrics.tally_saved":
      return `${officeName} saved the weekly tally${isDay(d.weekStart) ? ` (the week of ${dayLabel(d.weekStart)})` : ""}.`;
    case "site.created":
      return "A site was added from the rota sheet.";
    default:
      return `Recorded: ${e.action}.`;
  }
}
