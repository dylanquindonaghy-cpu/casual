import { seedId } from "./seed-id";

// The made-up demo firms (src/lib/db/admin/seed-data.ts: Acme Events and Northline Rail Labour),
// by their fixed ids. Demo mode (ADR-025) only ever runs with these: their people, numbers and
// email addresses are all invented, so printing their messages instead of sending them harms no
// one. tests/unit/demo.firms.test.ts keeps this list the same as the seed's.
export const DEMO_FIRM_SLUGS = ["acme", "northline"] as const;

const DEMO_FIRM_IDS: ReadonlySet<string> = new Set(
  DEMO_FIRM_SLUGS.map((slug) => seedId(`firm/${slug}`)),
);

export const isDemoFirm = (firmId: string): boolean => DEMO_FIRM_IDS.has(firmId);

// Whether a page shows demo mode's bar and its Demo phone (16.1; ADR-025): a demo firm's, on a
// demo server. (Any other firm isn't found at all there: src/lib/demo/scope.ts.)
export const showsDemo = (demoMode: string | undefined, firmId: string | null): boolean =>
  demoMode === "on" && firmId !== null && isDemoFirm(firmId);
