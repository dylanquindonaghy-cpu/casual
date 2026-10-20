import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, page as width, sectionGap } from "@/app/ui/classes";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeOfferPage } from "@/lib/office/offer-page";
import { OfferView } from "./offer-view";

export const metadata: Metadata = { title: "Offer this shift" };

// "Offer to someone" for one shift (the dashboard's quick action). Admins and resourcers.
export default async function OfferPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { firm } = await requireOfficeArea("today");
  const { shiftId } = await params;
  const page = await officeOfferPage({ firm }, (await readSessionToken("office")) ?? "", shiftId);
  if (!page) notFound();
  return (
    <main className={width.officeForm}>
      <OfferView page={page} />
      <p className={sectionGap.office}>
        <Link href="/office" className={btn.link}>
          Back to the dashboard
        </Link>
      </p>
    </main>
  );
}
