import type { ReactNode } from "react";
import { Icon } from "./icons";

// The top of every page (docs/ui-design.md "Page header"): the way back to the list it belongs to
// (`back`, on a record's own page), the page's one <h1>, meta and intro lines (children), then the
// actions, main one first. The headline is `text-title`: semibold and a little tight in both apps
// (Phase 28), 28px in the casual app and 30px in the office. No label above the heading and no
// divider under it (Phase 17): the firm's bar or the office's top bar already names the firm, and
// space does the separating. In the office (Phase 24, round 7, as the mock-up's Events & sessions)
// the actions sit beside the headline and its lines, level with their foot, and go under them when
// there's no room (a phone); the casual app keeps them under. Beside the headline, on its baseline,
// the place for "Updated 10:42" (round 8, aud-2): in the office an empty <small> its frame writes
// into (src/app/office/updated-stamp.tsx); in the casual app, since Phase 28, the words a page
// passes as `updated` ("Updated 21:35"), on the same baseline as the office's, shown only online
// (the copy kept for no signal says when it was saved instead: globals.css [data-online-only]).
// Adds no other words and no other heading. Hook-free, imports nothing from src/lib: safe for
// every page.
export function PageHeader({
  back,
  title,
  titleId,
  updated,
  children,
  actions,
  beside = false,
  stamp = true,
}: {
  back?: { href: string; label: string };
  title: ReactNode;
  titleId?: string;
  updated?: string;
  children?: ReactNode;
  actions?: ReactNode;
  // Phase 32 (32.2): the casual app's Home puts its actions beside the headline from 1024px, as
  // the office's dashboard does, and only there (on a phone they're the tab bar's own pages).
  beside?: boolean;
  // Phase 37.6: false leaves out the empty place for "Updated hh:mm" (a page that isn't live data,
  // like the office's not-found and error pages, says no time).
  stamp?: boolean;
}) {
  return (
    <header className="mb-6">
      {back ? (
        // A plain link (this folder imports nothing from packages): a full page load, as it's rare.
        // In the office it dips when pressed, like everything you press (Phase 22).
        <a
          href={back.href}
          className="-ml-1 mb-1 inline-flex min-h-11 items-center gap-1 text-base font-semibold text-ink-muted hover:text-ink office:press"
        >
          <Icon name="chevron" className="h-4 w-4 rotate-180" />
          {back.label}
        </a>
      ) : null}
      <div
        className={
          beside
            ? "office:flex office:flex-wrap office:items-end office:gap-x-6 office:gap-y-4 lg:flex lg:flex-wrap lg:items-end lg:justify-between lg:gap-x-6"
            : "office:flex office:flex-wrap office:items-end office:gap-x-6 office:gap-y-4"
        }
      >
        {/* With "Updated …" the casual app's headline row is the office's: the headline and the
            stamp on one baseline, the lines under them. Without it, the casual app's row is a plain
            block and only the office's values make it a row. */}
        <div
          className={
            updated
              ? "flex min-w-0 flex-wrap items-baseline gap-x-3 office:flex-1 office:basis-80"
              : "office:flex office:min-w-0 office:flex-1 office:basis-80 office:flex-wrap office:items-baseline office:gap-x-3"
          }
        >
          <h1 id={titleId} className="text-title text-balance text-ink">
            {title}
          </h1>
          {updated ? (
            <small
              data-updated-slot=""
              data-online-only=""
              className="text-xs text-ink-faint tabular-nums"
            >
              {updated}
            </small>
          ) : stamp ? (
            <small data-updated-slot="" className="text-xs text-ink-faint tabular-nums" />
          ) : null}
          {/* The lines on a line of their own under the headline in the office (the whole row's
              width, so they never sit beside a short headline), at a reading width inside it. */}
          {children ? (
            <div className={updated ? "mt-2 basis-full" : "mt-2 office:basis-full"}>
              <div className="flex max-w-prose flex-col gap-2">{children}</div>
            </div>
          ) : null}
        </div>
        {actions ? (
          <div
            className={
              beside
                ? "mt-4 flex flex-wrap gap-3 office:mt-0 max-lg:hidden lg:mt-0"
                : "mt-4 flex flex-wrap gap-3 office:mt-0"
            }
          >
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
