import { StatusChip } from "@/app/ui/status-chip";
import type { CasualRow } from "@/lib/office/casuals";
import { blocksBooking, photoCell, qualificationLine } from "@/lib/office/casuals-copy";
import { roleLabel } from "@/lib/portal/format";
import { STATUS_TONES } from "@/lib/portal/qualification-copy";

// Two cells of the Casuals list (src/app/office/casuals/page.tsx; docs/screens.md
// `/office/casuals`; Phase 17; Phase 24, 24.4: round 7's words): colour only for a problem, so the
// rows that need someone stand out.

// Their staff photo: its state ("Up to date" in words; a missing one, most rows of a new firm, a
// small amber dot and the word; due soon, overdue, waiting for a check: a tag), and under it the
// date it was taken (or sent, while it waits for a check).
export function PhotoCell({ row, year }: { row: CasualRow; year: number }) {
  const cell = photoCell(row.photo, year);
  return (
    <span className="flex flex-col items-start gap-1">
      {cell.tone === null ? (
        <span className="text-sm text-ink">{cell.words}</span>
      ) : row.photo.status === "missing" ? (
        // Most rows of a new firm say this: a small dot and words, not a tag on every row.
        <span className="inline-flex items-center gap-2 text-sm text-ink">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-attention" />
          {cell.words}
        </span>
      ) : (
        <StatusChip tone={cell.tone}>{cell.words}</StatusChip>
      )}
      {cell.date && <span className="text-sm text-ink-muted tabular-nums">{cell.date}</span>}
    </span>
  );
}

// Each qualification, the worst first, with its date ("SIA DS: valid until 12 May 2027"): a tag
// only when something's wrong or coming up ("SIA SG: expires 14 Nov", "(booked shift)" when it
// stops one); a valid one as plain words (Phase 17: the problems stand out, a list of green tags
// doesn't).
export function Tags({ row, year }: { row: CasualRow; year: number }) {
  if (row.qualifications.length === 0) {
    return (
      <span className="text-sm text-ink-muted">
        {row.rolesWithoutRule.length > 0
          ? `No rule for ${row.rolesWithoutRule.map(roleLabel).join(", ")}`
          : "None needed"}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-1">
      {row.qualifications.map((q) => {
        const words = qualificationLine(q, year, blocksBooking(row.needs, q.type));
        return q.status === "valid" ? (
          <span key={q.type} className="text-sm text-ink tabular-nums">
            {words}
          </span>
        ) : (
          <StatusChip key={q.type} tone={STATUS_TONES[q.status]}>
            {words}
          </StatusChip>
        );
      })}
    </span>
  );
}
