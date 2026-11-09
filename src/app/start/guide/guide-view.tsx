import Link from "next/link";
import type { ReactNode } from "react";
import { CASUAL_PAGES, GUIDE_COPY, OFFICE_PAGE_LINES } from "@/lib/demo/start-copy";
import { card, h2, meta, rows, textLink } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import type { MenuGroup } from "../../office/office-nav";

// The quick guide (Phase 31.3): five sections in reading order, the office's look, a reading
// column. The office's pages come from the person's own menu (only pages their role can open), the
// casual app's from its tabs and pages. Pure and hook-free: the page passes the menu and the way
// back. Its words are in src/lib/demo/start-copy.ts.

const S = GUIDE_COPY.sections;

export function officePages(menu: MenuGroup[]) {
  return menu.flatMap((group) =>
    group.links.flatMap((link) => {
      const line = OFFICE_PAGE_LINES[link.href];
      return line ? [{ href: link.href, label: link.label, line }] : [];
    }),
  );
}

export function GuideView({
  menu,
  back,
}: {
  menu: MenuGroup[];
  back: { href: string; label: string };
}) {
  const office = officePages(menu);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader back={back} title={GUIDE_COPY.title}>
        <p className="text-ink-muted">{GUIDE_COPY.intro}</p>
      </PageHeader>

      <Section id={S.what.id} heading={S.what.heading}>
        <Paragraphs items={S.what.paragraphs} />
      </Section>

      <Section id={S.notCrm.id} heading={S.notCrm.heading}>
        <Paragraphs items={S.notCrm.paragraphs} />
      </Section>

      <Section id={S.api.id} heading={S.api.heading}>
        <Paragraphs items={S.api.paragraphs} />
        <Diagram />
      </Section>

      <Section id={S.where.id} heading={S.where.heading}>
        <h3 className="mt-2 font-semibold text-ink">{S.where.officeHeading}</h3>
        <PageList pages={office} />
        <h3 className="mt-6 font-semibold text-ink">{S.where.casualHeading}</h3>
        <p className={`${meta} mt-1`}>{S.where.casualNote}</p>
        <PageList pages={CASUAL_PAGES} />
      </Section>

      <Section id={S.rules.id} heading={S.rules.heading}>
        <ul className="flex list-disc flex-col gap-2 pl-6 text-ink">
          {S.rules.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </Section>

      <p className="mt-8 text-ink-muted">
        {GUIDE_COPY.howTo.before}
        <Link href="/office/guide" className={textLink}>
          {GUIDE_COPY.howTo.link}
        </Link>
        .
      </p>
    </main>
  );
}

function Section({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className={`${card} mt-6`}>
      <h2 id={`${id}-heading`} className={h2}>
        {heading}
      </h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Paragraphs({ items }: { items: readonly string[] }) {
  return items.map((text) => (
    <p key={text} className="max-w-prose text-ink">
      {text}
    </p>
  ));
}

function PageList({ pages }: { pages: readonly { href: string; label: string; line: string }[] }) {
  return (
    <ul role="list" className={`${rows} mt-2`}>
      {pages.map((p) => (
        <li key={p.href}>
          <Link
            href={p.href}
            className="press flex min-h-11 flex-col gap-0.5 px-4 py-3 hover:bg-active focus-visible:-outline-offset-2"
          >
            <span className="font-semibold text-ink underline decoration-line-strong underline-offset-4">
              {p.label}
            </span>
            <span className="text-sm text-ink-muted">{p.line}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Boxes and arrows in plain HTML: the planner sends sessions in, ShiftDesk reaches casuals, and
// signed webhooks go back out to the planner. A column on a phone, a row from 768px. The arrows are
// decoration; every step is in words.
const boxShape =
  "flex min-h-14 items-center justify-center rounded-row px-4 py-3 text-center font-semibold";
const box = `glass-tile ${boxShape} text-ink`;
const step = "flex items-center justify-center gap-2 px-2 py-1 text-center text-sm text-ink-muted";

function Diagram() {
  const d = S.api.diagram;
  return (
    <figure aria-label={d.label} className="mt-2">
      <ol
        role="list"
        className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]"
      >
        <li className={box}>{d.planner}</li>
        <li className={step}>
          <Arrow />
          <span>{d.apiIn}</span>
        </li>
        <li className={`${boxShape} bg-accent text-on-accent`}>{d.shiftdesk}</li>
        <li className={step}>
          <Arrow />
          <span>{d.toCasuals}</span>
        </li>
        <li className={box}>{d.casuals}</li>
      </ol>
      <p className={`${step} mt-3 md:justify-start`}>
        <Arrow back />
        <span>{d.webhooksOut}</span>
      </p>
    </figure>
  );
}

// Down on a phone, right from 768px; the way back points up, then left.
function Arrow({ back = false }: { back?: boolean }) {
  return (
    <Icon name="arrow" className={back ? "-rotate-90 md:rotate-180" : "rotate-90 md:rotate-0"} />
  );
}
