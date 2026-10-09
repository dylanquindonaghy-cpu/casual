import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, h2, headingGap, page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { workerDataSummary } from "@/lib/gdpr/worker-erase";
import { dayWithYear } from "@/lib/office/action-log";
import { eraseExplainer, OTHERS_WORDS, upcomingShifts } from "@/lib/office/data-copy";
import { localDateOf } from "@/lib/time/zoned";
import { EraseForm } from "./erase-form";

// One worker's data (docs/screens.md `/office/data/workers/[id]`): download it (JSON or CSV), or
// delete their personal details. Admins only (checked here and in every function it calls).
// Layout: two sections, each a heading over one card. While the details can still be deleted,
// that card has a red border and its button is solid red: it can't be undone.
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
  const canErase = !worker.erasedAt && worker.upcoming === 0;
  return (
    <main className={page.officeForm}>
      <PageHeader eyebrow={`${firm.name} office`} title={worker.name}>
        {worker.mobile && <p className="tabular-nums">{worker.mobile}</p>}
      </PageHeader>

      <section aria-labelledby="data-download-heading">
        <h2 id="data-download-heading" className={h2}>
          Download their data
        </h2>
        <div className={`${card} ${headingGap}`}>
          <p>
            Everything we hold about {worker.name}: their details, licences and cards, days off,
            sites they can&apos;t work at, shifts, offers, requests, pay records and queries,
            messages, and the action log. Send it to them within a month of their request.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={`/office/data/workers/${worker.id}/export?format=json`}
              className={btn.secondary}
            >
              Download (JSON)
            </a>
            <a
              href={`/office/data/workers/${worker.id}/export?format=csv`}
              className={btn.secondary}
            >
              Download (CSV, opens in Excel)
            </a>
          </div>
        </div>
      </section>

      <section className={sectionGap.office} aria-labelledby="data-delete-heading">
        <h2 id="data-delete-heading" className={h2}>
          Delete their personal details
        </h2>
        <div
          className={
            canErase
              ? `${headingGap} rounded-xl border-2 border-urgent bg-card p-4 shadow-sm`
              : `${card} ${headingGap}`
          }
        >
          {worker.erasedAt ? (
            <p>
              Deleted on{" "}
              {dayWithYear(localDateOf(worker.erasedAt, firm.timezone), today.slice(0, 4))}. Their
              shift history stays, without a name. {OTHERS_WORDS}
            </p>
          ) : worker.upcoming > 0 ? (
            <p>
              {worker.name} is booked on {upcomingShifts(worker.upcoming)}. Cancel those first (with
              a reason), then come back to delete.
            </p>
          ) : (
            <>
              <div className="flex max-w-prose flex-col gap-2">
                {eraseExplainer(worker.name, firm.name).map((line) => (
                  <p key={line}>{line}</p>
                ))}
                <p>
                  If {worker.name} is in your rota sheet or a staff file you import, remove them
                  there too, or the next sync or import adds them back.
                </p>
              </div>
              <EraseForm workerId={worker.id} name={worker.name} />
            </>
          )}
        </div>
      </section>

      <p className={sectionGap.office}>
        <Link href="/office/data" className={btn.link}>
          Back to data requests
        </Link>
      </p>
    </main>
  );
}
