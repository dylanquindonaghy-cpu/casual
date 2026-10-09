import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { page } from "@/app/ui/classes";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv } from "@/lib/env";
import { myStrikes } from "@/lib/portal/my-strikes";
import { myProfile } from "@/lib/portal/profile";
import { myTravel } from "@/lib/portal/travel";
import { refreshSessionAction } from "../session-actions";
import { HomeScreenHint } from "../home-screen-hint";
import { SessionKeeper } from "../session-keeper";
import { ProfileView } from "./profile-view";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const { firm, worker, session } = await requireWorker();
  const profile = await myProfile({ firm }, worker.id);
  if (!profile) notFound();
  const strikes = await myStrikes({ firm }, worker.id);
  const travel = await myTravel({ firm }, worker.id);
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <ProfileView
        eyebrow={firm.name}
        profile={profile}
        signOff={firm.signOff}
        push={{ publicKey: appEnv().VAPID_PUBLIC_KEY ?? null, firmName: firm.name }}
        strikes={strikes}
        travel={travel}
      />
      <HomeScreenHint />
    </main>
  );
}
