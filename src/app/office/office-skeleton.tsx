// What an office page shows while it loads (Phase 21; office-frame.tsx shows it while a page picked
// in the menu is on its way, menu-pending.tsx): the page's final layout with each value a flat
// grey bar at its real size (no shimmer, nothing moving), so nothing jumps when the page arrives. The dashboard's own (its four cards, its urgent places and
// its week), and every other page's (a headline, a line, then a card of rows). Hidden from screen
// readers but for one line that says it's loading. Hook-free.

const BAR = "block rounded-full bg-raised";

function Loading({ what }: { what: string }) {
  return <p className="sr-only">Loading {what}…</p>;
}

export function DashboardSkeleton() {
  return (
    <div aria-busy="true" data-skeleton="">
      <Loading what="the dashboard" />
      <div aria-hidden="true" className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <span className={`${BAR} h-4 w-72 max-w-full`} />
          <span className={`${BAR} h-10 w-96 max-w-full`} />
          <span className={`${BAR} h-6 w-56 max-w-full`} />
          <span className={`${BAR} h-6 w-full max-w-xl`} />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="block h-32 rounded-card bg-raised" />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <span className={`${BAR} h-6 w-56`} />
          <span className="block rounded-card bg-card shadow-soft">
            {[0, 1, 2].map((i) => (
              <span key={i} className="flex gap-4 px-4 py-3">
                <span className="block size-14 shrink-0 rounded-row bg-raised" />
                <span className="flex flex-1 flex-col justify-center gap-2">
                  <span className={`${BAR} h-4 w-40`} />
                  <span className={`${BAR} h-3 w-64 max-w-full`} />
                </span>
              </span>
            ))}
          </span>
        </div>
        <span className="block h-64 rounded-card bg-card shadow-soft" />
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
        <span className="block rounded-card bg-card shadow-soft">
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
