import { casualChip, type Requirement } from "@/lib/credentials/requirements";
import { tag } from "../ui/classes";

// What a session needs, as tags ("SIA door supervisor licence", "CSAS accreditation":
// docs/office-v2.md 4.3, 4.4; 12H.2), by full name. Read out as "Needs: SIA door supervisor
// licence, CSAS accreditation" (the comma is hidden on screen). Phase 28 (28.5): 28.1's `tag`, the
// office's pill of plain facts (the review's "three looks for the same thing"). A shift's own page
// shows none: its "You need" card lists each with her status, so tags there would repeat it.
// Nothing when it needs nothing. A <span> inside a link (Home's cards), a <p> elsewhere.
export function RequirementChips({
  requirements,
  className = "",
  as: Tag = "p",
}: {
  requirements: readonly Requirement[] | undefined;
  className?: string;
  as?: "p" | "span";
}) {
  if (!requirements || requirements.length === 0) return null;
  return (
    <Tag className={`flex flex-wrap gap-2 ${className}`} data-requirements="">
      <span className="sr-only">Needs: </span>
      {requirements.map((r, i) => (
        <span key={r.code} className={tag}>
          {casualChip(r)}
          {i < requirements.length - 1 && <span className="sr-only">,</span>}
        </span>
      ))}
    </Tag>
  );
}
