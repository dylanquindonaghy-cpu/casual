import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, count, h2, meta, page, sectionGap, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { dayWithYear } from "@/lib/office/action-log";
import { STATUS_WORDS } from "@/lib/office/worker-copy";
import { workerAccessView } from "@/lib/office/worker-access";
import { STRIKES_PER_CASUAL } from "@/lib/office/strikes";
import { liveCountText, strikeLine, strikeStatusText } from "@/lib/office/strikes-copy";
import { SITE_BLOCK_REASON_WORDS } from "@/lib/office/worker-reasons";
import { roleLabel, shiftWhen } from "@/lib/portal/format";
import {
  dateLine,
  needsText,
  noRuleText,
  qualificationTitle,
  rightToWorkText,
  statusLabel,
  STATUS_TONES as QUALIFICATION_TONES,
} from "@/lib/portal/qualification-copy";
import { OFFICE_PHOTO_WORDS, PHOTO_TONES, photoDates } from "@/lib/portal/upload-copy";
import { shortDate } from "@/lib/rules/reasons";
import { localDateOf } from "@/lib/time/zoned";
import { officeTravelText } from "@/lib/travel/copy";
import { CSAS } from "@/lib/uploads/check";
import { SignOutButton, SiteBlocks, StatusForm } from "./access-forms";
import { RecordCsas, UploadsToCheck } from "./upload-checks";

// An upload's image, opening full size in a new tab (access-checked: src/app/files/[id]/route.ts).
function Evidence({ id, alt, size }: { id: string; alt: string; size: number }) {
  return (
    <a href={`/files/${id}`} target="_blank" rel="noreferrer" className="shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/files/${id}`}
        alt={alt}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="rounded-lg border border-line bg-quiet-soft object-contain"
      />
    </a>
  );
}

// The status word's colour (docs/ui-design.md "Status tones").
const STATUS_TONES: Record<"active" | "inactive" | "blocked", StatusTone> = {
  active: "done",
  inactive: "quiet",
  blocked: "urgent",
};

// One casual's page (docs/office-v2.md 3.7; docs/screens.md `/office/casuals/[id]`; 12F.1, 12F.2):
// what needs updating, their uploads waiting for a check (each image with approve and reject), their
// staff photo, their qualifications (each with the card it came from) and right to work (and, for
// CSAS, recording it under the firm's own scheme), their travel area (the postcode district only,
// 12G.1), their strikes, then their access (what changes their status, the sites they can't work
// at, logging them out everywhere: moved from `/office/workers/[id]`). "Booked ahead" sits beside
// them on a wide screen (below them on a phone). Admins and resourcers (checked here and in every
// function it calls).
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
                    <li key={n.qualification.type}>{needsText(n, Number(thisYear), "office")}</li>
                  ))}
                </ul>
              )}
            </section>

            {/* Always there: it shows itself while it has anything to check, and keeps what was
                checked here on screen with its answer. */}
            <UploadsToCheck
              items={[
                ...(worker.photo.waiting
                  ? [
                      {
                        uploadId: worker.photo.waiting.id,
                        kind: "photo" as const,
                        type: null,
                        title: "Staff photo",
                        name: "staff photo",
                        alt: `New staff photo of ${worker.name}`,
                        sent: `Sent ${shortDate(worker.photo.waiting.uploadedOn, Number(thisYear))}`,
                      },
                    ]
                  : []),
                ...worker.qualifications.flatMap((q) =>
                  q.waiting
                    ? [
                        {
                          uploadId: q.waiting.uploadId,
                          kind: "certificate" as const,
                          type: q.type,
                          title: qualificationTitle(q.name),
                          name: q.name,
                          alt: `${qualificationTitle(q.name)} sent by ${worker.name}`,
                          sent: `Sent ${shortDate(q.waiting.sentOn, Number(thisYear))}`,
                        },
                      ]
                    : [],
                ),
              ]}
            />

            <section className={card} aria-labelledby="photo">
              <h2 id="photo" className={h2}>
                Staff photo
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                {worker.photo.current ? (
                  <Evidence
                    id={worker.photo.current.id}
                    alt={`Staff photo of ${worker.name}`}
                    size={96}
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="tabular-nums">{photoDates(worker.photo, Number(thisYear))}</p>
                  <p className="mt-1">
                    <StatusChip tone={PHOTO_TONES[worker.photo.status]}>
                      {OFFICE_PHOTO_WORDS[worker.photo.status]}
                    </StatusChip>
                  </p>
                </div>
              </div>
            </section>

            <section className={card} aria-labelledby="qualifications">
              <h2 id="qualifications" className={h2}>
                Qualifications
              </h2>
              {worker.rolesWithoutRule.length > 0 && (
                <p className="mt-2">{noRuleText(worker.rolesWithoutRule, "office")}</p>
              )}
              {worker.qualifications.length === 0 ? (
                worker.rolesWithoutRule.length === 0 && (
                  <p className="mt-2 text-ink-muted">Their roles don&apos;t need any.</p>
                )
              ) : (
                <ul role="list" className="mt-2 divide-y divide-line">
                  {worker.qualifications.map((q) => (
                    <li key={q.type} className="py-3">
                      <p className="font-semibold">{qualificationTitle(q.name)}</p>
                      <p className="mt-1 tabular-nums">
                        <StatusChip tone={QUALIFICATION_TONES[q.status]}>
                          {statusLabel(q)}
                        </StatusChip>
                        {dateLine(q, Number(thisYear)) && ` · ${dateLine(q, Number(thisYear))}`}
                      </p>
                      {q.evidenceUploadId && (
                        <p className={`${meta} mt-1`}>
                          <a
                            href={`/files/${q.evidenceUploadId}`}
                            target="_blank"
                            rel="noreferrer"
                            className={textLink}
                          >
                            See the card it came from
                          </a>
                        </p>
                      )}
                      {q.waiting && (
                        <p className={`${meta} mt-1`}>
                          A new one is waiting:{" "}
                          <a href="#uploads" className={textLink}>
                            check it
                          </a>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 border-t border-line pt-3">
                <span className="font-semibold">Right to work:</span>{" "}
                {rightToWorkText(worker.rightToWork, Number(thisYear))}
              </p>
              {worker.qualifications.some((q) => q.type === CSAS) && (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="font-semibold">Record CSAS accreditation</p>
                  <p className={meta}>Only the office records it: casuals can&apos;t upload it.</p>
                  <RecordCsas workerId={worker.id} firmName={firm.name} />
                </div>
              )}
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
              {worker.strikesMore && (
                <p className={`${meta} mt-2`}>Showing the latest {STRIKES_PER_CASUAL}.</p>
              )}
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
