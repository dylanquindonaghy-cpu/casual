import type { Metadata } from "next";
import Link from "next/link";
import { btn, card, h2, headingGap, page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { firmRetention } from "@/lib/gdpr/retention-view";
import { dayLabel } from "@/lib/rules/reasons";
import { keepTimeLines } from "@/lib/office/data-copy";
import { FindWorkerForm } from "../find-worker-form";
import { findWorkersAction } from "./actions";

export const metadata: Metadata = { title: "Data requests" };

// Data requests (docs/screens.md `/office/data`): find the worker a GDPR request is about, and
// download all the firm's data. Admins only (checked here and in every function it calls). The
// search is a server action (../find-worker-form.tsx): what's typed never goes in the address.
// Layout: three sections, each a heading over one card, in the order you need them.
export default async function OfficeDataPage() {
  const { firm, officeUser } = await requireOfficeArea("data");
  const keep = await firmRetention({ firm, officeUserId: officeUser.id });
  return (
    <main className={page.officeForm}>
      <PageHeader title="Data requests">
        <p>
          When someone asks for their data, or asks to be deleted, find them here. Send their data
          within a month of the request. Every download and deletion goes in the action log.
        </p>
      </PageHeader>

      <section aria-labelledby="data-find-heading">
        <h2 id="data-find-heading" className={h2}>
          Find a worker
        </h2>
        <div className={`${card} ${headingGap}`}>
          <FindWorkerForm
            find={findWorkersAction}
            hrefBase="/office/data/workers"
            notAllowed="Only an admin can look up a worker's data."
          />
        </div>
      </section>

      <section className={sectionGap.office} aria-labelledby="data-all-heading">
        <h2 id="data-all-heading" className={h2}>
          All {firm.name}&rsquo;s data
        </h2>
        <div className={`${card} ${headingGap}`}>
          <p>
            Everything {firm.name} keeps here, in one file (JSON): workers, licences and cards,
            shifts, bookings, offers, requests, pay records and queries, messages and the action
            log. Login records aren&rsquo;t included.
          </p>
          <a href="/office/data/export" className={`${btn.secondary} mt-4`}>
            Download all your data
          </a>
        </div>
      </section>

      <section className={sectionGap.office} aria-labelledby="data-keep-heading">
        <h2 id="data-keep-heading" className={h2}>
          How long we keep things
        </h2>
        <div className={`${card} ${headingGap}`}>
          <ul className="list-disc space-y-2 pl-6">
            {keepTimeLines(
              keep,
              keep.holdUntil ? `${dayLabel(keep.holdUntil)} ${keep.holdUntil.slice(0, 4)}` : null,
            ).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <p className={sectionGap.office}>
        <Link href="/office" className={btn.link}>
          Back to the dashboard
        </Link>
      </p>
    </main>
  );
}
