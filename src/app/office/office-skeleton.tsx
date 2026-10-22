// What an office page shows while it loads (Phase 21; office-frame.tsx shows it while a page picked
// in the menu is on its way, menu-pending.tsx): grey bars that slowly fade in and out while they
// wait (Phase 22, `animate-wait`; still in Phase 21; no shimmer, and with reduced motion one fade). The
// dashboard's own follows its layout, a part for every section (its headline, its four cards, its
// urgent places, its week and its three panels); every other page shares one (a headline, a line,
// then a card of rows). Hidden from screen readers but for one line that says it's loading.
// Hook-free.

const BAR = "block animate-wait rounded-full bg-raised";

function Loading({ what }: { what: string }) {
  return <p className="sr-only">Loading {what}…</p>;
}

export function DashboardSkeleton() {
  return (
    <div aria-busy="true" data-skeleton="">
      <Loading what="the dashboard" />
      <div aria-hidden="true" className="flex flex-col gap-8">
        <div data-skeleton-part="header" className="flex flex-col gap-3">
          <span className={`${BAR} h-4 w-72 max-w-full`} />
          <span className={`${BAR} h-10 w-96 max-w-full`} />
          <span className={`${BAR} h-6 w-56 max-w-full`} />
          <span className={`${BAR} h-6 w-full max-w-xl`} />
        </div>
        <div data-skeleton-part="cards" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="block h-32 animate-wait rounded-card bg-raised" />
          ))}
        </div>
        <div data-skeleton-part="urgent" className="flex flex-col gap-3">
          <span className={`${BAR} h-6 w-56`} />
          <span className="block rounded-card bg-card shadow-soft">
            {[0, 1, 2].map((i) => (
              <span key={i} className="flex gap-4 px-4 py-3">
                <span className="block size-14 shrink-0 animate-wait rounded-row bg-raised" />
                <span className="flex flex-1 flex-col justify-center gap-2">
                  <span className={`${BAR} h-4 w-40`} />
                  <span className={`${BAR} h-3 w-64 max-w-full`} />
                </span>
              </span>
            ))}
          </span>
        </div>
        <span
          data-skeleton-part="week"
          className="flex flex-col gap-4 rounded-card bg-card p-4 shadow-soft sm:p-6"
        >
          <span className={`${BAR} h-6 w-32`} />
          <span className="grid grid-cols-7 items-end gap-2">
            {[40, 70, 100, 55, 85, 30, 0].map((h, i) => (
              <span key={i} className="flex flex-col items-center gap-2">
                <span className="flex h-32 w-full max-w-11 items-end overflow-hidden rounded-row bg-raised inset-shadow-sunk sm:h-40">
                  <span
                    style={{ height: `${h}%` }}
                    className="block w-full animate-wait rounded-row bg-line"
                  />
                </span>
                <span className={`${BAR} h-3 w-8`} />
              </span>
            ))}
          </span>
        </span>
        <span className="grid gap-4 lg:grid-cols-12">
          {(
            [
              ["attention", "lg:col-span-8", "border-attention-line bg-attention-soft", 2],
              ["waiting", "lg:col-span-4", "border-wait-line bg-wait-soft", 1],
              ["sorted", "lg:col-span-12", "border-done-line bg-done-soft", 3],
            ] as const
          ).map(([part, span, tint, n]) => (
            <span
              key={part}
              data-skeleton-part={part}
              className={`grain-soft flex flex-col gap-3 rounded-card border p-4 shadow-soft sm:p-6 ${span} ${tint}`}
            >
              <span className={`${BAR} h-6 w-40`} />
              {Array.from({ length: n }, (_, i) => (
                <span key={i} className="block h-16 rounded-row bg-card shadow-raise" />
              ))}
            </span>
          ))}
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
