import { describe, expect, it, vi } from "vitest";
import type { WithFirm } from "@/lib/db/scoped";
import { offerWorkerDeps } from "@/lib/offers/waves";

// The worker's own wiring for offer waves (12G.2): before a session's first wave, its travel
// estimates are filled through the travel service's function, loaded only in the worker. The
// wave's logic is tested with its own deps (tests/integration/travel.estimates.test.ts "before an
// urgent session's first wave"); this checks the deps the worker really runs with.

const { estimatesBeforeWave } = vi.hoisted(() => ({
  estimatesBeforeWave: vi.fn(async () => undefined),
}));
vi.mock("@/lib/travel/estimates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/travel/estimates")>()),
  estimatesBeforeWave,
}));

describe("the worker's offer-wave deps", () => {
  it("fill a session's travel estimates before its first wave, with estimatesBeforeWave", async () => {
    const deps = offerWorkerDeps();
    expect(deps.travelBeforeFirstWave).toBeTypeOf("function");
    const run = (() => {
      throw new Error("not used: the travel service's function is a stand-in here");
    }) as unknown as WithFirm;
    await deps.travelBeforeFirstWave?.(run, "firm-a", "shift-a");
    expect(estimatesBeforeWave).toHaveBeenCalledTimes(1);
    expect(estimatesBeforeWave).toHaveBeenCalledWith(run, "firm-a", "shift-a");
  });
});
