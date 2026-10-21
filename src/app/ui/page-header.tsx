import type { ReactNode } from "react";
import { Icon } from "./icons";

// The top of every page (docs/ui-design.md "Page header"): the way back to the list it belongs to
// (`back`, on a record's own page), the page's one <h1>, meta and intro lines (children), then the
// actions, main one first. No label above the heading and no divider under it (Phase 17): the
// firm's bar or the office's top bar already names the firm, and space does the separating. Adds
// no words and no other heading. Hook-free, imports nothing from src/lib: safe for every page.
export function PageHeader({
  back,
  title,
  titleId,
  children,
  actions,
}: {
  back?: { href: string; label: string };
  title: ReactNode;
  titleId?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {back ? (
        // A plain link (this folder imports nothing from packages): a full page load, as it's rare.
        <a
          href={back.href}
          className="-ml-1 mb-1 inline-flex min-h-11 items-center gap-1 text-base font-semibold text-ink-muted hover:text-ink"
        >
          <Icon name="chevron" className="h-4 w-4 rotate-180" />
          {back.label}
        </a>
      ) : null}
      <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-balance text-ink">
        {title}
      </h1>
      {children ? <div className="mt-2 flex max-w-prose flex-col gap-2">{children}</div> : null}
      {actions ? <div className="mt-4 flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}
