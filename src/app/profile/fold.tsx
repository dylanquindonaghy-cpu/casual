import type { ReactNode } from "react";
import { h2, muted, nums, sectionGap, staffCard } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";

// A folded section of Profile (28.11; docs/screens.md "### 28.11"): "Your travel area", "Days you
// can't work", "How we reach you". Shut, it shows its heading and one line of how it stands
// (`state`), with a chevron; a tap anywhere on that line opens it. A native <details>, so it works
// with no JavaScript, and the section keeps its name from its heading (a region, as before).
// `open`: open from the start (How we reach you when texts are off). A link to its heading
// (/profile#notify-heading) opens it too (open-fold.tsx). Hook-free.
export function Fold({
  headingId,
  title,
  state,
  open = false,
  children,
}: {
  headingId: string;
  title: ReactNode;
  state: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={headingId} className={`${staffCard} ${sectionGap.staff}`}>
      <details open={open} data-fold={headingId} className="group">
        {/* The heading sits straight in the summary (a summary holds phrasing content and one
            heading, never a heading inside a span: 28.16), in a two-column grid: the heading and
            its state on the left, the chevron across both rows on the right. */}
        <summary className="press -m-2 grid min-h-13 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-row p-2 hover:bg-active [&::-webkit-details-marker]:hidden">
          <h2 id={headingId} className={`col-start-1 row-start-1 ${h2}`}>
            {title}
          </h2>
          <span className={`col-start-1 row-start-2 mt-0.5 block ${muted} ${nums}`}>{state}</span>
          <Icon
            name="chevron"
            size={22}
            className="col-start-2 row-span-2 row-start-1 rotate-90 text-ink-muted transition-transform group-open:-rotate-90 motion-reduce:transition-none"
          />
        </summary>
        <div className="mt-2">{children}</div>
      </details>
    </section>
  );
}
