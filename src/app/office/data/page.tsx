import Link from "next/link";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { firmRetention } from "@/lib/gdpr/retention-view";
import { dayLabel } from "@/lib/rules/reasons";
import { keepTimeLines } from "@/lib/office/data-copy";
import { FindWorkerForm } from "../find-worker-form";
import { findWorkersAction } from "./actions";

const section = "mt-8";
const heading = "text-2xl font-bold";
const button = "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100";

// Data requests (docs/screens.md `/office/data`): find the worker a GDPR request is about, and
// download all the firm's data. Admins only (checked here and in every function it calls). The
// search is a server action (../find-worker-form.tsx): what's typed never goes in the address.
export default async function OfficeDataPage() {
  const { firm, officeUser } = await requireOfficeArea("data");
  const keep = await firmRetention({ firm, officeUserId: officeUser.id });
  return (
    <main className="mx-auto max-w-2xl p-6 text-lg">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Data requests</h1>
      <p className="mt-2">
        When someone asks for their data, or asks to be deleted, find them here. Send their data
        within a month of the request. Every download and deletion goes in the action log.
      </p>

      <section className={section}>
        <h2 className={heading}>Find a worker</h2>
        <FindWorkerForm
          find={findWorkersAction}
          hrefBase="/office/data/workers"
          notAllowed="Only an admin can look up a worker's data."
        />
      </section>

      <section className={section}>
        <h2 className={heading}>All {firm.name}&rsquo;s data</h2>
        <p className="mt-2">
          Everything {firm.name} keeps here, in one file (JSON): workers, licences and cards,
          shifts, bookings, offers, requests, pay records and queries, messages and the action log.
          Login records aren&rsquo;t included.
        </p>
        <a href="/office/data/export" className={`${button} mt-3 inline-block`}>
          Download all your data
        </a>
      </section>

      <section className={section}>
        <h2 className={heading}>How long we keep things</h2>
        <ul className="mt-2 list-disc pl-6">
          {keepTimeLines(
            keep,
            keep.holdUntil ? `${dayLabel(keep.holdUntil)} ${keep.holdUntil.slice(0, 4)}` : null,
          ).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <Link href="/office" className="mt-8 inline-block underline">
        Back to the dashboard
      </Link>
    </main>
  );
}
