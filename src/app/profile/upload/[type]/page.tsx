import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { card, muted, nums, page, sectionGap, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireWorker } from "@/lib/auth/current-worker";
import { myProfile } from "@/lib/portal/profile";
import {
  dateLine,
  qualificationTitle,
  statusLabel,
  STATUS_TONES,
} from "@/lib/portal/qualification-copy";
import { CARD_GUIDANCE } from "@/lib/portal/upload-copy";
import { refreshSessionAction } from "../../../session-actions";
import { SessionKeeper } from "../../../session-keeper";
import { UploadForm } from "../../upload-form";
import { CasualTabBar } from "../../../casual-tab-bar";

export const metadata: Metadata = { title: "Upload a certificate" };

// Upload one qualification's card or certificate (docs/office-v2.md 4.6, 5.5, 5.7 item 5;
// docs/screens.md `/profile/upload/[type]`; 12F.2): where Profile's "Upload a certificate" and the
// expiry reminders lead. Only a type one of her roles needs (any other goes to her Profile); one the
// office records itself (CSAS, right to work, health or criminal record details) says to send it to
// them instead.
export default async function UploadPage({ params }: { params: Promise<{ type: string }> }) {
  const { firm, worker, session } = await requireWorker();
  const { type } = await params;
  const profile = await myProfile({ firm }, worker.id);
  const q = profile?.qualifications.find((x) => x.type === type);
  if (!profile) notFound();
  // A type she isn't asked for (an old link, or her roles changed): her Profile says what is.
  if (!q) redirect("/profile");
  const year = Number(profile.today.slice(0, 4));
  const name = qualificationTitle(q.name);
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <PageHeader eyebrow={firm.name} title={`Upload your ${q.name}`} />
      <section className={card} aria-label={name}>
        <p className={`text-base ${nums}`}>
          <StatusChip tone={STATUS_TONES[q.status]}>{statusLabel(q)}</StatusChip>
          {dateLine(q, year) && ` · ${dateLine(q, year)}`}
        </p>
        {q.uploadable ? (
          <UploadForm
            kind="certificate"
            type={q.type}
            camera="environment"
            button="Take or choose a photo"
            guidance={CARD_GUIDANCE}
          />
        ) : (
          <p className={`mt-4 ${muted}`}>
            The office records your {q.name} itself. Contact them when you have a new one.
          </p>
        )}
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
