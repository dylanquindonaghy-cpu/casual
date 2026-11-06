import Link from "next/link";
import type { ReactNode } from "react";
import { countPill, headingGap, quietLink, staffH2 } from "../ui/classes";

// One of Home's new cards (Phase 30.1; docs/screens.md "### 30.1"), in the look of its other
// sections: one glass section 12px round, 16px inside its edges, its heading inside with the
// office's grey count pill beside it (outside the <h2>, so the section's name stays its title) and
// a quiet grey link to the whole list on the right; its body 12px under the heading. `className`
// places it in Home's grid from 1024px; `extra` carries data-online-only for a card whose every
// figure needs signal. Hook-free.
export function HomeCard({
  id,
  title,
  count,
  link,
  className = "",
  extra,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  link?: { href: string; label: string };
  className?: string;
  extra?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <section
      {...extra}
      aria-labelledby={`${id}-heading`}
      data-home-card={id}
      className={`glass animate-in rounded-inner p-4 ${className}`}
    >
      <div className="flex min-h-11 items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={`${id}-heading`} className={staffH2}>
            {title}
          </h2>
          {count !== undefined && <span className={countPill}>{count}</span>}
        </div>
        {link && (
          <Link href={link.href} className={`${quietLink} shrink-0`}>
            {link.label}
          </Link>
        )}
      </div>
      <div className={headingGap}>{children}</div>
    </section>
  );
}

// A thin bar (decorative: the words beside it say the same): `fill` from 0 to 1, in its status's
// colour.
const FILL = {
  urgent: "bg-urgent-fill",
  attention: "bg-attention",
  done: "bg-done-fill",
  quiet: "bg-ink-muted",
  brand: "bg-accent",
} as const;
export function Bar({ fill, tone }: { fill: number; tone: keyof typeof FILL }) {
  return (
    <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-raised">
      <span
        className={`block h-full rounded-full ${FILL[tone]}`}
        style={{ width: `${Math.round(fill * 100)}%` }}
      />
    </span>
  );
}
