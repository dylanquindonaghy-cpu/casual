import { page } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireClient } from "@/lib/client/current-client";

// The client's home (Phase 36.3): who's logged in and for which contract. A stand-in until the
// client's pages are built (their events in numbers, their requests: docs/screens.md "## Phase
// 36"); it shows nothing about casuals.
export default async function ClientHomePage() {
  const s = await requireClient();
  return (
    <main className={page.officeLogin}>
      <PageHeader title={`Your events with ${s.firm.name}`}>
        <p className="text-ink-muted">
          Logged in as {s.contact.name}, {s.contact.contractName}.
        </p>
      </PageHeader>
    </main>
  );
}
