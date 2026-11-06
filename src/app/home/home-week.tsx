import Link from "next/link";
import { WEEK_LEGEND, WEEK_TITLE } from "@/lib/portal/home-copy";
import type { WeekRow, WeekTile } from "@/lib/portal/home-week";
import { HomeCard } from "./home-card";

// "Your week" on Home (Phase 30.1; docs/screens.md "### 30.1"): this week and next, seven day tiles
// each (src/lib/portal/home-week.ts): today ringed, a booked day filled in the accent (a link to
// that shift), a day with shifts she can take outlined amber (a link to Open shifts for that day),
// the legend under them in words. Colour is never the only signal: each tile has its name ("Monday
// 9 November: booked, Steward 14:00 to 22:00"). Each tile is at least 44px both ways on a 390px
// phone (the grid reaches 8px into the card's edge for it). Shown in the kept copy too. Hook-free.
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
        <p className="px-1 text-sm text-ink-muted">{WEEK_LEGEND}</p>
      </div>
    </HomeCard>
  );
}

function Tile({ tile }: { tile: WeekTile }) {
  const look = tile.booked
    ? "bg-accent text-on-accent"
    : tile.open > 0
      ? "glass-tile text-ink outline-2 -outline-offset-2 outline-attention"
      : `glass-tile ${tile.past ? "text-ink-muted" : "text-ink"}`;
  const ring = tile.today ? "ring-2 ring-ink" : "";
  const shape = `flex min-h-14 w-full min-w-0 flex-col items-center justify-center rounded-row py-1.5 text-center ${look} ${ring}`;
  const body = (
    <>
      <span aria-hidden="true" className="block text-xs font-medium">
        {tile.dow}
      </span>
      <span aria-hidden="true" className="block font-sign text-lg leading-tight">
        {tile.date}
      </span>
    </>
  );
  const marks = {
    "data-day": tile.day,
    "data-booked": tile.booked ? "" : undefined,
    "data-open": tile.open > 0 ? String(tile.open) : undefined,
    "data-today": tile.today ? "" : undefined,
  };
  return tile.href ? (
    <Link href={tile.href} aria-label={tile.name} {...marks} className={`press ${shape}`}>
      {body}
    </Link>
  ) : (
    <span role="img" aria-label={tile.name} {...marks} className={shape}>
      {body}
    </span>
  );
}
