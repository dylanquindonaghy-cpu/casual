import { redirect } from "next/navigation";
import { loginTitle, officeLoginCard, page } from "@/app/ui/classes";
import { getOfficeSession } from "@/lib/auth/current-office";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { OfficeLoginForm } from "./office-login-form";

// The office login (docs/screens.md `/office/login`). Outside the office shell (nobody is logged
// in yet): the same layout as the worker login (/login): the brand bar's 448px column, so its words
// start under the firm's name, and a card framed from 640px up (on a phone the page is the card,
// with the same 24px edge as the bar). The firm's name in the heading, the email field, one button.
export default async function OfficeLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ out?: string }>;
}) {
  const firm = await getCurrentFirm();
  if (await getOfficeSession()) redirect("/office");
  const { out } = await searchParams;
  return (
    <main className={page.officeLogin}>
      <div className={officeLoginCard}>
        <h1 className={loginTitle}>Office login for {firm.name}</h1>
        {out === "1" && (
          <p role="status" className="mt-4 rounded-row bg-card p-4 text-ink shadow-raise">
            You&apos;re logged out.
          </p>
        )}
        <OfficeLoginForm firmName={firm.name} signOff={firm.signOff} />
      </div>
    </main>
  );
}
