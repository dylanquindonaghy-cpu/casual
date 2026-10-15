import type { Metadata } from "next";
import { helpFacts } from "@/lib/portal/help-facts";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { page } from "../ui/classes";
import { HelpView } from "./help-view";

export const metadata: Metadata = { title: "Help" };

// The workers' help page (docs/screens.md `/help`). Open to anyone on the firm's address, logged
// in or not: a worker who can't log in needs it most. It only needs the firm's name (from the
// address; another host gets the not-found page) and its strike and photo numbers (12H.3). The words
// are in help-view.tsx.
export default async function HelpPage() {
  const firm = await getCurrentFirm();
  return (
    <main className={page.staff}>
      <HelpView
        firmName={firm.name}
        facts={await helpFacts(firm.id)}
        year={new Date().getUTCFullYear()}
      />
    </main>
  );
}
