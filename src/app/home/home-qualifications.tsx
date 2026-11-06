import Link from "next/link";
import { QUALS_ALL, QUALS_PATH, QUALS_TITLE } from "@/lib/portal/home-copy";
import type { QualRow } from "@/lib/portal/home-board";
import { StatusChip } from "../ui/status-chip";
import { Bar, HomeCard } from "./home-card";

// "Your qualifications" on Home (Phase 30.1; docs/screens.md "### 30.1"): one row each, worst first
// then the soonest expiry (src/lib/portal/home-board.ts qualificationRows): its name, its status
// pill, a bar for one with an expiry date (time left, full at 2 years), and a line under it; her
// staff photo and her right to work as rows too. Each row is a link, at least 44px tall, to its
// place on Profile, or its upload page where there's something for her to upload. Shown in the
// kept copy too (its notice says when it was saved). Hook-free.
export function HomeQualifications({ rows, className }: { rows: QualRow[]; className?: string }) {
  return (
    <HomeCard
      id="quals"
      title={QUALS_TITLE}
      count={rows.length}
      link={{ href: QUALS_PATH, label: QUALS_ALL }}
      className={className}
    >
      <ul role="list" className="-mx-1 flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.key} data-qual={r.kind}>
            <Link
              href={r.href}
              className="press flex min-h-11 flex-col gap-1.5 rounded-row px-1 py-3 hover:bg-active focus-visible:-outline-offset-2"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-base font-medium text-ink">{r.title}</span>
                <StatusChip tone={r.pill.tone}>{r.pill.words}</StatusChip>
              </span>
              {r.bar !== null && (
                <Bar
                  fill={r.bar}
                  tone={
                    r.pill.tone === "urgent" || r.pill.tone === "attention" ? r.pill.tone : "done"
                  }
                />
              )}
              {(r.line || r.action) && (
                <span className="text-sm text-ink-muted">
                  {r.line}
                  {r.line && r.action ? " · " : ""}
                  {r.action && (
                    <span className="font-semibold text-brand-ink underline underline-offset-4">
                      {r.action}
                    </span>
                  )}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
