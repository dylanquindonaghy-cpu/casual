import Link from "next/link";
import {
  AREA_PROMPT,
  AREA_PROMPT_LINK,
  FURTHER_LINK,
  furtherText,
  TRAVEL_PATH,
} from "@/lib/portal/travel-copy";
import type { OpenShiftsList } from "@/lib/portal/open-shifts";
import { btn, muted } from "../../ui/classes";

// The travel area's notes on Open shifts and the urgent board (docs/office-v2.md 4.3; 12G.3): with
// no area, a prompt to add one (the list is unfiltered); with one, how many more shifts are further
// than she travels, and a link to change how far. Neither where the firm has travel areas off (13.4).

export function AreaPrompt({ list }: { list: OpenShiftsList }) {
  if (!list.travelOn || list.area) return null;
  return (
    <div className="mb-6 rounded-xl bg-quiet-soft p-4">
      <p>{AREA_PROMPT}</p>
      <Link href={TRAVEL_PATH} className={btn.link}>
        {AREA_PROMPT_LINK}
      </Link>
    </div>
  );
}

export function FurtherNote({ list, urgent = false }: { list: OpenShiftsList; urgent?: boolean }) {
  if (!list.area || list.further.count === 0) return null;
  return (
    <p className={`mt-4 ${muted}`}>
      {furtherText(list.further, urgent)}{" "}
      <Link href={TRAVEL_PATH} className={btn.link}>
        {FURTHER_LINK}
      </Link>
    </p>
  );
}
