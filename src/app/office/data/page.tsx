import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { findWorkersForData } from "@/lib/gdpr/worker-export";

const section = "mt-8";
const heading = "text-2xl font-bold";
const button = "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100";

const STATUS_WORDS: Record<string, string> = {
  active: "Active",
  inactive: "Not active",
  blocked: "Blocked",
};

// Data requests (docs/screens.md `/office/data`): find the worker a GDPR request is about, and
// download all the firm's data. Admins only (checked here and in every function it calls).
export default async function OfficeDataPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("data");
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").trim().slice(0, 100);
  const matches = q ? await findWorkersForData({ firm, officeUserId: officeUser.id }, q) : [];
  if (matches === null) notFound();
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
        <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col font-semibold">
            Name or mobile number
            <input
              name="q"
              defaultValue={q}
              maxLength={100}
              className="mt-1 rounded border border-slate-400 px-2 py-2 font-normal"
            />
          </label>
          <button type="submit" className={button}>
            Find
          </button>
        </form>
        {q && matches.length === 0 && <p className="mt-3">Nobody matches &ldquo;{q}&rdquo;.</p>}
        {matches.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {matches.map((m) => (
              <li key={m.id} className="rounded-lg border border-slate-300 p-3">
                <Link href={`/office/data/workers/${m.id}`} className="font-semibold underline">
                  {m.name}
                </Link>
                <span className="ml-2 text-slate-700">
                  {m.erased
                    ? "Deleted"
                    : `${m.mobile ?? ""} · ${STATUS_WORDS[m.status] ?? m.status}`}
                </span>
              </li>
            ))}
          </ul>
        )}
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
          <li>Messages to and from your shifts line: 90 days.</li>
          <li>A worker&rsquo;s own words copied into a request: 90 days.</li>
          <li>Login links and codes: 7 days after they run out.</li>
          <li>Logins: 30 days after they end.</li>
          <li>Workers and their licences and cards: until you delete them here.</li>
          <li>
            Shifts, bookings, offers, requests, pay records and the action log: kept as your records
            (deleted workers&rsquo; without a name).
          </li>
        </ul>
      </section>

      <Link href="/office" className="mt-8 inline-block underline">
        Back to the dashboard
      </Link>
    </main>
  );
}
