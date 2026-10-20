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

// What demo mode does on an address (16.1; ADR-025): a demo firm's pages get the demo bar and the
// Demo phone; any other firm's aren't served at all on a demo server (src/app/layout.tsx), so demo
// mode never runs a real firm's pages; the platform's own address (no firm) and every page
// without demo mode are as usual.
export type DemoView = "off" | "demo" | "refused";

export function demoViewFor(demoMode: string | undefined, firmId: string | null): DemoView {
  if (demoMode !== "on" || firmId === null) return "off";
  return isDemoFirm(firmId) ? "demo" : "refused";
}
