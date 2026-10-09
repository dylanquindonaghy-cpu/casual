import { noticeText } from "../portal/cancel-reasons";
import { ISSUE_LABELS, type PayIssue } from "../portal/pay-query-kinds";
import { KIND_NAMES } from "../portal/request-kinds";
import { dayLabel } from "../rules/reasons";
import { syncErrorWords } from "../roster/sheets/error-words";
import { REASON_WORDS } from "./worker-reasons";

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
  site?: (id: unknown) => string; // a site's name ("Riverside Arena")
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
  // A session's own details (src/lib/office/shift-editor.ts DETAIL_FIELDS).
  payRatePence: "pay rate",
  post: "post",
  meetingPoint: "meeting point",
  uniform: "uniform",
  requirements: "extra requirements",
};

const CODE_WORDS: Record<string, string> = {
  started: "it had started",
  rest: "too little rest",
  weekly_hours: "over the weekly hours",
  unavailable: "marked as a day off",
};

// Why someone can't work a shift, for the office (every rules check: src/lib/rules/eligibility.ts),
// plus "no place left" for a rota sheet name over the headcount.
export const RULE_WORDS: Record<string, string> = {
  started: "it had started",
  not_active: "not active",
  wrong_role: "not that role",
  no_rule: "no licence rule for the role",
  credential_missing: "a licence or card missing",
  credential_expired: "a licence or card out of date",
  credential_suspended: "a licence suspended",
  applied_over_allowance: "over the day's limit for applications in progress",
  overlap: "booked elsewhere then",
  rest: "too little rest",
  weekly_hours: "over the weekly hours",
  unavailable: "marked as a day off",
  blocked_site: "blocked from the site",
  no_place: "no place left",
  not_found: "their record wasn't found",
  settings_invalid: "the firm's rules settings need fixing",
};

export const ruleWords = (codes: unknown): string => {
  const words = Array.isArray(codes)
    ? [...new Set(codes.map((c) => RULE_WORDS[String(c)] ?? "the rules said no"))]
    : [];
  return words.length > 0 ? list(words) : "the rules said no";
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

// A send logged after the job stopped before it heard back (claim → send → record): it may have
// gone, and it's never sent again.
const unconfirmed = (d: Record<string, unknown>) =>
  d.unconfirmed === true ? " (not confirmed: it may not have arrived)." : ".";

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
      // A cancellation because the client needs fewer staff took a place away (Phase 10 task 19):
      // how many, and why.
      const from = (d.from as { headcount?: unknown } | undefined)?.headcount;
      const to = (d.to as { headcount?: unknown } | undefined)?.headcount;
      const why = typeof d.reason === "string" ? ` Reason: ${d.reason}.` : "";
      const what =
        typeof from === "number" && typeof to === "number"
          ? `Changed the places from ${from} to ${to}.${why}`
          : fields.length > 0
            ? `Changed the ${list(fields)}.`
            : "Changed.";
      return e.actorType === "office" ? `${officeName}: ${what}` : what;
    }
    case "shift.assigned": {
      const overridden = Array.isArray(d.overridden)
        ? d.overridden.map((c) => CODE_WORDS[String(c)] ?? String(c))
        : [];
      if (!byOffice) return `${worker} took it.`;
      // The office's reason is kept on the booking (the shift's page shows it), never in the log;
      // an entry from before that change carries its words.
      const reason =
        typeof d.reason === "string"
          ? ` Reason: ${d.reason}`
          : d.reasonGiven === true
            ? " The office gave a reason (shown with the booking until it's cleared)."
            : "";
      const override =
        overridden.length > 0 ? ` Allowed despite: ${list(overridden)}.${reason}` : "";
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
    case "export.downloaded":
      if (d.kind === "cancellation_pdf")
        return `${officeName} downloaded a cancellation record (PDF).`;
      if (d.kind === "cancellations_csv") {
        const view =
          d.view === "under" ? "short notice" : d.view === "office" ? "by the office" : "all";
        const n = typeof d.rows === "number" ? d.rows : 0;
        return `${officeName} downloaded the cancellations (${view}, ${n} ${n === 1 ? "row" : "rows"}) as a CSV.`;
      }
      return `${officeName} downloaded a file.`;
    case "strike.issued": {
      const notice = hours(d.noticeHours);
      const under =
        typeof d.thresholdHours === "number" ? ` (under ${d.thresholdHours} hours)` : "";
      return `${worker} got a strike for cancelling${notice ? ` with ${notice}` : ""}${under}.`;
    }
    // The evidence email to the strikes team (12C.4).
    case "strike.evidence_queued":
      return "A strike record that waited for the strikes team's email is being sent, now it's confirmed.";
    case "strike.evidence_sending":
      return "Emailing a strike record to the strikes team.";
    case "strike.evidence_sent":
      return "A strike record was emailed to the strikes team.";
    case "strike.evidence_failed":
      if (d.code === "not_set_up")
        return "A strike record wasn't emailed: the strikes team's email isn't confirmed. It goes when it is.";
      if (d.code === "withdrawn")
        return "A strike record wasn't emailed: the strike was withdrawn.";
      if (d.retry === true)
        return "Emailing a strike record didn't reach the email server. Trying again.";
      if (d.code === "EmailNotSentError")
        return "Emailing a strike record didn't reach the email server after 4 tries, so nothing was sent. Resend it from the record.";
      if (d.code === "not_built")
        return "A strike record's email couldn't be put together, so nothing was sent. Resend it from the record.";
      return "Emailing a strike record failed, and it may have arrived. Check with the strikes team, or resend it from the record.";
    case "strike.evidence_resend":
      return `${officeName} asked for a strike record to be emailed to the strikes team again.`;
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
    case "shift.booked_notice":
      return `Telling ${worker} they're booked.`;
    case "shift.booked_notice_sent":
      return `${worker} was told they're booked.`;
    case "shift.booked_notice_failed":
      return `Telling ${worker} they're booked failed.`;
    case "shift.booked_notice_held":
      return d.afterStart
        ? `Telling ${worker} they're booked waits for quiet hours to end, after the start: phone them.`
        : `Telling ${worker} they're booked waits for quiet hours to end.`;
    case "shift.booked_notice_skipped":
      if (d.reason === "erased") return "A deleted worker wasn't told about a booking (no number).";
      if (d.reason === "ended") return `${worker} wasn't told they're booked: the shift is over.`;
      return d.reason === "cancelled"
        ? `${worker} wasn't told they're booked: the booking was cancelled first.`
        : `${worker} wasn't told they're booked: it was already marked as worked or not attended.`;
    case "shift.change_notice_skipped":
      if (d.reason === "erased") return "A deleted worker wasn't told about a change (no number).";
      if (d.reason === "not_told") {
        return `${worker} wasn't told about the change: they hadn't been told about the booking yet (that message gives the shift as it is).`;
      }
      return d.reason === "unchanged"
        ? `${worker} wasn't told: the shift is as they last heard it.`
        : `${worker} wasn't told about an older change (there's a newer one, or they're not booked).`;
    case "shift.marked_urgent":
      return d.cause === "office"
        ? `${officeName} marked it urgent.`
        : "Marked urgent after a dropout.";
    case "shift.urgent_cleared":
      return `${officeName} marked it not urgent.`;
    // The event and session switches (src/lib/office/showing.ts).
    case "event.shown":
    case "session.shown": {
      const what = e.action === "event.shown" ? "the event" : "it";
      const n = Number(d.offersStarted ?? 0);
      const offers =
        n > 0
          ? ` Offers went out again for ${n === 1 ? "1 urgent shift" : `${n} urgent shifts`}.`
          : "";
      return `${officeName} showed ${what} to casuals.${offers}`;
    }
    case "event.hidden":
      return `${officeName} hid the event from casuals. Anyone booked keeps their shift.`;
    case "session.hidden":
      return `${officeName} hid it from casuals. Anyone booked keeps their shift.`;
    case "shift.closed":
      return `${officeName} marked it as filled.`;
    case "shift.reopened":
      return d.source === "csv"
        ? `${officeName}'s import opened it again: it needs more people than it has booked.`
        : `${officeName} opened it again.`;
    case "shift.escalated":
      return "Still unfilled: the office was emailed.";
    case "shift.escalation_emailed":
      return `Emailed ${names.office(d.officeUserId)} that it's still unfilled.`;
    case "shift.escalation_failed":
      return `The "still unfilled" email to ${names.office(d.officeUserId)} couldn't be sent.`;
    case "offer.sent":
      return (
        (d.offeredBy
          ? `${names.office(d.offeredBy)} offered it to ${worker}`
          : `Offered to ${worker}${d.wave ? ` (wave ${String(d.wave)})` : ""}`) + unconfirmed(d)
      );
    case "offer.send_failed":
      return `The offer to ${worker} couldn't be sent.`;
    case "offer.office_queued":
      return `${officeName} asked to offer it to ${worker}.`;
    case "offer.office_not_sent":
      return d.reason === "hidden"
        ? `The offer to ${worker} wasn't sent: the shift is hidden from casuals.`
        : `The offer to ${worker} wasn't sent.`;
    case "offer.office_held":
    case "offer.wave_held":
      return "Offers waiting for quiet hours to end.";
    case "offer.waves_stopped":
      return d.reason === "hidden"
        ? "Offers stopped: it's hidden from casuals."
        : "Offers stopped.";
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
    case "call.answered":
      return d.link === "sent"
        ? "The caller was told a link is on its way (if theirs is a staff number)."
        : "The caller was told a link can't be sent just now.";
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
      // Before Phase 10 the message went first and its details are on this event.
      return `${worker}'s ${credential(d.type)} has expired${
        d.notified ? (d.providerMessageId ? ": they were told" : ": they're being told") : ""
      }.`;
    case "credential.expiry_warning":
      return `${worker} was told their ${credential(d.type)} expires soon${unconfirmed(d)}`;
    case "credential.expiry_warning_failed":
      return `The message telling ${worker} their ${credential(d.type)} expires soon couldn't be sent.`;
    case "credential.expiry_notice_sent":
      return `${worker} was told their ${credential(d.type)} has expired${unconfirmed(d)}`;
    case "credential.expiry_notice_failed":
      return `The message telling ${worker} their ${credential(d.type)} has expired couldn't be sent.`;
    case "credential.weekly_list_sent":
      return "The weekly list of expiring credentials was emailed to the office.";
    case "credential.weekly_list_failed":
      return `The weekly list of expiring credentials couldn't be emailed to ${names.office(d.officeUserId)}.`;
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
    // Office access (src/lib/office/team.ts): by an admin on the team page, or by ShiftDesk from the
    // command line (the system), in the passive.
    case "office_user.disabled":
    case "office_user.enabled":
    case "office_user.role_changed":
    case "office_user.signed_out": {
      const person = names.office(d.officeUserId);
      const ROLE: Record<string, string> = {
        admin: "Admin",
        resourcer: "Resourcer",
        payroll: "Payroll",
      };
      const admin = e.actorType === "office" ? names.office(e.actorId) : null;
      switch (e.action) {
        case "office_user.disabled": {
          const out =
            Number(d.sessionsEnded) > 0 || Number(d.linksSpent) > 0
              ? " They were logged out everywhere."
              : "";
          return admin
            ? `${admin} turned off ${person}'s office access.${out}`
            : `${person}'s office access was turned off.${out}`;
        }
        case "office_user.enabled":
          return admin
            ? `${admin} turned ${person}'s office access back on.`
            : `${person}'s office access was turned back on.`;
        case "office_user.role_changed": {
          const change = `from ${ROLE[String(d.from)] ?? "one role"} to ${ROLE[String(d.to)] ?? "another"}`;
          return admin
            ? `${admin} changed ${person}'s office role ${change}.`
            : `${person}'s office role was changed ${change}.`;
        }
        default:
          return admin
            ? `${admin} logged ${person} out of the office on every device.`
            : `${person} was logged out of the office on every device.`;
      }
    }
    case "firm.agreement_recorded":
      if (d.cleared === true) {
        return `The firm's recorded agreement was removed${typeof d.was === "string" ? ` (it said ${dayLabel(d.was)} ${d.was.slice(0, 4)})` : ""}.`;
      }
      return typeof d.signedOn === "string"
        ? `The firm's agreement and data processing agreement were recorded as signed on ${dayLabel(d.signedOn)} ${d.signedOn.slice(0, 4)}${typeof d.was === "string" ? ` (was ${dayLabel(d.was)} ${d.was.slice(0, 4)})` : ""}.`
        : "The firm's agreement and data processing agreement were recorded as signed.";
    case "firm.settings_changed": {
      const keys = Array.isArray(d.keys) ? d.keys.map(String) : [];
      // The strikes team's email (Settings, 12B.7): the keys only, never the address.
      if (keys.length > 0 && keys.every((k) => k.startsWith("strikes.email"))) {
        if (d.by === "link") return "The strikes team's email was confirmed, by its link.";
        return keys.includes("strikes.email")
          ? `${officeName} changed the strikes team's email.`
          : `${officeName} changed whether the strikes team's email is confirmed.`;
      }
      const n = keys.length;
      return `The firm's settings changed (${n === 1 ? "1 setting" : `${n} settings`}).`;
    }
    case "firm.strikes_email_link":
      return "Sending a link to confirm the strikes team's email (it works for 7 days).";
    case "firm.strikes_email_link_sent":
      return "The link to confirm the strikes team's email was sent.";
    case "firm.strikes_email_link_failed":
      return "The link to confirm the strikes team's email couldn't be sent.";
    case "firm.shifts_line_changed":
      return d.change === "cleared"
        ? "The firm's shifts line (its WhatsApp and text number) was removed."
        : d.change === "replaced"
          ? "The firm's shifts line (its WhatsApp and text number) was changed to a new number."
          : "The firm's shifts line (its WhatsApp and text number) was set.";
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
      if (d.held === true) {
        return `Old login records were tidied up (${logins}). Nothing else was deleted: a hold is on (a dispute).`;
      }
      const of = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
      return `Old data was deleted on schedule, by the firm's retention settings: ${of(n("messages"), "message", "messages")}, ${of(n("requestNotes"), "request note", "request notes")}, ${of(n("overrideReasons"), "reason on a booking", "reasons on bookings")} and ${of(logins, "old login record", "old login records")}.`;
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

    // A worker's access, changed by the office (src/lib/office/worker-access.ts).
    case "worker.deactivated":
    case "worker.reactivated":
    case "worker.unblocked":
    case "worker.site_blocked":
    case "worker.site_unblocked": {
      const kind = {
        "worker.deactivated": "deactivate",
        "worker.reactivated": "reactivate",
        "worker.unblocked": "unblock",
        "worker.site_blocked": "site_block",
        "worker.site_unblocked": "site_unblock",
      }[e.action] as keyof typeof REASON_WORDS;
      const list: Record<string, string> = REASON_WORDS[kind];
      const reason = ` Reason: ${list[String(d.reason)] ?? "another reason"}.`;
      const site = names.site?.(d.siteId) ?? "a site";
      const ahead = Number(d.futureBookings ?? 0);
      const toCheck =
        ahead > 0 ? ` ${ahead === 1 ? "1 booking" : `${ahead} bookings`} ahead to check.` : "";
      switch (e.action) {
        case "worker.deactivated":
          return `${officeName} made ${worker} inactive.${reason}${toCheck}`;
        case "worker.reactivated":
          return `${officeName} made ${worker} active again.${reason}`;
        case "worker.unblocked":
          return d.stillInactive
            ? `${officeName} unblocked ${worker}.${reason} They stay inactive: the office had made them inactive.`
            : `${officeName} unblocked ${worker}.${reason}`;
        case "worker.site_blocked":
          return `${officeName} blocked ${worker} from ${site}.${reason}${toCheck}`;
        default:
          return `${officeName} unblocked ${worker} from ${site}.${reason}`;
      }
    }
    case "worker.signed_out":
      return Number(d.sessionsEnded ?? 0) + Number(d.linksSpent ?? 0) > 0
        ? `${officeName} logged ${worker} out on every device.`
        : `${officeName} turned off notifications on ${worker}'s phones.`;
    case "booking.kept": {
      const why: Record<string, string> = {
        inactive: "they're not active",
        blocked: "they're blocked",
        site_blocked: "they're blocked from the site",
      };
      return `${officeName} kept ${worker}'s booking, though ${why[String(d.cause)] ?? "it was flagged"}.`;
    }
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
      if (d.purpose === "office_login") return `Login link sent to an office user${unconfirmed(d)}`;
      return d.workerId
        ? `Login link sent to ${worker}${unconfirmed(d)}`
        : `Login link sent to a worker${unconfirmed(d)}`;
    case "auth.link_send_failed":
      if (d.purpose === "office_login") return "A login link to an office user couldn't be sent.";
      return d.workerId
        ? `A login link to ${worker} couldn't be sent.`
        : "A login link to a worker couldn't be sent.";
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
      return d.workerId
        ? `A pay-page code was sent to ${worker}${unconfirmed(d)}`
        : `A pay-page code was sent${unconfirmed(d)}`;
    case "auth.otp_send_failed":
      return d.workerId
        ? `A pay-page code to ${worker} couldn't be sent.`
        : "A pay-page code couldn't be sent.";
    case "auth.otp_verified":
      return `${who} opened their pay page.`;
    case "auth.otp_failed":
      return `${who} typed a wrong code${typeof d.attemptsLeft === "number" ? ` (${d.attemptsLeft} tries left)` : ""}.`;
    case "auth.otp_locked":
      return `${who}'s code stopped working after too many wrong tries.`;
    case "auth.rate_limited":
      return typeof d.limit === "string" && d.limit.startsWith("strikes_link:")
        ? "Too many links to confirm the strikes team's email: sending them was paused for a while."
        : "Too many tries: logging in was paused for a while.";

    // The rota sheet and imports.
    case "roster.source_connected":
      return d.mappingChanged
        ? "The rota sheet's column settings were changed."
        : d.replaced
          ? "A new rota sheet was connected in place of the old one."
          : "The rota sheet was connected.";
    case "roster.source_disabled":
      return d.replaced
        ? "The old rota sheet was switched off (a new one replaces it)."
        : "The rota sheet was switched off: nothing more is read from it.";
    case "roster.source_forgotten":
      return "An old rota sheet, already switched off, was let go: another firm could connect it.";
    case "roster.synced": {
      const read = `The rota sheet was read${typeof d.shifts === "number" ? ` (${d.shifts} shifts)` : ""}.`;
      const n = typeof d.staffRefused === "number" ? d.staffRefused : 0;
      return n > 0
        ? `${read} ${n === 1 ? "1 staff row wasn't" : `${n} staff rows weren't`} taken: a mobile or Staff ID in it belongs to someone else here with another name. Check the sheet's Staff tab.`
        : read;
    }
    case "roster.sync_failed":
      return typeof d.code === "string"
        ? `Reading the rota sheet failed: ${syncErrorWords(d.code)}.`
        : "Reading the rota sheet failed.";
    case "roster.sheet_conflict":
      return d.holderNotInSheet
        ? "Someone booked on this shift in the app isn't in the rota sheet's staff list."
        : "The rota sheet names someone the app couldn't book on this shift.";
    case "roster.sheet_booking_refused":
      return d.droppedFromSheet
        ? `${worker} was in the rota sheet but couldn't be booked (${ruleWords(d.codes)}): taken out of the sheet, which was full.`
        : `${worker} is in the rota sheet but couldn't be booked: ${ruleWords(d.codes)}.`;
    case "roster.sheet_change_refused": {
      const FIELD: Record<string, string> = {
        role: "role",
        startsAt: "start",
        endsAt: "finish",
        siteId: "site",
        status: "status",
      };
      const fields = Array.isArray(d.fields)
        ? d.fields.map((f) => FIELD[String(f)] ?? "details")
        : [];
      const what = `The rota sheet's change to the ${list(fields.length > 0 ? fields : ["shift"])} wasn't made`;
      if (d.reason === "started") return `${what}: the shift had started.`;
      if (d.reason === "in_past") return `${what}: the new time had already passed.`;
      if (d.reason === "settings") return `${what}: the firm's rules settings need fixing.`;
      const people = Array.isArray(d.workers)
        ? d.workers.map((w) => {
            const one = w as { workerId?: unknown; codes?: unknown };
            return `${names.worker(one.workerId)} (${ruleWords(one.codes)})`;
          })
        : [];
      return `${what}: ${people.length > 0 ? `${list(people)} can't work it` : "someone booked can't work it"}.`;
    }
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
    case "site.changed": {
      const site = names.site?.(d.siteId) ?? "a site";
      return `${officeName} changed the postcode of ${site}.`;
    }
    default:
      return `Recorded: ${e.action}.`;
  }
}
