// What an office page shows while it loads (Phase 21; office-frame.tsx shows it while a page picked
// in the menu is on its way, menu-pending.tsx): grey bars that slowly fade in and out while they
// wait (Phase 22, `animate-wait`; still in Phase 21; no shimmer, and with reduced motion one fade).
// Phase 23 (round 3): flat, as the pages are: white cards with their hairline, no tints and no
// depth. The dashboard's own follows its layout, a part for every section (its headline, its four
// counts, its urgent places and its six charts); every other page shares one (a headline, a line,
// then a card of rows). Hidden from screen readers but for one line that says it's loading.
// Hook-free.

const BAR = "block animate-wait rounded-full bg-raised";
// A card inside the page (22px round, its hairline), as the dashboard's.
const CARD = "rounded-inner border border-line bg-card";

function Loading({ what }: { what: string }) {
  return <p className="sr-only">Loading {what}…</p>;
}

// A chart's card: its heading, its one line, then its marks: columns (`up`, one a day) or bars
// along (`along`, one a row), each a height or width from the list.
function ChartSkeleton({
  part,
  marks,
  along,
  wide,
}: {
  part: string;
  marks: readonly string[];
  along?: boolean;
  wide?: boolean;
}) {
  return (
    <span
      data-skeleton-part={part}
      className={`flex flex-col gap-4 p-4 sm:p-6 ${CARD}${wide ? " xl:col-span-2" : ""}`}
    >
      <span className="flex flex-col gap-2">
        <span className={`${BAR} h-5 w-56 max-w-full`} />
        <span className={`${BAR} h-4 w-full max-w-md`} />
      </span>
      {along ? (
        <span className="flex flex-col gap-3">
          {marks.map((w, i) => (
            <span key={i} className="flex items-center gap-3">
              <span className={`${BAR} h-3 w-24 shrink-0`} />
              <span className={`block h-4 animate-wait rounded-row bg-raised ${w}`} />
            </span>
          ))}
        </span>
      ) : (
        <span className="flex h-32 items-end gap-2 border-b border-line">
          {marks.map((h, i) => (
            <span
              key={i}
              className={`block max-w-6 flex-1 animate-wait rounded-t-row bg-raised ${h}`}
            />
          ))}
        </span>
      )}
    </span>
  );
}

const DAYS = ["h-12", "h-20", "h-28", "h-16", "h-24", "h-8", "h-4"] as const;
const FORTNIGHT = [...DAYS, ...DAYS];

export function DashboardSkeleton() {
  return (
    <div aria-busy="true" data-skeleton="">
      <Loading what="the dashboard" />
      <div aria-hidden="true" className="flex flex-col gap-8">
        <div data-skeleton-part="header" className="flex flex-col gap-3">
          <span className={`${BAR} h-4 w-56 max-w-full`} />
          <span className={`${BAR} h-10 w-96 max-w-full`} />
          <span className={`${BAR} h-6 w-48 max-w-full`} />
          <span className={`${BAR} h-5 w-full max-w-xl`} />
        </div>
        <div data-skeleton-part="cards" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`flex flex-col gap-3 p-4 ${CARD}`}>
              <span className="flex items-center justify-between gap-2">
                <span className={`${BAR} h-4 w-24`} />
                <span className="block size-10 animate-wait rounded-row bg-raised" />
              </span>
              <span className={`${BAR} h-10 w-14`} />
              <span className={`${BAR} h-4 w-32 max-w-full`} />
            </span>
          ))}
        </div>
        <div data-skeleton-part="urgent" className="flex flex-col gap-4">
          <span className={`${BAR} h-6 w-56 max-w-full`} />
          <span className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <span key={i} className={`flex flex-col gap-4 p-4 sm:p-6 ${CARD}`}>
                <span className={`${BAR} h-7 w-40`} />
                <span className="flex flex-col gap-2">
                  <span className={`${BAR} h-5 w-36`} />
                  <span className={`${BAR} h-4 w-56 max-w-full`} />
                </span>
                <span className={`${BAR} h-2 w-full`} />
                <span className={`${BAR} h-11 w-full`} />
              </span>
            ))}
          </span>
        </div>
        <span className="grid gap-3 xl:grid-cols-2">
          <ChartSkeleton part="places" marks={FORTNIGHT} wide />
          <ChartSkeleton part="events" marks={["w-3/4", "w-1/2", "w-2/5", "w-1/4"]} along />
          <ChartSkeleton part="offers" marks={["w-full", "w-2/3", "w-1/3"]} along />
          <ChartSkeleton part="waited" marks={["h-24", "h-16", "h-8", "h-12", "h-4"]} />
          <ChartSkeleton part="cancels" marks={FORTNIGHT} />
          <ChartSkeleton part="licences" marks={["w-1/2", "w-1/3", "w-2/3"]} along wide />
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
