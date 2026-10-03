import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { dayWithYear } from "@/lib/office/action-log";
import { STATUS_WORDS } from "@/lib/office/worker-copy";
import { workerAccessView } from "@/lib/office/worker-access";
import { SITE_BLOCK_REASON_WORDS } from "@/lib/office/worker-reasons";
import { roleLabel, shiftWhen } from "@/lib/portal/format";
import { localDateOf } from "@/lib/time/zoned";
import { SignOutButton, SiteBlocks, StatusForm } from "./access-forms";

const section = "mt-8";
const heading = "text-2xl font-bold";

// One worker's access (docs/screens.md `/office/workers/[id]`): their status and what changes it,
// the sites they can't work at, logging them out everywhere, and their bookings ahead. Admins and
// resourcers (checked here and in every function it calls).
export default async function OfficeWorkerPage({ params }: { params: Promise<{ id: string }> }) {
  const { firm, officeUser } = await requireOfficeArea("workers");
  const { id } = await params;
  const worker = await workerAccessView({ firm, officeUserId: officeUser.id }, id);
  if (!worker) notFound();
  const tz = firm.timezone;
  const thisYear = localDateOf(new Date(), tz).slice(0, 4);
  return (
    <main className="mx-auto max-w-2xl p-6 text-lg">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">{worker.name}</h1>
      {worker.erased ? (
        <p className="mt-2">Their details were deleted. There&apos;s nothing to change here.</p>
      ) : (
        <>
          {worker.mobile && <p className="mt-1">{worker.mobile}</p>}
          <p className="mt-1">
            {STATUS_WORDS[worker.status]}
            {worker.roles.length > 0 ? ` · ${worker.roles.map(roleLabel).join(", ")}` : ""}
          </p>

          <section className={section} aria-labelledby="access">
            <h2 id="access" className={heading}>
              Access
            </h2>
            {worker.status === "inactive" && worker.byOffice && (
              <p className="mt-2">
                Made inactive by the office: your rota sheet or a staff file can&apos;t make them
                active again. Only you can, here.
              </p>
            )}
            {worker.status === "inactive" && !worker.byOffice && (
              <p className="mt-2">
                Made inactive by your rota sheet or a staff file. If it still says so, its next sync
                or import makes them inactive again.
              </p>
            )}
            {worker.status === "blocked" && worker.byOffice && (
              <p className="mt-2">
                The office made them inactive before they were blocked: unblocking leaves them
                inactive.
              </p>
            )}
            <StatusForm workerId={worker.id} name={worker.name} status={worker.status} />
            <SignOutButton workerId={worker.id} />
          </section>

          <section className={section} aria-labelledby="sites">
            <h2 id="sites" className={heading}>
              Sites they can&apos;t work at
            </h2>
            <SiteBlocks
              workerId={worker.id}
              blocks={worker.siteBlocks.map((b) => ({
                siteId: b.siteId,
                site: b.site,
                line: `${
                  SITE_BLOCK_REASON_WORDS[b.reason as keyof typeof SITE_BLOCK_REASON_WORDS] ??
                  "Another reason"
                }, since ${dayWithYear(localDateOf(b.since, tz), thisYear)}.`,
              }))}
              otherSites={worker.otherSites}
            />
          </section>
        </>
      )}

      <section className={section} aria-labelledby="ahead">
        <h2 id="ahead" className={heading}>
          Booked ahead
        </h2>
        {worker.ahead.length === 0 ? (
          <p className="mt-2">Nothing booked ahead.</p>
        ) : (
          <ul className="mt-2 list-disc pl-6">
            {worker.ahead.map((a) => (
              <li key={a.shiftId}>
                <Link href={`/office/shifts/${a.shiftId}`} className="underline">
                  {roleLabel(a.role)}
                  {a.site ? ` at ${a.site}` : ""}
                </Link>
                , {shiftWhen(a.startsAt, a.endsAt, tz)}
              </li>
            ))}
          </ul>
        )}
        {worker.aheadMore && <p className="mt-2">Showing the first 20.</p>}
      </section>

      <Link href="/office/workers" className="mt-8 inline-block underline">
        Find another worker
      </Link>
    </main>
  );
}
