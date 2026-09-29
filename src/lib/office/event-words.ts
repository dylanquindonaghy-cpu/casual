import { noticeText } from "../portal/cancel-reasons";

// The action log in plain words for the office (docs/screens.md: short sentences, plain words): a
// shift's history on its page now, the full action log (Phase 5) later. Pure: the caller passes
// the names of the people and office users the events mention.

export interface LoggedEvent {
  action: string;
  actorType: string;
  actorId: string | null;
  data: Record<string, unknown>;
}

export interface Names {
  worker: (id: unknown) => string;
  office: (id: unknown) => string;
}

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

export function eventWords(e: LoggedEvent, names: Names): string {
  const d = e.data;
  const byOffice = d.by === "firm" || e.actorType === "office";
  const officeName = e.actorType === "office" ? names.office(e.actorId) : "The office";
  const worker = names.worker(d.workerId);
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
    case "shift.reminder_sent":
      return `Reminder sent to ${worker}.`;
    case "shift.reminder_failed":
      return `The reminder to ${worker} couldn't be sent.`;
    case "shift.reminder_skipped":
      return `No reminder for ${worker} (quiet hours).`;
    default:
      return `Recorded: ${e.action}.`;
  }
}
