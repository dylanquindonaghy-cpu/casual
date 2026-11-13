import { roleLabel } from "../portal/format";
import { dayLabel } from "../rules/reasons";
import { localDateOf } from "../time/zoned";
import { EVENT_TAB_WORDS, EVENT_TABS, type EventTab } from "./event-page-copy";

// The office's detail pages name what they show in the browser tab (Phase 37.6, w1-09;
// docs/screens.md "Browser tab titles read"): the root layout adds " · {firm} shifts". Pure, no
// I/O: each page reads its record (with its own access check) and passes the words here. The
// office login, its link and not-found pages keep literal titles in their own files.

// "Aled Adeyemi · Casuals".
export const casualTabTitle = (name: string) => `${name} · Casuals`;

// "Aled Adeyemi · Data requests".
export const workerDataTabTitle = (name: string) => `${name} · Data requests`;

// "Northern Lights Live · Staffing": the event and the tab open (`?tab=`; an unknown one is
// Staffing, as the page shows).
export function eventTabTitle(name: string, tab: string | undefined): string {
  const open: EventTab = (EVENT_TABS as readonly string[]).includes(tab ?? "")
    ? (tab as EventTab)
    : "staffing";
  return `${name} · ${EVENT_TAB_WORDS[open]}`;
}

// "Door supervisor, Thu 12 Nov · Northern Lights Live". A comma between role and day on purpose:
// the page's headline "Door supervisor · Thu 12 Nov" would make a run of middle dots in the tab.
export function sessionTabTitle(s: {
  role: string;
  startsAt: Date;
  timeZone: string;
  eventName: string | null;
}): string {
  const head = `${roleLabel(s.role)}, ${dayLabel(localDateOf(s.startsAt, s.timeZone))}`;
  return s.eventName ? `${head} · ${s.eventName}` : head;
}

// "Cancellation 8CE76FA4 · Ben Carter", or "Cancellation 8CE76FA4" when two records share the ref.
export const cancellationTabTitle = (ref: string, casual?: string | null) =>
  casual ? `Cancellation ${ref} · ${casual}` : `Cancellation ${ref}`;
