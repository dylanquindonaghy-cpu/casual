import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginTitle, officeLoginCard, page } from "@/app/ui/classes";
import { getClientSession } from "@/lib/client/current-client";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { ClientLoginForm } from "./client-login-form";

export const metadata: Metadata = { referrer: "no-referrer" };

// The client login (Phase 36.3; docs/screens.md "## Phase 36"): the office login's layout and
// rules, in the mock-up's words. Someone already logged in goes to their events.
export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ out?: string }>;
}) {
  const firm = await getCurrentFirm();
  if (await getClientSession()) redirect("/client");
  const { out } = await searchParams;
  return (
    <main className={page.officeLogin}>
      <div className={officeLoginCard}>
        <h1 className={loginTitle}>Log in to your client account</h1>
        <p className="mt-2 text-ink-muted">
          For {firm.name}&apos;s clients. Type your work email and we&apos;ll send you a login link.
        </p>
        {out === "1" && (
          <p
            role="status"
            className="mt-4 rounded-row border border-line bg-quiet-soft p-4 text-ink"
          >
            You&apos;re logged out.
          </p>
        )}
        <ClientLoginForm firmName={firm.name} signOff={firm.signOff} />
        <p className="mt-4 text-ink-muted">
          Not set up yet? Ask your contact at {firm.name} to add you.
        </p>
      </div>
    </main>
  );
}
