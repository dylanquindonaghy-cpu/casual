import Link from "next/link";
import type { ReactNode } from "react";
import { Name, Points, Step, Steps } from "@/app/help/guide-parts";
import { canAccess, type OfficeArea, type OfficeRole } from "@/lib/auth/roles";
import { btn, h2, meta, page, rows } from "../../ui/classes";
import { Icon, type IconName } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { StatusChip, type StatusTone } from "../../ui/status-chip";
import type { MenuGroup } from "../office-nav";

// The office's how-to guide (/office/guide; docs/ui-design.md "Guides"): the everyday jobs, in the
// order of a working day, each with the steps and a link to the page. It shows only the parts the
// user's role can open, and names every button, field and section exactly as it reads on screen.
// Pure and hook-free: the page passes the firm's name, the role and the role's menu.

type Section = {
  id: string;
  title: string;
  // Shown when the role can open any of these areas (every role sees a section with none).
  areas: OfficeArea[];
  body: (role: OfficeRole, menu: MenuGroup[]) => ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: "getting-around",
    title: "Getting around",
    areas: [],
    body: (_role, menu) => <GettingAround menu={menu} />,
  },
  {
    id: "today",
    title: "Start your day on the dashboard",
    areas: ["today"],
    body: () => <DashboardPart />,
  },
  {
    id: "fill-a-gap",
    title: "Fill a gap",
    areas: ["today"],
    body: (role) => <FillAGap role={role} />,
  },
  { id: "add-shifts", title: "Add shifts", areas: ["shifts"], body: () => <AddShifts /> },
  {
    id: "change-a-shift",
    title: "Change or cancel a shift",
    areas: ["shifts"],
    body: () => <ChangeAShift />,
  },
  { id: "after-a-shift", title: "After a shift", areas: ["shifts"], body: () => <AfterAShift /> },
  { id: "enquiries", title: "Enquiries", areas: ["enquiries"], body: () => <Enquiries /> },
  { id: "casuals", title: "Casuals", areas: ["casuals"], body: () => <Workers /> },
  {
    id: "records",
    title: "Records",
    areas: ["log", "reports", "pilot"],
    body: (role) => <Records role={role} />,
  },
  { id: "pay", title: "Pay", areas: ["pay"], body: () => <Pay /> },
  { id: "admin", title: "Admin", areas: ["team", "data"], body: (role) => <Admin role={role} /> },
  {
    id: "connect-your-planner",
    title: "Connect your planner",
    areas: ["integrations"],
    body: () => <ConnectPlanner />,
  },
  { id: "what-workers-see", title: "What workers see", areas: [], body: () => <WorkersSee /> },
];

export function guideSections(role: OfficeRole): Section[] {
  return SECTIONS.filter((s) => s.areas.length === 0 || s.areas.some((a) => canAccess(role, a)));
}

export function GuideView({
  firmName,
  role,
  menu,
}: {
  firmName: string;
  role: OfficeRole;
  menu: MenuGroup[];
}) {
  const sections = guideSections(role);
  return (
    <main className={page.office}>
      <PageHeader eyebrow={`${firmName} office`} title="How-to guide">
        <p>The everyday jobs, step by step, in the order of a working day.</p>
        <p className={meta}>It shows only the parts of the office you can open.</p>
      </PageHeader>
      {/* Wide screens: the contents stay in view beside the guide, as a rail with a line on its
          left. Narrower: they come first, as one card of divided rows with an arrow, like /help's
          contents (never pills: on a phone, pills are the office menu). */}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_14rem] xl:items-start xl:gap-14">
        <nav
          aria-labelledby="guide-contents"
          className="mb-8 xl:sticky xl:top-8 xl:col-start-2 xl:row-start-1 xl:mb-0"
        >
          <h2 id="guide-contents" className="text-sm font-semibold text-ink-muted">
            On this page
          </h2>
          <ul
            role="list"
            className={`${rows} mt-2 xl:divide-y-0 xl:rounded-none xl:border-0 xl:border-l-2 xl:border-line xl:bg-transparent xl:shadow-none`}
          >
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 font-semibold text-ink hover:bg-quiet-soft xl:-ml-0.5 xl:min-h-11 xl:border-l-2 xl:border-transparent xl:py-0 xl:font-medium xl:text-ink-muted xl:hover:border-ink xl:hover:bg-transparent xl:hover:text-ink"
                >
                  {s.title}
                  <Icon name="chevron" className="text-ink-muted xl:hidden" />
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1">
          {sections.map((s) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`${s.id}-title`}
              className="scroll-mt-6 rounded-xl border border-line bg-card p-5 shadow-sm sm:p-6"
            >
              <h2 id={`${s.id}-title`} className={h2}>
                {s.title}
              </h2>
              {s.body(role, menu)}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

// --- Pieces -------------------------------------------------------------------------------------

function Para({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-prose">{children}</p>;
}

function Task({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3 className="mt-6 text-base font-bold text-ink">{title}</h3>
      {children}
    </>
  );
}

// The part of a button's words that changes: "Assign <their name>".
function Their({ children = "their name" }: { children?: string }) {
  return <span className="font-normal italic">{children}</span>;
}

// A note under steps: something to know before doing it.
function Note({ children }: { children: ReactNode }) {
  return <p className={`${meta} mt-3 max-w-prose border-l-2 border-line pl-3`}>{children}</p>;
}

// Where to do it: a link to the page, with the menu's icon for it.
function GoTo({ href, icon, children }: { href: string; icon: IconName; children: string }) {
  return (
    <Link href={href} className={btn.link}>
      <Icon name={icon} />
      {children}
    </Link>
  );
}

function Links({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap gap-x-6 border-t border-line pt-3">{children}</div>;
}

// --- Sections -----------------------------------------------------------------------------------

// What each menu link opens, by the link's words.
const MENU_WORDS: Record<string, string> = {
  Dashboard:
    "Urgent gaps, what casuals can see, the latest cancellations and enquiries, and what needs attention.",

  "Events & sessions":
    "Every event with a session to come. Choose what casuals see and what's urgent.",
  Cancellations:
    "Every cancellation, by casuals and by the office, with its record and a PDF. Nothing to approve.",
  Requests: "Time changes, swaps and reviews workers have asked for.",
  Strikes:
    "Who has strikes for cancelling late, and which need a review. Withdraw or keep one from its record.",
  Casuals: "Their qualifications, travel areas and strikes, and their access.",
  "Action log": "Everything that happened, newest first.",
  "Notice report": "Every offer, booking, move and cancellation, with the notice given.",
  "Pilot metrics": "The pilot's figures against your week-0 baseline.",
  "Pay dashboard": "Where payroll starts: what's waiting, the next digest and the next pay date.",
  "Pay queries": "Workers' pay queries, grouped by likely cause.",
  "Import pay records": "Load payroll's spreadsheet, so workers see their pay.",
  "Office team": "Who can log in to the office, and their roles.",
  Settings: "The strikes team's email, and your sites' postcodes.",
  Integrations: "Connect your planner: its API keys, and the codes it can send.",
  "Data requests": "Download or delete a worker's data when they ask.",
  "How-to guide": "This page.",
};

function GettingAround({ menu }: { menu: MenuGroup[] }) {
  return (
    <>
      <Para>
        On a computer, the menu is on the left. On a phone, select <Name>Menu</Name> at the top to
        open it. The page you&apos;re on is highlighted.
      </Para>
      <div className="mt-5 sm:columns-2 sm:gap-8">
        {menu.map((group) => (
          <div key={group.label ?? "start"} className="mb-6 break-inside-avoid">
            {group.label ? (
              <h3 className="mb-2 text-sm font-semibold text-ink-muted">{group.label}</h3>
            ) : null}
            <ul role="list" className="flex flex-col gap-3">
              {group.links.map((link) => (
                <li key={link.href} className="flex gap-3">
                  <Icon name={link.icon} className="mt-0.5 text-ink-muted" />
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{link.label}</p>
                    {MENU_WORDS[link.label] ? (
                      <p className={meta}>{MENU_WORDS[link.label]}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Para>
        Your name is at the top right. Select it for this guide and <Name>Log out</Name>. The moon
        or sun beside it switches between dark and light.
      </Para>
    </>
  );
}

const DASHBOARD_SECTIONS: [string, ReactNode][] = [
  [
    "The four counts",
    "Urgent shifts not filled, events showing to casuals, cancellations today and enquiries today. Select one to open its list.",
  ],
  [
    "Urgent shifts not filled",
    "Urgent sessions with a place free, on their event's card, with how many casuals were offered each one, or why offers stopped.",
  ],
  ["Showing to casuals", "Events casuals can see. Switch one off to hide all its sessions."],
  ["Cancellations", "The latest three. Recorded automatically, never approved or declined."],
  ["Enquiries", "The latest four messages to your shifts line, and the reply each one got."],
  [
    "Needs attention",
    "Bookings to check, changes from your rota sheet, who worked?, qualifications out of date on a booking, uploads to check and strike evidence. The bell at the top of every page counts them.",
  ],
];

const TONES: [StatusTone, string, string][] = [
  [
    "urgent",
    "Urgent",
    "Act now. Also used for a licence that has expired or is suspended, someone blocked, and someone who didn't attend.",
  ],
  [
    "attention",
    "Open",
    "Someone needs to act: a place is free, a request is waiting, or people aren't marked yet.",
  ],
  ["done", "Filled", "Fine, or finished: filled, booked, worked, approved or sorted."],
  ["quiet", "Cancelled", "For information, or closed: cancelled, declined, a draft or not active."],
];

function DashboardPart() {
  return (
    <>
      <Para>
        The <Name>Dashboard</Name> is the page you land on after logging in. It shows what needs
        doing today.
      </Para>
      <Steps>
        <Step>The four counts at the top each open their list.</Step>
        <Step>
          <Name>Needs attention</Name>, at the bottom, is what someone has to sort out. The bell at
          the top of every page shows how many, and takes you there.
        </Step>
        <Step>
          Select a shift&apos;s name to open its page, where you can change everything about it.
        </Step>
      </Steps>
      <Task title="What each section shows">
        <ul role="list" className="mt-2 max-w-prose divide-y divide-line">
          {DASHBOARD_SECTIONS.map(([name, words]) => (
            <li key={name} className="py-3">
              <p className="font-semibold text-ink">{name}</p>
              <p className={meta}>{words}</p>
            </li>
          ))}
        </ul>
      </Task>
      <Task title="What the colours mean">
        <Para>Every coloured label keeps its word, so colour is never the only clue.</Para>
        <ul role="list" className="mt-3 max-w-prose divide-y divide-line">
          {TONES.map(([tone, word, meaning]) => (
            <li key={tone} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
              <span className="shrink-0 sm:w-32">
                <StatusChip tone={tone}>{word}</StatusChip>
              </span>
              <span>{meaning}</span>
            </li>
          ))}
        </ul>
      </Task>
      <Links>
        <GoTo href="/office" icon="home">
          Go to the dashboard
        </GoTo>
      </Links>
    </>
  );
}

function FillAGap({ role }: { role: OfficeRole }) {
  return (
    <>
      <Para>
        A gap is a shift with a place free. Urgent ones are on the dashboard, under{" "}
        <Name>Urgent shifts not filled</Name>, with these buttons. Every session and its places free
        is on <Name>Events &amp; sessions</Name>, where its <Name>…</Name> menu has them too.
      </Para>
      <Task title="To offer it to someone">
        <Steps>
          <Step>
            Select <Name>Offer to someone</Name>.
          </Step>
          <Step>
            <Name>Who can take it</Name> lists only people the rules allow, who want offers and
            haven&apos;t been offered it.
          </Step>
          <Step>
            Select <Name>Send offer</Name> next to a name. The first person to say yes gets the
            place.
          </Step>
        </Steps>
        <Note>Unless the shift is urgent, nobody is offered more than 3 shifts a day.</Note>
      </Task>
      <Task title="To send offers out for you">
        <Steps>
          <Step>
            Select <Name>Mark urgent</Name>. Offers go out to the best people, a few at a time.
          </Step>
          <Step>
            To stop more offers going out, select <Name>Not urgent</Name>.
          </Step>
        </Steps>
      </Task>
      <Task title="If you filled it another way">
        <Steps>
          <Step>
            Select <Name>Mark as filled</Name>, then <Name>Yes, mark as filled</Name>. Nobody else
            will be offered it.
          </Step>
          <Step>
            Changed your mind? Select <Name>Open it again</Name> straight away. It&apos;s only there
            until you leave or reload the page.
          </Step>
        </Steps>
        <Note>A shift from your Google Sheet is changed in the sheet, not here.</Note>
      </Task>
      {canAccess(role, "shifts") ? (
        <Task title="To book someone yourself">
          <Steps>
            <Step>
              Open the shift&apos;s page and go to <Name>Assign someone</Name>.
            </Step>
            <Step>
              Choose the person in <Name>Who?</Name> and select <Name>Check</Name>.
            </Step>
            <Step>
              If the rules allow it, select{" "}
              <Name>
                Assign <Their />
              </Name>
              . They get a message to say they&apos;re booked.
            </Step>
            <Step>
              If the rules say no, you see why. For some reasons you can still go ahead: say why in{" "}
              <Name>Why is it all right?</Name> and select <Name>Assign anyway</Name>.
            </Step>
          </Steps>
          <Note>
            You can go ahead only for too little rest, the weekly hours, or a day they can&apos;t
            work. Anything else can&apos;t be overridden, like a missing or out-of-date licence.
            Once a shift has started, nobody can be assigned to it here. Every override goes in the
            action log.
          </Note>
        </Task>
      ) : null}
      <Links>
        <GoTo href="/office#urgent" icon="home">
          See the urgent gaps
        </GoTo>
      </Links>
    </>
  );
}

function AddShifts() {
  return (
    <>
      <Para>
        Add shifts from <Name>Events &amp; sessions</Name>. There are three ways.
      </Para>
      <Task title="One shift">
        <Steps>
          <Step>
            Select <Name>All shifts by day</Name>, then <Name>New shift</Name>.
          </Step>
          <Step>
            Fill in the date, site, role, start, finish and places. Add instructions if needed.
          </Step>
          <Step>
            Select <Name>Create shift</Name>.
          </Step>
        </Steps>
        <Note>A finish before the start is the next morning.</Note>
      </Task>
      <Task title="Several shifts for one event">
        <Steps>
          <Step>
            Select <Name>Add shifts</Name>.
          </Step>
          <Step>Give the event a name, and choose the date and site once.</Step>
          <Step>
            Fill in one line per role: the role, start, finish and places, and the pay rate, post
            and extra requirements if you have them. <Name>Add another line</Name> gives you up to
            12. Empty lines are left out.
          </Step>
          <Step>Add the meeting point and uniform for everyone, if you have them.</Step>
          <Step>
            Select <Name>Create these shifts</Name>.
          </Step>
        </Steps>
      </Task>
      <Task title="From a spreadsheet">
        <Steps>
          <Step>
            Select <Name>Import shifts</Name>.
          </Step>
          <Step>
            Choose a .csv or .xlsx file with Date, Start, End and Role columns. Site, Needed,
            Instructions and Shift ID are optional.
          </Step>
          <Step>
            Select <Name>Check the file</Name>. Nothing is saved yet: you see what it would add,
            change or skip.
          </Step>
          <Step>
            Select <Name>Import these shifts</Name>.
          </Step>
        </Steps>
        <Note>
          Importing the same file again updates those shifts instead of adding them twice.
        </Note>
      </Task>
      <Links>
        <GoTo href="/office/events" icon="shifts">
          Go to Events &amp; sessions
        </GoTo>
      </Links>
    </>
  );
}

function ChangeAShift() {
  return (
    <>
      <Para>
        Open the shift from the dashboard, or from its event on <Name>Events &amp; sessions</Name>{" "}
        (its <Name>…</Name> menu, then <Name>Change or cancel</Name>). Everything about it is on its
        page.
      </Para>
      <Task title="To hide shifts from casuals">
        <Steps>
          <Step>
            On <Name>Events &amp; sessions</Name>, switch the event off to hide all its sessions.
          </Step>
          <Step>
            To hide one session, select <Name>View sessions</Name> and switch that session off.
          </Step>
        </Steps>
        <Note>
          People already booked keep their shifts. Casuals can&apos;t see, take or be offered a
          hidden shift; you can still assign someone.
        </Note>
      </Task>
      <Task title="To change its details">
        <Steps>
          <Step>
            Under <Name>Edit this shift</Name>, change what you need.
          </Step>
          <Step>
            Select <Name>Save changes</Name>.
          </Step>
        </Steps>
        <Note>Once people are booked, only the places and instructions can change here.</Note>
      </Task>
      <Task title="To move or shorten it">
        <Para>
          This is for a shift with people booked. With nobody booked, change the date, times or site
          under <Name>Edit this shift</Name> instead.
        </Para>
        <Steps>
          <Step>
            Under <Name>Move, shorten or cancel</Name>, enter the new date, times or site.
          </Step>
          <Step>
            In <Name>Why?</Name>, choose a reason.
          </Step>
          <Step>
            Select <Name>Move for everyone booked</Name>.
          </Step>
        </Steps>
        <Note>
          Everyone booked is told, and the notice they had is logged for each of them. If it says
          someone can&apos;t work the new time, cancel their booking first, then move it.
        </Note>
      </Task>
      <Task title="To cancel the whole shift">
        <Steps>
          <Step>
            Select <Name>Cancel this shift</Name> and choose why.
          </Step>
          <Step>
            Select <Name>Yes, cancel this shift</Name>. Everyone booked is told, and their notice is
            logged.
          </Step>
        </Steps>
      </Task>
      <Task title="To cancel one person's booking">
        <Steps>
          <Step>
            Under <Name>Places</Name>, select{" "}
            <Name>
              Cancel <Their />
              &apos;s booking
            </Name>{" "}
            and choose why.
          </Step>
          <Step>
            Select{" "}
            <Name>
              Yes, cancel <Their />
              &apos;s booking
            </Name>
            . They&apos;re told, and their notice is logged.
          </Step>
        </Steps>
        <Note>If you choose “The client needs fewer staff”, the place goes too.</Note>
      </Task>
      <Links>
        <GoTo href="/office/events" icon="shifts">
          Go to Events &amp; sessions
        </GoTo>
      </Links>
    </>
  );
}

function AfterAShift() {
  return (
    <>
      <Para>
        Mark who worked each shift. <Name>Who worked?</Name>, in the dashboard&apos;s{" "}
        <Name>Needs attention</Name>, lists shifts from the last 7 days with people not marked yet.
      </Para>
      <Steps>
        <Step>Open the shift&apos;s page.</Step>
        <Step>
          Once it has started, go to <Name>Places</Name>. Select <Name>Mark as worked</Name> or{" "}
          <Name>Mark as not attended</Name> for each person.
        </Step>
        <Step>
          After the shift ends, if everyone left worked it, select{" "}
          <Name>
            Mark the <Their>2 people</Their> not marked yet as worked
          </Name>
          , then <Name>Yes, mark them as worked</Name>.
        </Step>
      </Steps>
      <Note>
        You can change anyone afterwards: the button changes to “Change to worked” or “Change to not
        attended”.
      </Note>
      <Links>
        <GoTo href="/office#needs-attention" icon="home">
          See who to mark
        </GoTo>
      </Links>
    </>
  );
}

function Enquiries() {
  return (
    <>
      <Para>
        Everything casuals send the shifts line, and what came of it, is on <Name>Enquiries</Name>.
        Most are answered at once. The ones the shifts line can&apos;t answer wait under{" "}
        <Name>Need a person</Name>, oldest first: the menu shows how many.
      </Para>
      <Task title="To answer a message">
        <Steps>
          <Step>
            Select <Name>Need a person</Name>, then the person&apos;s name (or{" "}
            <Name>Unknown number</Name>).
          </Step>
          <Step>
            Read the conversation and <Name>How it was answered</Name>.
          </Step>
          <Step>
            Write your answer in <Name>Reply</Name> and select <Name>Send reply</Name>. The line
            above the box says how it will go: as you wrote it, or, more than 24 hours after their
            last WhatsApp, inside the request update message.
          </Step>
          <Step>
            Or, if it needs no reply (you rang them, or it&apos;s spam), choose a reason in{" "}
            <Name>Why close it?</Name> and select <Name>Close without a reply</Name>.
          </Step>
        </Steps>
      </Task>
      <Task title="To answer a request from the app">
        <Steps>
          <Step>
            Select <Name>Requests from the app</Name>: time changes, swaps, and asks to review a
            shift the rules refused.
          </Step>
          <Step>
            To say yes, select{" "}
            <Name>
              Approve and tell <Their />
            </Name>
            .
          </Step>
          <Step>
            To say no, write why in{" "}
            <Name>
              Note to <Their /> (needed to decline)
            </Name>
            . Then select{" "}
            <Name>
              Decline and tell <Their />
            </Name>
            .
          </Step>
        </Steps>
      </Task>
      <Note>
        Approving doesn&apos;t change the shift, or book them on it: do that on the shift&apos;s
        page. A voicemail may not be from the worker, so check anything unusual with them. Pay
        messages always go to a person: the shifts line only sends the pay page&apos;s link.
      </Note>
      <Links>
        <GoTo href="/office/enquiries" icon="requests">
          Go to Enquiries
        </GoTo>
      </Links>
    </>
  );
}

function Workers() {
  return (
    <>
      <Para>
        Find a casual to see their qualifications and what needs updating, or to change their
        access: when they leave, come back or lose their phone.
      </Para>
      <Task title="To find someone">
        <Steps>
          <Step>
            Type part of their name, or their whole mobile number, in{" "}
            <Name>Name or mobile number</Name>.
          </Step>
          <Step>
            Select <Name>Find</Name>, then their name.
          </Step>
        </Steps>
      </Task>
      <Task title="When someone leaves">
        <Steps>
          <Step>
            Under <Name>Access</Name>, choose a reason in <Name>Why?</Name> and select{" "}
            <Name>Make inactive</Name>.
          </Step>
          <Step>
            Select{" "}
            <Name>
              Yes, make <Their /> inactive
            </Name>
            . They&apos;re logged out, and can&apos;t take shifts or get reminders.
          </Step>
        </Steps>
        <Note>
          Their bookings ahead go on the dashboard, under “Bookings to check”. Your rota sheet or a
          staff file can&apos;t make them active again: only you can. When they&apos;re back, select
          “Make active again”. If your rota sheet or a staff file still says they&apos;re inactive,
          change it there too. Otherwise the next sync or import makes them inactive again.
        </Note>
      </Task>
      <Task title="To keep someone off a site">
        <Steps>
          <Step>
            Under <Name>Block from a site</Name>, choose the <Name>Site</Name>. In <Name>Why?</Name>
            , choose a reason.
          </Step>
          <Step>
            Select <Name>Block from this site</Name>.
          </Step>
        </Steps>
      </Task>
      <Task title="If they lose their phone">
        <Steps>
          <Step>
            Select <Name>Log out on every device</Name>. They log in again with a new link.
          </Step>
        </Steps>
      </Task>
      <Links>
        <GoTo href="/office/casuals" icon="workers">
          Go to Casuals
        </GoTo>
      </Links>
    </>
  );
}

function Records({ role }: { role: OfficeRole }) {
  return (
    <>
      <Para>Every offer, booking, change and cancellation is recorded. Use these as evidence.</Para>
      {canAccess(role, "log") ? (
        <Task title="Action log">
          <Para>
            Everything that happened, newest first. Narrow it with <Name>Worker</Name>,{" "}
            <Name>Shift</Name>, <Name>Type</Name>, <Name>From</Name> and <Name>To</Name>, then
            select <Name>Show</Name>. <Name>Clear</Name> starts again.
          </Para>
          <Note>
            For everything about one shift, open it and select “See this shift in the action log”.
          </Note>
          <div className="mt-2">
            <GoTo href="/office/log" icon="log">
              Go to the Action log
            </GoTo>
          </div>
        </Task>
      ) : null}
      {canAccess(role, "reports") ? (
        <Task title="Notice report">
          <Para>
            How much notice each offer, booking, move and cancellation gave. Choose the dates and
            what to show, or tick <Name>Short notice only</Name>. Then select <Name>Show</Name>.
          </Para>
          <Note>
            <Name>Download as a spreadsheet (CSV)</Name> gives the same rows, to keep or share.
          </Note>
          <div className="mt-2">
            <GoTo href="/office/reports/notice" icon="notice">
              Go to the Notice report
            </GoTo>
          </div>
        </Task>
      ) : null}
      {canAccess(role, "pilot") ? (
        <Task title="Pilot metrics">
          <Para>
            How the pilot is going against your week-0 baseline. Fill in{" "}
            <Name>Baseline (week 0)</Name> once, from a normal week before go-live. Then fill in{" "}
            <Name>This week&apos;s tally</Name> each week.
          </Para>
          <Note>
            The figures are worked out each night at 00:30. <Name>Update the figures now</Name> does
            it straight away.
          </Note>
          <div className="mt-2">
            <GoTo href="/office/reports/pilot" icon="pilot">
              Go to Pilot metrics
            </GoTo>
          </div>
        </Task>
      ) : null}
    </>
  );
}

function Pay() {
  return (
    <>
      <Para>
        Workers raise pay queries from their pay page. You see them grouped by likely cause, biggest
        group first.
      </Para>
      <Task title="To sort a group of queries">
        <Steps>
          <Step>
            Open <Name>Pay queries</Name> and fix the problem in your payroll.
          </Step>
          <Step>
            Under the group, write what payroll did in <Name>Tell them what payroll did</Name>.
          </Step>
          <Step>
            Select <Name>Mark as sorted and tell them</Name>.
          </Step>
        </Steps>
        <Note>
          Everyone in the group gets the same note, by message and on their pay page. So don&apos;t
          name anyone, give one person&apos;s figures or include bank details.
        </Note>
      </Task>
      <Task title="The payroll digest">
        <Para>
          New queries go to payroll by email on a schedule, grouped, with the list attached.{" "}
          <Name>Payroll digest</Name> shows when. To send one now, select{" "}
          <Name>Send the digest now</Name>.
        </Para>
      </Task>
      <Task title="To import pay records">
        <Steps>
          <Step>
            Select <Name>Import pay records</Name>.
          </Step>
          <Step>
            Choose payroll&apos;s .csv or .xlsx file: one line per person, pay period and rate.
          </Step>
          <Step>
            Select <Name>Check the file</Name>. Nothing is saved yet.
          </Step>
          <Step>
            Select <Name>Import these pay records</Name>.
          </Step>
        </Steps>
        <Note>Each worker sees their own lines on their pay page, behind their pay code.</Note>
      </Task>
      <Links>
        <GoTo href="/office/pay-queries" icon="pay">
          Go to Pay queries
        </GoTo>
        <GoTo href="/office/pay/import" icon="import">
          Go to Import pay records
        </GoTo>
      </Links>
    </>
  );
}

function Admin({ role }: { role: OfficeRole }) {
  return (
    <>
      {canAccess(role, "team") ? (
        <Task title="Office team">
          <Para>Everyone who can log in to the office. Each person has one role:</Para>
          <Points>
            <li>
              <Name>Admin</Name>: everything, including the office team and data requests.
            </li>
            <li>
              <Name>Resourcer</Name>: the dashboard, shifts, enquiries, casuals and records.
            </li>
            <li>
              <Name>Payroll</Name>: pay queries and pay records.
            </li>
          </Points>
          <Steps>
            <Step>
              To change someone&apos;s role, choose it in <Name>Role</Name> and select{" "}
              <Name>Change role</Name>. Making someone an admin asks you to confirm: select{" "}
              <Name>Yes, make them an admin</Name>.
            </Step>
            <Step>
              Someone leaving: select <Name>Turn off access</Name>, then{" "}
              <Name>Yes, turn off access</Name>.
            </Step>
            <Step>
              A lost laptop or phone: select <Name>Log out on every device</Name>. If their email is
              open on it, also turn off their access until it&apos;s secure.
            </Step>
          </Steps>
          <Note>You can&apos;t change your own access. Ask another admin.</Note>
          <div className="mt-2">
            <GoTo href="/office/team" icon="team">
              Go to Office team
            </GoTo>
          </div>
        </Task>
      ) : null}
      {canAccess(role, "data") ? (
        <Task title="Data requests">
          <Para>For when a worker asks for their data, or asks to be deleted.</Para>
          <Steps>
            <Step>
              Type their name or mobile in <Name>Name or mobile number</Name>, select{" "}
              <Name>Find</Name>, then open their page.
            </Step>
            <Step>
              To send their data, select <Name>Download (JSON)</Name> or{" "}
              <Name>Download (CSV, opens in Excel)</Name>. Send it within a month of their request.
            </Step>
            <Step>
              To delete them, tick <Name>I understand this can’t be undone</Name> and select{" "}
              <Name>
                Delete <Their />
                ’s personal details
              </Name>
              .
            </Step>
          </Steps>
          <Note>
            If they&apos;re booked on a shift that hasn&apos;t ended, you can&apos;t delete them
            yet. Cancel those bookings first (with a reason), then come back to delete.
          </Note>
          <Note>
            Deleting can&apos;t be undone. Their shift history stays, without a name. Remove them
            from your rota sheet or staff file too, or the next sync or import adds them back.
          </Note>
          <div className="mt-2">
            <GoTo href="/office/data" icon="data">
              Go to Data requests
            </GoTo>
          </div>
        </Task>
      ) : null}
    </>
  );
}

// Integrations (12J.1; docs/office-v2.md 5.3.4): the page's "How to connect your planner" lands
// here. The technical side, for whoever sets the planner up, is docs/integrations.md.
function ConnectPlanner() {
  return (
    <>
      <Para>
        Your planner can send its sessions to ShiftDesk, and read their bookings and cancellations.
        It needs an API key: a long password for a machine.
      </Para>
      <Steps>
        <Step>
          On Integrations, under <Name>API keys</Name>, type a <Name>Name</Name> you&apos;ll
          recognise, like your planner&apos;s name. Select <Name>Create a key</Name>.
        </Step>
        <Step>
          Select <Name>Copy the key</Name> and paste it into your planner straight away. You
          won&apos;t see it again.
        </Step>
        <Step>
          Your planner names roles and qualifications with your own codes. Find them under{" "}
          <Name>Codes your planner can use</Name>.
        </Step>
        <Step>
          Once your planner sends a session, <Name>Your planner</Name> says{" "}
          <Name>Connected by API</Name>, with the time of its last change.
        </Step>
      </Steps>
      <Note>
        Change your planner&apos;s sessions in your planner. Here you can still show or hide them,
        mark them urgent, offer them and assign people to them.
      </Note>
      <Note>
        A key you no longer use, or one someone else may have seen: select <Name>Revoke</Name>, then{" "}
        <Name>Yes, revoke it</Name>. It stops working at once.
      </Note>
      <div className="mt-2">
        <GoTo href="/office/settings/integrations" icon="plug">
          Go to Integrations
        </GoTo>
      </div>
    </>
  );
}

function WorkersSee() {
  return (
    <>
      <Points>
        <li>There&apos;s no app. Workers get a link by WhatsApp or text that logs them in.</li>
        <li>A login link works for 15 minutes. They can ask for a new one on the log in page.</li>
        <li>
          They see their shifts, take open shifts, cancel with a reason, and ask for a time change
          or swap.
        </li>
        <li>Their pay is behind a 6‑digit code sent to their phone.</li>
      </Points>
      <Para>Their help page explains all this in plain words. It opens without logging in.</Para>
      <Links>
        <GoTo href="/help" icon="guide">
          Open the workers&apos; help page
        </GoTo>
      </Links>
    </>
  );
}
