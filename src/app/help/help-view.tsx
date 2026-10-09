import Link from "next/link";
import type { ReactNode } from "react";
import { h2, rows, staffBtn } from "../ui/classes";
import { PageHeader } from "../ui/page-header";
import { Name, Points, Step, Steps } from "./guide-parts";

// The workers' help page (docs/screens.md `/help`): how the shifts pages work, in plain words, in
// the order a worker meets them. Every button named here is the one on screen. It opens with the
// shared page header (the firm's name, "Help", one intro line), like every staff page. Pure and
// hook-free (src/app/help/page.tsx finds the firm), so tests/unit/copy.plain-language.test.ts
// renders it.
//
// Two things the screens.md row lists are held back on purpose:
// - the shifts line number: PLAN.md's Parking lot keeps it from workers until incoming messages
//   are answered;
// - a privacy notice link: each firm writes its own notice and the app stores no link to it, so
//   the page says to ask the office for a copy.
// There's no general "Ask the office" form either: a worker asks about a shift with "Ask for a
// change" (or "Ask the office to review" on a shift they can't take), so the page says that.
// "6‑digit" has a non-breaking hyphen, so it never splits across two lines on a phone.

const SECTIONS = [
  { id: "how-it-works", title: "How it works" },
  { id: "your-shifts", title: "Your shifts" },
  { id: "taking-a-shift", title: "Taking a shift" },
  { id: "urgent-shifts", title: "Urgent shifts" },
  { id: "cant-make-it", title: "If you can't make a shift" },
  { id: "changes", title: "Changing times or swapping" },
  { id: "your-pay", title: "Your pay" },
  { id: "your-profile", title: "Your profile" },
  { id: "no-signal", title: "No signal" },
  { id: "lost-phone", title: "Lost your phone" },
  { id: "your-details", title: "Your details" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function HelpView({ firmName }: { firmName: string }) {
  return (
    <>
      <PageHeader eyebrow={firmName} title="Help">
        <p>How your shifts pages work, step by step.</p>
      </PageHeader>

      <nav aria-labelledby="help-contents">
        <h2 id="help-contents" className="text-base font-semibold text-ink-muted">
          On this page
        </h2>
        <ul role="list" className={`${rows} mt-2`}>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-base font-semibold text-ink hover:bg-quiet-soft"
              >
                {s.title}
                <Chevron />
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="how-it-works">
        <p className="mt-3">
          There&apos;s no app to download. {firmName} sends you a link by WhatsApp or text message.
        </p>
        <Steps>
          <Step>Tap the link in the message.</Step>
          <Step>
            Tap <Name>Log me in</Name>. Your shifts open.
          </Step>
          <Step>The link works for 15 minutes. After that, ask for a new one.</Step>
        </Steps>
        <p className="mt-4">
          To get a new link, go to the{" "}
          <Link href="/login" className="font-semibold underline underline-offset-4">
            log in page
          </Link>
          . Enter your mobile number and tap <Name>Send me a link</Name>.
        </p>
        <p className="mt-3">
          Put your shifts on your home screen, so they open in one tap. On an iPhone, open the Share
          menu and tap <Name>Add to Home Screen</Name>. On other phones, look for it in the
          browser&apos;s menu.
        </p>
      </Section>

      <Section id="your-shifts">
        <p className="mt-3">
          <Name>My shifts</Name> is the first page you see.
        </p>
        <Points>
          <li>Your next shift is at the top: the day and times, the site, and any instructions.</li>
          <li>
            Tap <Name>Open in maps</Name> for directions to the site.
          </li>
          <li>
            <Name>Coming up</Name> lists your other shifts. Tap one to see its details.
          </li>
          <li>
            Tap <Name>Past 30 days</Name> to see shifts you&apos;ve worked. Tap{" "}
            <Name>Upcoming</Name> to go back.
          </li>
        </Points>
      </Section>

      <Section id="taking-a-shift">
        <Steps>
          <Step>
            On My shifts, tap <Name>See open shifts</Name>.
          </Step>
          <Step>
            To narrow the list, choose a day, site or role. Then tap <Name>Show shifts</Name>.
          </Step>
          <Step>
            Tap <Name>Take shift</Name> on the one you want.
          </Step>
          <Step>
            You&apos;ll see “You&apos;re booked.” and a reference. The shift is now on My shifts.
          </Step>
        </Steps>
        <p className="mt-4">You only see shifts you can take. A shift won&apos;t show if:</p>
        <Points>
          <li>a licence or card it needs is missing or out of date</li>
          <li>you&apos;re already booked at that time</li>
          <li>you need more rest between shifts</li>
          <li>it would take you over your weekly hours</li>
          <li>you&apos;ve marked that day as one you can&apos;t work</li>
        </Points>
        <p className="mt-4">
          Some shifts go first to people with fewer hours that week. You&apos;ll see when you can
          take it. Tap <Name>Check again</Name> then.
        </p>
        <p className="mt-3">
          If it says you can&apos;t take a shift, it tells you why. Think that&apos;s wrong? Tap{" "}
          <Name>Ask the office to review</Name>.
        </p>
      </Section>

      <Section id="urgent-shifts">
        <p className="mt-3">
          When a shift you could take starts soon and needs someone, My shifts shows a red box at
          the top.
        </p>
        <Steps>
          <Step>
            Tap <Name>See urgent shifts</Name>.
          </Step>
          <Step>
            Tap <Name>Take shift</Name>.
          </Step>
        </Steps>
        <p className="mt-4">You may get a message about it too.</p>
      </Section>

      <Section id="cant-make-it">
        <Steps>
          <Step>
            On My shifts, find the shift and tap <Name>Cancel this shift</Name>.
          </Step>
          <Step>Choose why you can&apos;t make it.</Step>
          <Step>
            Tap <Name>Confirm cancellation</Name>.
          </Step>
        </Steps>
        <p className="mt-4">
          You&apos;ll see how much notice you gave and a reference. Keep the reference, or take a
          screenshot.
        </p>
        <p className="mt-3">
          Changed your mind? Tap <Name>Keep this shift</Name> instead.
        </p>
        <p className="mt-3">
          A shift that has started can&apos;t be cancelled here. Contact the office.
        </p>
      </Section>

      <Section id="changes">
        <Steps>
          <Step>
            On My shifts, tap <Name>Ask for a change</Name> under the shift.
          </Step>
          <Step>
            Choose <Name>Change the times</Name> or <Name>Swap with someone</Name>.
          </Step>
          <Step>
            Add anything the office should know. Then tap <Name>Send request</Name>.
          </Step>
        </Steps>
        <p className="mt-4">
          Your shift doesn&apos;t change until the office changes it. You&apos;ll see their answer
          in <Name>My requests</Name>.
        </p>
        <p className="mt-3">For anything else, contact the office the way you usually do.</p>
      </Section>

      <Section id="your-pay">
        <Steps>
          <Step>
            On My shifts, tap <Name>See your pay</Name>.
          </Step>
          <Step>
            Tap <Name>Send me a code</Name>. We send a 6‑digit code by WhatsApp. It works for 10
            minutes.
          </Step>
          <Step>
            Enter it in <Name>Your code</Name> and tap <Name>Check code</Name>.
          </Step>
        </Steps>
        <p className="mt-4">
          You&apos;ll see the last 8 weeks from {firmName}&apos;s payroll: hours, rates and pay
          dates. Your pay stays open for 30 minutes.
        </p>
        <p className="mt-3">
          Something wrong? Tap <Name>Raise a pay query</Name>. Choose the shift and what&apos;s
          wrong, then tap <Name>Send pay query</Name>. Payroll will look at it.
        </p>
        <p className="mt-3 rounded-xl border-2 border-attention bg-attention-soft p-4 font-semibold text-attention-ink">
          Never put bank details in a pay query.
        </p>
        <p className="mt-3">
          Pay queries can go back 90 days. For anything older, contact the office.
        </p>
      </Section>

      <Section id="your-profile">
        <p className="mt-3">
          Tap <Name>My profile</Name> on My shifts.
        </p>
        <Points>
          <li>
            <Name>Days you can&apos;t work</Name>: choose a day and tap{" "}
            <Name>Mark as unavailable</Name>. You won&apos;t be offered shifts that day. It
            doesn&apos;t cancel a shift you&apos;re booked on.
          </li>
          <li>
            <Name>How we reach you</Name>: choose WhatsApp or text message, and whether to hear
            about open shifts. Then tap <Name>Save settings</Name>.
          </li>
          <li>Your details, licences and cards are there too. To change them, ask the office.</li>
        </Points>
      </Section>

      <Section id="no-signal">
        <p className="mt-3">
          Open My shifts once with signal. After that, it opens on that phone with no signal too.
        </p>
        <p className="mt-3">
          You&apos;ll see “No signal.” and when your shifts were saved. They may have changed since.
        </p>
        <p className="mt-3">Taking or cancelling a shift needs signal.</p>
      </Section>

      <Section id="lost-phone">
        <p className="mt-3">Tell the office straight away. They can log you out on every device.</p>
        <p className="mt-3">
          Then log in on your new phone with a new link. If your number has changed, give the office
          your new one first.
        </p>
      </Section>

      <Section id="your-details">
        <p className="mt-3">
          Your firm&apos;s privacy notice explains how your details are used. Ask the office for a
          copy.
        </p>
      </Section>

      <Link href="/" className={`${staffBtn.secondary} mt-10`}>
        Back to my shifts
      </Link>
    </>
  );
}

// A topic: its heading (the contents list links to it) and what to do, with a line above it.
function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)?.title;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="mt-8 scroll-mt-4 border-t border-line pt-8"
    >
      <h2 id={`${id}-title`} className={h2}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-ink-muted"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
