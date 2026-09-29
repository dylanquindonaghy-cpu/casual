import Link from "next/link";
import { notFound } from "next/navigation";
import { systemClock } from "@/lib/auth/clock";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeShiftForm } from "@/lib/office/shift-pages";
import { localDateOf } from "@/lib/time/zoned";
import { ShiftCreateForm } from "../shift-create-form";

// "New shift" (docs/screens.md `/office/shifts`). Admins and resourcers.
export default async function Page() {
  const { firm } = await requireOfficeArea("shifts");
  const form = await officeShiftForm({ firm }, (await readSessionToken("office")) ?? "");
  if (!form) notFound();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">New shift</h1>
      <ShiftCreateForm
        mode="single"
        sites={form.sites}
        roles={form.roles}
        today={localDateOf(systemClock.now(), form.timeZone)}
      />
      <Link href="/office/shifts" className="mt-8 inline-block underline">
        Back to shifts
      </Link>
    </main>
  );
}
