import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, count, h2, meta, page, sectionGap, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { dayWithYear } from "@/lib/office/action-log";
import { STATUS_WORDS } from "@/lib/office/worker-copy";
import { workerAccessView } from "@/lib/office/worker-access";
import { liveCountText, strikeLine, strikeStatusText } from "@/lib/office/strikes-copy";
import { SITE_BLOCK_REASON_WORDS } from "@/lib/office/worker-reasons";
import { roleLabel, shiftWhen } from "@/lib/portal/format";
import {
  dateLine,
  needsText,
  qualificationTitle,
  rightToWorkText,
  STATUS_TONES as QUALIFICATION_TONES,
  STATUS_WORDS as QUALIFICATION_WORDS,
} from "@/lib/portal/qualification-copy";
import { localDateOf } from "@/lib/time/zoned";
import { officeTravelText } from "@/lib/travel/copy";
import { SignOutButton, SiteBlocks, StatusForm } from "./access-forms";

// The status word's colour (docs/ui-design.md "Status tones").
const STATUS_TONES: Record<"active" | "inactive" | "blocked", StatusTone> = {
  active: "done",
  inactive: "quiet",
  blocked: "urgent",
};

// One casual's page (docs/office-v2.md 3.7; docs/screens.md `/office/casuals/[id]`; 12F.1): what
// needs updating, their qualifications and right to work, their travel area (the postcode district
// only, 12G.1), their strikes, then their access (what changes their status, the sites they can't
// work at, logging them out everywhere: moved from `/office/workers/[id]`). "Booked ahead" sits
// beside them on a wide screen (below them on a phone). Admins and resourcers (checked here and in
// every function it calls). Evidence images and approving or rejecting join with 12F.2.
export default async function OfficeCasualPage({ params }: { params: Promise<{ id: string }> }) {
  const { firm, officeUser } = await requireOfficeArea("casuals");
  const { id } = await params;
  const worker = await workerAccessView({ firm, officeUserId: officeUser.id }, id);
  if (!worker) notFound();
  const tz = firm.timezone;
  const thisYear = localDateOf(new Date(), tz).slice(0, 4);
  return (
    <main className={page.office}>
      <PageHeader eyebrow={<>{firm.name} office</>} title={worker.name}>
        {worker.erased ? (
          <p>Their details were deleted. There&apos;s nothing to change here.</p>
        ) : (
          <>
            {worker.mobile && <p className="text-ink-muted tabular-nums">{worker.mobile}</p>}
            <p>
              <StatusChip tone={STATUS_TONES[worker.status]}>
                {STATUS_WORDS[worker.status]}
              </StatusChip>
              {worker.roles.length > 0 ? ` · ${worker.roles.map(roleLabel).join(", ")}` : ""}
            </p>
          </>
        )}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        {!worker.erased && (
          <div className="flex min-w-0 flex-col gap-6">
            <section className={card} aria-labelledby="needs">
              <h2 id="needs" className={h2}>
                Needs updating
              </h2>
              {worker.needs.length === 0 ? (
                <p className="mt-2 text-ink-muted">Nothing.</p>
              ) : (
                <ul role="list" className="mt-2 flex flex-col gap-2">
                  {worker.needs.map((n) => (
                    <li key={n.qualification.type}>{needsText(n, Number(thisYear))}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className={card} aria-labelledby="qualifications">
              <h2 id="qualifications" className={h2}>
                Qualifications
              </h2>
              {worker.qualifications.length === 0 ? (
                <p className="mt-2 text-ink-muted">Their roles don&apos;t need any.</p>
              ) : (
                <ul role="list" className="mt-2 divide-y divide-line">
                  {worker.qualifications.map((q) => (
                    <li key={q.type} className="py-3">
                      <p className="font-semibold">{qualificationTitle(q.name)}</p>
                      <p className="mt-1 tabular-nums">
                        <StatusChip tone={QUALIFICATION_TONES[q.status]}>
                          {QUALIFICATION_WORDS[q.status]}
                        </StatusChip>{" "}
                        · {dateLine(q, Number(thisYear))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 border-t border-line pt-3">
                <span className="font-semibold">Right to work:</span>{" "}
                {rightToWorkText(worker.rightToWork, Number(thisYear))}
              </p>
            </section>

            <section className={card} aria-labelledby="travel">
              <h2 id="travel" className={h2}>
                Travel area
              </h2>
              <p className="mt-2 tabular-nums">{officeTravelText(worker.travel)}</p>
            </section>

            <section className={card} aria-labelledby="strikes">
              <h2 id="strikes" className={h2}>
                Strikes
              </h2>
              <p className="mt-2">{liveCountText(worker.liveStrikes)}.</p>
              {worker.strikes.length > 0 && (
                <ul role="list" className="mt-2 divide-y divide-line">
                  {worker.strikes.map((st) => (
                    <li key={st.assignmentId} className="py-3">
                      <p>{strikeLine(st, worker.timeZone)}</p>
                      <p className={`${meta} mt-1`}>
                        {strikeStatusText(st, worker.timeZone)} ·{" "}
                        <Link
                          href={`/office/cancellations/${st.assignmentId}`}
                          className={textLink}
                        >
                          Cancellation record {st.ref}
                        </Link>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {worker.strikesMore && <p className={`${meta} mt-2`}>Showing the latest 10.</p>}
            </section>

            <section className={card} aria-labelledby="access">
              <h2 id="access" className={h2}>
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
                  Made inactive by your rota sheet or a staff file. If it still says so, its next
                  sync or import makes them inactive again.
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

            <section className={card} aria-labelledby="sites">
              <h2 id="sites" className={h2}>
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
          </div>
        )}

        <section className={`${card} min-w-0`} aria-labelledby="ahead">
          <div className="flex items-center">
            <h2 id="ahead" className={h2}>
              Booked ahead
            </h2>
            {worker.ahead.length > 0 && <span className={count}>{worker.ahead.length}</span>}
          </div>
          {worker.ahead.length === 0 ? (
            <p className="mt-2 text-ink-muted">Nothing booked ahead.</p>
          ) : (
            <ul role="list" className="mt-2 divide-y divide-line">
              {worker.ahead.map((a) => (
                <li key={a.shiftId} className="py-3">
                  <Link
                    href={`/office/shifts/${a.shiftId}`}
                    className={`font-semibold ${textLink}`}
                  >
                    {roleLabel(a.role)}
                    {a.site ? ` at ${a.site}` : ""}
                  </Link>
                  , {shiftWhen(a.startsAt, a.endsAt, tz)}
                </li>
              ))}
            </ul>
          )}
          {worker.aheadMore && <p className={`${meta} mt-2`}>Showing the first 20.</p>}
        </section>
      </div>

      <p className={sectionGap.office}>
        <Link href="/office/casuals" className={btn.link}>
          Back to Casuals
        </Link>
      </p>
    </main>
  );
}
