// The words of the staffing demo's pages (Phase 31; docs/screens.md "Phase 31"): the login (31.1),
// "Choose a view" and its phone frame (31.2) and the quick guide (31.3). Plain strings, safe
// anywhere; the pages read them from here and tests/unit/demo.start-copy.test.ts and
// tests/unit/copy.plain-language.test.ts hold them to the screens doc and to plain words.

export const LOGIN_COPY = {
  title: "Staffing demo login",
  intro: "Log in to the demo with the staffing account.",
  // After Log out, on the staffing demo (Phase 34): the other login pages' words.
  loggedOut: "You're logged out.",
  email: "Email",
  password: "Password",
  button: "Log in",
  pending: "Logging in…",
  wrong: "That email and password don't match.",
  tooMany: "Too many tries. Wait 15 minutes, then try again.",
  problem: "Something went wrong. Try again.",
  // The line on the Demo phone and the office login page (demo servers only).
  linkLine: "Demo: log in with the staffing account",
} as const;

export const CHOOSER_COPY = {
  title: "Choose a view",
  intro: "See the demo as the office, a casual or a client. You can come back here at any time.",
  office: {
    title: "Staffing and resourcing view",
    body: "The office: urgent gaps, who to offer, cancellations, enquiries and the log.",
    href: "/office",
  },
  casual: {
    title: "Casual mobile view",
    body: "What a casual sees on their phone: their shifts, open shifts, pay day and qualifications.",
    pending: "Opening…",
    loggedOut: "You're logged out. Log in again to open the casual view.",
    noCasual: "The demo casual isn't there. Reset the demo, then try again.",
    problem: "Something went wrong. Try again.",
  },
  // Phase 36.5: the client's pages, as the match day's client login sees them.
  client: {
    title: "Client view",
    body: "What a client sees: their events in numbers and the requests they send. Never a casual's name.",
    href: "/client",
    pending: "Opening…",
    loggedOut: "You're logged out. Log in again to open the client view.",
    noClient: "The demo client isn't there. Reset the demo, then try again.",
    problem: "Something went wrong. Try again.",
  },
  guide: "Quick guide: where everything lives",
  loggedInAs: (name: string) => `Logged in as ${name}.`,
} as const;

export const PHONE_COPY = {
  title: "Casual mobile view",
  intro: (name: string) => `This is the casual app as ${name} sees it on a phone.`,
  frameTitle: "The casual app",
  fullScreen: "Open full screen",
  back: "Back to choose a view",
} as const;

// The quick guide (31.3). Each section's words; the lists of pages are built from the real menus
// (src/app/start/guide/guide-view.tsx), each with its line here.
export const GUIDE_COPY = {
  title: "Quick guide",
  intro: "Where everything lives, what it does and how it works.",
  back: "Back to choose a view",
  backToOffice: "Back to the office",
  howTo: { before: "For step-by-step help, open the ", link: "How-to guide" },
  sections: {
    what: {
      id: "what-it-is",
      heading: "What ShiftDesk is",
      paragraphs: [
        "ShiftDesk is a staff portal and shifts line for casual workers. It's for staffing firms.",
        "It sits alongside the firm's own planner. Nobody has to stop using what they have.",
        "Casuals get a link, with no app to download. They see their shifts, take open shifts, cancel, ask for changes and see their pay days.",
        "The office gets one dashboard instead of calls and emails all day.",
      ],
    },
    notCrm: {
      id: "not-a-crm",
      heading: "It isn't a CRM",
      paragraphs: [
        "The firm's planner or CRM stays where clients, sites and sessions are made. The firm's records live there.",
        "ShiftDesk doesn't replace it. It doesn't hold the firm's sales or client records.",
        "It keeps what the planner doesn't do: offers to casuals, who said yes, cancellations with notice, enquiries, qualification checks and a log of every change.",
      ],
    },
    api: {
      id: "how-it-works",
      heading: "How it works with the API",
      paragraphs: [
        "The planner sends sessions in through ShiftDesk's API, at /api/v1. It uses a key that the firm's admin makes in Settings, under Integrations.",
        "Each change is answered at once. Sending the same one again is safe, because it carries the planner's own reference.",
        "When something changes, ShiftDesk sends a signed webhook back to the planner. For example, a place is filled or someone cancels. So the planner stays up to date.",
        "A firm without a planner that can call the API can use a Google Sheet, a file it uploads, or a connector we set up.",
      ],
      diagram: {
        label: "How the planner, ShiftDesk and casuals connect",
        planner: "The firm's planner",
        shiftdesk: "ShiftDesk",
        casuals: "Casuals",
        apiIn: "Sessions in, through the API",
        toCasuals: "Casual app, WhatsApp and texts",
        webhooksOut: "Signed webhooks back to the planner: places filled and cancellations",
      },
    },
    where: {
      id: "where-everything-lives",
      heading: "Where everything lives",
      officeHeading: "The office",
      casualHeading: "The casual app",
      casualNote:
        "These are the casual's pages. They open as the casual this browser is logged in as.",
    },
    rules: {
      id: "golden-rules",
      heading: "Golden rules, in short",
      points: [
        "AI reads, code decides. AI only sorts messages, drafts replies and sums things up. It never picks who gets a shift or what anyone is paid.",
        "Every firm's data is kept apart.",
        "Every change is logged: offers, bookings, cancellations and messages.",
        "Qualifications are checked before any offer.",
        "Pay disputes go to payroll, never to AI.",
      ],
    },
  },
} as const;

// One line for each office page the menu links to (src/app/office/office-menu.ts), by its address.
// The guide shows only the pages the person's role can open.
export const OFFICE_PAGE_LINES: Record<string, string> = {
  "/office": "Urgent gaps, what casuals can see, cancellations and what needs you today.",
  "/office/updates": "What happened on your sessions, newest first.",
  "/office/needs-attention": "Things that need a person to look at them.",
  "/office/events": "Every event and its sessions. Show or hide them from casuals.",
  "/office/enquiries": "Messages from the shifts line and requests from the casual app.",
  "/office/client-requests": "What your clients ask for from their logins. Accept or decline each.",
  "/office/cancellations": "Every cancellation, with its notice and reason.",
  "/office/pay": "Pay at a glance for payroll.",
  "/office/pay-queries": "Casuals' pay questions, grouped for payroll.",
  "/office/pay/import": "Add pay lines from payroll's file.",
  "/office/casuals": "Every casual, their qualifications and photos to check.",
  "/office/strikes": "Late cancellations and no-shows, and their strikes.",
  "/office/reports/notice": "Notice given for every change, for your records.",
  "/office/log": "Every change, who made it and when.",
  "/office/reports/pilot": "How the pilot is going, week by week.",
  "/office/team": "Who can log in to the office, and their roles.",
  "/office/settings": "The firm's settings, sites and strikes team.",
  "/office/settings/answers":
    "Your automatic answers to casuals' common questions, and where they go.",
  "/office/settings/integrations": "API keys and webhooks for your planner.",
  "/office/data": "Send someone their data, or delete it when they ask.",
  "/office/guide": "Step-by-step help for every job in the office.",
};

// The casual app's pages, each with its line.
export const CASUAL_PAGES: readonly { href: string; label: string; line: string }[] = [
  { href: "/", label: "Home", line: "Her next shift, her counts, things to do and offers." },
  { href: "/shifts", label: "Shifts", line: "The shifts she's booked on, and past ones." },
  { href: "/shifts/open", label: "Open shifts", line: "Shifts she can take now." },
  { href: "/urgent", label: "Urgent", line: "Shifts starting soon that need someone." },
  { href: "/messages", label: "Messages", line: "Her messages to the office, and its replies." },
  { href: "/pay", label: "Pay", line: "Her pay day and hours, after a code." },
  { href: "/profile", label: "Profile", line: "Her details, qualifications and availability." },
  { href: "/requests", label: "Requests", line: "Time changes and other asks, and the answers." },
  { href: "/help", label: "Help", line: "How the app works, in plain words." },
];
