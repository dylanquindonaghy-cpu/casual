import type { ReactNode } from "react";

// The few icons the office's top bar, its menu, the office guide and the casual app's tab bar use: 20px line drawings in
// the text colour, hand-written (no icon library; inline SVG also works in the offline copy).
// Always beside words or purely visual cues, so hidden from screen readers. Hook-free: safe in
// server and client components.

const PATHS = {
  // The dashboard: a house.
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v11.5h13V9" />
      <path d="M10 20.5v-6h4v6" />
    </>
  ),
  // Pay dashboard: four tiles.
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  // Shifts: a calendar.
  shifts: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  // Requests: an inbox tray.
  requests: (
    <>
      <path d="M3.5 13.5h5l1.5 3h4l1.5-3h5" />
      <path d="M6 5h12l2.5 8.5v5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-5L6 5Z" />
    </>
  ),
  // Workers: two people.
  workers: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17 14.5c2.2.2 3.8 1.7 4.3 4.5" />
    </>
  ),
  // Action log: a list.
  log: (
    <>
      <path d="M9 6h11.5" />
      <path d="M9 12h11.5" />
      <path d="M9 18h11.5" />
      <path d="M4 6h.01" />
      <path d="M4 12h.01" />
      <path d="M4 18h.01" />
    </>
  ),
  // Notice report: a page with lines.
  notice: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </>
  ),
  // Pilot metrics: a bar chart.
  pilot: (
    <>
      <path d="M4 3.5v17h16.5" />
      <path d="M8.5 16.5v-5" />
      <path d="M13 16.5v-9" />
      <path d="M17.5 16.5v-3" />
    </>
  ),
  // Pay queries: a banknote.
  // The casual's Profile tab (12H.1): one person.
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5" />
    </>
  ),
  pay: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v.01" />
      <path d="M18 14.5v.01" />
    </>
  ),
  // Import pay records: an upload arrow into a tray.
  import: (
    <>
      <path d="M12 15V3.5" />
      <path d="m7 8 5-4.5L17 8" />
      <path d="M4 14.5v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  // Office team: a shield with a tick.
  team: (
    <>
      <path d="M12 3 19.5 6v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  // Data requests: a database.
  data: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
      <path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13" />
      <path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
    </>
  ),
  // Cancellations: a calendar page with a cross.
  cancel: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M9.5 12.5l5 5M14.5 12.5l-5 5" />
    </>
  ),
  // Strikes: a warning triangle (the mock-up's).
  strike: (
    <>
      <path d="M12 3.5 21 19H3L12 3.5Z" />
      <path d="M12 10v4M12 16.5h.01" />
    </>
  ),
  // Settings: two sliders.
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="9" cy="17" r="2.5" />
    </>
  ),
  // Integrations: a plug, for the planner's connection.
  plug: (
    <>
      <path d="M9 3.5v4M15 3.5v4" />
      <path d="M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0v-3Z" />
      <path d="M12 16v4.5" />
    </>
  ),
  // How-to guide: an open book.
  guide: (
    <>
      <path d="M2.5 5.5c3-1.2 6.2-1 9.5 1 3.3-2 6.5-2.2 9.5-1v13c-3-1.2-6.2-1-9.5 1-3.3-2-6.5-2.2-9.5-1v-13Z" />
      <path d="M12 6.5v13" />
    </>
  ),
  // Log out: an arrow leaving a door.
  logout: (
    <>
      <path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5" />
      <path d="m15.5 16.5 4.5-4.5-4.5-4.5" />
      <path d="M20 12H9.5" />
    </>
  ),
  // More this way: an arrow head pointing right (`rotate-180` points it left, `rotate-90` down).
  // The arrow on each link in the office guide's contents (below 1280px), and the account button's.
  chevron: <path d="m9 5.5 6.5 6.5L9 18.5" />,
  // The office's Menu button (phones and tablets): three lines.
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  // Closing the menu drawer: a cross.
  close: <path d="M6 6l12 12M18 6 6 18" />,
  // The theme button: a moon (switch to dark), a sun (switch to light).
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  // Enquiries' channels (12D.1), each beside its hidden word: a speech bubble (WhatsApp), a phone
  // (a text), a tape (a voicemail), an envelope (an email to the staffing inbox: Phase 25.5).
  whatsapp: <path d="M4 5.5h16v10H9.5L4 19.5v-14Z" />,
  // Two speech bubbles: a casual's Messages tab, and a message in the app on Enquiries (Phase 25.6).
  messages: (
    <>
      <path d="M3.5 4.5h12v8.5H8L3.5 16.5v-12Z" />
      <path d="M18.5 9h2v10.5L17 16.5h-6.5V15" />
    </>
  ),
  sms: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 17.5h2" />
    </>
  ),
  voice: (
    <>
      <circle cx="7" cy="12" r="3.5" />
      <circle cx="17" cy="12" r="3.5" />
      <path d="M7 15.5h10" />
    </>
  ),
  email: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <path d="m4 6.5 8 6.5 8-6.5" />
    </>
  ),
  // The office's bell (Needs attention, 12E.1): a bell.
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  // Phase 18's: urgent (a warning sign), done (a tick), a photo to take, what to bring and wear,
  // the maps button, a wait, no signal, the shifts line, add, shown to casuals.
  urgent: (
    <>
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 10v4.5M12 17.2v.01" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  camera: (
    <>
      <path d="M4 7.5h3.5L9 5h6l1.5 2.5H20a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  tabard: (
    <>
      <path d="M8 3 4 6v15h16V6l-4-3" />
      <path d="M8 3l4 5 4-5" />
      <path d="M4 12h16M4 16h16" />
    </>
  ),
  trousers: <path d="M7 3h10l1 18h-4.5L12 10l-1.5 11H6z" />,
  shoe: (
    <>
      <path d="M3 16V8h5l2 3 7 1.5a3.5 3.5 0 0 1 3.5 3.5v1H3z" />
      <path d="M3 19h17.5" />
    </>
  ),
  garment: (
    <>
      <path d="M9 3.5 4 6l1.5 4.5L8 9.5V20.5h8V9.5l2.5 1L20 6l-5-2.5a3 3 0 0 1-6 0z" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  offline: (
    <>
      <path d="M3 3l18 18" />
      <path d="M8.5 6.2A6 6 0 0 1 17.6 10H18a4 4 0 0 1 2.4 7.2M17 19H7a4.5 4.5 0 0 1-1.6-8.7" />
    </>
  ),
  phone: (
    <path d="M5 3.5h4l2 5-2.5 1.5a11 11 0 0 0 5.5 5.5L15.5 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5.5a2 2 0 0 1 2-2z" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  eye: (
    <>
      <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // Phase 20: the pass's buttons (Details, Can't make it?), a hidden event, a row's "…", "go to".
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  dropout: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M10 13.5l4 4M14 13.5l-4 4" />
    </>
  ),
  hidden: (
    <path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-2.6 3.2M6.2 7.6C3.9 9.3 3 12 3 12s4 6 9 6a8.7 8.7 0 0 0 3.6-.8" />
  ),
  dots: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  // Phase 24 (round 7's office shell): the search, the rail's own button (a panel with its edge),
  // offers out (a paper plane) and things to check (a ticked box).
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16M14 10l2 2-2 2" />
    </>
  ),
  send: (
    <>
      <path d="m21.5 2.5-7 19-4-8.5-8.5-4z" />
      <path d="M21.5 2.5 10.5 13" />
    </>
  ),
  checkbox: (
    <>
      <path d="m9 11 3 3 8-8" />
      <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  // Phase 24 (round 7's dashboard): a board column's leaf (filled in its colour by `fill`), and
  // "open the whole list" (an arrow up and to the right).
  leaf: <path d="M5 19C5 10 10 4 20 4c0 10-6 15-15 15z" fill="currentColor" stroke="none" />,
  out: <path d="M7 17 17 7M8 7h9v9" />,
  // Phase 24 (round 7's casual app): an open shift's travel line (a car, as the line always gives
  // the drive), "Site and role" (the filters), and a shift's "Open in maps" (a folded map).
  car: (
    <>
      <path d="M5 11l1.5-4a2 2 0 0 1 1.9-1.3h7.2a2 2 0 0 1 1.9 1.3L19 11" />
      <rect x="3.5" y="11" width="17" height="6" rx="2" />
      <path d="M6.5 17v2M17.5 17v2M7.5 14h.01M16.5 14h.01" />
    </>
  ),
  filter: <path d="M4 7h16M7 12h10M10 17h4" />,
  map: <path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2zM9 4.5v13M15 6.5v13" />,
  // ShiftDesk's own mark, in the office's top bar: a calendar with a tick.
  mark: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17M8.5 14.5l2.5 2.5 4.5-5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

// 20px unless `size` says otherwise (the casual app's tiles use 24 and 28).
export function Icon({
  name,
  className,
  size = 20,
}: {
  name: IconName;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0${className ? ` ${className}` : ""}`}
    >
      {PATHS[name]}
    </svg>
  );
}
