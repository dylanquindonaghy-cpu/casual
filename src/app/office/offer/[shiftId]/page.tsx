import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeOfferPage } from "@/lib/office/offer-page";
import { OfferView } from "./offer-view";

// "Offer to someone" for one shift (Today's quick action). Admins and resourcers.
export default async function OfferPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { firm } = await requireOfficeArea("today");
  const { shiftId } = await params;
  const page = await officeOfferPage({ firm }, (await readSessionToken("office")) ?? "", shiftId);
  if (!page) notFound();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <OfferView page={page} />
      <Link href="/office" className="mt-8 inline-block underline">
        Back to Today
      </Link>
    </main>
  );
}
