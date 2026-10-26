import { escalateHours, firstComeWaves, WAVE_MAX } from "../offers/waves";
import { shortNoticeThreshold } from "../office/notice-report";
import { parseAllocationSettings } from "../roster/allocation-input";
import { ALLOCATION_MODES } from "../rules/allocation";
import { quietHours } from "../rules/quiet-hours";
import { urgentWindowHours } from "../rules/urgent";
import {
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  retentionSettings,
} from "../gdpr/retention-settings";
import { keepCoversLive, STRIKE_LIMITS, strikeSettings } from "../strikes/settings";
import { travelSettings } from "../travel/settings";
import { PHOTO_RENEWAL_LIMITS, photoSettings } from "../uploads/settings";

// The firm settings the onboarding checklist asks the firm to agree (docs/go-to-market.md "Pilot
// onboarding checklist"; docs/data-model.md "Firm settings"), as the app reads them. Each app
// reader has its own limits and falls back to a default when a value makes no sense, so a value is
// only accepted if reading it back through that same reader gives exactly what was set
// (`applySetting`). Used by `npm run firm:settings` and `npm run firm:check`. Pure functions.

export const SETTING_KEYS = [
  "allocation_mode",
  "wave_size",
  "wave_minutes",
  "wave_per_place",
  "urgent_window_hours",
  "escalate_hours_before_start",
  "short_notice_threshold_hours",
  "quiet_hours.start",
  "quiet_hours.end",
  "quiet_hours.urgent_override",
  "retention.message_days",
  "retention.request_note_days",
  "retention.hold_until",
  "strikes.notice_hours",
  "strikes.live_days",
  "strikes.keep_months",
  "travel.enabled",
  "travel.default_max_minutes",
  "photo.renewal_months",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type SettingValue = string | number | boolean;

export const isSettingKey = (key: string): key is SettingKey =>
  (SETTING_KEYS as readonly string[]).includes(key);

type Settings = Record<string, unknown>;

// Fair rotation's numbers are read with the mode set, so they can be agreed before switching to
// it: wave_size always, and wave_minutes under fair rotation. Under first come, first served
// wave_minutes is read as its waves read it (firstComeWaves, P4.3), so a fair-rotation size the
// app would refuse doesn't stop it.
const fair = (s: Settings) => parseAllocationSettings({ ...s, allocation_mode: "fair_rotation" });

// What the app reads for each key.
const READ: Record<SettingKey, (s: Settings) => SettingValue> = {
  allocation_mode: (s) => parseAllocationSettings(s).mode,
  wave_size: (s) => {
    const a = fair(s);
    return a.mode === "fair_rotation" ? a.groupSize : 0;
  },
  wave_minutes: (s) => {
    if (parseAllocationSettings(s).mode === "first_come_first_served") {
      return firstComeWaves(s).minutes;
    }
    const a = fair(s);
    return a.mode === "fair_rotation" ? a.priorityMinutes : 0;
  },
  wave_per_place: (s) => firstComeWaves(s).perPlace,
  urgent_window_hours: (s) => urgentWindowHours(s),
  escalate_hours_before_start: (s) => escalateHours(s),
  short_notice_threshold_hours: (s) => shortNoticeThreshold(s).hours,
  "quiet_hours.start": (s) => quietHours(s).start,
  "quiet_hours.end": (s) => quietHours(s).end,
  "quiet_hours.urgent_override": (s) => quietHours(s).urgentOverride,
  "retention.message_days": (s) => retentionSettings(s).messageDays,
  "retention.request_note_days": (s) => retentionSettings(s).requestNoteDays,
  "retention.hold_until": (s) => retentionSettings(s).holdUntil ?? "none",
  "strikes.notice_hours": (s) => strikeSettings(s).noticeHours,
  "strikes.live_days": (s) => strikeSettings(s).liveDays,
  "strikes.keep_months": (s) => strikeSettings(s).keepMonths,
  "travel.enabled": (s) => travelSettings(s).enabled,
  "travel.default_max_minutes": (s) => travelSettings(s).defaultMaxMinutes,
  "photo.renewal_months": (s) => photoSettings(s).renewalMonths,
};

// What each key means, for the command's output.
export const SETTING_WORDS: Record<SettingKey, string> = {
  allocation_mode: `who gets an open shift: ${ALLOCATION_MODES.join(" or ")}`,
  wave_size: "fair rotation: how many workers each wave goes to",
  wave_minutes: "minutes each wave has before the next (both modes)",
  wave_per_place: `first come, first served: how many workers each wave goes to per free place (1 to 20; at most ${WAVE_MAX} a wave)`,
  urgent_window_hours: "a shift starting within this many hours is urgent (never held back)",
  escalate_hours_before_start: "email the office this many hours before an unfilled start",
  short_notice_threshold_hours: "the notice report's short notice: under this many hours",
  "quiet_hours.start": "no messages to workers from (local time)",
  "quiet_hours.end": "no messages to workers until (local time)",
  "quiet_hours.urgent_override": "urgent messages may still go in quiet hours (true or false)",
  "retention.message_days": `days the shifts line's messages are kept (${RETENTION_MIN_DAYS} to ${RETENTION_MAX_DAYS})`,
  "retention.request_note_days": `days a closed request's words are kept, and the office's reason for placing someone despite a rule (${RETENTION_MIN_DAYS} to ${RETENTION_MAX_DAYS})`,
  "retention.hold_until":
    "nothing personal is purged until after this date (yyyy-mm-dd), for a dispute; none for no hold",
  "strikes.notice_hours": `a casual's own cancellation with less notice than this many hours is a strike (${STRIKE_LIMITS.noticeHours.min} to ${STRIKE_LIMITS.noticeHours.max})`,
  "strikes.live_days": `days a strike counts (${STRIKE_LIMITS.liveDays.min} to ${STRIKE_LIMITS.liveDays.max})`,
  "strikes.keep_months": `months before a strike's record is deleted, unless a hold is on (${STRIKE_LIMITS.keepMonths.min} to ${STRIKE_LIMITS.keepMonths.max}, and at least 6 months more than a strike counts)`,
  "travel.enabled":
    "travel areas are on: casuals may add a home area, and see and get shifts within their travel time (true or false; agree the travel DPIA first, docs/dpia-travel.md; switching off keeps the home areas already saved, unused: decide on them first, its Part 2 item 3)",
  "travel.default_max_minutes":
    "a casual's travel time limit until they choose their own (30, 45, 60 or 90 minutes)",
  "photo.renewal_months": `months before a casual's staff photo is due again, from the day the current one was uploaded (${PHOTO_RENEWAL_LIMITS.min} to ${PHOTO_RENEWAL_LIMITS.max})`,
};

const stored = (s: Settings, key: SettingKey): unknown => {
  const [head, tail] = key.split(".") as [string, string | undefined];
  if (tail === undefined) return s[head];
  const inner = s[head];
  return inner && typeof inner === "object" ? (inner as Settings)[tail] : undefined;
};

export interface EffectiveSetting {
  key: SettingKey;
  value: SettingValue;
  // "set": the firm's own value is what the app reads; "default": nothing set, or something the
  // app ignores.
  source: "set" | "default";
}

export function effectiveSettings(s: Settings): EffectiveSetting[] {
  return SETTING_KEYS.map((key) => {
    let value: SettingValue;
    try {
      value = READ[key](s);
    } catch {
      value = "(not valid)";
    }
    return { key, value, source: stored(s, key) === value ? "set" : "default" };
  });
}

function parseValue(key: SettingKey, raw: string): SettingValue | null {
  const text = raw.trim();
  if (key === "retention.hold_until") return text === "" ? null : text;
  if (key === "allocation_mode" || key === "quiet_hours.start" || key === "quiet_hours.end") {
    return text === "" ? null : text;
  }
  if (key === "quiet_hours.urgent_override" || key === "travel.enabled") {
    return text === "true" ? true : text === "false" ? false : null;
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// The settings with one value changed, or null if the app wouldn't read exactly that value (or the
// whole set would stop making sense, such as fair rotation with a bad wave size).
export function applySetting(s: Settings, key: SettingKey, raw: string): Settings | null {
  const value = parseValue(key, raw);
  if (value === null) return null;
  let next: Settings;
  if (key.startsWith("retention.")) {
    // Stored as it's read: a hold of "none" removes the date.
    const part = key.slice("retention.".length);
    const inner = s.retention && typeof s.retention === "object" ? (s.retention as Settings) : {};
    const rest = { ...inner };
    delete rest[part];
    next = { ...s, retention: value === "none" ? rest : { ...rest, [part]: value } };
  } else if (key.startsWith("strikes.")) {
    // Beside the strikes team's email and its confirmed time (set on Settings), kept as they are.
    const part = key.slice("strikes.".length);
    const inner = s.strikes && typeof s.strikes === "object" ? (s.strikes as Settings) : {};
    next = { ...s, strikes: { ...inner, [part]: value } };
  } else if (key.startsWith("travel.")) {
    const part = key.slice("travel.".length);
    const inner = s.travel && typeof s.travel === "object" ? (s.travel as Settings) : {};
    next = { ...s, travel: { ...inner, [part]: value } };
  } else if (key.startsWith("photo.")) {
    const part = key.slice("photo.".length);
    const inner = s.photo && typeof s.photo === "object" ? (s.photo as Settings) : {};
    next = { ...s, photo: { ...inner, [part]: value } };
  } else if (key.startsWith("quiet_hours.")) {
    // The app reads quiet hours whole (a start without an end is ignored), so the other parts are
    // kept as the app reads them now.
    const now = quietHours(s);
    const q = { start: now.start, end: now.end, urgent_override: now.urgentOverride };
    const part = key.slice("quiet_hours.".length) as "start" | "end" | "urgent_override";
    next = { ...s, quiet_hours: { ...q, [part]: value } };
  } else {
    next = { ...s, [key]: value };
  }
  try {
    if (READ[key](next) !== value) return null;
    parseAllocationSettings(next);
    // A strike's record must outlast its counting by 6 months (the tribunal time limit).
    if (key.startsWith("strikes.") && !keepCoversLive(strikeSettings(next))) return null;
  } catch {
    return null;
  }
  return next;
}
