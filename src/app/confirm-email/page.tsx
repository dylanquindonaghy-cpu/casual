import type { Metadata } from "next";
import { loginCard, loginTitle, page } from "@/app/ui/classes";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { ConfirmEmail } from "./confirm-email";

// Never tell another site which page this was.
export const metadata: Metadata = { title: "Confirm an email address", referrer: "no-referrer" };

// The strikes team's confirmation link (docs/screens.md `/confirm-email#<token>`; 12B.7): the
// same layout as the login link's page, with "Confirm this address".
export default async function ConfirmEmailPage() {
  const firm = await getCurrentFirm();
  return (
    <main className={page.login}>
      <div className={loginCard}>
        <h1 className={loginTitle}>Confirm an email address for {firm.name}</h1>
        <ConfirmEmail firmName={firm.name} />
      </div>
    </main>
  );
}
