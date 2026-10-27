import { dateParts, timeRange } from "../portal/sign-copy";
import { roleLabel } from "../portal/format";
import type { SearchFound } from "./search";

// The office search's words (src/lib/office/search.ts; the top bar's "Find a casual, shift or
// site"): each thing found as a line to read and the page it opens. Pure, so the tests can read
// every line.

export const SEARCH_LABEL = "Find a casual, shift or site";
export const SEARCH_EMPTY = (q: string) => `Nothing found for “${q}”.`;

export interface SearchHit {
  href: string;
  title: string;
  detail: string;
  urgent: boolean;
}

export interface SearchGroup {
  kind: "casuals" | "sessions" | "sites";
  label: string;
  hits: SearchHit[];
  more: string | null; // there were others: what to do to see them
}

export interface SearchHits {
  groups: SearchGroup[]; // only the kinds with something found, in this order
  count: number; // the lines shown
}

const STATUS_WORDS = { active: null, inactive: "Not active", blocked: "Blocked" } as const;

const places = (n: number) =>
  n > 0 ? `${n} ${n === 1 ? "place" : "places"} to fill` : "No places to fill";
const events = (n: number) =>
  n > 0 ? `${n} ${n === 1 ? "event" : "events"} to come` : "No events to come";
const line = (parts: (string | null | undefined)[]) =>
  parts.filter((p): p is string => !!p && p.trim() !== "").join(" · ");

export function searchHits(f: SearchFound, timeZone: string): SearchHits {
  const groups: SearchGroup[] = [];
  if (f.casuals && f.casuals.rows.length > 0) {
    groups.push({
      kind: "casuals",
      label: "Casuals",
      hits: f.casuals.rows.map((c) => ({
        href: `/office/casuals/${c.id}`,
        title: `${c.firstName} ${c.lastName}`,
        detail: line([c.roles.map(roleLabel).join(", "), STATUS_WORDS[c.status]]),
        urgent: false,
      })),
      more: f.casuals.more ? "More casuals match. Type more of the name." : null,
    });
  }
  if (f.sessions && f.sessions.rows.length > 0) {
    groups.push({
      kind: "sessions",
      label: "Shifts",
      hits: f.sessions.rows.map((s) => {
        const d = dateParts(s.startsAt, timeZone);
        const when = `${d.dow} ${d.day} ${d.month}, ${timeRange(s.startsAt, s.endsAt, timeZone).range}`;
        return {
          href: `/office/shifts/${s.id}`,
          title: `${roleLabel(s.role)} · ${s.event}`,
          detail: line([when, [s.post, s.place].filter(Boolean).join(", "), places(s.placesFree)]),
          urgent: s.urgentGap,
        };
      }),
      more: f.sessions.more ? "More shifts match. Type more to narrow them down." : null,
    });
  }
  if (f.sites && f.sites.rows.length > 0) {
    groups.push({
      kind: "sites",
      label: "Sites",
      hits: f.sites.rows.map((s) => ({
        href: `/office/events?site=${s.id}`,
        title: s.name,
        detail: line([s.town, events(s.events)]),
        urgent: false,
      })),
      more: f.sites.more ? "More sites match. Type more of the name." : null,
    });
  }
  return { groups, count: groups.reduce((n, g) => n + g.hits.length, 0) };
}
