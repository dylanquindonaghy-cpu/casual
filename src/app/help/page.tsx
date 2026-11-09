import type { Metadata } from "next";
import { helpFacts } from "@/lib/portal/help-facts";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { HelpTourAgain } from "../casual-tour";
import { page } from "../ui/classes";
import { HelpView } from "./help-view";

export const metadata: Metadata = { title: "Help" };

// The workers' help page (docs/screens.md `/help`). Open to anyone on the firm's address, logged
// in or not: a worker who can't log in needs it most. It only needs the firm's name (from the
// address; another host gets the not-found page) and its strike and photo numbers (12H.3). The words
// are in help-view.tsx; the firm's rules for taking shifts come from its settings through the rules' own
// parsers (28.12, src/lib/portal/help-facts.ts). "Take the tour again" (Phase 33.3) shows for a
// logged-in casual only, asked for by the browser once the page is showing (HelpTourAgain), so the
// page itself still reads no session.
export default async function HelpPage() {
  const firm = await getCurrentFirm();
  return (
    <main className={page.staff}>
      <HelpView
        firmName={firm.name}
        facts={await helpFacts(firm.id)}
        year={new Date().getUTCFullYear()}
        tourAgain={<HelpTourAgain />}
      />
    </main>
  );
}
