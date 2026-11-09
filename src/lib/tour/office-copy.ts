import type { TourStep } from "./steps";

// The office's first-login tour (Phase 33.2; docs/screens.md "## Phase 33", checked against it by
// tests/unit/tour.copy.test.ts and for plain words by tests/unit/copy.plain-language.test.ts):
// the welcome window, then eight steps on the real dashboard, each pointing at the element that
// carries its `data-tour` anchor. Pure and browser-safe.

// "Acme Events' office", "Northline Staffing's office".
export const possessive = (name: string): string =>
  /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;

export const OFFICE_WELCOME = {
  title: (firmName: string) => `Welcome to ${possessive(firmName)} office`,
  intro:
    "A 25-second look round, then we'll point at each part of your dashboard. You can take it again any time from your name menu.",
  // What the video's space shows before it plays, or when it can't (its first two captions).
  posterTop: "60 emails a day?",
  posterBottom: "Here's your one screen.",
  videoLabel: "The office in 25 seconds",
  soundOn: "Turn the sound on",
  start: "Start the walkthrough",
  skipVideo: "Skip the video",
  notNow: "Not now",
} as const;

// The walkthrough's own words (both tours share them).
export const TOUR_CONTROLS = {
  stepOf: (n: number, of: number) => `Step ${n} of ${of}`,
  back: "Back",
  next: "Next",
  done: "Done",
  skip: "Skip",
  label: "Tour",
} as const;

// The account menu's entries beside the how-to guide (Phase 33.2).
export const TOUR_MENU = {
  again: "Take the tour again",
  quickGuide: "Quick guide",
} as const;

export const OFFICE_TOUR_STEPS: readonly TourStep[] = [
  {
    anchor: "counts",
    path: "/office",
    title: "Your day in numbers",
    body: "Places to fill, urgent ones, offers out, what needs attention and pay queries. Tap any count to see the list behind it.",
  },
  {
    anchor: "tabs",
    path: "/office",
    title: "Pick what you see",
    body: "All sessions, just the urgent ones, this week or next. The map and the card follow.",
  },
  {
    anchor: "map",
    path: "/office",
    title: "Every venue with places to fill",
    body: "Red means urgent. Tap a pin to open its session in the card.",
  },
  {
    anchor: "session-card",
    path: "/office",
    title: "The session you picked",
    body: "Who's booked, how many casuals have the qualifications, rest and hours for it, and what's still open.",
  },
  {
    anchor: "offer",
    path: "/office",
    title: "Offer to someone",
    body: "Sends it to the best casuals who qualify, in waves. The first yes gets it; everyone else is told it's gone.",
  },
  {
    anchor: "menu",
    path: "/office",
    title: "Everything else lives here",
    body: "Updates, Enquiries, Events, Cancellations, Pay, Casuals. Messages from casuals land in Enquiries, all in one place and logged.",
  },
  {
    anchor: "search",
    path: "/office",
    title: "Find anyone or anything",
    body: "Search casuals, sessions and venues. Ctrl K opens it from any page.",
  },
  {
    anchor: "you",
    path: "/office",
    title: "Take it again any time",
    body: 'Your name menu has "Take the tour again" and the quick guide: where everything lives and how the API works.',
  },
];
