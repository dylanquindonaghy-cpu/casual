import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { workerDataSummary } from "@/lib/gdpr/worker-erase";
import { dayWithYear } from "@/lib/office/action-log";
import { upcomingShifts } from "@/lib/office/data-copy";
import { localDateOf } from "@/lib/time/zoned";
import { EraseForm } from "./erase-form";

const section = "mt-8";
const heading = "text-2xl font-bold";
const button = "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100";

// One worker's data (docs/screens.md `/office/data/workers/[id]`): download it (JSON or CSV), or
// delete their personal details. Admins only (checked here and in every function it calls).
export default async function OfficeWorkerDataPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("data");
  const { id } = await params;
  const worker = await workerDataSummary({ firm, officeUserId: officeUser.id }, id);
  if (!worker) notFound();
  const today = localDateOf(new Date(), firm.timezone);
  return (
    <main className="mx-auto max-w-2xl p-6 text-lg">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">{worker.name}</h1>
      {worker.mobile && <p className="mt-1">{worker.mobile}</p>}

      <section className={section}>
        <h2 className={heading}>Download their data</h2>
        <p className="mt-2">
          Everything we hold about {worker.name}: their details, licences and cards, days off,
          shifts, offers, requests, pay records and queries, messages, and the action log. Send it
          to them within a month of their request.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={`/office/data/workers/${worker.id}/export?format=json`} className={button}>
            Download (JSON)
          </a>
          <a href={`/office/data/workers/${worker.id}/export?format=csv`} className={button}>
            Download (CSV, opens in Excel)
          </a>
        </div>
      </section>

      <section className={section}>
        <h2 className={heading}>Delete their personal details</h2>
        {worker.erasedAt ? (
          <p className="mt-2">
            Deleted on {dayWithYear(localDateOf(worker.erasedAt, firm.timezone), today.slice(0, 4))}
            . Their shift history stays, without a name.
          </p>
        ) : worker.upcoming > 0 ? (
          <p className="mt-2">
            {worker.name} is booked on {upcomingShifts(worker.upcoming)}. Cancel those first (with a
            reason), then come back to delete.
          </p>
        ) : (
          <>
            <p className="mt-2">
              This deletes {worker.name}&rsquo;s name, mobile number, email, licences and cards,
              days off, messages, notes and logins. Their shifts, offers, cancellations and pay
              lines stay, without a name, as {firm.name}&rsquo;s records (the notice report needs
              them).
            </p>
            <p className="mt-2">
              If {worker.name} is in your rota sheet or a staff file you import, remove them there
              too, or the next sync or import adds them back.
            </p>
            <EraseForm workerId={worker.id} name={worker.name} />
          </>
        )}
      </section>

      <Link href="/office/data" className="mt-8 inline-block underline">
        Back to data requests
      </Link>
    </main>
  );
}
