import type { Metadata } from "next";
import { loginTitle, officeLoginCard, page } from "@/app/ui/classes";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { LinkLogin } from "../../l/link-login";
import { consumeClientLinkAction } from "./actions";

// Never tell another site which page this was.
export const metadata: Metadata = { referrer: "no-referrer" };

// The client link login (Phase 36.3; `/client/l#<token>`): the office link page's layout, with
// "Log me in" (a POST: the link is used only when they tap it).
export default async function ClientLinkPage() {
  const firm = await getCurrentFirm();
  return (
    <main className={page.officeLogin}>
      <div className={officeLoginCard}>
        <h1 className={loginTitle}>Log in to your client account</h1>
        <LinkLogin
          firmName={firm.name}
          action={consumeClientLinkAction}
          home="/client"
          newLink="/client/login"
          prompt={`Tap the button to see your events with ${firm.name}.`}
        />
      </div>
    </main>
  );
}
