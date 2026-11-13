import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { card, h2, headingGap, muted, page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { listClientContacts } from "@/lib/client/contacts";
import { lastInText, LOGINS_INTRO, LOGINS_TITLE } from "@/lib/client/office-copy";
import { officeContracts } from "@/lib/office/contracts";
import { ClientLogins } from "./client-logins";

export const metadata: Metadata = { title: "A contract" };

// A contract's own page (Phase 36.3; the approved mock-up's "A contract's client logins"): its
// name, "Client logins" (who at the client may log in and send requests: ./client-logins.tsx) and
// its venues. Admins only (client_logins, as Settings itself), checked here and in every change. A
// contract that isn't the firm's reads as not found.
export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { firm, officeUser } = await requireOfficeArea("client_logins");
  const ctx = { firm, officeUserId: officeUser.id };
  const [contracts, logins] = await Promise.all([
    officeContracts(ctx),
    listClientContacts(ctx, id),
  ]);
  const contract = contracts?.contracts.find((c) => c.clientId === id);
  if (!contracts || !contract || logins.status !== "ok") notFound();
  const venues = contracts.sites.filter((s) => s.clientId === id);
  const now = new Date();
  return (
    <main className={page.officeForm}>
      <PageHeader
        back={{ href: "/office/settings#contracts", label: "Settings" }}
        title={contract.name}
      >
        <p className={muted}>A contract: its client logins and venues.</p>
      </PageHeader>

      <section aria-labelledby="client-logins">
        <h2 id="client-logins" className={h2}>
          {LOGINS_TITLE}
        </h2>
        <p className={`${muted} mt-1 max-w-prose`}>{LOGINS_INTRO}</p>
        <div className={headingGap}>
          <ClientLogins
            contractId={id}
            logins={logins.contacts.map((c) => ({
              id: c.id,
              name: c.name,
              email: c.email,
              isOn: c.isOn,
              lastIn: lastInText(c.lastLoginAt, now, firm.timezone),
            }))}
          />
        </div>
      </section>

      <section aria-labelledby="its-venues" className={sectionGap.office}>
        <h2 id="its-venues" className={h2}>
          Its venues
        </h2>
        <p className={`${card} ${headingGap}`}>
          {venues.length === 0
            ? "No venues yet. Tick them on Settings."
            : venues.map((v) => v.name).join(", ")}
        </p>
      </section>
    </main>
  );
}
