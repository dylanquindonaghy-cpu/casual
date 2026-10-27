import { sql, type SQL } from "drizzle-orm";
import type { OFFER_RESPONSES, SHIFT_STATUSES } from "../db/schema";

// An offer's state, one rule for the office (Phase 23, 23.4; Phase 24): the top bar's "Offers out"
// (shell-counts.ts) and the dashboard's board and places chart (dashboard-board.ts) count offers
// waiting for a reply with it. offerStateSql is the rule in SQL, over the offer `o` and its
// session `s`; offerState the same rule in TypeScript (the integration tests check the two agree).

// yes: said yes (booked). waiting: no answer yet, on a session still open and to come. closed:
// everything else, with why (offers never run out by themselves).
export type OfferState = "yes" | "waiting" | "closed";
// said_no: declined. filled_elsewhere: someone else took the place. changed: the session was moved
// or cancelled (or put back to draft). no_reply: no answer before it started (or filled).
export type OfferWhy = "said_no" | "filled_elsewhere" | "changed" | "no_reply";

type OfferResponse = (typeof OFFER_RESPONSES)[number];
type ShiftStatus = (typeof SHIFT_STATUSES)[number];

// Said yes; waiting for a reply (no answer, on a session still open and to come: an answer never
// runs out by itself); or closed. A failed one has none: it never counts as offered.
export const offerStateSql = (now: Date): SQL<OfferState | null> => sql`(case
  when o.response = 'failed' then null
  when o.response = 'accepted' then 'yes'
  when o.response is null and s.status = 'open' and s.starts_at > ${now} then 'waiting'
  else 'closed' end)`;

// Why a closed offer closed: said no, someone else took the place, the session was moved or
// cancelled (or put back to draft), or no answer before it started (or filled).
export const offerWhySql = (now: Date): SQL<OfferWhy | null> => sql`(case
  when o.response = 'declined' then 'said_no'
  when o.response = 'filled_elsewhere' then 'filled_elsewhere'
  when o.response = 'expired' then 'changed'
  when o.response is null and s.status in ('cancelled', 'draft') then 'changed'
  when o.response is null and not (s.status = 'open' and s.starts_at > ${now}) then 'no_reply'
  else null end)`;

export function offerState(
  o: { response: OfferResponse | null; shiftStatus: ShiftStatus; startsAt: Date },
  now: Date,
): { state: OfferState; why: OfferWhy | null } | null {
  if (o.response === "failed") return null;
  if (o.response === "accepted") return { state: "yes", why: null };
  const toCome = o.shiftStatus === "open" && o.startsAt.getTime() > now.getTime();
  if (o.response === null && toCome) return { state: "waiting", why: null };
  if (o.response === "declined") return { state: "closed", why: "said_no" };
  if (o.response === "filled_elsewhere") return { state: "closed", why: "filled_elsewhere" };
  if (o.response === "expired") return { state: "closed", why: "changed" };
  return {
    state: "closed",
    why: o.shiftStatus === "cancelled" || o.shiftStatus === "draft" ? "changed" : "no_reply",
  };
}
