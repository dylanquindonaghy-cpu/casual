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
import { officeEventBasics } from "@/lib/office/events";
import { ShiftCreateForm } from "../shift-create-form";

export const metadata: Metadata = { title: "Sessions for an event" };

// "Shifts for an event" (docs/screens.md `/office/shifts`). Admins and resourcers.
// Phase 26.5: from an event's page ("Add shifts", `?event=`), the shifts join that event.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { firm } = await requireOfficeArea("shifts");
  const token = (await readSessionToken("office")) ?? "";
  const form = await officeShiftForm({ firm }, token);
  if (!form) notFound();
  const { event } = await searchParams;
  const toEvent = event ? await officeEventBasics({ firm }, token, event) : null;
  if (event && !toEvent) notFound();
  return (
    <main className={page.officeForm}>
      <PageHeader title={toEvent ? "Add sessions" : "Sessions for an event"} />
      <ShiftCreateForm
        mode="event"
        sites={form.sites}
        roles={form.roles}
        qualifications={form.qualifications}
        today={localDateOf(systemClock.now(), form.timeZone)}
        toEvent={toEvent ?? undefined}
      />
      <p className={sectionGap.office}>
        <Link href="/office/shifts" className={btn.link}>
          Back to sessions
        </Link>
      </p>
    </main>
  );
}
