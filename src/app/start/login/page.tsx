import type { Metadata } from "next";
import { loginTitle, officeLoginCard, page } from "@/app/ui/classes";
import { LOGIN_COPY } from "@/lib/demo/start-copy";
import { staffDemoFirm } from "../gate";
import { StaffLoginForm } from "./staff-login-form";

export const metadata: Metadata = { title: LOGIN_COPY.title };

// The staffing demo login (Phase 31.1; docs/screens.md "Phase 31"): only on a demo server, on Acme
// Events; anywhere else the not-found page. The office login's layout: its card, one heading, the
// two fields and one button. Already logged in, it still shows (so another account can be used).
export default async function StaffLoginPage() {
  await staffDemoFirm();
  return (
    <main className={page.officeLogin}>
      <div className={officeLoginCard}>
        <h1 className={loginTitle}>{LOGIN_COPY.title}</h1>
        <p className="mt-2 text-ink-muted">{LOGIN_COPY.intro}</p>
        <StaffLoginForm />
      </div>
    </main>
  );
}
