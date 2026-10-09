import { createHash } from "node:crypto";

// Allocation mode (docs/api-and-jobs.md, "Offer-wave ranking"; docs/product-spec.md P1-6): per
// firm, first come, first served, or fair rotation (fewest confirmed hours this week first).
// Pure functions: the loader (src/lib/roster/allocation-input.ts) reads the numbers, these decide.
//
// On the Open shifts board, fair rotation holds a newly opened place for the workers with the
// fewest hours that week (the `groupSize` fewest, ties included) for `priorityMinutes`; after that
// anyone eligible can take it. First come, first served never holds anything. The rules engine
// has already said the worker may take the shift; this only decides whether it's their turn.

export const ALLOCATION_MODES = ["first_come_first_served", "fair_rotation"] as const;
export type AllocationMode = (typeof ALLOCATION_MODES)[number];

const MINUTE = 60_000;

// The hours of the k-th fewest (ties with it are in the group too). Null when nobody's counted.
export function fairRotationCutoff(hours: number[], groupSize: number): number | null {
  if (hours.length === 0 || groupSize < 1) return null;
  const sorted = [...hours].sort((a, b) => a - b);
  return sorted[Math.min(groupSize, sorted.length) - 1] ?? null;
}

export type AllocationGate = { ok: true } | { ok: false; opensAt: Date };

export function allocationGate(input: {
  mode: AllocationMode;
  now: Date;
  openedAt: Date; // when the place opened: the shift's creation, or its latest cancellation
  priorityMinutes: number;
  workerHours: number; // this worker's confirmed hours in the shift's week
  cutoffHours: number | null; // fairRotationCutoff over the workers who could want it
}): AllocationGate {
  if (input.mode === "first_come_first_served") return { ok: true };
  const opensAt = new Date(input.openedAt.getTime() + input.priorityMinutes * MINUTE);
  if (input.now.getTime() >= opensAt.getTime()) return { ok: true };
  if (input.cutoffHours === null || input.workerHours <= input.cutoffHours) return { ok: true };
  return { ok: false, opensAt };
}

// The order the offer waves (Phase 4) will send in under fair rotation: fewest hours this week,
// then longest since their last offer (never offered first), then a tie break. With a `seed` (the
// waves pass the shift and wave), the tie break is a shuffle fixed by that seed: the same wave
// always gives the same order, but which of the tied workers comes first changes from shift to
// shift, so the lowest ids don't always win (Phase 10 task 19, audit L18; the spec said "random").
// Without one, it's by worker id.
export interface RotationCandidate {
  workerId: string;
  hoursThisWeek: number;
  lastOfferedAt: Date | null;
}

export function rankForFairRotation<C extends RotationCandidate>(
  candidates: C[],
  seed?: string,
): C[] {
  const offered = (c: C) => c.lastOfferedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const draw = (c: C) =>
    seed === undefined
      ? c.workerId
      : createHash("sha256").update(`${seed}:${c.workerId}`).digest("hex");
  return [...candidates].sort(
    (a, b) =>
      a.hoursThisWeek - b.hoursThisWeek ||
      offered(a) - offered(b) ||
      draw(a).localeCompare(draw(b)) ||
      a.workerId.localeCompare(b.workerId),
  );
}
