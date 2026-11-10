import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOfficeSession } from "@/lib/auth/current-office";
import { loginPageFor } from "@/lib/auth/login-page";
import { GUIDE_COPY } from "@/lib/demo/start-copy";
import { officeMenu } from "../../office/office-menu";
import { showsStaffDemo } from "../gate";
import { GuideView } from "./guide-view";

export const metadata: Metadata = { title: GUIDE_COPY.title };

// The quick guide (Phase 31.3; docs/screens.md "Phase 31"): what ShiftDesk is, how it works with
// the firm's planner, and where everything lives. For anyone logged in to the office, on any
// server (it holds no firm data: the office's pages are listed from the person's own menu). On a
// demo server it's linked from "Choose a view", and leads back there.
export default async function QuickGuidePage() {
  const session = await getOfficeSession();
  if (!session) redirect(await loginPageFor("office"));
  const demo = await showsStaffDemo();
  return (
    <GuideView
      menu={officeMenu(session.officeUser.role)}
      back={
        demo
          ? { href: "/start", label: GUIDE_COPY.back }
          : { href: "/office", label: GUIDE_COPY.backToOffice }
      }
    />
  );
}
