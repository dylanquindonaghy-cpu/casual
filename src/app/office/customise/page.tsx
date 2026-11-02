import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { officeMyDashboard } from "@/lib/office/contracts";
import { BACK_TO_DASHBOARD, CUSTOMISE_TITLE } from "@/lib/office/customise-copy";
import { btn, page } from "../../ui/classes";
import { PageHeader } from "../../ui/page-header";
import { CustomiseForm } from "../customise-panel";

export const metadata: Metadata = { title: "Customise" };

// Customise as a page of its own (Phase 26.3; docs/screens.md "Customise"): what the dashboard's
// "Customise" opens until the page is ready, or with a modifier key. The same form as the panel;
// saved, "Back to the dashboard" shows it.
export default async function CustomisePage() {
  const { firm, officeUser } = await requireOfficeArea("today");
  const me = await officeMyDashboard({ firm, officeUserId: officeUser.id });
  if (!me) notFound();
  return (
    <main className={`${page.officeForm} @container`}>
      <PageHeader title={CUSTOMISE_TITLE} />
      <CustomiseForm me={me} />
      <Link href="/office" className={`${btn.secondary} mt-8 self-start`}>
        {BACK_TO_DASHBOARD}
      </Link>
    </main>
  );
}
