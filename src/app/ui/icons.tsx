import type { ReactNode } from "react";

// The few icons the office's top bar, its menu and the office guide use: 20px line drawings in
// the text colour, hand-written (no icon library; inline SVG also works in the offline copy).
// Always beside words or purely visual cues, so hidden from screen readers. Hook-free: safe in
// server and client components.

const PATHS = {
  // Today, and payroll's Home: a house.
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
  // ShiftDesk's own mark, in the office's top bar: a calendar with a tick.
  mark: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17M8.5 14.5l2.5 2.5 4.5-5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="20"
      height="20"
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
