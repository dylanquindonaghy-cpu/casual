import Link from "next/link";
import { COUNTS_LABEL } from "@/lib/portal/home-copy";
import type { CountPill } from "@/lib/portal/home-board";
import { countChip, countChipNumber, countChips } from "../ui/classes";

// Home's counts under "Hi Zoe" (Phase 30.1; docs/screens.md "### 30.1"), in the office's top-bar
// chips: Booked, Open to you, Urgent (its number red), To do (its number on the amber to-do pill),
// Messages. Each a link 44px tall to the page it counts, read as "Open to you 10". The row scrolls
// sideways inside itself on a narrow phone, never the page. A count that goes stale without signal
// is online only (the kept copy leaves it out). Hook-free.
export function HomeCounts({ pills }: { pills: CountPill[] }) {
  return (
    <ul role="list" aria-label={COUNTS_LABEL} data-home-counts="" className={countChips}>
      {pills.map((p) => (
        <li key={p.key} {...(p.onlineOnly ? { "data-online-only": "" } : {})} className="flex">
          <Link href={p.href} data-count={p.key} className={countChip}>
            {p.label} <b className={countChipNumber[p.tone]}>{p.count}</b>
          </Link>
        </li>
      ))}
    </ul>
  );
}
