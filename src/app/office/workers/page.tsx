import type { Metadata } from "next";
import Link from "next/link";
import { btn, card, page } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { FindWorkerForm } from "../find-worker-form";
import { findWorkersAction } from "./actions";

export const metadata: Metadata = { title: "Workers" };

// Workers (docs/screens.md `/office/workers`): find someone to change their access (they've left,
// they're back, a site they can't work at, a lost phone). Admins and resourcers (checked here and
// in every function it calls). The search is a server action: what's typed never goes in the
// address.
export default async function OfficeWorkersPage() {
  const { firm } = await requireOfficeArea("workers");
  return (
    <main className={page.officeForm}>
      <PageHeader eyebrow={<>{firm.name} office</>} title="Workers">
        <p>
          Find someone to make them inactive when they leave, active again when they&apos;re back,
          keep them off a site, or log them out when they lose their phone.
        </p>
      </PageHeader>
      <div className={card}>
        <FindWorkerForm
          find={findWorkersAction}
          hrefBase="/office/workers"
          notAllowed="You can't change workers' access."
        />
      </div>
      <p className="mt-10">
        <Link href="/office" className={btn.link}>
          Back to Today
        </Link>
      </p>
    </main>
  );
}
