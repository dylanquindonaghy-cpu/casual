import type { Metadata } from "next";
import { loginCard, loginTitle, page } from "@/app/ui/classes";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { LinkLogin } from "../../l/link-login";
import { consumeOfficeLinkAction } from "./actions";

// Never tell another site which page this was.
export const metadata: Metadata = { referrer: "no-referrer" };

// The office link login (docs/screens.md `/office/l#<token>`): the same layout as the other login
// pages (src/app/office/login/page.tsx), with the firm's name in the heading and "Log me in".
export default async function OfficeLinkPage() {
  const firm = await getCurrentFirm();
  return (
    <main className={page.login}>
      <div className={loginCard}>
        <h1 className={loginTitle}>Log in to the {firm.name} office</h1>
        <LinkLogin
          firmName={firm.name}
          action={consumeOfficeLinkAction}
          home="/office"
          newLink="/office/login"
          prompt={`Tap the button to log in to the ${firm.name} office.`}
        />
      </div>
    </main>
  );
}
