import type { ReactNode } from "react";

// The top of every page (docs/ui-design.md "Page header"): an eyebrow, the page's one <h1>, meta
// and intro lines (children), then the actions, main one first. A divider below. Adds no words and
// no other heading. Hook-free, imports nothing from src/lib: safe for every page.
export function PageHeader({
  eyebrow,
  title,
  titleId,
  children,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 border-b border-line pb-6">
      {eyebrow ? <p className="text-sm font-medium text-ink-muted">{eyebrow}</p> : null}
      <h1
        id={titleId}
        className={`text-3xl font-bold tracking-tight text-balance text-ink${eyebrow ? " mt-1" : ""}`}
      >
        {title}
      </h1>
      {children ? <div className="mt-3 flex max-w-prose flex-col gap-2">{children}</div> : null}
      {actions ? <div className="mt-5 flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}
