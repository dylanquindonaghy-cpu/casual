import type { CancelVia } from "../db/schema/roster";
import { noticeText } from "../portal/cancel-reasons";
import { roleLabel, timeOnDay } from "../portal/format";
import { pounds } from "../portal/pay-format";
import { FIRM_CHANGE_REASONS } from "../roster/firm-reasons";
import type { PlaceAfterCancel } from "../roster/native";
import { CANCELLED_ON_SHEET, REMOVED_ON_SHEET } from "../roster/sheets/sync";
import type { StrikeCode } from "../strikes/decide";
import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { csvCell } from "./notice-report";

// Cancellation records in words (docs/office-v2.md 3.4; docs/screens.md `/office/cancellations`;
// 12C.3): the record's fields, as the page shows them and as the PDF and the CSV carry them, the
// "Then" line, and the CSV. Pure.
//
// What leaves ShiftDesk (the PDF, the CSV) never carries a casual's reason: every one reads
// "Casual's own reason (see ShiftDesk)", because "I'm unwell" is health data (6.3). The office's
// reasons keep their fixed words; anything else the office typed reads "Office's own reason (see
// ShiftDesk)". The real reason is on the record's page only (admins and resourcers).

export const CANCELLATION_VIEWS = ["all", "under", "office"] as const;
export type CancellationView = (typeof CANCELLATION_VIEWS)[number];

export const CASUAL_OWN_REASON = "Casual's own reason (see ShiftDesk)";
export const OFFICE_OWN_REASON = "Office's own reason (see ShiftDesk)";
// No webhook to the firm's planner exists yet (Integrations, 12J): every record says so.
export const PLANNER_TEXT = "No webhook set up";
// The record reads the session as it is now; the notice was counted when it was cancelled.
export const AS_IT_IS_NOW =
  "The session's details are as they are now; the notice is counted from when it was cancelled.";

// The fixed words a firm's cancellation may carry out of ShiftDesk.
const FIXED_FIRM_REASONS = new Set<string>([
  ...Object.values(FIRM_CHANGE_REASONS),
  REMOVED_ON_SHEET,
  CANCELLED_ON_SHEET,
]);

// What became of the place, as the cancellation recorded it in its shift.cancelled entry
// (src/lib/roster/native.ts placeAfterCancel): reopened, not reopened (above the session's places,
// or it had started), removed (fewer staff) or the whole session cancelled.
export type ThenPlace = PlaceAfterCancel["place"];
const THEN_PLACES: Record<ThenPlace, true> = {
  reopened: true,
  above_places: true,
  started: true,
  removed: true,
  session_cancelled: true,
};
export const isThenPlace = (v: unknown): v is ThenPlace =>
  typeof v === "string" && Object.hasOwn(THEN_PLACES, v);

export interface ThenFacts {
  place: ThenPlace | null; // null: logged before cancellations recorded it
  markedUrgent: boolean; // marked urgent after this dropout
  offeredTo: number; // casuals offered it afterwards
  replacement: { name: string; at: Date } | null; // who took the place next, and when
}

export interface CancellationRow {
  assignmentId: string;
  ref: string; // the booking's first 8 characters, upper case
  workerId: string;
  casual: string;
  erased?: boolean; // the casual's details were deleted
  staffId: string | null;
  eventName: string | null;
  role: string;
  startsAt: Date;
  endsAt: Date;
  siteName: string | null;
  sitePostcode: string | null;
  post: string | null;
  payRatePence: number | null;
  meetingPoint: string | null;
  uniform: string | null;
  requirements: { code: string; name: string }[];
  bookedAt: Date | null;
  cancelledAt: Date;
  by: "casual" | "office" | "planner" | "sheet";
  via: CancelVia | null;
  officeName: string | null; // the office user who cancelled it, if one did
  reason: string; // as stored: shown on the page only
  noticeHours: number;
  strikeCode: StrikeCode | null; // from the shift.cancelled entry (none before strikes)
  strike: {
    status: "live" | "withdrawn";
    expiresAt: Date;
    reviewNeeded: boolean;
    // Who withdrew it, when and why (the reason: on screen only, never in the PDF or CSV), and who
    // kept it after a review (12C.5).
    withdrawn?: { by: string | null; at: Date; reason: string | null } | null;
    reviewed?: { by: string | null; at: Date } | null;
    // stuck: still pending with nothing logged for hours (its job stopped for good); nothingSent:
    // its last failure proves nothing was sent (12C.4).
    evidence: {
      status: string | null;
      to: string | null;
      sentAt: Date | null;
      stuck?: boolean;
      nothingSent?: boolean;
    };
  } | null;
  warning: { version: string; shownAt: Date } | null;
  then: ThenFacts;
}

export interface RecordField {
  label: string;
  value: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};
const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");

export const VIEW_WORDS: Record<CancellationView, (threshold: number) => string> = {
  all: () => "All",
  under: (threshold) => `Under ${threshold} hours`,
  office: () => "By the office",
};

export const VIEW_EMPTY: Record<CancellationView, string> = {
  all: "No cancellations yet.",
  under: "No cancellations at short notice.",
  office: "The office hasn't cancelled anyone.",
};

// This week's counts: "9 by casuals · 2 by the office" and "3 strikes issued".
export function weekCountsText(c: { byCasuals: number; byOffice: number; strikes: number }): {
  cancellations: string;
  strikes: string;
} {
  return {
    cancellations: `${c.byCasuals} by ${c.byCasuals === 1 ? "a casual" : "casuals"} · ${c.byOffice} by the office`,
    strikes: c.strikes === 1 ? "1 strike issued" : `${c.strikes} strikes issued`,
  };
}

// "In the app", "By the office (Sam Rota)", "Removed on the rota sheet", "By your planner", …
export function howText(r: Pick<CancellationRow, "by" | "via" | "officeName" | "reason">): string {
  if (r.via === "sheet") {
    return r.reason === CANCELLED_ON_SHEET
      ? "Cancelled on the rota sheet"
      : "Removed on the rota sheet";
  }
  if (r.via === "import") return "From a file import";
  // The firm's planner cancelled the session through the API (12J.1): no office user did.
  if (r.via === "api") return "By your planner";
  if (r.by === "casual") return "In the app";
  return r.officeName ? `By the office (${r.officeName})` : "By the office";
}

export const WHO_WORDS: Record<CancellationRow["by"], string> = {
  casual: "casual",
  office: "office",
  planner: "planner",
  sheet: "sheet",
};

// The reason as it may leave ShiftDesk.
export function exportReason(r: Pick<CancellationRow, "by" | "reason">): string {
  if (r.by === "casual") return CASUAL_OWN_REASON;
  return FIXED_FIRM_REASONS.has(r.reason) ? r.reason : OFFICE_OWN_REASON;
}

const STRIKE_WORDS: Record<StrikeCode, string> = {
  issued: "Issued",
  by_firm: "None: cancelled by the office",
  enough_notice: "None: enough notice",
  booked_by_office: "Exempt: booked by the office",
  rules_override: "Exempt: booked by the office over a rest or hours rule",
  changed_after_booking: "Exempt: the office changed it after booking",
};

export function strikeText(r: Pick<CancellationRow, "strike" | "strikeCode">, tz: string): string {
  if (r.strike) {
    return r.strike.status === "withdrawn"
      ? "Issued, then withdrawn"
      : `Issued (counts until ${dayLabel(localDateOf(r.strike.expiresAt, tz))})`;
  }
  return r.strikeCode ? STRIKE_WORDS[r.strikeCode] : "Not recorded (before strikes)";
}

// The CSV's short form: yes / exempt: reason / no.
export function strikeShort(r: Pick<CancellationRow, "strike" | "strikeCode">): string {
  if (r.strike) return r.strike.status === "withdrawn" ? "withdrawn" : "yes";
  if (r.strikeCode && r.strikeCode !== "by_firm" && r.strikeCode !== "enough_notice") {
    return `exempt: ${STRIKE_WORDS[r.strikeCode].replace(/^Exempt: /, "")}`;
  }
  return "no";
}

// The evidence email may have reached the strikes team: sent, or a failure that doesn't prove
// nothing went (12C.4).
export const evidenceMayHaveGone = (e: { status: string | null; nothingSent?: boolean }) =>
  e.status === "sent" || (e.status === "failed" && !e.nothingSent);

export function evidenceText(r: Pick<CancellationRow, "strike">, tz: string): string {
  const e = r.strike?.evidence;
  if (!r.strike || !e) return "No strike: nothing to send";
  if (r.strike.status === "withdrawn" && !evidenceMayHaveGone(e)) {
    return "Not sent: the strike was withdrawn";
  }
  switch (e.status) {
    case "sent":
      return e.sentAt ? `Sent to the strikes team at ${timeOnDay(e.sentAt, tz)}` : "Sent";
    case "failed":
      return e.nothingSent ? "Couldn't be sent: nothing was sent" : "Couldn't be sent";
    case "not_set_up":
      return "No strikes team email set up";
    case "pending":
      return e.stuck ? "Held up: not sent yet" : "Sending";
    default:
      return "Not sent";
  }
}

// The record's "Resend evidence" section (12C.4): when the email failed or is held up, what to say.
export function resendNote(e: { status: string | null; stuck?: boolean; nothingSent?: boolean }): {
  heading: string;
  text: string;
} | null {
  if (e.status === "failed") {
    return e.nothingSent
      ? {
          heading: "The evidence email failed",
          text: "It didn't reach the email server, so nothing was sent.",
        }
      : {
          heading: "The evidence email failed",
          text: "It may have arrived anyway: check with the strikes team before sending it again.",
        };
  }
  if (e.status === "pending" && e.stuck) {
    return {
      heading: "The evidence email is held up",
      text: "It hasn't gone in the last few hours. It may have arrived anyway: check with the strikes team before sending it again.",
    };
  }
  return null;
}

// "Place reopened and marked urgent · offered to 5 casuals · filled again by Ben Fraser at 22:02".
// `names`: false leaves out who took the place (the evidence email's PDF: no other casual's name).
export function thenText(t: ThenFacts, cancelledAt: Date, tz: string, names = true): string {
  switch (t.place) {
    case null:
      return "Not recorded";
    case "session_cancelled":
      return "The whole session was cancelled";
    case "removed":
      return "The place went: the client needs fewer staff";
    case "started":
      return "The place wasn't reopened: the session had started";
    case "above_places":
      return "The place wasn't reopened: the session had fewer places by then";
    case "reopened":
      break;
  }
  const parts = [t.markedUrgent ? "Place reopened and marked urgent" : "Place reopened"];
  if (t.offeredTo > 0) {
    parts.push(`offered to ${t.offeredTo} ${t.offeredTo === 1 ? "casual" : "casuals"}`);
  }
  if (t.replacement) {
    const sameDay = localDateOf(t.replacement.at, tz) === localDateOf(cancelledAt, tz);
    const at = sameDay ? hhmm(t.replacement.at, tz) : timeOnDay(t.replacement.at, tz);
    parts.push(names ? `filled again by ${t.replacement.name} at ${at}` : `filled again at ${at}`);
  } else {
    parts.push("not filled again yet");
  }
  return parts.join(" · ");
}

export function warningText(r: Pick<CancellationRow, "warning" | "by">, tz: string): string {
  if (r.warning) {
    return `Version ${r.warning.version}, on screen when they confirmed at ${timeOnDay(r.warning.shownAt, tz)}`;
  }
  return r.by === "casual" ? "None recorded" : "None (not cancelled in the app)";
}

// The session in the evidence email (docs/office-v2.md 5.6): "Steward · Raceday · Wed 7 Oct
// 10:30–18:30".
export const evidenceSessionText = (
  r: Pick<CancellationRow, "role" | "eventName" | "startsAt" | "endsAt">,
  tz: string,
) =>
  [
    roleLabel(r.role),
    r.eventName,
    `${dayLabel(localDateOf(r.startsAt, tz))} ${hhmm(r.startsAt, tz)}–${hhmm(r.endsAt, tz)}`,
  ]
    .filter(Boolean)
    .join(" · ");

const sessionText = (r: CancellationRow, tz: string) =>
  `${roleLabel(r.role)} · ${dayLabel(localDateOf(r.startsAt, tz))}, ${hhmm(r.startsAt, tz)} to ${hhmm(r.endsAt, tz)}`;

// The record's fields, in the page's order (docs/office-v2.md 3.4's table). `forExport`: the
// version that leaves ShiftDesk (the PDF), with the casual's reason replaced.
export function recordFields(
  r: CancellationRow,
  o: {
    tz: string;
    threshold: number;
    liveStrikes: number;
    forExport: boolean;
    replacementName?: boolean; // false: "filled again at …" (the evidence email's PDF)
  },
): RecordField[] {
  const site = r.siteName ? [r.siteName, r.sitePostcode].filter(Boolean).join(", ") : null;
  return [
    { label: "Reference", value: r.ref },
    { label: "Casual", value: r.casual },
    { label: "Staff id", value: dash(r.staffId) },
    { label: "Event", value: dash(r.eventName) },
    { label: "Session", value: sessionText(r, o.tz) },
    { label: "Site", value: dash(site) },
    { label: "Post", value: dash(r.post) },
    { label: "Pay rate", value: r.payRatePence !== null ? `${pounds(r.payRatePence)}/h` : "—" },
    {
      label: "Requirements",
      value: r.requirements.length
        ? r.requirements.map((q) => q.name.charAt(0).toUpperCase() + q.name.slice(1)).join(", ")
        : "—",
    },
    { label: "Meeting point", value: dash(r.meetingPoint) },
    { label: "Uniform", value: dash(r.uniform) },
    { label: "Booked at", value: r.bookedAt ? timeOnDay(r.bookedAt, o.tz) : "—" },
    { label: "Cancelled at", value: timeOnDay(r.cancelledAt, o.tz) },
    { label: "How", value: howText(r) },
    { label: "Notice", value: `${noticeText(r.noticeHours)} (${r.noticeHours.toFixed(2)} hours)` },
    {
      label: `Under ${o.threshold} hours`,
      value: r.noticeHours < o.threshold ? "Yes" : "No",
    },
    { label: "Reason", value: o.forExport ? exportReason(r) : r.reason },
    { label: "Strike", value: strikeText(r, o.tz) },
    { label: "Live strikes now", value: String(o.liveStrikes) },
    { label: "Evidence email", value: evidenceText(r, o.tz) },
    { label: "Your planner", value: PLANNER_TEXT },
    { label: "Then", value: thenText(r.then, r.cancelledAt, o.tz, o.replacementName ?? true) },
    { label: "Warning on the cancel screen", value: warningText(r, o.tz) },
  ];
}

export const CANCELLATIONS_CSV_HEADER = [
  "Reference",
  "Casual",
  "Staff id",
  "Event",
  "Site",
  "Role",
  "Date",
  "Start",
  "End",
  "Post",
  "Pay rate",
  "Booked at",
  "Cancelled at",
  "Who cancelled",
  "How",
  "Notice hours",
  "Under threshold",
  "Reason",
  "Strike",
  "Evidence sent at",
  "Sent to planner at",
  "Then",
] as const;

const isoLocal = (d: Date | null, tz: string) => (d ? `${localDateOf(d, tz)} ${hhmm(d, tz)}` : "");

// The chosen view as a CSV (BOM first, so Excel reads it as UTF-8). Never the casual's reason.
export function cancellationsCsv(
  rows: CancellationRow[],
  o: { tz: string; threshold: number },
): string {
  const lines = [CANCELLATIONS_CSV_HEADER.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.ref,
        r.casual,
        r.staffId,
        r.eventName,
        r.siteName,
        roleLabel(r.role),
        localDateOf(r.startsAt, o.tz),
        hhmm(r.startsAt, o.tz),
        hhmm(r.endsAt, o.tz),
        r.post,
        r.payRatePence !== null ? (r.payRatePence / 100).toFixed(2) : null,
        isoLocal(r.bookedAt, o.tz),
        isoLocal(r.cancelledAt, o.tz),
        WHO_WORDS[r.by],
        howText(r),
        r.noticeHours.toFixed(2),
        r.noticeHours < o.threshold ? "yes" : "no",
        exportReason(r),
        strikeShort(r),
        r.strike?.evidence.sentAt ? isoLocal(r.strike.evidence.sentAt, o.tz) : null,
        null,
        thenText(r.then, r.cancelledAt, o.tz),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

// The record's Strike section (12C.5), oldest first: who kept it after a review; then who withdrew
// it, when and why (on screen only), and, when its evidence email had gone (or may have), a reminder
// to tell the strikes team; or, while it's live, the review flag.
export const WITHDRAWN_AFTER_EVIDENCE =
  "The evidence email had already gone to the strikes team: let them know it's withdrawn.";
export const WITHDRAWN_MAYBE_AFTER_EVIDENCE =
  "The evidence email may have reached the strikes team: let them know it's withdrawn.";

export function strikeSectionLines(
  strike: NonNullable<CancellationRow["strike"]>,
  tz: string,
): string[] {
  const lines: string[] = [];
  if (strike.reviewed) {
    lines.push(
      `Kept after a review by ${strike.reviewed.by ?? "the office"} at ${timeOnDay(strike.reviewed.at, tz)}.`,
    );
  }
  if (strike.status === "withdrawn") {
    const w = strike.withdrawn;
    if (w) {
      lines.push(
        `Withdrawn by ${w.by ?? "the office"} at ${timeOnDay(w.at, tz)}.`,
        w.reason ? `Why: ${w.reason}` : "Why: deleted with the casual's details.",
      );
    } else {
      lines.push("Withdrawn.");
    }
    if (strike.evidence.status === "sent") lines.push(WITHDRAWN_AFTER_EVIDENCE);
    else if (evidenceMayHaveGone(strike.evidence)) lines.push(WITHDRAWN_MAYBE_AFTER_EVIDENCE);
  } else if (strike.reviewNeeded) {
    lines.push("Flagged for a review: the casual's reason is one a person should look at.");
  }
  return lines;
}
