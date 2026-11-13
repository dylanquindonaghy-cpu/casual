import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginCard, loginTitle, page } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { staffLoginAfterRedirect } from "@/lib/auth/login-page";
import { firmLoginWay } from "@/lib/portal/login-way";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

// Log in (docs/screens.md, `/login`). Its tab reads "Log in · Acme Events shifts" (Phase 37.6,
// w1-09). The same layout as the other three login pages (/l, /office/login,
// /office/l; docs/ui-design.md "Shared components"): the brand bar's 448px column, a card framed
// from 640px up (on a phone the page is the card).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ out?: string; again?: string }>;
}) {
  const firm = await getCurrentFirm();
  if (await getWorkerSession()) redirect("/");
  const { out, again } = await searchParams;
  // Sent here by a redirect (Log out, or an action that found the session gone) on the staffing
  // demo: on to its login (Phase 34). Opened by address, this page shows.
  const staff = staffLoginAfterRedirect("worker", firm.id, { out, again });
  if (staff) redirect(staff);
  return (
    <main className={page.login}>
      <div className={loginCard}>
        <h1 className={loginTitle}>Log in to {firm.name}</h1>
        {/* A quiet slip (28.1's part; 28.12). */}
        {out === "1" && (
          <Slip tone="quiet" role="status" className="mt-4">
            <p>You&apos;re logged out.</p>
          </Slip>
        )}
        <LoginForm firmName={firm.name} signOff={firm.signOff} way={await firmLoginWay(firm.id)} />
      </div>
    </main>
  );
}
