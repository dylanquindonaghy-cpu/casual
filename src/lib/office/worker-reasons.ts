import type { SITE_BLOCK_REASONS } from "../db/schema";

// Why the office changed a worker's access (Phase 10, src/lib/office/worker-access.ts): a code
// from a fixed list for each change, so the action log holds the reason without any free text
// (docs/screens.md `/office/workers/[id]`).

export const DEACTIVATE_REASONS = {
  left: "They've left",
  paused: "Not taking shifts for now",
  other: "Another reason",
} as const;

export const REACTIVATE_REASONS = {
  back: "They're back",
  mistake: "Made inactive by mistake",
  other: "Another reason",
} as const;

export const UNBLOCK_REASONS = {
  sorted: "The problem is sorted",
  mistake: "Blocked by mistake",
  other: "Another reason",
} as const;

export const SITE_BLOCK_REASON_WORDS: Record<(typeof SITE_BLOCK_REASONS)[number], string> = {
  client_asked: "The client asked",
  incident: "Something happened at this site",
  other: "Another reason",
};

export const SITE_UNBLOCK_REASONS = {
  client_ok: "The client is happy for them to work there",
  mistake: "Blocked by mistake",
  other: "Another reason",
} as const;

export type DeactivateReason = keyof typeof DEACTIVATE_REASONS;
export type ReactivateReason = keyof typeof REACTIVATE_REASONS;
export type UnblockReason = keyof typeof UNBLOCK_REASONS;
export type SiteUnblockReason = keyof typeof SITE_UNBLOCK_REASONS;

// Every reason's words, by kind of change: for the page's lists and the action log.
export const REASON_WORDS = {
  deactivate: DEACTIVATE_REASONS,
  reactivate: REACTIVATE_REASONS,
  unblock: UNBLOCK_REASONS,
  site_block: SITE_BLOCK_REASON_WORDS,
  site_unblock: SITE_UNBLOCK_REASONS,
} as const;

export const codesOf = <T extends Record<string, string>>(list: T) =>
  Object.keys(list) as [keyof T & string, ...(keyof T & string)[]];
