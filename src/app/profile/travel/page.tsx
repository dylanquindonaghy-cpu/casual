import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { card, muted, page, sectionGap, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireWorker } from "@/lib/auth/current-worker";
import { myTravel } from "@/lib/portal/travel";
import { TRAVEL_INTRO, TRAVEL_TITLE, travelPrivacyText } from "@/lib/portal/travel-copy";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { TravelForm } from "./travel-form";
import { CasualTabBar } from "../../casual-tab-bar";

export const metadata: Metadata = { title: TRAVEL_TITLE };

// "Where you work" (docs/office-v2.md 4.6; docs/screens.md `/profile/travel`; 12G.1): the casual's
// start-from postcode, how they travel and how long for, with who sees what. Their own only. Not
// found where the firm has travel areas switched off (13.4).
export default async function TravelPage() {
  const { firm, worker, session } = await requireWorker();
  const travel = await myTravel({ firm }, worker.id);
  if (!travel) notFound();
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <PageHeader eyebrow={firm.name} title={TRAVEL_TITLE}>
        <p>{TRAVEL_INTRO}</p>
      </PageHeader>
      <section className={card} aria-label={TRAVEL_TITLE}>
        <p className={muted}>{travelPrivacyText(travel.postcode)}</p>
        <TravelForm travel={travel} signOff={firm.signOff} />
      </section>
      <p className={sectionGap.staff}>
        <Link href="/profile" className={textLink}>
          Back to my profile
        </Link>
      </p>
      <CasualTabBar firm={firm} workerId={worker.id} current="profile" />
    </main>
  );
}
