import Link from "next/link";
import { UPDATES_EMPTY, UPDATES_TITLE } from "@/lib/portal/home-copy";
import type { UpdateRow } from "@/lib/portal/home-board";
import { RECORD_PATH, RECORD_TITLE } from "@/lib/portal/record-copy";
import { btn, emptyBox } from "../ui/classes";
import { HomeCard } from "./home-card";

// "Updates" on Home (Phase 30.1; docs/screens.md "### 30.1"): her latest 5 entries from her shift
// record, newest first (src/lib/portal/home-board.ts updateRows): what happened, the shift, when,
// and one link, "See the shift", while she can open its page; "Your shift record" for the rest.
// Empty: "Nothing new yet." Hook-free.
export function HomeUpdates({ rows, className }: { rows: UpdateRow[]; className?: string }) {
  return (
    <HomeCard
      id="updates"
      title={UPDATES_TITLE}
      count={rows.length}
      link={{ href: RECORD_PATH, label: RECORD_TITLE }}
      className={className}
    >
      {rows.length === 0 ? (
        <p className={emptyBox}>{UPDATES_EMPTY}</p>
      ) : (
        <ul role="list" className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key} data-update="" className="flex flex-col gap-1 px-1 py-3">
              <p className="text-base font-medium text-ink">{r.title}</p>
              <p className="text-sm text-ink-muted">{r.sub}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-muted tabular-nums">{r.when}</p>
                {r.href && (
                  <Link href={r.href} className={btn.small}>
                    {r.link}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}
