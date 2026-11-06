import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { nums, page, sectionGap, staffBtn, staffCard } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireWorker } from "@/lib/auth/current-worker";
import { myProfile } from "@/lib/portal/profile";
import {
  chipTail,
  qualificationTitle,
  statusLabel,
  STATUS_TONES,
} from "@/lib/portal/qualification-copy";
import { CARD_GUIDANCE } from "@/lib/portal/upload-copy";
import { refreshSessionAction } from "../../../session-actions";
import { SessionKeeper } from "../../../session-keeper";
import { UploadForm } from "../../upload-form";
import { OfficeRecordedNote } from "./office-recorded";
import { CasualTabBar } from "../../../casual-tab-bar";

export const metadata: Metadata = { title: "Upload a certificate" };

// Upload one qualification's card or certificate (docs/office-v2.md 4.6, 5.5, 5.7 item 5;
// docs/screens.md `/profile/upload/[type]`; 12F.2): where Profile's "Upload a new one" and the
// expiry reminders lead. Only a type one of her roles needs (any other goes to her Profile); one the
// office records itself (CSAS, right to work, health or criminal record details) says to send it to
// them instead, with "Message the office" (28.11). The picture shows before it's sent (28.11:
// upload-form.tsx), and "Back to my profile" is a 52px button.
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
      <PageHeader title={`Upload your ${q.name}`} />
      <section className={staffCard} aria-label={name}>
        <p className={`text-base ${nums}`}>
          <StatusChip tone={STATUS_TONES[q.status]}>{statusLabel(q)}</StatusChip>
          {chipTail(q, year)}
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
          <OfficeRecordedNote name={q.name} />
        )}
      </section>
      <Link href="/profile" className={`${staffBtn.secondary} ${sectionGap.staff}`}>
        Back to my profile
      </Link>
      <CasualTabBar firm={firm} workerId={worker.id} current="profile" />
    </main>
  );
}
