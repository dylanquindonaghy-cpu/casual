import { possessive } from "./office-copy";
import type { TourStep } from "./steps";

// The casuals' first-login tour (Phase 33.3; docs/screens.md "## Phase 33", "### 33.3", checked
// against it by tests/unit/tour.copy.test.ts and for plain words by
// tests/unit/copy.plain-language.test.ts): the welcome window with the casual video, then seven
// steps on Home, each pointing at the element that carries its `data-tour` anchor (the counts, her
// next shift, its Directions and "Can't make it?", then the Shifts, Pay and Profile tabs: the tab
// bar on a phone, the rail on a laptop). Every sentence was checked against what the app does
// (33.3's notes in the doc). Pure and browser-safe.

export const CASUAL_WELCOME = {
  title: (firmName: string) => `Welcome to ${possessive(firmName)} shifts`,
  intro:
    "A 20-second look round, then we'll point at each part of your Home. You can take it again any time from Profile.",
  // What the video's space shows before it plays, or when it can't (its first caption).
  posterTop: "Your shifts.",
  posterBottom: "One link.",
  videoLabel: "Your shifts in 20 seconds",
  soundOn: "Turn the sound on",
  start: "Start the walkthrough",
  skipVideo: "Skip the video",
  notNow: "Not now",
} as const;

// "Take the tour again" on Profile (a row with its line) and on Help (Phase 33.3).
export const CASUAL_TOUR_AGAIN = {
  title: "Take the tour again",
  sub: "Video and walkthrough, 1 minute",
} as const;

export const CASUAL_TOUR_STEPS: readonly TourStep[] = [
  {
    anchor: "counts",
    path: "/",
    title: "Your shifts at a glance",
    body: "Booked, open to you, urgent, things to do and messages. Tap one to see it.",
  },
  {
    anchor: "next-shift",
    path: "/",
    title: "Your next shift",
    body: "When and where, and about what you'll earn before tax. It's saved on this phone, so it shows with no signal too.",
  },
  {
    anchor: "directions",
    path: "/",
    title: "Getting there",
    body: "Directions opens the place in Google Maps. Details shows the rest: where to go, what to bring, pay and instructions.",
  },
  {
    anchor: "cant-make-it",
    path: "/",
    title: "Can't make it?",
    body: "Tell the office in a few taps. It's logged with how much notice you gave.",
  },
  {
    anchor: "tab-shifts",
    path: "/",
    title: "Shifts",
    body: "Your bookings, and the open shifts you can take or ask for.",
  },
  {
    anchor: "tab-pay",
    path: "/",
    title: "Pay",
    body: "Your pay day, then your hours and rates once you've entered a code. Pay questions go to payroll.",
  },
  {
    anchor: "tab-profile",
    path: "/",
    title: "Profile",
    body: 'Your qualifications and staff photo. We remind you before a qualification runs out. "Take the tour again" is here too.',
  },
];
