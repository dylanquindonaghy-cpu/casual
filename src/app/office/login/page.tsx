import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginTitle, officeLoginCard, page } from "@/app/ui/classes";
import { getOfficeSession } from "@/lib/auth/current-office";
import { staffLoginAfterRedirect } from "@/lib/auth/login-page";
import { staffDemoOn } from "@/lib/demo/staff-login";
import { appEnv } from "@/lib/env";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { StaffDemoLink } from "../../start/staff-demo-link";
import { OfficeLoginForm } from "./office-login-form";

// Its tab: "Office login · Acme Events shifts" (Phase 37.6, w1-09).
export const metadata: Metadata = { title: "Office login" };

// The office login (docs/screens.md `/office/login`). Outside the office shell (nobody is logged
// in yet): the same layout as the worker login (/login): the brand bar's 448px column, so its words
// start under the firm's name, and a card framed from 640px up (on a phone the page is the card,
// with the same 24px edge as the bar). The firm's name in the heading, the email field, one button.
// "You're logged out." a pale grey slip with its hairline, as an answer is (Phase 23, flat).
export default async function OfficeLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ out?: string }>;
}) {
  const firm = await getCurrentFirm();
  if (await getOfficeSession()) redirect("/office");
  const { out } = await searchParams;
  // Sent here by "Log out" on the staffing demo: on to its login (Phase 34). Opened by address,
  // this page shows.
  const staff = staffLoginAfterRedirect("office", firm.id, { out });
  if (staff) redirect(staff);
  return (
    <main className={page.officeLogin}>
      <div className={officeLoginCard}>
        <h1 className={loginTitle}>Office login for {firm.name}</h1>
        {out === "1" && (
          <p
            role="status"
            className="mt-4 rounded-row border border-line bg-quiet-soft p-4 text-ink"
          >
            You&apos;re logged out.
          </p>
        )}
        <OfficeLoginForm firmName={firm.name} signOff={firm.signOff} />
        {/* On a demo server, the staffing demo's own login (Phase 31.1). */}
        {staffDemoOn(appEnv().DEMO_MODE, firm.id) && <StaffDemoLink className="mt-4" />}
      </div>
    </main>
  );
}
