import type { DeclineAskResult } from "../roster/asks";
import { wallTimeOf } from "../time/zoned";
import { reliabilityWords } from "../rules/reliability";
import type { SetCasualsAskResult } from "./casuals-ask";
import type { BookBestResult } from "./session-asks-office";
import type { CasualsTab, SessionCasual } from "./session-casuals";
import { assignResultText } from "./shifts-copy";

// A session's page, round 8 (Phase 26.6; docs/screens.md "A session, round 8"): its words, in one
// place for the page and the tests. Short sentences, plain words; buttons say what happens.

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };
const COMMON: Record<Common["status"], string> = {
  logged_out: "You've been logged out. Log in again.",
  not_allowed: "Only an admin or resourcer can do this.",
  error: "That didn't work. Try again.",
};

// The page's own tabs: the casuals (where it starts) and its history.
export const SESSION_TABS = ["casuals", "history"] as const;
export type SessionTab = (typeof SESSION_TABS)[number];
export const SESSION_TAB_WORDS: Record<SessionTab, string> = {
  casuals: "Casuals",
  history: "History",
};

export const CASUALS_TITLE = "Casuals for this session";
export const MOST_RELIABLE_FIRST = "Most reliable first";
export const CASUALS_TAB_WORDS: Record<CasualsTab, string> = {
  asked: "Asked for it",
  offered: "Offered",
  said_no: "Said no",
  booked: "Booked",
  could: "Can take it",
};

export const FILTER_WORDS = {
  reliable: "Reliability 80%+",
  near: "Within 45 min",
  here: "Worked here before",
} as const;
export type FilterKey = keyof typeof FILTER_WORDS;

export function emptyTabText(tab: CasualsTab, casualsAsk: boolean, filtered: boolean): string {
  if (filtered && tab !== "booked") return "Nobody here matches these filters.";
  switch (tab) {
    case "asked":
      return casualsAsk
        ? 'Nobody has asked yet. Casuals see "I can do this" on this event\'s sessions.'
        : 'Casuals take places on this event. Switch on "Casuals ask, you choose" to choose from who asks.';
    case "offered":
      return "Nobody has been offered it.";
    case "said_no":
      return "Nobody has said no.";
    case "booked":
      return "Nobody booked yet.";
    case "could":
      return "Nobody else the rules allow right now.";
  }
}

export const COULD_MORE = "More could take it: the most reliable 100 are shown.";

// What they hold and how they've done here: "Steward Level 2 · worked here 6 times · 1 live strike".
export function holdsLine(c: Pick<SessionCasual, "holds" | "workedHere" | "liveStrikes">): string {
  const parts = [...c.holds];
  if (c.workedHere === 1) parts.push("worked here once");
  else if (c.workedHere === 2) parts.push("worked here twice");
  else if (c.workedHere > 2) parts.push(`worked here ${c.workedHere} times`);
  if (c.liveStrikes > 0) {
    parts.push(`${c.liveStrikes} live ${c.liveStrikes === 1 ? "strike" : "strikes"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Nothing needed for this one";
}

export const reliabilityText = (c: Pick<SessionCasual, "reliability">) =>
  reliabilityWords(c.reliability);

// "5.0 mi" (straight line), with the travel time when known: "5.0 mi · 25 min".
export function distanceText(c: Pick<SessionCasual, "miles" | "minutes">): string {
  const parts: string[] = [];
  if (c.miles !== null) parts.push(`${c.miles.toFixed(1)} mi`);
  if (c.minutes !== null) parts.push(`${c.minutes} min`);
  return parts.length > 0 ? parts.join(" · ") : "Not known";
}

const OFFER_WORDS: Record<string, string> = {
  expired: "Offer closed",
  filled_elsewhere: "Filled by others",
  failed: "Not sent",
  accepted: "Took it",
  declined: "Said no",
};

// The row's chip: "Asked 14:02", "Not this time", "Offered 14:02", "Said no 14:05", "Booked".
export function whenText(tab: CasualsTab, c: SessionCasual, time: (d: Date) => string): string {
  const at = c.when ? ` ${time(c.when)}` : "";
  switch (tab) {
    case "asked":
      return c.notThisTime ? "Not this time" : `Asked${at}`;
    case "offered":
      return c.offer ? (OFFER_WORDS[c.offer] ?? c.offer) : `Offered${at}`;
    case "said_no":
      return `Said no${at}`;
    case "booked":
      return "Booked";
    case "could":
      return "Not asked";
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
export function clockTime(d: Date, timeZone: string): string {
  const w = wallTimeOf(d, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

export const BOOK = "Book";
export const NOT_THIS_TIME = "Not this time";
export const bookLabel = (name: string) => `Book ${name}`;
export const moreFor = (name: string) => `More for ${name}`;

export function notThisTimeResultText(result: DeclineAskResult | Common, name: string): string {
  switch (result.status) {
    case "declined":
      return `Not this time: ${name} will be told.`;
    case "not_waiting":
      return `${name}'s ask has already been answered.`;
    default:
      return COMMON[result.status];
  }
}

export const bookResultText = assignResultText;

export const bookBestButton = (n: number) => `Book the best ${n}`;
export function bookBestConfirm(names: string[]): string {
  const list =
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Book ${list}? Each is checked against the rules first, and told by message.`;
}
export const BOOK_THEM = "Yes, book them";
export const KEEP_AS_IS = "Not now";

export function bookBestResultText(result: BookBestResult | Common): string {
  switch (result.status) {
    case "done": {
      const said: string[] = [];
      if (result.booked.length > 0) {
        said.push(`Booked: ${result.booked.join(", ")}. They'll get a message to say so.`);
      }
      if (result.notAsking.length > 0) {
        said.push(`Not booked, their ask was answered since: ${result.notAsking.join(", ")}.`);
      }
      for (const r of result.refused) said.push(bookResultText(r.result, r.name));
      if (said.length === 0) said.push("Every place is taken.");
      return said.join(" ");
    }
    case "nobody":
      return "Nobody who asked can be booked now.";
    default:
      return COMMON[result.status];
  }
}

// The "This session" panel.
export const THIS_SESSION = "This session";
export const CASUALS_ASK = "Casuals ask, you choose";
export const CASUALS_ASK_LINE =
  "On: casuals ask, you choose who gets it. Off: the first casual to tap gets it. Applies to every session in this event.";
export const CHECKS_FIRST =
  "the rules, their licence and their hours. A place can only be booked once.";
export const CHECKS_FIRST_LEAD = "Booking runs every check first:";

export function casualsAskResultText(
  result: SetCasualsAskResult | Common | { status: "invalid" },
): string {
  switch (result.status) {
    case "on":
      return 'On: casuals on this event now tap "I can do this", and you choose.';
    case "off":
      return "Off: the first casual to tap takes a place.";
    case "unchanged":
      return "Nothing changed.";
    case "not_found":
    case "invalid":
      return "We can't find that event.";
    default:
      return COMMON[result.status];
  }
}

// The "…" menu and its panels.
export const PANEL_WORDS = {
  assign: "Assign someone",
  edit: "Edit this session",
  details: "Session details",
  change: "Move, shorten or cancel",
} as const;
export type PanelKey = keyof typeof PANEL_WORDS;
export const CLOSE_PANEL = "Close";
export const SEE_IN_LOG = "See it in the action log";
export const MORE_FOR_SESSION = "More for this session";
