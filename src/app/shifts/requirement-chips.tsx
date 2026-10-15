import { requirementChip, type Requirement } from "@/lib/credentials/requirements";

// What a session needs, as chips ("SIA DS", "CSAS": docs/office-v2.md 4.3, 4.4; 12H.2), in the
// office's own short names. Read out as "Needs: SIA DS, CSAS" (the comma is hidden on screen).
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
        <span
          key={r.code}
          className="rounded-full border border-transparent bg-quiet-soft px-2 py-0.5 text-sm font-semibold text-quiet-ink"
        >
          {requirementChip(r)}
          {i < requirements.length - 1 && <span className="sr-only">,</span>}
        </span>
      ))}
    </Tag>
  );
}
