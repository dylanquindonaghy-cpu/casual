import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { attentionOf, officeNeedsAttention } from "@/lib/office/dashboard";
import { SECTION_ERROR, SECTIONS } from "@/lib/office/dashboard-copy";
import { meta, page } from "../../ui/classes";
import { PageHeader } from "../../ui/page-header";
import { AlsoNeedsYou, NeedsItems, needsPageLine } from "../needs-items";

export const metadata: Metadata = { title: "Needs attention" };

// Needs attention (docs/office-v2.md 3.2; docs/screens.md `/office/needs-attention`; Phases 18 and
// 20): every to-do the dashboard counts, in full, each with what to do about it, and the
// enquiries that need a person; beside them "Also needs you", the urgent places still to fill, so
// this page's count and the dashboard's add up. The menu's "Needs attention" opens it, with the
// same count. Admins and resourcers, as the dashboard; payroll goes to the pay dashboard.
export default async function NeedsAttentionPage() {
  const { firm, officeUser } = await requireOfficeArea("dashboard");
  if (!canAccess(officeUser.role, "today")) redirect("/office/pay");
  const data = await officeNeedsAttention({ firm, officeUserId: officeUser.id });
  if (!data) notFound();
  const needPerson = data.needPerson.ok ? data.needPerson.data : 0;
  const count = attentionOf(data.needs, data.needPerson);
  return (
    <main className={page.office}>
      <PageHeader
        back={{ href: "/office", label: "Dashboard" }}
        title={SECTIONS.needs.heading}
        titleId="needs-attention"
      >
        <p className={meta}>{needsPageLine(count)}</p>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          {data.needs.ok ? (
            <NeedsItems
              n={data.needs.data}
              timeZone={data.timeZone}
              today={data.today}
              isAdmin={officeUser.role === "admin"}
              needPerson={needPerson}
            />
          ) : (
            <p
              role="status"
              className="rounded-row border border-attention-line bg-attention-soft px-4 py-3 text-attention-ink shadow-soft"
            >
              {SECTION_ERROR}
            </p>
          )}
        </div>
        <AlsoNeedsYou urgent={data.urgent.ok ? data.urgent.data : null} timeZone={data.timeZone} />
      </div>
    </main>
  );
}
