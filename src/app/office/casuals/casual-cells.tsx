import { meta, nums } from "@/app/ui/classes";
import { StatusChip } from "@/app/ui/status-chip";
import type { CasualRow } from "@/lib/office/casuals";
import { roleLabel } from "@/lib/portal/format";
import { qualificationTitle, STATUS_TONES, STATUS_WORDS } from "@/lib/portal/qualification-copy";
import { OFFICE_PHOTO_WORDS, PHOTO_TONES } from "@/lib/portal/upload-copy";
import { shortDate } from "@/lib/rules/reasons";

// Two cells of the Casuals list (src/app/office/casuals/page.tsx; docs/screens.md
// `/office/casuals`; Phase 17): colour only for a problem, so the rows that need someone stand out.

// Their staff photo: when it was taken and its status. Up to date: quiet words. Missing (most rows of
// a new firm): a small amber dot and the word. Due soon, overdue, waiting for a check: a tag.
export function PhotoCell({ row, year }: { row: CasualRow; year: number }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {row.photo.current && (
        <span className={nums}>{shortDate(row.photo.current.uploadedOn, year)}</span>
      )}
      {row.photo.status === "up_to_date" ? (
        <span className="text-sm text-ink-muted">{OFFICE_PHOTO_WORDS.up_to_date}</span>
      ) : row.photo.status === "missing" ? (
        // Most rows of a new firm say this: a small dot and words, not a tag on every row.
        <span className="inline-flex items-center gap-1.5 text-sm text-ink">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-attention" />
          {OFFICE_PHOTO_WORDS.missing}
        </span>
      ) : (
        <StatusChip tone={PHOTO_TONES[row.photo.status]}>
          {OFFICE_PHOTO_WORDS[row.photo.status]}
        </StatusChip>
      )}
    </span>
  );
}

// Each qualification, the worst first: a tag only when something's wrong or coming up; a valid one
// as quiet words (Phase 17: the problems stand out, a list of green tags doesn't).
export function Tags({ row }: { row: CasualRow }) {
  if (row.qualifications.length === 0) {
    return (
      <span className={meta}>
        {row.rolesWithoutRule.length > 0
          ? `No rule for ${row.rolesWithoutRule.map(roleLabel).join(", ")}`
          : "None needed"}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-1">
      {row.qualifications.map((q) =>
        q.status === "valid" ? (
          <span key={q.type} className="text-sm text-ink-muted">
            {`${qualificationTitle(q.name)}: ${STATUS_WORDS[q.status]}`}
          </span>
        ) : (
          <StatusChip key={q.type} tone={STATUS_TONES[q.status]}>
            {`${qualificationTitle(q.name)}: ${STATUS_WORDS[q.status]}`}
          </StatusChip>
        ),
      )}
    </span>
  );
}
