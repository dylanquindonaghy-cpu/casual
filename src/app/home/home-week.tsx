import Link from "next/link";
import { WEEK_LEGEND, WEEK_LEGEND_OFFLINE, WEEK_TITLE } from "@/lib/portal/home-copy";
import type { WeekRow, WeekTile } from "@/lib/portal/home-week";
import { HomeCard } from "./home-card";

// "Your week" on Home (Phase 30.1; docs/screens.md "### 30.1"): this week and next, seven day tiles
// each (src/lib/portal/home-week.ts): today ringed, a booked day filled in the accent (a link to
// that shift), a day with shifts she can take outlined amber (a link to Open shifts for that day),
// the legend under them in words. Colour is never the only signal: each tile has its name ("Monday
// 9 November: booked, Steward 14:00 to 22:00"; a past day marked not attended is never "booked").
// Each tile is at least 44px both ways on a 390px phone (the grid reaches 8px into the card's edge
// for it). Shown in the kept copy too, with her booked days only: today's ring, the amber outlines,
// their links to Open shifts and their words go stale, so they're online only (each tile's name in
// visually hidden words, one for each copy; the legend too). Hook-free.
export function HomeWeek({ weeks, className }: { weeks: WeekRow[]; className?: string }) {
  return (
    <HomeCard id="week" title={WEEK_TITLE} className={className}>
      <div className="flex flex-col gap-3">
        {weeks.map((w) => (
          <div key={w.name} data-week={w.name}>
            <p className="px-1 text-sm text-ink-muted">
              {w.name} · {w.range}
            </p>
            <ul role="list" aria-label={w.name} className="-mx-2 mt-1.5 grid grid-cols-7 gap-1">
              {w.tiles.map((t) => (
                <li key={t.day} className="flex">
                  <Tile tile={t} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p data-online-only="" className="px-1 text-sm text-ink-muted">
          {WEEK_LEGEND}
        </p>
        <p data-offline-only="" className="px-1 text-sm text-ink-muted">
          {WEEK_LEGEND_OFFLINE}
        </p>
      </div>
    </HomeCard>
  );
}

function Tile({ tile }: { tile: WeekTile }) {
  const filled = tile.booked;
  const outlined = !filled && tile.open > 0;
  const look = filled
    ? "bg-accent text-on-accent"
    : `glass-tile ${tile.past ? "text-ink-muted" : "text-ink"}`;
  const shape = `relative flex min-h-14 w-full min-w-0 flex-col items-center justify-center rounded-row py-1.5 text-center ${look}`;
  const marks = {
    "data-day": tile.day,
    "data-booked": tile.booked ? "" : undefined,
    "data-missed": tile.missed ? "" : undefined,
    "data-open": tile.open > 0 ? String(tile.open) : undefined,
    "data-today": tile.today ? "" : undefined,
  };
  const body = (online: boolean) => (
    <>
      {online && tile.today && (
        <span
          aria-hidden="true"
          data-online-only=""
          data-ring=""
          className="pointer-events-none absolute inset-0 rounded-row ring-2 ring-ink"
        />
      )}
      {online && outlined && (
        <span
          aria-hidden="true"
          data-online-only=""
          data-outline=""
          className="pointer-events-none absolute inset-0 rounded-row outline-2 -outline-offset-2 outline-attention"
        />
      )}
      <span aria-hidden="true" className="block text-xs font-medium">
        {tile.dow}
      </span>
      <span aria-hidden="true" className="block font-sign text-lg leading-tight">
        {tile.date}
      </span>
    </>
  );
  // Its name in words, as hidden text (never aria-label: the kept copy's must differ).
  const name =
    tile.name === tile.nameOffline ? (
      <span className="sr-only">{tile.name}</span>
    ) : (
      <>
        <span data-online-only="" className="sr-only">
          {tile.name}
        </span>
        <span data-offline-only="" className="sr-only">
          {tile.nameOffline}
        </span>
      </>
    );
  // A day open to her links to Open shifts, which needs signal: in the kept copy it's a plain tile.
  if (tile.href && outlined) {
    return (
      <>
        <Link href={tile.href} {...marks} data-online-only="" className={`press ${shape}`}>
          {body(true)}
          <span className="sr-only">{tile.name}</span>
        </Link>
        <span {...marks} data-offline-only="" className={shape}>
          {body(false)}
          <span className="sr-only">{tile.nameOffline}</span>
        </span>
      </>
    );
  }
  return tile.href ? (
    <Link href={tile.href} {...marks} className={`press ${shape}`}>
      {body(true)}
      {name}
    </Link>
  ) : (
    <span {...marks} className={shape}>
      {body(true)}
      {name}
    </span>
  );
}
