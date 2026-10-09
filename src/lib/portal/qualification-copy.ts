import type { NeedsItem, Qualification, QualificationStatus } from "../credentials/status";
import { dayLabel, shortDate } from "../rules/reasons";

// Qualifications in plain words (docs/office-v2.md 3.7, 4.2, 4.6; 12F.1), for the casual's Profile
// and My shifts and the office's Casuals pages. Pure, so the browser can use it. The staff-facing
// word is "qualification" (or the item's own name), never "credential".

export const STATUS_WORDS: Record<QualificationStatus, string> = {
  valid: "Valid",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  missing: "Missing",
  applied: "Applied for",
  suspended: "Suspended",
};

// Each status's colour (docs/ui-design.md "Status tones"): red stops her working, amber needs doing.
export const STATUS_TONES: Record<QualificationStatus, "urgent" | "attention" | "done" | "quiet"> =
  {
    valid: "done",
    expiring_soon: "attention",
    expired: "urgent",
    missing: "attention",
    applied: "quiet",
    suspended: "urgent",
  };

// Names are stored mid-sentence ("first aid at work certificate"); as a heading they start with a
// capital.
export const qualificationTitle = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

// Mid-sentence: "door supervisor"; an acronym stays in capitals ("CSAS officer").
const roleWords = (role: string) => role.replace(/_/g, " ").replace(/\bcsas\b/g, "CSAS");
// "door supervisor", "door supervisor and steward", "a, b and c".
export function rolesText(roles: readonly string[]): string {
  const words = roles.map(roleWords);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

// The line under its name: the date that matters, or what's needed.
export function dateLine(q: Qualification, year: number): string {
  const date = q.expiresOn ? shortDate(q.expiresOn, year) : null;
  switch (q.status) {
    case "valid":
      return date ? `Valid until ${date}` : "No expiry date";
    case "expiring_soon":
      return `Expires ${date}`;
    case "expired":
      return date ? `Expired ${date}` : "Marked as expired by the office";
    case "missing":
      return `Needed for ${rolesText(q.neededFor)} shifts`;
    case "applied":
      return "Applied for, not issued yet";
    case "suspended":
      return "Suspended";
  }
}

// What it means for her (null: nothing to say).
export function meaning(q: Qualification): string | null {
  const roles = rolesText(q.neededFor);
  switch (q.status) {
    case "valid":
      return null;
    case "expiring_soon":
      return `Renew it before then to keep getting ${roles} shifts. Send the new details to the office.`;
    case "expired":
      return `Until it's renewed you won't see ${roles} shifts. Send the new details to the office.`;
    case "missing":
      return `You won't see ${roles} shifts until the office has it.`;
    case "applied":
      return "Send it to the office when it arrives.";
    case "suspended":
      return `You can't take ${roles} shifts. Contact the office.`;
  }
}

// Right to work: a status only (Rules 15), never "you can't be booked".
export function rightToWorkText(r: { checked: boolean; checkedOn: string | null }, year: number) {
  if (!r.checked) return "Not checked yet: ask the office";
  return r.checkedOn
    ? `Checked by the office on ${shortDate(r.checkedOn, year)}`
    : "Checked by the office";
}

// One row of "Needs updating" (docs/office-v2.md 4.2), in its order.
export function needsText(item: NeedsItem, year: number): string {
  const q = item.qualification;
  const name = qualificationTitle(q.name);
  const date = q.expiresOn ? shortDate(q.expiresOn, year) : null;
  const state =
    q.status === "missing"
      ? "is missing"
      : q.status === "suspended"
        ? "is suspended"
        : q.status === "expired"
          ? date
            ? `expired on ${date}`
            : "has expired"
          : `expires on ${date}`;
  if (item.blocks) {
    return `${name} ${state}, and your ${roleWords(item.blocks.role)} shift on ${dayLabel(
      item.blocks.day,
    )} needs it. Send the new details to the office, or contact them.`;
  }
  switch (item.level) {
    case 2:
      return q.status === "suspended"
        ? `${name} is suspended. Contact the office.`
        : `${name} ${state}. Until it's renewed you won't see ${rolesText(q.neededFor)} shifts.`;
    case 3:
      return `${name} ${state}. Renew it to keep getting ${rolesText(q.neededFor)} shifts.`;
    default:
      return `${name} is missing. Needed for ${rolesText(q.neededFor)} shifts.`;
  }
}

// The office's one-line summary of what a casual needs to update ("Nothing", or the first and how
// many more).
export function needsSummary(items: readonly NeedsItem[]): string {
  const [first, ...rest] = items;
  if (!first) return "Nothing";
  const q = first.qualification;
  const head = `${qualificationTitle(q.name)}: ${STATUS_WORDS[q.status].toLowerCase()}${
    first.blocks ? " (booked shift)" : ""
  }`;
  return rest.length === 0 ? head : `${head}, and ${rest.length} more`;
}
