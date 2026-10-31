import { redirect } from "next/navigation";
import { loginCard, loginTitle, page } from "@/app/ui/classes";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { firmLoginWay } from "@/lib/portal/login-way";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { LoginForm } from "./login-form";

// Log in (docs/screens.md, `/login`). No page title of its own: the tab keeps the firm's plain title
// ("Acme Events shifts"). The same layout as the other three login pages (/l, /office/login,
// /office/l; docs/ui-design.md "Shared components"): the brand bar's 448px column, a card framed
// from 640px up (on a phone the page is the card).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ out?: string }>;
}) {
  const firm = await getCurrentFirm();
  if (await getWorkerSession()) redirect("/");
  const { out } = await searchParams;
  return (
    <main className={page.login}>
      <div className={loginCard}>
        <h1 className={loginTitle}>Log in to {firm.name}</h1>
        {out === "1" && (
          <p
            role="status"
            className="mt-4 rounded-lg border border-line bg-quiet-soft p-4 text-quiet-ink"
          >
            You&apos;re logged out.
          </p>
        )}
        <LoginForm firmName={firm.name} signOff={firm.signOff} way={await firmLoginWay(firm.id)} />
      </div>
    </main>
  );
}
