"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { countNeeds, countWaiting } from "../ui/classes";
import { Icon, type IconName } from "../ui/icons";
import { MenuPending, MenuPendingReporter } from "./menu-pending";
import { MenuScroll } from "./menu-scroll";
import {
  ariaCurrent,
  currentHref,
  type MenuBadge,
  type MenuGroup,
  type MenuLink,
} from "./office-nav";
import { railCookie } from "./rail-cookie";
import { foldBadge, railItems, tipWords, type RailItem } from "./rail-items";

// The office menu from 1024px (Phase 24, round 7 of the canvas; docs/ui-design.md "Office shell"):
// a floating glass column at the left, 72px wide, that stays put as the page scrolls. At its top the
// firm's mark (its initial on its own colour), and under it the rail's own button, which opens the
// rail to 236px with names and counts and shuts it to icons again (kept in the sd-rail cookie:
// rail-cookie.ts). Then the menu's links, in its order (office-menu.ts): Dashboard, Needs attention,
// Events & sessions, Enquiries and Cancellations as icons; Pay and People as folds; under a line,
// Admin and records, a fold too. Pressing a fold while the rail is shut opens the rail with that
// fold open. A red dot on an icon whose page needs you (a count that `needs` this person: Needs
// attention, enquiries that need a person, uploads to check, pay queries for payroll), on a fold's
// icon when one of its pages does. Shut, an icon's name shows beside it under the pointer and on
// keyboard focus (with its count's words), stays while the pointer moves onto it, and Escape puts it
// away (WCAG 1.4.13). Shut, it's 585px tall: in a window under 640px it scrolls, with no bar (its
// names then show only with the rail open). The page you're on sits under a white glass lens, its icon in the accent; a
// fold holding it wears the lens while it's shut. Plain links and buttons (no list items, headings,
// regions or menu roles, which the browser tests count on pages), each named by its words alone,
// its count's words read after it. Below 1024px the drawer holds the menu instead (office-nav.tsx).

export const RAIL_ID = "office-rail";

const ROW =
  "press peer relative z-10 flex shrink-0 items-center text-base whitespace-nowrap disabled:cursor-default";
const SHUT = "size-12 justify-center rounded-full";
const OPEN = "min-h-11 w-full gap-3 rounded-row px-3 text-left";
const CHILD = "min-h-9.5 w-full gap-3 rounded-row px-3 text-left";
const IDLE = "text-ink-muted hover:bg-active hover:text-ink active:bg-button-press";
const LIT = "lens font-medium text-ink";

function Count({ badge }: { badge: MenuBadge }) {
  return (
    <span aria-hidden="true" className={`ml-auto ${badge.needs ? countNeeds : countWaiting}`}>
      {badge.count}
      {badge.more ? "+" : ""}
    </span>
  );
}

// A red dot on a shut icon whose page needs you, set off from the icon by a 2px edge of the rail's
// own glass (a border: depth is the glass's alone).
function Dot() {
  return (
    <span
      aria-hidden="true"
      data-rail-dot=""
      className="absolute top-2 right-2 size-3 rounded-full border-2 border-panel bg-urgent bg-clip-padding"
    />
  );
}

// The words beside a shut icon (hidden from screen readers: the icon's name says them), with an
// invisible bridge over the 12px gap so the pointer can move onto them.
function Tip({ words, away }: { words: string; away: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-rail-tip=""
      className={`absolute top-1/2 left-full z-30 ml-3 hidden -translate-y-1/2 animate-pop rounded-row bg-ink px-3 py-2 text-sm font-semibold whitespace-nowrap text-on-ink before:absolute before:inset-y-0 before:-left-3 before:w-3${away ? "" : " peer-focus-visible:block pointer-fine:group-hover/tip:block"}`}
    >
      {words}
    </span>
  );
}

function Row({
  open,
  tip,
  away,
  onBack,
  children,
}: {
  open: boolean;
  tip: string;
  away: boolean;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`group/tip relative flex${open ? "" : " justify-center"}`}
      onPointerEnter={onBack}
      onPointerLeave={onBack}
    >
      {children}
      {open ? null : <Tip words={tip} away={away} />}
    </div>
  );
}

export function OfficeRail({
  groups,
  firmName,
  firmInitial,
  initialOpen,
}: {
  groups: MenuGroup[];
  firmName: string;
  firmInitial: string;
  initialOpen: boolean;
}) {
  const hydrated = useHydrated();
  const pathname = usePathname();
  const items = railItems(groups);
  const hrefs = groups.flatMap((g) => g.links.map((l) => l.href));
  const current = currentHref(pathname, hrefs);
  const { picked, start } = useContext(MenuPending);
  const shown = picked && hrefs.includes(picked) ? picked : current;
  const [open, setOpen] = useState(initialOpen);
  // The folds you've opened or shut; until then a fold is open while you're on one of its pages.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  // A shut icon's words, put away with Escape until focus or the pointer moves.
  const [away, setAway] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const back = () => setAway(false);

  useEffect(() => {
    if (open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = rail.current;
      if (e.key === "Escape" && el && (el.matches(":hover") || el.contains(document.activeElement)))
        setAway(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const remember = (next: boolean) => {
    document.cookie = railCookie(next, window.location.protocol === "https:");
  };
  const unfolded = (item: Extract<RailItem, { kind: "fold" }>) =>
    chosen[item.id] ?? item.group.links.some((l) => l.href === current);

  // A fold's page (`child`) is only seen with the rail open: always a row with its name, no icon.
  const link = (l: MenuLink, child: boolean) => {
    const lit = l.href === shown;
    const on = l.href === current;
    const named = open || child;
    return (
      <Row key={l.href} open={named} tip={tipWords(l.label, l.badge)} away={away} onBack={back}>
        <Link
          href={l.href}
          aria-current={on ? ariaCurrent(l.href, pathname) : undefined}
          onNavigate={() => start(l.href)}
          onFocus={back}
          onBlur={back}
          className={`${ROW} ${child ? CHILD : open ? OPEN : SHUT} ${lit ? LIT : IDLE}`}
        >
          {child ? (
            // Where a fold's icon is, so its pages' names line up with its own.
            <span aria-hidden="true" className="w-5 shrink-0" />
          ) : (
            <Icon name={l.icon} className={lit ? "text-accent" : "text-ink-muted"} />
          )}
          <span className={named ? "min-w-0 flex-1 truncate" : "sr-only"}>{l.label}</span>
          <MenuPendingReporter href={l.href} />
          {named && l.badge ? <Count badge={l.badge} /> : null}
          {!named && l.badge?.needs ? <Dot /> : null}
        </Link>
        {l.badge ? <span className="sr-only">{l.badge.words}</span> : null}
      </Row>
    );
  };

  const fold = (item: Extract<RailItem, { kind: "fold" }>) => {
    const { group, id } = item;
    const expanded = open && unfolded(item);
    const badge = foldBadge(group);
    const holds = group.links.some((l) => l.href === shown);
    const lit = holds && !expanded;
    const icon: IconName = group.icon ?? "settings";
    return (
      <div key={id} className={item.apart ? "mt-4 border-t border-line pt-3" : undefined}>
        <Row open={open} tip={tipWords(group.label, badge)} away={away} onBack={back}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={id}
            disabled={!hydrated}
            onFocus={back}
            onBlur={back}
            onClick={() => {
              if (!open) {
                setOpen(true);
                setChosen((c) => ({ ...c, [id]: true }));
              } else setChosen((c) => ({ ...c, [id]: !expanded }));
            }}
            className={`${ROW} ${open ? OPEN : SHUT} ${lit ? LIT : IDLE}`}
          >
            <Icon name={icon} className={lit ? "text-accent" : "text-ink-muted"} />
            <span className={open ? "min-w-0 flex-1 truncate" : "sr-only"}>{group.label}</span>
            {open && badge && !expanded ? <Count badge={badge} /> : null}
            {open ? (
              <Icon
                name="chevron"
                size={16}
                className={`text-ink-muted transition-transform duration-200 ease-sd ${expanded ? "-rotate-90" : "rotate-90"}`}
              />
            ) : null}
            {!open && badge?.needs ? <Dot /> : null}
          </button>
          {badge ? <span className="sr-only">{badge.words}</span> : null}
        </Row>
        <div id={id} hidden={!expanded} className="flex animate-in flex-col gap-1 pt-1">
          {group.links.map((l) => link(l, true))}
        </div>
      </div>
    );
  };

  const nav = (
    <nav aria-label="Office menu" className="flex flex-col gap-1">
      {items.map((item) => (item.kind === "link" ? link(item.link, false) : fold(item)))}
    </nav>
  );

  return (
    <div
      ref={rail}
      id={RAIL_ID}
      data-rail={open ? "open" : "shut"}
      className={`glass-float sticky top-3 z-30 mt-3 hidden flex-col self-start rounded-card px-2 py-4 transition-[width] duration-200 ease-sd lg:flex ${open ? "max-h-[calc(100dvh-1.5rem)] w-59" : "scrollbar-none w-18 items-center [@media(height<40rem)]:max-h-[calc(100dvh-1.5rem)] [@media(height<40rem)]:overflow-y-auto"}`}
    >
      {/* The firm (its name only while the rail is open), then the rail's own button. */}
      <div
        className={`mb-4 flex shrink-0 ${open ? "items-center gap-3 pl-1" : "flex-col items-center gap-3"}`}
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-row bg-brand-bar text-lg font-semibold text-on-brand-bar"
        >
          {firmInitial}
        </span>
        <span className={open ? "min-w-0 flex-1 truncate font-semibold text-ink" : "sr-only"}>
          {firmName}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={RAIL_ID}
          disabled={!hydrated}
          onClick={() => {
            setOpen(!open);
            remember(!open);
          }}
          className="press-glass flex size-11 shrink-0 items-center justify-center rounded-row text-ink-muted hover:bg-active hover:text-ink active:bg-button-press disabled:cursor-default"
        >
          <span className="sr-only">
            {open ? "Show the menu as icons" : "Show the menu with names"}
          </span>
          <Icon name="sidebar" className={open ? "" : "-scale-x-100"} />
        </button>
      </div>
      {open ? <MenuScroll className="-mx-1 min-h-0 flex-1 px-1">{nav}</MenuScroll> : nav}
    </div>
  );
}
