// What an office page shows while it loads (Phase 21; office-frame.tsx shows it while a page picked
// in the menu is on its way, menu-pending.tsx): grey bars that slowly fade in and out while they
// wait (Phase 22, `animate-wait`; still in Phase 21; no shimmer, and with reduced motion one fade).
// Phase 24 (round 7): glass, as the pages are: frosted sections, no tints. The dashboard's own
// follows its layout, a part for every section (round 8, Phase 26.2: its head and track, the venue
// map with the session card on it, and the columns under it: Updates and Who worked? since Phase
// 27.4, when To offer became a list on the map); every other page shares one (a headline, a line,
// then a card of rows). Hidden from screen readers but for one line that says
// it's loading.
// Hook-free.

const BAR = "block animate-wait rounded-full bg-raised";
// A section on the page (22px round, frosted glass), as the dashboard's.
const CARD = "glass rounded-inner";

function Loading({ what }: { what: string }) {
  return <p className="sr-only">Loading {what}…</p>;
}

// A column of the board: its title and count, its line, then cards.
function ColumnSkeleton({ part }: { part: string }) {
  return (
    <span data-skeleton-part={part} className={`flex flex-col gap-3 p-4 ${CARD}`}>
      <span className="flex items-center gap-3">
        <span className={`${BAR} h-5 w-28`} />
        <span className={`${BAR} h-6 w-6`} />
      </span>
      <span className={`${BAR} h-4 w-40 max-w-full`} />
      {[0, 1].map((i) => (
        <span key={i} className="flex flex-col gap-3 rounded-row p-4 glass-tile">
          <span className="flex items-start gap-3">
            <span className="block h-11 w-10 shrink-0 animate-wait rounded-row bg-raised" />
            <span className="flex flex-1 flex-col gap-2">
              <span className={`${BAR} h-4 w-28`} />
              <span className={`${BAR} h-3 w-36 max-w-full`} />
            </span>
          </span>
          <span className="flex gap-2">
            <span className={`${BAR} h-7 w-16`} />
            <span className={`${BAR} h-7 w-20`} />
          </span>
        </span>
      ))}
    </span>
  );
}

// The dashboard's own (round 8, Phase 26.2): "Dashboard" and its line, the track with Filter and
// Show full venues, the venue map (380px on a phone, 600px from 1024px: Phase 27.4) with the session
// card over its top left from 1024px (under it before), then the two columns under it.
export function DashboardSkeleton() {
  return (
    <div aria-busy="true" data-skeleton="">
      <Loading what="the dashboard" />
      <div aria-hidden="true" className="@container flex flex-col gap-6">
        <div data-skeleton-part="header" className="flex flex-col gap-4">
          <span className="flex flex-col gap-2">
            <span className={`${BAR} h-9 w-48 max-w-full`} />
            <span className={`${BAR} h-4 w-96 max-w-full`} />
          </span>
          <span className="flex flex-wrap items-center gap-3">
            <span className={`${BAR} h-12 w-96 max-w-full`} />
            <span className={`${BAR} h-11 w-28`} />
          </span>
        </div>
        <span className="relative block">
          <span data-skeleton-part="map" className={`block h-95 @min-[64rem]:h-150 ${CARD}`} />
          <span
            data-skeleton-part="detail"
            className={`mt-3 flex flex-col gap-4 p-6 @min-[64rem]:absolute @min-[64rem]:top-3 @min-[64rem]:left-3 @min-[64rem]:mt-0 @min-[64rem]:w-101 ${CARD}`}
          >
            <span className="flex items-start gap-3">
              <span className="block size-12 shrink-0 animate-wait rounded-row bg-raised" />
              <span className="flex flex-1 flex-col gap-2">
                <span className={`${BAR} h-6 w-40 max-w-full`} />
                <span className={`${BAR} h-4 w-56 max-w-full`} />
              </span>
            </span>
            <span className={`${BAR} h-11 w-full`} />
            <span className="grid grid-cols-2 gap-3">
              <span className="block h-24 animate-wait rounded-row bg-raised" />
              <span className="block h-24 animate-wait rounded-row bg-raised" />
            </span>
            <span className={`${BAR} h-11 w-full`} />
          </span>
        </span>
        <span className="grid items-start gap-3 @min-[48rem]:grid-cols-2">
          <ColumnSkeleton part="updates" />
          <ColumnSkeleton part="mark" />
        </span>
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" data-skeleton="">
      <Loading what="the page" />
      <div aria-hidden="true" className="flex flex-col gap-6">
        <span className={`${BAR} h-9 w-64 max-w-full`} />
        <span className={`${BAR} h-5 w-full max-w-lg`} />
        <span className={`block ${CARD}`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0"
            >
              <span className={`${BAR} h-4 w-48`} />
              <span className={`${BAR} h-3 w-72 max-w-full`} />
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
