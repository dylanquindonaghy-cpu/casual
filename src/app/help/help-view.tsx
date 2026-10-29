import Link from "next/link";
import type { ReactNode } from "react";
import { h2, staffBtn, staffRows } from "../ui/classes";
import { PageHeader } from "../ui/page-header";
import { possessive } from "@/lib/portal/copy";
import type { HelpFacts } from "@/lib/portal/help-facts";
import { postcodeAttribution } from "@/lib/travel/attribution";
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
  { id: "cancelling-and-strikes", title: "Cancelling and strikes" },
  { id: "changes", title: "Changing times or swapping" },
  { id: "your-pay", title: "Your pay" },
  { id: "your-profile", title: "Your profile" },
  { id: "travel-area", title: "Your travel area" },
  { id: "qualifications-and-photos", title: "Qualifications and photos" },
  { id: "no-signal", title: "No signal" },
  { id: "lost-phone", title: "Lost your phone" },
  { id: "your-details", title: "Your details" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function HelpView({
  firmName,
  facts,
  year,
}: {
  firmName: string;
  // The firm's own strike and photo numbers, and whether it has travel areas on
  // (src/lib/portal/help-facts.ts).
  facts: HelpFacts;
  year: number; // for the postcode data's attribution
}) {
  return (
    <>
      <PageHeader title="Help">
        <p>How your shifts pages work, step by step.</p>
      </PageHeader>

      <nav aria-labelledby="help-contents">
        <h2 id="help-contents" className="text-base font-semibold text-ink-muted">
          On this page
        </h2>
        <ul role="list" className={`${staffRows} mt-2`}>
          {SECTIONS.filter((s) => s.id !== "travel-area" || facts.travelOn).map((s) => (
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
          <Name>Home</Name> is the first page you see. The tabs at the bottom take you to{" "}
          <Name>Home</Name>, <Name>Shifts</Name>, <Name>Pay</Name> and <Name>Profile</Name>.
        </p>
        <Points>
          <li>
            Home shows your next shift as a pass: the day and times, the site and your gate. Tap it
            to see the rest: getting there, your pay and any instructions.
          </li>
          <li>
            Tap <Name>Open in maps</Name> for directions to the site.
          </li>
          <li>
            Tap <Name>Shifts</Name>, then <Name>Booked</Name>, to see all your shifts. Tap one to
            see its details.
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
            Tap <Name>Shifts</Name>, then <Name>Open</Name>.
          </Step>
          <Step>
            To see one day, tap it at the top. To narrow the list, tap <Name>Site and role</Name>,
            choose, then tap <Name>Show shifts</Name>.
          </Step>
          <Step>
            Tap the shift you want. Read it, then tap <Name>Take shift</Name>.
          </Step>
          <Step>
            You&apos;ll see “You&apos;re booked.” and a reference. The shift is now in your booked
            shifts.
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
          When a shift you could take starts soon and needs someone, Home shows it in red under{" "}
          <Name>Shifts you can take</Name>.
        </p>
        <Steps>
          <Step>Tap it to see the urgent shifts.</Step>
          <Step>
            Tap the one you want, then <Name>Take shift</Name>.
          </Step>
        </Steps>
        <p className="mt-4">You may get a message about it too.</p>
      </Section>

      <Section id="cant-make-it">
        <Steps>
          <Step>
            On Home or under <Name>Shifts</Name>, find the shift and tap{" "}
            <Name>Can&apos;t make it?</Name>
          </Step>
          <Step>Choose why you can&apos;t make it.</Step>
          <Step>
            Tap <Name>Cancel this shift</Name>.
          </Step>
        </Steps>
        <p className="mt-4">
          You&apos;ll see how much notice you gave and a reference. Keep the reference, or take a
          screenshot.
        </p>
        <p className="mt-3">
          Changed your mind? Tap <Name>Keep my shift</Name> instead.
        </p>
        <p className="mt-3">
          A shift that has started can&apos;t be cancelled here. Contact the office.
        </p>
      </Section>

      <Section id="cancelling-and-strikes">
        <p className="mt-3">
          If you cancel less than {facts.noticeHours} hours before a shift starts, you get a strike.
        </p>
        <Points>
          <li>A strike is a record, not a fine. It never comes off your pay.</li>
          <li>
            {firmName}&apos;s strikes team gets a record of it. It counts for {facts.liveDays} days.
          </li>
          <li>
            You won&apos;t get one if the office booked you, cancelled the shift or changed it.
          </li>
          <li>You&apos;ll see if it&apos;s a strike before you confirm.</li>
          <li>
            Something stopped you? Tap <Name>Tell us what happened</Name>. It&apos;s on the cancel
            screen and under the strike on your profile.
          </li>
          <li>
            The office can withdraw a strike. Your profile then says{" "}
            <Name>Withdrawn by the office</Name>.
          </li>
        </Points>
      </Section>

      <Section id="changes">
        <Steps>
          <Step>
            Find the shift on Home or under <Name>Shifts</Name>. Tap <Name>Ask for a change</Name>.
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
            Tap the <Name>Pay</Name> tab.
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
          You&apos;ll see the last 8 weeks from {possessive(firmName)} payroll: hours, rates and pay
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
          Tap the <Name>Profile</Name> tab. <Name>My requests</Name> and <Name>Log out</Name> are
          there too.
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
          <li>Your details are there too. To change your name or number, ask the office.</li>
        </Points>
      </Section>

      {facts.travelOn && (
        <Section id="travel-area">
          <p className="mt-3">
            Tell us where you start from and how far you&apos;ll travel. Then you only see shifts
            you can get to in time.
          </p>
          <Steps>
            <Step>
              Tap the <Name>Profile</Name> tab, then <Name>Set your travel area</Name> under{" "}
              <Name>Where you work</Name>.
            </Step>
            <Step>Enter the postcode you start from. It can be different from your home.</Step>
            <Step>
              Choose car, public transport or both, and how many minutes you&apos;ll travel. Then
              tap <Name>Save travel area</Name>.
            </Step>
          </Steps>
          <Points>
            <li>Each shift shows how far it is, and the time by car and by public transport.</li>
            <li>A link to a shift still opens, however far it is.</li>
            <li>
              The office only sees the first part of your postcode, like ZZ1. Your full postcode
              stays with you.
            </li>
          </Points>
        </Section>
      )}

      <Section id="qualifications-and-photos">
        <p className="mt-3">
          Your profile lists each licence or card your roles need, with its status and date.
        </p>
        <Points>
          <li>
            New card? Tap <Name>Upload a certificate</Name> under it and take a clear photo of it.
          </li>
          <li>Some, like CSAS, the office records itself. Send those to the office, not here.</li>
          <li>
            Your staff photo needs renewing every {facts.photoRenewalMonths} months. Tap{" "}
            <Name>Upload a new photo</Name> and face the camera.
          </li>
          <li>
            The office checks everything you send. Until it does, the new one doesn&apos;t count.
          </li>
          <li>Only checked ones count when you take a shift.</li>
        </Points>
      </Section>

      <Section id="no-signal">
        <p className="mt-3">
          Open Home and your booked shifts once with signal. After that, they open on that phone
          with no signal too.
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

      {/* The postcode data's licence requires this line (src/lib/travel/attribution.ts). */}
      <p data-attribution="" className="mt-10 text-sm text-ink-muted">
        {postcodeAttribution(year)}
      </p>
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
