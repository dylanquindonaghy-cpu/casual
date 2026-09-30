import { escalateHours } from "../offers/waves";
import { shortNoticeThreshold } from "../office/notice-report";
import { parseAllocationSettings } from "../roster/allocation-input";
import { ALLOCATION_MODES } from "../rules/allocation";
import { quietHours } from "../rules/quiet-hours";
import { urgentWindowHours } from "../rules/urgent";

// The firm settings the onboarding checklist asks the firm to agree (docs/go-to-market.md "Pilot
// onboarding checklist"; docs/data-model.md "Firm settings"), as the app reads them. Each app
// reader has its own limits and falls back to a default when a value makes no sense, so a value is
// only accepted if reading it back through that same reader gives exactly what was set
// (`applySetting`). Used by `npm run firm:settings` and `npm run firm:check`. Pure functions.

export const SETTING_KEYS = [
  "allocation_mode",
  "wave_size",
  "wave_minutes",
  "urgent_window_hours",
  "escalate_hours_before_start",
  "short_notice_threshold_hours",
  "quiet_hours.start",
  "quiet_hours.end",
  "quiet_hours.urgent_override",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type SettingValue = string | number | boolean;

export const isSettingKey = (key: string): key is SettingKey =>
  (SETTING_KEYS as readonly string[]).includes(key);

type Settings = Record<string, unknown>;

// Under fair rotation only: wave_size and wave_minutes are read with the mode set, so they can be
// agreed before switching to it.
const fair = (s: Settings) => parseAllocationSettings({ ...s, allocation_mode: "fair_rotation" });

// What the app reads for each key.
const READ: Record<SettingKey, (s: Settings) => SettingValue> = {
  allocation_mode: (s) => parseAllocationSettings(s).mode,
  wave_size: (s) => {
    const a = fair(s);
    return a.mode === "fair_rotation" ? a.groupSize : 0;
  },
  wave_minutes: (s) => {
    const a = fair(s);
    return a.mode === "fair_rotation" ? a.priorityMinutes : 0;
  },
  urgent_window_hours: (s) => urgentWindowHours(s),
  escalate_hours_before_start: (s) => escalateHours(s),
  short_notice_threshold_hours: (s) => shortNoticeThreshold(s).hours,
  "quiet_hours.start": (s) => quietHours(s).start,
  "quiet_hours.end": (s) => quietHours(s).end,
  "quiet_hours.urgent_override": (s) => quietHours(s).urgentOverride,
};

// What each key means, for the command's output.
export const SETTING_WORDS: Record<SettingKey, string> = {
  allocation_mode: `who gets an open shift: ${ALLOCATION_MODES.join(" or ")}`,
  wave_size: "fair rotation: how many workers each wave goes to",
  wave_minutes: "fair rotation: minutes each wave has before the next",
  urgent_window_hours: "a shift starting within this many hours is urgent (never held back)",
  escalate_hours_before_start: "email the office this many hours before an unfilled start",
  short_notice_threshold_hours: "the notice report's short notice: under this many hours",
  "quiet_hours.start": "no messages to workers from (local time)",
  "quiet_hours.end": "no messages to workers until (local time)",
  "quiet_hours.urgent_override": "urgent messages may still go in quiet hours (true or false)",
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
  if (key === "allocation_mode" || key === "quiet_hours.start" || key === "quiet_hours.end") {
    return text === "" ? null : text;
  }
  if (key === "quiet_hours.urgent_override") {
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
  if (key.startsWith("quiet_hours.")) {
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
  } catch {
    return null;
  }
  return next;
}
