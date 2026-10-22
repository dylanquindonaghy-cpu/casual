import type { NeedsItem } from "../credentials/status";
import { localDateOf } from "../time/zoned";
import type { TravelFacts } from "../travel/line-copy";
import type { StaffPhoto } from "../uploads/photo";
import type { OpenShift } from "./open-shifts";
import { pounds } from "./pay-format";
import { needsText, needsUpload } from "./qualification-copy";
import { datePartsOfDay } from "./sign-copy";

// The words of Home's redesign (Phases 18 and 20; docs/screens.md `/`): the "For you" tiles, the
// pass's travel figures and its "Bring and wear" items. Pure.

const METRES_PER_MILE = 1609.344;

// "Thu 22 and Fri 23 Oct", "Sun 25, Tue 27 and Wed 28 Oct", "… and more" past three days: the
// days the shifts are on, soonest first, each once, with the month on the last.
export function daysText(shifts: Pick<OpenShift, "startsAt">[], timeZone: string): string {
  const days = [...new Set(shifts.map((s) => localDateOf(s.startsAt, timeZone)))].sort();
  const shown = days.slice(0, 3).map(datePartsOfDay);
  const words = shown.map((p, i) =>
    i === shown.length - 1 ? `${p.dow} ${p.day} ${p.month}` : `${p.dow} ${p.day}`,
  );
  if (words.length === 0) return "";
  const list =
    words.length === 1 ? words[0]! : `${words.slice(0, -1).join(", ")} and ${words.at(-1)!}`;
  return days.length > 3 ? `${list.replace(/ and /, ", ")} and more` : list;
}

const shiftsWord = (n: number) => (n === 1 ? "1 shift" : `${n} shifts`);

// One of Home's "For you" tiles (Phase 20): what it's about (a small label), the one thing to read
// (large), and a line under it. Read in that order, so a screen reader hears "Urgent near you, 2
// shifts, Thu 22 and Fri 23 Oct, up to £15.50 an hour".
export interface TileText {
  label: string;
  value: string;
  caption: string;
}

// The urgent shifts she can take: "Urgent near you" when they're the ones within her home area
// (`near`), "2 shifts", their days and the best pay.
export function urgentTileText(
  urgent: Pick<OpenShift, "startsAt" | "payRatePence">[],
  near: boolean,
  timeZone: string,
): TileText {
  const rates = urgent.map((s) => s.payRatePence).filter((p): p is number => p != null);
  const top = rates.length > 0 ? Math.max(...rates) : null;
  const days = daysText(urgent, timeZone);
  return {
    label: near ? "Urgent near you" : "Urgent",
    value: shiftsWord(urgent.length),
    caption: top !== null ? `${days}, up to ${pounds(top)} an hour` : days,
  };
}

// The other shifts she can apply for ("More to apply for" under the urgent tile), and their days;
// with none, when she'll hear of the next.
export function applyTileText(
  shifts: Pick<OpenShift, "startsAt">[],
  afterUrgent: boolean,
  offerAlerts: boolean,
  timeZone: string,
): TileText {
  const label = afterUrgent ? "More to apply for" : "To apply for";
  if (shifts.length === 0) {
    return {
      label,
      value: afterUrgent ? "No others now" : "None right now",
      caption: offerAlerts ? "We'll message you when something matches." : "Check back later.",
    };
  }
  return { label, value: shiftsWord(shifts.length), caption: daysText(shifts, timeZone) };
}

// Pay day (D8: the pay week runs Monday to Sunday and is paid the Friday after it): "Fri 30 Oct",
// for the shifts of the week she's in.
export function payDayTileText(payDay: string): TileText {
  const p = datePartsOfDay(payDay);
  return {
    label: "Pay day",
    value: `${p.dow} ${p.day} ${p.month}`,
    caption: "For this week's shifts",
  };
}

// The offline copy's first row: what the urgent row said when it was kept.
export const offlineUrgentText = (n: number, at: string) =>
  n === 0
    ? `Open shifts show when you're online again.`
    : `${n === 1 ? "1 was" : `${n} were`} urgent at ${at}. We'll check again when you're online.`;

// What needs doing, as one row: the one thing (its title, the sentence Needs updating would
// say, and where she sorts it), or how many things, with the worst one's sentence (→ Profile). `urgent`: something
// stops her working (a qualification at level 1 or 2, or her photo overdue).
export function needsRowText(
  needs: NeedsItem[],
  photo: StaffPhoto,
  year: number,
): { title: string; sub: string; href: string; urgent: boolean; photo: boolean } | null {
  const items: { title: string; sub: string; href: string; level: number; photo: boolean }[] =
    needs.map((n) => ({
      title: needsTitle(n),
      sub: needsText(n, year),
      href: needsUpload(n.qualification) ? `/profile/upload/${n.qualification.type}` : "/profile",
      level: n.level,
      photo: false,
    }));
  if (photo.status === "overdue" || photo.status === "due_soon") {
    items.push({
      title: "Renew your staff photo",
      sub: `${photoDue(photo)} Take a new photo.`,
      href: "/profile#photo-heading",
      level: photo.status === "overdue" ? 2 : 3,
      photo: true,
    });
  }
  if (items.length === 0) return null;
  items.sort((a, b) => a.level - b.level);
  const first = items[0]!;
  const urgent = first.level <= 2;
  if (items.length === 1) {
    return { title: first.title, sub: first.sub, href: first.href, urgent, photo: first.photo };
  }
  // Several: how many, and the worst one's own sentence (Profile has them all).
  return {
    title: `${items.length} things need doing`,
    sub: `${first.sub} And ${items.length - 1} more.`,
    href: "/profile",
    urgent,
    photo: false,
  };
}

// "Due by 10 Nov.", "It was due by 10 Nov." (her photo's renewal date).
function photoDue(photo: StaffPhoto): string {
  const by = photo.current?.renewBy;
  if (!by) return photo.status === "overdue" ? "It's overdue." : "It's due soon.";
  const p = datePartsOfDay(by);
  return photo.status === "overdue"
    ? `It was due by ${p.day} ${p.month}.`
    : `Due by ${p.day} ${p.month}.`;
}

// A qualification's short title, by what she has to do about it.
// The stored name is already mid-sentence ("SIA door supervisor licence", "first aid at work
// certificate").
function needsTitle(n: NeedsItem): string {
  const lower = n.qualification.name;
  switch (n.qualification.status) {
    case "missing":
      return `Add your ${lower}`;
    case "suspended":
      return `Your ${lower} is suspended`;
    case "applied":
      return `Your ${lower} is applied for`;
    case "being_checked":
      return `We're checking your ${lower}`;
    case "rejected":
      return `Send your ${lower} again`;
    default:
      return `Renew your ${lower}`;
  }
}

// The pass's travel strip: up to three figures with their words ("15 min" by car, "31 min" by
// public transport, "5.0 mi" away), or one sentence when they aren't known.
export type TravelStrip =
  { kind: "cells"; cells: { figure: string; words: string }[] } | { kind: "words"; words: string };

export function travelStrip(f: TravelFacts): TravelStrip {
  if (f.kind === "unknown") return { kind: "words", words: "Distance not known yet" };
  if (f.kind === "straight") {
    return {
      kind: "cells",
      cells: [
        {
          figure: `${Math.max(1, Math.round(f.straightMetres / METRES_PER_MILE))} mi`,
          words: "in a straight line",
        },
        { figure: "Not known", words: "travel time yet" },
      ],
    };
  }
  const miles =
    f.car?.metres != null
      ? { figure: `${(f.car.metres / METRES_PER_MILE).toFixed(1)} mi`, words: "away" }
      : {
          figure: `${Math.max(1, Math.round(f.straightMetres / METRES_PER_MILE))} mi`,
          words: "in a straight line",
        };
  return {
    kind: "cells",
    cells: [
      f.car
        ? { figure: `${f.car.minutes} min`, words: "by car" }
        : { figure: "90+ min", words: "by car" },
      f.publicTransport
        ? { figure: `${f.publicTransport.minutes} min`, words: "by public transport" }
        : { figure: "None", words: "public transport in time" },
      miles,
    ],
  };
}

// "Bring and wear", as tiles: the firm's uniform words split at commas and semicolons (not
// inside brackets), each item's bracketed words its note ("We provide it"), and what kind of
// thing it is for its icon. Hi-vis comes first, as a full-width sign-yellow tile. More than six
// items, or nothing to split: null (the words are shown as they are).
export type UniformKind = "hivis" | "trousers" | "shoe" | "garment";
export interface UniformItem {
  words: string;
  note: string | null;
  kind: UniformKind;
}

const capital = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export function uniformItems(text: string | null | undefined): UniformItem[] | null {
  if (!text?.trim()) return null;
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  const items = parts
    .map((p) => p.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .map((p): UniformItem => {
      const note = p.match(/\(([^)]*)\)/)?.[1]?.trim() || null;
      const words = p.replace(/\s*\([^)]*\)\s*/g, " ").trim();
      const kind: UniformKind = /\b(hi-?vis|high-?vis|tabard|vest|reflective)\b/i.test(words)
        ? "hivis"
        : /\b(trousers|jeans|skirt|shorts)\b/i.test(words)
          ? "trousers"
          : /\b(shoes?|boots?|footwear|trainers)\b/i.test(words)
            ? "shoe"
            : "garment";
      return { words: capital(words), note: note ? capital(note) : null, kind };
    });
  if (items.length === 0 || items.length > 6) return null;
  // Long items, or sentences ("Black trousers, boots. Hi-vis provided."), read better as written.
  if (items.some((i) => i.words.length > 60 || /[.!?]\s/.test(i.words))) return null;
  return [...items.filter((i) => i.kind === "hivis"), ...items.filter((i) => i.kind !== "hivis")];
}
