import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { systemClock } from "@/lib/auth/clock";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeShiftForm } from "@/lib/office/shift-pages";
import { localDateOf } from "@/lib/time/zoned";
import { ShiftCreateForm } from "../shift-create-form";

export const metadata: Metadata = { title: "New shift" };

// "New shift" (docs/screens.md `/office/shifts`). Admins and resourcers.
export default async function Page() {
  const { firm } = await requireOfficeArea("shifts");
  const form = await officeShiftForm({ firm }, (await readSessionToken("office")) ?? "");
  if (!form) notFound();
  return (
    <main className={page.officeForm}>
      <PageHeader eyebrow={`${firm.name} office`} title="New shift" />
      <ShiftCreateForm
        mode="single"
        sites={form.sites}
        roles={form.roles}
        qualifications={form.qualifications}
        today={localDateOf(systemClock.now(), form.timeZone)}
      />
      <p className={sectionGap.office}>
        <Link href="/office/shifts" className={btn.link}>
          Back to shifts
        </Link>
      </p>
    </main>
  );
}
