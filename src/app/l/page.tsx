import type { Metadata } from "next";
import { loginCard, loginTitle, page } from "@/app/ui/classes";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { LinkLogin } from "./link-login";

// Never tell another site which page this was.
export const metadata: Metadata = { referrer: "no-referrer" };

// The login link's page: the same layout as /login (the brand bar's 448px column, a card framed
// from 640px up).
export default async function LinkPage() {
  const firm = await getCurrentFirm();
  return (
    <main className={page.login}>
      <div className={loginCard}>
        <h1 className={loginTitle}>Log in to {firm.name}</h1>
        <LinkLogin firmName={firm.name} />
      </div>
    </main>
  );
}
