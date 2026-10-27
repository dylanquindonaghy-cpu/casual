"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Panel, PanelGroup, PanelLink, PanelRow } from "@/lib/office/dashboard-charts";
import { btn, countNeeds, notice, textLink } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { StatusChip } from "../../ui/status-chip";
import { useHydrated } from "../../use-hydrated";

// The rows behind a mark (Phase 23, 23.4; the approved mock-up): a native <dialog>, a panel from
// the right from 1024px and a sheet from the foot on a phone, over a scrim. A chart's mark or a
// count card opens it (`usePanel().open`) with the panel the page built for it (src/lib/office/
// dashboard-charts.ts): its title, a line, its rows (each with its chips and the one thing to do
// about it: Offer, Mark who worked, Check, Open…), "Showing the first 50." when there were more,
// and the ways on. Escape, the scrim and Close close it, and focus goes back to the mark that
// opened it; a link in it closes it as it goes, and a link to a place on this page ("See how long
// things have waited") takes focus there with it. It floats over the page: the office's one
// overlay (`float`). Until the page is ready (hydrated) the count cards are plain links.

type OpenPanel = (panel: Panel, opener: HTMLElement, key: string) => void;

// The place on this page a link goes to ("#waited-chart": "waited-chart"), or null for a page.
export function placeOnPage(href: string | null): string | null {
  return href !== null && href.startsWith("#") && href.length > 1 ? href.slice(1) : null;
}

const PanelContext = createContext<{ open: OpenPanel; current: string | null; ready: boolean }>({
  open: () => undefined,
  current: null,
  ready: false,
});

// What's open (`current`, the mark's key: its chart dims its other marks) and how to open one.
export const usePanel = () => useContext(PanelContext);

export const PANEL_TITLE_ID = "chart-panel-title";

export function PanelHost({ children }: { children: ReactNode }) {
  const ready = useHydrated();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // The place on this page a link in the panel went to: focus goes there when it closes.
  const landing = useRef<string | null>(null);
  const [shown, setShown] = useState<{ panel: Panel; key: string } | null>(null);

  // Opened once its rows are in it, with focus on Close (the first thing in it you can use).
  useEffect(() => {
    const d = dialog.current;
    if (!shown || !d || d.open) return;
    d.showModal();
    close.current?.focus({ preventScroll: true });
  }, [shown]);

  const open = useCallback<OpenPanel>((panel, el, key) => {
    opener.current = el;
    setShown({ panel, key });
  }, []);
  const value = useMemo(() => ({ open, current: shown?.key ?? null, ready }), [open, shown, ready]);

  return (
    <PanelContext.Provider value={value}>
      {children}
      <dialog
        ref={dialog}
        aria-modal="true"
        aria-labelledby={PANEL_TITLE_ID}
        data-ready={ready ? "" : undefined}
        onClose={() => {
          setShown(null);
          // A place on this page (the browser has already scrolled to it): focus goes there, so
          // the next Tab goes on from it. Otherwise back to what opened the panel.
          const place = landing.current === null ? null : document.getElementById(landing.current);
          landing.current = null;
          (place ?? opener.current)?.focus({ preventScroll: true });
          opener.current = null;
        }}
        // The scrim: a click there lands on the dialog itself (its rows fill it). A link in it
        // closes it as it goes.
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            e.currentTarget.close();
            return;
          }
          const link = (e.target as Element).closest("a");
          if (!link) return;
          // A plain click or Enter (not one opening a new tab) on a link to this page's place.
          const plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
          landing.current = plain ? placeOnPage(link.getAttribute("href")) : null;
          e.currentTarget.close();
        }}
        className="top-auto bottom-0 left-0 m-0 h-auto max-h-[86dvh] w-full max-w-none overflow-hidden rounded-t-inner glass-float p-0 text-base text-ink transition-[translate] duration-200 ease-sd backdrop:animate-fade backdrop:bg-scrim/40 starting:translate-y-full lg:top-0 lg:right-0 lg:left-auto lg:h-dvh lg:max-h-none lg:w-[30rem] lg:max-w-full lg:rounded-none lg:starting:translate-x-full lg:starting:translate-y-0"
      >
        {shown ? (
          <PanelView panel={shown.panel} closeRef={close} onClose={() => dialog.current?.close()} />
        ) : null}
      </dialog>
    </PanelContext.Provider>
  );
}

// A link out of the panel: a page (Next's <Link>, not fetched ahead: a panel can hold 50) or a
// place on this one.
function Out({
  link,
  className,
  describedBy,
}: {
  link: PanelLink;
  className: string;
  describedBy?: string;
}) {
  return link.href.startsWith("#") ? (
    <a href={link.href} className={className} aria-describedby={describedBy}>
      {link.label}
    </a>
  ) : (
    <Link href={link.href} prefetch={false} className={className} aria-describedby={describedBy}>
      {link.label}
    </Link>
  );
}

// One row: what it is (its title a link to it, when it has a page), its facts, its count and
// chips, and its action, named by the row it's on.
function RowView({ r }: { r: PanelRow }) {
  const id = useId();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p id={id} className="font-semibold text-ink">
          {r.href ? <Out link={{ label: r.title, href: r.href }} className={textLink} /> : r.title}
        </p>
        {r.sub && <p className="text-sm text-ink-muted">{r.sub}</p>}
      </div>
      {(r.count !== null || r.chips.length > 0 || r.action) && (
        <div className="flex flex-wrap items-center gap-2">
          {r.count !== null && <span className={countNeeds}>{r.count}</span>}
          {r.chips.map((c) => (
            <StatusChip key={`${c.tone}:${c.text}`} tone={c.tone}>
              {c.text}
            </StatusChip>
          ))}
          {r.action && (
            <Out
              link={r.action}
              describedBy={id}
              className={r.action.main ? btn.primary : btn.secondary}
            />
          )}
        </div>
      )}
    </li>
  );
}

function GroupView({ g, label }: { g: PanelGroup; label: string }) {
  return (
    <div className="mt-4">
      {g.label && <h3 className="text-sm font-bold text-ink-muted">{g.label}</h3>}
      {g.rows.length > 0 && (
        <ul role="list" aria-label={label} className="divide-y divide-line">
          {g.rows.map((r) => (
            <RowView key={r.key} r={r} />
          ))}
        </ul>
      )}
      {g.empty && <p className="py-3 text-ink-muted">{g.empty}</p>}
      {g.more && <p className="pt-3 text-sm text-ink-muted">{g.more}</p>}
    </div>
  );
}

// The panel's insides (also what the dashboard's tests render, panel by panel).
export function PanelView({
  panel,
  onClose,
  closeRef,
}: {
  panel: Panel;
  onClose?: () => void;
  closeRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="flex max-h-[inherit] flex-col lg:h-full">
      <span
        aria-hidden="true"
        className="mx-auto mt-3 block h-1 w-10 shrink-0 rounded-full bg-button-line lg:hidden"
      />
      <div className="flex items-start gap-3 border-b border-line px-6 py-4 lg:pt-6">
        <div className="min-w-0 flex-1">
          <h2 id={PANEL_TITLE_ID} className="text-2xl font-extrabold tracking-heading text-ink">
            {panel.title}
          </h2>
          {panel.sub && <p className="mt-1 text-base text-ink-muted">{panel.sub}</p>}
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="press-glass glass-button inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-8">
        {panel.error && (
          <p role="status" className={`${notice} mt-4 flex items-start gap-2`}>
            <Icon name="info" size={18} className="mt-1" />
            {panel.error}
          </p>
        )}
        {panel.groups.map((g, i) => (
          <GroupView key={g.label ?? i} g={g} label={g.label ?? panel.title} />
        ))}
        {panel.foot.length > 0 && (
          <p className="flex flex-wrap gap-2 pt-6">
            {panel.foot.map((l) => (
              <Out key={l.href} link={l} className={btn.secondary} />
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
