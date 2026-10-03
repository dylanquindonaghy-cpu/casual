import Link from "next/link";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { FindWorkerForm } from "../find-worker-form";
import { findWorkersAction } from "./actions";

// Workers (docs/screens.md `/office/workers`): find someone to change their access (they've left,
// they're back, a site they can't work at, a lost phone). Admins and resourcers (checked here and
// in every function it calls). The search is a server action: what's typed never goes in the
// address.
export default async function OfficeWorkersPage() {
  const { firm } = await requireOfficeArea("workers");
  return (
    <main className="mx-auto max-w-2xl p-6 text-lg">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Workers</h1>
      <p className="mt-2">
        Find someone to make them inactive when they leave, active again when they&apos;re back,
        keep them off a site, or log them out when they lose their phone.
      </p>
      <FindWorkerForm
        find={findWorkersAction}
        hrefBase="/office/workers"
        notAllowed="You can't change workers' access."
      />
      <Link href="/office" className="mt-8 inline-block underline">
        Back to Today
      </Link>
    </main>
  );
}
