import { notFound, redirect } from "next/navigation";
import { getOfficeSession } from "@/lib/auth/current-office";
import { staffDemoOn } from "@/lib/demo/staff-login";
import { appEnv } from "@/lib/env";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// The staffing demo's pages exist only on a demo server, on the demo firm the login opens (Acme
// Events): anywhere else they're the not-found page, as if they weren't there (Phase 31). For pages;
// the actions check the same themselves (src/lib/demo/staff-session.ts).
export async function staffDemoFirm() {
  const firm = await getCurrentFirm();
  if (!staffDemoOn(appEnv().DEMO_MODE, firm.id)) notFound();
  return firm;
}

// The same, and someone logged in to the office (the staffing login, or any office login there).
export async function staffDemoOffice() {
  await staffDemoFirm();
  const session = await getOfficeSession();
  if (!session) redirect("/start/login");
  return session;
}

// Whether this page shows the staffing demo's links (the Demo phone, the office login): the same
// check, without the not-found page.
export async function showsStaffDemo(): Promise<boolean> {
  const firm = await getCurrentFirm();
  return staffDemoOn(appEnv().DEMO_MODE, firm.id);
}
