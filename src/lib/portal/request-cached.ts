import { cache } from "react";
import { openShiftsFor, type OpenShiftsList } from "./open-shifts";
import { tabCounts, type TabCounts } from "./tab-counts";

// What more than one part of a casual page reads, read once per request (Phase 32; the guardrails
// review): the top bar's counts (src/app/casual-top-bar.tsx) and the tab bar's
// (src/app/casual-tab-bar.tsx) are the same tabCounts(); the top bar's "Open to you" and "Urgent"
// come from the same unfiltered openShiftsFor() list Open shifts shows. React's cache() keys on the
// arguments, so they're plain values (the firm's id, her id), never objects. The same loaders and
// the same rules (golden rule 1), inside her firm (withFirm): nothing changes but how often they
// run. Outside a request (the tests) each call simply runs. Server only.

export const openShiftsNow = cache((firmId: string, workerId: string): Promise<OpenShiftsList> =>
  openShiftsFor({ firm: { id: firmId } }, workerId),
);

export const tabCountsNow = cache((firmId: string, workerId: string): Promise<TabCounts> =>
  tabCounts({ firm: { id: firmId } }, workerId),
);
