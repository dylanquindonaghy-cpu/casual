import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { officeNeedsAttention } from "@/lib/office/dashboard";
import { SECTION_ERROR, SECTIONS } from "@/lib/office/dashboard-copy";
import { meta, page } from "../../ui/classes";
import { PageHeader } from "../../ui/page-header";
import { NeedsItems } from "../needs-items";

export const metadata: Metadata = { title: "Needs attention" };

// Needs attention (docs/office-v2.md 3.2; docs/screens.md `/office/needs-attention`; Phase 18): every
// to-do the dashboard's "After that" counts, in full, each with what to do about it. The bell in
// the top bar opens it. Admins and resourcers, as the dashboard; payroll goes to the pay dashboard.
export default async function NeedsAttentionPage() {
  const { firm, officeUser } = await requireOfficeArea("dashboard");
  if (!canAccess(officeUser.role, "today")) redirect("/office/pay");
  const data = await officeNeedsAttention({ firm, officeUserId: officeUser.id });
  if (!data) notFound();
  return (
    <main className={page.office}>
      <PageHeader
        back={{ href: "/office", label: "Dashboard" }}
        title={SECTIONS.needs.heading}
        titleId="needs-attention"
      >
        <p className={meta}>{SECTIONS.needs.hint}</p>
      </PageHeader>
      {data.needs.ok ? (
        <NeedsItems
          n={data.needs.data}
          timeZone={data.timeZone}
          today={data.today}
          isAdmin={officeUser.role === "admin"}
        />
      ) : (
        <p role="status" className="rounded-lg bg-attention-soft px-3 py-2 text-attention-ink">
          {SECTION_ERROR}
        </p>
      )}
    </main>
  );
}
