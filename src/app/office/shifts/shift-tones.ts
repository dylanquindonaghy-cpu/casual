import type { StatusTone } from "@/app/ui/status-chip";

// Which colour each existing status word gets on the shift screens (docs/ui-design.md "Status
// tones"). The words themselves stay in src/lib/office/shifts-copy.ts and the pages. Plain data:
// safe in server and client components.

// SHIFT_STATUS_WORDS: Draft, Open, Filled, Cancelled.
export const SHIFT_TONE: Record<"draft" | "open" | "filled" | "cancelled", StatusTone> = {
  draft: "quiet",
  open: "attention",
  filled: "done",
  cancelled: "quiet",
};

// PLACE_STATUS_WORDS: Booked, Worked, Didn't attend, Offered, Cancelled by them / the office.
export const PLACE_TONE: Record<string, StatusTone> = {
  confirmed: "done",
  completed: "done",
  no_show: "urgent",
  offered: "attention",
  cancelled_worker: "quiet",
  cancelled_firm: "quiet",
};

// PLACE_FLAG_WORDS: why a booked person can't work it as things stand.
export const FLAG_TONE: Record<"inactive" | "blocked" | "site_blocked", StatusTone> = {
  inactive: "quiet",
  blocked: "urgent",
  site_blocked: "urgent",
};

// An offer's answer: took it, said no, didn't answer in time, filled by someone else, couldn't be
// sent, or still waiting (no answer yet).
export const RESPONSE_TONE: Record<string, StatusTone> = {
  accepted: "done",
  declined: "quiet",
  expired: "quiet",
  filled_elsewhere: "quiet",
  failed: "urgent",
};
export const WAITING_TONE: StatusTone = "attention";

// The answer to a button (role="status"): a white slip raised off the form around it, so it stands
// out (Phase 22, round 2's raised surface; a grey box with an edge until then).
export const resultBox = "rounded-row bg-card px-3 py-2 font-semibold text-ink shadow-raise";
