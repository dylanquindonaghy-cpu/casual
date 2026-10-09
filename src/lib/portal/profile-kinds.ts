// The browser-safe half of the profile page (docs/screens.md, `/profile`): the notification
// choices, the limits on unavailable days, and the answers' shapes. No database code may be
// imported here: the profile's forms (client components) use it (tests/unit/client-boundary.test.ts).

// Must match NOTIFY_CHANNELS in src/lib/db/schema/people.ts (tests/unit/portal.profile.test.ts).
export const CHANNELS = ["whatsapp", "sms"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  sms: "Text message",
};

export const UNAVAILABLE_AHEAD_DAYS = 180;
export const MAX_UNAVAILABLE_DAYS = 60;

export type AvailabilityOutcome =
  | { status: "added"; day: string; bookedThatDay: boolean }
  | { status: "removed"; day: string }
  | { status: "already" } // already marked
  | { status: "not_marked" }
  | { status: "past" }
  | { status: "too_far" }
  | { status: "too_many" }
  | { status: "invalid" }
  | { status: "logged_out" }
  | { status: "error" };

export type SettingsOutcome =
  { status: "saved" } | { status: "invalid" } | { status: "logged_out" } | { status: "error" };
