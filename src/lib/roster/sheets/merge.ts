// Who holds a shift, when both the office (in its sheet) and workers (in the portal) can change
// it between two syncs. A three-way merge against `base`, what the sheet's assigned cell held
// after the last successful sync (shifts.synced_holders):
//
// - removed on either side since base: removed (an office removal, or a worker's cancel);
// - added here since base (a booking a worker was already told is confirmed): always kept, even
//   past the headcount (only a person may cancel a confirmed booking, never a merge);
// - added in the sheet since base: booked while places remain; the rest are not booked and
//   reported (a conflict for the office to sort out).
//
// Staff ids (refs) only. Order: the sheet's order first, then new bookings from here.

export interface MergeInput {
  base: readonly string[];
  theirs: readonly string[]; // the sheet now
  ours: readonly string[]; // our live holders now, in slot order
  headcount: number;
}

export interface MergeResult {
  holders: string[];
  notBooked: string[]; // added in the sheet but no place left
}

export function mergeHolders({ base, theirs, ours, headcount }: MergeInput): MergeResult {
  const inBase = new Set(base);
  const inTheirs = new Set(theirs);
  const inOurs = new Set(ours);

  // Still held on both sides since base, or newly booked here.
  const kept = ours.filter((ref) => (inBase.has(ref) ? inTheirs.has(ref) : true));
  const keptSet = new Set(kept);
  let room = Math.max(0, headcount - kept.length);
  const fromSheet: string[] = [];
  const notBooked: string[] = [];
  for (const ref of theirs) {
    if (inBase.has(ref) || keptSet.has(ref) || fromSheet.includes(ref)) continue;
    if (inOurs.has(ref)) continue; // already counted in kept
    if (room > 0) {
      fromSheet.push(ref);
      room -= 1;
    } else {
      notBooked.push(ref);
    }
  }
  const result = new Set([...kept, ...fromSheet]);
  const holders = [
    ...theirs.filter((ref) => result.has(ref)),
    ...kept.filter((ref) => !inTheirs.has(ref)),
  ];
  return { holders: [...new Set(holders)], notBooked };
}

export const sameHolders = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;
